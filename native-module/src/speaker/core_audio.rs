use anyhow::Result;
use ca::aggregate_device_keys as agg_keys;
use cidre::{api, arc, av, cat, cf, core_audio as ca, ns, os};
use ringbuf::{
    traits::{Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

fn strip_audio_suffix(s: &str) -> &str {
    s.strip_suffix(":output")
        .or_else(|| s.strip_suffix(":input"))
        .unwrap_or(s)
}

struct Ctx {
    format: arc::R<av::AudioFormat>,
    producer: HeapProd<f32>,
    channels: u32,
    current_sample_rate: Arc<AtomicU32>,
}

pub struct SpeakerInput {
    tap: ca::TapGuard,
    device: Option<ca::hardware::StartedDevice<ca::AggregateDevice>>,
    _ctx: Box<Ctx>,
    consumer: Option<HeapCons<f32>>,
    current_sample_rate: Arc<AtomicU32>,
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        // 0. Gate em macOS 14.4+. -[CATapDescription initExcludingProcesses:andDeviceUID:withStream:]
        // era introduced em macOS 14.4 (Sonoma). O class si mesmo exists de 14.2, então
        // [CATapDescription alloc] succeeds em 14.2/14.3 mas invoking this initializer lá
        // throws `unrecognized selector` and tears abaixo o processo antes nosso Err pode acionar
        // o SCK fallback em macos.rs. See issue #249.
        let pi = ns::ProcessInfo::current();
        if !pi.is_os_at_least_version(api::OsVersion {
            major: 14,
            minor: 4,
            patch: 0,
        }) {
            return Err(anyhow::anyhow!(
                "CoreAudio process tap requires macOS 14.4+ (current OS lacks initExcludingProcesses:andDeviceUID:withStream:)"
            ));
        }

        // 1. Encontra o alvo saída device
        let output_device = match device_id {
            Some(ref uid) if !uid.is_empty() && uid != "default" => {
                let requested_uid = strip_audio_suffix(uid);
                let devices = ca::System::devices()?;
                match devices.into_iter().find(|d| {
                    d.uid()
                        .map(|u| strip_audio_suffix(&u.to_string()).eq_ignore_ascii_case(requested_uid))
                        .unwrap_or(false)
                }) {
                    Some(device) => device,
                    None => {
                        println!(
                            "[CoreAudioTap] Requested output UID '{}' not found; falling back to default output device",
                            uid
                        );
                        ca::System::default_output_device()?
                    }
                }
            }
            _ => ca::System::default_output_device()?,
        };

        let output_uid = output_device.uid()?;
        println!("[CoreAudioTap] Target device UID: {}", output_uid);
        let output_uid_ns = ns::String::with_str(&output_uid.to_string());

        // 2. Cria a device-scoped tap com explicit mute behavior.
        // Binding o tap to o saída UID avoids o agregar device starting
        // successfully enquanto o tap si mesmo apenas recebe zero-filled buffers.
        // Apple's default é Unmuted mas alguns macOS versions ter shipped com
        // inconsistent defaults — define it explicitly to match AudioCap rreferência
        let mut tap_desc = ca::TapDesc::alloc().init_excluding_processes_and_device(
            &ns::Array::new(),
            &output_uid_ns,
            0,
        );
        tap_desc.set_mono(true);
        tap_desc.set_mixdown(true);
        // -[CATapDescription setMuteBehavior:] shipped em o mesmo macOS 14.4 release como
        // o device-bound init aacima Don't divide this de o 14.4 gate at o top de new().
        tap_desc.set_mute_behavior(ca::TapMuteBehavior::Unmuted);
        let tap = tap_desc.create_process_tap()?;
        println!("[CoreAudioTap] Tap created: {:?}", tap.uid());

        let sub_tap = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[tap.uid().unwrap().as_type_ref()],
        );

        // 3. Cria agregar device descriptor.
        // CoreAudio apenas accepts `main_sub_device` quando o mesmo UID é também present em
        // `sub_device_list`; caso contrário HAL silently leaves o principal sub-device empty
        // and o tap pode inicia sem producing entrada buffers.
        let agg_name = cf::String::from_str("RefractSystemAudioTap");
        let agg_uid = cf::Uuid::new().to_cf_string();

        let sub_device = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[output_uid.as_type_ref()],
        );
        let sub_device_arr = cf::ArrayOf::from_slice(&[sub_device.as_ref()]);
        let sub_tap_arr = cf::ArrayOf::from_slice(&[sub_tap.as_ref()]);

        let agg_desc = cf::DictionaryOf::with_keys_values(
            &[
                agg_keys::is_private(),
                agg_keys::is_stacked(),
                agg_keys::tap_auto_start(),
                agg_keys::name(),
                agg_keys::main_sub_device(),
                agg_keys::uid(),
                agg_keys::sub_device_list(),
                agg_keys::tap_list(),
            ],
            &[
                cf::Boolean::value_true().as_type_ref(),
                cf::Boolean::value_false().as_type_ref(),
                cf::Boolean::value_true().as_type_ref(),
                agg_name.as_type_ref(),
                output_uid.as_type_ref(),
                agg_uid.as_type_ref(),
                sub_device_arr.as_type_ref(),
                sub_tap_arr.as_type_ref(),
            ],
        );

        let asbd = tap
            .asbd()
            .map_err(|_| anyhow::anyhow!("Failed to get ASBD from tap"))?;
        let format = av::AudioFormat::with_asbd(&asbd).unwrap();
        let channels = asbd.channels_per_frame;
        println!(
            "[CoreAudioTap] Format: {}Hz, {}ch",
            asbd.sample_rate, channels
        );

        let buffer_size = 1024 * 128;
        let rb = HeapRb::<f32>::new(buffer_size);
        let (producer, consumer) = rb.split();

        let current_sample_rate = Arc::new(AtomicU32::new(asbd.sample_rate as u32));

        let mut ctx = Box::new(Ctx {
            format,
            producer,
            channels,
            current_sample_rate: current_sample_rate.clone(),
        });

        let agg_device = ca::AggregateDevice::with_desc(&agg_desc)?;

        let proc_id = agg_device.create_io_proc_id(proc, Some(&mut *ctx))?;
        let started_device = ca::device_start(agg_device, Some(proc_id))?;
        println!("[CoreAudioTap] Aggregate device started successfully");

        // We agora retorna o completamente started device dentro Ok.
        // If qualquer coisa acima fails, it yields an Err(), triggering SCK fallback smoothly!
        Ok(Self {
            tap,
            device: Some(started_device),
            _ctx: ctx,
            consumer: Some(consumer),
            current_sample_rate,
        })
    }

    pub fn stream(self) -> Result<SpeakerStream> {
        Ok(SpeakerStream {
            consumer: self.consumer,
            _device: self.device,
            _ctx: self._ctx,
            _tap: self.tap,
            current_sample_rate: self.current_sample_rate,
        })
    }
}

