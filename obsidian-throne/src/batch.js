import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Materiais compartilhados de todo o mundo.
 * Tudo usa vertex colors → pouquíssimos draw calls.
 */
export const MAT_LIT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
export const MAT_SMOOTH = new THREE.MeshLambertMaterial({ vertexColors: true });
export const MAT_GLOW = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
export const MAT_GLOW_FOG = new THREE.MeshBasicMaterial({ vertexColors: true });
export const MAT_WATER = new THREE.MeshLambertMaterial({
  color: 0x1b2b33, transparent: true, opacity: 0.82, flatShading: true,
});
export const MAT_LEAF = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

const _c = new THREE.Color();

/** Pinta uma geometria inteira com uma cor (cria atributo `color`). */
export function paint(geo, color) {
  _c.set(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Normaliza geometria para merge: não-indexada, sem uv, com matriz aplicada. */
export function prep(geo, color, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  if (matrix) g.applyMatrix4(matrix);
  g.deleteAttribute('color');
  paint(g, color);
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

export function trs(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_v, _q, _s);
}

/** Cria um Mesh estático (não mesclado) já pintado, pronto para entrar num Group. */
export function mkMesh(geo, color, matrix, material = MAT_LIT) {
  const g = prep(geo, color, matrix || new THREE.Matrix4());
  return new THREE.Mesh(g, material);
}

/** Caixa pintada com centro em (x,y,z) e tamanho (w,h,d). */
export function mkBox(w, h, d, x, y, z, color, ry = 0, material = MAT_LIT) {
  return mkMesh(unitBox(), color, trs(x, y, z, 0, ry, 0, w, h, d), material);
}

let _box = null;
export function unitBox() {
  if (!_box) _box = new THREE.BoxGeometry(1, 1, 1);
  return _box;
}
let _cyl = null;
export function unitCyl(seg = 7) {
  if (!_cyl) _cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, seg);
  return _cyl;
}
let _cone = null;
export function unitCone(seg = 6) {
  if (!_cone) _cone = new THREE.ConeGeometry(0.5, 1, seg);
  return _cone;
}
let _sph = null;
export function unitSphere(seg = 7) {
  if (!_sph) _sph = new THREE.IcosahedronGeometry(0.5, 1);
  return _sph;
}

/** Prisma triangular (telhado de duas águas), 1×1×1, aresta no topo ao longo de Z. */
let _prism = null;
export function unitPrism() {
  if (_prism) return _prism;
  const g = new THREE.BufferGeometry();
  const v = [
    // face esquerda
    -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5,
    // face direita
    0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
    // tampas
    -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  _prism = g;
  return g;
}

/** Pirâmide de 4 faces (telhados de torre). */
let _pyr = null;
export function unitPyramid() {
  if (_pyr) return _pyr;
  const g = new THREE.ConeGeometry(0.5, 1, 4, 1, false);
  g.rotateY(Math.PI / 4);
  _pyr = g;
  return g;
}

/**
 * Acumula geometria estática e no fim mescla tudo por "bucket",
 * resultando em pouquíssimas chamadas de desenho.
 */
export class Batcher {
  constructor() {
    this.buckets = new Map();
    this.count = 0;
    this.yOff = 0;      // deslocamento vertical dos móveis (andar atual)
  }
  /** Adiciona geometria já preparada (com cor e matriz aplicada). */
  push(key, geo) {
    let b = this.buckets.get(key);
    if (!b) { b = []; this.buckets.set(key, b); }
    b.push(geo);
    this.count++;
    return this;
  }
  /** Atalho: geometria + cor + matriz. */
  add(key, geo, color, matrix) {
    const g = prep(geo, color, matrix);
    if (this.yOff) g.translate(0, this.yOff, 0);
    return this.push(key, g);
  }
  /** Atalho: caixa. */
  box(key, w, h, d, x, y, z, color, ry = 0) {
    return this.add(key, unitBox(), color, trs(x, y, z, 0, ry, 0, w, h, d));
  }
  /** Atalho: cilindro vertical. */
  cyl(key, r, h, x, y, z, color, seg = 7, rot = null) {
    const m = rot || trs(x, y, z, 0, 0, 0, r * 2, h, r * 2);
    return this.add(key, unitCyl(seg), color, m);
  }
  /** Mescla e devolve os meshes. */
  finalize(group, materials = {}) {
    const out = [];
    for (const [key, list] of this.buckets) {
      if (!list.length) continue;
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) { console.warn('merge falhou:', key, list.length); continue; }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[key] || MAT_LIT);
      mesh.name = 'batch_' + key;
      mesh.castShadow = (key === BUCKET.SOLID || key === BUCKET.LEAF);
      mesh.receiveShadow = key === BUCKET.SOLID || key === BUCKET.LEAF || key === BUCKET.GLOWFOG;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      out.push(mesh);
    }
    this.buckets.clear();
    return out;
  }
}

export const BUCKET = {
  SOLID: 'solid',
  GLOW: 'glow',
  GLOWFOG: 'glowfog',
  WATER: 'water',
  LEAF: 'leaf',
};
