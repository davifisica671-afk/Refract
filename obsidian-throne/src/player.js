import * as THREE from 'three';
import { makeHumanoid, makeQuadruped, animate } from './character.js';
import { MAT_LIT, prep, trs, unitBox, unitCyl } from './batch.js';
import { C, terrainHeight, physics, clamp, FLOOR } from './config.js';

/* =====================================================================
 *  JOGADOR — câmera em 3ª pessoa, colisão AABB, salto, corrida e montaria
 * ===================================================================== */
export class Player {
  constructor(world) {
    this.world = world;
    this.rig = makeHumanoid({
      cloth: 0x3a3a44, cloth2: 0x24242b, skin: C.skin, hair: 0x1c1410,
      belt: 0x2a2118, accent: C.steel, metal: false,
      cloak: true, cloakColor: 0x2a2f3a, longHair: false, hairStyle: 'short',
      eye: 0x2b1f14,
    });
    this.group = new THREE.Group();
    this.group.add(this.rig.root);
    this.pos = new THREE.Vector3(4, 0.2, 18);
    this.vel = new THREE.Vector3();
    this.velY = 0;
    this.yaw = Math.PI;
    this.anim = 'idle';
    this.onGround = true;
    this.health = 100;
    this.stamina = 100;
    this.gold = 12;
    this.mode = 'walk';       // walk | run
    this.mounted = false;
    this.mount = null;
    this.fallStart = 0;
    this.inWater = false;
    this.safePos = this.pos.clone();
    this.title = 'Escudeiro do Portão';
    this.spd = 1;
    this.rig.root.position.copy(this.pos);
    this.world.group.add(this.group);
    this._avoid = new THREE.Vector3();
  }

  get eyeY() { return this.pos.y + 1.62; }

  /** Solo onde o corpo vai pisar ao chegar em (x,z): permite subir degraus sem travar. */
  stepRef(x, z) {
    const g = physics.groundAt(x, z, this.pos.y);
    return g === -Infinity ? this.pos.y : g;
  }

  teleport(v) {
    this.pos.copy(v);
    this.vel.set(0, 0, 0);
    this.velY = 0;
    this.safePos.copy(v);
    this.rig.root.position.copy(v);
  }

  update(dt, input, camYaw) {
    const w = this.world;
    const running = input.run && this.stamina > 4;
    const spdBase = this.mounted ? 0 : (running ? 6.6 : 3.5);
    this.mode = running ? 'run' : 'walk';

    // direção relativa à câmera
    let ix = input.x, iz = input.z;
    const mag = Math.hypot(ix, iz);
    if (mag > 1) { ix /= mag; iz /= mag; }
    const fwd = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const desired = new THREE.Vector3()
      .addScaledVector(fwd, -iz)
      .addScaledVector(right, ix)
      .multiplyScalar(spdBase);

    // atrito / aceleração
    const accel = this.onGround ? 12 : 3;
    this.vel.x += (desired.x - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (desired.z - this.vel.z) * Math.min(1, dt * accel);

    // fôlego
    const moving = mag > 0.05;
    if (running && moving) this.stamina = Math.max(0, this.stamina - dt * 13);
    else this.stamina = Math.min(100, this.stamina + dt * (moving ? 5 : 14));

    // água
    const th = terrainHeight(this.pos.x, this.pos.z);
    this.inWater = th < -0.45 && this.pos.y < -0.1;
    const waterMul = this.inWater ? 0.45 : 1;

    // colisão horizontal, resolvendo eixo a eixo
    const r = 0.42, hgt = 1.7;
    const tryMove = (dx, dz) => {
      const nx = this.pos.x + dx * waterMul, nz = this.pos.z + dz * waterMul;
      const ref = this.stepRef(nx, nz);
      if (!physics.blocked(nx, this.pos.y, this.pos.z, r, hgt, true, ref)) this.pos.x = nx;
      if (!physics.blocked(this.pos.x, this.pos.y, nz, r, hgt, true, ref)) this.pos.z = nz;
    };
    tryMove(this.vel.x * dt, this.vel.z * dt);

    // gravidade
    this.velY -= 24 * dt;
    this.pos.y += this.velY * dt;
    const g = physics.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const floor = g === -Infinity ? -999 : g;
    if (this.pos.y <= floor + 0.001) {
      if (this.velY < -14 && !this.onGround) {
        const dmg = Math.min(60, (-this.velY - 14) * 2.4);
        this.health = Math.max(1, this.health - dmg);
        this.world.onPlayerHurt?.(dmg, 'queda');
      }
      this.pos.y = floor;
      this.velY = 0;
      this.onGround = true;
    } else this.onGround = false;

    // teto
    const ceil = physics.ceilingAt(this.pos.x, this.pos.z, this.pos.y + 0.1);
    if (ceil !== Infinity && this.pos.y + 1.75 > ceil && this.velY > 0) {
      this.pos.y = ceil - 1.75;
      this.velY = 0;
    }
    // queda no vazio → volta ao último lugar seguro
    if (this.pos.y < -9 || !isFinite(this.pos.y)) {
      this.teleport(this.safePos.clone().setY(this.safePos.y + 0.2));
      this.health = Math.max(5, this.health - 10);
    } else if (this.onGround && this.pos.y > -1) {
      this.safePos.copy(this.pos);
    }

    // salto
    if (input.jump && this.onGround) {
      this.velY = 7.6;
      this.onGround = false;
      input.jump = false;
    }

    // orientação
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.4) {
      const target = Math.atan2(this.vel.x, this.vel.z);
      let d = target - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 9);
    }

