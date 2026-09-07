// electron/audio/__tests__/SpeakerIdRegistry.test.mjs
//
// Cobre o mapeamento (canal de captura, índice do provedor) -> id canônico.
//
// Os dois casos que REALMENTE importam aqui são os bugs que o registry existe
// para impedir:
//   1. colisão entre canais  — speaker_1 do microfone e speaker_1 do sistema são
//      pessoas diferentes e não podem virar um único "Speaker 1";
//   2. instabilidade na reconexão — a mesma voz não pode mudar de id no meio da
//      reunião só porque o stream reiniciou.
//
// Determinístico, sem rede, sem LLM. Roda contra dist-electron:
//   npm run build:electron && node --test electron/audio/__tests__/SpeakerIdRegistry.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SpeakerIdRegistry,
  parseProviderSpeakerIndex,
  captureChannelFor,
} from '../../../dist-electron/electron/audio/speakerIdRegistry.js';
import { isDiarizableSTT } from '../../../dist-electron/electron/audio/diarizableSTT.js';

describe('parseProviderSpeakerIndex', () => {
  test('extrai o índice de ids no formato do provedor', () => {
    assert.equal(parseProviderSpeakerIndex('speaker_1'), 1);
    assert.equal(parseProviderSpeakerIndex('speaker_2'), 2);
    assert.equal(parseProviderSpeakerIndex('speaker_17'), 17);
  });

  test('retorna undefined para entradas ausentes ou malformadas', () => {
    for (const bad of [undefined, null, '', '   ', 'speaker_', 'speaker_x', 'spk_1', '1', 'me', 'speaker_-1']) {
      assert.equal(parseProviderSpeakerIndex(bad), undefined, `esperava undefined para ${JSON.stringify(bad)}`);
    }
  });

  test('ignora espaços ao redor', () => {
    assert.equal(parseProviderSpeakerIndex('  speaker_3  '), 3);
  });
});

describe('SpeakerIdRegistry — estabilidade', () => {
  test('o mesmo (canal, índice) sempre resolve para o mesmo id', () => {
    const reg = new SpeakerIdRegistry();
    const first = reg.resolve('system', 0);
    // Simula uma reconexão: o provedor reenvia o mesmo índice num stream novo.
    const afterReconnect = reg.resolve('system', 0);
    assert.equal(first, afterReconnect, 'a mesma voz mudou de id após reconexão');
  });

  test('numeração começa em 1 e cresce por locutor novo', () => {
    const reg = new SpeakerIdRegistry();
    assert.equal(reg.resolve('system', 0), 'speaker_1');
    assert.equal(reg.resolve('system', 1), 'speaker_2');
    assert.equal(reg.resolve('system', 2), 'speaker_3');
    assert.equal(reg.size, 3);
  });

  test('índices não contíguos não deixam buracos na numeração canônica', () => {
    const reg = new SpeakerIdRegistry();
    assert.equal(reg.resolve('system', 0), 'speaker_1');
    assert.equal(reg.resolve('system', 7), 'speaker_2');
  });
});

describe('SpeakerIdRegistry — isolamento entre canais (bug da colisão)', () => {
  test('speaker_1 do microfone e speaker_1 do sistema são pessoas diferentes', () => {
    const reg = new SpeakerIdRegistry();
    const micFirst = reg.resolve('mic', 0);
    const sysFirst = reg.resolve('system', 0);
    assert.notEqual(micFirst, sysFirst, 'dois locutores distintos colapsaram num único id');
  });

  test('dois locutores por canal geram quatro ids distintos', () => {
    const reg = new SpeakerIdRegistry();
    const ids = [
      reg.resolve('mic', 0),
      reg.resolve('system', 0),
      reg.resolve('mic', 1),
      reg.resolve('system', 1),
    ];
    assert.equal(new Set(ids).size, 4, `esperava 4 ids distintos, obtive ${ids.join(', ')}`);
    assert.equal(reg.size, 4);
  });
});

