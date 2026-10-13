import * as THREE from 'three';
import { makeHumanoid, makeQuadruped, animate } from './character.js';
import { C, physics, terrainHeight, clamp } from './config.js';
import { REALM } from './realm.js';

/* =====================================================================
 *  NPC — rotina diária, deslocamento, poses e diálogo
 * ===================================================================== */
export class NPC {
  constructor(world, def) {
    this.world = world;
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.title = def.title || '';
    this.room = def.room || '';
    this.kind = def.kind || 'human';
    this.rig = this.kind === 'quad' || this.kind === 'horse'
      ? makeQuadruped(def.look || {})
      : makeHumanoid(def.look || {});
    this.group = new THREE.Group();
    this.group.add(this.rig.root);
    this.pos = new THREE.Vector3().fromArray(def.spawn);
    // altura do quadril: o rig fica com os pés ~0,9 m abaixo da raiz
    this.hip = (def.kind === 'quad' || def.kind === 'horse') ? 0.78 : 0.9;
    // se o posto veio com y errado (NPC enterrado no terreno), assenta no solo
    let gs = -Infinity;
    for (let k = 0; k <= 8 && gs === -Infinity; k++) {
      gs = physics.groundAt(this.pos.x, this.pos.z, this.pos.y + k * 0.5);
    }
    if (gs !== -Infinity && Math.abs(gs + this.hip - this.pos.y) > 1.0) this.pos.y = gs + this.hip;
    this.home = this.pos.clone();
    this.yaw = def.yaw ?? 0;
    this.target = null;
    this.waitT = 0;
    this.state = def.behavior || 'stand';
    this.anim = 'idle';
    this.spd = 1;
    this.lastRoom = '';
    this.bubbleT = 0;
    this.line = '';
    this.rider = null;
    this.ignoreSchedule = false;
    this.dialogue = def.dialogue || null;
    this.flags = {};
    this.r = 0.42;
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    world.group.add(this.group);
  }

  /* ---------- rotina ---------- */
  currentPost(hour) {
    const s = this.def.schedule;
    if (!s) return this.def.posts?.[0] || { p: this.def.spawn, yaw: this.yaw };
    for (const seg of s) {
      const from = seg.from, to = seg.to;
      if (from <= to ? (hour >= from && hour < to) : (hour >= from || hour < to)) return seg;
    }
    return this.def.posts?.[0] || { p: this.def.spawn, yaw: this.yaw };
  }

  update(dt, player, hour, game) {
    const def = this.def;
    let seg = this.currentPost(hour);
    if (this.forced) { seg = this.forced; }
    if (def.behavior === 'follow' && def.followTarget) seg = { act: 'follow', anim: 'walk' };
    const post = seg.p ? { x: seg.p[0], y: seg.p[1], z: seg.p[2] } : { x: this.home.x, y: this.home.y, z: this.home.z };
    const act = this.forced ? this.forced.act : (seg.act || def.behavior || 'stand');
    const yOff = this.forced ? (this.forced.yOff || 0) : (seg.yOff || 0);
    const yawFixed = this.forced ? this.forced.yaw : seg.yaw;

    let moving = false;
    if (act === 'follow' && player) {
      const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.4) { this.moveTowards(player.pos.x, player.pos.z, dt, d > 6 ? 5.6 : 3.2); moving = true; }
      else this.faceTowards(player.pos.x, player.pos.z, dt);
    } else if (act === 'wander' || act === 'home') {
      if (!this.target) {
        this.waitT -= dt;
        if (this.waitT <= 0) {
          const a = Math.random() * Math.PI * 2;
          const rad = 1.2 + Math.random() * (def.wanderR || 5);
          this.target = new THREE.Vector3(post.x + Math.cos(a) * rad, post.y, post.z + Math.sin(a) * rad);
        }
      } else {
        const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
        if (d < 0.5) { this.target = null; this.waitT = 1.5 + Math.random() * 5; }
        else { this.moveTowards(this.target.x, this.target.z, dt, 1.9); moving = true; }
      }
    } else if (act === 'patrol' && Array.isArray(def.path) && def.waypoint !== undefined) {
      const wp = def.path[def.waypoint % def.path.length];
      const d = Math.hypot(wp[0] - this.pos.x, wp[2] - this.pos.z);
      if (d < 1.2) { def.waypoint++; this.waitT = 1.5; }
      else if (this.waitT > 0) { this.waitT -= dt; }
      else { this.moveTowards(wp[0], wp[2], dt, 2.4); moving = true; }
    } else {
      // estático: caminha até o posto se estiver longe
      const d = Math.hypot(post.x - this.pos.x, post.z - this.pos.z);
      const dy = Math.abs((post.y + yOff) - this.pos.y);
      if (d > 0.6 || dy > 0.7) { this.moveTowards(post.x, post.z, dt, 2.7); moving = true; }
      else {
        this.pos.x = post.x; this.pos.z = post.z;
        if (yawFixed !== undefined && yawFixed !== null) this.yaw = yawFixed;
        const g = physics.groundAt(this.pos.x, this.pos.z, this.pos.y + 1.6);
        if (g !== -Infinity) this.pos.y = g + yOff;
      }
    }

    // animação
    let anim = 'idle';
    const A = this.forced ? (this.forced.anim || 'idle') : (seg.anim || 'idle');
    if (moving) anim = this.spd > 4.4 ? 'run' : 'walk';
    else if (A === 'sleep') anim = 'sleep';
    else if (A === 'sit') anim = 'sit';
    else if (A === 'sitThrone') anim = 'sitThrone';
    else if (A === 'pray') anim = 'pray';
    else if (A === 'work') anim = 'work';
    else if (A === 'read') anim = 'sit';
    else if (A === 'drink') anim = 'drink';
    else if (A === 'dance') anim = 'dance';
    else if (A === 'kneel') anim = 'kneel';
    else if (A === 'graze') anim = 'qGraze';
    else if (A === 'talk') anim = 'talk';
    if (A === 'graze' && !moving) anim = 'qGraze';
    if (A === 'sleep' && !moving && def.kind === 'quad') anim = 'qSleep';
    this.anim = anim;
    this.rig.spd = this.spd;
    animate(this.rig, this.kind === 'human' ? anim : (ANIM_MAP[anim] || anim), dt);
    // posição do rig
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;

    // sala atual (para o registro do reino)
    const room = this.world.roomAt(this.pos.x, this.pos.z, this.pos.y);
    this.lastRoom = room ? room.name : '';
    if (this.bubbleT > 0) this.bubbleT -= dt;
  }

  moveTowards(x, z, dt, speed) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const nx = this.pos.x + (dx / d) * speed * dt;
    const nz = this.pos.z + (dz / d) * speed * dt;
    const y = this.pos.y;
    if (!physics.blocked(nx, y, this.pos.z, this.r, 1.6)) this.pos.x = nx;
    else this.pos.z += (dz / d) * speed * dt * 0.6;
    if (!physics.blocked(this.pos.x, y, nz, this.r, 1.6)) this.pos.z = nz;
    else this.pos.x += (dx / d) * speed * dt * 0.6;
    this.spd = speed;
    const target = Math.atan2(dx, dz);
    let dyaw = target - this.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.yaw += dyaw * Math.min(1, dt * 6);
    const g = physics.groundAt(this.pos.x, this.pos.z, this.pos.y + 1.0);
    if (g !== -Infinity) this.pos.y += (g - this.pos.y) * Math.min(1, dt * 12);
    const th = terrainHeight(this.pos.x, this.pos.z);
    const inWater = th < -0.45 && this.pos.y < -0.1;
    this.spd = inWater ? speed * 0.5 : speed;
  }
  faceTowards(x, z, dt) {
    const target = Math.atan2(x - this.pos.x, z - this.pos.z);
    let dy = target - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 4);
  }
  say(line, t = 4) { this.line = line; this.bubbleT = t; }
}

const ANIM_MAP = { sleep: 'qSleep' };

export function spawnNPCs(world) {
  const list = [];
  for (const def of NPC_CATALOG) {
    if (def.quadOnly) continue;
    const n = new NPC(world, def);
    n.def.waypoint = 0;
    list.push(n);
  }
  return list;
}

/* =====================================================================
 *  POSTOS E ROTINAS
 * ===================================================================== */
const P = (x, y, z, yaw = 0, yOff = 0) => ({ p: [x, y, z], yaw, yOff });
const S = (from, to, post, act, anim) => ({ from, to, ...post, act, anim });

/* =====================================================================
 *  CATÁLOGO — 28 NPCs: realeza, corte, serviçais, exército e plebe
 * ===================================================================== */
