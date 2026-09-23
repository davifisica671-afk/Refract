export interface ChessSquare {
  square: string;
  piece: string | null;
}

export type BoardOrientation = 'white' | 'black';

export interface BoardPoint {
  x: number;
  y: number;
}

export interface MoveArrow {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function fenToSquares(fen: string): ChessSquare[];
export function squareToXY(square: string, orientation?: BoardOrientation): BoardPoint;
export function moveToArrow(from: string, to: string, orientation?: BoardOrientation): MoveArrow;
