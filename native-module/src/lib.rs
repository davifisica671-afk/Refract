#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use ringbuf::traits::Consumer;

pub mod audio_config;
pub mod license;
pub mod microphone;
pub mod resampler;
pub mod silence_suppression;
pub mod speaker;

#[cfg(target_os = "macos")]
pub mod stealth_window;

#[cfg(target_os = "macos")]
pub mod keyboard_tap;

use crate::audio_config::{CHUNK_BATCH_COUNT, CHUNK_BATCH_TIMEOUT_MS, DSP_POLL_MS};
use crate::resampler::Resampler;
use crate::silence_suppression::{FrameAction, SilenceSuppressionConfig, SilenceSuppressor};
use std::time::Instant;

/// Canonical pipeline sample rate. Todos STT providers recebe audio at this rate,
/// produced uma vez (com próprio anti-aliasing) por o rubato resampler em o DSP
/// loop — em vez disso de cada provedor re-deriving it via crude decimation. Google
/// STT best practices recommend capturing at >=16kHz; speech energy é sub-8kHz
/// então 16kHz (8kHz Nyquist) é o correct universal floor para streaming STT.
const CANONICAL_STT_RATE: u32 = 16000;

// ============================================================================
// HELPERS — i16 slice → zero-copy LE bytes
// ============================================================================

/// Converte an i16 slice to little-endian bytes.
///
/// Todos targets supported por Refract (macOS x64/arm64, Windows x64, Linux x64)
/// são little-endian, então `i16` em memory É o little-endian byte
/// representation. `bytemuck::cast_slice` produces a `&[u8]` visão de o mesmo
/// memory em O(1) com não per-sample work; we então `to_vec` uma vez dentro de o
/// owned buffer napi exige para `Buffer::from(Vec<u8>)`.
///
/// Substitui o anterior per-sample `extend_from_slice(&s.to_le_bytes())` loop,
/// que fez 960 sequential 2-byte appends por 20ms chunk × 50 chunks/sec.
#[inline]
fn i16_slice_to_le_bytes(samples: &[i16]) -> Vec<u8> {
    bytemuck::cast_slice::<i16, u8>(samples).to_vec()
}

/// Coalesces para cima to `CHUNK_BATCH_COUNT` Send/SendSilence DSP frames dentro de a
/// single tsfn (V8 blimite call. Cada tsfn invocation traverses o napi
/// scheduler, allocates a JS Buffer wwrapper and despacha an event-loop
/// tarefa — non-trivial overhead por ~1.9 KB chunk. Coalescing 3 frames cuts
/// limite crossings 3× enquanto keeping latency abaixo STT framing thresholds
/// (Google / Soniox / Deepgram todos accept 60–100 ms framing).
///
/// Flush taciona
///   - `frames` == CHUNK_BATCH_COUNT (capacity reached), ou
///   - `(now - first_push_at) > CHUNK_BATCH_TIMEOUT_MS` (timeout para trailing
///     speech em light traffic), ou
///   - explicit `flush()` (DSP loop exit).
struct BatchEmitter {
    buffer: Vec<u8>,
    frames: usize,
    first_push_at: Option<Instant>,
}
impl BatchEmitter {
    fn new(estimated_chunk_bytes: usize) -> Self {
        Self {
            buffer: Vec::with_capacity(estimated_chunk_bytes * CHUNK_BATCH_COUNT),
            frames: 0,
            first_push_at: None,
        }
    }
    fn push(&mut self, bytes: &[u8], tsfn: &ThreadsafeFunction<Buffer>) {
        if self.first_push_at.is_none() {
            self.first_push_at = Some(Instant::now());
        }
        self.buffer.extend_from_slice(bytes);
        self.frames += 1;
        if self.frames >= CHUNK_BATCH_COUNT {
            self.flush(tsfn);
        }
    }
    fn maybe_flush_timeout(&mut self, tsfn: &ThreadsafeFunction<Buffer>) {
        if let Some(t) = self.first_push_at {
            if t.elapsed().as_millis() >= CHUNK_BATCH_TIMEOUT_MS {
                self.flush(tsfn);
            }
        }
    }
    fn flush(&mut self, tsfn: &ThreadsafeFunction<Buffer>) {
        if self.buffer.is_empty() {
            self.first_push_at = None;
            self.frames = 0;
            return;
        }
        // Mover buffer's contents fora dentro de a fresh Vec para o napi BBuffer
        // Keep o original allocation para o próximo batch.
        let take = std::mem::take(&mut self.buffer);
        self.buffer.reserve(take.capacity());
        tsfn.call(
            Ok(Buffer::from(take)),
            ThreadsafeFunctionCallMode::NonBlocking,
        );
        self.frames = 0;
        self.first_push_at = None;
    }
}