    // animação
    let anim = 'idle';
    if (this.mounted) anim = 'ride';
    else if (speed > 4.6) anim = 'run';
    else if (speed > 0.35) anim = 'walk';
    if (this.inWater) anim = 'walk';
    this.anim = anim;
    this.spd = clamp(speed / (anim === 'run' ? 6.6 : 3.4), 0.6, 1.6);
    this.rig.spd = this.spd;
    animate(this.rig, anim, dt);
    if (!this.mounted) {
      this.rig.root.position.copy(this.pos);
      this.rig.root.rotation.y = this.yaw;
    }
  }
}

/* =====================================================================
 *  MONTARIA — corcel com sela, IA de seguir, assobio e galope
 * ===================================================================== */
export class Mount {
  constructor(world, opts = {}) {
    this.world = world;
    this.rig = makeQuadruped({
      coat: opts.coat ?? 0x39281a, coat2: 0x241a12, mane: 0x110f0c,
      bodyLen: 1.5, scale: 1.02,
    });
    this.group = new THREE.Group();
    this.group.add(this.rig.root);
    // sela + rédeas
    const saddle = [
      prep(unitBox(), 0x4a3320, trs(0, 1.42, 0.05, 0, 0, 0, 0.72, 0.2, 0.8)),
      prep(unitBox(), 0x33241a, trs(0, 1.5, 0.36, 0, 0, 0, 0.6, 0.4, 0.16)),
      prep(unitCyl(6), 0x8a7048, trs(0, 1.3, -0.3, 0.3, 0, 0, 0.14, 0.8, 0.14)),
      prep(unitBox(), 0x2a1f16, trs(0, 1.28, 0.05, 0, 0, 0, 0.78, 0.1, 0.9)),
    ];
    for (const d of [-1, 1]) {
      saddle.push(prep(unitBox(), 0x33241a, trs(d * 0.34, 0.86, 0.05, 0, 0, 0, 0.1, 0.7, 0.94)));
      saddle.push(prep(unitBox(), 0x6b5636, trs(d * 0.42, 1.2, -1.0, 0, 0, 0, 0.06, 0.06, 0.9)));
    }
    const sm = new THREE.Mesh(saddle.length === 1 ? saddle[0] : mergeAll(saddle), MAT_LIT);
    this.rig.body.add(sm);
    this.rig.horn = null;
    // chifre de guerra
    if (opts.horn) {
      const g = [prep(unitCyl(6), 0xb9b0a0, trs(0.44, 1.1, -0.9, 0, 0, 1.1, 0.14, 0.7, 0.14))];
      this.rig.body.add(new THREE.Mesh(g[0], MAT_LIT));
    }
    this.pos = new THREE.Vector3(opts.x ?? -27.5, 0.2, opts.z ?? -5.5);
    this.vel = new THREE.Vector3();
    this.velY = 0;
    this.yaw = 0.6;
    this.anim = 'qIdle';
    this.spd = 1;
    this.rider = null;
    this.following = false;
    this.recall = false;
    this.tamed = false;
    this.speedMax = 15.5;
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    world.group.add(this.group);
    this._tmp = new THREE.Vector3();
  }

  /** Chamado para assobiar/atender. */
  whistle(px, pz) {
    const d = Math.hypot(this.pos.x - px, this.pos.z - pz);
    this.recall = d > 4.0;
    this.tamed = true;
    return { came: !this.recall, distance: d };
  }