extern "C" fn proc(
    _device: ca::Device,
    _now: &cat::AudioTimeStamp,
    input_data: &cat::AudioBufList<1>,
    _input_time: &cat::AudioTimeStamp,
    _output_data: &mut cat::AudioBufList<1>,
    _output_time: &cat::AudioTimeStamp,
    ctx: Option<&mut Ctx>,
) -> os::Status {
    let ctx = ctx.unwrap();

    // BUGFIX: Fazer Não sobrescrever com o overall agregar device actual_sample_rate().
    // O macOS Global Processo Tap forces o actual input_data buffer to operate strictly
    // at o ASBD formata rate (geralmente 48000Hz). Telling JS o clock é running at 16k/24kHz
    // (AirPods HFP) causes STT to processo 48kHz arrays at 24kHz speed (deep demom voice).
    // O ASBD formata é o Apenas fonte de truth para o buffer layout!
    ctx.current_sample_rate
        .store(ctx.format.absd().sample_rate as u32, Ordering::Release);

    let _channels = ctx.channels;

    if let Some(view) = av::AudioPcmBuf::with_buf_list_no_copy(&ctx.format, input_data, None) {
        if let Some(data) = view.data_f32_at(0) {
            let buffer_channels = input_data.buffers[0].number_channels;
            let actual_ch = buffer_channels.max(1);
            push_audio(ctx, data, actual_ch);
        }
    } else if ctx.format.common_format() == av::audio::CommonFormat::PcmF32 {
        let first_buffer = &input_data.buffers[0];
        let byte_count = first_buffer.data_bytes_size as usize;
        let float_count = byte_count / std::mem::size_of::<f32>();

        if float_count > 0 && !first_buffer.data.is_null() {
            let data =
                unsafe { std::slice::from_raw_parts(first_buffer.data as *const f32, float_count) };

            let buffer_channels = first_buffer.number_channels;
            let actual_ch = buffer_channels.max(1);

            push_audio(ctx, data, actual_ch);
        }
    }

    os::Status::NO_ERR
}