// ============================================================================
// SYSTEM AUDIO CAPTURE (CoreAudio Tap / ScreenCaptureKit em macOS)
// ============================================================================

#[napi]
pub struct SystemAudioCapture {
    stop_signal: Arc<AtomicBool>,
    capture_thread: Option<thread::JoinHandle<()>>,
    /// Shared atomic EMITTED sample rate — o rate de o PCM actually handed to
    /// JS/STT. Equals CANONICAL_STT_RATE (16000) quando o resampler é active,
    /// ou o native rate if resampler init failed (passthrough). Updated por o
    /// background thread uma vez o device + resampler são initialized.
    sample_rate: Arc<AtomicU32>,
    /// Shared atomic NATIVE hardware rate (e.g. 48000). Kept para diagnostics and
    /// HFP/Bluetooth-degradation detection — distinct de o emitted rate aacima
    native_sample_rate: Arc<AtomicU32>,
    device_id: Option<String>,
}

#[napi]
impl SystemAudioCapture {
    #[napi(constructor)]
    pub fn new(device_id: Option<String>) -> napi::Result<Self> {
        println!("[SystemAudioCapture] Created (device: {:?})", device_id);

        Ok(SystemAudioCapture {
            stop_signal: Arc::new(AtomicBool::new(false)),
            capture_thread: None,
            // Emitted rate é o canonical STT rate por default (resampler active).
            sample_rate: Arc::new(AtomicU32::new(CANONICAL_STT_RATE)),
            // Native default 48kHz (standard macOS CoreAudio rate) até o
            // background thread reports o real hardware rate.
            native_sample_rate: Arc::new(AtomicU32::new(48000)),
            device_id,
        })
    }

    /// EMITTED sample rate — o rate de o PCM handed to STT (16000 quando o
    /// resampler é active). This é o que callers precisa declare to STT providers.
    #[napi]
    pub fn get_sample_rate(&self) -> u32 {
        self.sample_rate.load(Ordering::Acquire)
    }

    /// NATIVE hardware sample rate (e.g. 48000) — para diagnostics and
    /// HFP/Bluetooth-degradation detection oapenas Não o rate de emitted bytes.
    #[napi]
    pub fn get_native_sample_rate(&self) -> u32 {
        self.native_sample_rate.load(Ordering::Acquire)
    }

