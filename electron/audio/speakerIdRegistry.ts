/**
 * =============================================================================
 * speakerIdRegistry.ts — IDs canônicos de locutor por reunião
 * =============================================================================
 *
 * Mapeia (canal de captura, índice de locutor do provedor) para um id canônico
 * `speaker_<n>` sem colisão.
 *
 * POR QUE ISSO EXISTE
 * -------------------
 * O Refract roda um stream de STT por canal de captura: microfone → "user",
 * áudio do sistema → "interviewer". Provedores com diarização numeram os
 * locutores por *conexão* (`speaker: 0`, `speaker: 1`, …), então:
 *
 *   1. A numeração recomeça em cada stream — inclusive após uma reconexão no
 *      meio da reunião, o que pode renumerar a mesma voz e dividir uma pessoa
 *      em dois rótulos.
 *   2. O canal do microfone e o canal do sistema têm CADA UM o seu speaker 0.
 *      Jogar esses números direto na transcrição faz o speaker 0 do microfone
 *      e o speaker 0 do sistema colapsarem num único "Speaker 1" — mesmo
 *      sendo duas pessoas diferentes.
 *
 * O registry chaveia por (canal, índice do provedor) e entrega ids no formato
 * `speaker_<n>` que `SpeakerLabelService`, `TranscriptNormalizer` e
 * `MeetingSummaryV3` já entendem. Nenhum código a jusante precisa mudar.
 *
 * REUNIÃO PRESENCIAL
 * ------------------
 * Em chamada remota o canal equivale ao locutor (mic = eu, sistema = eles) e
 * tudo funciona. Em reunião presencial NÃO existe canal de sistema: médico e
 * paciente dividem o mesmo microfone. Sem diarizar o microfone, os dois caem
 * no rótulo "Me". Com o registry, cada voz diarizada do microfone recebe seu
 * próprio `speaker_<n>` — que é o pré-requisito para os templates verticais
 * (SOAP, memo jurídico) fazerem sentido.
 * =============================================================================
 */

/** Canal de captura de áudio. O provedor numera locutores por stream, não por reunião. */
export type CaptureChannel = 'mic' | 'system';

/** Formato canônico que o resto do pipeline já entende (`speaker_1`, `speaker_2`, …). */
export type CanonicalSpeakerId = string;

const PROVIDER_ID_RE = /^speaker_(\d+)$/;

/**
 * Extrai o índice numérico de um id de locutor emitido pelo provedor.
 * Retorna undefined para ausência, formato inesperado ou índice inválido —
 * o chamador então simplesmente não emite speakerId, preservando o
 * comportamento do canal (me / Speaker 1).
 */
export function parseProviderSpeakerIndex(providerId?: string | null): number | undefined {
  if (typeof providerId !== 'string') return undefined;
  const m = PROVIDER_ID_RE.exec(providerId.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 0) return undefined;
  return n;
}

/**
 * Registry por reunião. Uma instância por reunião; chame `reset()` ao iniciar
 * uma nova para que a numeração não vaze entre reuniões.
 */
export class SpeakerIdRegistry {
  private readonly canonicalByKey = new Map<string, CanonicalSpeakerId>();
  private nextIndex = 1;

  /**
   * Resolve (canal, índice do provedor) para um id canônico estável.
   *
   * - Mesma (canal, índice) → sempre o mesmo id, inclusive após reconexão.
   * - Canais diferentes com o mesmo índice → ids DIFERENTES (sem colisão).
   */
  resolve(channel: CaptureChannel, providerIndex: number): CanonicalSpeakerId {
    const key = `${channel}:${providerIndex}`;
    const existing = this.canonicalByKey.get(key);
    if (existing) return existing;

    const assigned: CanonicalSpeakerId = `speaker_${this.nextIndex}`;
    this.nextIndex += 1;
    this.canonicalByKey.set(key, assigned);
    return assigned;
  }

  /**
   * Resolve o id de locutor de um segmento a partir do que o provedor informou.
   * Retorna undefined quando não há id utilizável — o chamador deve então omitir
   * o campo e deixar o canal determinar o rótulo.
   */
  resolveFromProviderId(
    channel: CaptureChannel,
    providerId?: string | null,
  ): CanonicalSpeakerId | undefined {
    const index = parseProviderSpeakerIndex(providerId);
    if (index === undefined) return undefined;
    return this.resolve(channel, index);
  }

  /** Quantos locutores distintos foram vistos nesta reunião. */
  get size(): number {
    return this.canonicalByKey.size;
  }

  /** Limpa o mapeamento. Chamado no início de cada reunião. */
  reset(): void {
    this.canonicalByKey.clear();
    this.nextIndex = 1;
  }

  /** Cópia do mapeamento (canal:índice → id canônico), para debug e testes. */
  snapshot(): Record<string, CanonicalSpeakerId> {
    return Object.fromEntries(this.canonicalByKey.entries());
  }
}

/**
 * Converte o rótulo de canal do main (`'interviewer' | 'user'`) em canal de captura.
 * `'interviewer'` é o áudio do sistema; `'user'` é o microfone.
 */
export function captureChannelFor(speaker: 'interviewer' | 'user'): CaptureChannel {
  return speaker === 'interviewer' ? 'system' : 'mic';
}
