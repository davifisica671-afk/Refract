// removed unused anyhow::Result

#[cfg(target_os = "macos")]
mod core_audio;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "macos")]
mod sck;
#[cfg(target_os = "macos")]
pub use macos::list_output_devices;
#[cfg(target_os = "macos")]
pub use macos::SpeakerInput;
#[cfg(target_os = "macos")]
pub use macos::SpeakerStream;
#[cfg(target_os = "macos")]
pub use sck::default_output_device_uid;

#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
pub use windows::list_output_devices;
#[cfg(target_os = "windows")]
pub use windows::SpeakerInput;
#[cfg(target_os = "windows")]
pub use windows::SpeakerStream;
#[cfg(target_os = "windows")]
pub use windows::default_output_device_uid;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub mod fallback {
    // Stub implementation para Linux (and qualquer outro unsupported plplataforma
    // O system-audio capture pipeline é macOS/Windows apenas — `new()` sempre
    // Retorna an error, então `stream()` / `pause()` eetc são nunca reached at
    // runtime. These stubs exist apenas então o rest de o crate (lib.rs) ainda
    // type-checks em Linux em vez disso de failing com E0599 em `.stream()` calls.
    // See issue #219.
    use anyhow::Result;
    use ringbuf::HeapCons;
    pub struct SpeakerInput;
    pub struct SpeakerStream;
    impl SpeakerInput {
        pub fn new(_device_id: Option<String>) -> Result<Self> {
            Err(anyhow::anyhow!("Unsupported platform: system audio capture is implemented for macOS and Windows only"))
        }
        pub fn stream(self) -> Result<SpeakerStream> {
            Err(anyhow::anyhow!("Unsupported platform"))
        }
        pub fn sample_rate(&self) -> u32 {
            unreachable!("SpeakerInput::new() always errors on this platform")
        }
        pub fn pause(&mut self) -> Result<()> {
            unreachable!("SpeakerInput::new() always errors on this platform")
        }
        pub fn resume(&mut self) -> Result<()> {
            unreachable!("SpeakerInput::new() always errors on this platform")
        }
    }
    impl SpeakerStream {
        pub fn sample_rate(&self) -> u32 {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
        pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
        pub fn pause(&mut self) {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
        pub fn resume(&mut self) -> Result<()> {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
    }

    pub fn list_output_devices() -> Result<Vec<(String, String)>> {
        Ok(Vec::new())
    }

    pub fn default_output_device_uid() -> String {
        String::new()
    }
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use fallback::list_output_devices;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use fallback::SpeakerInput;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use fallback::SpeakerStream;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use fallback::default_output_device_uid;
