/**
 * Verificação headless do mundo: monta o castelo (sem WebGL) e percorre o
 * mapa usando a MESMA física do jogo, provando que os 10 quartos, os 3
 * andares, a cripta e o reino exterior são alcançáveis a pé.
 *
 *   node scripts/verify.mjs
 */
import * as THREE from 'three';
import { World } from '../src/world.js';
import { physics, terrainHeight, STEP_UP, ROOMS, PLACES, FLOOR } from '../src/config.js';
import { SHRINES, REALM } from '../src/realm.js';
import { spawnNPCs } from '../src/npcs.js';

const t0 = Date.now();
const scene = new THREE.Scene();
const world = new World(scene).build();
const buildMs = Date.now() - t0;
console.log(`\n=== CONSTRUÇÃO ===`);
console.log(`tempo: ${buildMs} ms`);
console.log(`peças de geometria: ${world.b.count}`);
console.log(`objetos na cena: ${scene.children.length + world.group.children.length}`);
console.log(`meshes mesclados: ${world.group.children.filter(o => o.isMesh).length}`);
console.log(`luzes pontuais: ${world.lights.length}`);
console.log(`colisores AABB: ${physics.boxes.length}`);

// sanidade numérica da geometria
let bad = 0, tris = 0;
world.group.traverse(o => {
  if (!o.isMesh) return;
  const p = o.geometry.attributes.position.array;
  tris += p.length / 9;
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) { bad++; break; }
  const bs = o.geometry.boundingSphere;
  if (bs && (!Number.isFinite(bs.radius) || !Number.isFinite(bs.center.x))) bad++;
});
console.log(`triângulos: ${Math.round(tris)}  | geometrias inválidas: ${bad}`);
if (bad) { console.error('FALHOU: geometria com NaN/esfera inválida'); process.exit(1); }

/* ---------- BFS de navegabilidade ---------- */
function bfs(start, { step = 0.55, minX, maxX, minZ, maxZ, minY = -8, maxY = 16, maxNodes = 400000 } = {}) {
  const key = (x, z, y) => `${Math.round(x / step)}:${Math.round(z / step)}:${Math.round(y / 0.4)}`;
  const seen = new Set();
  const reached = [];
  const queue = [];
  let sy = physics.groundAt(start[0], start[1], start[2] ?? 6);
  if (sy === -Infinity) sy = terrainHeight(start[0], start[1]);
  queue.push([start[0], sy, start[1]]);
  seen.add(key(start[0], start[1], sy));
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  let head = 0, nodes = 0;
  while (head < queue.length && nodes < maxNodes) {
    const [x, y, z] = queue[head++];
    nodes++;
    reached.push([x, y, z]);
    for (const [dx, dz] of dirs) {
      const nx = x + dx * step, nz = z + dz * step;
      if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) continue;
      const g = physics.groundAt(nx, nz, y);
      if (g === -Infinity) continue;
      if (g < minY || g > maxY) continue;
      const diff = g - y;
      if (diff > STEP_UP) continue;                 // degrau alto demais
      // mesma regra do controlador do jogador: sobe degraus usando o solo de destino como referência
      const ref = Math.max(y, g);
      if (physics.blocked(nx, y, nz, 0.42, 1.7, true, ref)) continue;
      if (diff < -STEP_UP) {                         // queda: precisa ter espaço vertical
        const ceil = physics.ceilingAt(nx, nz, g + 0.1);
        if (ceil !== Infinity && ceil < g + 1.75) continue;
      }
      const k = key(nx, nz, g);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push([nx, g, nz]);   // estado = [x, y, z]
    }
  }
  return { reached, nodes };
}

/* --- 1) interior do castelo + pátios --- */
const tCastle = Date.now();
const castle = bfs([6.5, 20, 6], { step: 0.45, minX: -46, maxX: 46, minZ: -36, maxZ: 36 });
console.log(`\n=== NAVEGABILIDADE DO CASTELO ===`);
console.log(`nós explorados: ${castle.nodes} em ${Date.now() - tCastle} ms`);
const found = new Map();
for (const [x, y, z] of castle.reached) {
  const r = world.roomAt(x, z, y);
  if (r) found.set(r.name, Math.min(found.get(r.name) ?? 99, Math.abs(y - (r.floor === -4 ? -4 : r.floor))));
}
const missing = [];
for (const r of [...ROOMS, ...PLACES]) {
  const cx = (r.x[0] + r.x[1]) / 2, cz = (r.z[0] + r.z[1]) / 2;
  if (cx < -46 || cx > 46 || cz < -36 || cz > 36) continue;   // fora da área do BFS do castelo
  const levelTxt = r.floor === -4 ? 'cripta' : r.floor === 0 ? 'térreo' : r.floor === 4 ? '1º andar' : '2º andar';
  const ok = found.has(r.name);
  console.log(` ${ok ? '✓' : '✗'} ${r.n !== undefined ? 'Q' + r.n + ' ' : '   '}${r.name.padEnd(26)} ${levelTxt}`);
  if (!ok) missing.push(r.name);
}

