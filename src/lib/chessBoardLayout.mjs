const PIECE_GLYPH = {
  K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

export function fenToSquares(fen) {
  const placement = String(fen).trim().split(/\s+/)[0];
  const rows = placement.split('/');
  if (rows.length !== 8) throw new Error(`FEN: expected 8 ranks, got ${rows.length}`);
  const squares = [];
  rows.forEach((row, rankIndex) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
      } else if (PIECE_GLYPH[ch]) {
        if (file > 7) throw new Error(`FEN: rank overflow at rank ${8 - rankIndex}`);
        squares.push({ square: `${'abcdefgh'[file]}${8 - rankIndex}`, piece: ch });
        file += 1;
      } else {
        throw new Error(`FEN: invalid char '${ch}'`);
      }
    }
    if (file !== 8) throw new Error(`FEN: rank ${8 - rankIndex} has ${file} files`);
  });
  const bySquare = new Map(squares.map((s) => [s.square, s.piece]));
  const all = [];
  for (let r = 8; r >= 1; r -= 1) {
    for (let f = 0; f < 8; f += 1) {
      const sq = `${'abcdefgh'[f]}${r}`;
      all.push({ square: sq, piece: bySquare.get(sq) ?? null });
    }
  }
  return all;
}

export function squareToXY(square, orientation = 'white') {
  const file = 'abcdefgh'.indexOf(square[0]);
  const rank = Number(square.slice(1));
  if (file < 0 || !(rank >= 1 && rank <= 8)) throw new Error(`square: invalid '${square}'`);
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 8 - rank : rank - 1;
  return { x: ((col + 0.5) / 8) * 100, y: ((row + 0.5) / 8) * 100 };
}

export function moveToArrow(from, to, orientation = 'white') {
  const a = squareToXY(from, orientation);
  const b = squareToXY(to, orientation);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}