export const NPC_CATALOG = [
  /* ---------------- REALEZA ---------------- */
  {
    id: 'aldric', name: 'Rei Aldric II', title: 'o Rei Enfermo', room: 'Aposentos Reais',
    kind: 'human', spawn: [-11.6, 4.8, 9.6], yaw: -1.5, behavior: 'stand', wanderR: 0.4,
    look: {
      scale: 0.98, skin: C.skinPale, hair: 0x8f8578, cloth: 0x3a2a3c, cloth2: 0x241826,
      accent: C.gold, crown: true, beard: true, beardColor: 0x9a9080, longHair: true, cloak: true,
      cloakColor: 0x4a1220, build: { x: 0.44, z: 0.26 },
    },
    posts: [P(-12.4, 4, 9.6, -1.5, 0.9)],
    schedule: [S(0, 24, P(-12.4, 4, 9.6, -1.5, 0.9), 'stand', 'sleep')],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: '... quem entra? Ah. O escudeiro novo. Chegue mais perto, moço. Faz vinte anos que ouço essa lareira respirar, e agora ela fala o nome do meu irmão.',
          opts: [
            { t: 'Vossa Majestade está doente?', to: 'b' },
            { t: 'Qual irmão, Majestade?', to: 'c', act: (g) => g.q.clue('iron') },
            { t: 'A Ordem de Ferro serve a quem?', to: 'd' },
            { t: 'Descansai.', to: null },
          ],
        },
        b: { text: 'Doente não é a palavra. Envenenado talvez seja. Mas quem ousa dizer isso de um rei? Minha própria taça tem medo de mim.', opts: [{ t: 'Quem vos serve a taça?', to: 'e' }, { t: 'Voltarei.', to: null }] },
        c: {
          text: 'Doran. Morreu na Guerra dos Estandartes Negros — eu vi o corpo, lavei o rosto, fechei os olhos. E ainda assim... toda noite alguém sobe doze degraus e senta no meu trono.',
          opts: [{ t: 'E o Ferro Negro?', to: 'd' }, { t: 'Falarei com o Mestre Corvin.', to: null }],
        },
        d: { text: 'A espada não serve a ninguém, moço. Ela espera. Se a Ordem a guarda, é para que nunca precise ser desembainhada — e os homens que juram isso são justamente os que envelhecem olhando para o baú.', opts: [{ t: 'Vou procurá-la.', to: null }] },
        e: { text: 'Corvin escolhe o vinho. Isolde segura a taça. E eu bebo, porque recusar seria admitir que tenho medo do meu próprio filho morto.', opts: [{ t: 'Voltarei, Majestade.', to: null }] },
      },
    },
  },
  {
    id: 'isolde', name: 'Rainha Isolde', title: 'Rainha Regente', room: 'Salão do Conselho',
    kind: 'human', spawn: [7.0, 4, 3.4], yaw: 2.4, behavior: 'stand', wanderR: 2.0,
    look: {
      scale: 1.0, skin: C.skinPale, hair: 0x241812, hairStyle: 'braid', longHair: true,
      cloth: 0x2c2438, cloth2: 0x1c1626, accent: C.gold, crown: true, dress: true,
      cloak: true, cloakColor: 0x3a1d22, build: { x: 0.42, z: 0.26 },
    },
    posts: [P(7.0, 4, 3.4, 2.4), P(3.4, 4, 5.6, 1.6), P(8.0, 4, -1.2, 0.2)],
    schedule: [
      S(7, 11, P(7.0, 4, 3.4, 2.4), 'stand', 'idle'),
      S(11, 15, P(3.4, 4, 5.6, 1.6), 'stand', 'idle'),
      S(15, 20, P(8.0, 4, -1.2, 0.2), 'wander', 'idle'),
      S(20, 24, P(-11.8, 4, 10.6, -1.2, 0.45), 'stand', 'sit'),
      S(0, 7, P(-12.4, 4, 11.0, -1.2, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Um escudeiro novo. A corte devora moços como você — mastiga e cospe os ossos no pátio. Diga-me: veio servir, ou veio ver?',
          opts: [
            { t: 'Servir, Majestade.', to: 'b' },
            { t: 'Dizem que a princesa desaparece à noite.', to: 'c', act: (g) => g.q.clue('ysolda_night') },
            { t: 'Quem marcou o mapa quatro vezes?', to: 'd', act: (g) => g.q.clue('bridge') },
            { t: 'Me retiro.', to: null },
          ],
        },
        b: { text: 'Então sirva em silêncio. Neste castelo, língua solta é torcida no poço. E o poço... nunca devolve o que engole.', opts: [{ t: 'Entendido.', to: null }] },
        c: {
          text: 'Minha filha caminha. Todos nós caminhamos quando não conseguimos dormir. Se você a encontrar depois da meia-noite, não a chame três vezes. Chame uma vez, e espere.',
          opts: [{ t: 'Por que uma vez?', to: 'e' }, { t: 'Vou procurá-la.', to: null }],
        },
        d: { text: 'Eu marquei. Quatro vezes, o mesmo ponto: a ponte do Cinza. Não é o rio que me preocupa — é o que atravessa por baixo dela.', opts: [{ t: 'O que atravessa?', to: 'f' }, { t: 'Vou ver com meus olhos.', to: null }] },
        e: { text: 'Porque na segunda vez ela responde. E não é a voz dela.', opts: [{ t: 'Deusas...', to: null }] },
        f: { text: 'Contrabando, sussurros e gente que não envelhece. Pergunte ao armeiro de Ferro o que ele compra dos barqueiros.', opts: [{ t: 'Perguntarei.', to: null }] },
      },
    },
  },
  {
    id: 'ysolda',
    name: 'Princesa Ysolda', title: 'Herdeira de Varenya', room: 'Quarto da Princesa',
    kind: 'human', spawn: [-9.5, 8, 5.0], yaw: 0.6, behavior: 'stand', wanderR: 1.4,
    look: {
      scale: 0.97, skin: C.skinPale, hair: 0x3a2418, hairStyle: 'braid', longHair: true,
      cloth: 0x2a3040, cloth2: 0x1a1f2a, accent: C.steel, dress: true, build: { x: 0.4, z: 0.25 },
    },
    posts: [P(-9.5, 8, 5.0, 0.6), P(-11.6, 8, 4.6, 3.0), P(-11.0, 8, 9.6, -1.6)],
    schedule: [
      S(6, 14, P(-9.5, 8, 5.0, 0.6), 'wander', 'idle'),
      S(14, 20, P(-11.0, 8, 9.6, -1.6), 'stand', 'sit'),
      S(20, 24, P(-9.5, 8, 5.0, 0.6), 'stand', 'idle'),
      S(0, 3, P(-9.5, 8, 5.0, 0.6), 'stand', 'idle'),
      S(3, 6, P(-11.6, 8, 4.6, 3.0, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Você não bateu. Bom — portas deste castelo servem para sair, não para entrar. O que quer de mim, escudeiro?',
          opts: [
            { t: 'Vossa Alteza anda à noite.', to: 'b', act: (g) => g.q.clue('ysolda_night') },
            { t: 'O que há no baú de obsidiana?', to: 'c' },
            { t: 'Preciso do ferro que sua mãe esconde.', to: 'd' },
            { t: 'Perdão pela intrusão.', to: null },
          ],
        },
        b: {
          text: 'Ando. A cripta ouve melhor que confessores. Lá embaixo há dezenove reis de pedra — e um deles abriu a mão. Ninguém mais notou. Eu notei.',
          opts: [{ t: 'O que ele oferece?', to: 'e' }, { t: 'Levarei você à cripta.', to: null, act: (g) => g.q.clue('crypt_hand') }],
        },
        c: { text: 'Herança do meu tio Doran. Chamam de Ferro Negro porque não reflete tocha, lua, nem rosto. Só reflete o que quem a segura realmente quer ser.', opts: [{ t: 'Você já a segurou?', to: 'f' }, { t: 'Deixarei o baú fechado.', to: null }] },
        d: { text: 'Então já ouviu o mesmo sussurro que eu. A resposta está no Arquivo Real: a Ordem de Ferro assinou a rendição da ponte há cem anos, e a assinatura foi feita com sangue de rei.', opts: [{ t: 'Vou ao arquivo.', to: null, act: (g) => g.q.clue('oath') }] },
        e: { text: 'Não sei. Mas à noite, quando encosto os dedos na palma dele, a pedra está quente. E o ar cheira a tempestade de mar.', opts: [{ t: 'Preciso ver isso.', to: null }] },
        f: { text: 'Uma vez. Meu pai chorou três dias depois e nunca me contou por quê.', opts: [{ t: 'Deusas misericordiosas.', to: null }] },
      },
    },
  },
  /* ---------------- CORTE ---------------- */
  {
    id: 'corvin', name: 'Mestre Corvin', title: 'Conselheiro e Curandeiro', room: 'Torre do Mestre',
    kind: 'human', spawn: [11.0, 4, -6.0], yaw: -1.9, behavior: 'stand', wanderR: 1.6,
    look: {
      scale: 0.99, skin: 0xa8825c, hair: 0x6f6a60, hairStyle: 'bald', beard: true, beardColor: 0x7a7368,
      cloth: 0x2b2f38, cloth2: 0x1d2027, accent: C.brass, chain: true, hood: true, hoodColor: 0x22252c,
      build: { arm: 0.58 },
    },
    posts: [P(11.0, 4, -6.0, -1.9), P(6.6, 4, -8.4, 0.4), P(4.4, 4, -10.6, 0.2)],
    schedule: [
      S(6, 20, P(11.0, 4, -6.0, -1.9), 'stand', 'work'),
      S(20, 24, P(6.6, 4, -8.4, 0.4), 'stand', 'read'),
      S(0, 6, P(4.4, 4, -3.4, 0.2, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Ah, o escudeiro que a rainha ainda não decidiu se aproveita ou descarta. Chegue. Não morda nada aqui — metade dos frascos é veneno, e a outra metade também.',
          opts: [
            { t: 'O rei está envenenado?', to: 'b', act: (g) => g.q.clue('poison') },
            { t: 'Quem some dos corredores?', to: 'c' },
            { t: 'Por que a esfera grita?', to: 'd' },
            { t: 'Vim buscar o selo do Arquivo.', to: 'e' },
            { t: 'Saio agora.', to: null },
          ],
        },
        b: {
          text: 'Chumbo, cicuta e uma terceira coisa que não cresce neste mundo. Sei porque misturei as duas primeiras na mocidade. A terceira está sendo servida ao rei por alguém que chama isso de remédio.',
          opts: [{ t: 'Quem prepara o remédio?', to: 'f' }, { t: 'Vou provar.', to: null }],
        },
        c: { text: 'Pagens. Três. Este castelo os come como come velas: sem barulho, e sempre de baixo para cima.', opts: [{ t: 'Onde os encontro?', to: 'g' }, { t: 'Vou olhar a fornalha.', to: null, act: (g) => g.q.clue('oven') }] },
        d: { text: 'Porque a pedra lembra de um tempo em que Varenya era só gelo e fúria. Não olhe muito para ela — o vidro devolve olhares.', opts: [{ t: 'Existem dragões?', to: 'h' }, { t: 'Anotado.', to: null }] },
        e: { text: 'O selo é da rainha. Mas a chave do arquivo é minha, e eu a empresto a quem cheira a sepultura — foi o que você fez ao descer na cripta, imagino.', opts: [{ t: 'Aceito a chave.', to: null, act: (g) => g.q.give('arquivo') }] },
        f: { text: 'Eu guardo os frascos, mas a taça vem da Câmara da Guarda. E o capitão Edda prefere não perceber. Todos preferimos.', opts: [{ t: 'Falarei com Edda.', to: null }] },
        g: { text: 'Nos sonhos de quem dorme com a fornalha acesa. A cozinheira não dorme há dez dias.', opts: [{ t: 'Falarei com Hilda.', to: null }] },
        h: { text: 'Existiram. O último dorme de pedra no rochedo a leste — e a Ordem de Ferro nasceu do juramento de guardar o que ele deixou: uma espada negra, e a fome dela.', opts: [{ t: 'Vou ver o rochedo.', to: null, act: (g) => g.q.clue('rock') }] },
      },
    },
  },
  {
    id: 'edda', name: 'Capitã Edda Vash', title: 'Capitã da Guarda', room: 'Câmara da Guarda',
    kind: 'human', spawn: [6.5, 0, 4.6], yaw: 0.4, behavior: 'stand', wanderR: 2.5,
    look: {
      scale: 1.04, skin: 0xb98a60, hair: 0x1c1410, hairStyle: 'braid',
      cloth: 0x2a3038, cloth2: 0x1e2329, metal: true, accent: 0x6f757f, gloves: true,
      beard: false, build: { x: 0.5, z: 0.3, arm: 0.64 },
    },
    posts: [P(6.5, 0, 4.6, 0.4), P(9.4, 0, 4.6, 1.6), P(8.6, 0, 9.6, 2.6), P(2.0, 0, 16.0, 0.1)],
    path: [[4.0, 0, 22.0], [-6.0, 0, 24.0], [-24.0, 0, 2.0], [-10.0, 0, -20.0], [4.0, 0, 22.0]],
    schedule: [
      S(6, 10, P(6.5, 0, 4.6, 0.4), 'wander', 'idle'),
      S(10, 18, null, 'patrol', 'walk'),
      S(18, 22, P(8.6, 0, 9.6, 2.6), 'stand', 'idle'),
      S(22, 6, P(9.4, 0, 4.6, 1.6), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Fique onde está. Escudeiro novo, arma de treino e olhos de quem já viu o subsolo. O que quer?',
          opts: [
            { t: 'Quero servir na guarda.', to: 'b' },
            { t: 'Ouvi falar da ponte.', to: 'c', act: (g) => g.q.clue('bridge_guard') },
            { t: 'A fornalha da cozinha...', to: 'd' },
            { t: 'Nada. Sigo.', to: null },
          ],
        },
        b: {
          text: 'A guarda não serve, escudeiro. A guarda vigia. Vigie isto: quem entra na cozinha depois da segunda badalada. Traga-me um nome e eu lhe dou um elmo.',
          opts: [{ t: 'Vigiarei.', to: null, act: (g) => g.q.start('vigia') }, { t: 'Talvez depois.', to: null }],
        },
        c: { text: 'A ponte do Cinza é um osso que a coroa não engole. Meus homens juraram não atravessá-la de noite. Dois atravessaram. Nenhum voltou a falar direito.', opts: [{ t: 'O que viram?', to: 'e' }, { t: 'Vou lá.', to: null }] },
        d: { text: 'Já mandei três soldados olhar a fornalha. Os três voltaram dizendo que estava fria. Estava acesa, garoto. A fornalha nunca esfria.', opts: [{ t: 'Vou descer na cripta.', to: null }, { t: 'Entendi.', to: null }] },
        e: { text: 'Um disse: "a água subiu de dentro da pedra". O outro nunca mais falou. Está na câmara dos guardas, olhando a parede.', opts: [{ t: 'Vou interrogá-lo.', to: null }] },
      },
    },
  },
  {
    id: 'garrick', name: 'Ser Garrick', title: 'Cavaleiro da Ordem de Ferro', room: 'Salão de Armas',
    kind: 'human', spawn: [12.6, 0, -4.6], yaw: -1.6, behavior: 'stand', wanderR: 1.2,
    look: {
      scale: 1.08, skin: 0xa87650, hair: 0x2b1c10, beard: true, beardColor: 0x2b1c10,
      cloth: 0x23262c, cloth2: 0x181a1e, metal: true, accent: 0x4a4e56, gloves: true,
      cloak: true, cloakColor: 0x2a1f1c, build: { x: 0.56, z: 0.33, arm: 0.68 },
    },
    posts: [P(12.6, 0, -4.6, -1.6), P(9.0, 0, -5.5, 2.2), P(5.0, 0, -9.4, 0.6)],
    schedule: [
      S(5, 21, P(12.6, 0, -4.6, -1.6), 'stand', 'work'),
      S(21, 24, P(9.0, 0, -5.5, 2.2), 'stand', 'sit'),
      S(0, 5, P(5.0, 0, -9.4, 0.6, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Aço frio, mão firme. Se você veio pedir a espada negra, já pode virar as costas — ela não sai do baú enquanto eu respirar. E eu pretendo respirar muito.',
          opts: [
            { t: 'Por que guardá-la?', to: 'b', act: (g) => g.q.clue('iron_oath') },
            { t: 'Já a desembainhou?', to: 'c' },
            { t: 'O rei está sendo envenenado.', to: 'd' },
            { t: 'Bom treino, ser.', to: null },
          ],
        },
        b: {
          text: 'Há cem anos, nesta mesma sala, meu bisavô jurou: enquanto um Vash respirar, o Ferro Negro dorme. Não é honra, escudeiro. É medo com uniforme.',
          opts: [{ t: 'Medo de quê?', to: 'e' }, { t: 'Respeito o juramento.', to: null }],
        },
        c: { text: 'Uma vez, para limpar o pó. A lâmina me olhou. Não ri — eu vi o reflexo, e o homem no reflexo não tinha a minha cara.', opts: [{ t: 'De quem era o rosto?', to: 'f' }, { t: 'Deusas.', to: null }] },
        d: { text: '... repita isso baixinho. Chumbo na taça é problema da rainha. Chumbo na taça com sangue de rei é problema meu. Se você provar, eu desembainho a espada negra.', opts: [{ t: 'Provarei.', to: null, act: (g) => g.q.start('ferro') }] },
        e: { text: 'De acordar um dia e descobrir que a espada estava certa sobre nós.', opts: [{ t: 'Vou pensar nisso.', to: null }] },
        f: { text: 'Do irmão dele. Doran. E o rosto sorria.', opts: [{ t: 'Vou à cripta.', to: null, act: (g) => g.q.clue('crypt_hand') }] },
      },
    },
  },
  {
    id: 'oriane', name: 'Senhora Oriane', title: 'Dama de Companhia', room: 'Solar de Bordado',
    kind: 'human', spawn: [-10.6, 8, 9.6], yaw: -1.6, behavior: 'stand', wanderR: 1.0,
    look: {
      scale: 0.99, skin: C.skinPale, hair: 0x1a1210, longHair: true,
      cloth: 0x3a2a44, cloth2: 0x2a1e30, accent: C.gold, dress: true, build: { x: 0.42, z: 0.26 },
    },
    posts: [P(-11.2, 8, 8.6, -1.6, 0.45), P(-9.0, 8, 10.4, 1.8), P(-6.0, 8, 8.2, 2.4)],
    schedule: [
      S(8, 22, P(-11.2, 8, 8.6, -1.6, 0.45), 'stand', 'work'),
      S(22, 2, P(-6.0, 8, 8.2, 2.4), 'stand', 'sit'),
      S(2, 8, P(-8.0, 8, 11.0, 0.4, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Cuidado com a linha, escudeiro. Estou bordando um lobo de ferro — do mesmo lobo que a rainha mandou arrancar de quatro estandartes. Faça as contas.',
          opts: [
            { t: 'Por que arrancar?', to: 'b' },
            { t: 'Onde está a princesa?', to: 'c' },
            { t: 'Fofocas da corte?', to: 'd' },
            { t: 'Bons bordados.', to: null },
          ],
        },
        b: { text: 'Porque o lobo era de Doran. Quando um rei morre, a coroa tenta costurar o reino com fio novo e finge que o antigo nunca existiu.', opts: [{ t: 'E a princesa sente falta dele?', to: 'e' }, { t: 'Entendo.', to: null }] },
        c: { text: 'No corredor, à meia-noite, de camisola e pés descalços. Se te disser mais, a rainha me manda bordar na Torre de Ferro — sem tesoura.', opts: [{ t: 'Silêncio, então.', to: null }] },
        d: { text: 'O copeiro bebe. O capitão tem medo de água. E o jester Odo sabe o nome do veneno, mas só conta em troca de moedas ou de riso.', opts: [{ t: 'Vou rir com ele.', to: null, act: (g) => g.q.clue('jester') }] },
        e: { text: 'Sente. Aquela criança aprendeu a cantar para a pedra porque pedra é a única coisa no castelo que não mente para ela.', opts: [{ t: 'Isso é triste.', to: null }] },
      },
    },
  },
  /* ---------------- SERVIÇAIS ---------------- */
  {
    id: 'hilda', name: 'Hilda', title: 'Cozinheira-Mor', room: 'Cozinha & Despensa',
    kind: 'human', spawn: [-11.0, 0, 5.6], yaw: 2.6, behavior: 'stand', wanderR: 1.6,
    look: {
      scale: 1.02, skin: 0xc08a5c, hair: 0x6a5a4a, apron: true,
      cloth: 0x4a3a2a, cloth2: 0x33261a, accent: 0x8a7048, build: { x: 0.54, z: 0.32 },
    },
    posts: [P(-11.0, 0, 5.6, 2.6), P(-9.6, 0, 4.6, -1.6), P(-12.8, 0, 6.4, 0.6)],
    schedule: [
      S(4, 20, P(-11.0, 0, 5.6, 2.6), 'stand', 'work'),
      S(20, 23, P(-9.6, 0, 4.6, -1.6), 'stand', 'sit'),
      S(23, 4, P(-6.0, 0, 11.0, 0.3, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Fora da cozinha ou pega um pão! ... Ah, é o moço novo. Senta, come, mas não olha para a fornalha. Não olha!',
          opts: [
            { t: 'O que há com a fornalha?', to: 'b', act: (g) => g.q.clue('oven') },
            { t: 'Quem vem aqui de madrugada?', to: 'c' },
            { t: 'O caldo está bom.', to: 'd' },
            { t: 'Comer e sair.', to: null },
          ],
        },
        b: {
          text: 'Tem uma semana ouço um paje chorando lá dentro. Abri a portinhola: cinza, vazia, acesa até o metal ficar vermelho. Choro de criança, escudeiro, mas nenhuma criança. Nem osso.',
          opts: [{ t: 'E as botas?', to: 'e', act: (g) => g.q.clue('boots') }, { t: 'Vou investigar.', to: null }],
        },
        c: { text: 'Copeiro Lyle. Sempre às escuras, sempre com o mesmo copo de prata que ninguém mais toca. Ele diz que é "remédio do rei".', opts: [{ t: 'O que tem no copo?', to: 'f' }, { t: 'Obrigado, Hilda.', to: null }] },
        d: { text: 'Cebola, osso de boi e três lágrimas minhas. É o segredo.', opts: [{ t: 'Vou levar a receita.', to: null }] },
        e: { text: 'Na cripta, no corredor dos servos, apareceram botas pequenas. Três pares. Lavadas. Ninguém sabe de quem são, mas eu sei — eram dos pagens.', opts: [{ t: 'Vou descê-las à cripta.', to: null }] },
        f: { text: 'Cheiro doce demais para ser remédio. Foi por isso que parei de provar a comida do rei — deusas me perdoem.', opts: [{ t: 'Você fez bem.', to: null }] },
      },
    },
  },
  {
    id: 'lyle', name: 'Lyle', title: 'Copeiro Real', room: 'Câmara da Guarda',
    kind: 'human', spawn: [10.8, 0, 5.6], yaw: -2.4, behavior: 'stand', wanderR: 1.2,
    look: {
      scale: 0.99, skin: 0xb08a68, hair: 0x2a1c14, cloth: 0x24262e, cloth2: 0x1a1c22, accent: 0x707880,
    },
    posts: [P(10.8, 0, 5.6, -2.4), P(12.4, 0, 4.6, 2.0), P(8.0, 0, 12.2, 3.1)],
    schedule: [
      S(6, 9, P(12.4, 0, 4.6, 2.0), 'stand', 'work'),
      S(9, 16, P(8.0, 0, 12.2, 3.1), 'wander', 'idle'),
      S(16, 22, P(10.8, 0, 5.6, -2.4), 'stand', 'work'),
      S(22, 6, P(12.6, 0, 6.4, 0.4, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'N-não me olhe assim. Eu só levo a taça. Eu só levo a taça!',
          opts: [
            { t: 'O que tem na taça?', to: 'b' },
            { t: 'Quem te paga?', to: 'c' },
            { t: 'Calma. Só converso.', to: 'd' },
            { t: 'Deixo você em paz.', to: null },
          ],
        },
        b: { text: 'Coral moído da costa leste. Chega em barril, marcado como sal. Três grãos por dia bastam para uma coisa lenta e sem febre.', opts: [{ t: 'Quem manda?', to: 'c' }] },
        c: { text: 'Um homem de luva de couro que nunca mostra a mão. O rosto... o rosto eu nunca vi. E ele paga em prata da guarda velha — com o lobo de Doran cunhado nela.', opts: [{ t: 'Prata de Doran?!', to: 'e', act: (g) => g.q.clue('lero') }, { t: 'Vou denunciá-lo.', to: 'f' }] },
        d: { text: 'Não há calma neste castelo desde que a neve não derreteu. Se você é o novo escudeiro... fuja. Leve o corcel e fuja ao amanhecer.', opts: [{ t: 'Não vou fugir.', to: null }] },
        e: { text: 'Ch-chamei ele de "Lorde". Ele riu e disse que "ninguém mais se lembra do nome". Depois me deu uma moeda e eu bebi até esquecer.', opts: [{ t: 'Onde ele volta?', to: 'g' }, { t: 'Cuidado, Lyle.', to: null }] },
        f: { text: 'Denuncie! Denuncie e encontre meu corpo no poço em três dias. Todo mundo aqui já calculou minha morte, escudeiro.', opts: [{ t: 'Não contarei a ninguém.', to: null }] },
        g: { text: 'Na ponte. Sempre na ponte, quando a lua é fina.', opts: [{ t: 'Vou esperar lá.', to: null, act: (g2) => g2.q.clue('lero_bridge') }] },
      },
    },
  },
  {
    id: 'odo', name: 'Odo', title: 'o Bobo da Corte', room: 'Grande Salão',
    kind: 'human', spawn: [-4.0, 0, -5.0], yaw: 1.2, behavior: 'wander', wanderR: 6,
    look: {
      scale: 0.72, skin: 0xd0a279, hair: 0x8a3a1a, hat: true, hatColor: 0x6a1f2a,
      cloth: 0x5a2a30, cloth2: 0x2a2a30, accent: C.gold, build: { x: 0.5, z: 0.34, arm: 0.5 },
    },
    posts: [P(-4.0, 0, -5.0, 1.2), P(-6.5, 0, -9.0, 0.4), P(-11.6, 0, -3.6, 2.4)],
    schedule: [
      S(7, 22, P(-4.0, 0, -5.0, 1.2), 'wander', 'none'),
      S(22, 7, P(-3.6, 0, -11.0, 0.3, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'AH! Um novo par de olhos! Diga, diga, escudeiro: quanto mede um homem? (Risada) Errado. Mede o que ele conta depois do terceiro copo.',
          opts: [
            { t: 'Odo, o nome do veneno.', to: 'b', act: (g) => g.q.clue('poison_name') },
            { t: 'O que é o Ferro Negro?', to: 'c' },
            { t: 'Quem anda de noite?', to: 'd' },
            { t: '(Rir e sair)', to: null },
          ],
        },
        b: {
          text: 'Coral moído e pó de osso de pai. Chamam de "Lágrima de Doran" na costa. Um nome bonito para um modo feio de morrer devagar.',
          opts: [{ t: 'Como você sabe disso?', to: 'e' }, { t: 'Obrigado, Odo.', to: 'f' }],
        },
        c: { text: 'Uma espada que reflete o desejo. Meu desejo? Um colchão sem pulgas. Ela me mostrou um trono. Eu recusei: pesa.', opts: [{ t: 'Ela está no castelo?', to: 'c2' }] },
        c2: { text: 'No baú da princesa. Ou no estômago da fornalha. Ou na mão de Doran, que dorme há vinte anos e ainda boceja. Escolha a versão que te deixa dormir.', opts: [{ t: 'Já entendi.', to: null }] },
        d: { text: 'A princesa, o copeiro, o capitão e o fantasma do príncipe. Todos educadamente, sem trombeta.', opts: [{ t: 'O fantasma do príncipe?!', to: 'g' }, { t: 'Obrigado.', to: null }] },
        e: { text: 'Bobo escuta tudo porque não incomoda ninguém. Segredo de bobo: sou o único aqui que não tem medo de morrer. Já morri de fome aos seis anos, na guerra. Tudo depois disso é bônus.', opts: [{ t: 'Você merece uma taça.', to: null, act: (g) => g.q.give('taça') }] },
        f: { text: 'Guarda o nome. E guarda tua língua: quem pronuncia "Lágrima de Doran" na mesa certa, sangra na errada.', opts: [{ t: 'Silêncio, então.', to: null }] },
        g: { text: 'Às vezes um homem sobe os doze degraus, senta no Trono de Obsidiana e canta para a pedra. Me disse que é "verificar se a casa ainda me reconhece". Vestia o manto de Doran.', opts: [{ t: 'Quero ver isso.', to: null, act: (g) => g.q.clue('throne_ghost') }] },
      },
    },
  },
  {
    id: 'bram', name: 'Bram', title: 'Ferreiro', room: 'Pátio de Treino',
    kind: 'human', spawn: [-29.0, 0, -1.0], yaw: 1.5, behavior: 'stand', wanderR: 1.4,
    look: {
      scale: 1.1, skin: 0x8a6444, hair: 0x1a1410, beard: true, beardColor: 0x241a12, apron: true,
      cloth: 0x3a3230, cloth2: 0x241f1c, accent: 0x6a6a72, build: { x: 0.62, z: 0.38, arm: 0.66 },
    },
    posts: [P(-29.6, 0, -1.0, 1.5), P(-30.4, 0, 0.6, 0.4), P(-27.0, 0, 1.0, 2.4)],
    schedule: [
      S(6, 21, P(-29.6, 0, -1.0, 1.5), 'stand', 'work'),
      S(21, 24, P(-27.0, 0, 1.0, 2.4), 'stand', 'sit'),
      S(0, 6, P(-31.0, 0, -6.0, 0.6, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Ferro bom não mente. Bate, dobra, esquenta — e mantém a palavra. Já os homens deste castelo... Cheque esse fio, moço. De graça.',
          opts: [
            { t: 'Você forjou o Ferro Negro?', to: 'b' },
            { t: 'Preciso de uma lâmina.', to: 'c' },
            { t: 'Treino de combate?', to: 'd' },
            { t: 'Depois volto.', to: null },
          ],
        },
        b: { text: 'Ninguém forja aquilo. Aquilo foi achado. Meu mestre disse que a lâmina "chegou com a neve" e que ninguém teve coragem de jogá-la de volta no mar.', opts: [{ t: 'Onde você estava então?', to: 'e' }, { t: 'Anotado.', to: null }] },
        c: { text: 'Pegue uma das de treino e me traga dez vitórias no pátio. Depois conversamos de aço de verdade.', opts: [{ t: 'Feito.', to: null }] },
        d: { text: 'A espada que eu te dou é de madeira e vergonha. Mas madeira ensina: quem treina quer vencer; quem treina certo quer aprender.', opts: [{ t: 'Vou treinar.', to: null }] },
        e: { text: 'No sul, com a Ordem de Ferro. Vi eles carregarem o baú com doze homens e um padre. Doze, escudeiro. Para um baú do tamanho de uma criança.', opts: [{ t: 'Pesado assim?', to: 'f' }, { t: 'Interessante.', to: null }] },
        f: { text: 'O baú tinha rodinhas e mesmo assim doze homens. Pesa mais que ferro, aquilo. Pesa como um nome antigo.', opts: [{ t: 'Obrigado, Bram.', to: null }] },
      },
    },
  },
  {
    id: 'maren', name: 'Ser Maren', title: 'Mestre de Armas', room: 'Pátio de Treino',
    kind: 'human', spawn: [-21.0, 0, -2.0], yaw: 1.6, behavior: 'stand', wanderR: 3.5,
    look: {
      scale: 1.06, skin: 0xa87650, hair: 0x766a58, beard: true, beardColor: 0x8a8070,
      cloth: 0x2f3238, cloth2: 0x212328, accent: 0x6a7078, metal: true, gloves: true,
      build: { x: 0.54, z: 0.32, arm: 0.64 },
    },
    posts: [P(-21.0, 0, -2.0, 1.6), P(-19.0, 0, 1.0, 2.0), P(-23.0, 0, -6.5, 0.4)],
    schedule: [
      S(5, 20, P(-21.0, 0, -2.0, 1.6), 'stand', 'work'),
      S(20, 23, P(-17.0, 0, 9.0, 2.6), 'stand', 'drink'),
      S(23, 5, P(-30.0, 0, 2.5, 0.4, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Parado aí. Costelas para dentro, queixo baixo, pé esquerdo à frente. ...Bom. Você tem ombros de alguém que já carregou corpo, não bandeira.',
          opts: [
            { t: 'O que devo fazer primeiro?', to: 'b' },
            { t: 'O castelo está seguro?', to: 'c' },
            { t: 'Quero um cavalo.', to: 'd', act: (g) => g.q.give('corcel') },
            { t: 'Vou treinar.', to: null },
          ],
        },
        b: {
          text: 'Ande o castelo de baixo para cima. A cripta ensina humildade; o salão do trono ensina o resto. E se vir um homem de luva no corredor, não olhe para a mão — olhe para os pés.',
          opts: [{ t: 'Por que os pés?', to: 'e' }, { t: 'Começo pela cripta.', to: null, act: (g) => g.q.start('explorar') }],
        },
        c: { text: 'Seguro de fora. De dentro, escudeiro, ninguém aqui está seguro desde que o príncipe morreu. Nem o rei. Nem a menina.', opts: [{ t: 'Falarei com a princesa.', to: null }] },
        d: { text: 'Bruma. Está na estrebaria, e morde quem treme. Assobie assim (assobia). Se ele vier, o reino é seu.', opts: [{ t: 'Vou testar.', to: null, act: (g) => g.q.clue('horse') }] },
        e: { text: 'Homem de luva pisa leve demais. Como quem já foi outro. Sabe o que é assustador? Ele pisa como o príncipe Doran pisava.', opts: [{ t: 'Doran está morto.', to: 'f' }, { t: 'Vou observar.', to: null }] },
        f: { text: 'Está. Eu vi o corpo e chorei. Mas já vi coisas piores nesta vida do que um morto mal enterrado.', opts: [{ t: 'Obrigado, ser.', to: null }] },
      },
    },
  },
  {
    id: 'kellan', name: 'Kellan', title: 'Estribeiro', room: 'Estrebaria',
    kind: 'human', spawn: [-26.5, 0, -4.0], yaw: 0.8, behavior: 'stand', wanderR: 2.0,
    look: {
      scale: 0.98, skin: 0x9c7048, hair: 0x2a1c12, cloth: 0x3a3428, cloth2: 0x262218, apron: true,
    },
    posts: [P(-26.5, 0, -4.0, 0.8), P(-29.0, 0, -6.0, 1.6), P(-24.4, 0, -6.0, -1.6)],
    schedule: [
      S(5, 22, P(-26.5, 0, -4.0, 0.8), 'stand', 'work'),
      S(22, 5, P(-27.0, 0, -6.5, 1.4, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Se vem pelo corcel, é o Bruma. Morde, empaca, e galopa como se tivesse fogo nas patas. Assobie — ele decide se desce ou se te ignora.',
          opts: [
            { t: 'Como montar?', to: 'b' },
            { t: 'Ele é do castelo?', to: 'c' },
            { t: 'Vou chamá-lo.', to: null, act: (g) => g.q.clue('horse') },
          ],
        },
        b: { text: 'Pé no estribo, mão na crina, joelho no flanco, e depois deixe que ele corra. Cavalo com medo do galope é cavalo que nunca te trouxe em casa.', opts: [{ t: 'Anotado.', to: null }] },
        c: { text: 'Era do príncipe. Quando o príncipe morreu, o cavalo parou de comer por nove dias. Ninguém ousou matá-lo — ficamos todos esperando ele decidir se queria viver.', opts: [{ t: 'E ele decidiu.', to: 'd' }, { t: 'Cavalo estranho.', to: null }] },
        d: { text: 'Decidiu. E desde então ele olha para o portão todo fim de tarde. Cavalo espera alguém, escudeiro. Todo cavalo espera.', opts: [{ t: 'Talvez ele espere o príncipe.', to: null }] },
      },
    },
  },
  {
    id: 'yrsa', name: 'Lady Yrsa', title: 'a Vidente da Cripta', room: 'Cripta dos Reis',
    kind: 'human', spawn: [-2.0, -4, -13.4], yaw: 0.3, behavior: 'stand', wanderR: 1.0,
    look: {
      scale: 0.96, skin: 0xc0b09a, hair: 0xcfc8bb, longHair: true, hood: true, hoodColor: 0x2a2620,
      cloth: 0x26241f, cloth2: 0x1a1815, accent: 0x6a6050,
    },
    posts: [P(-2.0, -4, -13.4, 0.3), P(-6.0, -4, -15.0, 1.2), P(4.0, -4, -9.0, -1.4)],
    schedule: [
      S(0, 24, P(-2.0, -4, -13.4, 0.3), 'pray', 'pray'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Sente-se entre os reis, criança. Eles não mordem — só escutam. Eu escuto de volta. É um trabalho de paciência e de joelhos.',
          opts: [
            { t: 'Os reis falam com você?', to: 'b' },
            { t: 'Alguém subiu da cripta?', to: 'c' },
            { t: 'O que é o Ferro Negro?', to: 'd' },
            { t: 'Preciso de conselho.', to: 'e' },
            { t: 'Deixo-te em paz.', to: null },
          ],
        },
        b: { text: 'Dezenove dormem. O vigésimo anda. E o vigésimo abre a mão à noite para receber uma coisa que você ainda não tem.', opts: [{ t: 'O que ele quer?', to: 'f' }, { t: 'Qual é o vigésimo?', to: 'g' }] },
        c: { text: 'Sobe e desce. Todo dia. Um homem de luva, que cheira a sal e a coral moído. Ele passa por mim e não me olha — o que é educado, para um morto.', opts: [{ t: 'Morto?', to: 'g', act: (g2) => g2.q.clue('doran_alive') }] },
        d: { text: 'Uma espada que Varenya encontrou na neve há trezentos anos. Ela não foi feita: foi acordada. E agora que o sangue dela está quase seco, ela procura uma mão.', opts: [{ t: 'Uma mão como a minha?', to: 'h' }, { t: 'Vou manter distância.', to: null }] },
        e: { text: 'Conselho: não durma no castelo. Durma fora dos muros, de costas para o portão. E se ouvir um choro na fornalha, responda — mas não com o seu nome.', opts: [{ t: 'Por quê?', to: 'i' }, { t: 'Vou lembrar.', to: null }] },
        f: { text: 'A coroa. Ele morreu antes de usá-la — e o que morre sem coroa volta para buscá-la. Guarde-se: quem o servir vira coroa.', opts: [{ t: 'Isso é uma advertência?', to: 'h' }] },
        g: { text: 'Doran, príncipe de Varenya. Filho de Aldric. Morto na Guerra dos Estandartes Negros, com o corpo devolvido em sal para não feder no caminho.', opts: [{ t: 'Voltou?', to: 'f' }] },
        h: { text: 'É o que é. Eu leio pedra, não destino. Vá — e leve uma vela. A cripta fica cega quando você a olha de frente.', opts: [{ t: 'Adeus, senhora.', to: null, act: (g) => g.q.give('vela') }] },
        i: { text: 'Porque nome é convite. Uma fornalha que aprende seu nome aprende onde você dorme.', opts: [{ t: 'Vou usar outro nome.', to: null }] },
      },
    },
  },
  /* ---------------- VILA ---------------- */
  {
    id: 'merchant', name: 'Mestre Hob', title: 'Mercador de Cinzalta', room: 'Vila Cinzalta',
    kind: 'human', spawn: [62, 0, 134], yaw: 0.5, behavior: 'stand', wanderR: 2.0,
    look: {
      scale: 1.02, skin: 0xb08050, hair: 0x4a3520, hat: true, hatColor: 0x3a2a18,
      cloth: 0x4a3a2a, cloth2: 0x30261c, accent: C.brass, build: { x: 0.58, z: 0.36 },
    },
    posts: [P(62, 0, 134, 0.5), P(58, 0, 134, -1.6), P(66, 0, 138, 1.2)],
    schedule: [
      S(7, 20, P(62, 0, 134, 0.5), 'stand', 'work'),
      S(20, 24, P(66, 0, 140, 1.4), 'stand', 'sit'),
      S(0, 7, P(66, 0, 140, 1.4, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Moedas, moedas! Ah, um escudeiro do castelo — e com bolsa. Diga: quer comprar um segredo, ou um linho? O segredo sai mais caro e dura menos.',
          opts: [
            { t: 'Compro um segredo.', to: 'b', act: (g) => g.q.give('moeda') },
            { t: 'O que passa pela ponte?', to: 'c' },
            { t: 'Coral moído da costa?', to: 'd' },
            { t: 'Nada hoje.', to: null },
          ],
        },
        b: { text: 'Segredo: o castelo compra óleo de lamparina em quantidade três vezes maior que o necessário. Alguém quer o castelo bem aceso. Ou bem queimado.', opts: [{ t: 'Quem encomenda?', to: 'e' }, { t: 'Boa, Hob.', to: null }] },
        c: { text: 'Barris marcados como sal. Barris que pesam como pedra. Pagos em prata velha com lobo cunhado — e ninguém usa prata do príncipe morto, senão um louco.', opts: [{ t: 'Onde entregam?', to: 'f' }, { t: 'Vou lá.', to: null, act: (g) => g.q.clue('lero_bridge') }] },
        d: { text: 'Proibido. Uma vez vendi a um homem de luva e minha filha tossiu sangue por três luas. Joguei o resto no rio, de costas.', opts: [{ t: 'Um homem de luva...', to: 'g' }] },
        e: { text: 'A ordem vem do castelo, com selo de cera preta. Cera preta! Aqui cera preta é luto.', opts: [{ t: 'Luto de quem?', to: 'b' }] },
        f: { text: 'No arco sul da ponte, ao pé do terceiro pilar. Às escuras, com a lua fina.', opts: [{ t: 'Obrigado.', to: null }] },
        g: { text: 'Nunca vi o rosto. Mas andava como nobre e falava como quem dormiu em berço de penas. Se há um morto andando por Varenya, é um morto muito bem-educado.', opts: [{ t: 'Obrigado, Hob.', to: null, act: (g2) => g2.q.clue('doran_alive') }] },
      },
    },
  },
  {
    id: 'mira', name: 'Mira', title: 'Curandeira da Vila', room: 'Vila Cinzalta',
    kind: 'human', spawn: [76, 0, 146], yaw: -0.8, behavior: 'stand', wanderR: 2.2,
    look: {
      scale: 0.98, skin: 0xc09068, hair: 0x2a1a10, longHair: true,
      cloth: 0x2c3a2c, cloth2: 0x1e281e, accent: 0x6a8a5a,
    },
    posts: [P(76, 0, 146, -0.8), P(80, 0, 150, 1.4), P(72, 0, 148, -2.2)],
    schedule: [
      S(6, 21, P(76, 0, 146, -0.8), 'stand', 'work'),
      S(21, 2, P(80, 0, 150, 1.4), 'stand', 'sit'),
      S(2, 6, P(78, 0, 152, 0.4, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Chegue, chegue. Se vem do castelo, mantenha os olhos no chão: gente de lá traz a febre da corte.',
          opts: [
            { t: 'Epidemia aqui?', to: 'b' },
            { t: 'Sabe o que é Lágrima de Doran?', to: 'c', act: (g) => g.q.clue('poison_name') },
            { t: 'Quem desapareceu na vila?', to: 'd' },
            { t: 'Só passando.', to: null },
          ],
        },
        b: { text: 'Três famílias com tosse escura. Sal do rio, digo eu. O sal vem da ponte e a ponte não é da vila.', opts: [{ t: 'Vou investigar a ponte.', to: null, act: (g) => g.q.clue('bridge') }] },
        c: { text: 'É chumbo, cicuta e coral. Eu poderia curar se tivesse leite de cabra preta e dois dias. Mas não se cura o que se bebe por vontade própria.', opts: [{ t: 'O rei bebe por vontade?', to: 'e' }, { t: 'Anotado.', to: null }] },
        d: { text: 'O moleiro e a filha. Foram buscar lenha no bosque e voltaram sem os olhos... não, voltaram sem o juízo. Andam pela vila contando pedra e esperando alguém de luva.', opts: [{ t: 'Vou procurá-los.', to: null, act: (g) => g.q.clue('villagers') }] },
        e: { text: 'Bebe porque tem medo de parar. Quem para de beber sente tudo de uma vez.', opts: [{ t: 'Isso eu entendo.', to: null }] },
      },
    },
  },
  {
    id: 'padre', name: 'Septon Wyll', title: 'Septon de Cinzalta', room: 'Vila Cinzalta',
    kind: 'human', spawn: [86, 0, 152], yaw: -2.0, behavior: 'stand', wanderR: 1.4,
    look: {
      scale: 0.99, skin: 0xc8a882, hair: 0x9a9488, beard: true, beardColor: 0xa8a294,
      hood: true, hoodColor: 0x2e2a24, cloth: 0x3a352c, cloth2: 0x282420, accent: 0x9a9094,
    },
    posts: [P(86, 0, 152, -2.0), P(88, 0, 148, -0.4), P(84, 0, 156, 1.8)],
    schedule: [
      S(5, 12, P(86, 0, 152, -2.0), 'pray', 'pray'),
      S(12, 21, P(88, 0, 148, -0.4), 'stand', 'idle'),
      S(21, 5, P(90, 0, 156, 0.6, 0.8), 'stand', 'sit'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'A Fé diz que o amor é a morte do dever. Eu digo que o dever é a morte do descanso. Em que posso servir, filho?',
          opts: [
            { t: 'O príncipe Doran: morto ou vivo?', to: 'b' },
            { t: 'A fornalha chora. O que é isso?', to: 'c' },
            { t: 'Uma bênção para o corcel.', to: 'd', act: (g) => g.q.bless() },
            { t: 'Fico em paz.', to: null },
          ],
        },
        b: { text: 'Eu rezei o rito sobre o corpo. Toquei a pele, que estava salgada e dura. Ele morreu, filho. Agora, se algo voltou usando a cara dele — isso não é ressurreição, é roubo.', opts: [{ t: 'Alguém roubou um rosto.', to: 'e', act: (g) => g.q.clue('doran_alive') }, { t: 'Vou rezar por ele.', to: null }] },
        c: { text: 'Nesta vila queimamos os mortos. Se a fornalha do castelo chora, é porque guarda o que devia ser cinza.', opts: [{ t: 'Há corpos lá?', to: 'f' }, { t: 'Deusas.', to: null }] },
        d: { text: 'Que a Fé proteja teus cascos e tua sela. Cavalgue longe, escudeiro — e volte com a princesa viva.', opts: [{ t: 'Voltarei.', to: null }] },
        e: { text: 'Cuidado com o que se rouba de um morto. Cedo ou tarde, o morto pede de volta — e cobra com juros.', opts: [{ t: 'Anotado.', to: null }] },
        f: { text: 'Alguém. Três pagens do castelo. Pergunte à cozinheira o que ela ouve na pedra.', opts: [{ t: 'Falarei com Hilda.', to: null, act: (g) => g.q.clue('oven') }] },
      },
    },
  },
  /* ---------------- EXÉRCITO E VIAJANTES ---------------- */
  {
    id: 'brand', name: 'Ser Brand', title: 'Cavaleiro Errante', room: 'Vila Cinzalta',
    kind: 'human', spawn: [96, 0, 140], yaw: 1.2, behavior: 'wander', wanderR: 8,
    look: {
      scale: 1.07, skin: 0x9a6c48, hair: 0x3a2a18, beard: true, beardColor: 0x3a2a18,
      cloth: 0x2a2e34, cloth2: 0x1c1f24, metal: true, accent: 0x6a6a72, gloves: true,
      cloak: true, cloakColor: 0x3a2a22, build: { x: 0.56, z: 0.34, arm: 0.66 },
    },
    posts: [P(96, 0, 140, 1.2), P(104, 0, 146, -0.6), P(90, 0, 132, 2.2)],
    schedule: [S(0, 24, P(96, 0, 140, 1.2), 'wander', 'idle')],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Ando de vila em vila atrás de um dragão de pedra e de um rio que engole gente. Varenya é o último reino da minha lista — e o mais mal-assombrado.',
          opts: [
            { t: 'Você viu o rochedo?', to: 'b', act: (g) => g.q.clue('rock') },
            { t: 'Viajar de cavalo é seguro?', to: 'c' },
            { t: 'O que falou o lobo?', to: 'd' },
            { t: 'Boa viagem, ser.', to: null },
          ],
        },
        b: { text: 'Vi. Há um dragão dormindo dentro da pedra, e um altar na boca dele. Gente de luva já subiu ali e desceu sem falar.', opts: [{ t: 'Gente de luva?', to: 'e' }, { t: 'Vou subir também.', to: null }] },
        c: { text: 'Com um cavalo bom, sim. Se andar à noite, olhe as patas: quem pisar em sombra e não levantar poeira, é coisa morta.', opts: [{ t: 'Anotado.', to: null }] },
        d: { text: 'Uma coisa que não é bicho. Quando o luar cai no bosque, ele começa a responder aos uivos — e o bosque não tem lobos desde a guerra.', opts: [{ t: 'Vou caçar isso.', to: null, act: (g) => g.q.start('lobo') }] },
        e: { text: 'Um homem alto, de luva de couro, e um capuz. Falava com a pedra como se ela devesse resposta.', opts: [{ t: 'Isso eu já ouvi antes.', to: null }] },
      },
    },
  },
  {
    id: 'nara', name: 'Nara', title: 'Batedora da Guarda', room: 'Vila Cinzalta',
    kind: 'human', spawn: [64, 0, 128], yaw: 2.6, behavior: 'stand', wanderR: 3,
    look: {
      scale: 0.97, skin: 0xb98a60, hair: 0x1c1410, hairStyle: 'braid', longHair: true,
      cloth: 0x2f3327, cloth2: 0x212418, accent: 0x6a7a4a, hood: true, hoodColor: 0x2a2e20,
    },
    posts: [P(64, 0, 128, 2.6), P(58, 0, 124, 1.4), P(70, 0, 122, 0.2)],
    schedule: [
      S(5, 22, P(64, 0, 128, 2.6), 'wander', 'idle'),
      S(22, 5, P(66, 0, 146, 0.6, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Sou os olhos da capitã fora dos muros. E você é o escudeiro novo. Cheguei à conclusão: você vai morrer bem, ou servir bem. Ainda não sei qual.',
          opts: [
            { t: 'O que viu na ponte?', to: 'b', act: (g) => g.q.clue('bridge_guard') },
            { t: 'Me dê a rota mais rápida.', to: 'c', act: (g) => g.q.give('mapa') },
            { t: 'Onde estão as ruínas?', to: 'd' },
            { t: 'Sigo viagem.', to: null },
          ],
        },
        b: { text: 'Vi barris e um homem de luva. Vi água subir contra a correnteza. E vi dois dos meus homens olharem para a lua por uma hora sem piscar.', opts: [{ t: 'O que fizeram depois?', to: 'e' }, { t: 'Vou até lá.', to: null }] },
        c: { text: 'Vá pelo sul, siga a estrada da vila até o rio. Nada de atalho pelo bosque: o bosque conta os que entram e não conta os que saem.', opts: [{ t: 'Obrigado.', to: null }] },
        d: { text: 'Norte, além das ruínas do septo, onde a neve não derrete e a pedra ainda tem dentes. Se for, leve tocha e sal.', opts: [{ t: 'Sal?', to: 'd2' }, { t: 'Vou lembrar.', to: null }] },
        d2: { text: 'Sal é o que abre e fecha o que dorme. Você cheira a sal desde que entrou na vila — veio da cripta, não foi?', opts: [{ t: '...', to: null, act: (g) => g.q.clue('salt') }] },
        e: { text: 'Foram para a água. Os dois. Com sorrisos.', opts: [{ t: 'Deusas.', to: null }] },
      },
    },
  },
  /* ---------------- PLEBE / POVO ---------------- */
  {
    id: 'cooper', name: 'Tobias', title: 'Tanoeiro', room: 'Vila Cinzalta',
    kind: 'human', spawn: [54, 0, 146], yaw: 1.8, behavior: 'stand', wanderR: 2,
    look: { scale: 1.0, skin: 0xa87c54, hair: 0x2a1a10, beard: true, beardColor: 0x2a1a10, cloth: 0x3a2e22, cloth2: 0x261e16, apron: true },
    posts: [P(54, 0, 146, 1.8), P(50, 0, 142, 0.6)],
    schedule: [S(6, 22, P(54, 0, 146, 1.8), 'stand', 'work'), S(22, 6, P(56, 0, 150, 0.6, 0.85), 'stand', 'sleep')],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Barris, escudeiro! Barris para sal, barris para vinho e barris para coisas que eu finjo não ver. Compre um.',
          opts: [
            { t: 'Que coisas você finge não ver?', to: 'b' },
            { t: 'Compro um barril.', to: 'c' },
            { t: 'Bom dia.', to: null },
          ],
        },
        b: { text: 'Barris com sal grosso que não é sal. Vêm do castelo vazios e voltam cheios. Peso errado. Eu cobro do mesmo jeito — mas os olhos, escudeiro, eu fecho.', opts: [{ t: 'Vou ver isso.', to: null, act: (g) => g.q.clue('salt') }, { t: 'Continue fingindo.', to: null }] },
        c: { text: 'Leve dois. Preço de amigo: três moedas e uma fofoca.', opts: [{ t: 'Fica devendo a fofoca.', to: null }] },
      },
    },
  },
  {
    id: 'forgemaster', name: 'Halvard', title: 'Intendente do Castelo', room: 'Vestiário do Portão',
    kind: 'human', spawn: [11.0, 0, 10.4], yaw: -1.8, behavior: 'stand', wanderR: 1.4,
    look: {
      scale: 1.01, skin: 0xb08a68, hair: 0x5a4a38, beard: true, beardColor: 0x6a5a46,
      cloth: 0x35301f, cloth2: 0x242015, accent: 0x7a6a3a, chain: true,
    },
    posts: [P(11.0, 0, 10.4, -1.8), P(12.4, 0, 9.4, 1.4), P(4.4, 0, 11.0, -1.2)],
    schedule: [
      S(6, 20, P(11.0, 0, 10.4, -1.8), 'stand', 'work'),
      S(20, 24, P(4.4, 0, 11.0, -1.2), 'stand', 'sit'),
      S(0, 6, P(12.6, 0, 11.0, 0.6, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Requisições, escudeiro. Selo, contagem, dobro de contagem. Quer equipamento? Faça-me um favor e eu anoto no livro.',
          opts: [
            { t: 'Que favor?', to: 'b' },
            { t: 'Quem requisita óleo de lamparina?', to: 'c', act: (g) => g.q.clue('oil') },
            { t: 'Preciso de tocha.', to: 'd', act: (g) => g.q.give('tocha') },
            { t: 'Depois.', to: null },
          ],
        },
        b: { text: 'O selo de cera preta está sumindo do meu armário. Três vezes nesta lua. Traga-me quem o usa e eu te visto de aço de pés à cabeça.', opts: [{ t: 'Aceito o trabalho.', to: null, act: (g) => g.q.start('selo') }, { t: 'Sem tempo.', to: null }] },
        c: { text: 'Cera preta, óleo em triplo, e sal. Tudo assinado como "obra do rei". O rei não assina nada há vinte anos, escudeiro.', opts: [{ t: 'Quem entrega os papéis?', to: 'e' }, { t: 'Boa pista.', to: null }] },
        d: { text: 'Leve quatro. E não acenda dentro da cripta sem me contar depois o que viu. Eu pago em prata por histórias de verdade.', opts: [{ t: 'Contarei.', to: null }] },
        e: { text: 'Um homem de luva, sem rosto, cheirando a sal. Ele deixa o papel e sai sem papel de saída. Ninguém consegue barrar quem não quer ser visto.', opts: [{ t: 'Vou vigiar a portaria.', to: null }] },
      },
    },
  },
  {
    id: 'jailer', name: 'Gorth', title: 'Carcereiro', room: 'Adega & Masmorra',
    kind: 'human', spawn: [15.4, -4, -14.0], yaw: -1.4, behavior: 'stand', wanderR: 1.2,
    look: {
      scale: 1.12, skin: 0x7a5436, hair: 0x14100c, beard: true, beardColor: 0x1a1410,
      cloth: 0x2a2620, cloth2: 0x1c1915, accent: 0x5a5248, build: { x: 0.66, z: 0.42, arm: 0.7 },
    },
    posts: [P(15.4, -4, -14.0, -1.4), P(13.2, -4, -16.0, 0.6)],
    schedule: [S(0, 24, P(15.4, -4, -14.0, -1.4), 'stand', 'idle')],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Hmph. Outro curioso. Três celas. Duas vazias há vinte anos. Na terceira bato a porta e ouço resposta, e não tem ninguém lá dentro.',
          opts: [
            { t: 'O que a voz responde?', to: 'b' },
            { t: 'Quem ficou preso ali?', to: 'c' },
            { t: 'Abre a cela.', to: 'd' },
            { t: 'Sigo.', to: null },
          ],
        },
        b: { text: '"Está frio, irmão." Sempre isso. Só que eu não tenho irmão.', opts: [{ t: 'Você não é daqui?', to: 'c' }, { t: 'Estranho.', to: null }] },
        c: { text: 'Fui do exército do príncipe. Sobrevivi à Guerra dos Estandartes. Vim servir masmorra porque aqui não precisa marchar.', opts: [{ t: 'Doran...', to: 'e', act: (g) => g.q.clue('doran_alive') }, { t: 'Entendo.', to: null }] },
        d: { text: 'Está aberta, moço. Sempre esteve. É isso que me incomoda.', opts: [{ t: 'Vou entrar.', to: null, act: (g) => g.q.clue('cell') }] },
        e: { text: 'Doran morreu em meus braços. Eu carreguei o corpo até a tenda do septon. Então, se alguém anda por aí com a cara dele, é porque alguém desenterrou o que devia apodrecer.', opts: [{ t: 'Obrigado, Gorth.', to: null }] },
      },
    },
  },
  {
    id: 'elder', name: 'Anciã Brega', title: 'Guardiã das Pedras', room: 'Bosque Antigo',
    kind: 'human', spawn: [-66, 0, 126], yaw: 0.8, behavior: 'stand', wanderR: 1.4,
    look: {
      scale: 0.95, skin: 0xb8a084, hair: 0xd0cabc, longHair: true, hood: true, hoodColor: 0x28241c,
      cloth: 0x2a2620, cloth2: 0x1c1a16, accent: 0x6a6050,
    },
    posts: [P(-66, 0, 126, 0.8), P(-70, 0, 122, 2.2), P(-62, 0, 120, -0.6)],
    schedule: [
      S(6, 22, P(-66, 0, 126, 0.8), 'stand', 'idle'),
      S(22, 6, P(-68, 0, 128, 0.6, 0.85), 'stand', 'sleep'),
    ],
    dialogue: {
      start: 'a', nodes: {
        a: {
          text: 'Fique fora do círculo até eu dizer seu nome em voz alta. ...Pronto. Agora pode pisar. As pedras gostam de gente que chega sem mentir.',
          opts: [
            { t: 'O que são essas pedras?', to: 'b' },
            { t: 'Ouvi uivos que não são de lobo.', to: 'c', act: (g) => g.q.clue('beast') },
            { t: 'Quem mais veio aqui?', to: 'd' },
            { t: 'Paz, anciã.', to: null },
          ],
        },
        b: { text: 'Antigas. Antes de Varenya, antes dos reis, antes dos nomes. A Fé chegou depois e chamou tudo de demônio. Só que demônio velho é só um deus sem templo.', opts: [{ t: 'E o que elas ouvem?', to: 'e' }, { t: 'Uma bela história.', to: null }] },
        c: { text: 'A Coisa Magra. Uiva longe das tochas, come pastores e devolve os ossos arrumados. Se o bosque ficar calado, corra — o silêncio é a boca dela aberta.', opts: [{ t: 'Como matá-la?', to: 'f' }, { t: 'Vou evitar.', to: null }] },
        d: { text: 'O príncipe, há vinte anos, quando voltou da guerra. Subiu ao círculo, gritou por três noites e depois parou. Quando parou, começou a morrer.', opts: [{ t: 'O príncipe voltou?!', to: 'g', act: (g2) => g2.q.clue('doran_alive') }, { t: 'Estranho.', to: null }] },
        e: { text: 'A pedra ouve juramentos. E cobra os quebrados. Se você jurar algo aqui, cumpra — ou não jure.', opts: [{ t: 'Vou lembrar disso.', to: null }] },
        f: { text: 'Ferro que nunca refletiu luz e sal de sete mares. Aqui só o sal você consegue fácil: na ponte.', opts: [{ t: 'Obrigado.', to: null, act: (g) => g.q.clue('salt') }] },
        g: { text: 'Voltou da guerra com sal nos olhos. Todo morto devolvido em sal traz um pedaço do além nos olhos. Ele já estava morto quando chegou — e ainda assim andou três noites.', opts: [{ t: 'Deusas...', to: null }] },
      },
    },
  },
  /* ---------------- NPCs de apoio (sem diálogo próprio) ---------------- */
  ...makeGuards(),
  ...makeServants(),
  ...makeVillagers(),
  ...makeAnimals(),
];

