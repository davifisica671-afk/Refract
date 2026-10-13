import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAT_LIT, MAT_GLOW, prep, trs, unitBox, unitCyl, unitCone, unitSphere } from './batch.js';
import { C } from './config.js';

/* =====================================================================
 *  PERSONAGENS PROCEDURAIS
 *  Rig simples porém legível: tronco (1 mesh), 2 braços, 2 coxas, 2 canelas.
 *  Todas as poses são funções puras aplicadas a cada quadro.
 * ===================================================================== */

const BOX = unitBox(), CYL = unitCyl(7), CONE = unitCone(6), SPH = unitSphere(6);

function mesh(geos, material = MAT_LIT) {
  const g = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material);
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}
const add = (arr, geo, color, m) => { arr.push(prep(geo, color, m)); return arr; };

/** Constrói um humanóide. cfg: ver NPC_CATALOG para referência. */
export function makeHumanoid(cfg = {}) {
  const s = cfg.scale || 1;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const rig = { root, body, height: 1.8 * s, s };

  const skin = cfg.skin ?? C.skin;
  const hair = cfg.hair ?? C.hair;
  const cloth = cfg.cloth ?? C.clothBrown;
  const cloth2 = cfg.cloth2 ?? 0x2c2c30;
  const accent = cfg.accent ?? C.gold;
  const boot = cfg.boot ?? 0x241a12;
  const H = 1.8; // altura de referência (depois escala no root)

  /* ---- tronco + cabeça + acessórios (pivot nos quadris) ---- */
  const chestG = [];
  // quadris
  add(chestG, BOX, cloth2, trs(0, 0.06, 0, 0, 0, 0, 0.4, 0.26, 0.26));
  if (cfg.robe || cfg.dress) {
    // saia/túnica longa
    add(chestG, unitCyl(8), cloth, trs(0, -0.34, 0, 0, 0, 0, 0.62, 0.95, 0.52));
    add(chestG, unitCyl(8), cloth2, trs(0, -0.78, 0, 0, 0, 0, 0.74, 0.2, 0.6));
  }
  // peito
  add(chestG, BOX, cloth, trs(0, 0.38, 0, 0, 0, 0, cfg.build?.x ?? 0.46, 0.52, cfg.build?.z ?? 0.27));
  // cinto
  add(chestG, BOX, cfg.belt ?? 0x2a2118, trs(0, 0.16, 0, 0, 0, 0, 0.48, 0.1, 0.29));
  add(chestG, BOX, accent, trs(0, 0.16, 0.15, 0, 0, 0, 0.1, 0.12, 0.04));
  // ombros / peitoral metálico
  if (cfg.metal) {
    add(chestG, BOX, accent, trs(0, 0.5, 0, 0, 0, 0, 0.52, 0.3, 0.32));
    add(chestG, BOX, accent, trs(-0.27, 0.44, 0, 0, 0, 0.3, 0.16, 0.3, 0.3));
    add(chestG, BOX, accent, trs(0.27, 0.44, 0, 0, 0, -0.3, 0.16, 0.3, 0.3));
  }
  // capa
  if (cfg.cloak) {
    add(chestG, BOX, cfg.cloakColor ?? C.banner, trs(0, 0.3, -0.19, 0.06, 0, 0, 0.56, 0.9, 0.08));
    add(chestG, CONE, cfg.cloakColor ?? C.banner, trs(0, -0.16, -0.2, Math.PI, 0, 0, 0.56, 0.2, 0.1));
  }
  // avental
  if (cfg.apron) add(chestG, BOX, 0xb6ab90, trs(0, 0.05, 0.15, 0, 0, 0, 0.4, 0.8, 0.06));
  // pescoço + cabeça
  add(chestG, BOX, skin, trs(0, 0.68, 0, 0, 0, 0, 0.16, 0.14, 0.16));
  add(chestG, BOX, skin, trs(0, 0.85, 0.01, 0, 0, 0, 0.32, 0.34, 0.3));
  // olhos (brilho)
  const eyeY = 0.88, eyeZ = 0.16;
  add(chestG, unitBox(), cfg.eye ?? 0x1a1410, trs(-0.08, eyeY, eyeZ, 0, 0, 0, 0.06, 0.05, 0.02));
  add(chestG, unitBox(), cfg.eye ?? 0x1a1410, trs(0.08, eyeY, eyeZ, 0, 0, 0, 0.06, 0.05, 0.02));
  // cabelo
  if (cfg.hairStyle !== 'bald') {
    add(chestG, BOX, hair, trs(0, 1.0, -0.01, 0, 0, 0, 0.35, 0.14, 0.33));
    if (cfg.longHair) add(chestG, BOX, hair, trs(0, 0.83, -0.15, 0, 0, 0, 0.34, 0.42, 0.12));
    if (cfg.hairStyle === 'braid') add(chestG, CYL, hair, trs(0, 0.8, -0.18, 0, 0, 0, 0.1, 0.5, 0.1));
  }
  // barba
  if (cfg.beard) add(chestG, BOX, cfg.beardColor ?? hair, trs(0, 0.73, 0.1, 0, 0, 0, 0.26, 0.2, 0.14));
  // elmo / coroa / chapéu
  if (cfg.helm) {
    add(chestG, unitSphere(7), accent, trs(0, 0.9, 0, 0, 0, 0, 0.4, 0.38, 0.4));
    add(chestG, BOX, accent, trs(0, 0.74, 0.15, 0, 0, 0, 0.34, 0.2, 0.06));
    if (cfg.plume) add(chestG, BOX, cfg.plumeColor ?? C.wine, trs(0, 1.06, -0.05, 0.2, 0, 0, 0.1, 0.3, 0.3));
  } else if (cfg.crown) {
    add(chestG, unitCyl(8), accent, trs(0, 1.03, 0, 0, 0, 0, 0.34, 0.12, 0.32));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      add(chestG, CONE, accent, trs(Math.cos(a) * 0.13, 1.12, Math.sin(a) * 0.12, 0, 0, 0, 0.08, 0.16, 0.08));
    }
  } else if (cfg.hood) {
    add(chestG, unitCone(7), cfg.hoodColor ?? cloth, trs(0, 0.98, -0.02, 0, 0, 0, 0.44, 0.4, 0.44));
    add(chestG, BOX, cfg.hoodColor ?? cloth, trs(0, 0.8, -0.16, 0.3, 0, 0, 0.36, 0.5, 0.16));
  } else if (cfg.hat) {
    add(chestG, unitCyl(8), cfg.hatColor ?? 0x2a2118, trs(0, 1.02, 0, 0, 0, 0, 0.6, 0.06, 0.6));
    add(chestG, unitCyl(8), cfg.hatColor ?? 0x2a2118, trs(0, 1.08, 0, 0, 0, 0, 0.3, 0.16, 0.3));
  }
  // corrente de mestre
  if (cfg.chain) {
    for (let i = 0; i < 6; i++) {
      const a = -0.4 + i * 0.16;
      add(chestG, BOX, [C.gold, 0x8c8c94, C.steel, C.gold, 0x6b6b72, C.brass][i], trs(Math.sin(a) * 0.16, 0.4 - Math.abs(i - 2.5) * 0.03, 0.16, 0, 0, 0, 0.09, 0.09, 0.05));
    }
  }
  // asas (criatura)
  if (cfg.wings) {
    for (const d of [-1, 1]) {
      add(chestG, BOX, cfg.wingColor ?? 0x1a1a20, trs(d * 0.44, 0.44, -0.16, 0.2, d * 0.4, d * 0.5, 0.7, 1.2, 0.08));
      add(chestG, BOX, cfg.wingColor ?? 0x1a1a20, trs(d * 0.72, 0.1, -0.24, 0.2, d * 0.7, d * 0.9, 0.6, 0.9, 0.06));
    }
  }
  const chest = mesh(chestG);
  const chestPivot = new THREE.Group();
  chestPivot.position.y = 0.86 * 1;
  chestPivot.add(chest);
  body.add(chestPivot);
  rig.chest = chestPivot;

  /* ---- cabeça independente (para olhar) ---- */
  const headG = [];
  add(headG, BOX, skin, trs(0, 0, 0, 0, 0, 0, 0.16, 0.16, 0.16));
  const headMesh = mesh(headG);
  headMesh.visible = false;
  body.add(headMesh);

  /* ---- braços ---- */
  const mkArm = (dir) => {
    const g = [];
    const len = cfg.build?.arm ?? 0.62;
    add(g, BOX, cfg.metal ? accent : cloth, trs(0, -len / 2, 0, 0, 0, 0, 0.14, len, 0.15));
    add(g, BOX, skin, trs(0, -len + 0.05, 0.01, 0, 0, 0, 0.12, 0.22, 0.13));
    if (cfg.gloves) add(g, BOX, accent, trs(0, -len + 0.02, 0, 0, 0, 0, 0.15, 0.2, 0.16));
    const m = mesh(g);
    const grp = new THREE.Group();
    grp.position.set(dir * (cfg.build?.sx ?? 0.3), 1.4, 0);
    grp.add(m);
    body.add(grp);
    return grp;
  };
  rig.armL = mkArm(-1);
  rig.armR = mkArm(1);

  /* ---- pernas ---- */
  const mkLeg = (dir) => {
    const thighLen = 0.42, shinLen = 0.44;
    const thighG = [];
    add(thighG, BOX, cfg.robe || cfg.dress ? cloth2 : cloth2, trs(0, -thighLen / 2, 0, 0, 0, 0, 0.17, thighLen, 0.18));
    const thigh = mesh(thighG);
    const tGrp = new THREE.Group();
    tGrp.position.set(dir * 0.13, 0.86, 0);
    tGrp.add(thigh);
    body.add(tGrp);
    const shinG = [];
    add(shinG, BOX, cloth2, trs(0, -shinLen / 2, 0, 0, 0, 0, 0.15, shinLen, 0.16));
    add(shinG, BOX, boot, trs(0, -shinLen + 0.02, 0.04, 0, 0, 0, 0.17, 0.16, 0.26));
    const shin = mesh(shinG);
    const sGrp = new THREE.Group();
    sGrp.position.y = -thighLen;
    sGrp.add(shin);
    tGrp.add(sGrp);
    return { thigh: tGrp, shin: sGrp };
  };
  const L = mkLeg(-1), R = mkLeg(1);
  rig.thighL = L.thigh; rig.shinL = L.shin;
  rig.thighR = R.thigh; rig.shinR = R.shin;

  root.scale.setScalar(s);
  root.traverse(o => { o.frustumCulled = true; });
  rig.kind = 'human';
  return rig;
}

