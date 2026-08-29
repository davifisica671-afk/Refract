// Ported logic
use crate::audio_config::RING_BUFFER_SAMPLES;
use anyhow::Result;
use ringbuf::{
    traits::{Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::collections::VecDeque;
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;
use tracing::error;
use wasapi::{get_default_device, DeviceCollection, Direction, SampleType, ShareMode, WaveFormat};

struct WakerState {
    shutdown: bool,
}

pub struct SpeakerInput {
    device_id: Option<String>,
}

pub struct SpeakerStream {
    consumer: Option<HeapCons<f32>>,
    waker_state: Arc<Mutex<WakerState>>,
    capture_thread: Option<thread::JoinHandle<()>>,
    actual_sample_rate: u32,
    data_ready: Arc<(Mutex<bool>, Condvar)>,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        self.actual_sample_rate
    }

    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        self.consumer.take()
    }

    pub fn data_ready_signal(&self) -> Arc<(Mutex<bool>, Condvar)> {
        self.data_ready.clone()
    }
}

// LIMITATION: We atualmente apenas capture de o eMultimedia/eConsole default
// renderizar device (ou a user-specified id). Muitos VoIP apps (ZAmpliar Teams, Discord,
// Meet) rotea audio to o eCommunications default — que o user pode configura
// independently em Sound Settings. Loopback em o multimedia-default captures
// nada enquanto o meeting plays através o comms-default device. Adding
// eCommunications suportar exige raw windows-rs IMMDeviceEnumerator desde
// wasapi 0.13 tem não Role API. Tracked para follow-up.
fn find_device_by_id(direction: &Direction, device_id: &str) -> Option<wasapi::Device> {
    let collection = DeviceCollection::new(direction).ok()?;
    let count = collection.get_nbr_devices().ok()?;

    for i in 0..count {
        if let Ok(device) = collection.get_device_at_index(i) {
            if let Ok(id) = device.get_id() {
                if id == device_id {
                    return Some(device);
                }
            }
        }
    }
    None
}

pub fn list_output_devices() -> Result<Vec<(String, String)>> {
    let collection =
        DeviceCollection::new(&Direction::Render).map_err(|e| anyhow::anyhow!("{}", e))?;
    let count = collection
        .get_nbr_devices()
        .map_err(|e| anyhow::anyhow!("{}", e))?;
    let mut list = Vec::new();

    for i in 0..count {
        if let Ok(device) = collection.get_device_at_index(i) {
            let id = device.get_id().unwrap_or_default();
            let name = device.get_friendlyname().unwrap_or_default();
            if !id.is_empty() {
                list.push((id, name));
            }
        }
    }
    Ok(list)
}