/* =====================================================================
 *  FÁBRICAS DE NPCs DE APOIO
 * ===================================================================== */
function makeGuards() {
  const posts = [
    ['guard_vestibule', 'Guarda Renn', [7.9, 0, 9.4], [[7.9, 0, 9.4], [7.6, 0, 14.5]], 'Vestíbulo do Portão'],
    ['guard_throne', 'Guarda Vick', [6.0, 8, -6.0], [[6.0, 8, -6.0], [-6.0, 8, -6.0]], 'Salão do Trono'],
    ['guard_gate', 'Guarda Sable', [4.0, 0, 20.0], [[4.0, 0, 20.0], [-4.0, 0, 24.0], [4.0, 0, 28.0]], 'Pátio do Portão'],
    ['guard_hall', 'Guarda Dorn', [-11.0, 0, -11.0], [[-11.0, 0, -11.0], [-3.0, 0, -4.0]], 'Grande Salão'],
    ['guard_wall', 'Guarda Pyle', [0.0, 0, 30.0], [[-8.0, 0, 30.0], [8.0, 0, 30.0]], 'Pátio do Portão'],
    ['guard_cellar', 'Guarda Fenn', [12.6, -4, -13.0], [[12.6, -4, -13.0], [17.0, -4, -15.5]], 'Adega & Masmorra'],
    ['guard_yard', 'Guarda Tim', [-19.0, 0, 6.0], [[-19.0, 0, 6.0], [-24.0, 0, -3.0]], 'Pátio de Treino'],
    ['guard_village', 'Guarda Jill', [74.0, 0, 134.0], [[74.0, 0, 134.0], [66.0, 0, 130.0]], 'Vila Cinzalta'],
  ];
  const names = [C.clothGrey, C.clothBlue, C.metal ? 0 : 0x3a3f48];
  return posts.map(([id, name, spawn, path, room], i) => ({
    id, name, title: 'Guarda de Varn', room, kind: 'human',
    spawn, yaw: i * 0.7, behavior: 'stand', wanderR: 1,
    look: {
      scale: 1.02 + (i % 3) * 0.02, skin: [C.skin, C.skinPale, C.skinDark][i % 3],
      hair: [C.hair, C.hairBlond, C.hairRed][i % 3], metal: true,
      cloth: 0x2b2f36, cloth2: 0x1e2126, accent: 0x5d626c, gloves: true, helm: i % 2 === 0,
      build: { x: 0.5, z: 0.3 },
    },
    path, posts: [P(spawn[0], spawn[1], spawn[2], i)],
    schedule: [
      { from: i % 2 ? 6 : 18, to: i % 2 ? 18 : 6, act: 'patrol', anim: 'walk' },
      { from: i % 2 ? 18 : 6, to: i % 2 ? 6 : 18, p: [spawn[0], spawn[1], spawn[2]], act: 'stand', anim: 'idle', yaw: i * 1.1 },
    ],
    dialogue: gossipDialogue(name, i),
    _aux: true,
  }));
}

