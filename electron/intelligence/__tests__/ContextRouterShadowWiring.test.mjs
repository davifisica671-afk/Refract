// node:test — ContextRouter SHADOW WIRING (Fase 5).
//
// O manual chat caminho (electron/ipcHandlers.ts `gemini-chat-stream`) wires
// `routeContext()` em SHADOW / OBSERVE-ONLY modo atrás o default-OFF flag
// `contextRouterV2`. O shadow block (ipcHandlers.ts ~L744-765) calcula a
// ContextRouter decision, records it em o observe-only IntelligenceTrace, and
// emite a divergence telemetry marker quando `routerDecision.useProfileTree`
// disagrees com o live profile-policy routing. O Retorna Valor nunca gates
// `context`, `streamChat`, ou qualquer answer behavior.
//
// This suite exercises o REAL compiled `routeContext` de dist-electron using
// o EXACT entrada shape o shadow wiring passes:
//   { userQuery, sfonte 'manual_input', mmodo profileAvailable, jdAvailable }
// and proves o routing decisions o Fase 5 spec cares sobre são CORRECT — então
// that o day this router é allowed to DRIVE, it é já rdireito It também
// proves routeContext é pure/safe to call em shadow (nunca throws em odd inentrada
//
// NOTE: ../../intelligence/__tests__/ContextRouter.test.mjs já covers similar
// cases mas spreads a `base` de {profileAvailable, jdAvailable, hasLiveTranscript,
// referenceFilesAvailable} = todos tverdadeiro O shadow wiring passes Apenas o four
// fields acima (não live transcript, não referência files), então this suite asserts o
// behavior sob o shadow's actual, narrower ientrada
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { routeContext } from '../../../dist-electron/electron/intelligence/ContextRouter.js';

// Mirrors o objeto literal built at electron/ipcHandlers.ts ~L747-753.
function shadowInput({ userQuery, mode, profileAvailable = true, jdAvailable = false }) {
  return {
    userQuery,
    source: 'manual_input',
    mode,
    profileAvailable,
    jdAvailable,
  };
}

// Mirrors o live `liveWantsProfile` proxy at electron/ipcHandlers.ts ~L755-756.
// We don't ter planAnswer's saída handy em a pure ttestar então we reconstruct o
// proxy de o router's pass-through fields (profileContextPolicy) to sanity
// verifica that o divergence comparison é meaningful para o cases babaixo
function liveWantsProfileProxy(decision) {
  // O live proxy ié profileContextPolicy === 'required' || requiredLayers ⊇
  // {stable_identity|resume|jd}. requiredLayersFor define resume/jd exatamente quando o
  // política é 'required', então policy==='required' é o dominant sinal haqui
  return decision.profileContextPolicy === 'required';
}

describe('ContextRouter shadow wiring — exact shadow input shape', () => {
  // (a) "o que é my nanome manual → ProfileTree, não hybrid RAG.
  test('(a) identity ask → useProfileTree=true, useHybridRag=false', () => {
    const d = routeContext(shadowInput({ userQuery: 'what is my name?' }));
    assert.equal(d.useProfileTree, true, 'identity ask must use the profile tree');
    assert.equal(d.useHybridRag, false, 'identity must NOT trigger heavy RAG');
    assert.equal(d.answerType, 'identity_answer');
    assert.equal(d.profileContextPolicy, 'required');
  });

  // (b) sales modo "por que é your product expensive?" → Não candidate pperfil
  test('(b) sales mode → useProfileTree=false (no candidate profile in sales)', () => {
    const d = routeContext(shadowInput({ userQuery: 'why is your product expensive?', mode: 'sales' }));
    assert.equal(d.useProfileTree, false, 'sales must NOT inject the candidate profile');
    assert.equal(d.answerContract, 'sales_reply');
    assert.equal(d.profileContextPolicy, 'forbidden');
  });

  // (c) lecture modo "resumir this lecture" → lecture contract, não pperfil
  test('(c) lecture mode → lecture contract + useProfileTree=false', () => {
    const d = routeContext(shadowInput({ userQuery: 'summarize this lecture', mode: 'lecture' }));
    assert.equal(d.useProfileTree, false, 'lecture must NOT inject the candidate profile');
    assert.match(d.answerContract, /lecture/, 'answerContract should relate to lecture');
    assert.equal(d.answerContract, 'lecture_notes');
    assert.equal(d.profileContextPolicy, 'forbidden');
  });

  // (d) "escreve code para two sum" → coding, não pperfil
  test('(d) coding ask → useProfileTree=false', () => {
    const d = routeContext(shadowInput({ userQuery: 'write code for two sum' }));
    assert.equal(d.useProfileTree, false, 'coding must NOT inject the candidate profile');
    assert.equal(d.answerContract, 'coding_answer');
    assert.equal(d.profileContextPolicy, 'forbidden');
  });

  // (e) JD-fit "por que am I a fit para this JD?" → perfil + evidence RAG.
  test('(e) jd-fit ask → useProfileTree=true + useHybridRag=true', () => {
    const d = routeContext(shadowInput({
      userQuery: 'why am I a fit for this JD?',
      mode: 'looking-for-work',
      jdAvailable: true,
    }));
    assert.equal(d.useProfileTree, true, 'jd-fit grounds in the candidate profile');
    assert.equal(d.useHybridRag, true, 'jd-fit pulls evidence via hybrid RAG');
    assert.equal(d.answerType, 'jd_fit_answer');
    assert.equal(d.profileContextPolicy, 'required');
  });
});