describe('SpeakerIdRegistry — resolveFromProviderId', () => {
  test('resolve ids válidos', () => {
    const reg = new SpeakerIdRegistry();
    assert.equal(reg.resolveFromProviderId('system', 'speaker_1'), 'speaker_1');
  });

  test('retorna undefined quando o provedor não informa id — o canal decide o rótulo', () => {
    const reg = new SpeakerIdRegistry();
    // Sem diarização: nenhum speakerId deve ser emitido, preservando o
    // comportamento atual (mic -> Me, sistema -> Speaker 1).
    assert.equal(reg.resolveFromProviderId('mic', undefined), undefined);
    assert.equal(reg.resolveFromProviderId('mic', 'lixo'), undefined);
    assert.equal(reg.size, 0);
  });
});

describe('SpeakerIdRegistry — ciclo de vida da reunião', () => {
  test('reset() limpa o mapeamento para a próxima reunião', () => {
    const reg = new SpeakerIdRegistry();
    reg.resolve('system', 0);
    reg.resolve('mic', 0);
    assert.equal(reg.size, 2);

    reg.reset();
    assert.equal(reg.size, 0);
    // Após o reset a numeração recomeça — sem isso o id vazaria entre reuniões
    // e o locutor da reunião anterior herdaria o rótulo deste.
    assert.equal(reg.resolve('system', 0), 'speaker_1');
  });

  test('snapshot() expõe o mapeamento para debug', () => {
    const reg = new SpeakerIdRegistry();
    reg.resolve('mic', 0);
    assert.deepEqual(reg.snapshot(), { 'mic:0': 'speaker_1' });
  });
});

describe('captureChannelFor', () => {
  test('mapeia o rótulo de canal do main para canal de captura', () => {
    assert.equal(captureChannelFor('interviewer'), 'system');
    assert.equal(captureChannelFor('user'), 'mic');
  });
});

describe('cenário presencial (o gap que bloqueia o mercado)', () => {
  test('duas pessoas na mesma sala recebem ids distintos em vez de colapsar em "Me"', () => {
    // Consulta médica / reunião de escritório: não há canal de sistema, as duas
    // vozes chegam pelo microfone. O provedor as numera 0 e 1 no mesmo stream.
    const reg = new SpeakerIdRegistry();
    const clinician = reg.resolveFromProviderId('mic', 'speaker_1');
    const patient = reg.resolveFromProviderId('mic', 'speaker_2');

    assert.equal(clinician, 'speaker_1');
    assert.equal(patient, 'speaker_2');
    assert.notEqual(clinician, patient);
    // Nenhum dos dois deve ser rotulado 'me': em reunião presencial não há como
    // saber qual voz é a do usuário, então o usuário renomeia depois.
    assert.notEqual(clinician, 'me');
    assert.notEqual(patient, 'me');
  });

  test('vozes presenciais e remotas não colidem numa reunião mista', () => {
    // Alguém na sala (mic) + duas pessoas na chamada (sistema).
    const reg = new SpeakerIdRegistry();
    const ids = [
      reg.resolveFromProviderId('mic', 'speaker_1'),
      reg.resolveFromProviderId('system', 'speaker_1'),
      reg.resolveFromProviderId('system', 'speaker_2'),
    ];
    assert.equal(new Set(ids).size, 3, `esperava 3 ids distintos, obtive ${ids.join(', ')}`);
  });
});

describe('isDiarizableSTT', () => {
  test('aceita provedores que implementam setDiarization', () => {
    assert.equal(isDiarizableSTT({ setDiarization() {} }), true);
    class Impl {
      setDiarization(_enabled) {}
    }
    assert.equal(isDiarizableSTT(new Impl()), true);
  });

  test('rejeita provedores sem a capacidade — o main simplesmente não diariza', () => {
    assert.equal(isDiarizableSTT({}), false);
    assert.equal(isDiarizableSTT(null), false);
    assert.equal(isDiarizableSTT(undefined), false);
    assert.equal(isDiarizableSTT({ setDiarization: 'não é função' }), false);
    assert.equal(isDiarizableSTT('deepgram'), false);
  });
});