function makeServants() {
  const defs = [
    ['serv_1', 'Mabel', 'Criada', [-6.2, 0, 10.4]],
    ['serv_2', 'Perrin', 'Mozão de Estábulo', [-29.0, 0, -7.0]],
    ['serv_3', 'Sefa', 'Lavadeira', [-6.6, 0, 3.4]],
    ['serv_4', 'Corvo', 'Pagem', [3.6, 0, 9.0]],
    ['serv_5', 'Nestor', 'Escrivão do Arquivo', [7.4, 8, 9.4]],
    ['serv_6', 'Iva', 'Cozinheira', [-6.8, 0, 5.9]],
    ['serv_7', 'Gwen', 'Ajudante de Estrebaria', [-27.5, 0, -3.0]],
    ['serv_8', 'Aldous', 'Sacristão', [11.6, 4, 10.2]],
  ];
  return defs.map(([id, name, title, spawn], i) => ({
    id, name, title, room: 'Serviçais do Castelo', kind: 'human',
    spawn, yaw: i, behavior: 'wander', wanderR: 3.2,
    look: {
      scale: 0.96 + (i % 4) * 0.02, skin: [C.skinDark, C.skin, C.skinPale][i % 3],
      hair: [C.hair, C.hairGrey, C.hairBlond, C.hairRed][i % 4],
      cloth: [C.clothBrown, 0x3a3a3a, 0x2e3a2e][i % 3], cloth2: 0x241f18,
      apron: i % 3 === 0, accent: 0x8a7a5a,
    },
    posts: [P(spawn[0], spawn[1], spawn[2], i * 0.9)],
    schedule: [
      { from: 5, to: 21, p: [spawn[0], spawn[1], spawn[2]], act: 'wander', anim: 'idle' },
      { from: 21, to: 5, p: [spawn[0], spawn[1] + 0.85, spawn[2]], act: 'stand', anim: 'sleep', yaw: i },
    ],
    dialogue: gossipDialogue(name, i + 3),
    _aux: true,
  }));
}