  mount(player) {
    this.rider = player;
    player.mounted = true;
    player.mount = this;
    this.recall = false;
    return this;
  }
  dismount() {
    const p = this.rider;
    if (!p) return null;
    // procura um lado livre
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    for (const s of [1, -1]) {
      const target = this._tmp.copy(this.pos).addScaledVector(side, 1.5 * s);
      if (!physics.blocked(target.x, this.pos.y, target.z, 0.45, 1.7)) {
        const g = physics.groundAt(target.x, target.z, this.pos.y + 1);
        p.teleport(new THREE.Vector3(target.x, (g === -Infinity ? this.pos.y : g) + 0.05, target.z));
        break;
      }
    }
    p.mounted = false;
    p.mount = null;
    p.yaw = this.yaw;
    this.rider = null;
    return p;
  }

  update(dt, player, input) {
    const mounted = !!this.rider;
    let targetSpeed = 0;
    let desiredYaw = this.yaw;

    if (mounted) {
      const camYaw = input.camYaw ?? 0;
      let ix = input.x, iz = input.z;
      const mag = Math.hypot(ix, iz);
      if (mag > 1) { ix /= mag; iz /= mag; }
      const fwd = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
      const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const move = new THREE.Vector3().addScaledVector(fwd, -iz).addScaledVector(right, ix);
      const moving = move.lengthSq() > 0.001;
      if (moving) {
        desiredYaw = Math.atan2(move.x, move.z);
        targetSpeed = (input.run ? 1 : 0.42) * this.speedMax;
      } else {
        targetSpeed = 0;
      }
      // rédea: parar de ré e virar
      if (input.back) targetSpeed = -2.0;
      input.jump && (this.jumpImpulse = 6.0);
    } else if (this.recall || this.following) {
      const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > (this.recall ? 2.4 : 5.2)) {
        desiredYaw = Math.atan2(dx, dz);
        targetSpeed = this.recall ? 11 : 3.2;
      } else {
        targetSpeed = 0;
        if (this.recall) this.recall = false;
      }
    }

    // aceleração / frenagem
    const cur = Math.hypot(this.vel.x, this.vel.z);
    const accel = targetSpeed > cur ? (mounted && input.run ? 9 : 6) : 12;
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const newSpeed = cur + Math.sign(targetSpeed - cur) * Math.min(Math.abs(targetSpeed - cur), accel * dt);
    this.vel.x = dir.x * Math.max(0, newSpeed);
    this.vel.z = dir.z * Math.max(0, newSpeed);
    // virar
    let dy = desiredYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const turnRate = clamp(2.6 - cur * 0.09, 0.9, 2.6);
    this.yaw += clamp(dy, -turnRate * dt, turnRate * dt);

    // física
    const th = terrainHeight(this.pos.x, this.pos.z);
    const inWater = th < -0.45 && this.pos.y < -0.1;
    const mul = inWater ? 0.4 : 1;
    const nx = this.pos.x + this.vel.x * dt * mul, nz = this.pos.z + this.vel.z * dt * mul;
    const r = 0.8;
    const gr = physics.groundAt(nx, nz, this.pos.y);
    const ref = gr === -Infinity || gr > this.pos.y + 0.45 ? this.pos.y : gr;
    if (!physics.blocked(nx, this.pos.y, this.pos.z, r, 1.7, true, ref)) this.pos.x = nx;
    else this.vel.multiplyScalar(0.3);
    if (!physics.blocked(this.pos.x, this.pos.y, nz, r, 1.7, true, ref)) this.pos.z = nz;
    else this.vel.multiplyScalar(0.3);

    this.velY -= 24 * dt;
    if (this.jumpImpulse) { this.velY = this.jumpImpulse; this.jumpImpulse = 0; }
    this.pos.y += this.velY * dt;
    const g = physics.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const floor = g === -Infinity ? 0 : g;
    if (this.pos.y <= floor) { this.pos.y = floor; this.velY = 0; }

    // animação
    const s = Math.hypot(this.vel.x, this.vel.z);
    let anim = 'qIdle';
    if (mounted || this.recall) {
      if (s > 11) anim = 'qGallop';
      else if (s > 5) anim = 'qTrot';
      else if (s > 0.6) anim = 'qWalk';
    } else {
      if (s > 6) anim = 'qTrot';
      else if (s > 0.5) anim = 'qWalk';
      else if (Math.random() < 0.001) anim = 'qGraze';
    }
    this.anim = anim;
    this.spd = clamp(s / 8, 0.5, 1.8);
    this.rig.spd = this.spd;
    animate(this.rig, anim, dt);
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    return s;
  }
}

function mergeAll(list) {
  // espelha mergeGeometries sem importar de novo
  const pos = [], nor = [], col = [];
  for (const g of list) {
    const p = g.attributes.position.array, n = g.attributes.normal.array, c = g.attributes.color.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); col.push(c[i]); }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
void FLOOR;
