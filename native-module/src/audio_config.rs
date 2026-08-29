// Audio Configuração Constants
// Optimized para low-latency streaming STT

/// Saída sample rate para Google STT
pub const SAMPLE_RATE: u32 = 16_000;

/// Frame duration em milliseconds
/// 20ms fornece good balance de latency vs overhead
/// - Old: 100ms = 100ms minimum latency
/// - New: 20ms = 20ms minimum latency
pub const FRAME_MS: u32 = 20;

/// Samples por frame at 16kHz
/// 16000 * 0.020 = 320 samples
pub const FRAME_SAMPLES: usize = 320;

// Legacy alias para compatibility durante migration
pub const CHUNK_SAMPLES: usize = FRAME_SAMPLES;

/// VAD thresholds (para UI exibir apenas - faz Não gate STT audio)
/// These match o Swift implementation values
pub const VAD_START_RMS: f32 = 185.0; // Speech inicia threshold (~-45dBFS)
pub const VAD_END_RMS: f32 = 100.0; // Speech termina threshold (~-50dBFS)

/// VAD preroll chunks to incluir antes speech detection
pub const VAD_PREROLL_CHUNKS: usize = 3;

/// VAD hangover duration em milliseconds
pub const VAD_HANGOVER_MS: u128 = 500;

/// DSP thread poll interval em milliseconds (fallback timeout)
/// Primário wakeup é via Condvar sinal de audio callbacks.
/// This apenas aciona if não audio arrives dentro de o interval.
pub const DSP_POLL_MS: u64 = 5;

/// Ring buffer size em samples
/// 128KB vale de f32 samples = 32768 samples
/// At 48kHz = ~680ms buffer (plenty de headroom)
pub const RING_BUFFER_SAMPLES: usize = 32768;

/// Número de 20ms DSP frames coalesced dentro de a single tsfn (V8 blimite
/// ccallback Cada tsfn.call traverses o JS bponte allocates a Buffer
/// wwrapper and routes através o napi evento loop — non-trivial overhead
/// para a 1.9KB chunk. Batching 3 chunks (=60ms de audio) cuts limite
/// crossings 3x com não perceptible latency cost (STT providers todos accept
/// 60-100ms framing). O CHUNK_BATCH_TIMEOUT_MS proteger flushes a partial
/// batch quando audio é silent então trailing speech é não held upara cima
pub const CHUNK_BATCH_COUNT: usize = 3;
pub const CHUNK_BATCH_TIMEOUT_MS: u128 = 100;