function makeVillagers() {
  const defs = [
    ['vil_1', 'Alda', 'Padeira', [60, 0, 150]],
    ['vil_2', 'Cedric', 'Lavrador', [78, 0, 128]],
    ['vil_3', 'Rosa', 'Menina', [70, 0, 152]],
    ['vil_4', 'Grande Osk', 'Lenhador', [-64, 0, 108]],
    ['vil_5', 'Ilse', 'Tecelã', [52, 0, 132]],
    ['vil_6', 'Beto', 'Pastor', [24, 0, 40]],
    ['vil_7', 'Sara', 'Mercadora', [88, 0, 144]],
    ['vil_8', 'Velho Jory', 'Contador de Histórias', [66, 0, 158]],
    ['vil_9', 'Nina', 'Criança', [76, 0, 156]],
    ['vil_10', 'Kurt', 'Cavaleiro de Ronda', [120, 0, 142]],
  ];
  return defs.map(([id, name, title, spawn], i) => ({
    id, name, title, room: 'Povo de Varenya', kind: 'human',
    spawn, yaw: i * 1.3, behavior: 'wander', wanderR: 7,
    look: {
      scale: id === 'vil_3' || id === 'vil_9' ? 0.68 : id === 'vil_4' ? 1.12 : 0.95 + (i % 3) * 0.03,
      skin: [C.skin, C.skinDark, C.skinPale][i % 3],
      hair: [C.hair, C.hairBlond, C.hairRed, C.hairGrey][i % 4],
      cloth: [0x4a3a2a, 0x2e3a2e, 0x3a3238, 0x43382a][i % 4], cloth2: 0x2a2318,
      apron: i % 2 === 0, accent: 0x8a7a5a, hat: id === 'vil_4',
      build: { x: 0.5 + (i % 3) * 0.04, z: 0.3 },
    },
    posts: [P(spawn[0], spawn[1], spawn[2], i)],
    schedule: [
      { from: 6, to: 20, p: [spawn[0], spawn[1], spawn[2]], act: 'wander', anim: 'idle' },
      { from: 20, to: 6, p: [spawn[0], spawn[1] + 0.85, spawn[2]], act: 'stand', anim: 'sleep', yaw: i * 0.7 },
    ],
    dialogue: gossipDialogue(name, i + 7, 'vila'),
    _aux: true,
  }));
}

