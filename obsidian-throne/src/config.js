import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 *  GEOMETRIA DO MUNDO — constantes mestras
 *  X: leste(+)/oeste(−)   Z: sul(+)/norte(−)   Y: altura
 * ------------------------------------------------------------------ */
export const FLOOR = { crypt: -4, ground: 0, first: 4, second: 8, roof: 12 };
export const WALL_H = 4;
export const KEEP = { x0: -14, x1: 14, z0: -12, z1: 12 };
export const TOWER = { x0: 13.5, x1: 20, z0: -8, z1: 0 };
export const COURT_S = { x0: -16, x1: 16, z0: 12, z1: 26 };   // pátio do portão
export const YARD_W = { x0: -34, x1: -14, z0: -10, z1: 14 };   // pátio de treino / estábulo
export const GATE = { x: 0, z: 26 };                            // portão principal
export const STEP_UP = 0.62;

/* Paleta — dark fantasy */
export const C = {
  stoneDark: 0x2f3038, stone: 0x474851, stoneLight: 0x5d5e69, stoneWarm: 0x54504a,
  mortar: 0x3a3b42, obsidian: 0x14161c, obsidianEdge: 0x2a2f3a,
  wood: 0x4a3524, woodDark: 0x2b1e14, woodLight: 0x6b503366, thatch: 0x6e5b39,
  iron: 0x24262b, ironLight: 0x3a3d45, steel: 0x8b919c, blade: 0xb9c0cb,
  gold: 0xa8862c, goldBright: 0xd8b451, brass: 0x8a6a2a,
  blood: 0x5b1a1a, bloodBright: 0x8c2626, wine: 0x4a1220, purple: 0x3b2440,
  clothBlue: 0x243347, clothGreen: 0x27402f, clothRed: 0x5a1f22, clothBrown: 0x4a3a2a,
  clothWhite: 0xb9b2a4, clothGrey: 0x53555c, clothBlack: 0x1b1c21,
  skin: 0xc49a72, skinPale: 0xd8bb9c, skinDark: 0x8a6444,
  hair: 0x2a1c12, hairGrey: 0x9c9689, hairBlond: 0xa8894c, hairRed: 0x7a3418,
  grass: 0x2f3b26, grassDry: 0x4a4a2c, dirt: 0x3c3021, mud: 0x2b2418, moss: 0x354a2c,
  rock: 0x3b3b40, rockDark: 0x2a2a2e, sand: 0x5a5342,
  bone: 0xb9b09a, scale: 0x35503f, scaleDark: 0x22331f,
  fire: 0xff8b2a, fireCore: 0xffd98a, ember: 0xd2541a, candle: 0xffcf7a,
  water: 0x1d2b33, ice: 0x8fa6b0, sky: 0x1a1a24, moon: 0xc9d4e0,
  roofSlate: 0x2c2e36, roofSlateLight: 0x3c3f49, banner: 0x3a1d22,
};

/* ------------------------------------------------------------------ *
 *  OS 10 QUARTOS + lugares notáveis  (descoberta / diário)
 * ------------------------------------------------------------------ */
