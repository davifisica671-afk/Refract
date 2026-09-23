import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fenToSquares, moveToArrow } from '../chessBoardLayout.mjs';

const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('chessBoardLayout', () => {
  test('startpos has 32 pieces and white pawn on e2', () => {
    const squares = fenToSquares(STARTPOS);
    assert.equal(squares.length, 64);
    assert.equal(squares.filter((s) => s.piece !== null).length, 32);
    assert.equal(squares.find((s) => s.square === 'e2').piece, 'P');
    assert.equal(squares.find((s) => s.square === 'e8').piece, 'k');
  });

  test('g1->f3 arrow coordinates (white orientation)', () => {
    assert.deepEqual(moveToArrow('g1', 'f3', 'white'), {
      x1: 81.25, y1: 93.75, x2: 68.75, y2: 68.75,
    });
  });

  test('black orientation flips the board', () => {
    assert.deepEqual(moveToArrow('g1', 'f3', 'black'), {
      x1: 18.75, y1: 6.25, x2: 31.25, y2: 31.25,
    });
  });

  test('invalid FEN throws', () => {
    assert.throws(() => fenToSquares('not-a-fen'), /FEN/);
  });
});
