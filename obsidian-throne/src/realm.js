import * as THREE from 'three';
import { BUCKET, MAT_WATER, trs, unitBox, unitCyl, unitCone, unitSphere } from './batch.js';
import { C, RIVER_X, terrainHeight, physics, rng } from './config.js';

/** Pontos de referência do reino (NPCs, missões, mapa). */
export const REALM = {
  village: new THREE.Vector3(70, 0, 140),
  bridge: new THREE.Vector3(152, 1.1, 140),
  forest: new THREE.Vector3(-70, 0, 120),
  rock: new THREE.Vector3(215, 1.4, 105),
  ruins: new THREE.Vector3(-25, 1.2, -150),
  gate: new THREE.Vector3(0, 0, 40),
};

export const SHRINES = [];

export function buildRealm(w) {
  const r = rng(20261);
  const b = w.b;
  const gy = terrainHeight;
  const BOX = unitBox(), CYL = unitCyl(8), CONE = unitCone(7), SPH = unitSphere(6);
  const put = (geo, color, m, bucket = BUCKET.SOLID) => b.add(bucket, geo, color, m);
  const at = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => trs(x, y, z, rx, ry, rz, sx, sy, sz);

  /* ---------------- ÁGUA DO RIO CINZA ---------------- */
  {
    const g = new THREE.PlaneGeometry(46, 520, 6, 48);
    g.rotateX(-Math.PI / 2);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, MAT_WATER);
    mesh.position.set(RIVER_X, -0.35, 30);
    mesh.name = 'river';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    w.group.add(mesh);
    w.water = mesh;
  }

  /* ---------------- ESTRADAS ---------------- */
  const road = (pts, width, color) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.round(len / 3.0));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        const x = a[0] + dx * t, z = a[1] + dz * t;
        const y = gy(x, z);
        const ang = Math.atan2(dx, dz);
        const ww = (Math.abs(dx) > Math.abs(dz) ? width : len / steps + 1.2);
        const dd = (Math.abs(dx) > Math.abs(dz) ? len / steps + 1.2 : width);
        put(BOX, s % 5 === 0 ? C.mud : color, at(x, y + 0.05, z, 0, ang, 0, ww, 0.24, Math.max(dd, 2.2)));
      }
    }
  };
  road([[0, 33], [3, 46], [14, 60], [32, 82], [50, 102], [62, 120], [70, 136], [84, 144], [108, 143], [130, 141], [140, 140]], 4.2, C.dirt);
  road([[140, 140], [166, 140], [186, 132], [200, 118], [212, 108]], 4.2, C.dirt);
  road([[70, 136], [48, 130], [22, 126], [-8, 124], [-38, 122], [-60, 120]], 3.0, C.mud);
  road([[70, 140], [64, 160], [58, 176]], 2.6, C.mud);
  road([[212, 108], [220, 92], [224, 72]], 2.4, C.mud);
  road([[0, 33], [-14, 30], [-30, 26], [-40, 22]], 2.6, C.mud);
  road([[-60, 120], [-25, -20], [-24, -130]], 2.6, C.mud);

  /* ---------------- VILA CINZALTA ---------------- */
  const vx = REALM.village.x, vz = REALM.village.z;
  for (let i = 0; i < 15; i++) {
    const x = vx - 32 + i * 4.6 + r() * 1.6;
    const z = vz - 20 - (i % 3) * 4 - r() * 5;
    w.house(x, z, 4.6 + r() * 2.6, 4.0 + r() * 2.0, 2.8 + r() * 1.1, (r() - 0.5) * 0.4,
      { roof: r() > 0.5 ? C.thatch : C.roofSlate });
    if (r() > 0.45) w.fence(x - 3.4, z + 3.4, x + 3.4, z + 3.4, 1.1);
  }
  for (let i = 0; i < 12; i++) {
    const x = vx - 34 + i * 5.8 + r() * 2.4;
    const z = vz + 20 + r() * 9;
    w.house(x, z, 4.4 + r() * 2.4, 3.8 + r() * 2.0, 2.6 + r() * 1.2, Math.PI + (r() - 0.5) * 0.4,
      { roof: r() > 0.5 ? C.thatch : C.roofSlate });
  }
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const x = vx - 5.5 + i * 2.2, z = vz - 4 + j * 2.2;
      put(BOX, (i + j) % 2 ? C.stone : C.stoneWarm, at(x, gy(x, z) + 0.04, z, 0, 0, 0, 2.2, 0.24, 2.2));
    }
  }
  w.well(vx, vz);
  w.stall(vx - 8, vz - 6, 0.2);
  w.stall(vx + 8, vz - 6, -0.2);
  w.stall(vx - 8, vz + 7, Math.PI - 0.2);
  w.cart(vx + 12, vz + 3, 0.9);
  w.cart(vx - 14, vz - 2, 2.2);
  for (let i = 0; i < 8; i++) w.barrel(vx - 17 + i * 1.1, vz + 12, 0.4, 0.9 + r() * 0.2);
  for (let i = 0; i < 5; i++) w.crate(vx + 16 + (i % 2) * 0.9, gy(vx + 16, vz - 12) + (i > 2 ? 0.8 : 0), vz - 12 - Math.floor(i / 2) * 0.9, 0.85);
  w.brazier(vx + 3, 0, vz + 4, true);
  w.brazier(vx - 3, 0, vz + 4, true);
  w.house(vx - 4, vz - 30, 9, 7, 4.2, 0.1, { roof: C.roofSlate });   // taverna
  put(CONE, 0xffc070, at(vx - 4, 3.6, vz - 26.4, Math.PI, 0, 0, 0.7, 0.9, 0.7), BUCKET.GLOW)
  for (let i = 0; i < 8; i++) {
    const x = vx - 30 + i * 8, z = vz - 20, y = gy(x, z);
    put(BOX, C.woodDark, at(x, y + 1.7, z, 0, 0, 0, 0.18, 3.4, 0.18));
    put(BOX, 0xffb45a, at(x + 0.5, y + 3.1, z, 0, 0, 0, 0.42, 0.5, 0.42), BUCKET.GLOW)
    if (i % 2 === 0) w.light(x + 0.5, y + 3.1, z, 0xffb060, 6, 14, 0.2);
  }
  w.house(vx + 26, vz - 18, 12, 8, 5.0, 0.05, { roof: C.thatch });
  w.fence(vx + 20, vz - 26, vx + 34, vz - 26, 1.2);
  w.fence(vx + 34, vz - 26, vx + 34, vz - 8, 1.2);
  w.tree(vx + 18, vz + 16, 1.1);
  w.tree(vx - 20, vz + 18, 0.9);
  w.tree(vx + 6, vz + 24, 1.0);
  w.tree(vx - 26, vz - 6, 1.2);
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 6; j++) {
      const x = vx + 34 + i * 1.6, z = vz + 12 + j * 2.0;
      put(SPH, 0x4a5528, at(x, gy(x, z) + 0.25, z, 0, 0, 0, 0.9, 0.5, 0.9));
    }
  }
  w.fence(vx + 32, vz + 8, vx + 46, vz + 8, 1.1);
  w.fence(vx + 46, vz + 8, vx + 46, vz + 26, 1.1);
  w.stall(vx + 20, vz + 2, 0.6);
  w.light(vx, 3.4, vz, 0xffa860, 9, 24, 0.2);
  w.spawns.village = new THREE.Vector3(vx + 4, 0, vz + 6);
  w.spawns.tavern = new THREE.Vector3(vx - 4, 0, vz - 25);
  shrine(w, vx + 10, vz + 16, 'Vila Cinzalta');

  /* ---------------- FLORESTA ---------------- */
  for (let i = 0; i < 210; i++) {
    const x = -172 + r() * 156;
    const z = 24 + r() * 196;
    if (Math.hypot(x - vx, z - vz) < 34) continue;
    if (Math.hypot(x, z) < 80) continue;
    if (Math.abs(x - RIVER_X) < 30) continue;
    w.tree(x, z, 0.85 + r() * 0.95, r() > 0.5 ? 'pine' : 'oak');
  }
  for (let i = 0; i < 70; i++) {
    const x = -172 + r() * 160, z = 20 + r() * 200;
    if (Math.hypot(x, z) < 76 || Math.hypot(x - vx, z - vz) < 30) continue;
    w.bush(x, z, 0.7 + r() * 0.9);
  }
  // clareira: círculo de pedras + fogueira
  const fx = REALM.forest.x, fz = REALM.forest.z;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const x = fx + Math.cos(a) * 7.2, z = fz + Math.sin(a) * 7.2;
    const y = gy(x, z), h = 3.0 + r() * 1.6;
    put(BOX, i % 2 ? C.rockDark : C.rock, at(x, y + h / 2, z, 0, a, 0.06, 1.1, h, 1.1));
    physics.add(x - 0.7, x + 0.7, y, y + h, z - 0.7, z + 0.7, 'menir');
  }
  {
    const y = gy(fx, fz);
    put(CYL, C.woodDark, at(fx, y + 0.18, fz, 0, 0, 0, 2.4, 0.32, 2.4));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      put(BOX, C.wood, at(fx + Math.cos(a) * 0.5, y + 0.55, fz + Math.sin(a) * 0.5, 0.5, a, 0, 0.2, 1.3, 0.2));
    }
    put(CONE, C.fire, at(fx, y + 1.15, fz, 0, 0, 0, 0.9, 1.7, 0.9), BUCKET.GLOW)
    put(CONE, C.fireCore, at(fx, y + 1.1, fz, 0, 0, 0, 0.5, 1.0, 0.5), BUCKET.GLOW)
    w.light(fx, y + 1.7, fz, 0xff8a30, 13, 22, 0.35);
    physics.add(fx - 1.2, fx + 1.2, y, y + 0.85, fz - 1.2, fz + 1.2, 'fogueira');
  }
  w.house(fx + 22, fz - 16, 6.5, 5.0, 3.0, 0.4, { roof: C.thatch });
  for (let i = 0; i < 12; i++) w.crate(fx + 16 + (i % 3) * 0.9, gy(fx + 16, fz - 10) + (i > 5 ? 0.8 : 0), fz - 10 - Math.floor(i / 3) * 0.9, 0.8, r() > 0.5 ? C.wood : C.woodDark);
  w.tree(fx - 14, fz + 9, 1.5, 'oak');
  w.spawns.forest = new THREE.Vector3(fx + 3, 0, fz + 5);
  shrine(w, fx + 5, fz + 10, 'Bosque Antigo');

  /* ---------------- PONTE DO RIO CINZA ---------------- */
  {
    const bx = REALM.bridge.x, bz = REALM.bridge.z;
    put(BOX, C.stoneDark, at(bx, 0.4, bz, 0, 0, 0, 40, 1.5, 8.4));
    physics.add(bx - 20, bx + 20, -3.4, 1.15, bz - 4.2, bz + 4.2, 'ponte');
    for (let i = 0; i < 3; i++) {
      const px = bx - 10 + i * 10;
      put(CYL, C.stone, at(px, -2.6, bz, 0, 0, 0, 3.6, 6.6, 3.6));
      put(CYL, C.stoneDark, at(px, 1.4, bz - 3.0, 0.62, 0, 0, 1.5, 8.6, 1.5));
      put(CYL, C.stoneDark, at(px, 1.4, bz + 3.0, -0.62, 0, 0, 1.5, 8.6, 1.5));
    }
    for (const s of [-1, 1]) {
      put(BOX, C.stone, at(bx, 1.35, bz + s * 3.9, 0, 0, 0, 40, 1.1, 0.7));
      physics.add(bx - 20, bx + 20, 1.15, 2.05, bz + s * 3.9 - 0.35, bz + s * 3.9 + 0.35, 'parapeito');
      for (let i = 0; i < 8; i++) put(BOX, C.stoneLight, at(bx - 17 + i * 5, 2.1, bz + s * 3.9, 0, 0, 0, 0.7, 0.7, 0.9));
      w.banner(bx - 18, 1.4, bz + s * 3.6, C.banner, s > 0 ? 0 : Math.PI, 1.2, 2.4);
      w.banner(bx + 18, 1.4, bz + s * 3.6, C.banner, s > 0 ? 0 : Math.PI, 1.2, 2.4);
    }
    w.torch(bx - 19, 2.1, bz - 3.6, 0, true);
    w.torch(bx + 19, 2.1, bz + 3.6, 0, true);
    w.spawns.bridge = new THREE.Vector3(bx - 6, 1.2, bz);
    shrine(w, bx + 16, bz + 7, 'Ponte do Rio Cinza');
    put(BOX, C.woodDark, at(bx - 6, -1.5, bz + 12, 0, 0.6, 0.3, 4.0, 0.9, 1.6));
    put(BOX, C.iron, at(bx - 6, -1.3, bz + 12, 0, 0, 1.5, 0.4, 6.0, 0.4));
  }

  /* ---------------- ROCHEDO DO DRAGÃO ---------------- */
  {
    const rx = REALM.rock.x, rz = REALM.rock.z;
    const base = gy(rx, rz);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rad = 9 + r() * 13;
      const x = rx + Math.cos(a) * rad, z = rz + Math.sin(a) * rad;
      const h = 5 + r() * 13, s = 5 + r() * 7;
      put(SPH, i % 3 ? C.rock : C.rockDark, at(x, base + h * 0.34, z, r() * 0.4, r() * 3, 0, s, h, s));
      physics.add(x - s * 0.34, x + s * 0.34, base, base + h * 0.75, z - s * 0.34, z + s * 0.34, 'rocha');
    }
    const dy = base + 12;
    put(SPH, C.rockDark, at(rx, dy + 1.6, rz, 0, 0.6, 0.2, 5.2, 4.6, 11.0));
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      put(SPH, C.rockDark, at(rx + 1.6 + t * 3.4, dy + 1.4 - t * 1.2, rz - 5.5 - t * 4.2, 0, 0.6, 0.2, 3.4 - t * 2.6, 3.0 - t * 2.2, 2.2));
    }
    put(SPH, C.rockDark, at(rx - 3.6, dy + 3.2, rz - 7.6, 0, 0.6, 0, 3.8, 3.6, 4.6));
    for (const s of [-1, 1]) put(BOX, C.rockDark, at(rx - 3.0, dy + 6.2, rz - 7.2, 0.4, 0.4, s * 0.5, 0.8, 5.5, 0.8));
    put(SPH, C.fire, at(rx - 4.8, dy + 3.4, rz - 8.2, 0, 0, 0, 1.5, 1.5, 1.5), BUCKET.GLOW)
    w.light(rx - 4.8, dy + 3.4, rz - 8.2, 0xff6a20, 12, 26, 0.5);
    // caverna com altar
    const cx = rx - 2, cz = rz + 9;
    for (let i = 0; i < 10; i++) {
      const a = Math.PI * 0.15 + (i / 9) * Math.PI * 0.7;
      const x = cx + Math.cos(a) * 6.5, z = cz + Math.sin(a) * 6.5;
      put(SPH, C.rockDark, at(x, base + 1.6, z, 0, 0, 0, 5, 7.5, 5));
      physics.add(x - 2, x + 2, base, base + 5.4, z - 2, z + 2, 'rocha');
    }
    put(BOX, C.stoneDark, at(cx, base + 0.45, cz - 2.4, 0, 0, 0, 2.6, 0.9, 1.8));
    for (let i = 0; i < 6; i++) w.candle(cx - 0.9 + i * 0.36, base + 0.9, cz - 2.1);
    put(SPH, C.candle, at(cx, base + 1.6, cz - 2.4, 0, 0, 0, 0.7, 0.7, 0.7), BUCKET.GLOW)
    w.light(cx, base + 2.0, cz - 2.4, 0xffb060, 9, 18, 0.3);
    // ossada de dragão
    for (let i = 0; i < 9; i++) put(BOX, C.bone, at(rx + 14 - i * 0.8, base + 0.4, rz + 14 + i * 0.5, 0, i * 0.7, 0, 0.6, 0.6, 6.5));
    for (let i = 0; i < 5; i++) put(BOX, C.bone, at(rx + 18, base + 2.6, rz + 17 - i * 0.6, 0, 1.2 + i * 0.2, 0.3, 0.4, 5.5, 0.4));
    w.spawns.rock = new THREE.Vector3(rx - 2, base, rz + 5);
    shrine(w, rx + 12, rz + 22, 'Rochedo do Dragão');
  }

  /* ---------------- RUÍNAS DO SEPTO ANTIGO ---------------- */
  {
    const ux = REALM.ruins.x, uz = REALM.ruins.z;
    const base = gy(ux, uz);
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 2; j++) {
        const x = ux - 12 + i * 4, z = uz + (j ? 6 : -6);
        const h = 2.5 + r() * 4.5;
        put(CYL, C.stone, at(x, base + h / 2, z, r() * 0.06, 0, r() * 0.06, 1.1, h, 1.1));
        if (r() > 0.4) put(BOX, C.stoneLight, at(x, base + h + 0.25, z, 0, 0, 0, 1.5, 0.5, 1.5));
        physics.add(x - 0.6, x + 0.6, base, base + h, z - 0.6, z + 0.6, 'ruina');
      }
    }
    for (let i = 0; i < 5; i++) {
      const h = 3 + r() * 5;
      put(BOX, C.stone, at(ux - 12 + i * 6.5, base + h / 2, uz - 10, 0, (r() - 0.5) * 0.1, 0, 3.6, h, 0.9));
      physics.add(ux - 14.4 + i * 6.5, ux - 9.6 + i * 6.5, base, base + h, uz - 10.6, uz - 9.4, 'parede');
    }
    put(BOX, C.stone, at(ux - 16, base + 3.2, uz + 1, 0, 0.1, 0, 0.9, 6.5, 12));
    physics.add(ux - 16.6, ux - 15.4, base, base + 6.5, uz - 5, uz + 7, 'parede');
    put(BOX, C.stoneDark, at(ux, base + 0.6, uz, 0, 0, 0, 3.4, 1.2, 3.4));
    physics.add(ux - 1.8, ux + 1.8, base, base + 1.2, uz - 1.8, uz + 1.8, 'altar');
    put(SPH, C.stone, at(ux + 9, base + 0.6, uz - 4, 0, 1.1, 0.2, 1.3, 1.6, 1.3));
    put(CYL, C.stone, at(ux + 4, base + 0.5, uz - 6, 1.45, 0, 0, 1.0, 4.0, 1.0));
    put(BOX, C.stone, at(ux + 4, base + 0.3, uz - 8, 0, 0, 0, 2.6, 0.6, 2.6));
    for (let i = 0; i < 8; i++) w.bush(ux - 14 + i * 4.2, uz - 8 + (i % 3) * 6, 0.9);
    w.tree(ux + 14, uz + 8, 1.5, 'oak');
    w.tree(ux - 18, uz + 10, 1.3, 'pine');
    w.brazier(ux - 2.5, base, uz + 3);
    w.brazier(ux + 2.5, base, uz + 3);
    w.light(ux, base + 2, uz, 0xff7040, 9, 22, 0.3);
    w.spawns.ruins = new THREE.Vector3(ux, base, uz + 4);
    shrine(w, ux + 10, uz + 14, 'Septo Antigo');
    put(CYL, C.stoneDark, at(ux - 8, base + 0.8, uz + 6, 0, 0, 0, 2.8, 1.6, 2.8));
  }

  /* ---------------- MONTANHAS E PINHAIS DO HORIZONTE ---------------- */
  for (let i = 0; i < 80; i++) {
    const a = (i / 80) * Math.PI * 2 + r() * 0.05;
    const rad = 216 + r() * 62;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const h = 30 + r() * 62, s = 40 + r() * 62;
    put(CONE, r() > 0.5 ? C.rockDark : 0x2b2f36, at(x, h / 2 - 12, z, 0, r() * 3, 0, s, h, s));
    if (h > 62) put(CONE, 0x596069, at(x, h * 0.84 - 12, z, 0, r() * 3, 0, s * 0.42, h * 0.34, s * 0.42));
  }
  for (let i = 0; i < 150; i++) {
    const x = -240 + r() * 480, z = 196 + r() * 46;
    if (Math.abs(x - RIVER_X) < 30) continue;
    w.tree(x, z, 1.2 + r(), 'pine');
  }
  return w;
}

/** Santuário de pedra: marco com brasa — viagem rápida pelo mapa (M). */
function shrine(w, x, z, name) {
  const y = terrainHeight(x, z);
  const b = w.b;
  b.add(BUCKET.SOLID, unitCyl(8), C.stoneDark, trs(x, y + 0.3, z, 0, 0, 0, 2.6, 0.6, 2.6));
  b.add(BUCKET.SOLID, unitBox(), C.stone, trs(x, y + 1.9, z, 0, 0, 0, 0.7, 3.2, 0.7));
  b.add(BUCKET.SOLID, unitBox(), C.stoneLight, trs(x, y + 3.6, z, 0, 0, 0, 1.1, 0.4, 1.1));
  b.add(BUCKET.GLOW, unitSphere(6), 0xffb45a, trs(x, y + 3.9, z, 0, 0, 0, 0.6, 0.6, 0.6));
  w.light(x, y + 4.1, z, 0xffae5a, 7, 16, 0.25);
  physics.add(x - 1.2, x + 1.2, y, y + 3.8, z - 1.2, z + 1.2, 'santuario');
  SHRINES.push({ name, pos: new THREE.Vector3(x, y + 1, z) });
  w.shrines = SHRINES;
}