export const ROOMS = [
  { id: 'hall', n: 1, name: 'Grande Salão', floor: 0, x: [-14, -2.5], z: [-12, -2.5],
    txt: 'Mesas de carvalho, corvos nos caibros e estandartes do mesmo lobo de ferro. Foi aqui que Aldric prometeu ao irmão que nunca tocaria no Ferro Negro.' },
  { id: 'kitchen', n: 2, name: 'Cozinha & Despensa', floor: 0, x: [-14, -2.5], z: [2.5, 7],
    txt: 'Gordura de porco, cebolas na corda e um caldo que nunca esfria. Hilda jura que ouviu um paje chorando dentro da fornalha — e que a fornalha respondeu.' },
  { id: 'servants', n: 3, name: 'Aposentos dos Servos', floor: 0, x: [-14, -2.5], z: [7, 12],
    txt: 'Enxergas no chão, um sino rachado e três pares de botas pequenas demais para qualquer adulto vivo.' },
  { id: 'armory', n: 4, name: 'Salão de Armas', floor: 0, x: [2.5, 14], z: [-12, -2.5],
    txt: 'Cem fios de aço sem sangue. A Ordem de Ferro jura que a espada guardada acima dorme — mentiras ditas em voz baixa ainda são mentiras.' },
  { id: 'guard', n: 5, name: 'Câmara da Guarda', floor: 0, x: [2.5, 14], z: [2.5, 7],
    txt: 'Couro, suor e um alçapão para a masmorra. Ninguém desce ali sem uma tocha e um motivo.' },
  { id: 'crypt', n: 6, name: 'Cripta dos Reis', floor: -4, x: [-11, 10], z: [-17, -3],
    txt: 'Dezenove reis em pedra, todos com as mãos fechadas — exceto um, que abre a palma para o vazio como quem ofereceu algo.' },
  { id: 'library', n: 7, name: 'Biblioteca Real', floor: 4, x: [-14, -2.5], z: [2.5, 7],
    txt: 'Crônicas de Varenya, três mil páginas, e a última frase de todas: "ele não era o irmão que voltou".' },
  { id: 'council', n: 8, name: 'Salão do Conselho', floor: 4, x: [2.5, 14], z: [2.5, 7],
    txt: 'O mapa do reino coberto de dedadas escuras. Alguém marcou a ponte do Cinza quatro vezes, sempre no mesmo ponto.' },
  { id: 'royal', n: 9, name: 'Aposentos Reais', floor: 4, x: [-14, -2.5], z: [7, 12],
    txt: 'A cama do rei está virada para a porta, não para a janela. Faz vinte anos que Aldric não dorme com o rosto virado para a lareira.' },
  { id: 'throne', n: 10, name: 'Salão do Trono', floor: 8, x: [-14, 14], z: [-12, -2.5],
    txt: 'Doze degraus de pedra negra até o Trono de Obsidiana. Quem se senta nele jura ouvir alguém respirar atrás do encosto.' },
];

export const PLACES = [
  { id: 'vestibule', name: 'Vestíbulo do Portão', floor: 0, x: [2.5, 14], z: [7, 12] },
  { id: 'cellar', name: 'Adega & Masmorra', floor: -4, x: [11, 19], z: [-17, -12] },
  { id: 'chapel', name: 'Capela dos Sussurros', floor: 4, x: [2.5, 14], z: [7, 12] },
  { id: 'master', name: 'Torre do Mestre', floor: 4, x: [2.5, 14], z: [-12, -2.5] },
  { id: 'princess', name: 'Quarto da Princesa', floor: 8, x: [-14, -2.5], z: [2.5, 7.5] },
  { id: 'embroidery', name: 'Solar de Bordado', floor: 8, x: [-14, -2.5], z: [7.5, 12] },
  { id: 'whisper', name: 'Câmara do Sussurro', floor: 8, x: [2.5, 14], z: [2.5, 7.5] },
  { id: 'archive', name: 'Arquivo Real', floor: 8, x: [2.5, 14], z: [7.5, 12] },
  { id: 'gateyard', name: 'Pátio do Portão', floor: 0, x: [-16, 16], z: [12, 26], out: true },
  { id: 'yard', name: 'Pátio de Treino', floor: 0, x: [-34, -14], z: [-10, 14], out: true },
  { id: 'stable', name: 'Estrebaria', floor: 0, x: [-34, -24], z: [-10, -2], out: true },
  { id: 'village', name: 'Vila Cinzalta', floor: 0, x: [30, 120], z: [90, 190], out: true },
  { id: 'bridge', name: 'Ponte do Rio Cinza', floor: 0, x: [130, 175], z: [110, 170], out: true },
  { id: 'forest', name: 'Bosque de Varenya', floor: 0, x: [-160, -20], z: [40, 200], out: true },
  { id: 'rock', name: 'Rochedo do Dragão', floor: 0, x: [180, 250], z: [60, 150], out: true },
  { id: 'ruins', name: 'Ruínas do Septo Antigo', floor: 0, x: [-60, 10], z: [-190, -110], out: true },
];

