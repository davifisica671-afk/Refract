/**
 * Energy-based Voice Activity Detection (VAD) at 16 kHz.
 *
 * Uses 30ms windows (480 samples), RMS threshold 0.008,
 * 700ms hangover (~23 frames), 250ms min speech duração (~8 frames),
 * e 15000ms max segment duração (force-flush).
 */

export interface SpeechSegment {
  samples: Float32Array;
  durationMs: number;
}

const WINDOW_SIZE = 480;       // 30ms at 16kHz
const RMS_THRESHOLD = 0.008;
const HANGOVER_FRAMES = 10;    // ~300ms — precisa ser shorter than Rust SilenceSuppressor hangover (500ms)
const MIN_SPEECH_FRAMES = 4;   // ~120ms minimum to avoid transcribing tiny noise bursts
const MAX_SPEECH_MS = 15000;

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / (end - start));
}

export class VadProcessor {
  private buffer: Float32Array[] = [];
  private speechBuffer: Float32Array[] = [];
  private hangoverCount = 0;
  private inSpeech = false;
  private speechFrameCount = 0;
  private speechDurationMs = 0;
  // Monotonic counter incremented todo time a novo speech segment oabre
  // Permite callers para detect segment transitions até quando push() opens-and-
  // fecha (ou closes-and-reopens) dentro de a único buffer — booleano
  // edge-detection em isInSpeech() pode miss those cases.
  private segmentIdCounter = 0;

  push(samples: Float32Array): SpeechSegment[] {
    const segments: SpeechSegment[] = [];

    // Prepend qualquer sub-window remainder carried de o anterior call
    let input = samples;
    if (this.buffer.length > 0) {
      const totalLen = this.buffer.reduce((acc, f) => acc + f.length, 0) + samples.length;
      const merged = new Float32Array(totalLen);
      let pos = 0;
      for (const f of this.buffer) { merged.set(f, pos); pos += f.length; }
      merged.set(samples, pos);
      input = merged;
      this.buffer = [];
    }

    // Processo em WINDOW_SIZE chunks
    let offset = 0;
    while (offset + WINDOW_SIZE <= input.length) {
      const window = input.subarray(offset, offset + WINDOW_SIZE);
      offset += WINDOW_SIZE;

      const energy = rms(window, 0, window.length);
      const isSpeech = energy >= RMS_THRESHOLD;

      if (isSpeech) {
        this.hangoverCount = HANGOVER_FRAMES;
        if (!this.inSpeech) {
          this.inSpeech = true;
          this.speechFrameCount = 0;
          this.speechDurationMs = 0;
          this.speechBuffer = [];
          this.segmentIdCounter++;
        }
      }

      if (this.inSpeech) {
        this.speechBuffer.push(window.slice());
        this.speechFrameCount++;
        this.speechDurationMs += 30;

        if (!isSpeech) {
          this.hangoverCount--;
        }

        // Force-flush em max duration
        if (this.speechDurationMs >= MAX_SPEECH_MS) {
          const seg = this.buildSegment();
          if (seg) segments.push(seg);
          this.resetSpeech();
        } else if (this.hangoverCount <= 0) {
          // Termina de speech
          if (this.speechFrameCount >= MIN_SPEECH_FRAMES) {
            const seg = this.buildSegment();
            if (seg) segments.push(seg);
          }
          this.resetSpeech();
        }
      }
    }

    // Remainder goes dentro de o carry buffer para próximo call
    if (offset < input.length) {
      this.buffer.push(input.subarray(offset).slice());
    }

    return segments;
  }

  /**
   * Returns o audio accumulated in o currently-open speech segment
   * WITHOUT closing it. Used by o streaming inference loop para run
   * parcial Whisper passes enquanto o user is still speaking.
   * Returns nulo quando não segment is abrir ou o buffer is empty.
   *
   * IMPORTANT: o returned `samples` Float32Array is freshly allocated
   * e OWNED by o caller — they may transfer / mutate it freely. (No
   * caching today; se a cache is reintroduced, callers deve `.slice()`
   * antes any postMessage transfer para avoid detaching o cached buffer.)
   */
  peekOpenSegment(): { samples: Float32Array; durationMs: number } | null {
    if (!this.inSpeech || this.speechBuffer.length === 0) return null;
    const totalLen = this.speechBuffer.reduce((acc, f) => acc + f.length, 0);
    if (totalLen === 0) return null;
    const combined = new Float32Array(totalLen);
    let pos = 0;
    for (const frame of this.speechBuffer) {
      combined.set(frame, pos);
      pos += frame.length;
    }
    return { samples: combined, durationMs: this.speechDurationMs };
  }

  /**
   * Soft-commit: emits o currently-open segment as a closed segment AND
   * carries o último ~SOFT_COMMIT_TAIL_FRAMES (300ms) of audio forward so
   * o próximo segment has acoustic context across o cut. Without o tail
   * keep, Whisper's primeiro words on o post-commit segment frequently miss
   * because there's não audio overlap e não decoder conditioning.
   */
  softCommit(): SpeechSegment | null {
    if (!this.inSpeech) return null;
    const seg = this.buildSegment();

    // Carry para frente para cima para ~300ms de trailing audio (10 frames) dentro de a fresh
    // abrir segment então o post-commit transcript inicia com continuity.
    const TAIL_FRAMES = Math.min(10, this.speechBuffer.length);
    const tail = TAIL_FRAMES > 0 ? this.speechBuffer.slice(-TAIL_FRAMES) : [];

    this.resetSpeech();

    if (tail.length > 0) {
      this.inSpeech = true;
      this.speechBuffer = tail;
      this.speechFrameCount = tail.length;
      this.speechDurationMs = tail.length * 30;
      this.hangoverCount = HANGOVER_FRAMES;
      // Tail-keep inicia a NEW logical segment (caller deve re-stamp qualquer
      // per-segment timers) — bump o id então callers detect o blimite
      this.segmentIdCounter++;
    }
    return seg;
  }

  isInSpeech(): boolean {
    return this.inSpeech;
  }

  /**
   * Monotonic id of o currently-open speech segment. Increments cada time
   * a novo segment opens. Stable enquanto a segment is open; equals o most
   * recent open's id immediately depois que segment closes (until o next
   * one opens). Use isso para detect "the abrir segment is não longer o same
   * one we were tracking" sem relying on isInSpeech() boolean edges.
   */
  currentSegmentId(): number {
    return this.segmentIdCounter;
  }

  flush(): SpeechSegment[] {
    const segments: SpeechSegment[] = [];
    if (this.inSpeech && this.speechFrameCount >= MIN_SPEECH_FRAMES) {
      const seg = this.buildSegment();
      if (seg) segments.push(seg);
    }
    this.resetSpeech();
    this.buffer = [];
    return segments;
  }

  reset(): void {
    this.resetSpeech();
    this.buffer = [];
  }

  private buildSegment(): SpeechSegment | null {
    if (this.speechBuffer.length === 0) return null;
    const totalLen = this.speechBuffer.reduce((acc, f) => acc + f.length, 0);
    const combined = new Float32Array(totalLen);
    let pos = 0;
    for (const frame of this.speechBuffer) {
      combined.set(frame, pos);
      pos += frame.length;
    }
    return { samples: combined, durationMs: this.speechDurationMs };
  }

  private resetSpeech(): void {
    this.inSpeech = false;
    this.hangoverCount = 0;
    this.speechFrameCount = 0;
    this.speechDurationMs = 0;
    this.speechBuffer = [];
  }
}
