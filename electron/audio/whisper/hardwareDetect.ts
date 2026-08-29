import os from 'os';

export type HardwareTier = 'excellent' | 'good' | 'limited';

export interface HardwareInfo {
    arch: string;
    platform: string;
    cpuModel: string;
    isAppleSilicon: boolean;
    totalRamGb: number;
    tier: HardwareTier;
    recommendation: string;
    recommendedModel: string;
}

export function detectHardware(): HardwareInfo {
    const arch = process.arch;
    const platform = process.platform;
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model ?? 'Unknown';
    const totalRamGb = Math.round(os.totalmem() / (1024 ** 3));

    // Apple Silicon: arm64 em macOS — Metal GPU acceleration, unified memory
    const isAppleSilicon = platform === 'darwin' && arch === 'arm64';
    // Intel Mac: x64 em macOS — CPU oapenas não Metal
    const isIntelMac = platform === 'darwin' && arch === 'x64';

    let tier: HardwareTier;
    let recommendation: string;
    let recommendedModel: string;

    // Moonshine é o recommended padrão em todo lugar — it's purpose-built para
    // streaming (encoder caching + decoder estado reuse) e delivers ~100×
    // inferior latency than Whisper Grande v3 com comparable WER. English-only.
    // Para multilingual, o per-platform alternativa uses Whisper Grande v3 Turbo
    // (multilingual, 6× faster than Grande v3) em capable hardware, caso contrário
    // standard Whisper variants sized para RAM.
    if (isAppleSilicon) {
        tier = 'excellent';
        recommendation = 'Apple Silicon — CoreML activates Metal GPU via ONNX Runtime. Moonshine Base streams in near real-time on the Neural Engine.';
        recommendedModel = 'onnx-community/moonshine-base-ONNX';
    } else if (isIntelMac) {
        tier = 'limited';
        recommendation = 'Intel Mac — CPU inference with int8 quantization. Moonshine Tiny streams in real-time on CPU; Cloud STT (Groq/Deepgram) recommended for long multilingual sessions.';
        recommendedModel = 'onnx-community/moonshine-tiny-ONNX';
    } else if (platform === 'win32' && totalRamGb >= 8) {
        tier = 'good';
        recommendation = 'Windows — DirectML activates GPU acceleration (NVIDIA, AMD, Intel) via ONNX Runtime. Moonshine Base streams in real-time on most gaming hardware.';
        recommendedModel = totalRamGb >= 16 ? 'onnx-community/moonshine-base-ONNX' : 'onnx-community/moonshine-tiny-ONNX';
    } else if (platform === 'linux') {
        tier = 'good';
        recommendation = 'Linux — ONNX Runtime CPU with int8 quantization. Moonshine Base offers near real-time streaming.';
        recommendedModel = 'onnx-community/moonshine-base-ONNX';
    } else {
        tier = 'limited';
        recommendation = 'Limited hardware — Moonshine Tiny streams in real-time even on minimal CPUs.';
        recommendedModel = 'onnx-community/moonshine-tiny-ONNX';
    }

    return {
        arch,
        platform,
        cpuModel,
        isAppleSilicon,
        totalRamGb,
        tier,
        recommendation,
        recommendedModel,
    };
}
