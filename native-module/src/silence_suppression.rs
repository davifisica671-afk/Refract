// Silence Suppression para Streaming STT - Baixo Latency Optimized
//
// TWO-STAGE GATING:
// 1. RMS volume verifica (fast, catches obvious silence)
// 2. WebRTC VAD (ML-based, rejects non-speech noise como typing/dogs)
// Apenas if Ambos pass fazer we abrir o gate. This eliminates false taciona
//
// DESIGN PRINCIPLES:
// 1. Google STT exige timing continuity - nunca envia gaps
// 2. Durante silence, envia keepalive frames todo 100ms
// 3. Durante speech, envia Todos frames imediatamente com Não atrasar
// 4. Hangover é para cost savings oapenas Não para first-word accuracy
//
// LATENCY BUDGET:
// - Speech onset: 0ms atrasar (immediate)
// - Hangover: Apenas affects Após speech termina (não latency impact)

use std::time::{Duration, Instant};
use webrtc_vad::{SampleRate as VadSampleRate, Vad, VadMode};

/// Configuração para silence suppression
/// Optimized para baixo latency com adaptive threshold
pub struct SilenceSuppressionConfig {
    /// Initial RMS threshold para speech detection (i16 scale: 0-32767)
    /// Acts como starting vvalor adaptive tracking adjusts this sobre time.
    pub speech_threshold_rms: f32,

    /// Duration to continue sending completo audio após speech termina
    /// This faz Não adiciona latency - apenas affects quando we trocar to keepalives
    pub speech_hangover: Duration,

    /// Como frequentemente to envia a keepalive frame durante silence
    pub silence_keepalive_interval: Duration,

    /// Multiplier acima o noise floor EMA to detect speech (default: 3.0)
    pub adaptive_multiplier: f32,

    /// Minimum floor para o adaptive threshold (previne false aciona em dead silence)
    pub adaptive_min_floor: f32,

    /// EMA smoothing factor (0..1). Inferior = slower adaptation. Default 0.02.
    pub ema_alpha: f32,

    /// Native sample rate de o audio sendo processed (e.g. 48000)
    /// Used to calcula decimation ratio para 16kHz VAD ientrada
    pub native_sample_rate: u32,

    /// Se to uso ML-based WebRTC VAD em addition to o RMS volume gate.
    pub use_vad: bool,

    /// O strictness nível de o WebRTC VAD models.
    pub vad_mode: VadMode,
}

impl Default for SilenceSuppressionConfig {
    fn default() -> Self {
        Self {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(200),
            silence_keepalive_interval: Duration::from_millis(100),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 20.0,
            ema_alpha: 0.02,
            native_sample_rate: 48000,
            use_vad: true,
            vad_mode: VadMode::Quality,
        }
    }
}

impl SilenceSuppressionConfig {
    /// Cria config para system audio (muito permissive - system audio é quieter).
    /// Desabilita VAD porque system audio (e.g., YouTube, games) frequentemente contém non-human
    /// sounds que o ML VAD modelo rigidly suppresses, breaking o STT pipeline (#127).
    pub fn for_system_audio() -> Self {
        Self {
            speech_threshold_rms: 30.0,
            speech_hangover: Duration::from_millis(600), // increased de 300ms to preserve contexto através brief pauses
            silence_keepalive_interval: Duration::from_millis(100),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 10.0,
            ema_alpha: 0.02,
            native_sample_rate: 48000,
            use_vad: false,
            vad_mode: VadMode::Quality, // ignored quando use_vad é false
        }
    }

    /// Cria config para microphone (standard).
    /// Uses Normal VAD modo em vez disso de Aggressive porque built-in microphones com heavy
    /// hardware DSP (como macOS Apple Silicon) sound "unnatural" to strict models (#128).
    pub fn for_microphone() -> Self {
        Self {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(500), // increased de 150ms to prevenir clipping trailing consonants (s, t, eetc
            silence_keepalive_interval: Duration::from_millis(100),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 20.0,
            ema_alpha: 0.02,
            native_sample_rate: 48000,
            use_vad: true,
            vad_mode: VadMode::Quality,
        }
    }
}

