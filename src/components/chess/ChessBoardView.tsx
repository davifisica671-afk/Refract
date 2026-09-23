import { useMemo } from 'react';
import { fenToSquares, moveToArrow } from '../../lib/chessBoardLayout.mjs';

interface Props {
  fen: string;
  turn: 'w' | 'b';
  from?: string;
  to?: string;
  explanation: string;
  verified: boolean;
}

const GLYPH: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

export function ChessBoardView({ fen, turn, from, to, explanation, verified }: Props) {
  const squares = useMemo(() => fenToSquares(fen), [fen]);
  const orientation = turn === 'w' ? 'white' : 'black';
  const arrow = from && to ? moveToArrow(from, to, orientation) : null;
  const ordered = orientation === 'white' ? squares : [...squares].reverse();
  return (
    <div className="rounded-xl bg-[#141414] p-3 text-white">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg">
        <div className="grid h-full w-full grid-cols-8 grid-rows-8">
          {ordered.map((s, i) => {
            const light = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
            const isFrom = from !== undefined && s.square === from;
            const isTo = to !== undefined && s.square === to;
            return (
              <div
                key={s.square}
                className={[
                  'flex items-center justify-center text-[clamp(10px,3.2vw,26px)]',
                  light ? 'bg-[#ecdcb9]' : 'bg-[#a5714f]',
                  isFrom ? '!bg-green-500/80' : '',
                  isTo ? '!bg-sky-500/80' : '',
                ].join(' ')}
              >
                <span className={s.piece !== null && s.piece === s.piece.toUpperCase() ? 'text-neutral-100 drop-shadow' : 'text-neutral-900'}>
                  {s.piece !== null ? (GLYPH[s.piece] ?? '') : ''}
                </span>
              </div>
            );
          })}
        </div>
        {arrow !== null && (
          <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none">
            <defs>
              <marker id="chess-arrow" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
                <path d="M0,0 L4,2 L0,4 Z" fill="#22c55e" />
              </marker>
            </defs>
            <line x1={arrow.x1} y1={arrow.y1} x2={arrow.x2} y2={arrow.y2} stroke="#22c55e" strokeWidth="3" markerEnd="url(#chess-arrow)" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm">
        {!verified && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300">não verificado</span>}
        <span className="text-neutral-300">{explanation}</span>
      </div>
    </div>
  );
}