function makeAnimals() {
  return [
    {
      id: 'bruma', name: 'Bruma', title: 'o Corcel do Príncipe', room: 'Estrebaria', kind: 'horse',
      spawn: [-27.5, 0, -5.5], yaw: 0.8, behavior: 'stand', wanderR: 2,
      look: { coat: 0x2a1f18, coat2: 0x1a1310, mane: 0x0e0c0a, scale: 1.05, bodyLen: 1.55 },
      posts: [P(-27.5, 0, -5.5, 0.8)], schedule: [{ from: 0, to: 24, p: [-27.5, 0, -5.5], act: 'graze', anim: 'graze' }],
      dialogue: null, isMount: true,
    },
    {
      id: 'deer1', name: 'Cervo', title: '', room: 'Bosque', kind: 'quad',
      spawn: [-40, 0, 60], yaw: 0, behavior: 'wander', wanderR: 14,
      look: { coat: 0x5a4530, coat2: 0x3a2c1e, mane: 0x2a1f16, horns: true, scale: 0.8, bodyLen: 1.2 },
      posts: [P(-40, 0, 60)], schedule: [{ from: 0, to: 24, p: [-40, 0, 60], act: 'wander', anim: 'qGraze' }],
      dialogue: null,
    },
    {
      id: 'wolf1', name: 'Lobo Negro', title: '', room: 'Bosque', kind: 'quad',
      spawn: [-96, 0, 168], yaw: 0, behavior: 'wander', wanderR: 22,
      look: { coat: 0x1c1a1c, coat2: 0x121012, mane: 0x0c0b0d, scale: 0.75, bodyLen: 1.15 },
      posts: [P(-96, 0, 168)], schedule: [{ from: 20, to: 6, p: [-96, 0, 168], act: 'wander', anim: 'qIdle' },
      { from: 6, to: 20, p: [-96, 0, 168], act: 'stand', anim: 'qSleep' }],
      dialogue: null,
    },
    {
      id: 'horse2', name: 'Corcel Cinzento', title: '', room: 'Vila Cinzalta', kind: 'horse',
      spawn: [84, 0, 138], yaw: 0.4, behavior: 'stand', wanderR: 3,
      look: { coat: 0x5a5a60, coat2: 0x3a3a40, mane: 0x24242a, scale: 0.98, bodyLen: 1.45 },
      posts: [P(84, 0, 138, 0.4)], schedule: [{ from: 0, to: 24, p: [84, 0, 138], act: 'graze', anim: 'graze' }],
      dialogue: null, isMount: true,
    },
  ];
}

