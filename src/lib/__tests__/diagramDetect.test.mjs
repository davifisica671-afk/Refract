import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMermaid, extractMermaidBlocks } from '../diagramDetect.mjs';

describe('diagramDetect', () => {
  test('extrai um fence mermaid válido', () => {
    const md = 'texto antes\n```mermaid\ngraph TD\n  A-->B\n```\ntexto depois';
    assert.deepEqual(extractMermaidBlocks(md), ['graph TD\n  A-->B']);
  });

  test('detecta fence em MAIÚSCULAS (case-insensitive)', () => {
    const md = '```MERMAID\nsequenceDiagram\n  A->>B: oi\n```';
    assert.equal(hasMermaid(md), true);
    assert.deepEqual(extractMermaidBlocks(md), ['sequenceDiagram\n  A->>B: oi']);
  });

  test('extrai múltiplos blocos em ordem', () => {
    const md = [
      '```mermaid',
      'graph TD',
      '```',
      'entre blocos',
      '```Mermaid',
      'pie title Pets',
      '```',
    ].join('\n');
    assert.deepEqual(extractMermaidBlocks(md), ['graph TD', 'pie title Pets']);
  });

  test('ignora inline com crases simples', () => {
    const md = 'use `mermaid` para diagramas e `graph TD` inline';
    assert.equal(hasMermaid(md), false);
    assert.deepEqual(extractMermaidBlocks(md), []);
  });

  test('ignora fence não-fechado', () => {
    const md = '```mermaid\ngraph TD\n  A-->B\n(sem fence de fechamento)';
    assert.equal(hasMermaid(md), false);
    assert.deepEqual(extractMermaidBlocks(md), []);
  });

  test('ignora lang vizinha `mmd`', () => {
    const md = '```mmd\ngraph TD\n  A-->B\n```';
    assert.equal(hasMermaid(md), false);
    assert.deepEqual(extractMermaidBlocks(md), []);
  });

  test('hasMermaid retorna false sem nenhum bloco', () => {
    assert.equal(hasMermaid('só texto, sem código'), false);
    assert.equal(hasMermaid('```python\nprint(1)\n```'), false);
  });
});
