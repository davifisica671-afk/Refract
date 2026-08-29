/**
 * audioResampler — Conversor de taxa de amostragem de áudio para Whisper
 *
 * Converte um buffer de amostras PCM Int16LE de qualquer taxa de entrada
 * para Float32Array a 16 kHz utilizando interpolação linear.
 * Não possui dependências externas.
 */
export function resampleToF32(chunk: Buffer, inputSampleRate: number): Float32Array {
  const TARGET_RATE = 16000;

  // Analisa Int16LE samples de o buffer
  const inputSamples = chunk.byteLength / 2; // 2 bytes por Int16 sample
  const input = new Float32Array(inputSamples);
  for (let i = 0; i < inputSamples; i++) {
    // Normalizar Int16 para [-1, 1]
    input[i] = chunk.readInt16LE(i * 2) / 32768.0;
  }

  if (inputSampleRate === TARGET_RATE) {
    return input;
  }

  const ratio = inputSampleRate / TARGET_RATE;
  const outputLength = Math.round(inputSamples / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;

    const s0 = input[srcIdx] ?? 0;
    const s1 = input[srcIdx + 1] ?? s0;
    output[i] = s0 + frac * (s1 - s0);
  }

  return output;
}
