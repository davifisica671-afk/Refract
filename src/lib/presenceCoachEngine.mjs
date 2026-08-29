// Motor puro do Presence Coach — coach de comunicação ao vivo, 100% local.
// Recebe segmentos de transcript e devolve métricas + nudges. Sem React,
// sem Electron, sem I/O → testável com node:test (ver __tests__).
//
// Segmento: { speaker, text, timestamp, final }. speaker === 'user' = você;
// qualquer outro valor = o interlocutor. Só segmentos finais contam.

export const WORD_MS = 400;            // 150 wpm de referência p/ estimar duração
export const PACE_WINDOW_MS = 20000;   // janela deslizante do ritmo
export const NUDGE_COOLDOWN_MS = 45000;
export const WARMUP_MS = 30000;        // sem nudge antes disso

const FILLER_LISTS = {
  pt: ['tipo', 'né', 'então', 'éé', 'aham'],
  en: ['um', 'uh', 'like', 'you know'],
};

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}
function isUser(speaker) {
  return String(speaker || '').toLowerCase() === 'user';
}
function fillerLang(lang) {
  const l = String(lang || '').toLowerCase();
  if (l.startsWith('pt')) return 'pt';
  if (l.startsWith('en')) return 'en';
  return null;
}
// Limite de palavra unicode-aware (\b é ASCII e quebraria com acentos).
function fillerRegex(word) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}])${esc}(?![\\p{L}])`, 'giu');
}

export function createPresenceCoachEngine({ now = () => Date.now(), lang = 'pt' } = {}) {
  let userMs = 0, otherMs = 0, userRunMs = 0, maxMonologueMs = 0, firstAt = null;
  const userWordEvents = [];
  let lastOtherEndMs = -Infinity, lastSpeaker = null, interruptions = 0;
  const interruptionTimes = [];
  const nudgeQueue = [];
  let lastNudgeAt = -Infinity;

  const flang = fillerLang(lang);
  const fillerRegexes = flang ? FILLER_LISTS[flang].map((w) => [w, fillerRegex(w)]) : [];
  const fillerByWord = {};

  function paceWpm() {
    const cutoff = now() - PACE_WINDOW_MS;
    let sum = 0;
    for (const ev of userWordEvents) if (ev.t >= cutoff) sum += ev.words;
    return Math.round((sum / PACE_WINDOW_MS) * 60000);
  }

  function snapshot() {
    const total = userMs + otherMs;
    return {
      talk: { userMs, otherMs, userPct: total > 0 ? Math.round((userMs / total) * 100) : 0 },
      maxMonologueMs,
      paceWpm: paceWpm(),
      fillers: {
        total: Object.values(fillerByWord).reduce((a, b) => a + b, 0),
        byWord: { ...fillerByWord },
      },
      interruptions,
      elapsedMs: firstAt === null ? 0 : Math.max(0, now() - firstAt),
    };
  }

  function evaluateNudges() {
    const t = now();
    if (firstAt === null || t - firstAt < WARMUP_MS) return;
    if (t - lastNudgeAt < NUDGE_COOLDOWN_MS) return;
    const s = snapshot();
    let type = null;
    // Monólogo usa o RUN ATUAL (userRunMs), não o máximo histórico: senão, uma
    // vez que você passou de 60s ininterruptos, o nudge voltaria a cada cooldown
    // pelo resto da call mesmo já tendo passado a palavra.
    if (userRunMs > 60000) type = 'monologue';
    else if (s.paceWpm > 180) type = 'pace';
    else if (s.talk.userPct > 75 && s.elapsedMs > 180000) type = 'dominating';
    else if (interruptionTimes.filter((x) => t - x <= 120000).length >= 3) type = 'interrupting';
    if (type) { nudgeQueue.push({ type }); lastNudgeAt = t; }
  }

  function ingest(seg) {
    if (!seg || seg.final !== true) return;
    const n = wordCount(seg.text);
    if (n === 0) return;
    const dur = n * WORD_MS;
    const ts = seg.timestamp ?? now();
    if (firstAt === null) firstAt = ts;

    if (isUser(seg.speaker)) {
      if (lastSpeaker === 'other' && ts < lastOtherEndMs) {
        interruptions += 1;
        interruptionTimes.push(ts);
      }
      lastSpeaker = 'user';
      userMs += dur;
      userRunMs += dur;
      if (userRunMs > maxMonologueMs) maxMonologueMs = userRunMs;
      userWordEvents.push({ t: ts, words: n });
      for (const [w, re] of fillerRegexes) {
        const m = seg.text.match(re);
        if (m) fillerByWord[w] = (fillerByWord[w] || 0) + m.length;
      }
    } else {
      otherMs += dur;
      userRunMs = 0;
      lastOtherEndMs = ts + dur;
      lastSpeaker = 'other';
    }
    evaluateNudges();
  }

  function drainNudges() { return nudgeQueue.splice(0, nudgeQueue.length); }

  function reset() {
    userMs = otherMs = userRunMs = maxMonologueMs = 0;
    firstAt = null;
    userWordEvents.length = 0;
    lastOtherEndMs = -Infinity; lastSpeaker = null; interruptions = 0;
    interruptionTimes.length = 0;
    nudgeQueue.length = 0; lastNudgeAt = -Infinity;
    for (const k of Object.keys(fillerByWord)) delete fillerByWord[k];
  }

  return { ingest, snapshot, drainNudges, reset };
}