/* ------------------------------------------------------------------ *
 *  TERRENO
 *  Planície plana no castelo, colinas longe, rio cavado a leste.
 * ------------------------------------------------------------------ */
export const RIVER_X = 152;
const _smooth = (a, b, t) => { const s = Math.min(1, Math.max(0, t)); return a + (b - a) * (s * s * (3 - 2 * s)); };
const flatSpots = [
  { x: 70, z: 140, r: 46, y: 0.6 },     // vila
  { x: 152, z: 140, r: 26, y: 0.6 },    // ponte
  { x: 215, z: 100, r: 34, y: 1.4 },    // rochedo
  { x: -70, z: 120, r: 60, y: 0.5 },    // clareira do bosque
  { x: -25, z: -150, r: 40, y: 1.2 },   // ruínas
];

export function terrainHeight(x, z) {
  // mascaramento: castelo e arredores planos
  const d = Math.hypot(x * 0.75, z * 0.62);
  let mask = Math.min(1, Math.max(0, (d - 46) / 46));
  mask = mask * mask * (3 - 2 * mask);

  let h = 0;
  h += Math.sin(x * 0.017 + 0.4) * Math.cos(z * 0.014 - 0.9) * 4.2;
  h += Math.sin(x * 0.043 - 1.2) * Math.cos(z * 0.037 + 0.3) * 1.6;
  h += Math.sin((x + z) * 0.0092) * 3.0;
  h *= mask;

  // vala do rio (norte-sul)
  const dr = Math.abs(x - RIVER_X);
  if (dr < 34) {
    const t = 1 - dr / 34;
    h = _smooth(h, -2.4, Math.min(1, t * 1.7));
  }
  // depressões pontuais
  for (const f of flatSpots) {
    const dd = Math.hypot(x - f.x, z - f.z);
    if (dd < f.r * 1.6) {
      const t = 1 - Math.min(1, dd / (f.r * 1.6));
      h = _smooth(h, f.y, t * t * (3 - 2 * t));
    }
  }
  // anel de montanhas nas bordas do reino
  const rr = Math.hypot(x, z);
  if (rr > 205) h += (rr - 205) * 0.34;
  // valas: estradas — mantém suave
  return h;
}

export function isWater(x, z) { return terrainHeight(x, z) < -0.55; }

/* Regiões onde o terreno NÃO vale como piso: existem lajes construídas
 * (é o que permite descer escadas para a cripta sem "flutuar" na superfície). */