/// Silence suppression estado machine com adaptive threshold + WebRTC VAD
pub struct SilenceSuppressor {
    config: SilenceSuppressionConfig,
    state: SuppressionState,
    last_speech_time: Instant,
    last_keepalive_time: Instant,
    frames_sent: u64,
    frames_suppressed: u64,
    /// Exponential moving average de ambient noise floor RMS
    noise_floor_ema: f32,
    /// Current adaptive speech threshold
    adaptive_threshold: f32,
    /// Tracks se we eram speaking em o anterior frame (para edge detection)
    was_speaking: bool,
    /// WebRTC Voice Activity Detector (ML-based, 16kHz)
    vad: Vad,
    /// Decimation factor: native_sample_rate / 16000 (pode ser non-integer, e.g. 44100/16000 = 2.75625)
    decimation_factor: f64,
    /// Reusable buffer para decimated 16kHz samples (avoids allocation por frame)
    vad_buf: Vec<i16>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum SuppressionState {
    Active,     // Speech detected, envia tudo
    Hangover,   // Speech ended rrecentemente ainda sending
    Suppressed, // Confirmed silence, envia keepalives apenas
}

/// Result de processing a frame
#[derive(Debug, Clone)]
pub enum FrameAction {
    /// Envia this frame to STT
    Send(Vec<i16>),
    /// Substituir com silence keepalive frame
    SendSilence,
    /// Suprimir this frame (timing maintained por keepalives)
    Suppress,
}

impl SilenceSuppressor {
    pub fn new(config: SilenceSuppressionConfig) -> Self {
        let now = Instant::now();
        let initial_threshold = config.speech_threshold_rms;
        let decimation_factor = config.native_sample_rate as f64 / 16000.0;

        // Reconstruct o VadMode variant to avoid partially moving `config` (desde VadMode isn't Copy)
        let mode_clone = match &config.vad_mode {
            VadMode::Quality => VadMode::Quality,
            VadMode::LowBitrate => VadMode::LowBitrate,
            VadMode::Aggressive => VadMode::Aggressive,
            VadMode::VeryAggressive => VadMode::VeryAggressive,
        };

        let vad_mode_str = match &config.vad_mode {
            VadMode::Quality => "Quality",
            VadMode::LowBitrate => "LowBitrate",
            VadMode::Aggressive => "Aggressive",
            VadMode::VeryAggressive => "VeryAggressive",
        };

        let vad = Vad::new_with_rate_and_mode(VadSampleRate::Rate16kHz, mode_clone);

        println!(
            "[SilenceSuppressor] Created: threshold={} (adaptive), hangover={}ms, \
             keepalive={}ms, native_rate={}Hz, decimation={:.2}x, use_vad={}, VAD_mode={}",
            config.speech_threshold_rms,
            config.speech_hangover.as_millis(),
            config.silence_keepalive_interval.as_millis(),
            config.native_sample_rate,
            decimation_factor,
            config.use_vad,
            vad_mode_str,
        );

        Self {
            noise_floor_ema: config.adaptive_min_floor,
            adaptive_threshold: initial_threshold,
            vad_buf: Vec::with_capacity(480), // Max VAD frame size at 16kHz (30ms)
            decimation_factor,
            vad,
            config,
            state: SuppressionState::Suppressed, // Precisa inicia suppressed to avoid false speech_ended em startup
            last_speech_time: now,
            last_keepalive_time: now,
            frames_sent: 0,
            frames_suppressed: 0,
            was_speaking: false, // Previne false edge detection imediatamente após init
        }
    }