/* --- 2) reino exterior (portão aberto) --- */
const wasOpen = world.gate.open;
if (!wasOpen) world.toggleGate();
const tRealm = Date.now();
const realm = bfs([0, 30, 6], { step: 2.0, minX: -250, maxX: 250, minZ: -250, maxZ: 260, maxNodes: 200000 });
console.log(`\n=== NAVEGABILIDADE DO REINO ===`);
console.log(`nós explorados: ${realm.nodes} em ${Date.now() - tRealm} ms`);
const targets = [
  ['Vila Cinzalta', REALM.village.x, REALM.village.z],
  ['Ponte do Rio Cinza', REALM.bridge.x, REALM.bridge.z],
  ['Rochedo do Dragão', REALM.rock.x, REALM.rock.z],
  ['Septo Antigo (ruínas)', REALM.ruins.x, REALM.ruins.z],
  ['Bosque Antigo (clareira)', REALM.forest.x, REALM.forest.z],
];
for (const [name, tx, tz] of targets) {
  let best = Infinity;
  for (const [x, , z] of realm.reached) {
    const d = Math.hypot(x - tx, z - tz);
    if (d < best) best = d;
  }
  const ok = best < 14;
  console.log(` ${ok ? '✓' : '✗'} ${name.padEnd(26)} distância mínima atingida: ${best.toFixed(1)} m`);
  if (!ok) missing.push(name);
}
if (!wasOpen) world.toggleGate();
for (const s of SHRINES) {
  let best = Infinity;
  for (const [x, , z] of realm.reached) {
    const d = Math.hypot(x - s.pos.x, z - s.pos.z);
    if (d < best) best = d;
  }
  console.log(`   santuário ${s.name.padEnd(22)} ${best.toFixed(1)} m`);
}

/* --- 3) telhado alcançável? (não deve ser) --- */
let onRoof = 0;
for (const [x, y, z] of castle.reached) if (y > FLOOR.roof - 0.4 && Math.abs(x) < 15 && Math.abs(z) < 13) onRoof++;
console.log(`\nestados no telhado (y≈12): ${onRoof}`);

/** Algum obstáculo ALTO (parede, estante, estátua) atravessa este ponto?
 *  Móveis baixos (cama, mesa, banco) não contam: há NPCs que dormem/sentam neles. */
function tallBlock(x, y, z, r) {
  for (const b of physics.boxes) {
    if (!b.enabled) continue;
    if (b.y1 < y + 1.5) continue;
    if (b.y0 >= y + 1.6) continue;
    if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 *  POSTOS DOS NPCs — todo NPC precisa nascer sobre piso sólido e fora de paredes
 * ------------------------------------------------------------------ */
const npcs = spawnNPCs(world);
let npcBad = 0;
for (const n of npcs) {
  const p = n.pos;                  // y = altura do quadril (a rig fica ~0,9 m acima dos pés)
  const g = physics.groundAt(p.x, p.z, p.y);
  const stuck = tallBlock(p.x, p.y, p.z, 0.42);
  const room = world.roomAt(p.x, p.z, p.y - 0.9);
  if (g === -Infinity || stuck) {
    npcBad++;
    console.log(` ✗ ${n.name.padEnd(24)} x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} z=${p.z.toFixed(1)} solo=${g.toFixed(2)} bloqueado=${stuck}`);
  } else if (room && n.room && room.name !== n.room) {
    console.log(`   ${n.name.padEnd(24)} declarado em "${n.room}", nasce em "${room.name}"`);
  } else if (!room && n.room) {
    console.log(`   ${n.name.padEnd(24)} declarado em "${n.room}", sem sala no ponto de nascimento`);
  }
}
const declared = npcs.filter(n => n.room).length;
console.log(`NPCs: ${npcs.length} (${declared} com sala declarada) | postos inválidos: ${npcBad}`);

console.log(`\n=== RESULTADO ===`);
if (npcBad) missing.push(`${npcBad} NPC(s) em posto inválido`);
if (missing.length) {
  console.error('FALHOU — inalcançáveis: ' + missing.join(', '));
  process.exit(1);
}
console.log('OK — todos os quartos, andares e lugares do reino são alcançáveis a pé.\n');