export const TERRAIN_EXCLUDE = [
  [-14, 14, -12, 12],          // castelo (3 andares) — laje própria
  [14, 19.5, -7.5, -0.5],      // torre da escadaria
  [-11, 19, -17, -12],         // cripta + masmorra (extensão norte)
];
export function terrainFloorAllowed(x, z) {
  for (const r of TERRAIN_EXCLUDE) if (x >= r[0] && x <= r[1] && z >= r[2] && z <= r[3]) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 *  FÍSICA: caixas AABB + grade de broadphase
 * ------------------------------------------------------------------ */
const CELL = 10;

export class Physics {
  constructor() {
    this.boxes = [];
    this.grid = new Map();
    this.bounds = 262; // limite do mundo
  }
  add(x0, x1, y0, y1, z0, z1, tag = '') {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    const idx = this.boxes.length;
    this.boxes.push({ x0, x1, y0, y1, z0, z1, tag, enabled: true });
    const ix0 = Math.floor(x0 / CELL), ix1 = Math.floor(x1 / CELL);
    const iz0 = Math.floor(z0 / CELL), iz1 = Math.floor(z1 / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = ix + ':' + iz;
        let a = this.grid.get(k);
        if (!a) { a = []; this.grid.set(k, a); }
        a.push(idx);
      }
    }
    return idx;
  }
  setEnabled(i, on) { if (this.boxes[i]) this.boxes[i].enabled = on; }
  /** caixa em torno de um Object3D (usa bounding box do mundo) */
  addFromObject(obj, tag = '') {
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj);
    return this.add(b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z, tag);
  }
  _candidates(x0, x1, z0, z1, out) {
    out.length = 0;
    const ix0 = Math.floor(x0 / CELL), ix1 = Math.floor(x1 / CELL);
    const iz0 = Math.floor(z0 / CELL), iz1 = Math.floor(z1 / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const a = this.grid.get(ix + ':' + iz);
        if (!a) continue;
        for (let i = 0; i < a.length; i++) if (!out.includes(a[i])) out.push(a[i]);
      }
    }
    return out;
  }
  /** Topo do solo em (x,z) considerando o terreno e as caixas abaixo de yRef+STEP.
   *  O terreno só conta como piso se for alcançável (evita "flutuar" dentro da cripta). */
  groundAt(x, z, yRef = 0) {
    const lim = yRef + STEP_UP;
    const th = terrainHeight(x, z);
    let best = (terrainFloorAllowed(x, z) && th <= lim) ? th : -Infinity;
    const cands = this._candidates(x, x, z, z, this._tmp || (this._tmp = []));
    for (const i of cands) {
      const b = this.boxes[i];
      if (!b.enabled) continue;
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      if (b.y1 > best && b.y1 <= lim) best = b.y1;
    }
    return best;
  }
  /** Chão mais alto (para checar teto/espaço). */
  ceilingAt(x, z, y) {
    let best = Infinity;
    const cands = this._candidates(x, x, z, z, this._tmp2 || (this._tmp2 = []));
    for (const i of cands) {
      const b = this.boxes[i];
      if (!b.enabled) continue;
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      if (b.y0 >= y + 0.4 && b.y0 < best) best = b.y0;
    }
    return best;
  }
  /** Colisão horizontal: caixa em [y, y+h] com raio r.
   *  `yRef` = solo onde o personagem vai pisar; degraus até yRef+STEP_UP são transponíveis. */
  blocked(x, y, z, r = 0.42, h = 1.7, ignoreSteps = true, yRef = null) {
    if (Math.abs(x) > this.bounds || Math.abs(z) > this.bounds) return true;
    const cands = this._candidates(x - r, x + r, z - r, z + r, this._tmp3 || (this._tmp3 = []));
    const yTop = y + h;
    const stepRef = Math.max(y, yRef === null ? y : yRef);
    for (const i of cands) {
      const b = this.boxes[i];
      if (!b.enabled) continue;
      if (ignoreSteps && b.y1 <= stepRef + STEP_UP) continue;
      if (b.y0 >= yTop) continue;
      if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) return true;
    }
    return false;
  }
  /** Chão tomado pela água? */
  waterDepth(x, z, y) { const t = terrainHeight(x, z); return y < -0.4 ? -0.4 - Math.max(t, y) : 0; }
}

export const physics = new Physics();

/* ------------------------------------------------------------------ *
 *  UTILIDADES
 * ------------------------------------------------------------------ */
export function subtractRect(rect, hole) {
  const [x0, x1, z0, z1] = rect;
  const [hx0, hx1, hz0, hz1] = hole;
  if (hx1 <= x0 || hx0 >= x1 || hz1 <= z0 || hz0 >= z1) return [rect];
  const out = [];
  if (hz0 > z0) out.push([x0, x1, z0, Math.min(hz0, z1)]);
  if (hz1 < z1) out.push([x0, x1, Math.max(hz1, z0), z1]);
  const mz0 = Math.max(z0, hz0), mz1 = Math.min(z1, hz1);
  if (hx0 > x0) out.push([x0, Math.min(hx0, x1), mz0, mz1]);
  if (hx1 < x1) out.push([Math.max(hx1, x0), x1, mz0, mz1]);
  return out.filter(r => r[1] - r[0] > 0.001 && r[3] - r[2] > 0.001);
}

export function rng(seed = 1337) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function inRect(x, z, r, pad = 0) {
  return x >= r[0] - pad && x <= r[1] + pad && z >= r[2] - pad && z <= r[3] + pad;
}

export function needs(a, b, dt, rate = 6) { // interpolação suave
  return a + (b - a) * Math.min(1, dt * rate);
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