/* =====================================================================
 *  DIÁLOGOS GENÉRICOS (fofoca) — variados por NPC e por hora
 * ===================================================================== */
function gossipDialogue(name, seed, kind = 'castle') {
  const boato = kind === 'vila' ? [
    'Dizem que a ponte do Cinza anda engolindo barqueiro. Eu não passo ali nem de dia.',
    'A colheita veio escura. Quando a terra fica preta, é porque alguém está queimando coisa errada.',
    'O septon diz que a Fé protege. A Fé não viu o que eu vi na água.',
    'Meu primo jurou ter visto um dragão de pedra abrir o olho no rochedo. Bebeu, claro. Mas jurou.',
  ] : [
    'Não repita isto: a rainha manda acender lamparina até o terceiro andar, e o terceiro andar está vazio.',
    'Cuidado com a fornalha. Eu já trabalhei nela e a pedra estava quente quando não tinha fogo.',
    'O copeiro passou por mim sem olhar. Sempre foi educado. Depois que o príncipe morreu, ninguém é educado.',
    'Se ouvir pisada de luva no corredor, encoste na parede. Só isso. Não corra.',
    'O capitão Edda anda com o mapa debaixo da armadura. Ninguém sabe o que ela marca nele.',
  ];
  const l = kind === 'vila' ? boato : boato;
  return {
    start: 'a',
    nodes: {
      a: {
        text: `${name} olha em volta antes de falar: "${l[seed % l.length]}"`,
        opts: [
          { t: 'Conte-me mais.', to: 'b' },
          { t: 'Quem manda aqui?', to: 'c' },
          { t: 'Onde consigo água e pão?', to: 'd' },
          { t: 'Obrigado.', to: null },
        ],
      },
      b: {
        text: kind === 'vila'
          ? '"Só isso. Falar demais em Cinzalta é dormir no rio."'
          : '"Não posso. Juro pela Fé, não posso. A capitã arranca língua de quem fala de mais."',
        opts: [{ t: 'Entendo.', to: null }],
      },
      c: {
        text: kind === 'vila'
          ? '"A coroa manda. O castelo come. E nós pagamos a conta duas vezes."'
          : '"O rei está de cama, a rainha governa e o Mestre Corvin decide o que chega aos ouvidos dela."',
        opts: [{ t: 'Bom saber.', to: null }],
      },
      d: {
        text: '"O poço do pátio está bom. Só não olhe muito para dentro — o poço de um castelo guarda mais que água."',
        opts: [{ t: 'Vou beber.', to: null }],
      },
    },
  };
}