/// Retorna o WASAPI device id de o current default renderizar device em o
/// eMultimedia/eConsole role, ou empty string em failure. JS polls this então o
/// SystemAudioCapture follows o user's saída rotea quando they trocar
/// devices mid-meeting. Note: this ainda doesn't track o eCommunications
/// role separately (a known limitation tracked em find_device_by_id).
pub fn default_output_device_uid() -> String {
    match get_default_device(&Direction::Render) {
        Ok(dev) => dev.get_id().unwrap_or_default(),
        Err(_) => String::new(),
    }
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        let device_id = device_id.filter(|id| !id.is_empty() && id != "default");
        Ok(Self { device_id })
    }

    /// Spawn o WASAPI capture thread and aguardar para it to report its real
    /// sample rate. Retorna Err if init fails ou times ofora então callers pode
    /// surface o failure to JS em vez disso de silently degrading to a fake
    /// stream that produces zero samples.
    pub fn stream(self) -> Result<SpeakerStream> {
        let rb = HeapRb::<f32>::new(RING_BUFFER_SAMPLES);
        let (producer, consumer) = rb.split();

        let waker_state = Arc::new(Mutex::new(WakerState { shutdown: false }));
        let data_ready = Arc::new((Mutex::new(false), Condvar::new()));
        let (init_tx, init_rx) = mpsc::channel();

        let waker_clone = waker_state.clone();
        let data_ready_clone = data_ready.clone();
        let device_id = self.device_id;

        let capture_thread = thread::spawn(move || {
            if let Err(e) = Self::capture_audio_loop(
                producer,
                waker_clone,
                data_ready_clone,
                init_tx,
                device_id,
            ) {
                error!("Audio capture loop failed: {}", e);
            }
        });

        let actual_sample_rate = match init_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(rate)) => rate,
            Ok(Err(e)) => {
                // Init failed. Tear abaixo o thread we apenas spawned (it'll exit
                // em its próprio desde capture_audio_loop já returned), então
                // bubble o error para cima to lib.rs que calls tsfn.call(Err(...)).
                if let Ok(mut state) = waker_state.lock() {
                    state.shutdown = true;
                }
                let _ = capture_thread.join();
                return Err(anyhow::anyhow!("WASAPI init failed: {}", e));
            }
            Err(_) => {
                if let Ok(mut state) = waker_state.lock() {
                    state.shutdown = true;
                }
                let _ = capture_thread.join();
                return Err(anyhow::anyhow!(
                    "WASAPI init timed out after 5s (no default render device, or device busy in exclusive mode)"
                ));
            }
        };

        Ok(SpeakerStream {
            consumer: Some(consumer),
            waker_state,
            capture_thread: Some(capture_thread),
            actual_sample_rate,
            data_ready,
        })
    }

    fn capture_audio_loop(
        mut producer: HeapProd<f32>,
        waker_state: Arc<Mutex<WakerState>>,
        data_ready: Arc<(Mutex<bool>, Condvar)>,
        init_tx: mpsc::Sender<Result<u32>>,
        device_id: Option<String>,
    ) -> Result<()> {
        let init_result = (|| -> Result<_> {
            // Resolve alvo renderizar device. If o saved device_id é stale
            // (unplugged, renamed, fresh install com leftover settings) we
            // precisa Não panic — fall através to o default. If até that
            // errors, propagate via ? então init_tx surfaces o failure to JS
            // em vez disso de letting o thread die silently and leaving callers
            // com a fake 44100Hz stream that nunca produces samples.
            let device = match device_id.as_deref() {
                Some(id) if !id.is_empty() => match find_device_by_id(&Direction::Render, id) {
                    Some(d) => d,
                    None => get_default_device(&Direction::Render)
                        .map_err(|e| anyhow::anyhow!("device '{}' not found and default lookup failed: {}", id, e))?,
                },
                _ => get_default_device(&Direction::Render)
                    .map_err(|e| anyhow::anyhow!("default render device unavailable: {}", e))?,
            };

            let mut audio_client = device
                .get_iaudioclient()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            let device_format = audio_client
                .get_mixformat()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            let actual_rate = device_format.get_samplespersec();
            let desired_format =
                WaveFormat::new(32, 32, &SampleType::Float, actual_rate as usize, 1, None);

            let (_def_time, min_time) = audio_client
                .get_periods()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            // Para WASAPI loopback: device=Render, mas inicializa com Direction::Capture
            // This aciona AUDCLNT_STREAMFLAGS_LOOPBACK flag em wasapi
            audio_client
                .initialize_client(
                    &desired_format,
                    min_time,
                    &Direction::Capture,
                    &ShareMode::Shared,
                    true,
                )
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            let h_event = audio_client
                .set_get_eventhandle()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            let render_client = audio_client
                .get_audiocaptureclient()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            audio_client
                .start_stream()
                .map_err(|e| anyhow::anyhow!("{}", e))?;

            Ok((h_event, render_client, actual_rate, audio_client))
        })();

        match init_result {
            Ok((h_event, render_client, sample_rate, audio_client)) => {
                let _ = init_tx.send(Ok(sample_rate));
                loop {
                    {
                        let state = waker_state.lock().unwrap();
                        if state.shutdown {
                            let _ = audio_client.stop_stream();
                            break;
                        }
                    }

                    // Timeout é normal quando não audio é playing — WASAPI loopback
                    // doesn't fire events durante silence. Apenas continue waiting.
                    if h_event.wait_for_event(3000).is_err() {
                        continue;
                    }

                    let mut temp_queue = VecDeque::new();
                    // bytes_per_frame para 32-bit flutuante mono = 4 bytes
                    let bytes_per_frame: usize = 4; // 32-bit fflutuante 1 channel
                    if let Err(e) =
                        render_client.read_from_device_to_deque(bytes_per_frame, &mut temp_queue)
                    {
                        error!("Failed to read audio data: {}", e);
                        continue;
                    }

                    if temp_queue.is_empty() {
                        continue;
                    }

                    let mut samples = Vec::with_capacity(temp_queue.len() / 4);
                    while temp_queue.len() >= 4 {
                        let bytes = [
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                            temp_queue.pop_front().unwrap(),
                        ];
                        let sample = f32::from_le_bytes(bytes);
                        samples.push(sample);
                    }

                    if !samples.is_empty() {
                        let _ = producer.push_slice(&samples);

                        // Sinal data ready
                        let (lock, cvar) = &*data_ready;
                        let mut ready = lock.lock().unwrap();
                        *ready = true;
                        cvar.notify_all();
                    }
                }
            }
            Err(e) => {
                let _ = init_tx.send(Err(e));
            }
        }
        Ok(())
    }
}

// Implementa Soltar to para o thread
impl Drop for SpeakerStream {
    fn drop(&mut self) {
        if let Ok(mut state) = self.waker_state.lock() {
            state.shutdown = true;
        }
        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
    }
}