    #[napi]
    pub fn start(
        &mut self,
        callback: ThreadsafeFunction<Buffer>,
        on_speech_ended: Option<ThreadsafeFunction<bool>>,
    ) -> napi::Result<()> {
        // Proteger contra double-start — previne spawning concurrent threads
        if self.capture_thread.is_some() {
            return Err(napi::Error::from_reason("Capture already running"));
        }

        let tsfn = callback;
        let speech_ended_tsfn = on_speech_ended;

        self.stop_signal.store(false, Ordering::SeqCst);
        let stop_signal = self.stop_signal.clone();
        let sample_rate_shared = self.sample_rate.clone();
        let native_rate_shared = self.native_sample_rate.clone();
        let device_id = self.device_id.clone();

        // Todos init + DSP executa em background thread — stinicia Retorna INSTANTLY
        self.capture_thread = Some(thread::spawn(move || {
            // 1. SpeakerInput Init (takes 5-7 seconds — executa Fora principal tthread
            println!("[SystemAudioCapture] Background init starting...");
            let input = match speaker::SpeakerInput::new(device_id.clone()) {
                Ok(i) => i,
                Err(e) => {
                    println!("[SystemAudioCapture] Init failed: {}. Trying default...", e);
                    match speaker::SpeakerInput::new(None) {
                        Ok(i) => i,
                        Err(e2) => {
                            let msg = format!(
                                "[SystemAudioCapture] FATAL: All init attempts failed: {}",
                                e2
                            );
                            eprintln!("{}", msg);
                            // Notifica JS então it pode emitir 'error' and reinicia isRecording
                            tsfn.call(
                                Err(napi::Error::from_reason(msg)),
                                ThreadsafeFunctionCallMode::NonBlocking,
                            );
                            return;
                        }
                    }
                }
            };

            let mut stream = match input.stream() {
                Ok(s) => s,
                Err(e) => {
                    let msg = format!(
                        "[SystemAudioCapture] FATAL: stream() failed: {}",
                        e
                    );
                    eprintln!("{}", msg);
                    tsfn.call(
                        Err(napi::Error::from_reason(msg)),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                    return;
                }
            };
            let mut consumer = match stream.take_consumer() {
                Some(c) => c,
                None => {
                    let msg = "[SystemAudioCapture] FATAL: Failed to get consumer".to_string();
                    eprintln!("{}", msg);
                    tsfn.call(
                        Err(napi::Error::from_reason(msg)),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                    return;
                }
            };

            let native_rate = stream.sample_rate();
            // Publish o real native hardware rate para diagnostics / HFP detection.
            native_rate_shared.store(native_rate, Ordering::Release);

            // Build o high-quality anti-aliased resampler (native -> 16kHz).
            // If native é já 16kHz, ou construction fails, fall voltar to
            // passthrough at o native rate então o DECLARED rate sempre matches
            // o bytes (a mismatch é o que produced garbled "chipmunk" STT).
            let mut resampler: Option<Resampler> = if native_rate == CANONICAL_STT_RATE {
                None
            } else {
                match Resampler::new(native_rate as f64) {
                    Ok(r) => Some(r),
                    Err(e) => {
                        eprintln!("[SystemAudioCapture] Resampler init failed ({}); passthrough at {}Hz", e, native_rate);
                        None
                    }
                }
            };
            // O emitted rate é 16kHz quando resampling, senão o native rate.
            let emitted_rate = if resampler.is_some() { CANONICAL_STT_RATE } else { native_rate };
            sample_rate_shared.store(emitted_rate, Ordering::Release);
            println!(
                "[SystemAudioCapture] Background init complete. Native: {}Hz, Emitted: {}Hz. DSP starting.",
                native_rate, emitted_rate
            );

            // 2. DSP loop com silence suppression + WebRTC VAD.
            // Suppressor operates em o EMITTED-rate sstream então its internal VAD
            // decimation é a no-op quando emitted_rate == 16000.
            let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
                native_sample_rate: emitted_rate,
                ..SilenceSuppressionConfig::for_system_audio()
            });

            // 20ms chunks at o EMITTED rate (320 samples at 16kHz).
            let chunk_size = (emitted_rate as usize / 1000) * 20;
            let mut frame_buffer: Vec<i16> = Vec::with_capacity(chunk_size * 4);
            let mut raw_batch: Vec<f32> = Vec::with_capacity(4096);
            // PERF: pre-allocated frame scratch (avoids per-chunk Vec alloc).
            let mut frame_scratch: Vec<i16> = Vec::with_capacity(chunk_size);
            // PERF: coalesce para cima to CHUNK_BATCH_COUNT frames dentro de one tsfn call.
            // Cuts V8 limite crossings 3× com não perceptible STT-side latency.
            let mut emitter = BatchEmitter::new(chunk_size * 2);

            loop {
                if stop_signal.load(Ordering::Relaxed) {
                    break;
                }

                // Drain Todos available samples de ring buffer (lock-free)
                while let Some(sample) = consumer.try_pop() {
                    raw_batch.push(sample);
                }

                // Resample (anti-aliased) to 16kHz então converte to i16, Ou converte
                // f32 -> i16 directly quando passthrough. O resampler já
                // Retorna 16kHz i16; passthrough scales f32 -> i16 at native rate.
                if !raw_batch.is_empty() {
                    match resampler.as_mut() {
                        Some(r) => match r.resample_to_i16(&raw_batch) {
                            Ok(out) => frame_buffer.extend_from_slice(&out),
                            Err(e) => eprintln!("[SystemAudioCapture] Resample error: {}", e),
                        },
                        None => {
                            for &f in &raw_batch {
                                let scaled = (f * 32767.0).clamp(-32768.0, 32767.0);
                                frame_buffer.push(scaled as i16);
                            }
                        }
                    }
                    raw_batch.clear();
                }

                // Processo em 20ms chunks através o two-stage gate
                while frame_buffer.len() >= chunk_size {
                    frame_scratch.clear();
                    frame_scratch.extend(frame_buffer.drain(0..chunk_size));

                    let (action, speech_ended) = suppressor.process(&frame_scratch);

                    match action {
                        FrameAction::Send(data) => {
                            let bytes = i16_slice_to_le_bytes(&data);
                            emitter.push(&bytes, &tsfn);
                        }
                        FrameAction::SendSilence => {
                            // Zero-filled bytes to keep streaming APIs alive.
                            let silence = vec![0u8; chunk_size * 2];
                            emitter.push(&silence, &tsfn);
                        }
                        FrameAction::Suppress => {
                            // Fazer nada — bandwidth saving. A pending partial
                            // batch pode age fora via o timeout verifica babaixo
                        }
                    }

                    // Fire speech_ended callback em o exact transition frame.
                    // Flush qualquer pending batch Primeiro então STT sees o trailing audio
                    // antes sendo told o utterance ended.
                    if speech_ended {
                        emitter.flush(&tsfn);
                        if let Some(ref se_tsfn) = speech_ended_tsfn {
                            se_tsfn.call(Ok(true), ThreadsafeFunctionCallMode::NonBlocking);
                        }
                    }
                }

                // Flush partial batch em timeout então trailing speech em light
                // traffic isn't held upara cima
                emitter.maybe_flush_timeout(&tsfn);

                // Keep o dormir pequeno então we rapidamente lê o ring buffer
                thread::sleep(Duration::from_millis(DSP_POLL_MS));
            }

            // Flush qualquer remaining batched audio antes exit.
            emitter.flush(&tsfn);
            println!("[SystemAudioCapture] DSP thread stopped.");
            // stream é dropped aqui → SpeakerStream::Drop calls stop_with_ch
        }));

        Ok(())
    }