    /// Processo a frame and determine o que to fazer com it.
    /// Retorna (FrameAction, speech_just_ended)
    /// `speech_just_ended` é verdadeiro em o exact frame onde speech transitions to silence.
    /// CRITICAL: Speech frames são Nunca delayed.
    ///
    /// O frame pode ser at Qualquer native sample rate. Internally, we decimate
    /// to 16kHz para o WebRTC VAD verifica oapenas
    pub fn process(&mut self, frame: &[i16]) -> (FrameAction, bool) {
        let now = Instant::now();
        let rms = calculate_rms(frame);

        // ── TWO-STAGE GATE ──────────────────────────────────────────────
        // Estágio 1: Fast RMS verifica (rejects obvious silence cheaply)
        // Estágio 2: WebRTC VAD (rejects non-speech noise: typing, dogs, fans)
        let has_speech = if rms >= self.adaptive_threshold {
            if self.config.use_vad {
                // Estágio 2: Decimate to 16kHz and executa ML-based voice detection
                self.is_voice(frame)
            } else {
                // RMS é alto enough and VAD é disabled (e.g. system audio)
                true
            }
        } else {
            false
        };

        // Sempre verifica para speech primeiro - immediate resposta
        if has_speech {
            self.state = SuppressionState::Active;
            self.last_speech_time = now;
            self.frames_sent += 1;
            self.was_speaking = true;
            return (FrameAction::Send(frame.to_vec()), false);
        }

        // Não speech detected - verifica estado
        let mut speech_just_ended = false;
        match self.state {
            SuppressionState::Active | SuppressionState::Hangover => {
                // Verifica if hangover period tem elapsed
                if now.duration_since(self.last_speech_time) > self.config.speech_hangover {
                    self.state = SuppressionState::Suppressed;
                    // Detect o edge: era speaking, agora suppressed
                    if self.was_speaking {
                        speech_just_ended = true;
                        self.was_speaking = false;
                    }
                    // Fall através to verifica keepalive
                } else {
                    // Ainda em hangover - envia completo frame
                    self.state = SuppressionState::Hangover;
                    self.frames_sent += 1;
                    return (FrameAction::Send(frame.to_vec()), false);
                }
            }
            SuppressionState::Suppressed => {
                // Já suppressed
            }
        }

        // Em suppressed estado - atualiza adaptive noise floor EMA
        // Apenas adapt durante confirmed silence to avoid tracking speech levels
        let alpha = self.config.ema_alpha;
        self.noise_floor_ema = self.noise_floor_ema * (1.0 - alpha) + rms * alpha;
        self.adaptive_threshold = (self.noise_floor_ema * self.config.adaptive_multiplier)
            .max(self.config.adaptive_min_floor);

        // Verifica if time para keepalive
        if now.duration_since(self.last_keepalive_time) >= self.config.silence_keepalive_interval {
            self.last_keepalive_time = now;
            self.frames_sent += 1;
            (FrameAction::SendSilence, speech_just_ended)
        } else {
            self.frames_suppressed += 1;
            (FrameAction::Suppress, speech_just_ended)
        }
    }

    /// Decimate o native-rate frame to ~16kHz and executa WebRTC VAD.
    /// WebRTC VAD exige exatamente 160/320/480 samples at 16kHz (10/20/30ms).
    /// We dynamically escolher o closest valid frame size based em o actual
    /// decimated sample count, handling non-integer ratios (e.g. 44.1kHz).
    #[inline]
    fn is_voice(&mut self, frame: &[i16]) -> bool {
        self.vad_buf.clear();

        // Decimate: take samples at 16kHz intervals using floating-point stepping.
        // This correctly gerencia non-integer ratios como 44100/16000 = 2.75625.
        let factor = self.decimation_factor;
        if factor <= 1.0 {
            // Native rate É 16kHz (ou linferior — uso frame directly
            self.vad_buf.extend_from_slice(frame);
        } else {
            let mut pos = 0.0_f64;
            while (pos as usize) < frame.len() {
                self.vad_buf.push(frame[pos as usize]);
                pos += factor;
            }
        }

        // WebRTC VAD accepts exatamente 160 (10ms), 320 (20ms), ou 480 (30ms) samples.
        // Escolher o largest valid size that fits nosso decimated data.
        let len = self.vad_buf.len();
        let target = if len >= 480 {
            480
        } else if len >= 320 {
            320
        } else if len >= 160 {
            160
        } else {
            // Frame também pequeno para VAD — fall voltar to RMS-only
            return true;
        };

        match self.vad.is_voice_segment(&self.vad_buf[..target]) {
            Ok(is_voice) => is_voice,
            Err(_) => {
                // Em VAD error, fall voltar to RMS-only (don't block audio)
                true
            }
        }
    }