#[inline(always)]
fn push_audio(ctx: &mut Ctx, data: &[f32], channels: u32) {
    if channels <= 1 {
        let _pushed = ctx.producer.push_slice(data);
    } else {
        let ch = channels as usize;
        let frame_count = data.len() / ch;
        for i in 0..frame_count {
            let base = i * ch;
            let mut sum: f32 = 0.0;
            for c in 0..ch {
                sum += data[base + c];
            }
            let mono = sum / channels as f32;
            let _ = ctx.producer.try_push(mono);
        }
    }
}

pub struct SpeakerStream {
    consumer: Option<HeapCons<f32>>,
    _device: Option<ca::hardware::StartedDevice<ca::AggregateDevice>>,
    _ctx: Box<Ctx>,
    _tap: ca::TapGuard,
    current_sample_rate: Arc<AtomicU32>,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        self.current_sample_rate.load(Ordering::Acquire)
    }

    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        self.consumer.take()
    }

    /// Pausar o agregar device sem destroying it.
    /// Permite fast restart sem o 1-segundo audio mute.
    /// NOTE: This é a one-way operação para CoreAudio — reretomar é não supported.
    pub fn pause(&mut self) {
        self._device = None;
        println!("[CoreAudioTap] Device paused (aggregate device preserved in HAL)");
    }

    /// Retomar é não supported para CoreAudio agregar devices — they precisa ser completamente recreated.
    /// Callers deve detect this and recreate o SpeakerInput/SpeakerStream.
    pub fn resume(&mut self) -> Result<()> {
        if self._device.is_none() {
            println!(
                "[CoreAudioTap] Resume not supported — aggregate device needs full recreation"
            );
            return Err(anyhow::anyhow!(
                "CoreAudio aggregate device resume not supported — recreate required"
            ));
        }
        Ok(())
    }
}

impl Drop for SpeakerStream {
    fn drop(&mut self) {
        // `_device` é stopped quando dropped — qualquer um por explicit `pause()` (que define it to NNenhum
        // ou quando `SpeakerStream` si mesmo é destroyed. Não explicit teardown needed.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression testar para issue #249: pins o runtime version-gate contract.
    /// `OsVersion::at_least()` resolves via `__isPlatformVersionAtLeast`, então this também proves
    /// that o C entrypoint é linked and o compile-time `cidre::api` surface used por
    /// `SpeakerInput::new` é wired correctly. Testar host é macOS 14.4+ (Darwin 25.x).
    #[test]
    fn os_version_gate_resolves_macos_14_4_on_modern_hosts() {
        // 14.4 precisa ser reported verdadeiro em a modern host (14.4+). If this flips, o gate é broken.
        assert!(
            api::OsVersion {
                major: 14,
                minor: 4,
                patch: 0
            }
            .at_least(),
            "macOS 14.4 should report at_least() == true on a >=14.4 host"
        );
    }

    /// Inverse direction: a fictitious far-future macOS precisa report false. Proves we
    /// aren't accidentally short-circuiting to always-true.
    #[test]
    fn os_version_gate_rejects_future_version() {
        assert!(
            !api::OsVersion {
                major: 99,
                minor: 0,
                patch: 0
            }
            .at_least(),
            "macOS 99.0 must not report at_least() == true"
        );
    }

    /// Mesmo contract via ProcessInfo (o API actually chamado de SpeakerInput::new).
    /// Locks em that o cidre selector binding matches Foundation's
    /// -[NSProcessInfo isOperatingSystemAtLeastVersion:] em this host.
    #[test]
    fn process_info_is_os_at_least_14_4_on_modern_hosts() {
        let pi = ns::ProcessInfo::current();
        assert!(
            pi.is_os_at_least_version(api::OsVersion {
                major: 14,
                minor: 4,
                patch: 0
            }),
            "ProcessInfo.isOperatingSystemAtLeastVersion(14.4) must be true on a >=14.4 host"
        );
        assert!(
            !pi.is_os_at_least_version(api::OsVersion {
                major: 99,
                minor: 0,
                patch: 0
            }),
            "ProcessInfo.isOperatingSystemAtLeastVersion(99.0) must be false"
        );
    }
}