    #[napi]
    pub fn stop(&mut self) {
        self.stop_signal.store(true, Ordering::SeqCst);
        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for SystemAudioCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

// ============================================================================
// MICROPHONE CAPTURE (CPAL)
//
// Design: O MicrophoneStream (CPAL hhandle é recreated em todo stinicia
// call. This guarantees o ring buffer consumidor é sempre fresh, allowing
// seamless stop→start restart cycles (e.g. entre meetings).
// ============================================================================

#[napi]
pub struct MicrophoneCapture {
    stop_signal: Arc<AtomicBool>,
    capture_thread: Option<thread::JoinHandle<()>>,
    /// Shared atomic EMITTED sample rate (16000 quando resampling, senão native).
    /// This é o que callers declare to STT providers.
    sample_rate: Arc<AtomicU32>,
    /// Shared atomic NATIVE hardware rate — diagnostics / HFP detection oapenas
    native_sample_rate: Arc<AtomicU32>,
    /// Armazena o requested device ID para recreation em restart.
    device_id: Option<String>,
    /// Holds o live CPAL sstream Recreated em cada stainicia
    input: Option<microphone::MicrophoneStream>,
}

#[napi]
impl MicrophoneCapture {
    #[napi(constructor)]
    pub fn new(device_id: Option<String>) -> napi::Result<Self> {
        // Eagerly cria o stream to detect device errors early and lê o
        // native sample rate.
        let input = match microphone::MicrophoneStream::new(device_id.clone()) {
            Ok(i) => i,
            Err(e) => return Err(napi::Error::from_reason(format!("Failed: {}", e))),
        };

        let native_rate = input.sample_rate();
        println!(
            "[MicrophoneCapture] Initialized. Device: {:?}, Rate: {}Hz",
            device_id, native_rate
        );

        // Emitted rate é canonical 16kHz a menos que native é já 16kHz.
        let emitted_rate = if native_rate == CANONICAL_STT_RATE { native_rate } else { CANONICAL_STT_RATE };

        Ok(MicrophoneCapture {
            stop_signal: Arc::new(AtomicBool::new(false)),
            capture_thread: None,
            sample_rate: Arc::new(AtomicU32::new(emitted_rate)),
            native_sample_rate: Arc::new(AtomicU32::new(native_rate)),
            device_id,
            input: Some(input),
        })
    }

    /// EMITTED sample rate — o rate de o PCM handed to STT (16000 quando o
    /// resampler é active). Declare THIS to STT providers.
    #[napi]
    pub fn get_sample_rate(&self) -> u32 {
        self.sample_rate.load(Ordering::Acquire)
    }

    /// NATIVE hardware rate (e.g. 24000 para AirPods HFP, 48000 built-in) — para
    /// diagnostics and HFP/Bluetooth-degradation detection oapenas
    #[napi]
    pub fn get_native_sample_rate(&self) -> u32 {
        self.native_sample_rate.load(Ordering::Acquire)
    }

    #[napi]
    pub fn start(
        &mut self,
        callback: ThreadsafeFunction<Buffer>,
        on_speech_ended: Option<ThreadsafeFunction<bool>>,
    ) -> napi::Result<()> {
        let tsfn = callback;
        let speech_ended_tsfn = on_speech_ended;

        self.stop_signal.store(false, Ordering::SeqCst);
        let stop_signal = self.stop_signal.clone();

        // If o stream era consumed por a anterior stinicia cycle, recreate it.
        // This é o fix para o one-shot take_consumer() bug.
        if self.input.is_none() {
            println!("[MicrophoneCapture] Recreating CPAL stream for restart...");
            match microphone::MicrophoneStream::new(self.device_id.clone()) {
                Ok(i) => {
                    let rate = i.sample_rate();
                    self.native_sample_rate.store(rate, Ordering::Release);
                    let emitted = if rate == CANONICAL_STT_RATE { rate } else { CANONICAL_STT_RATE };
                    self.sample_rate.store(emitted, Ordering::Release);
                    self.input = Some(i);
                }
                Err(e) => {
                    return Err(napi::Error::from_reason(format!(
                        "[MicrophoneCapture] Failed to recreate stream: {}",
                        e
                    )));
                }
            }
        }

        let input_ref = self
            .input
            .as_mut()
            .ok_or_else(|| napi::Error::from_reason("Input missing"))?;

        input_ref
            .play()
            .map_err(|e| napi::Error::from_reason(format!("{}", e)))?;

        let native_rate = input_ref.sample_rate();
        self.native_sample_rate.store(native_rate, Ordering::Release);

        let mut consumer = input_ref
            .take_consumer()
            .ok_or_else(|| napi::Error::from_reason("Failed to get consumer"))?;

        // Hand o DSP thread a clone de o err_signal então we pode surface
        // CPAL callback-thread errors (USB unplug, device rreinicia exclusive-
        // modo steal) to o JS layer em vez disso de apenas logging to stderr.
        let err_signal = input_ref.err_signal();

        // DSP thread com silence suppression + WebRTC VAD
        self.capture_thread = Some(thread::spawn(move || {
            // Anti-aliased resampler native -> 16kHz. Passthrough if native é
            // já 16kHz ou construction fails (declared rate sempre matches
            // o bytes — a mismatch é o que produced garbled STT).
            let mut resampler: Option<Resampler> = if native_rate == CANONICAL_STT_RATE {
                None
            } else {
                match Resampler::new(native_rate as f64) {
                    Ok(r) => Some(r),
                    Err(e) => {
                        eprintln!("[MicrophoneCapture] Resampler init failed ({}); passthrough at {}Hz", e, native_rate);
                        None
                    }
                }
            };
            let emitted_rate = if resampler.is_some() { CANONICAL_STT_RATE } else { native_rate };

            let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
                native_sample_rate: emitted_rate,
                ..SilenceSuppressionConfig::for_microphone()
            });

            // 20ms chunks at o EMITTED rate (320 samples at 16kHz).
            let chunk_size = (emitted_rate as usize / 1000) * 20;
            let mut frame_buffer: Vec<i16> = Vec::with_capacity(chunk_size * 4);
            let mut raw_batch: Vec<f32> = Vec::with_capacity(4096);
            // PERF: pre-allocated scratch — see SystemAudioCapture para rationale.
            let mut frame_scratch: Vec<i16> = Vec::with_capacity(chunk_size);
            // PERF: coalesce para cima to CHUNK_BATCH_COUNT frames dentro de one tsfn call.
            let mut emitter = BatchEmitter::new(chunk_size * 2);

            println!("[MicrophoneCapture] DSP thread started (VAD + suppression active, native={}Hz, emitted={}Hz, chunk={})", native_rate, emitted_rate, chunk_size);

            loop {
                if stop_signal.load(Ordering::Relaxed) {
                    break;
                }

                // Surface qualquer callback-thread error to JS exatamente ouma vez Após
                // reporting, we keep looping então a subsequente device recovery
                // (e.g. user re-plugged o USB mic) é ainda observed via o
                // ringbuf — mas main.ts vai tipicamente destroy + recreate this
                // capture em receiving o error. Flush qualquer batched audio primeiro
                // então partial trailing speech reaches STT antes o error eevento
                if let Ok(mut slot) = err_signal.lock() {
                    if let Some(msg) = slot.take() {
                        let full = format!("[MicrophoneCapture] CPAL error: {}", msg);
                        eprintln!("{}", full);
                        emitter.flush(&tsfn);
                        tsfn.call(
                            Err(napi::Error::from_reason(full)),
                            ThreadsafeFunctionCallMode::NonBlocking,
                        );
                    }
                }

                // 1. Drain Todos available samples de ring buffer (lock-free)
                while let Some(sample) = consumer.try_pop() {
                    raw_batch.push(sample);
                }

                // 2. Resample (anti-aliased) to 16kHz então i16, Ou converte
                // f32 -> i16 directly quando passthrough.
                if !raw_batch.is_empty() {
                    match resampler.as_mut() {
                        Some(r) => match r.resample_to_i16(&raw_batch) {
                            Ok(out) => frame_buffer.extend_from_slice(&out),
                            Err(e) => eprintln!("[MicrophoneCapture] Resample error: {}", e),
                        },
                        None => {
                            for &f in &raw_batch {
                                let scaled = (f * 32767.0).clamp(-32768.0, 32767.0);
                                frame_buffer.push(scaled as i16);
                            }
                        }
                    }
                    raw_batch.clear();
                }

                // 3. Processo em 20ms chunks através o two-stage gate
                while frame_buffer.len() >= chunk_size {
                    frame_scratch.clear();
                    frame_scratch.extend(frame_buffer.drain(0..chunk_size));

                    let (action, speech_ended) = suppressor.process(&frame_scratch);

                    match action {
                        FrameAction::Send(data) => {
                            let bytes = i16_slice_to_le_bytes(&data);
                            emitter.push(&bytes, &tsfn);
                        }
                        FrameAction::SendSilence => {
                            let silence = vec![0u8; chunk_size * 2];
                            emitter.push(&silence, &tsfn);
                        }
                        FrameAction::Suppress => {
                            // Fazer nada — partial batch pode age fora via timeout.
                        }
                    }

                    if speech_ended {
                        emitter.flush(&tsfn);
                        if let Some(ref se_tsfn) = speech_ended_tsfn {
                            se_tsfn.call(Ok(true), ThreadsafeFunctionCallMode::NonBlocking);
                        }
                    }
                }

                emitter.maybe_flush_timeout(&tsfn);

                // 4. Curto dormir
                thread::sleep(Duration::from_millis(DSP_POLL_MS));
            }

            emitter.flush(&tsfn);
            println!("[MicrophoneCapture] DSP thread stopped.");
        }));

        Ok(())
    }

