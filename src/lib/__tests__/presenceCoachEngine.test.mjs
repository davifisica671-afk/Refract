// Suíte do motor Presence Coach — roda via `npm run test:renderer`
// (node --test "src/lib/__tests__/**/*.test.mjs"). Sem app, sem áudio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceCoachEngine } from '../presenceCoachEngine.mjs';

const seg = (speaker, text, timestamp, final = true) => ({ speaker, text, timestamp, final });
const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

// ── fala/escuta + monólogo ─────────────────────────────────────────────────
test('fala/escuta acumula duração estimada por falante (400ms/palavra)', () => {
  const e = createPresenceCoachEngine({ lang: 'pt' });
  e.ingest(seg('user', words(15), 1000));
  e.ingest(seg('interviewer', words(5), 8000));
  const s = e.snapshot();
  assert.equal(s.talk.userMs, 6000);
  assert.equal(s.talk.otherMs, 2000);
  assert.equal(s.talk.userPct, 75);
});

test('segmentos parciais (final=false) são ignorados', () => {
  const e = createPresenceCoachEngine();
  e.ingest(seg('user', words(10), 1000, false));
  assert.equal(e.snapshot().talk.userMs, 0);
});

test('maior monólogo soma falas consecutivas e zera quando o outro fala', () => {
  const e = createPresenceCoachEngine();
  e.ingest(seg('user', words(9), 1000));
  e.ingest(seg('user', words(9), 5000));
  e.ingest(seg('interviewer', words(3), 10000));
  e.ingest(seg('user', words(2), 12000));
  assert.equal(e.snapshot().maxMonologueMs, 7200);
});

test('reset limpa o estado', () => {
  const e = createPresenceCoachEngine();
  e.ingest(seg('user', words(5), 1000));
  e.reset();
  assert.equal(e.snapshot().talk.userMs, 0);
});

// ── ritmo ───────────────────────────────────────────────────────────────────
test('ritmo = palavras suas na janela de 20s → wpm', () => {
  let clock = 0;
  const e = createPresenceCoachEngine({ now: () => clock });
  clock = 20000;
  e.ingest(seg('user', words(60), 5000));
  assert.equal(e.snapshot().paceWpm, 180);
  clock = 45000;
  assert.equal(e.snapshot().paceWpm, 0);
});

// ── vícios ──────────────────────────────────────────────────────────────────
test('vícios PT contados nos segmentos do usuário', () => {
  const e = createPresenceCoachEngine({ lang: 'pt' });
  e.ingest(seg('user', 'então tipo eu acho né que tipo funciona', 1000));
  const f = e.snapshot().fillers;
  assert.equal(f.byWord['tipo'], 2);
  assert.equal(f.byWord['então'], 1);
  assert.equal(f.byWord['né'], 1);
  assert.equal(f.total, 4);
});

test('vícios EN e frase composta "you know"', () => {
  const e = createPresenceCoachEngine({ lang: 'en' });
  e.ingest(seg('user', 'um I think you know like it works', 1000));
  const f = e.snapshot().fillers;
  assert.equal(f.byWord['um'], 1);
  assert.equal(f.byWord['you know'], 1);
  assert.equal(f.byWord['like'], 1);
  assert.equal(f.total, 3);
});

test('idioma desconhecido → vícios desligados', () => {
  const e = createPresenceCoachEngine({ lang: 'fr' });
  e.ingest(seg('user', 'tipo tipo um like', 1000));
  assert.equal(e.snapshot().fillers.total, 0);
});

test('só conta vícios do usuário, não do interlocutor', () => {
  const e = createPresenceCoachEngine({ lang: 'pt' });
  e.ingest(seg('interviewer', 'tipo tipo tipo', 1000));
  assert.equal(e.snapshot().fillers.total, 0);
});

// ── interrupções ─────────────────────────────────────────────────────────────
test('interrupção: usuário começa antes do fim estimado da fala do outro', () => {
  const e = createPresenceCoachEngine();
  e.ingest(seg('interviewer', words(10), 1000));
  e.ingest(seg('user', words(3), 3000));
  assert.equal(e.snapshot().interruptions, 1);
});

test('fala após o outro terminar não é interrupção', () => {
  const e = createPresenceCoachEngine();
  e.ingest(seg('interviewer', words(10), 1000));
  e.ingest(seg('user', words(3), 6000));
  assert.equal(e.snapshot().interruptions, 0);
});

test('falas suas consecutivas não contam múltiplas interrupções', () => {
  const e = createPresenceCoachEngine();
  e.ingest(seg('interviewer', words(10), 1000));
  e.ingest(seg('user', words(2), 3000));
  e.ingest(seg('user', words(2), 3800));
  assert.equal(e.snapshot().interruptions, 1);
});

// ── nudges ────────────────────────────────────────────────────────────────────
test('nudge de monólogo dispara após 60s falando, respeitando warmup', () => {
  let clock = 0;
  const e = createPresenceCoachEngine({ now: () => clock });
  clock = 61000;
  e.ingest(seg('user', words(155), 1000));
  const n = e.drainNudges();
  assert.ok(n.some((x) => x.type === 'monologue'));
  assert.deepEqual(e.drainNudges(), []);
});

test('cooldown suprime um segundo nudge dentro de 45s', () => {
  let clock = 61000;
  const e = createPresenceCoachEngine({ now: () => clock });
  e.ingest(seg('user', words(155), 1000));
  e.drainNudges();
  clock = 70000;
  e.ingest(seg('user', words(200), 62000));
  assert.deepEqual(e.drainNudges(), []);
});

test('sem nudge antes do warmup (30s)', () => {
  let clock = 10000;
  const e = createPresenceCoachEngine({ now: () => clock });
  e.ingest(seg('user', words(155), 500));
  assert.deepEqual(e.drainNudges(), []);
});

test('nudge de monólogo NÃO repete depois que o outro fala (usa run atual, não o máximo)', () => {
  let clock = 0;
  const e = createPresenceCoachEngine({ now: () => clock });
  clock = 61000;
  e.ingest(seg('user', words(155), 1000));          // dispara monólogo (run ~62s)
  assert.ok(e.drainNudges().some((x) => x.type === 'monologue'));
  e.ingest(seg('interviewer', words(5), 62000));      // o outro fala → zera o run atual
  clock = 200000;                                      // bem além do cooldown
  e.ingest(seg('user', words(3), 150000));             // fala curta (run ~1.2s)
  const n = e.drainNudges();
  assert.ok(!n.some((x) => x.type === 'monologue'), 'monólogo não pode re-disparar pelo máximo histórico');
});
