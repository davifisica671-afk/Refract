import * as THREE from 'three';
import {
  Batcher, BUCKET, MAT_LIT, MAT_SMOOTH, MAT_GLOW, MAT_GLOW_FOG, MAT_LEAF,
  prep, trs, unitBox, unitCyl, unitCone, unitSphere, unitPrism,
} from './batch.js';
import {
  C, KEEP, TOWER, FLOOR, ROOMS, PLACES, terrainHeight, physics,
  subtractRect, rng, clamp,
} from './config.js';
import { buildRealm } from './realm.js';

/** Intervalos sólidos em Y para um trecho de parede, dado o conjunto de vãos que o cobrem. */
function solidSpans(openings, s0, s1, y0, y1) {
  const cov = [];
  for (const o of openings) {
    if (o.a0 <= s0 + 1e-4 && o.a1 >= s1 - 1e-4) {
      const a = Math.max(o.y0, y0), b = Math.min(o.y1, y1);
      if (b > a) cov.push([a, b]);
    }
  }
  cov.sort((p, q) => p[0] - q[0]);
  const out = [];
  let cur = y0;
  for (const [a, b] of cov) { if (a > cur + 1e-4) out.push([cur, a]); cur = Math.max(cur, b); }
  if (cur < y1 - 1e-4) out.push([cur, y1]);
  return out;
}

const T_EXT = 0.5;   // espessura paredes externas
const T_INT = 0.3;   // espessura paredes internas
const DOOR_H = 3.2;  // altura vão de porta
const WIN_B = 1.7, WIN_T = 3.0;   // janela térrea
const WIN1_B = 5.6, WIN1_T = 7.0; // janela 1º andar
const WIN2_B = 9.6, WIN2_T = 11.0;// janela 2º andar

export class World {
  constructor(scene) {
    this.lvl = 0;
    this.scene = scene;
    this.b = new Batcher();
    this.physics = physics;
    this.group = new THREE.Group();
    this.group.name = 'world';
    scene.add(this.group);
    this.lights = [];       // {light, base, flicker}
    this.doors = [];
    this.interactables = [];
    this.spawns = {};
    this._tmp = [];
  }