    #[napi]
    pub fn stop(&mut self) {
        self.stop_signal.store(true, Ordering::SeqCst);
        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
        // Pausar and destroy o CPAL stream então stinicia recreates it fresh.
        if let Some(ref input) = self.input {
            let _ = input.pause();
        }
        self.input = None;
    }
}

impl Drop for MicrophoneCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

// ============================================================================
// DEVICE ENUMERATION
// ============================================================================

#[napi(object)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
}

#[napi]
pub fn get_input_devices() -> Vec<AudioDeviceInfo> {
    match microphone::list_input_devices() {
        Ok(devs) => devs
            .into_iter()
            .map(|(id, name)| AudioDeviceInfo { id, name })
            .collect(),
        Err(e) => {
            eprintln!("[get_input_devices] Error: {}", e);
            Vec::new()
        }
    }
}

#[napi]
pub fn get_output_devices() -> Vec<AudioDeviceInfo> {
    match speaker::list_output_devices() {
        Ok(devs) => devs
            .into_iter()
            .map(|(id, name)| AudioDeviceInfo { id, name })
            .collect(),
        Err(e) => {
            eprintln!("[get_output_devices] Error: {}", e);
            Vec::new()
        }
    }
}

/// Retorna o platform-native ID de o current default saída device.
/// macOS: CoreAudio device UID. Windows: WASAPI device id (eMultimedia/eConsole role).
/// Empty string em error ou unsupported pplataforma
///
/// JS polls this todo poucos seconds durante an active meeting; quando o valor
/// changes, main.ts recreates SystemAudioCapture então o CoreAudio Tap follows
/// o new saída rrotea Sem this, switching saída devices mid-meeting
/// (plug em headphones, trocar AirPods, rotea to virtual cable) leaves o tap
/// bound to o original device, capturing silence.
#[napi]
pub fn get_default_output_device_id() -> String {
    speaker::default_output_device_uid()
}