/* =====================================================================
 *  RIG QUADRÚPEDE (cavalo, cervo, lobo)
 * ===================================================================== */
export function makeQuadruped(cfg = {}) {
  const s = cfg.scale || 1;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const rig = { root, body, s, kind: 'quad' };
  const coat = cfg.coat ?? 0x3a2a1c;
  const coat2 = cfg.coat2 ?? 0x241a12;
  const mane = cfg.mane ?? 0x12100e;

  const torsoG = [];
  add(torsoG, BOX, coat, trs(0, 1.05, 0, 0, 0, 0, 0.62, 0.66, cfg.bodyLen ?? 1.5));
  add(torsoG, BOX, coat2, trs(0, 0.78, 0.1, 0, 0, 0, 0.56, 0.3, 1.2));
  add(torsoG, BOX, coat, trs(0, 1.1, -0.6, 0, 0, 0, 0.5, 0.5, 0.4));  // garupa
  const torso = mesh(torsoG);
  body.add(torso);
  // pescoço + cabeça
  const neckG = [];
  add(neckG, BOX, coat, trs(0, 0.34, -0.34, -0.5, 0, 0, 0.34, 0.85, 0.36));
  add(neckG, BOX, mane, trs(0, 0.5, -0.5, -0.5, 0, 0, 0.14, 0.9, 0.34));
  add(neckG, BOX, coat, trs(0, 0.62, -0.72, 0, 0, 0, 0.3, 0.34, 0.62));
  add(neckG, BOX, coat2, trs(0, 0.55, -1.0, 0.1, 0, 0, 0.26, 0.24, 0.26));
  add(neckG, BOX, 0x120f0c, trs(-0.1, 0.68, -0.9, 0, 0, 0, 0.06, 0.08, 0.06));
  add(neckG, BOX, 0x120f0c, trs(0.1, 0.68, -0.9, 0, 0, 0, 0.06, 0.08, 0.06));
  if (cfg.horns) {
    add(neckG, CONE, 0x1a1a1e, trs(-0.22, 0.86, -0.6, 0.4, 0, -0.6, 0.16, 0.7, 0.16));
    add(neckG, CONE, 0x1a1a1e, trs(0.22, 0.86, -0.6, 0.4, 0, 0.6, 0.16, 0.7, 0.16));
  }
  const neck = new THREE.Group();
  neck.position.set(0, 1.15, -0.5);
  neck.add(mesh(neckG));
  body.add(neck);
  rig.neck = neck;
  // cauda
  const tailG = [];
  add(tailG, BOX, mane, trs(0, -0.3, 0.3, 0.5, 0, 0, 0.12, 0.7, 0.12));
  const tail = new THREE.Group();
  tail.position.set(0, 1.2, 0.75);
  tail.add(mesh(tailG));
  body.add(tail);
  rig.tail = tail;
  // patas
  const mkLeg = (x, z) => {
    const g = [];
    add(g, BOX, coat, trs(0, -0.32, 0.06, 0, 0, 0, 0.19, 0.64, 0.22));
    add(g, BOX, coat2, trs(0, -0.62, 0.04, 0, 0, 0, 0.16, 0.3, 0.18));
    const grp = new THREE.Group();
    grp.position.set(x, 0.98, z);
    grp.add(mesh(g));
    body.add(grp);
    return grp;
  };
  rig.legFL = mkLeg(-0.24, -0.5);
  rig.legFR = mkLeg(0.24, -0.5);
  rig.legBL = mkLeg(-0.24, 0.55);
  rig.legBR = mkLeg(0.24, 0.55);
  root.scale.setScalar(s);
  return rig;
}