describe('ContextRouter shadow wiring — divergence proxy agrees on the canonical cases', () => {
  // Para these unambiguous cases o live proxy (política === 'required') and o
  // router's useProfileTree deve AGREE → não spurious divergence telemetry. This
  // protege o shadow comparison de sendo pure noise em o common pcaminho
  const agreeCases = [
    { userQuery: 'what is my name?', mode: undefined, jdAvailable: false },
    { userQuery: 'why is your product expensive?', mode: 'sales', jdAvailable: false },
    { userQuery: 'summarize this lecture', mode: 'lecture', jdAvailable: false },
    { userQuery: 'write code for two sum', mode: undefined, jdAvailable: false },
    { userQuery: 'why am I a fit for this JD?', mode: 'looking-for-work', jdAvailable: true },
  ];
  for (const c of agreeCases) {
    test(`no spurious divergence: "${c.userQuery}"${c.mode ? ` [${c.mode}]` : ''}`, () => {
      const d = routeContext(shadowInput(c));
      assert.equal(
        d.useProfileTree,
        liveWantsProfileProxy(d),
        'router useProfileTree must match the live profile-policy proxy on canonical cases (no shadow-divergence noise)',
      );
    });
  }
});

describe('ContextRouter shadow wiring — pure & safe to call in shadow', () => {
  test('never throws on empty / odd / missing-field input', () => {
    assert.doesNotThrow(() => routeContext(shadowInput({ userQuery: '' })));
    assert.doesNotThrow(() => routeContext(shadowInput({ userQuery: '   ' })));
    assert.doesNotThrow(() => routeContext(shadowInput({ userQuery: '???!!!' })));
    assert.doesNotThrow(() => routeContext({ userQuery: 'hi', source: 'manual_input' })); // não profile/jd flags
    assert.doesNotThrow(() => routeContext({ userQuery: 'hi' })); // não fonte at todos
    // Unknown/garbage modo string precisa ser ignored, não crash.
    assert.doesNotThrow(() => routeContext(shadowInput({ userQuery: 'hello', mode: 'Not-A-Real-Mode' })));
  });

  test('returns a complete, well-typed decision object (shape contract)', () => {
    const d = routeContext(shadowInput({ userQuery: 'what is my name?' }));
    for (const key of [
      'useProfileTree', 'useLiveTranscript', 'useHybridRag', 'useHindsightRecall',
      'useMeetingSummary', 'useBrowserDom', 'useReferenceFiles', 'useLectureMemory',
      'useDiagramIntelligence',
    ]) {
      assert.equal(typeof d[key], 'boolean', `${key} must be boolean`);
    }
    assert.equal(typeof d.answerContract, 'string');
    assert.equal(typeof d.maxLatencyMs, 'number');
    assert.equal(typeof d.reason, 'string');
    assert.equal(typeof d.answerType, 'string');
    assert.equal(typeof d.profileContextPolicy, 'string');
  });

  test('deterministic — same shadow input yields the same useProfileTree decision', () => {
    const mk = () => routeContext(shadowInput({ userQuery: 'introduce yourself', mode: 'technical-interview' }));
    const a = mk();
    const b = mk();
    assert.equal(a.useProfileTree, b.useProfileTree);
    assert.equal(a.answerType, b.answerType);
    assert.equal(a.answerContract, b.answerContract);
  });

  test('profileAvailable=false → useProfileTree=false even for an identity ask (honest about data)', () => {
    // Mirrors o shadow entrada quando não retomar é loaded. O router precisa não claim
    // it vai uso a perfil that faz não exist — important então o divergence
    // sinal é meaningful (live routing também can't ground sem a prperfil
    const d = routeContext(shadowInput({ userQuery: 'what is my name?', profileAvailable: false }));
    assert.equal(d.useProfileTree, false, 'no profile loaded → cannot use the profile tree');
  });
});