  /* ================= primitivas ================= */
  /** Define o andar em que os móveis serão construídos (0 = térreo). */
  setLevel(y) { this.lvl = y; return this; }
  /** Caixa de colisão de móvel: y relativo ao andar atual. */
  pbox(x0, x1, yBase, h, z0, z1, tag) {
    physics.add(x0, x1, this.lvl + yBase, this.lvl + yBase + h, z0, z1, tag);
  }
  solid(x0, x1, y0, y1, z0, z1, color, bucket = BUCKET.SOLID, collide = true) {
    this.b.box(bucket, x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, color);
    if (collide) this.physics.add(x0, x1, y0, y1, z0, z1);
    return this;
  }
  deco(x0, x1, y0, y1, z0, z1, color) {
    return this.solid(x0, x1, y0, y1, z0, z1, color, BUCKET.SOLID, false);
  }
  slab(yTop, thick, rects, color) {
    for (const r of rects) this.solid(r[0], r[1], yTop - thick, yTop, r[2], r[3], color);
  }
  /** parede ao longo de X em z = zc. `openings`: [{a0,a1,y0,y1}] — suporta vãos empilhados. */
  wallX(x0, x1, zc, y0, y1, t, color, openings = [], bucket = BUCKET.SOLID) {
    const cuts = new Set([x0, x1]);
    for (const o of openings) {
      if (o.a0 > x0 + 1e-4 && o.a0 < x1) cuts.add(o.a0);
      if (o.a1 > x0 && o.a1 < x1 - 1e-4) cuts.add(o.a1);
    }
    const xs = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) {
      const s0 = xs[i], s1 = xs[i + 1];
      if (s1 - s0 < 1e-4) continue;
      for (const [a, b] of solidSpans(openings, s0, s1, y0, y1)) {
        this.solid(s0, s1, a, b, zc - t / 2, zc + t / 2, color, bucket);
      }
    }
    return this;
  }
  /** parede ao longo de Z em x = xc. */
  wallZ(z0, z1, xc, y0, y1, t, color, openings = [], bucket = BUCKET.SOLID) {
    const cuts = new Set([z0, z1]);
    for (const o of openings) {
      if (o.a0 > z0 + 1e-4 && o.a0 < z1) cuts.add(o.a0);
      if (o.a1 > z0 && o.a1 < z1 - 1e-4) cuts.add(o.a1);
    }
    const zs = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < zs.length - 1; i++) {
      const s0 = zs[i], s1 = zs[i + 1];
      if (s1 - s0 < 1e-4) continue;
      for (const [a, b] of solidSpans(openings, s0, s1, y0, y1)) {
        this.solid(xc - t / 2, xc + t / 2, a, b, s0, s1, color, bucket);
      }
    }
    return this;
  }
  /** Escada de lajes: degraus finos (dá para subir 0,25 m por vez e passar por baixo). */
  stair(x0, x1, zStart, length, yBottom, yTop, steps, color, dirZ = -1, dark = null) {
    const rise = (yTop - yBottom) / steps;
    const run = length / steps;
    const tread = Math.min(0.34, rise * 1.3 + 0.1);
    for (let i = 0; i < steps; i++) {
      const y1 = yBottom + rise * (i + 1);
      const za = zStart + dirZ * run * i, zb = zStart + dirZ * run * (i + 1);
      const z0 = Math.min(za, zb), z1 = Math.max(za, zb);
      this.solid(x0, x1, y1 - tread, y1, z0, z1, i % 2 ? color : (dark || color));
      // espelho: fecha a frente do degrau
      const zEdge = dirZ < 0 ? z1 : z0;
      this.solid(x0, x1, y1 - rise - tread, y1 - tread, zEdge - 0.07, zEdge + 0.07, dark || color);
    }
    return this;
  }
  cylSolid(r, h, x, y, z, color, seg = 8, bucket = BUCKET.SOLID, collide = true) {
    this.b.add(bucket, unitCyl(seg), color, trs(x, y + h / 2, z, 0, 0, 0, r * 2, h, r * 2));
    if (collide) {
      const s = r * 0.72;
      physics.add(x - s, x + s, y, y + h, z - s, z + s, 'cyl');
    }
    return this;
  }
  /** viga/poste girado livremente (visual apenas, sem colisor) */
  beam(x, y, z, len, thick, color, rx = 0, ry = 0, rz = 0) {
    this.b.add(BUCKET.SOLID, unitBox(), color, trs(x, y, z, rx, ry, rz, thick, len, thick));
    return this;
  }
  light(x, y, z, color, intensity, dist, flicker = 0.18) {
    const l = new THREE.PointLight(color, intensity, dist, 2);
    l.position.set(x, y, z);
    this.group.add(l);
    this.lights.push({ light: l, base: intensity, flicker });
    return l;
  }
  /* ================= tochas e velas ================= */
  torch(x, y, z, ry = 0, withLight = false, color = C.candle) {
    this.b.add(BUCKET.SOLID, unitCyl(6), C.iron, trs(x, y + 0.22, z, 0.5, ry, 0, 0.09, 0.5, 0.09));
    this.b.add(BUCKET.SOLID, unitCyl(5), C.woodDark, trs(x, y + 0.46, z, 0.42, ry, 0, 0.1, 0.7, 0.1));
    this.b.add(BUCKET.GLOW, unitSphere(6), color, trs(x, y + 0.66, z, 0, ry, 0, 0.34, 0.5, 0.34));
    this.b.add(BUCKET.GLOW, unitCone(6), C.fire, trs(x, y + 0.95, z, 0, ry, 0, 0.24, 0.5, 0.24));
    if (withLight) this.light(x, y + 1.1, z, 0xffa348, 9, 15, 0.28);
  }
  candle(x, y, z) {
    this.b.add(BUCKET.SOLID, unitCyl(5), 0xcfc3a6, trs(x, y + 0.11, z, 0, 0, 0, 0.07, 0.22, 0.07));
    this.b.add(BUCKET.GLOW, unitSphere(5), C.candle, trs(x, y + 0.26, z, 0, 0, 0, 0.1, 0.16, 0.1));
  }
  brazier(x, y, z, withLight = true) {
    this.b.add(BUCKET.SOLID, unitCyl(6), C.iron, trs(x, y + 0.5, z, 0, 0, 0, 0.24, 0.1, 0.24));
    this.b.add(BUCKET.SOLID, unitCyl(7), C.ironLight, trs(x, y + 0.85, z, 0, 0, 0, 0.9, 0.5, 0.9));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(x + Math.cos(a) * 0.32, y + 0.35, z + Math.sin(a) * 0.32, 0, -a, 0.12, 0.08, 0.7, 0.08));
    }
    this.b.add(BUCKET.GLOW, unitSphere(6), C.ember, trs(x, y + 1.1, z, 0, 0, 0, 0.7, 0.42, 0.7));
    this.b.add(BUCKET.GLOW, unitCone(7), C.fire, trs(x, y + 1.5, z, 0, 0, 0, 0.5, 0.9, 0.5));
    this.b.add(BUCKET.GLOW, unitCone(6), C.fireCore, trs(x, y + 1.42, z, 0, 0, 0, 0.26, 0.6, 0.26));
    if (withLight) this.light(x, y + 1.6, z, 0xff9a3c, 14, 22, 0.34);
    physics.add(x - 0.5, x + 0.5, y, y + 1.1, z - 0.5, z + 0.5, 'brazier');
  }
  chandelier(x, y, z) {
    this.b.add(BUCKET.SOLID, unitCyl(5), C.iron, trs(x, y + 2.6, z, 0, 0, 0, 0.06, 2.4, 0.06));
    this.b.add(BUCKET.SOLID, unitCyl(10), C.iron, trs(x, y + 0.4, z, 0, 0, 0, 1.5, 0.14, 1.5));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      this.candle(x + Math.cos(a) * 0.62, y + 0.5, z + Math.sin(a) * 0.62);
    }
  }
  /* ================= mobiliário ================= */
  table(x, z, w = 1.6, d = 0.9, ry = 0, h = 0.82) {
    this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(x, h, z, 0, ry, 0, w, 0.1, d));
    const cs = Math.cos(ry), sn = Math.sin(ry);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const ox = (sx * (w / 2 - 0.12)) * cs - (sz * (d / 2 - 0.12)) * sn;
      const oz = (sx * (w / 2 - 0.12)) * sn + (sz * (d / 2 - 0.12)) * cs;
      this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x + ox, h / 2, z + oz, 0, ry, 0, 0.12, h, 0.12));
    }
    this.pbox(x - Math.max(w, d) / 2, x + Math.max(w, d) / 2, 0, h, z - Math.max(w, d) / 2, z + Math.max(w, d) / 2, 'mesa');
  }
  chair(x, z, ry = 0) {
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x, 0.46, z, 0, ry, 0, 0.44, 0.08, 0.44));
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x - Math.sin(ry) * 0.2, 0.75, z - Math.cos(ry) * 0.2, 0, ry, 0, 0.44, 0.6, 0.07));
    for (const [a, b2] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) {
      this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x + a, 0.22, z + b2, 0, ry, 0, 0.07, 0.44, 0.07));
    }
  }
  barrel(x, z, r = 0.38, h = 0.95, y = 0) {
    this.cylSolid(r, h, x, y, z, C.wood, 8);
    this.b.add(BUCKET.SOLID, unitCyl(8), C.ironLight, trs(x, y + h * 0.25, z, 0, 0, 0, r * 2.06, 0.06, r * 2.06));
    this.b.add(BUCKET.SOLID, unitCyl(8), C.ironLight, trs(x, y + h * 0.78, z, 0, 0, 0, r * 2.06, 0.06, r * 2.06));
  }
  crate(x, y, z, s = 0.8, color = C.wood) {
    this.solid(x - s / 2, x + s / 2, y, y + s, z - s / 2, z + s / 2, color);
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x, y + s / 2, z + s / 2 + 0.01, 0, 0, 0, s, s, 0.04));
  }
  shelf(x, z, w = 2.4, ry = 0) {
    const y0 = 0;
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x, 2.5, z, 0, ry, 0, w, 0.9, 0.5));
    for (let i = 0; i < 3; i++) {
      this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(x, 0.7 + i * 0.85, z + 0.26 * Math.cos(ry), 0, ry, 0, w, 0.07, 0.5));
      this.b.add(BUCKET.SOLID, unitCyl(5), C.clothGreen, trs(x - w / 3, 0.82 + i * 0.85, z + 0.24, 0.28, ry, 0, 0.16, 0.26, 0.16));
      this.b.add(BUCKET.SOLID, unitCyl(5), C.clothRed, trs(x + w / 4, 0.82 + i * 0.85, z + 0.24, 0.28, ry, 0, 0.14, 0.22, 0.14));
    }
    this.pbox(x - w / 2, x + w / 2, y0, 2.9 - y0, z - 0.4, z + 0.4, 'estante');
  }
  bookcase(x, z, w = 2.0, h = 2.6, ry = 0, color = C.woodDark) {
    this.b.add(BUCKET.SOLID, unitBox(), color, trs(x, h / 2, z, 0, ry, 0, w, h, 0.44));
    for (let i = 0; i < 4; i++) {
      const yy = 0.35 + i * (h - 0.5) / 4;
      this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(x, yy, z + 0.24, 0, ry, 0, w - 0.14, 0.06, 0.36));
      for (let j = 0; j < 6; j++) {
        const c = [C.wine, C.clothBlue, C.clothGreen, C.gold, C.purple][(i + j) % 5];
        this.b.add(BUCKET.SOLID, unitBox(), c, trs(x - w / 2 + 0.2 + j * (w - 0.4) / 6, yy + 0.22, z + 0.24, 0, ry, 0.06, 0.11, 0.38, 0.24));
      }
    }
    this.pbox(x - w / 2, x + w / 2, 0, h, z - 0.3, z + 0.3, 'livros');
  }
  bed(x, z, ry = 0, wide = false) {
    const w = wide ? 1.9 : 1.15, l = 2.1;
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x, 0.34, z, 0, ry, 0, w, 0.34, l));
    this.b.add(BUCKET.SOLID, unitBox(), C.clothWhite, trs(x, 0.58, z, 0, ry, 0, w - 0.1, 0.2, l - 0.16));
    this.b.add(BUCKET.SOLID, unitBox(), C.clothRed, trs(x, 0.66, z + 0.2, 0, ry, 0, w - 0.06, 0.1, l * 0.62));
    this.b.add(BUCKET.SOLID, unitBox(), C.clothWhite, trs(x - Math.cos(ry) * (w / 2 + 0.1), 0.72, z + Math.sin(ry) * (w / 2 + 0.1), 0, ry, 0, 0.24, 0.16, 0.6));
    this.b.add(BUCKET.SOLID, unitBox(), C.clothWhite, trs(x + Math.cos(ry) * (w / 2 + 0.1), 0.72, z - Math.sin(ry) * (w / 2 + 0.1), 0, ry, 0, 0.24, 0.16, 0.6));
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x - Math.sin(ry) * (l / 2 + 0.12), 1.0, z - Math.cos(ry) * (l / 2 + 0.12), 0, ry, 0, w + 0.2, 2.0, 0.22));
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x + Math.sin(ry) * (l / 2 + 0.12), 0.62, z + Math.cos(ry) * (l / 2 + 0.12), 0, ry, 0, w + 0.2, 1.24, 0.22));
    const hw = w / 2 + 0.3, hl = l / 2 + 0.3;
    const cs = Math.abs(Math.cos(ry)), sn = Math.abs(Math.sin(ry));
    const ex = hw * cs + hl * sn, ez = hw * sn + hl * cs;
    this.pbox(x - ex, x + ex, 0, 0.9, z - ez, z + ez, 'cama');
  }
  bench(x, z, len = 2.4, ry = 0) {
    this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(x, 0.48, z, 0, ry, 0, len, 0.1, 0.42));
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x - Math.cos(ry) * (len / 2 - 0.2), 0.24, z + Math.sin(ry) * (len / 2 - 0.2), 0, ry, 0, 0.14, 0.48, 0.38));
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x + Math.cos(ry) * (len / 2 - 0.2), 0.24, z - Math.sin(ry) * (len / 2 - 0.2), 0, ry, 0, 0.14, 0.48, 0.38));
  }
  rug(x, z, w, d, color = C.wine, y = 0.03) {
    this.b.add(BUCKET.SOLID, unitBox(), color, trs(x, y, z, 0, 0, 0, w, 0.04, d));
  }
  banner(x, y, z, color = C.banner, ry = 0, w = 1.5, h = 3.2) {
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x, y + h + 0.1, z, 0, ry, 0, w + 0.3, 0.12, 0.12));
    this.b.add(BUCKET.SOLID, unitBox(), color, trs(x, y + h / 2, z + 0.05, 0, ry, 0, w, h, 0.05));
    this.b.add(BUCKET.SOLID, unitBox(), C.ironLight, trs(x, y + h * 0.62, z + 0.09, 0, ry, 0, w * 0.42, h * 0.3, 0.03));
    this.b.add(BUCKET.SOLID, unitBox(), C.gold, trs(x, y + h * 0.62, z + 0.1, 0, ry, 0, w * 0.16, h * 0.14, 0.03));
    // franjas
    for (let i = 0; i < 5; i++) {
      this.b.add(BUCKET.SOLID, unitCone(4), color, trs(x - w / 2 + 0.15 + i * (w - 0.3) / 4, y + 0.02, z + 0.05, Math.PI, ry, 0, 0.24, 0.4, 0.05));
    }
  }
  chest(x, z, ry = 0, color = C.wood) {
    this.b.add(BUCKET.SOLID, unitBox(), color, trs(x, 0.28, z, 0, ry, 0, 1.0, 0.56, 0.56));
    this.b.add(BUCKET.SOLID, unitBox(), C.ironLight, trs(x, 0.42, z, 0, ry, 0, 1.04, 0.1, 0.6));
    this.b.add(BUCKET.SOLID, unitBox(), C.gold, trs(x + Math.sin(ry) * 0.3, 0.34, z + Math.cos(ry) * 0.3, 0, ry, 0, 0.14, 0.18, 0.06));
    this.pbox(x - 0.6, x + 0.6, 0, 0.6, z - 0.42, z + 0.42, 'bau');
  }
  cauldron(x, z, y = 0) {
    this.b.add(BUCKET.SOLID, unitSphere(7), C.iron, trs(x, y + 0.5, z, 0, 0, 0, 1.1, 0.9, 1.1));
    this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(x, y + 0.12, z, Math.PI / 2, 0, 0, 0.9, 1.2, 0.9));
    this.b.add(BUCKET.GLOWFOG, unitCyl(7), 0x5a3d22, trs(x, y + 0.86, z, 0, 0, 0, 0.86, 0.06, 0.86));
    physics.add(x - 0.55, x + 0.55, y, y + 1.0, z - 0.55, z + 0.55, 'caldeirao');
  }
  anvil(x, z) {
    this.b.add(BUCKET.SOLID, unitBox(), C.ironLight, trs(x, 0.72, z, 0, 0.3, 0, 0.5, 0.24, 1.0));
    this.b.add(BUCKET.SOLID, unitCyl(6), C.iron, trs(x, 0.4, z, 0, 0, 0, 0.34, 0.5, 0.34));
    this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(x, 0.14, z, 0, 0.3, 0, 0.62, 0.28, 0.6));
    this.pbox(x - 0.5, x + 0.5, 0, 0.9, z - 0.6, z + 0.6, 'bigorna');
  }
  rack(x, z, ry = 0) {
    this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(x - 0.8, 0.1, z, 0, ry, 0, 0.14, 0.2, 1.2));
    this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(x + 0.8, 0.1, z, 0, ry, 0, 0.14, 0.2, 1.2));
    this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(x - 0.8, 1.3, z, 0, ry, 0, 0.12, 2.6, 0.12));
    this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(x + 0.8, 1.3, z, 0, ry, 0, 0.12, 2.6, 0.12));
    for (let i = 0; i < 4; i++) {
      const zz = z - 0.5 + i * 0.33;
      this.b.add(BUCKET.SOLID, unitBox(), C.blade, trs(x, 1.1, zz, 0, ry, 0.12, 0.06, 1.5, 0.06));
      this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x, 0.32, zz, 0, ry, 0, 0.08, 0.24, 0.08));
    }
    this.pbox(x - 1.0, x + 1.0, 0, 2.6, z - 0.7, z + 0.7, 'estante-armas');
  }
  statue(x, y, z, color = C.stone, ry = 0, kind = 'king') {
    this.b.add(BUCKET.SOLID, unitBox(), color, trs(x, y + 0.25, z, 0, ry, 0, 1.5, 0.5, 1.5));
    this.b.add(BUCKET.SOLID, unitBox(), color, trs(x, y + 0.6, z, 0, ry, 0, 1.1, 0.24, 1.1));
    this.b.add(BUCKET.SOLID, unitBox(), color, trs(x, y + 1.75, z, 0, ry, 0, 0.72, 1.9, 0.46));
    this.b.add(BUCKET.SOLID, unitBox(), color, trs(x, y + 2.9, z, 0, ry, 0, 0.4, 0.4, 0.4));
    this.b.add(BUCKET.SOLID, unitSphere(6), color, trs(x, y + 3.22, z, 0, ry, 0, 0.62, 0.7, 0.62));
    if (kind === 'king') {
      this.b.add(BUCKET.SOLID, unitCyl(6), C.iron, trs(x, y + 3.58, z, 0, ry, 0, 0.56, 0.16, 0.56));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        this.b.add(BUCKET.SOLID, unitCone(4), C.iron, trs(x + Math.cos(a) * 0.24, y + 3.78, z + Math.sin(a) * 0.24, 0, 0, 0, 0.1, 0.24, 0.1));
      }
      this.b.add(BUCKET.SOLID, unitBox(), color, trs(x + 0.55, y + 1.5, z - Math.sin(ry) * 0.2, 0.5, ry, 0, 0.16, 1.7, 0.16));
      this.b.add(BUCKET.SOLID, unitBox(), color, trs(x - 0.55, y + 1.5, z + Math.sin(ry) * 0.2, 0.5, ry, 0, 0.16, 1.7, 0.16));
      this.b.add(BUCKET.SOLID, unitBox(), C.steel, trs(x, y + 0.7, z - Math.cos(ry) * 0.4, 0, ry, 0, 0.1, 1.5, 0.1));
    } else if (kind === 'warrior') {
      this.b.add(BUCKET.SOLID, unitBox(), color, trs(x, y + 1.2, z - Math.cos(ry) * 0.3, 0.3, ry, 0, 0.2, 2.2, 0.2));
      this.b.add(BUCKET.SOLID, unitBox(), color, trs(x + 0.6, y + 1.1, z, 0, ry, 0.9, 0.2, 1.8, 0.2));
      this.b.add(BUCKET.SOLID, unitBox(), C.steel, trs(x + 0.95, y + 1.7, z, 0.3, ry, 0.9, 0.5, 0.1, 0.5));
    } else if (kind === 'maiden') {
      this.b.add(BUCKET.SOLID, unitCyl(7), color, trs(x, y + 1.2, z, 0, ry, 0, 1.1, 2.4, 1.1));
      this.b.add(BUCKET.GLOW, unitCyl(7), C.candle, trs(x, y + 2.1, z, 0, ry, 0, 0.3, 0.2, 0.3));
    }
    const s = 1.0;
    physics.add(x - s, x + s, y, y + 3.6, z - s, z + s, 'estatua');
  }
  sarcophagus(x, y, z, ry = 0, lidOpen = false) {
    this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark, trs(x, y + 0.9, z, 0, ry, 0, 1.5, 0.4, 3.0));
    this.deco(x - 0.75, x + 0.75, y, y + 0.8, z - 1.5, z + 1.5, C.stoneDark);
    const off = lidOpen ? 0.8 : 0;
    this.b.add(BUCKET.SOLID, unitBox(), C.stone, trs(x + off, y + 1.24, z, 0, ry, 0.06 * (lidOpen ? 1 : 0), 1.2, 0.3, 2.6));
    const cs = Math.abs(Math.cos(ry)), sn = Math.abs(Math.sin(ry));
    const ex = 0.75 * cs + 1.5 * sn, ez = 0.75 * sn + 1.5 * cs;
    physics.add(x - ex - off, x + ex + off, y, y + 1.4, z - ez, z + ez, 'sarcofago');
  }
  well(x, z) {
    this.cylSolid(1.3, 1.1, x, 0, z, C.stone, 10);
    this.b.add(BUCKET.SOLID, unitCyl(10), 0x0a0c10, trs(x, 1.14, z, 0, 0, 0, 2.2, 0.1, 2.2));
    this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(x, 2.0, z, 0, 0, 0, 0.2, 2.4, 0.2));
    this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(x, 3.1, z, 0, 0, 0, 2.4, 0.18, 0.18));
    this.b.add(BUCKET.SOLID, unitCyl(6), C.woodDark, trs(x, 2.7, z, 0, 0, Math.PI / 2, 0.22, 1.2, 0.22));
    this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(x, 2.0, z, 0, 0, 0, 0.34, 0.5, 0.34));
  }
  cart(x, z, ry = 0) {
    this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(x, 0.85, z, 0, ry, 0, 2.6, 0.24, 1.4));
    for (const s of [-1, 1]) {
      this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x - Math.sin(ry) * 0.68, 1.15, z - Math.cos(ry) * 0.68 * s, 0, ry, 0, 2.4, 0.6, 0.1));
    }
    for (const [dx, dz] of [[-0.9, -0.75], [0.9, -0.75], [-0.9, 0.75], [0.9, 0.75]]) {
      const ox = dx * Math.cos(ry) - dz * Math.sin(ry), oz = dx * Math.sin(ry) + dz * Math.cos(ry);
      this.b.add(BUCKET.SOLID, unitCyl(8), C.woodDark, trs(x + ox, 0.5, z + oz, 0, ry, Math.PI / 2, 0.95, 0.14, 0.95));
    }
    this.pbox(x - 1.4, x + 1.4, 0, 1.5, z - 1.0, z + 1.0, 'carroca');
  }
  stall(x, z, ry = 0) {
    this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(x, 0.9, z, 0, ry, 0, 3.0, 0.16, 1.4));
    for (const s of [-1, 1]) {
      this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x - Math.sin(ry) * 0.7 - Math.cos(ry) * 1.4 * s, 1.3, z - Math.cos(ry) * 0.7 + Math.sin(ry) * 1.4 * s, 0, ry, 0, 0.14, 2.6, 0.14));
    }
    this.b.add(BUCKET.SOLID, unitBox(), C.clothRed, trs(x, 2.7, z, 0, ry, 0.04, 3.4, 0.1, 1.9));
    const col = [C.clothRed, C.clothBlue, C.clothGreen, C.gold, C.wine];
    for (let i = 0; i < 7; i++) {
      const ox = -1.2 + i * 0.4;
      this.b.add(BUCKET.SOLID, unitSphere(5), col[i % 5], trs(x + Math.cos(ry) * ox, 1.05, z + Math.sin(ry) * ox, 0, 0, 0, 0.22, 0.22, 0.22));
    }
    this.pbox(x - 1.7, x + 1.7, 0, 1.0, z - 0.9, z + 0.9, 'banca');
  }
  fence(x0, z0, x1, z1, h = 1.3, color = C.woodDark) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), n = Math.max(2, Math.round(len / 2));
    const ry = Math.atan2(dz, dx);
    for (let i = 0; i <= n; i++) {
      const t = i / n, px = x0 + dx * t, pz = z0 + dz * t;
      this.b.add(BUCKET.SOLID, unitBox(), color, trs(px, h / 2, pz, 0, -ry, 0, 0.13, h, 0.13));
    }
    this.b.add(BUCKET.SOLID, unitBox(), color, trs((x0 + x1) / 2, h * 0.85, (z0 + z1) / 2, 0, -ry, 0, len, 0.1, 0.08));
    this.b.add(BUCKET.SOLID, unitBox(), color, trs((x0 + x1) / 2, h * 0.45, (z0 + z1) / 2, 0, -ry, 0, len, 0.1, 0.08));
    const pad = 0.2;
    physics.add(Math.min(x0, x1) - pad, Math.max(x0, x1) + pad, 0, h, Math.min(z0, z1) - pad, Math.max(z0, z1) + pad, 'cerca');
  }
  tree(x, z, scale = 1, kind = 'oak', y = null) {
    const gy = y === null ? terrainHeight(x, z) : y;
    const h = (kind === 'pine' ? 7 : 5.2) * scale;
    const r = rng(Math.round(x * 13.7 + z * 7.3) + 7);
    const trunkC = kind === 'pine' ? 0x3a2b1d : 0x4a3626;
    this.cylSolid(0.26 * scale, h, x, gy - 0.3, z, trunkC, 7, BUCKET.SOLID, false);
    physics.add(x - 0.5 * scale, x + 0.5 * scale, gy - 0.3, gy + h, z - 0.5 * scale, z + 0.5 * scale, 'tronco');
    if (kind === 'pine') {
      const n = 4;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        this.b.add(BUCKET.LEAF, unitCone(7), i % 2 ? C.scaleDark : C.scale,
          trs(x, gy + h * (0.42 + t * 0.62), z, 0, r() * 3, 0, (2.6 - t * 1.5) * scale, (3.4 - t * 1.3) * scale, (2.6 - t * 1.5) * scale));
      }
    } else {
      const n = 3;
      for (let i = 0; i < n; i++) {
        this.b.add(BUCKET.LEAF, unitSphere(6), i % 2 ? 0x2c3a22 : 0x384a28,
          trs(x + (r() - 0.5) * 1.6 * scale, gy + h * (0.85 + i * 0.14), z + (r() - 0.5) * 1.6 * scale, 0, r() * 3, 0,
            (3.4 - i * 0.5) * scale, (2.6 - i * 0.4) * scale, (3.4 - i * 0.5) * scale));
      }
    }
  }
  bush(x, z, s = 1, y = null) {
    const gy = y === null ? terrainHeight(x, z) : y;
    this.b.add(BUCKET.LEAF, unitSphere(5), 0x2f3d22, trs(x, gy + 0.3 * s, z, 0, 0, 0, 1.5 * s, 0.9 * s, 1.5 * s));
    this.b.add(BUCKET.LEAF, unitSphere(5), 0x3b4a28, trs(x + 0.3 * s, gy + 0.5 * s, z - 0.2 * s, 0, 0, 0, 0.9 * s, 0.7 * s, 0.9 * s));
  }
  house(x, z, w, d, h, ry, opts = {}) {
    const gy = terrainHeight(x, z);
    const wallC = opts.wall || [0x4d4438, 0x3f3a33, 0x54483a, 0x453f36][Math.abs(Math.round(x + z)) % 4];
    this.solid(x - w / 2, x + w / 2, gy - 0.4, gy + h, z - d / 2, z + d / 2, wallC);
    // telhado de duas águas
    this.b.add(BUCKET.SOLID, unitPrism(), opts.roof || C.thatch,
      trs(x, gy + h + d * 0.28, z, 0, ry, 0, w + 0.5, d * 0.62, d + 0.6));
    // vigas de madeira
    for (const s of [-0.5, 0, 0.5]) {
      this.b.add(BUCKET.SOLID, unitBox(), C.woodDark,
        trs(x + Math.cos(ry) * w * s, gy + h / 2, z + Math.sin(ry) * w * s, 0, ry, 0, 0.16, h, d + 0.14));
    }
    // porta
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark,
      trs(x - Math.sin(ry) * (d / 2 + 0.06), gy + 1.0, z - Math.cos(ry) * (d / 2 + 0.06), 0, ry, 0, 1.0, 2.0, 0.12));
    // janelas iluminadas
    if (opts.lit !== false) {
      for (const s of [-1, 1]) {
        this.b.add(BUCKET.GLOW, unitBox(), 0xffb861,
          trs(x - Math.sin(ry) * (d / 2 + 0.06) + Math.cos(ry) * w * 0.28 * s, gy + 1.7, z - Math.cos(ry) * (d / 2 + 0.06) + Math.sin(ry) * w * 0.28 * s, 0, ry, 0, 0.6, 0.7, 0.1));
      }
    }
    this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark,
      trs(x + Math.cos(ry) * w * 0.3, gy + h + d * 0.4, z + Math.sin(ry) * w * 0.3, 0, ry, 0, 0.5, 1.6, 0.5));
    if (opts.collide !== false) physics.add(x - w / 2 - 0.2, x + w / 2 + 0.2, gy, gy + h, z - d / 2 - 0.2, z + d / 2 + 0.2, 'casa');
    return gy + h;
  }
  towerRound(x, z, y, r, h, color = C.stone, roof = true, ry0 = 0) {
    const seg = 12;
    this.cylSolid(r, h, x, y, z, color, seg);
    // ameias
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.b.add(BUCKET.SOLID, unitBox(), C.stoneLight,
        trs(x + Math.cos(a) * (r + 0.05), y + h + 0.4, z + Math.sin(a) * (r + 0.05), 0, -a, 0, 0.5, 0.9, 0.5));
    }
    this.b.add(BUCKET.SOLID, unitCyl(seg), C.stoneDark, trs(x, y + h + 0.1, z, 0, 0, 0, r * 2.3, 0.5, r * 2.3));
    if (roof) this.b.add(BUCKET.SOLID, unitCone(seg), C.roofSlate, trs(x, y + h + 2.2, z, 0, ry0, 0, r * 1.5, 3.6, r * 1.5));
    // seteiras
    for (let i = 0; i < 3; i++) {
      const a = i * 1.1 + 0.3;
      this.b.add(BUCKET.SOLID, unitBox(), 0x0c0e12,
        trs(x + Math.cos(a) * (r * 0.98), y + h * (0.35 + i * 0.2), z + Math.sin(a) * (r * 0.98), 0, -a, 0, 0.22, 1.0, 0.35));
    }
  }
  crenellations(x0, x1, z0, z1, y, color = C.stoneLight) {
    const step = 1.7;
    for (let x = x0 + 0.4; x < x1; x += step) {
      this.b.add(BUCKET.SOLID, unitBox(), color, trs(x, y + 0.5, z0 + 0.5, 0, 0, 0, 1.1, 1.0, 0.9));
      this.b.add(BUCKET.SOLID, unitBox(), color, trs(x, y + 0.5, z1 - 0.5, 0, 0, 0, 1.1, 1.0, 0.9));
    }
    for (let z = z0 + 0.4; z < z1; z += step) {
      this.b.add(BUCKET.SOLID, unitBox(), color, trs(x0 + 0.5, y + 0.5, z, 0, 0, 0, 0.9, 1.0, 1.1));
      this.b.add(BUCKET.SOLID, unitBox(), color, trs(x1 - 0.5, y + 0.5, z, 0, 0, 0, 0.9, 1.0, 1.1));
    }
  }

  /* ================= CONSTRUÇÃO ================= */
  build() {
    this.terrain();
    this.cryptAndDungeon();
    this.keepShell();
    this.tower();
    this.floor0();
    this.floor1();
    this.floor2();
    this.roof();
    this.courtyards();
    buildRealm(this);
    this.skyDome();
    this.b.finalize(this.group, {
      [BUCKET.SOLID]: MAT_LIT,
      [BUCKET.GLOW]: MAT_GLOW,
      [BUCKET.GLOWFOG]: MAT_GLOW_FOG,
      [BUCKET.LEAF]: MAT_LEAF,
      [BUCKET.WATER]: MAT_SMOOTH,
    });
    this.physics.bounds = 258;
    return this;
  }

  terrain() {
    const SIZE = 520, SEG = 156;
    const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      // inclinação aproximada
      const s = Math.abs(terrainHeight(x + 1.6, z) - h) + Math.abs(terrainHeight(x, z + 1.6) - h);
      const n = Math.sin(x * 0.31) * Math.cos(z * 0.27) * 0.5 + Math.sin(x * 0.07 + z * 0.11) * 0.5;
      let base;
      if (h < -1.9) base = col.set(C.mud).multiplyScalar(0.7);
      else if (h < -0.45) base = col.set(C.sand).multiplyScalar(0.85);
      else if (s > 1.5 || h > 15) base = col.set(C.rock);
      else if (h > 26) base = col.set(0x6a6f78);
      else base = col.set(C.grass).lerp(new THREE.Color(C.grassDry), clamp(n * 0.6 + 0.4, 0, 1));
      base.multiplyScalar(0.86 + n * 0.16);
      colors[i * 3] = base.r; colors[i * 3 + 1] = base.g; colors[i * 3 + 2] = base.b;
      if (h > -0.45 && h < -0.35) { colors[i * 3] *= 0.75; colors[i * 3 + 1] *= 0.8; colors[i * 3 + 2] *= 0.8; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.name = 'terrain';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    g.computeBoundingSphere();
    this.group.add(mesh);
    this.terrainMesh = mesh;
  }

  skyDome() {
    const g = new THREE.SphereGeometry(430, 24, 16);
    const colors = new Float32Array(g.attributes.position.count * 3);
    const c1 = new THREE.Color(0x080a12), c2 = new THREE.Color(0x2a1f2e), c3 = new THREE.Color(0x6b3a2e);
    const col = new THREE.Color();
    for (let i = 0; i < g.attributes.position.count; i++) {
      const y = g.attributes.position.getY(i) / 430;
      const t = clamp((y + 0.25) / 1.05, 0, 1);
      col.copy(c3).lerp(c2, clamp(t * 2.4, 0, 1)).lerp(c1, clamp((t - 0.4) * 1.9, 0, 1));
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const dome = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
    dome.name = 'sky';
    g.computeBoundingSphere();
    dome.position.y = -40;
    dome.matrixAutoUpdate = false;
    dome.updateMatrix();
    this.group.add(dome);
    this.sky = dome;
  }

  /* ---------- Cripta + Masmorra ---------- */
  cryptAndDungeon() {
    const CY0 = -4.5, CY1 = 0;
    // piso
    this.slab(-4, 0.5, [[-11, 19, -17, -2.5]], C.stoneDark);
    // teto do subsolo / piso térreo do castelo
    const keepCeil = subtractRect([KEEP.x0, KEEP.x1, KEEP.z0, KEEP.z1], [11.85, 13.45, -8.6, -4.3]);
    this.slab(0.02, 0.52, keepCeil, C.stoneDark);
    this.slab(0.02, 0.52, [[-11, 19, -17, -12]], C.stoneDark);
    // paredes da cripta
    this.wallZ(-17, -2.5, -11, CY0, CY1, 0.6, C.stoneDark);
    this.wallX(-11, 19, -17, CY0, CY1, 0.6, C.stoneDark);
    this.wallX(-11, 13.5, -2.5, CY0, CY1, 0.6, C.stoneDark);
    this.wallZ(-17, -12, 19, CY0, CY1, 0.6, C.stoneDark);
    this.wallX(13.5, 19, -12, CY0, CY1, 0.6, C.stoneDark);
    // divisória cripta/masmorra (passagem para a masmorra + vão da escadaria)
    this.wallZ(-17, -2.5, 11, CY0, CY1, 0.5, C.stoneDark, [
      { a0: -15.6, a1: -13.4, y0: CY0, y1: -0.9 },
      { a0: -8.6, a1: -4.6, y0: CY0, y1: -0.9 },
    ]);
    // parede leste da escadaria (e vedação do vão norte da torre)
    this.wallZ(-7.5, -2.5, 13.5, CY0, CY1, 0.5, C.stoneDark);
    this.wallZ(-12, -7.5, 13.5, CY0, CY1, 0.5, C.stoneDark);
    // escada de descida: topo ao sul (junto ao salão de armas), desce para o norte
    this.stair(11.9, 13.4, -8.6, 4.3, -4, 0, 16, C.stoneDark, 1, C.rockDark);
    // corredor de acesso no nível da cripta
    // decoração: colunas, sarcófagos, velas
    for (let i = 0; i < 4; i++) {
      const x = -8 + i * 5.2;
      this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark, trs(x, -1.6, -11.2, 0, 0, 0, 1.1, 4.9, 1.1));
      this.b.add(BUCKET.SOLID, unitBox(), C.stone, trs(x, -4.2, -11.2, 0, 0, 0, 1.4, 0.7, 1.4));
      this.b.add(BUCKET.SOLID, unitBox(), C.stone, trs(x, 0.62, -11.2, 0, 0, 0, 1.4, 0.5, 1.4));
      physics.add(x - 0.6, x + 0.6, -4.5, 0.2, -11.8, -10.6, 'coluna');
    }
    for (let i = 0; i < 6; i++) {
      const x = -9.2 + i * 3.6;
      this.sarcophagus(x, -4, -15.2, 0, i === 2);
    }
    for (let i = 0; i < 4; i++) this.sarcophagus(-9.5, -4, -6 + i * 3.4, Math.PI / 2);
    this.statue(8.4, -4, -15.4, C.stoneDark, -0.6, 'king');
    this.statue(8.4, -4, -4.6, C.stoneDark, Math.PI, 'maiden');
    this.torch(-10.2, -1.6, -8.5, Math.PI / 2, true);
    this.torch(-10.2, -1.6, -14.0, Math.PI / 2);
    this.torch(10.2, -1.6, -8.5, -Math.PI / 2, true);
    this.torch(10.2, -1.6, -14.0, -Math.PI / 2);
    this.brazier(-2, -4, -13.8, true);
    this.brazier(4.5, -4, -9.0, true);
    for (let i = 0; i < 5; i++) this.candle(-6 + i * 3, -3.55, -16.6);
    // corredor para a masmorra: cela e correntes
    for (let i = 0; i < 3; i++) {
      const x = 13 + i * 2.2;
      this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark, trs(x, -2.2, -14.5, 0, 0, 0, 2.0, 4.6, 0.22));
      this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(x + 1.1, -2.2, -14.5, 0, 0, 0, 0.14, 4.6, 0.24));
    }
    this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark, trs(16, -2.2, -16.6, 0, 0, 0, 6.4, 4.6, 0.3));
    // ossos, baldes, correntes
    for (let i = 0; i < 7; i++) {
      const r = rng(900 + i)();
      this.b.add(BUCKET.SOLID, unitCyl(5), C.bone, trs(12.5 + i * 0.7, -3.9, -13.6 + r * 2, Math.PI / 2, r * 3, 0, 0.1, 0.4, 0.1));
    }
    this.b.add(BUCKET.SOLID, unitCyl(8), C.wood, trs(15.6, -3.55, -13.2, 0, 0, 0, 1.2, 0.9, 1.2));
    this.candle(15.6, -3.1, -13.2);
    // adega: barris e prateleiras
    for (let i = 0; i < 8; i++) {
      this.barrel(12.6 + (i % 4) * 1.5, -16.4 + Math.floor(i / 4) * 1.5, 0.42, 0.9, -4);
    }
    this.crate(18.4, -4, -13.6, 0.9);
    this.crate(18.4, -4, -14.6, 0.8, C.woodDark);
    this.light(16, -2.4, -14.5, 0xff8c34, 7, 12, 0.3);
  }

  /* ---------- Casca do castelo (paredes externas) ---------- */
  keepShell() {
    // paredes externas do keep, contínuas de 0 a 12
    // SUL (z = 12): portão principal + janelas
    this.wallX(KEEP.x0, KEEP.x1, KEEP.z1, 0, FLOOR.roof, T_EXT, C.stone, [
      { a0: 6, a1: 10, y0: 0, y1: 3.6 },
      { a0: -12, a1: -11.2, y0: WIN_B, y1: WIN_T },
      { a0: -4, a1: -3.2, y0: WIN_B, y1: WIN_T },
      { a0: -11.5, a1: -10.5, y0: WIN1_B, y1: WIN1_T },
      { a0: -7, a1: -6, y0: WIN1_B, y1: WIN1_T },
      { a0: 3, a1: 4, y0: WIN1_B, y1: WIN1_T },
      { a0: 8, a1: 9, y0: WIN1_B, y1: WIN1_T },
      { a0: -11.5, a1: -10.5, y0: WIN2_B, y1: WIN2_T },
      { a0: -6, a1: -5, y0: WIN2_B, y1: WIN2_T },
      { a0: 3, a1: 4, y0: WIN2_B, y1: WIN2_T },
      { a0: 9, a1: 10, y0: WIN2_B, y1: WIN2_T },
    ]);
    // NORTE (z = -12)
    this.wallX(KEEP.x0, KEEP.x1, KEEP.z0, 0, FLOOR.roof, T_EXT, C.stone, [
      { a0: -12, a1: -11.2, y0: WIN_B, y1: WIN_T },
      { a0: -4, a1: -3.2, y0: WIN_B, y1: WIN_T },
      { a0: 9, a1: 9.8, y0: WIN_B, y1: WIN_T },
      { a0: -11.5, a1: -9.5, y0: WIN1_B, y1: WIN1_T },
      { a0: -8, a1: -6.5, y0: WIN1_B, y1: WIN1_T },
      { a0: -11.5, a1: -9.5, y0: WIN2_B, y1: WIN2_T },
      { a0: 5, a1: 6.5, y0: WIN1_B, y1: WIN1_T },
      { a0: -3, a1: -2, y0: WIN2_B, y1: WIN2_T },
      { a0: 4, a1: 5, y0: WIN2_B, y1: WIN2_T },
      { a0: 10, a1: 11, y0: WIN2_B, y1: WIN2_T },
      { a0: 8, a1: 9, y0: WIN1_B, y1: WIN1_T },
    ]);
    // OESTE (x = -14): porta para o pátio de treino
    this.wallZ(KEEP.z0, KEEP.z1, KEEP.x0, 0, FLOOR.roof, T_EXT, C.stone, [
      { a0: -1.6, a1: 1.6, y0: 0, y1: 3.4 },
      { a0: -9, a1: -8.2, y0: WIN_B, y1: WIN_T },
      { a0: 6, a1: 6.8, y0: WIN_B, y1: WIN_T },
      { a0: -9.6, a1: -8.4, y0: WIN1_B, y1: WIN1_T },
      { a0: -5, a1: -4, y0: WIN1_B, y1: WIN1_T },
      { a0: 5, a1: 6.5, y0: WIN1_B, y1: WIN1_T },
      { a0: -9.6, a1: -8.4, y0: WIN2_B, y1: WIN2_T },
      { a0: 4, a1: 5.4, y0: WIN2_B, y1: WIN2_T },
      { a0: 8.5, a1: 9.6, y0: WIN2_B, y1: WIN2_T },
    ]);
    // LESTE (x = 14): portas para a torre da escadaria (1,6 m de vão livre)
    this.wallZ(KEEP.z0, KEEP.z1, KEEP.x1, 0, FLOOR.roof, T_EXT, C.stone, [
      { a0: -2.0, a1: -0.4, y0: 0, y1: 3.2 },
      { a0: -2.0, a1: -0.4, y0: FLOOR.first, y1: FLOOR.first + 3.2 },
      { a0: -2.0, a1: -0.4, y0: FLOOR.second, y1: FLOOR.second + 3.2 },
      { a0: -10.5, a1: -9.5, y0: WIN_B, y1: WIN_T },
      { a0: 5.5, a1: 6.5, y0: WIN_B, y1: WIN_T },
      { a0: -10.5, a1: -9.5, y0: WIN1_B, y1: WIN1_T },
      { a0: 5.5, a1: 6.5, y0: WIN1_B, y1: WIN1_T },
      { a0: -10.5, a1: -9.5, y0: WIN2_B, y1: WIN2_T },
      { a0: 5.5, a1: 6.5, y0: WIN2_B, y1: WIN2_T },
    ]);
    // rodapé / faixa de pedra entre andares
    for (const [y0, y1] of [[3.7, 4.0], [7.7, 8.0]]) {
      this.b.add(BUCKET.SOLID, unitBox(), C.stoneLight, trs(0, (y0 + y1) / 2, KEEP.z1 + 0.06, 0, 0, 0, KEEP.x1 - KEEP.x0 + 0.4, y1 - y0, 0.2));
      this.b.add(BUCKET.SOLID, unitBox(), C.stoneLight, trs(0, (y0 + y1) / 2, KEEP.z0 - 0.06, 0, 0, 0, KEEP.x1 - KEEP.x0 + 0.4, y1 - y0, 0.2));
      this.b.add(BUCKET.SOLID, unitBox(), C.stoneLight, trs(KEEP.x0 - 0.06, (y0 + y1) / 2, 0, 0, 0, 0, 0.2, y1 - y0, KEEP.z1 - KEEP.z0 + 0.4));
      this.b.add(BUCKET.SOLID, unitBox(), C.stoneLight, trs(KEEP.x1 + 0.06, (y0 + y1) / 2, 0, 0, 0, 0, 0.2, y1 - y0, KEEP.z1 - KEEP.z0 + 0.4));
    }
    // contrafortes decorativos
    for (const z of [-10, -6, -2, 2, 6, 10]) {
      this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark, trs(KEEP.x0 - 0.35, 2.4, z, 0, 0, 0, 0.7, 4.8, 1.2));
      this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark, trs(KEEP.x1 + 0.35, 2.4, z, 0, 0, 0, 0.7, 4.8, 1.2));
    }
  }

  /* ---------- Torre da escadaria (leste) ----------
   *  Planta: corredor fixo a oeste (x 14.25–15.6) sempre com piso,
   *  lance A (x 15.6–17.0) subindo ao norte do térreo ao 1º andar,
   *  lance B (x 17.0–18.4) subindo ao sul do 1º ao 2º andar.
   *  Assim cada porta do castelo abre no corredor e nunca num vão. */
  tower() {
    const x0 = 14, x1 = 20, z0 = -8, z1 = 0;
    const LANE_A = [15.6, 17.0], LANE_B = [17.0, 18.4];
    // paredes externas da torre
    this.wallZ(z0, z1, x1, 0, FLOOR.roof, T_EXT, C.stoneWarm, [
      { a0: -5.5, a1: -4.5, y0: WIN_B, y1: WIN_T },
      { a0: -4, a1: -3, y0: WIN1_B, y1: WIN1_T },
      { a0: -5.5, a1: -4.5, y0: WIN1_B, y1: WIN1_T },
      { a0: -3, a1: -2, y0: WIN2_B, y1: WIN2_T },
      { a0: -5.5, a1: -4.5, y0: WIN2_B, y1: WIN2_T },
    ]);
    this.wallX(x0, x1, z0, 0, FLOOR.roof, T_EXT, C.stoneWarm, [
      { a0: 15, a1: 16, y0: WIN_B, y1: WIN_T },
      { a0: 15, a1: 16, y0: WIN1_B, y1: WIN1_T },
      { a0: 18, a1: 19, y0: WIN1_B, y1: WIN1_T },
      { a0: 15, a1: 16, y0: WIN2_B, y1: WIN2_T },
      { a0: 18, a1: 19, y0: WIN2_B, y1: WIN2_T },
    ]);
    this.wallX(x0, x1, z1, 0, FLOOR.roof, T_EXT, C.stoneWarm, [
      { a0: 15, a1: 16, y0: WIN_B, y1: WIN_T },
      { a0: 17, a1: 18, y0: WIN1_B, y1: WIN1_T },
      { a0: 15, a1: 16, y0: WIN2_B, y1: WIN2_T },
    ]);
    // pisos: térreo (laje) + 1º e 2º andares com os vãos dos lances
    const interior = [x0, x1 - T_EXT, z0 + T_EXT, z1 - T_EXT];
    this.slab(0.02, 0.52, [[interior[0], interior[1], interior[2], interior[3]]], C.stoneWarm);
    this.slab(FLOOR.first, 0.5, subtractRect(interior, [LANE_A[0], LANE_A[1], -6.6, -2.3]), C.stoneWarm);
    this.slab(FLOOR.second, 0.5, subtractRect(interior, [LANE_B[0], LANE_B[1], -6.6, -2.3]), C.stoneWarm);
    this.slab(FLOOR.roof, 0.5, [[x0 - 0.5, 20.5, z0 - 0.5, z1 + 0.5]], C.stoneWarm);
    this.b.add(BUCKET.SOLID, unitCone(12), C.roofSlate, trs(17, 16.2, -4, 0, 0.4, 0, 8.2, 6.2, 8.2));
    this.b.add(BUCKET.SOLID, unitCyl(6), C.gold, trs(17, 19.4, -4, 0, 0, 0, 0.4, 0.8, 0.4));
    // lances de escada
    this.stair(LANE_A[0] + 0.05, LANE_A[1] - 0.05, -2.3, 4.3, 0, FLOOR.first, 16, C.stoneWarm, -1, C.stoneDark);
    this.stair(LANE_B[0] + 0.05, LANE_B[1] - 0.05, -6.6, 4.3, FLOOR.first, FLOOR.second, 16, C.stoneWarm, 1, C.stoneDark);
    // corrimãos do corredor (borda leste, virada para o vão do lance A)
    for (const y of [0.95, FLOOR.first + 0.95, FLOOR.second + 0.95]) {
      this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(LANE_A[0] - 0.06, y, -4.45, 0, 0, 0, 0.09, 0.09, 4.4));
      for (let i = 0; i < 4; i++) {
        this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(LANE_A[0] - 0.06, y - 0.4, -6.35 + i * 1.35, 0, 0, 0, 0.09, 0.85, 0.09));
      }
    }
    // tochas da torre
    this.torch(19.2, 0.9, -1.0, -Math.PI / 2, true);
    this.torch(19.2, FLOOR.first + 0.9, -6.6, -Math.PI / 2);
    this.torch(19.2, FLOOR.second + 0.9, -1.0, -Math.PI / 2, true);
    this.light(15.0, FLOOR.first + 2.2, -4.8, 0xffa050, 6, 12, 0.2);
    this.light(15.0, FLOOR.second + 2.2, -4.8, 0xffa050, 6, 12, 0.2);
    // arcos de pedra sobre as três portas do castelo
    for (const y of [0, FLOOR.first, FLOOR.second]) {
      this.b.add(BUCKET.SOLID, unitCyl(10), C.stoneLight, trs(14, y + 3.2, -1.2, 0, 0, Math.PI / 2, 1.5, 0.5, 1.5));
    }
  }

  /* ---------- ANDAR TÉRREO ---------- */
  floor0() {
    this.setLevel(FLOOR.ground);
    // Grade de paredes internas: corredores em cruz
    const y0 = FLOOR.ground, y1 = FLOOR.first;
    const door = (a0, a1) => ({ a0, a1, y0, y1: y0 + DOOR_H });
    const win = (a0, a1) => ({ a0, a1, y0: y0 + 2.2, y1: y0 + 3.4 });
    // corredor N-S: x = ±2.5
    this.wallZ(-11.5, -2.5, -2.5, y0, y1, T_INT, C.stoneDark, [{ a0: -7.5, a1: -4.8, y0, y1: y0 + DOOR_H }]);
    this.wallZ(-11.5, -2.5, 2.5, y0, y1, T_INT, C.stoneDark, [door(-8.2, -6.2)]);
    this.wallZ(2.5, 11.5, -2.5, y0, y1, T_INT, C.stoneDark, [door(4.2, 6.2), door(8.5, 10.5)]);
    this.wallZ(2.5, 11.5, 2.5, y0, y1, T_INT, C.stoneDark, [door(4.2, 6.2), door(8.5, 10.5)]);
    // corredor E-O: z = ±2.5
    this.wallX(-13.5, -2.5, -2.5, y0, y1, T_INT, C.stoneDark, [{ a0: -9, a1: -3.2, y0, y1: y0 + 3.6 }]);
    this.wallX(2.5, 13.5, -2.5, y0, y1, T_INT, C.stoneDark, [door(3.6, 5.6)]);
    this.wallX(-13.5, -2.5, 2.5, y0, y1, T_INT, C.stoneDark, [door(-11.2, -9.2), door(-6, -4)]);
    this.wallX(2.5, 13.5, 2.5, y0, y1, T_INT, C.stoneDark, [door(5.2, 7.2)]);
    // cozinha / servos
    this.wallX(-13.5, -2.5, 7, y0, y1, T_INT, C.stoneDark, [door(-9, -7)]);
    this.wallZ(2.5, 7, -8.0, y0, y1, T_INT, C.stoneDark, []);
    // guarda / vestíbulo
    this.wallX(2.5, 13.5, 7, y0, y1, T_INT, C.stoneDark, [door(4, 6)]);
    this.wallZ(7, 11.5, 6.5, y0, y1, T_INT, C.stoneDark, [door(8.6, 10.4)]);

    // ---- Grande Salão (NW) ----
    this.banner(-13.4, 0.5, -6, C.banner, Math.PI / 2, 1.6, 3.6);
    this.banner(-13.4, 0.5, 2, C.banner, Math.PI / 2, 1.6, 3.6);
    this.banner(-2.6, 0.5, -6, C.banner, -Math.PI / 2, 1.6, 3.6);
    this.banner(0, 0.5, -11.4, C.banner, 0, 1.6, 3.6);
    this.banner(4, 0.5, -11.4, C.banner, 0, 1.6, 3.6);
    this.rug(-8, -6, 9, 8, C.wine, 0.03);
    for (let i = 0; i < 3; i++) {
      const z = -9 + i * 3.2;
      this.table(-6.5, z, 4.4, 1.1, 0);
      this.bench(-6.5, z - 1.0, 4.0, 0);
      this.bench(-6.5, z + 1.0, 4.0, 0);
      for (let j = 0; j < 3; j++) this.candle(-7.8 + j * 1.4, 0.9, z);
    }
    this.table(-11.5, -10, 2.0, 1.0, 0.4);
    this.table(-11.6, -3.6, 2.0, 1.0, -0.3);
    this.chandelier(-6.5, 6.4, -6.5);
    this.brazier(-12.4, 0, -11.4);
    this.brazier(-12.4, 0, -2.8);
    // lareira
    this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark, trs(-13.2, 1.6, -6, 0, 0, 0, 1.0, 3.2, 3.0));
    this.b.add(BUCKET.SOLID, unitBox(), 0x0a0c10, trs(-12.6, 0.6, -6, 0, 0, 0, 0.7, 1.2, 1.6));
    this.b.add(BUCKET.GLOW, unitCone(7), C.fire, trs(-12.3, 0.5, -6, 0, 0, 0, 0.7, 1.0, 1.2));
    this.light(-12.0, 1.2, -6, 0xff8a30, 12, 16, 0.4);
    // trono vazio do salão? não — mesa alta do rei
    this.table(-3.6, -11, 1.2, 2.6, 0);
    this.chair(-4.6, -11, Math.PI / 2);
    this.spawns.hall = new THREE.Vector3(-7, 0, -6);

    // ---- Cozinha (SW) ----
    for (let i = 0; i < 4; i++) this.barrel(-12.8 + i * 0.95, 6.4, 0.4, 0.95);
    for (let i = 0; i < 3; i++) this.crate(-12.6, 0, 3.6 + i * 0.95, 0.85, i % 2 ? C.wood : C.woodDark);
    this.table(-9.6, 4.6, 3.2, 1.3, 0, 0.9);
    this.cauldron(-11.0, 5.6);
    this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark, trs(-13.3, 1.2, 4.4, 0, 0, 0, 1.0, 2.4, 3.6));
    this.b.add(BUCKET.GLOW, unitBox(), C.ember, trs(-12.7, 0.5, 4.4, 0, 0, 0, 0.5, 0.9, 1.6));
    this.light(-12.0, 1.0, 4.4, 0xff7a28, 8, 12, 0.35);
    for (let i = 0; i < 5; i++) this.candle(-11 + i * 0.6, 0.9, 3.2);
    this.b.add(BUCKET.SOLID, unitCyl(5), C.clothWhite, trs(-8.4, 3.1, 5.4, 0, 0, 0, 0.3, 0.7, 0.3));
    this.b.add(BUCKET.SOLID, unitCyl(5), C.clothWhite, trs(-8.9, 3.0, 5.9, 0, 0, 0, 0.3, 0.5, 0.3));
    this.torch(-7.2, 2.4, 2.8, 0, true);
    this.spawns.kitchen = new THREE.Vector3(-9.5, 0, 4.2);

    // ---- Aposentos dos Servos (SW-sul) ----
    for (let i = 0; i < 4; i++) this.bed(-13 + i * 1.35, 9.4 + (i % 2) * 1.7, 0);
    this.table(-5.2, 9.0, 1.4, 1.0, 0.3);
    this.crate(-3.6, 0, 11.0, 0.9);
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(-9.6, 1.5, 11.3, 0, 0, 0, 2.6, 0.1, 0.5));
    this.b.add(BUCKET.SOLID, unitCyl(5), C.brass, trs(-9.0, 1.7, 11.3, 0, 0, 0, 0.4, 0.3, 0.4));
    this.torch(-3.2, 2.4, 8.0, 0);
    this.spawns.servants = new THREE.Vector3(-10, 0, 9.5);

    // ---- Salão de Armas (NE) ----
    this.rack(6.5, -10.5, 0);
    this.rack(10.5, -10.5, 0);
    this.rack(12.6, -6.5, Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      this.b.add(BUCKET.SOLID, unitCyl(6), i % 2 ? C.blood : C.iron, trs(4.2 + i * 0.55, 0.65, -6.2, 0, 0, 0, 0.55, 1.3, 0.55));
    }
    this.table(9, -5.5, 2.6, 1.2, 0.2);
    this.b.add(BUCKET.SOLID, unitBox(), C.ironLight, trs(9, 1.05, -5.5, 0.1, 0, 0, 1.4, 0.08, 0.5));
    this.anvil(4.6, -3.6);
    this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark, trs(12.6, 1.1, -8.6, 0, 0, 0, 1.4, 2.2, 1.4));
    this.b.add(BUCKET.GLOW, unitCone(7), C.fire, trs(12.6, 2.2, -8.6, 0, 0, 0, 0.5, 0.6, 0.5));
    this.light(12.6, 2.4, -8.6, 0xff7020, 9, 12, 0.45);
    this.torch(3.4, 2.4, -2.9, 0, true);
    this.torch(13.2, 2.4, -11.2, 0);
    // corrimão em volta do vão da escada da cripta
    this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(10.0, 0.55, -6.45, 0, 0, 0, 0.12, 1.1, 4.3));
    for (let i = 0; i < 6; i++) this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(10.0, 0.5, -4.4 - i * 0.8, 0, 0, 0, 0.1, 1.0, 0.1));
    physics.add(9.9, 10.1, 0, 1.1, -8.6, -4.3, 'corrimao');
    this.spawns.armory = new THREE.Vector3(6, 0, -8);

    // ---- Câmara da Guarda (SE-norte) ----
    this.b.add(BUCKET.SOLID, unitCyl(12), C.wood, trs(6, 1.6, 3.4, 0, 0, 0, 1.5, 3.2, 1.5));
    this.b.add(BUCKET.SOLID, unitCyl(12), 0x0a0c10, trs(5.9, 0.06, 3.4, 0, 0, 0, 2.6, 0.12, 2.6));
    physics.add(5.4, 6.6, 0, 3.2, 2.8, 4.0, 'mesa-redonda');
    this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(9.4, 0.6, 3.0, 0, 0, 0, 1.6, 0.12, 0.12));
    this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(10.8, 1.4, 3.0, 0, 0, 0, 2.4, 0.12, 0.12));
    this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(10.8, 2.6, 3.0, 0, 0, 0, 0.12, 2.4, 0.12));
    this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(11.6, 2.6, 3.0, 0, 0, 0, 0.12, 2.4, 0.12));
    this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(12.4, 2.6, 3.0, 0, 0, 0, 0.12, 2.4, 0.12));
    this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(9.4, 2.6, 3.0, 0, 0, 0, 0.12, 2.4, 0.12));
    this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(10.8, 3.7, 3.0, 0, 0, 0, 1.9, 0.12, 0.12));
    for (let i = 0; i < 3; i++) this.barrel(12.8, 5.6 + i * 1.1, 0.36, 0.8);
    for (let i = 0; i < 3; i++) this.chair(4.2 + i * 1.4, 5.0, Math.PI);
    this.table(5.6, 6.0, 3.4, 1.0, 0);
    this.torch(3.2, 2.4, 5.0, 0, true);
    // alçapão (decorativo)
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(13.0, 0.05, 10.6, 0, 0, 0, 1.4, 0.12, 1.4));
    this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(13.0, 0.14, 10.6, 0, 0, 0, 1.6, 0.06, 0.2));
    this.spawns.guard = new THREE.Vector3(6.5, 0, 4.6);

    // ---- Vestíbulo (SE-sul) ----
    this.rug(8, 9.5, 5, 4.4, C.wine, 0.03);
    this.banner(3.2, 4.4, 9.5, C.clothBlue, -Math.PI / 2, 1.5, 3.2);
    this.banner(12.8, 4.4, 9.5, C.clothBlue, Math.PI / 2, 1.5, 3.2);
    this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(3.6, 0.06, 9.6, 0, 0, 0, 1.0, 0.14, 4.4));
    this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(12.4, 0.06, 9.6, 0, 0, 0, 1.0, 0.14, 4.4));
    this.crate(4.4, 0, 11.2, 0.8);
    this.chest(11.6, 11.2, 0.2, C.woodDark);
    this.torch(6.4, 2.6, 11.3, 0, true);
    this.torch(9.6, 2.6, 11.3, 0, true);
    // portão interno de ferro (aberto) + grade levadiça
    for (let i = 0; i < 8; i++) {
      this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(6.2 + i * 0.5, 3.9, 11.75, 0, 0, 0, 0.1, 1.1, 0.1));
    }
    this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(8, 4.4, 11.75, 0, 0, 0, 4.2, 0.12, 0.12));
    this.b.add(BUCKET.SOLID, unitBox(), C.iron, trs(8, 3.4, 11.75, 0, 0, 0, 4.2, 0.12, 0.12));
    this.spawns.vestibule = new THREE.Vector3(8, 0, 9.5);
  }

  /* ---------- PRIMEIRO ANDAR ---------- */
  floor1() {
    this.setLevel(FLOOR.first);
    const y0 = FLOOR.first, y1 = FLOOR.second;
    const door = (a0, a1) => ({ a0, a1, y0, y1: y0 + DOOR_H });
    // piso (buraco do salão + vão da escada da torre)
    const hallHole = [KEEP.x0, -2.5, KEEP.z0, -2.5];
    this.slab(FLOOR.first, 0.5, subtractRect([KEEP.x0, KEEP.x1, KEEP.z0, KEEP.z1], hallHole), C.woodDark);
    // corrimãos do vão do salão
    this.wallZ(-11.5, -2.5, -2.5, y0, y0 + 1.15, T_INT, C.wood, [], BUCKET.SOLID);
    this.wallX(-13.5, -2.5, -2.5, y0, y0 + 1.15, T_INT, C.wood, [], BUCKET.SOLID);
    // paredes internas (mesma planta, salão agora vazio)
    this.wallZ(-11.5, -2.5, 2.5, y0, y1, T_INT, C.woodLight, [door(-8.2, -6.2)]);
    this.wallZ(2.5, 11.5, -2.5, y0, y1, T_INT, C.woodLight, [door(4.2, 6.2), door(8.5, 10.5)]);
    this.wallZ(2.5, 11.5, 2.5, y0, y1, T_INT, C.woodLight, [door(4.2, 6.2), door(8.5, 10.5)]);
    this.wallX(-13.5, -2.5, 2.5, y0, y1, T_INT, C.woodLight, [door(-11.2, -9.2), door(-6, -4)]);
    this.wallX(2.5, 13.5, -2.5, y0, y1, T_INT, C.woodLight, [door(3.6, 5.6)]);
    this.wallX(2.5, 13.5, 2.5, y0, y1, T_INT, C.woodLight, [door(5.2, 7.2)]);
    this.wallX(-13.5, -2.5, 7, y0, y1, T_INT, C.woodLight, [door(-9, -7)]);
    this.wallX(2.5, 13.5, 7, y0, y1, T_INT, C.woodLight, [door(4, 6)]);
    this.wallZ(7, 11.5, 6.5, y0, y1, T_INT, C.woodLight, [door(8.6, 10.4)]);

    // ---- Biblioteca (SW-norte) ----
    for (let i = 0; i < 5; i++) this.bookcase(-12.9, 3.4 + i * 1.7, 1.6, 2.8, -Math.PI / 2);
    for (let i = 0; i < 6; i++) this.bookcase(-11 + i * 1.8, 3.3, 1.6, 2.6, 0);
    this.table(-8.5, 5.6, 2.6, 1.4, 0.2);
    this.chair(-9.6, 5.6, -Math.PI / 2);
    this.chair(-7.4, 5.6, Math.PI / 2);
    this.candle(-8.8, y0 + 0.85, 5.6);
    this.candle(-8.2, y0 + 0.85, 5.6);
    // mesa do mestre com mapa
    this.table(-4.6, 4.0, 2.4, 1.6, -0.3, 0.9);
    this.b.add(BUCKET.SOLID, unitBox(), 0x5c4a2c, trs(-4.6, 0.96, 4.0, 0, -0.3, 0, 1.6, 0.03, 1.2));
    for (let i = 0; i < 3; i++) this.b.add(BUCKET.SOLID, unitCyl(4), [C.wine, C.iron, C.clothBlue][i], trs(-5.2 + i * 0.5, 1.0, 4.4, 0, 0, 0, 0.24, 0.2, 0.24));
    this.chandelier(-8, y0 + 3.4, 5.0);
    this.torch(-3.0, y0 + 2.4, 3.2, 0, true);
    this.spawns.library = new THREE.Vector3(-8.6, 4, 5.4);

    // ---- Aposentos Reais (SW-sul) ----
    this.rug(-8, 9.4, 6, 5, C.wine, FLOOR.first + 0.03);
    this.bed(-12.4, 9.6, 0, true);
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(-11.0, 0.7, 9.6, 0, 0, 0, 1.6, 1.4, 0.7));
    this.candle(-11.4, y0 + 1.5, 9.6);
    this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark, trs(-13.3, y0 + 1.4, -1.5 + 3.0, 0, 0, 0, 1.0, 2.8, 2.4));
    this.b.add(BUCKET.GLOW, unitCone(7), C.fire, trs(-12.8, y0 + 0.7, 1.5, 0, 0, 0, 0.6, 0.9, 1.0));
    this.light(-12.4, y0 + 1.2, 1.5, 0xff8a34, 10, 14, 0.35);
    this.table(-5.6, 10.6, 1.8, 1.0, 0.2);
    this.chair(-5.6, 9.5, 0);
    this.chest(-4.0, 11.0, -0.3);
    this.banner(-2.7, y0 + 0.4, 9.4, C.wine, -Math.PI / 2, 1.6, 3.4);
    this.brazier(-9.5, y0, 11.2);
    this.torch(-2.9, y0 + 2.4, 8.0, 0);
    this.spawns.royal = new THREE.Vector3(-10.5, 4, 9.4);

    // ---- Salão do Conselho (SE-norte) ----
    this.table(8.0, 4.6, 4.6, 2.2, 0, 0.9);
    this.b.add(BUCKET.SOLID, unitBox(), 0x5c4a2c, trs(8.0, 0.96, 4.6, 0, 0, 0, 3.2, 0.04, 1.6));
    for (let i = 0; i < 4; i++) {
      this.b.add(BUCKET.SOLID, unitCyl(4), [C.wine, C.iron, C.clothBlue, C.brass][i], trs(6.8 + (i % 2) * 0.7, 1.0, 3.9 + Math.floor(i / 2) * 1.4, 0, 0, 0, 0.22, 0.22, 0.22));
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.chair(8.0 + Math.cos(a) * 3.0, 4.6 + Math.sin(a) * 2.0, -a + Math.PI / 2);
    }
    this.chandelier(8, y0 + 3.6, 4.6);
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(8, y0 + 2.4, -2.2, 0, 0, 0, 4.0, 2.2, 0.2));
    this.b.add(BUCKET.SOLID, unitBox(), 0x3a2e1c, trs(8, y0 + 2.4, -2.28, 0, 0, 0, 3.4, 1.7, 0.06));
    this.torch(3.2, y0 + 2.4, 3.2, 0, true);
    this.spawns.council = new THREE.Vector3(6.0, 4, 4.6);

    // ---- Capela dos Sussurros (SE-sul) ----
    for (let i = 0; i < 4; i++) {
      this.b.add(BUCKET.SOLID, unitCyl(8), C.stoneLight, trs(5.2 + i * 2.4, y0 + 1.6, 9.2, 0, 0, 0, 0.6, 3.2, 0.6));
      physics.add(4.9, 5.5, y0, y0 + 3.2, 8.9, 9.5, 'col');
    }
    this.b.add(BUCKET.SOLID, unitBox(), C.stoneLight, trs(8.8, y0 + 3.5, 9.2, 0, 0, 0, 9.6, 0.6, 1.4));
    this.statue(8.8, y0, 8.0, C.stone, Math.PI, 'maiden');
    for (let i = 0; i < 8; i++) this.candle(6.0 + i * 0.8, y0 + 0.95, 10.0);
    this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(8.8, y0 + 0.9, 10.0, 0, 0, 0, 7.0, 0.2, 0.5));
    for (let i = 0; i < 3; i++) this.bench(6.4 + i * 2.4, 11.0, 2.0, 0);
    this.rug(8.8, 9.6, 2.2, 6.0, C.purple, y0 + 0.03);
    this.brazier(3.4, y0, 8.4);
    this.brazier(14 - 0.6, y0, 8.4);
    this.torch(3.2, y0 + 2.6, 11.4, 0, true);

    // ---- Torre do Mestre (NE) ----
    for (let i = 0; i < 6; i++) this.bookcase(3.4 + i * 1.9, -11.0, 1.7, 2.8, 0);
    this.table(11.6, -6.0, 2.2, 1.6, 0.4, 0.9);
    this.b.add(BUCKET.GLOW, unitCyl(8), 0x3aa0a0, trs(11.2, 0.98, -6.4, 0, 0, 0, 0.8, 0.4, 0.8));
    this.light(11.2, y0 + 1.4, -6.4, 0x59d8d0, 6, 10, 0.5);
    for (let i = 0; i < 4; i++) this.crate(4.0 + (i % 2) * 1.1, FLOOR.first, -3.6 - Math.floor(i / 2) * 1.1, 0.85, C.woodDark);
    this.b.add(BUCKET.SOLID, unitSphere(7), 0x2b2f38, trs(6.6, y0 + 2.6, -8.4, 0, 0, 0, 1.6, 1.6, 1.6));
    this.b.add(BUCKET.GLOW, unitSphere(5), 0x7fe0ff, trs(6.6, y0 + 2.6, -8.4, 0, 0, 0, 1.5, 1.5, 1.5));
    this.light(6.6, y0 + 2.6, -8.4, 0x7fd8ff, 5, 10, 0.2);
    this.torch(13.2, y0 + 2.4, -3.2, 0, true);
    this.spawns.master = new THREE.Vector3(11.0, 4, -6.0);
  }

  /* ---------- SEGUNDO ANDAR ---------- */
  floor2() {
    this.setLevel(FLOOR.second);
    const y0 = FLOOR.second, y1 = FLOOR.roof;
    const door = (a0, a1) => ({ a0, a1, y0, y1: y0 + DOOR_H });
    this.slab(FLOOR.second, 0.5, [[KEEP.x0, KEEP.x1, KEEP.z0, KEEP.z1]], C.stoneWarm);
    // Salão do Trono ocupa toda a ala norte
    this.wallX(-13.5, -2.5, -2.5, y0, y1, T_INT, C.stoneDark, [{ a0: -6.5, a1: -4.0, y0, y1: y0 + 3.6 }]);
    this.wallX(2.5, 13.5, -2.5, y0, y1, T_INT, C.stoneDark, [door(5.2, 7.2)]);
    // corredor N-S (sem parede ao norte: abre no salão do trono)
    this.wallZ(2.5, 11.5, -2.5, y0, y1, T_INT, C.stoneDark, [door(3.2, 5.2), door(7.4, 9.4)]);
    this.wallZ(2.5, 11.5, 2.5, y0, y1, T_INT, C.stoneDark, [door(3.2, 5.2), door(7.4, 9.4)]);
    this.wallX(-13.5, -2.5, 7.5, y0, y1, T_INT, C.stoneDark, [door(-9, -7)]);
    this.wallX(2.5, 13.5, 7.5, y0, y1, T_INT, C.stoneDark, [door(4, 6)]);

    // ---- Salão do Trono ----
    for (let i = 0; i < 12; i++) {
      const z = -11.6 + i * 0.62;
      const h = (12 - i) * 0.24;
      const w = 7.0 + (12 - i) * 0.28;
      this.solid(-w / 2, w / 2, y0, y0 + h, z, z + 0.62, i % 2 ? C.stoneDark : C.obsidian);
    }
    // trono
    this.solid(-1.3, 1.3, y0 + 2.9, y0 + 3.9, -11.6, -10.2, C.obsidian);
    this.solid(-1.6, 1.6, y0 + 2.4, y0 + 3.0, -11.7, -10.1, C.obsidianEdge);
    this.solid(-1.1, 1.1, y0 + 2.0, y0 + 2.6, -11.4, -10.4, C.obsidian);
    for (let i = 0; i < 5; i++) {
      this.b.add(BUCKET.SOLID, unitCone(4), C.obsidianEdge, trs(-1.3 + i * 0.65, y0 + 4.1, -11.4, 0, 0, 0, 0.24, 0.6, 0.24));
    }
    this.b.add(BUCKET.GLOW, unitBox(), 0x3b2f14, trs(0, y0 + 3.5, -10.15, 0, 0, 0, 1.0, 0.6, 0.06));
    this.b.add(BUCKET.SOLID, unitBox(), C.gold, trs(0, y0 + 3.5, -10.12, 0, 0, 0, 1.2, 0.8, 0.06));
    this.b.add(BUCKET.SOLID, unitBox(), C.obsidianEdge, trs(0, y0 + 4.4, -11.7, 0, 0, 0, 2.8, 0.4, 0.2));
    // braços do trono
    this.solid(-1.5, -1.1, y0 + 2.9, y0 + 3.3, -11.2, -10.2, C.obsidianEdge);
    this.solid(1.1, 1.5, y0 + 2.9, y0 + 3.3, -11.2, -10.2, C.obsidianEdge);
    // cortinas e estandartes
    for (const x of [-5.5, -3.2, 3.2, 5.5]) this.banner(x, y0 + 0.6, -11.3, C.banner, 0, 1.8, 3.8);
    for (const x of [-8.4, 8.4]) this.banner(x, y0 + 0.6, -11.3, C.clothBlack, 0, 1.8, 3.8);
    this.rug(0, -7.0, 4.2, 9.0, C.wine, y0 + 0.03);
    // colunas
    for (const [x, z] of [[-10, -6.5], [10, -6.5], [-10, -3.6], [10, -3.6]]) {
      this.b.add(BUCKET.SOLID, unitCyl(10), C.obsidianEdge, trs(x, y0 + 1.9, z, 0, 0, 0, 0.9, 3.8, 0.9));
      physics.add(x - 0.6, x + 0.6, y0, y0 + 3.8, z - 0.6, z + 0.6, 'col');
    }
    this.chandelier(0, y0 + 2.2, -5.0);
    this.chandelier(-6, y0 + 2.2, -8.4);
    this.chandelier(6, y0 + 2.2, -8.4);
    this.brazier(-3.4, y0, -3.4);
    this.brazier(3.4, y0, -3.4);
    this.brazier(-8.0, y0, -11.0);
    this.brazier(8.0, y0, -11.0);
    this.torch(-2.9, y0 + 2.6, -6, 0, true);
    this.torch(2.9, y0 + 2.6, -6, 0, true);
    this.spawns.throne = new THREE.Vector3(0, 8, -8.5);

    // ---- Quarto da Princesa ----
    this.rug(-8.0, 5.0, 4.4, 3.6, C.purple, y0 + 0.03);
    this.bed(-11.6, 4.6, 0, true);
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(-11.6, y0 + 0.05, 3.2, 0, 0, 0, 2.4, 0.14, 1.0));
    this.b.add(BUCKET.SOLID, unitCyl(6), C.brass, trs(-11.4, y0 + 2.0, 3.4, 0, 0, 0, 0.3, 0.3, 0.3));
    this.b.add(BUCKET.GLOW, unitBox(), 0xffc46a, trs(-11.4, y0 + 2.0, 3.4, 0, 0, 0, 0.5, 0.5, 0.4));
    this.light(-11.0, y0 + 1.8, 4.4, 0xffb45a, 5, 9, 0.1);
    this.table(-8.4, 6.4, 1.4, 0.9, 0.2);
    this.chair(-8.4, 5.3, Math.PI);
    this.candle(-8.6, y0 + 0.9, 6.6);
    this.bookcase(-4.4, 3.6, 1.4, 2.4, -Math.PI / 2, C.wood);
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(-3.2, y0 + 0.9, 8.0, 0, -0.4, 0, 1.4, 1.8, 0.7));
    // baú selado com o Ferro Negro
    this.b.add(BUCKET.SOLID, unitBox(), C.obsidian, trs(-3.4, y0 + 0.45, 6.2, 0, 0.3, 0, 1.2, 0.9, 0.8));
    this.b.add(BUCKET.GLOW, unitBox(), 0x9fd8ff, trs(-3.4, y0 + 0.75, 5.76, 0, 0.3, 0, 1.0, 0.34, 0.06));
    this.light(-3.4, y0 + 1.2, 6.2, 0x86c8ff, 4, 7, 0.3);
    this.torch(-2.9, y0 + 2.6, 9.6, 0, true);
    this.chest(-12.6, 11.0, 0.2);
    this.spawns.princess = new THREE.Vector3(-9.5, 8, 5.0);

    // ---- Solar de Bordado ----
    for (let i = 0; i < 3; i++) this.table(-12.6, 8.6 + i * 1.4, 1.4, 0.9, -Math.PI / 2, 0.7);
    for (let i = 0; i < 3; i++) this.chair(-11.2, 8.6 + i * 1.4, -Math.PI / 2);
    this.b.add(BUCKET.SOLID, unitCyl(10), 0x6b4a2a, trs(-9.0, y0 + 1.4, 9.6, 0, 0, 0, 2.4, 0.24, 2.4));
    this.b.add(BUCKET.SOLID, unitCyl(10), C.woodDark, trs(-9.0, y0 + 0.2, 9.6, 0, 0, 0, 0.4, 0.4, 0.4));
    for (let i = 0; i < 3; i++) {
      this.b.add(BUCKET.SOLID, unitBox(), [C.wine, C.clothBlue, C.gold][i], trs(-9.0 + (i - 1) * 0.7, y0 + 1.56, 9.6, 0, 0.2 * i, 0, 0.6, 0.08, 0.4));
    }
    this.brazier(-4.0, y0, 11.4);
    this.torch(-2.9, y0 + 2.6, 11.6, 0, true);
    this.spawns.embroidery = new THREE.Vector3(-11.0, 8, 9.6);

    // ---- Câmara do Sussurro ----
    this.b.add(BUCKET.SOLID, unitCyl(12), C.wood, trs(7.0, y0 + 1.5, 4.2, 0, 0, 0, 1.8, 3.0, 1.8));
    this.b.add(BUCKET.SOLID, unitCyl(12), 0x0a0c10, trs(7.0, y0 + 0.05, 4.2, 0, 0, 0, 3.0, 0.12, 3.0));
    physics.add(6.2, 7.8, y0, y0 + 3.0, 3.4, 5.0, 'mesa');
    for (let i = 0; i < 4; i++) this.chair(7.0 + Math.cos(i * 1.6) * 2.4, 4.2 + Math.sin(i * 1.6) * 2.0, -i * 1.6);
    this.bookcase(12.8, 4.0, 2.2, 2.6, -Math.PI / 2);
    this.b.add(BUCKET.GLOW, unitSphere(6), 0x6a4bd8, trs(9.6, y0 + 1.2, 6.6, 0, 0, 0, 0.5, 0.5, 0.5));
    this.light(9.6, y0 + 1.2, 6.6, 0x8a5cf0, 5, 9, 0.6);
    this.torch(3.2, y0 + 2.6, 6.8, 0, true);
    this.spawns.whisper = new THREE.Vector3(7.0, 8, 5.6);

    // ---- Arquivo Real ----
    for (let i = 0; i < 7; i++) this.bookcase(3.6 + i * 1.6, 11.2, 1.5, 2.8, Math.PI);
    for (let i = 0; i < 3; i++) {
      this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(11.0, y0 + i * 1.4, 9.0 + i * 1.2, 0, 0, 0, 2.4, 0.12, 0.6));
      this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(11.0, y0 + i * 1.4, 9.6 + i * 1.2, 0, 0, 0, 0.12, 1.4, 0.12));
    }
    this.b.add(BUCKET.SOLID, unitCyl(8), C.iron, trs(9.6, y0 + 0.9, 8.4, 0, 0, 0, 0.7, 1.8, 0.7));
    this.table(7.4, 9.4, 2.2, 1.3, 0.1);
    this.candle(7.0, y0 + 0.85, 9.4);
    this.candle(7.9, y0 + 0.85, 9.4);
    this.torch(3.2, y0 + 2.6, 8.6, 0, true);
    this.spawns.archive = new THREE.Vector3(7.4, 8, 9.4);
  }

  roof() {
    this.setLevel(0);
    this.slab(FLOOR.roof, 0.5, [[KEEP.x0 - 0.4, KEEP.x1 + 0.4, KEEP.z0 - 0.4, KEEP.z1 + 0.4]], C.stoneDark);
    this.crenellations(KEEP.x0 - 0.4, KEEP.x1 + 0.4, KEEP.z0 - 0.4, KEEP.z1 + 0.4, FLOOR.roof);
    // poço de luz do salão (claraboia)
    for (let i = 0; i < 5; i++) {
      this.b.add(BUCKET.SOLID, unitBox(), C.stoneLight, trs(-11 + i * 4.2, FLOOR.roof + 0.7, -7.0, 0, 0, 0, 0.4, 1.4, 0.4));
    }
    // mastro da bandeira
    this.b.add(BUCKET.SOLID, unitCyl(6), C.woodDark, trs(0, FLOOR.roof + 3.5, -12.0, 0, 0, 0, 0.3, 7.0, 0.3));
    this.b.add(BUCKET.SOLID, unitBox(), C.banner, trs(1.2, FLOOR.roof + 6.2, -12.0, 0, 0, 0, 2.4, 3.2, 0.1));
    this.b.add(BUCKET.SOLID, unitBox(), C.gold, trs(1.2, FLOOR.roof + 6.2, -11.94, 0, 0, 0, 1.1, 1.4, 0.04));
  }

  /* ================= PÁTIOS E MURALHA ================= */
  courtyards() {
    // piso de pedra do pátio do portão
    for (let i = 0; i < 26; i++) {
      const z = 12.4 + i * 0.8;
      if (z > 31.4) break;
      this.b.add(BUCKET.SOLID, unitBox(), i % 2 ? C.stone : C.stoneWarm, trs(0, -0.02, z, 0, 0, 0, 22 + (i % 3) * 2, 0.16, 0.8));
    }
    // caminho de pedra até o portão do castelo
    for (let i = 0; i < 8; i++) {
      this.b.add(BUCKET.SOLID, unitBox(), i % 2 ? C.stone : C.stoneDark, trs(8, -0.02, 12.4 + i * 1.4, 0, 0, 0, 5.0, 0.18, 1.4));
    }
    // bancos, poço, carroças
    this.well(-10, 17);
    this.bench(-8.4, 18.6, 2.4, 0);
    this.bench(-11.6, 18.6, 2.4, 0);
    this.cart(12.0, 18.0, 0.4);
    this.crate(14.6, 0, 20.0, 0.9);
    this.crate(14.6, 0, 21.0, 0.7, C.woodDark);
    for (let i = 0; i < 5; i++) this.barrel(-13.6 + i * 0.9, 22.0, 0.4, 0.9);
    this.stall(-6.0, 24.0, 0);
    this.stall(6.0, 24.0, 0);
    this.brazier(-8.0, 0, 13.6, true);
    this.brazier(8.0, 0, 13.6, true);
    this.torch(6.6, 2.6, 13.8, 0, true);
    this.torch(9.4, 2.6, 13.8, 0, true);
    // estátuas flanqueando o portão
    this.statue(-6.4, 0, 13.4, C.stoneDark, Math.PI * 0.1, 'warrior');
    this.statue(13.4, 0, 13.4, C.stoneDark, -Math.PI * 0.1, 'warrior');
    // faixas de estandartes na fachada
    this.banner(-3.5, 4.5, 12.3, C.banner, 0, 1.4, 3.0);
    this.banner(12.6, 4.5, 12.3, C.banner, 0, 1.4, 3.0);
    this.light(0, 4.0, 16, 0xff9a50, 8, 18, 0.25);

    // ---- Pátio de treino (oeste) ----
    for (let i = 0; i < 14; i++) {
      this.b.add(BUCKET.SOLID, unitBox(), i % 2 ? C.dirt : C.mud, trs(-24, -0.03, -8 + i * 1.5, 0, 0, 0, 18, 0.12, 1.5));
    }
    for (let i = 0; i < 6; i++) {
      this.b.add(BUCKET.SOLID, unitCyl(6), C.woodDark, trs(-20 + (i % 3) * 3.0, 0.75, -3 + Math.floor(i / 3) * 4.0, 0, 0, 0, 0.34, 1.5, 0.34));
      this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(-20 + (i % 3) * 3.0, 1.35, -3 + Math.floor(i / 3) * 4.0, 0, 0, 0, 1.5, 0.14, 0.14));
      this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(-20 + (i % 3) * 3.0, 0.95, -3 + Math.floor(i / 3) * 4.0, 0.4, 0, 0, 0.14, 0.9, 0.14));
      this.b.add(BUCKET.SOLID, unitSphere(6), C.grassDry, trs(-20 + (i % 3) * 3.0, 1.5, -3 + Math.floor(i / 3) * 4.0, 0, 0, 0, 0.7, 0.7, 0.7));
    }
    this.rack(-24.5, -8.0, 0);
    this.rack(-24.5, 10.0, 0);
    this.anvil(-27.0, 1.0);
    this.cauldron(-27.6, 3.4);
    this.b.add(BUCKET.GLOW, unitCone(7), C.fire, trs(-27.0, 0.3, 1.0, 0, 0, 0, 0.4, 0.5, 0.4));
    // bigorna com forja
    this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark, trs(-31.5, 1.2, -1.0, 0, 0, 0, 2.4, 2.4, 2.4));
    this.b.add(BUCKET.SOLID, unitBox(), 0x0a0c10, trs(-30.4, 1.0, -1.0, 0, 0, 0, 0.3, 1.0, 1.2));
    this.b.add(BUCKET.GLOW, unitBox(), C.ember, trs(-30.3, 0.9, -1.0, 0, 0, 0, 0.2, 0.8, 1.0));
    this.light(-30.0, 1.2, -1.0, 0xff7020, 9, 12, 0.4);
    physics.add(-32.7, -30.3, 0, 2.4, -2.2, 0.2, 'forja');
    this.torch(-17.0, 2.6, 12.0, 0, true);
    this.spawns.yard = new THREE.Vector3(-22, 0, 2);

    // ---- Estrebaria (oeste-norte) ----
    this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(-29, 1.5, -6.0, 0, 0, 0, 10, 0.24, 8));
    for (const [x, z] of [[-33.5, -9.6], [-24.5, -9.6], [-33.5, -2.4], [-24.5, -2.4]]) {
      this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(x, 1.4, z, 0, 0, 0, 0.34, 2.8, 0.34));
      physics.add(x - 0.3, x + 0.3, 0, 2.8, z - 0.3, z + 0.3, 'poste');
    }
    for (let i = 0; i < 4; i++) {
      this.b.add(BUCKET.SOLID, unitBox(), C.woodDark, trs(-33 + i * 2.4, 2.9, -6.0, 0, 0, 0, 0.26, 0.26, 8));
    }
    this.b.add(BUCKET.SOLID, unitPrism(), C.thatch, trs(-29, 3.4, -6.0, 0, Math.PI / 2, 0, 10.6, 3.4, 9.0));
    // baias
    for (let i = 0; i < 3; i++) {
      const z = -9.0 + i * 2.6;
      this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(-30.6, 0.8, z, 0, 0, 0, 5.6, 0.12, 0.14));
      this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(-30.6, 1.4, z, 0, 0, 0, 5.6, 0.12, 0.14));
    }
    for (let i = 0; i < 5; i++) this.b.add(BUCKET.SOLID, unitBox(), C.grassDry, trs(-31.5 + (i % 3) * 2.0, 0.14, -7.6 + Math.floor(i / 3) * 2.0, 0, 0.3 * i, 0, 2.0, 0.28, 1.2));
    this.b.add(BUCKET.SOLID, unitBox(), C.wood, trs(-24.2, 0.9, -6.0, 0, 0, 0, 0.3, 1.8, 0.3));
    this.b.add(BUCKET.SOLID, unitCyl(8), 0x7a5a34, trs(-24.2, 1.6, -6.0, 0, 0, 0, 1.9, 0.5, 1.9));
    this.b.add(BUCKET.SOLID, unitBox(), C.grassDry, trs(-24.2, 1.4, -6.0, 0, 0.4, 0, 1.4, 0.2, 0.6));
    this.barrel(-24.8, -2.8, 0.4, 0.9);
    this.crate(-24.8, 0, -3.8, 0.8);
    this.torch(-24.2, 2.6, -9.4, 0, true);
    this.light(-29, 2.4, -6, 0xffa050, 5, 12, 0.15);
    this.spawns.stable = new THREE.Vector3(-26.5, 0, -4.0);
    this.spawns.horse = new THREE.Vector3(-27.5, 0, -5.5);

    // ---- Jardim norte ----
    for (let i = 0; i < 4; i++) this.bush(-12 + i * 3.4, -15.6, 1.2);
    for (let i = 0; i < 6; i++) this.bush(-16 + i * 2.0, -19.0, 0.9);
    this.tree(-19, -17, 0.8, 'oak', 0);
    this.tree(19, -20, 0.9, 'oak', 0);
    this.bench(0, -14.0, 2.4, 0);
    this.bench(-2.0, -14.0, 2.4, 0);
    for (let i = 0; i < 5; i++) {
      this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark, trs(-4 + i * 2.0, 0.18, -16.5, 0, 0, 0, 1.6, 0.36, 1.6));
      this.b.add(BUCKET.LEAF, unitSphere(5), 0x2d3d20, trs(-4 + i * 2.0, 0.7, -16.5, 0, 0, 0, 1.0, 0.7, 1.0));
      this.b.add(BUCKET.SOLID, unitSphere(4), [C.wine, C.gold, C.purple][i % 3], trs(-4 + i * 2.0, 0.9, -16.5, 0, 0, 0, 0.3, 0.3, 0.3));
    }

    // ---- Muralha externa do castelo ----
    const X0 = -42, X1 = 42, Z0 = -34, Z1 = 34, WH = 6.5;
    this.wallX(X0, X1, Z1, -0.6, WH, 1.0, C.stoneDark, [{ a0: -4.2, a1: 4.2, y0: 0, y1: 5.2 }]);
    this.wallX(X0, X1, Z0, -0.6, WH, 1.0, C.stoneDark, []);
    this.wallZ(Z0, Z1, X0, -0.6, WH, 1.0, C.stoneDark, [{ a0: 5, a1: 8, y0: 0, y1: 2.6 }]);
    this.wallZ(Z0, Z1, X1, -0.6, WH, 1.0, C.stoneDark, []);
    this.crenellations(X0, X1, Z0, Z1, WH, C.stoneLight);
    // adarve (passadiço)
    this.deco(X0, X1, WH, WH + 0.3, Z1 - 1.2, Z1 + 0.2, C.stone);
    // torres da muralha
    for (const [tx, tz] of [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1], [-8.5, Z1], [8.5, Z1], [-21, Z1], [21, Z1], [-21, Z0], [21, Z0]]) {
      this.towerRound(tx, tz, -0.5, 3.6, 9.5, C.stoneDark, true, 0.3);
    }
    // casa do portão (gatehouse): flancos + arco sobre o vão
    this.solid(-5.2, -2.1, -0.6, 8.0, Z1 - 1.7, Z1 + 1.7, C.stone);
    this.solid(2.1, 5.2, -0.6, 8.0, Z1 - 1.7, Z1 + 1.7, C.stone);
    this.solid(-2.1, 2.1, 5.2, 8.0, Z1 - 1.7, Z1 + 1.7, C.stone);
    for (let i = 0; i < 4; i++) {
      this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark, trs(-1.6 + i * 1.1, 5.0, Z1 - 1.75, 0, 0, 0, 0.9, 0.6, 0.12));
      this.b.add(BUCKET.SOLID, unitBox(), C.stoneDark, trs(-1.6 + i * 1.1, 5.0, Z1 + 1.75, 0, 0, 0, 0.9, 0.6, 0.12));
    }
    this.crenellations(-5.2, 5.2, Z1 - 1.7, Z1 + 1.7, 8.0, C.stoneLight);
    this.banner(-2.2, 5.6, Z1 - 1.62, C.banner, 0, 1.4, 3.0);
    this.banner(2.2, 5.6, Z1 - 1.62, C.banner, 0, 1.4, 3.0);
    this.torch(-3.4, 4.0, Z1 - 1.7, 0, true);
    this.torch(3.4, 4.0, Z1 - 1.7, 0, true);
    // portão de ferro de duas folhas
    this.buildGate();
    // estandartes na muralha
    for (const x of [-30, -18, 18, 30]) this.banner(x, 4.2, Z1 - 0.55, C.banner, 0, 1.3, 2.8);
    // cabanas de serviço no pátio
    this.house(-36, 20, 6, 5, 3.0, 0.1, { collides: true });
    this.house(36, -20, 7, 5.5, 3.2, -0.2, {});
    this.house(34, 22, 6, 5, 3.0, 0.3, {});
    this.house(-36, -22, 6.5, 5, 3.1, 0.2, {});
  }

  buildGate() {
    const g = new THREE.Group();
    g.position.set(0, 0, 33);
    const leaf = (dir) => {
      const grp = new THREE.Group();
      const panel = new THREE.Group();
      // painel de ferro com tábuas
      const geo = unitBox();
      const m = prep(geo, C.iron, trs(dir * 2.2, 2.7, 0, 0, 0, 0, 4.4, 5.4, 0.3));
      const mesh = new THREE.Mesh(m, MAT_LIT);
      mesh.castShadow = true;
      panel.add(mesh);
      for (let i = 0; i < 6; i++) {
        const r = new THREE.Mesh(prep(unitBox(), C.woodDark, trs(dir * 2.2, 0.6 + i * 0.9, 0.1, 0, 0, 0, 4.2, 0.22, 0.34)), MAT_LIT);
        panel.add(r);
      }
      panel.add(new THREE.Mesh(prep(unitCyl(6), C.ironLight, trs(dir * 2.2, 1.2, 0.16, 0, 0, Math.PI / 2, 0.2, 0.9, 0.2)), MAT_LIT));
      grp.add(panel);
      g.add(grp);
      return { grp, panel, dir };
    };
    // dois lados: dobradiças nas extremidades (±4.2)
    const mkSide = (dir) => {
      const hinge = new THREE.Group();
      hinge.position.set(dir * 4.2, 0, 0);
      const p = new THREE.Group();
      const mesh = new THREE.Mesh(prep(unitBox(), C.iron, trs(-dir * 2.1, 2.7, 0, 0, 0, 0, 4.2, 5.4, 0.32)), MAT_LIT);
      mesh.castShadow = true;
      p.add(mesh);
      for (let i = 0; i < 6; i++) {
        p.add(new THREE.Mesh(prep(unitBox(), C.woodDark, trs(-dir * 2.1, 0.6 + i * 0.9, 0.11, 0, 0, 0, 4.0, 0.24, 0.34)), MAT_LIT));
      }
      for (const s of [1, 2.7, 4.4]) {
        p.add(new THREE.Mesh(prep(unitCyl(6), C.ironLight, trs(-dir * 2.1, s, 0.18, 0, 0, Math.PI / 2, 0.18, 3.9, 0.18)), MAT_LIT));
      }
      hinge.add(p);
      g.add(hinge);
      const idx = physics.add(dir * 4.2 - (dir > 0 ? 4.2 : 0), dir * 4.2 + (dir > 0 ? 0 : 4.2), 0, 5.4, 32.7, 33.3, 'portao');
      return { hinge, dir, idx, angle: 0, target: 0 };
    };
    this.scene.add(g);
    this.gate = { group: g, sides: [mkSide(-1), mkSide(1)], open: false };
    this.doors.push(this.gate);
    this.interactables.push({
      id: 'gate', label: 'Portão do Castelo', pos: new THREE.Vector3(0, 1.5, 32.2), range: 5.0, kind: 'gate',
    });
  }

  /** Abre/fecha o portão principal. */
  toggleGate() {
    const g = this.gate;
    if (!g) return false;
    g.open = !g.open;
    const H = Math.PI * 0.62;
    g.sides.forEach(s => { s.target = g.open ? -s.dir * H : 0; });
    g.sides.forEach(s => physics.setEnabled(s.idx, !g.open));
    return g.open;
  }
  updateDoors(dt) {
    for (const s of this.gate.sides) {
      const d = s.target - s.angle;
      if (Math.abs(d) > 0.001) {
        s.angle += d * Math.min(1, dt * 3.4);
        s.hinge.rotation.y = s.angle;
      }
    }
  }
  /** Qual quarto/lugar o jogador está? */
  roomAt(x, z, y) {
    let best = null, bestScore = Infinity;
    for (const r of [...ROOMS, ...PLACES]) {
      const fy = FLOOR[['crypt', 'ground', 'first', 'second'].includes(String(r.floor)) ? 'ground' : 'ground'];
      const base = r.floor === -4 ? -4 : r.floor === 0 ? 0 : r.floor === 4 ? 4 : r.floor === 8 ? 8 : 0;
      if (Math.abs(y - base) > 2.6) continue;
      if (x >= r.x[0] && x <= r.x[1] && z >= r.z[0] && z <= r.z[1]) {
        const score = (r.x[1] - r.x[0]) * (r.z[1] - r.z[0]);
        if (score < bestScore) { bestScore = score; best = r; }
      }
    }
    return best;
  }
}

/* Móveis que NÃO recebem altura são construídos relativos ao andar atual:
 * envolvemos estes builders para deslocar geometria e colisores. */
for (const k of ['table', 'chair', 'shelf', 'bookcase', 'bed', 'bench', 'chest', 'rack', 'anvil', 'stall', 'cart']) {
  const fn = World.prototype[k];
  World.prototype[k] = function (...args) {
    const keep = this.b.yOff;
    this.b.yOff = this.lvl;
    const out = fn.apply(this, args);
    this.b.yOff = keep;
    return out;
  };
}