/* =====================================================================
 *  POSES
 * ===================================================================== */
const R = (o, x = 0, y = 0, z = 0) => o.rotation.set(x, y, z);

export function resetRig(r) {
  r.body.position.set(0, 0, 0);
  R(r.body, 0, 0, 0);
  if (r.chest) R(r.chest, 0, 0, 0);
  if (r.armL) R(r.armL, 0, 0, 0);
  if (r.armR) R(r.armR, 0, 0, 0);
  if (r.thighL) { R(r.thighL); R(r.shinL); }
  if (r.thighR) { R(r.thighR); R(r.shinR); }
  if (r.neck) R(r.neck);
  if (r.tail) R(r.tail);
  for (const k of ['legFL', 'legFR', 'legBL', 'legBR']) if (r[k]) R(r[k]);
}

const S = Math.sin, CS = Math.cos;

export const ANIMS = {
  /* ---------- humanóides ---------- */
  idle(r, t) {
    if (!r.chest) return;
    r.body.position.y = S(t * 1.5) * 0.012;
    R(r.chest, S(t * 1.5) * 0.02, S(t * 0.35) * 0.08, S(t * 0.7) * 0.015);
    R(r.armL, S(t * 1.5) * 0.06, 0, 0.07 + S(t * 1.1) * 0.02);
    R(r.armR, -S(t * 1.5) * 0.06, 0, -0.07 - S(t * 1.1) * 0.02);
    R(r.thighL, 0, 0, 0.02); R(r.thighR, 0, 0, -0.02);
  },
  talk(r, t) {
    ANIMS.idle(r, t);
    R(r.chest, S(t * 2.2) * 0.05, S(t * 0.6) * 0.2, S(t * 2.2) * 0.02);
    R(r.armR, -0.9 + S(t * 4.1) * 0.25, 0, -0.35);
    R(r.armL, -0.15, 0, 0.12 + S(t * 2.3) * 0.1);
  },
  walk(r, t, spd = 1) {
    const p = t * 5.2 * spd;
    r.body.position.y = Math.abs(S(p)) * 0.05 - 0.02;
    R(r.chest, 0.06, S(p) * 0.1, 0);
    R(r.thighL, S(p) * 0.62, 0, 0.02);
    R(r.shinL, -Math.max(0, -S(p)) * 0.9 - 0.08, 0, 0);
    R(r.thighR, -S(p) * 0.62, 0, -0.02);
    R(r.shinR, -Math.max(0, S(p)) * 0.9 - 0.08, 0, 0);
    R(r.armL, -S(p) * 0.45, 0, 0.1);
    R(r.armR, S(p) * 0.45, 0, -0.1);
  },
  run(r, t, spd = 1) {
    const p = t * 8.6 * spd;
    r.body.position.y = Math.abs(S(p)) * 0.09 + 0.02;
    R(r.chest, 0.3, S(p) * 0.14, 0);
    R(r.thighL, S(p) * 0.95, 0, 0.03);
    R(r.shinL, -Math.max(0, -S(p)) * 1.5 - 0.2, 0, 0);
    R(r.thighR, -S(p) * 0.95, 0, -0.03);
    R(r.shinR, -Math.max(0, S(p)) * 1.5 - 0.2, 0, 0);
    R(r.armL, -S(p) * 0.9 - 0.3, 0, 0.2);
    R(r.armR, S(p) * 0.9 - 0.3, 0, -0.2);
  },
  sneak(r, t) {
    const p = t * 4.4;
    r.body.position.y = -0.22;
    R(r.chest, 0.34, S(p) * 0.08, 0);
    R(r.thighL, 0.34 + S(p) * 0.5, 0, 0.04);
    R(r.shinL, -0.8 - Math.max(0, -S(p)) * 0.6, 0, 0);
    R(r.thighR, 0.34 - S(p) * 0.5, 0, -0.04);
    R(r.shinR, -0.8 - Math.max(0, S(p)) * 0.6, 0, 0);
    R(r.armL, -0.7 - S(p) * 0.3, 0, 0.2);
    R(r.armR, -0.7 + S(p) * 0.3, 0, -0.2);
  },
  sit(r, t) {
    r.body.position.y = -0.42;
    R(r.chest, 0.06, S(t * 0.4) * 0.12, 0);
    R(r.thighL, -1.45, 0, 0.06); R(r.shinL, 1.45, 0, 0);
    R(r.thighR, -1.45, 0, -0.06); R(r.shinR, 1.45, 0, 0);
    R(r.armL, -0.5 + S(t * 1.2) * 0.05, 0, 0.15);
    R(r.armR, -0.5 - S(t * 1.2) * 0.05, 0, -0.15);
  },
  sitThrone(r, t) {
    r.body.position.y = -0.34;
    R(r.chest, -0.06, S(t * 0.3) * 0.1, 0);
    R(r.thighL, -1.25, 0, 0.1); R(r.shinL, 1.3, 0, 0);
    R(r.thighR, -1.25, 0, -0.1); R(r.shinR, 1.3, 0, 0);
    R(r.armL, -0.25, 0, 0.35); R(r.armR, -0.25, 0, -0.35);
  },
  kneel(r, t) {
    r.body.position.y = -0.5;
    R(r.chest, 0.22, 0, 0);
    R(r.thighL, -1.6, 0, 0.12); R(r.shinL, 1.7, 0, 0);
    R(r.thighR, -0.4, 0, -0.1); R(r.shinR, 0.9, 0, 0);
    R(r.armL, -0.35, 0, 0.1); R(r.armR, -0.35 + S(t) * 0.03, 0, -0.1);
  },
  pray(r, t) {
    ANIMS.kneel(r, t);
    R(r.chest, 0.45, 0, 0);
    R(r.armL, -1.4, 0, 0.5); R(r.armR, -1.4, 0, -0.5);
  },
  sleep(r) {
    r.body.position.set(0, -0.82, 0);
    r.body.rotation.set(-Math.PI / 2, 0, 0.08);
    R(r.chest, 0.1, 0, 0);
    R(r.armL, 0, 0, 0.5); R(r.armR, 0, 0, -0.5);
    R(r.thighL, 0.3, 0, 0.1); R(r.shinL, -0.4, 0, 0);
    R(r.thighR, 0.3, 0, -0.1); R(r.shinR, -0.4, 0, 0);
  },
  work(r, t) {
    const p = t * 4.6;
    r.body.position.y = -0.1;
    R(r.chest, 0.3 + S(p) * 0.25, 0, 0);
    R(r.armL, -1.0 - S(p) * 0.6, 0, 0.25);
    R(r.armR, -1.0 - S(p) * 0.6, 0, -0.25);
    R(r.thighL, 0.18, 0, 0.06); R(r.thighR, 0.18, 0, -0.06);
    R(r.shinL, -0.2); R(r.shinR, -0.2);
  },
  dance(r, t) {
    const p = t * 5.2;
    r.body.position.y = Math.abs(S(p)) * 0.08;
    R(r.chest, S(p * 2) * 0.12, S(p) * 0.5, S(p) * 0.1);
    R(r.armL, -2.2 + S(p * 2) * 0.4, 0, 0.8);
    R(r.armR, -2.2 - S(p * 2) * 0.4, 0, -0.8);
    R(r.thighL, S(p * 2) * 0.3, 0, 0.15);
    R(r.thighR, -S(p * 2) * 0.3, 0, -0.15);
  },
  drink(r, t) {
    ANIMS.idle(r, t);
    R(r.armR, -1.9, 0, -0.6);
    R(r.chest, -0.12, 0, 0);
  },
  ride(r, t, spd = 1) {
    const p = t * (3 + spd * 2);
    R(r.chest, 0.2 + (spd > 1.4 ? 0.16 : 0), S(p) * 0.05, 0);
    r.body.position.y = Math.abs(S(p)) * 0.06 * spd;
    R(r.thighL, -1.1, 0, 0.55); R(r.shinL, 1.0, 0, 0);
    R(r.thighR, -1.0, 0, -0.55); R(r.shinR, 0.95, 0, 0);
    R(r.armL, -0.85, 0, 0.35); R(r.armR, -0.85, 0, -0.35);
  },
  dead(r) {
    r.body.position.set(0, -0.86, 0.1);
    r.body.rotation.set(Math.PI / 2.1, 0.3, 0);
    R(r.armL, 0, 0, 1.4); R(r.armR, 0, 0, -1.4);
    R(r.thighL, -0.2, 0, 0.2); R(r.thighR, -0.2, 0, -0.2);
  },
  /* ---------- quadrúpedes ---------- */
  qIdle(r, t) {
    r.body.position.y = S(t * 1.2) * 0.012;
    R(r.neck, S(t * 1.1) * 0.03, S(t * 0.3) * 0.12, 0);
    R(r.tail, S(t * 1.3) * 0.15, 0, S(t * 2.1) * 0.12);
  },
  qGraze(r, t) {
    ANIMS.qIdle(r, t);
    R(r.neck, 0.85, S(t * 0.4) * 0.2, 0);
  },
  qWalk(r, t, spd = 1) {
    const p = t * 4.2 * spd;
    r.body.position.y = Math.abs(S(p * 2)) * 0.035;
    R(r.legFL, S(p) * 0.55); R(r.legFR, -S(p) * 0.55);
    R(r.legBL, -S(p) * 0.55); R(r.legBR, S(p) * 0.55);
    R(r.neck, S(p * 2) * 0.06, 0, 0);
    R(r.tail, 0.1, 0, S(p) * 0.2);
  },
  qTrot(r, t, spd = 1) {
    const p = t * 6.5 * spd;
    r.body.position.y = Math.abs(S(p * 2)) * 0.06;
    R(r.legFL, S(p) * 0.8 + 0.1); R(r.legFR, -S(p) * 0.8 + 0.1);
    R(r.legBL, -S(p) * 0.8 - 0.05); R(r.legBR, S(p) * 0.8 - 0.05);
    R(r.neck, -0.12 + S(p * 2) * 0.08, 0, 0);
    R(r.tail, 0.2, 0, S(p) * 0.25);
  },
  qGallop(r, t, spd = 1) {
    const p = t * 9.5 * spd;
    r.body.position.y = Math.abs(S(p)) * 0.14;
    R(r.legFL, S(p) * 1.15 + 0.2); R(r.legFR, S(p + 1.1) * 1.15 + 0.2);
    R(r.legBL, -S(p + 0.5) * 1.2 - 0.15); R(r.legBR, -S(p + 1.6) * 1.2 - 0.15);
    R(r.neck, -0.28 + S(p) * 0.1, 0, 0);
    R(r.tail, 0.5, 0, S(p) * 0.3);
  },
  qSleep(r) {
    r.body.position.set(0, -0.62, 0);
    r.body.rotation.set(0, 0, Math.PI / 2);
    R(r.neck, 0.6, 0, 0.4);
    for (const k of ['legFL', 'legFR', 'legBL', 'legBR']) R(r[k], 0.3, 0, k.includes('L') ? 0.6 : -0.6);
  },
};

const QUAD_FALLBACK = { walk: 'qWalk', run: 'qGallop', idle: 'qIdle', sleep: 'qSleep', trot: 'qTrot' };

/** Aplica uma pose por nome; avança o relógio da entidade.
 *  Corrige automaticamente animações humanas aplicadas a rigs quadrúpedes (e vice-versa). */
export function animate(rig, name, dt) {
  rig.t = (rig.t || 0) + dt;
  resetRig(rig);
  const isQuad = rig.kind === 'quad';
  if (isQuad && !String(name).startsWith('q')) name = QUAD_FALLBACK[name] || 'qIdle';
  if (!isQuad && String(name).startsWith('q')) name = 'idle';
  const fn = ANIMS[name] || (isQuad ? ANIMS.qIdle : ANIMS.idle);
  fn(rig, rig.t, rig.spd || 1);
}
