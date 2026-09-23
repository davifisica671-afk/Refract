export class FenParseError extends Error {}

const FEN_RE = /^([rnbqkpRNBQKP1-8]+\/){7}[rnbqkpRNBQKP1-8]+ [wb] (-|[KQkq]{1,4}) (-|[a-h][36]) \d+ \d+$/;

export function buildFenExtractionPrompt(): string {
  return [
    'Look at the chess board in this screenshot.',
    'Reply with ONLY one line in this exact format:',
    'FEN: <placement> <side-to-move> <castling> <en-passant> <halfmove> <fullmove>',
    'Use standard FEN. White pieces uppercase, black lowercase.',
    'If it is White to move use "w", Black to move use "b".',
  ].join('\n');
}

export function parseFenReply(reply: string): { fen: string; turn: 'w' | 'b' } {
  const line = reply.split('\n').map((l) => l.trim()).find((l) => /^FEN:/i.test(l));
  if (!line) throw new FenParseError('FEN: no FEN line in vision reply');
  const fen = line.replace(/^FEN:\s*/i, '').trim();
  if (!FEN_RE.test(fen)) throw new FenParseError(`FEN: malformed: ${fen}`);
  const placement = fen.split(' ')[0];
  if (!placement.includes('K') || !placement.includes('k')) {
    throw new FenParseError('FEN: both kings must be present');
  }
  return { fen, turn: fen.split(' ')[1] as 'w' | 'b' };
}