    /// Obtém statistics
    pub fn stats(&self) -> (u64, u64) {
        (self.frames_sent, self.frames_suppressed)
    }

    /// Obtém current estado para UI
    pub fn is_speech(&self) -> bool {
        matches!(
            self.state,
            SuppressionState::Active | SuppressionState::Hangover
        )
    }

    /// Obtém o current adaptive speech threshold
    pub fn adaptive_threshold(&self) -> f32 {
        self.adaptive_threshold
    }

    /// Reinicia estado (e.g., quando meeting etermina
    pub fn reset(&mut self) {
        let now = Instant::now();
        self.state = SuppressionState::Suppressed; // Fix: reinicia to suppressed, mesmo como new()
        self.last_speech_time = now;
        self.last_keepalive_time = now;
        self.noise_floor_ema = self.config.adaptive_min_floor;
        self.adaptive_threshold = self.config.speech_threshold_rms;
        self.was_speaking = false;
    }
}

/// Calcula RMS de i16 samples efficiently
fn calculate_rms(samples: &[i16]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    // Sample todo 4th sample para speed (320/4 = 80 samples é plenty para RMS)
    let sum_of_squares: f64 = samples
        .iter()
        .step_by(4)
        .map(|&s| (s as f64) * (s as f64))
        .sum();

    let count = (samples.len() + 3) / 4;
    (sum_of_squares / count as f64).sqrt() as f32
}

/// Gera a silence frame de given size
pub fn generate_silence_frame(size: usize) -> Vec<i16> {
    vec![0i16; size]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_speech_immediate() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000, // Uso 16kHz para testar to avoid decimation issues
            ..SilenceSuppressionConfig::default()
        });

        // Loud frame deve ser sent imediatamente (alto amplitude sine-ish wave)
        let loud_frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16)
            .collect();
        let (action, ended) = suppressor.process(&loud_frame);
        assert!(matches!(action, FrameAction::Send(_)));
        assert!(!ended, "Speech should not have 'ended' on a loud frame");
        assert!(suppressor.is_speech());
    }

    #[test]
    fn test_silence_keepalive() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(0),
            silence_keepalive_interval: Duration::from_millis(50),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 20.0,
            ema_alpha: 0.02,
            native_sample_rate: 16000,
            use_vad: true,
            vad_mode: VadMode::Quality,
        });

        let silent_frame: Vec<i16> = vec![0; 320];
        let (action, _ended) = suppressor.process(&silent_frame);
        assert!(matches!(
            action,
            FrameAction::SendSilence | FrameAction::Suppress
        ));
    }

    #[test]
    fn test_speech_ended_detection() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(0),
            silence_keepalive_interval: Duration::from_millis(50),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 20.0,
            ema_alpha: 0.02,
            native_sample_rate: 16000,
            use_vad: true,
            vad_mode: VadMode::Quality,
        });

        // Envia a loud speech-like frame
        let loud_frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16)
            .collect();
        let (_, ended) = suppressor.process(&loud_frame);
        assert!(!ended, "Speech should not end on a loud frame");

        // Envia a silent frame (deve acionar speech_ended)
        let silent_frame: Vec<i16> = vec![0; 320];
        let (_, ended) = suppressor.process(&silent_frame);
        assert!(ended, "Speech should have ended on transition to silence");

        // Outro silent frame deve Não acionar speech_ended novamente
        let (_, ended) = suppressor.process(&silent_frame);
        assert!(!ended, "Speech_ended should only fire once per transition");
    }
}
