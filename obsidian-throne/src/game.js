import * as THREE from 'three';
import { World } from './world.js';
import { Player, Mount } from './player.js';
import { spawnNPCs } from './npcs.js';
import { Quest, STEPS, CLUES } from './quest.js';
import { SHRINES, REALM } from './realm.js';
import { C, FLOOR, terrainHeight, physics, clamp } from './config.js';
import { animate } from './character.js';
import { MAT_WATER, MAT_GLOW, MAT_GLOW_FOG } from './batch.js';

const DAY_SECONDS = 1500; // 25 min por ciclo completo

export class Game {
  constructor(container) {
    this.container = container;
    this.clock = new THREE.Clock();
    this.time = 0.36;         // 0 = meia-noite, 0.5 = meio-dia
    this.paused = false;
    this.started = false;
    this.input = { x: 0, z: 0, run: false, jump: false, camYaw: 0 };
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, locked: false, down: false };
    this.camYaw = Math.PI;
    this.camPitch = 0.12;
    this.camDist = 5.4;
    this.dialogue = null;
    this.lastRoom = null;
    this.notifyQueue = [];
    this.journal = [];
    this.logs = [];
    this.shrinesFound = new Set();
    this.talked = new Set();
    this.hudTimer = 0;
    this.lightTimer = 0;
    this.questTimer = 0;
    this.nearest = null;
    this.nearNPC = null;
    this.epilogueShown = false;
    this.fps = 60;
    this._fpsAcc = 0; this._fpsFrames = 0;
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this.buildDOM();
  }

  /* ================= inicialização ================= */
  async init(onProgress) {
    const step = async (n, total, txt) => {
      onProgress?.(n / total, txt);
      await new Promise(r => setTimeout(r, 16));
    };
    const TOTAL = 13;
    await step(1, TOTAL, 'Erguendo o céu de Varenya');
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x171a22, 0.0055);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.1, 900);
    this.camera.position.set(0, 4, 24);

    await step(2, TOTAL, 'Acendendo tochas e o dia');
    this.hemi = new THREE.HemisphereLight(0x4a5a75, 0x1a1612, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd8b0, 1.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 240;
    this.sun.shadow.camera.left = -62;
    this.sun.shadow.camera.right = 62;
    this.sun.shadow.camera.top = 62;
    this.sun.shadow.camera.bottom = -62;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight(0x2a3040, 0.5);
    this.scene.add(this.ambient);

    await step(3, TOTAL, 'Assentando pedra sobre pedra');
    this.world = new World(this.scene);
    this.mountObj = null;
    await step(5, TOTAL, 'Construindo três andares e dez quartos');
    this.world.build();
    await step(10, TOTAL, 'Enchendo o castelo de gente');
    this.npcs = spawnNPCs(this.world);
    const mountDef = (await import('./npcs.js')).NPC_CATALOG.find(d => d.isMount);
    this.mountObj = new Mount(this.world, { x: mountDef.spawn[0], z: mountDef.spawn[2] });
    this.world.mount = this.mountObj;

    await step(11, TOTAL, 'Trazendo o escudeiro');
    this.player = new Player(this.world);
    this.player.teleport(new THREE.Vector3(6.5, 0.2, 20));
    this.player.rig.root.rotation.y = Math.PI;
    this.world.onPlayerHurt = (dmg) => {
      this.hurtT = 0.5;
      this.notify(`Ferido (−${Math.round(dmg)}) — vigor ${Math.round(this.player.health)}`);
    };

    await step(12, TOTAL, 'Escrevendo a crônica');
    this.q = new Quest(this);
    this.secondMount = null;

    await step(13, TOTAL, 'Abrindo os portões');
    this.bindEvents();
    this.updateSun(0);
    // câmera inicial: cinematográfica sobre o castelo
    this.camYaw = Math.PI;
    this.camPitch = 0.3;
    this.updateCamera(0.016, true);
    return this;
  }

  /* ================= eventos ================= */
  bindEvents() {
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => {
      if (!this.mouse.locked && this.started && !this.paused && !this.dialogue) {
        canvas.requestPointerLock?.();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = document.pointerLockElement === canvas;
      document.getElementById('hintLock')?.classList.toggle('on', this.started && !this.mouse.locked && !this.paused && !this.dialogue);
    });
    document.addEventListener('mousemove', (e) => {
      if (this.mouse.locked) {
        this.camYaw -= e.movementX * 0.0026;
        this.camPitch = clamp(this.camPitch + e.movementY * 0.0022, -0.55, 1.16);
      } else {
        this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      }
    });
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.dialogue) { this.closeDialogue(); return; }
        if (this.mapOpen) { this.toggleMap(false); return; }
        this.togglePause();
        return;
      }
      if (this.keys.has(e.code)) return;
      this.keys.add(e.code);
      this.onKey(e.code);
      if (['Space', 'Tab', 'KeyE', 'KeyH', 'KeyF', 'KeyM', 'Digit1'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    canvas.addEventListener('mousedown', () => { this.mouse.down = true; });
    canvas.addEventListener('mouseup', () => {
      if (this.mouse.down && this.mouse.locked) this.tryInteract(true);
      this.mouse.down = false;
    });
    document.getElementById('btnResume')?.addEventListener('click', () => this.togglePause(false));
    document.getElementById('btnMenu')?.addEventListener('click', () => location.reload());
    document.getElementById('btnStory')?.addEventListener('click', () => this.showPrologue());
    document.getElementById('btnStart')?.addEventListener('click', () => {
      document.getElementById('menu').classList.add('off');
      document.getElementById('hud').classList.add('on');
      this.started = true;
      this.renderer.domElement.requestPointerLock?.();
      setTimeout(() => this.showPrologue(), 250);
    });
    // escolhas de diálogo pelo teclado
    addEventListener('keydown', (e) => {
      if (!this.dialogue) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9) this.chooseOption(n - 1);
    });
  }

  onKey(code) {
    if (!this.started || this.paused) return;
    if (this.dialogue) {
      if (code === 'Digit1') this.chooseOption(0);
      return;
    }
    switch (code) {
      case 'KeyE': this.tryInteract(false); break;
      case 'KeyH': this.whistle(); break;
      case 'KeyF': this.toggleMount(); break;
      case 'KeyM': this.toggleMap(); break;
      case 'Tab': this.toggleLog(); break;
      case 'Space': this.input.jump = true; break;
    }
  }

  /* ================= ciclo ================= */
  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const raw = this.clock.getDelta();
      const dt = Math.min(raw, 0.05);
      this._fpsAcc += raw; this._fpsFrames++;
      if (this._fpsAcc > 0.5) { this.fps = this._fpsFrames / this._fpsAcc; this._fpsAcc = 0; this._fpsFrames = 0; }
      if (this.started && !this.paused) this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  update(dt) {
    // tempo do reino
    this.time = (this.time + dt / DAY_SECONDS) % 1;
    this.updateSun(dt);

    // entrada de movimento
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    this.input.z = this.dialogue ? 0 : fwd;
    this.input.x = this.dialogue ? 0 : strafe;
    this.input.run = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('ShiftRight');
    this.input.back = fwd < 0;
    this.input.camYaw = this.camYaw;

    this.player.update(dt, this.input, this.camYaw);
    if (this.mountObj) {
      this.mountObj.update(dt, this.player, this.input);
      if (this.player.mounted) {
        const m = this.mountObj;
        // senta o cavaleiro na sela
        const off = new THREE.Vector3(0, 0, 0.05).applyAxisAngle(new THREE.Vector3(0, 1, 0), m.yaw);
        this.player.pos.set(m.pos.x + off.x, m.pos.y + 1.62, m.pos.z + off.z);
        this.player.yaw = m.yaw;
        this.player.rig.root.position.copy(this.player.pos);
        this.player.rig.root.rotation.y = m.yaw;
        // câmera acompanha o galope
        if (Math.hypot(m.vel.x, m.vel.z) > 2) {
          let d = m.yaw - this.camYaw;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          this.camYaw += d * Math.min(1, dt * 1.6);
        }
      }
    }

    // NPCs
    const hour = (this.time * 24 + 6) % 24; // dia começa às 6h
    for (const n of this.npcs) {
      const d = n.pos.distanceTo(this.player.pos);
      if (d > 90) { n.rig.root.visible = false; continue; }
      n.rig.root.visible = true;
      n.update(dt, this.player, hour, this);
      if (d > 46) { n.rig.root.visible = false; }
    }

    this.world.updateDoors(dt);
    this.updateLights(dt);
    this.lightTimer += dt;
    if (this.lightTimer > 0.25) { this.updateLightVisibility(); this.lightTimer = 0; }
    if (this.world.water) this.world.water.position.y = -0.35 + Math.sin(this.time * 40) * 0.03;
    this.updateCamera(dt);
    this.findTarget();
    this.hudTimer += dt;
    if (this.hudTimer > 0.08) { this.updateHUD(); this.hudTimer = 0; }
    this.questTimer += dt;
    if (this.questTimer > 0.6) {
      this.q.check();
      this.checkRoom();
      this.checkShrines();
      this.questTimer = 0;
    }
    if (this.hurtT > 0) { this.hurtT -= dt; document.body.style.boxShadow = `inset 0 0 120px rgba(140,20,20,${this.hurtT})`; if (this.hurtT <= 0) document.body.style.boxShadow = ''; }
  }

  /* ---------- ciclo solar ---------- */
  updateSun(dt) {
    const theta = this.time * Math.PI * 2 - Math.PI / 2;
    const elev = Math.sin(theta);
    const dir = new THREE.Vector3(Math.cos(theta), Math.max(elev, -0.4), 0.42).normalize();
    const p = this.player ? this.player.pos : new THREE.Vector3();
    this.sun.position.copy(p).addScaledVector(dir, 90);
    this.sun.target.position.copy(p);
    this.sun.target.updateMatrixWorld();

    const day = clamp((elev + 0.08) / 0.35, 0, 1);
    const dusk = clamp(1 - Math.abs(elev) / 0.3, 0, 1);
    // cores
    const cDay = new THREE.Color(0xffd8ac), cDusk = new THREE.Color(0xff8a44), cNight = new THREE.Color(0x8fa8d8);
    const col = cNight.clone().lerp(cDusk, dusk * 0.85).lerp(cDay, day);
    this.sun.color.copy(col);
    this.sun.intensity = 0.12 + day * 1.05 + dusk * 0.25;
    this.hemi.intensity = 0.12 + day * 0.5 + dusk * 0.12;
    this.hemi.color.setHex(day > 0.4 ? 0x4a5a75 : 0x2a3550);
    this.ambient.intensity = 0.28 + day * 0.26;
    const fogDay = new THREE.Color(0x2b3340), fogDusk = new THREE.Color(0x3a2018), fogNight = new THREE.Color(0x090c14);
    const fog = fogNight.clone().lerp(fogDusk, dusk * 0.9).lerp(fogDay, day);
    this.scene.fog.color.copy(fog);
    this.scene.fog.density = day > 0.3 ? 0.0048 : 0.0072;
    if (this.world && this.world.sky) this.world.sky.material.color.setScalar(0.34 + day * 0.78 + dusk * 0.12);
    this.dayFactor = day;
  }
  updateLights(dt) {
    const flick = Math.sin(performance.now() * 0.011) * 0.5 + 0.5;
    for (const l of this.world.lights) {
      if (!l.light.visible) continue;
      const f = 1 + (flick - 0.5) * l.flicker * 2;
      l.light.intensity = l.base * f * (this.dayFactor > 0.6 ? 0.55 : 1);
    }
  }

  /** Mantém visíveis apenas as N tochas/braseiros mais próximos (limite de luzes do WebGL).
   *  O número de luzes visíveis é fixo — assim o shader nunca é recompilado. */
  updateLightVisibility() {
    const MAX = 12;
    const p = this.player.pos;
    const arr = this.world.lights;
    for (const l of arr) {
      const d = l.light.position.distanceTo(p);
      l._d = d - (l.light.distance || 16) * 0.35;
    }
    const idx = arr.map((_, i) => i).sort((a, b) => arr[a]._d - arr[b]._d);
    for (let i = 0; i < arr.length; i++) {
      const l = arr[idx[i]];
      l.light.visible = i < MAX;   // contagem fixa: evita recompilar o shader ao andar
    }
  }

  /* ---------- câmera ---------- */
  updateCamera(dt, snap = false) {
    const target = this._tmpV;
    if (this.player.mounted && this.mountObj) {
      target.set(this.mountObj.pos.x, this.mountObj.pos.y + 1.5, this.mountObj.pos.z);
    } else {
      target.set(this.player.pos.x, this.player.pos.y + 1.5, this.player.pos.z);
    }
    const dist = this.player.mounted ? 7.6 : 5.4;
    this.camDist += (dist - this.camDist) * Math.min(1, dt * 3);
    const dir = new THREE.Vector3(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      Math.sin(this.camPitch) + 0.12,
      Math.cos(this.camYaw) * Math.cos(this.camPitch),
    ).normalize();
    let wanted = this.camDist;
    // colisão da câmera com o cenário
    const from = target.clone();
    for (let i = 1; i <= 7; i++) {
      const t = (i / 7) * this.camDist;
      const px = from.x + dir.x * t, py = from.y + dir.y * t, pz = from.z + dir.z * t;
      if (physics.blocked(px, py, pz, 0.3, 0.5)) { wanted = Math.max(1.5, t - 0.55); break; }
    }
    const desired = from.clone().addScaledVector(dir, wanted);
    const g = physics.groundAt(desired.x, desired.z, desired.y + 1);
    if (g !== -Infinity && desired.y < g + 0.5) desired.y = g + 0.5;
    if (snap) this.camera.position.copy(desired);
    else this.camera.position.lerp(desired, Math.min(1, dt * (this.player.mounted ? 9 : 12)));
    // leve antecipação de olhar
    const look = from.clone().addScaledVector(new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw)), -2.2);
    look.y += 0.1;
    this.camera.lookAt(look);
    this.camera.rotation.z += 0;
  }

  /* ---------- alvo de interação ---------- */
  findTarget() {
    const p = this.player.pos;
    const camDir = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    let best = null, bestScore = -Infinity;
    const consider = (kind, obj, pos, label) => {
      const d = Math.hypot(pos.x - p.x, pos.z - p.z);
      if (d > (kind === 'npc' ? 11 : 6.5)) return;
      const to = this._tmpV2.set(pos.x - p.x, 0, pos.z - p.z).normalize();
      const dot = to.dot(camDir);
      if (dot < 0.25 && d > 2.2) return;
      const score = dot * 2.2 - d * 0.14 + (kind === 'npc' ? 0.5 : 0);
      if (score > bestScore) { bestScore = score; best = { kind, obj, pos, label, d }; }
    };
    for (const n of this.npcs) {
      if (!n.rig.root.visible) continue;
      if (n.def && n.def.dialogue === null && !n.def.isMount) continue;
      consider('npc', n, n.pos, n.name + (n.title ? ', ' + n.title : ''));
    }
    if (this.mountObj) consider('mount', this.mountObj, this.mountObj.pos, 'Bruma, o corcel');
    for (const it of this.world.interactables) consider('thing', it, it.pos, it.label);
    if (this.specialTargets) {
      for (const sp of this.specialTargets) consider('special', sp, sp.pos, sp.label);
    }
    this.nearest = best;
    this.nearNPC = best && best.kind === 'npc' ? best.obj : null;
  }

  /* ---------- interação ---------- */
  tryInteract(byClick) {
    const n = this.nearest;
    if (!n) return;
    if (n.kind === 'npc') { this.openDialogue(n.obj); return; }
    if (n.kind === 'mount') { this.toggleMount(); return; }
    if (n.kind === 'thing') {
      if (n.obj.kind === 'gate') {
        const open = this.world.toggleGate();
        this.notify(open ? 'O portão do castelo se abre com um gemido de ferro.' : 'O portão se fecha. Varenya fica do lado de fora.');
      }
      return;
    }
    if (n.kind === 'special') { n.obj.act(this); return; }
  }

  whistle() {
    if (this.player.mounted) { this.notify('Você assobia montado — Bruma sacode a crina.'); return; }
    if (!this.mountObj) return;
    const r = this.mountObj.whistle(this.player.pos.x, this.player.pos.z);
    if (r.came) {
      this.notify('Bruma atende ao assobio e vem a galope.');
      this.say(this.mountObj, 'Bruma relincha.');
    } else {
      this.notify('Bruma ergue a cabeça: já está perto. (F para montar)');
      this.mountObj.following = true;
    }
    this.q.mark('whistled');
  }
  toggleMount() {
    if (!this.mountObj) return;
    if (this.player.mounted) {
      this.mountObj.dismount();
      this.notify('Você desmonta. A sela esfria.');
      return;
    }
    const d = this.mountObj.pos.distanceTo(this.player.pos);
    if (d > 3.6) {
      this.notify('O corcel está longe demais. Assobie (H) para chamá-lo.');
      return;
    }
    this.mountObj.mount(this.player);
    this.mountObj.following = false;
    this.notify('Você monta em Bruma. Shift para galopar.');
    this.q.mark('mounted');
    this.q.give('corcel');
  }

  /* ---------- diálogo ---------- */
  openDialogue(npc) {
    if (!npc.dialogue) return;
    this.dialogue = { npc, nodeId: npc.dialogue.start };
    document.exitPointerLock?.();
    this.q.mark(npc.id + '_talk');
    if (npc.id === 'ysolda') this.q.mark('ysolda_talk');
    if (npc.id === 'maren') this.q.mark('maren_talk');
    npc.faceTowards(this.player.pos.x, this.player.pos.z, 1);
    this.player.rig.root.rotation.y = Math.atan2(npc.pos.x - this.player.pos.x, npc.pos.z - this.player.pos.z);
    this.renderDialogue();
  }
  renderDialogue() {
    const d = this.dialogue;
    if (!d) return;
    const node = d.npc.dialogue.nodes[d.nodeId];
    const opts = (node.opts || []).filter(o => !o.if || o.if(this));
    const el = document.getElementById('dialogue');
    document.getElementById('dlgname').textContent = d.npc.name;
    document.getElementById('dlgtitle').textContent = d.npc.title || '';
    document.getElementById('dlgtext').textContent = node.text;
    const box = document.getElementById('dlgopts');
    box.innerHTML = '';
    opts.forEach((o, i) => {
      const btn = document.createElement('button');
      btn.className = 'opt';
      btn.innerHTML = `<span class="k">${i + 1}</span>${o.t}`;
      btn.onclick = () => this.chooseOption(i);
      box.appendChild(btn);
    });
    const exit = document.createElement('button');
    exit.className = 'opt';
    exit.innerHTML = '<span class="k">ESC</span>Encerrar conversa';
    exit.onclick = () => this.closeDialogue();
    box.appendChild(exit);
    el.classList.add('on');
    this._opts = opts;
  }
  chooseOption(i) {
    const d = this.dialogue;
    if (!d) return;
    const opts = this._opts || [];
    const o = opts[i];
    if (!o) { if (i === opts.length) this.closeDialogue(); return; }
    try { o.act?.({ game: this, q: this.q, npc: d.npc }); } catch (err) { console.warn(err); }
    if (!o.to) { this.closeDialogue(); return; }
    this.dialogue.nodeId = o.to;
    this.renderDialogue();
  }
  closeDialogue() {
    this.dialogue = null;
    document.getElementById('dialogue').classList.remove('on');
    if (this.started && !this.paused) this.renderer.domElement.requestPointerLock?.();
  }

  /* ---------- HUD ---------- */
  notify(text) {
    const box = document.getElementById('notify');
    const el = document.createElement('div');
    el.className = 'note';
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .6s'; }, 3600);
    setTimeout(() => el.remove(), 4600);
    while (box.children.length > 5) box.firstChild.remove();
  }
  say(npc, text, dur = 4) { npc.say(text, dur); }
  log(text) { this.logs.unshift({ t: this.clockTimeString(), text }); if (this.logs.length > 60) this.logs.pop(); }
  openJournal(text) { this.journal.unshift(text); if (this.journal.length > 40) this.journal.pop(); }
  clockTimeString() {
    const h = (this.time * 24 + 6) % 24;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  periodName() {
    const h = (this.time * 24 + 6) % 24;
    if (h < 5) return 'Madrugada';
    if (h < 8) return 'Amanhecer';
    if (h < 12) return 'Manhã';
    if (h < 14) return 'Meio-dia';
    if (h < 18) return 'Tarde';
    if (h < 21) return 'Crepúsculo';
    return 'Noite';
  }
  updateHUD() {
    const p = this.player;
    document.getElementById('hpbar').style.width = Math.max(0, p.health) + '%';
    document.getElementById('hptxt').textContent = `${Math.round(p.health)}/100`;
    document.getElementById('stbar').style.width = p.stamina + '%';
    document.getElementById('sttxt').textContent = Math.round(p.stamina);
    document.getElementById('pname').textContent = 'Escudeiro';
    document.getElementById('ptitle').textContent = this.q.title();
    document.getElementById('pmode').textContent = p.mounted ? 'Montado — galope' : (p.inWater ? 'A nado' : 'A pé');
    document.getElementById('pgold').textContent = `${12 + this.q.gold} moedas`;
    document.getElementById('clock').textContent = `${this.lastRoom || 'Varenya'} — ${this.periodName()} ${this.clockTimeString()}`;
    const st = STEPS[this.q.objectiveIndex()];
    const prog = st && st.prog ? ` (${st.prog(this.q)})` : '';
    document.getElementById('questText').innerHTML = st
      ? `${st.text}${prog}<br><span style="color:#8d8578;font-size:11px">Passo ${this.q.objectiveIndex() + 1} de ${STEPS.length} · ${this.q.rooms.size} lugares · ${this.q.clues.size} pistas</span>`
      : 'A crônica está completa. Varenya conhece o teu nome.';
    // prompt de interação
    const pr = document.getElementById('prompt');
    if (this.nearest && !this.dialogue) {
      const n = this.nearest;
      const key = n.kind === 'npc' ? 'Clique' : 'E';
      pr.innerHTML = `<b>${key}</b> — ${n.label}`;
      pr.classList.add('on');
    } else pr.classList.remove('on');
    this.drawMinimap();
    this.drawCompass();
    const b = document.getElementById('hintLock');
    if (b) b.classList.toggle('on', this.started && !this.mouse.locked && !this.paused && !this.dialogue);
  }
  checkRoom() {
    const r = this.world.roomAt(this.player.pos.x, this.player.pos.z, this.player.pos.y);
    if (r && (!this.lastRoom || this.lastRoom !== r.name)) {
      this.lastRoom = r.name;
      this.q.visit(r);
    }
  }
  checkShrines() {
    for (const s of SHRINES) {
      if (this.shrinesFound.has(s.name)) continue;
      if (s.pos.distanceTo(this.player.pos) < 26) {
        this.shrinesFound.add(s.name);
        this.notify(`Santuário descoberto: ${s.name} — viagem rápida liberada (M).`);
        this.log('Santuário: ' + s.name);
      }
    }
  }

  /* ---------- minimapa e bússola ---------- */
  drawMinimap() {
    const cv = document.getElementById('minimap');
    if (!cv || !this._mmCtx) this._mmCtx = cv?.getContext('2d');
    const ctx = this._mmCtx;
    if (!ctx) return;
    const W = cv.width, H = cv.height, S = W / 130; // 130 m de raio
    const p = this.player.pos;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.beginPath(); ctx.arc(0, 0, W / 2 - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#182015'; ctx.fillRect(-W / 2, -H / 2, W, H);
    const toMap = (x, z) => {
      const dx = x - p.x, dz = z - p.z;
      const c = Math.cos(-this.camYaw), s = Math.sin(-this.camYaw);
      return [ (dx * c - dz * s) * S, (dx * s + dz * c) * S ];
    };
    // rio
    ctx.strokeStyle = '#1d3a4a'; ctx.lineWidth = 34 * S * 0.34;
    ctx.beginPath();
    for (let z = -180; z <= 260; z += 20) {
      const [mx, my] = toMap(152, z);
      z === -180 ? ctx.moveTo(mx, my) : ctx.lineTo(mx, my);
    }
    ctx.stroke();
    // estradas
    ctx.strokeStyle = '#4a3d2a'; ctx.lineWidth = 3.2;
    const roads = [
      [[0, 33], [32, 82], [70, 136], [140, 140], [212, 108]],
      [[70, 136], [22, 126], [-38, 122], [-60, 120]],
      [[0, 33], [-30, 26], [-40, 22]],
      [[-60, 120], [-25, -20], [-24, -130]],
    ];
    for (const r of roads) {
      ctx.beginPath();
      r.forEach((pt, i) => { const [mx, my] = toMap(pt[0], pt[1]); i ? ctx.lineTo(mx, my) : ctx.moveTo(mx, my); });
      ctx.stroke();
    }
    // castelo
    const drawPlace = (x, z, r, color, label, shape = 'square') => {
      const [mx, my] = toMap(x, z);
      if (Math.hypot(mx, my) > W / 2 + 30) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (shape === 'circle') ctx.arc(mx, my, r, 0, Math.PI * 2);
      else ctx.rect(mx - r, my - r, r * 2, r * 2);
      ctx.fill();
      if (label) {
        ctx.fillStyle = '#b9ae95'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(label, mx, my - r - 3);
      }
    };
    drawPlace(0, 0, 13, '#3c4048', 'Castelo de Hálvar');
    drawPlace(REALM.village.x, REALM.village.z, 8, '#4a4336', 'Vila Cinzalta', 'circle');
    drawPlace(REALM.bridge.x, REALM.bridge.z, 6, '#5a4a3a', 'Ponte', 'circle');
    drawPlace(REALM.rock.x, REALM.rock.z, 7, '#33333a', 'Rochedo', 'circle');
    drawPlace(REALM.ruins.x, REALM.ruins.z, 6, '#3a3a40', 'Ruínas', 'circle');
    drawPlace(REALM.forest.x, REALM.forest.z, 9, '#1e2a18', 'Bosque', 'circle');
    // santuários
    for (const s of SHRINES) {
      const [mx, my] = toMap(s.pos.x, s.pos.z);
      if (Math.hypot(mx, my) > W / 2) continue;
      ctx.fillStyle = this.shrinesFound.has(s.name) ? '#ffb45a' : '#5a5344';
      ctx.beginPath(); ctx.arc(mx, my, 3.4, 0, Math.PI * 2); ctx.fill();
    }
    // NPCs
    for (const n of this.npcs) {
      if (!n.rig.root.visible) continue;
      const [mx, my] = toMap(n.pos.x, n.pos.z);
      if (Math.hypot(mx, my) > W / 2) continue;
      ctx.fillStyle = n.def.isMount ? '#7fd08a' : '#c9a227';
      ctx.beginPath(); ctx.arc(mx, my, n.def.isMount ? 3.4 : 2.6, 0, Math.PI * 2); ctx.fill();
    }
    if (this.mountObj) {
      const [mx, my] = toMap(this.mountObj.pos.x, this.mountObj.pos.z);
      ctx.fillStyle = '#7fd08a'; ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill();
    }
    // alvo da crônica
    const tgt = this.questTargetPos();
    if (tgt) {
      const [mx, my] = toMap(tgt.x, tgt.z);
      if (Math.hypot(mx, my) < W / 2) {
        ctx.strokeStyle = '#e6cd7a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(mx, my, 7, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // jogador
    ctx.fillStyle = '#f2e6c8';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(201,162,39,.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#c9a227'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('N', W / 2, 13);
  }
  questTargetPos() {
    const i = this.q.objectiveIndex();
    const id = STEPS[i]?.id;
    const map = {
      maren: new THREE.Vector3(-21, 0, -2), crypt: new THREE.Vector3(0, -4, -10),
      princess: new THREE.Vector3(-9.5, 8, 5), gift: new THREE.Vector3(-3.4, 8, 6.2),
      horse: new THREE.Vector3(-27.5, 0, -5.5), gate: new THREE.Vector3(0, 0, 34),
      bridge: REALM.bridge, rock: REALM.rock, ruins: REALM.ruins, throne: new THREE.Vector3(0, 8, -10),
    };
    return map[id] || null;
  }
  drawCompass() {
    const wrap = document.getElementById('compass');
    if (!wrap) return;
    if (!this._compassInit) {
      wrap.innerHTML = '';
      this._cdirs = [];
      for (const [label, ang] of [['N', 0], ['L', Math.PI / 2], ['S', Math.PI], ['O', -Math.PI / 2]]) {
        const el = document.createElement('span');
        el.className = 'cdir'; el.textContent = label;
        wrap.appendChild(el);
        this._cdirs.push({ el, ang });
      }
      this._mark = document.createElement('span');
      this._mark.className = 'cdir'; this._mark.style.color = '#e6cd7a'; this._mark.textContent = '◆';
      wrap.appendChild(this._mark);
      this._compassInit = true;
    }
    const W = 340;
    const rel = (ang) => {
      let d = ang - (this.camYaw + Math.PI);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return W / 2 - (d / (Math.PI / 2)) * (W / 4);
    };
    for (const c of this._cdirs) { c.el.style.left = rel(c.ang) + 'px'; c.el.style.opacity = Math.abs(rel(c.ang) - W / 2) > W / 2 ? 0 : 1; }
    const tgt = this.questTargetPos();
    if (tgt) {
      const p = this.player.pos;
      const ang = Math.atan2(tgt.x - p.x, tgt.z - p.z) - Math.PI / 2;
      const x = rel(ang + Math.PI / 2 * 0 - 0);
      this._mark.style.left = x + 'px';
      const d = Math.hypot(tgt.x - p.x, tgt.z - p.z);
      this._mark.textContent = `◆ ${Math.round(d)}m`;
    } else this._mark.textContent = '';
  }

  /* ---------- mapa / diário / prólogo ---------- */
  toggleMap(force) {
    const open = force !== undefined ? force : !this.mapOpen;
    this.mapOpen = open;
    if (!this._mapEl) this.buildMapOverlay();
    this._mapEl.style.display = open ? 'flex' : 'none';
    if (open) { document.exitPointerLock?.(); this.drawMapOverlay(); }
    else if (this.started && !this.paused) this.renderer.domElement.requestPointerLock?.();
  }
  buildMapOverlay() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:55;background:rgba(4,5,8,.86);display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px';
    const cv = document.createElement('canvas');
    cv.width = 860; cv.height = 620;
    cv.style.cssText = 'max-width:92vw;max-height:74vh;border:1px solid rgba(201,162,39,.45);border-radius:8px;background:#0d1014;cursor:crosshair';
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:12px;letter-spacing:.16em;color:#9a917f;text-transform:uppercase;text-align:center';
    hint.innerHTML = 'Mapa do Reino de Varenya — clique num santuário aceso para viajar · M para fechar';
    el.appendChild(hint); el.appendChild(cv);
    el.style.flexDirection = 'column';
    el.insertBefore(cv, hint);
    document.body.appendChild(el);
    this._mapEl = el; this._mapCv = cv;
    cv.addEventListener('click', (e) => {
      const r = cv.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * cv.width;
      const y = (e.clientY - r.top) / r.height * cv.height;
      const scale = this._mapScale;
      const wx = (x - cv.width / 2) / scale, wz = (y - cv.height / 2) / scale;
      let best = null, bd = 30;
      for (const s of SHRINES) {
        if (!this.shrinesFound.has(s.name)) continue;
        const d = Math.hypot(s.pos.x - wx, s.pos.z - wz);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) {
        this.toggleMap(false);
        if (this.player.mounted) this.mountObj.dismount();
        this.player.teleport(best.pos.clone().add(new THREE.Vector3(1.5, 0.4, 1.5)));
        this.notify('Viagem rápida: ' + best.name);
        this.world.doors.length && null;
      }
    });
  }
  drawMapOverlay() {
    const cv = this._mapCv, ctx = cv.getContext('2d');
    const scale = Math.min(cv.width, cv.height) / 560;
    this._mapScale = scale;
    ctx.clearRect(0, 0, cv.width, cv.height);
    // fundo: terreno aproximado
    const img = ctx.createImageData(cv.width, cv.height);
    for (let py = 0; py < cv.height; py += 1) {
      for (let px = 0; px < cv.width; px += 1) {
        const wx = (px - cv.width / 2) / scale, wz = (py - cv.height / 2) / scale;
        const h = terrainHeight(wx, wz);
        const i = (py * cv.width + px) * 4;
        let r = 26, g = 34, b = 22;
        if (h < -0.9) { r = 24; g = 44; b = 56; }
        else if (h > 16) { r = 60; g = 62; b = 68; }
        else if (h > 6) { r = 42; g = 44; b = 40; }
        const d = Math.hypot(wx, wz);
        if (d < 46) { r = 54; g = 55; b = 60; }
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const M = (x, z) => [cv.width / 2 + x * scale, cv.height / 2 + z * scale];
    // estradas
    ctx.strokeStyle = 'rgba(120,100,66,.85)'; ctx.lineWidth = 2;
    const roads = [
      [[0, 33], [32, 82], [70, 136], [140, 140], [212, 108]],
      [[70, 136], [22, 126], [-38, 122], [-60, 120]],
      [[-60, 120], [-25, -20], [-24, -130]],
      [[0, 33], [-30, 26], [-40, 22]],
    ];
    for (const r of roads) {
      ctx.beginPath();
      r.forEach((p, i) => { const [x, y] = M(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    // rio
    ctx.strokeStyle = '#24485c'; ctx.lineWidth = 26 * scale * 1.2;
    ctx.beginPath();
    const [rx1, ry1] = M(152, -200), [rx2, ry2] = M(152, 210);
    ctx.moveTo(rx1, ry1); ctx.lineTo(rx2, ry2); ctx.stroke();
    // lugares
    const place = (x, z, name, color, r = 6) => {
      const [mx, my] = M(x, z);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c9c0aa'; ctx.font = '13px "Trebuchet MS",sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(name, mx, my - r - 6);
    };
    ctx.fillStyle = '#4d515c';
    ctx.fillRect(M(-42, -34)[0], M(-42, -34)[1], 84 * scale, 68 * scale);
    ctx.fillStyle = '#c9c0aa'; ctx.font = '14px "Trebuchet MS",sans-serif';
    ctx.fillText('Castelo de Hálvar', cv.width / 2, M(0, -40)[1]);
    place(REALM.village.x, REALM.village.z, 'Vila Cinzalta', '#6a5f45');
    place(REALM.bridge.x, REALM.bridge.z, 'Ponte do Cinza', '#7a6a4a', 5);
    place(REALM.rock.x, REALM.rock.z, 'Rochedo do Dragão', '#43434c', 6);
    place(REALM.ruins.x, REALM.ruins.z, 'Septo Antigo', '#4a4a52', 5);
    place(REALM.forest.x, REALM.forest.z, 'Bosque Antigo', '#2a3620', 8);
    for (const s of SHRINES) {
      const [mx, my] = M(s.pos.x, s.pos.z);
      const known = this.shrinesFound.has(s.name);
      ctx.fillStyle = known ? '#ffb45a' : '#4a453a';
      ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = known ? 'rgba(255,180,90,.5)' : 'rgba(255,255,255,.15)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2); ctx.stroke();
    }
    // jogador
    const [px, py] = M(this.player.pos.x, this.player.pos.z);
    ctx.fillStyle = '#f2e6c8';
    ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 2; ctx.stroke();
    // NPCs próximos
    for (const n of this.npcs) {
      const [mx, my] = M(n.pos.x, n.pos.z);
      ctx.fillStyle = 'rgba(201,162,39,.65)';
      ctx.beginPath(); ctx.arc(mx, my, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  toggleLog() {
    if (!this._logEl) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;right:16px;top:120px;z-index:45;max-width:330px;max-height:60vh;overflow:auto;display:none;background:rgba(10,11,14,.9);border:1px solid rgba(201,162,39,.4);border-radius:8px;padding:14px 16px;font-size:12.5px;line-height:1.6;color:#c6bda9';
      document.body.appendChild(el);
      this._logEl = el;
    }
    const open = this._logEl.style.display !== 'block';
    this._logEl.style.display = open ? 'block' : 'none';
    if (!open) return;
    const clues = [...this.q.clues].map(c => `<div style="margin-bottom:8px;padding-left:10px;border-left:2px solid #7a6a2a">${CLUES[c] || c}</div>`).join('');
    const hist = this.logs.slice(0, 24).map(l => `<div style="color:#8d8578">${l.t} — ${l.text}</div>`).join('');
    this._logEl.innerHTML = `
      <div style="letter-spacing:.2em;color:#e6cd7a;text-transform:uppercase;font-size:11px;margin-bottom:10px">Registro do Reino</div>
      <div style="font-size:11px;color:#8d8578;margin-bottom:6px">Título: ${this.q.title()} · Quartos: ${this.q.rooms.size} · Pistas: ${this.q.clues.size} · Falou com: ${this.q.seen.size}</div>
      <div style="height:1px;background:rgba(201,162,39,.3);margin:10px 0"></div>
      <div style="letter-spacing:.18em;color:#c9a227;font-size:10.5px;margin-bottom:8px">DIÁRIO</div>
      ${clues || '<div style="color:#6f6858">Nada anotado ainda. Fale com gente, leia pedras.</div>'}
      <div style="letter-spacing:.18em;color:#c9a227;font-size:10.5px;margin:12px 0 8px">HISTÓRICO</div>
      ${hist || '<div style="color:#6f6858">—</div>'}
    `;
  }
  showPrologue() {
    if (!this._prol) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(3,4,7,.92);display:none;align-items:center;justify-content:center;padding:24px';
      el.innerHTML = `
        <div style="max-width:820px;background:rgba(10,11,14,.94);border:1px solid rgba(201,162,39,.4);border-radius:10px;padding:30px 34px;line-height:1.75;color:#d6cdba;font-size:15px">
          <div style="font-size:26px;letter-spacing:.2em;color:#e6cd7a;text-transform:uppercase;text-align:center">Prólogo</div>
          <div style="font-size:11px;letter-spacing:.4em;color:#8d8578;text-transform:uppercase;text-align:center;margin:6px 0 20px">Reino de Varenya, 20 anos depois da guerra</div>
          <p>O Rei <b>Aldric II</b> não sai da cama há dois meses. A <b>Rainha Isolde</b> governa no lugar dele, com um Mestre magro sussurrando nos seus ouvidos e um copeiro de mãos trêmulas.</p>
          <p style="margin-top:12px">Três pagens desapareceram. Na cozinha, a fornalha chora como criança desde a lua nova. E na cripta, o vigésimo rei de pedra abre a mão todas as noites para receber algo que ninguém vê.</p>
          <p style="margin-top:12px">Você é o escudeiro novo, sem linhagem e sem senhor. Tem três andares, dez quartos, vinte e oito vivos — e um corcel preto na estrebaria que pertenceu a um príncipe morto.</p>
          <p style="margin-top:16px;color:#e6cd7a">Explore. Escute. E se alguém de luva passar por você no corredor, olhe para os pés.</p>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:24px">
            <button class="big" id="prolClose">Começar a Crônica</button>
          </div>
        </div>`;
      document.body.appendChild(el);
      this._prol = el;
      el.querySelector('#prolClose').onclick = () => {
        el.style.display = 'none';
        if (this.started && !this.paused) this.renderer.domElement.requestPointerLock?.();
      };
    }
    this._prol.style.display = 'flex';
    document.exitPointerLock?.();
  }
  togglePause(force) {
    const open = force !== undefined ? force : !this.paused;
    this.paused = open;
    document.getElementById('pause').classList.toggle('on', open);
    if (open) document.exitPointerLock?.();
    else if (this.started) this.renderer.domElement.requestPointerLock?.();
  }
  onChronicleComplete() {
    if (this.epilogueShown) return;
    this.epilogueShown = true;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(2,3,6,.94);display:flex;align-items:center;justify-content:center;padding:26px';
    el.innerHTML = `
      <div style="max-width:880px;max-height:92vh;overflow:auto;background:rgba(10,11,14,.96);border:1px solid rgba(201,162,39,.45);border-radius:10px;padding:32px 36px;line-height:1.75;color:#d6cdba;font-size:15px">
        <div style="font-size:30px;letter-spacing:.22em;color:#e6cd7a;text-transform:uppercase;text-align:center">Epílogo</div>
        <div style="font-size:11px;letter-spacing:.4em;color:#8d8578;text-transform:uppercase;text-align:center;margin:6px 0 22px">A Crônica de Varenya</div>
        <p>Você subiu os doze degraus e sentou-se no <b>Trono de Obsidiana</b>. A pedra estava quente.</p>
        <p style="margin-top:12px">Do lado de fora, o reino continua: a ponte do Cinza ainda engole barris marcados como sal, o bosque ainda uiva a Coisa Magra, e o rochedo dorme sobre um dragão que aprendeu a esperar.</p>
        <p style="margin-top:12px">Dizem que, naquela noite, alguém de luva de couro atravessou o pátio sem deixar pegadas — e o corcel preto de um príncipe morto relinchou pela primeira vez em vinte anos.</p>
        <p style="margin-top:16px;color:#e6cd7a">Varenya conhece o teu nome agora. O Ferro Negro, não.</p>
        <div style="margin-top:22px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;color:#b9ae95">
          <div>Lugares descobertos: <b>${this.q.rooms.size}</b></div>
          <div>Pistas no diário: <b>${this.q.clues.size}</b></div>
          <div>Conversas registradas: <b>${this.q.seen.size}</b></div>
          <div>Título final: <b>${this.q.title()}</b></div>
        </div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:26px">
          <button class="big" id="epiClose">Continuar vagando pelo reino</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#epiClose').onclick = () => {
      el.remove();
      if (this.started) this.renderer.domElement.requestPointerLock?.();
    };
    document.exitPointerLock?.();
    this.notify('A Crônica está completa. O reino é teu — ou o que restar dele.');
  }
}

/* =====================================================================
 *  alvos especiais (baú do Ferro Negro, trono, estátua da mão aberta…)
 * ===================================================================== */
export function buildSpecialTargets(game) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  return [
    {
      id: 'chest_iron', label: 'Baú de obsidiana (selado com cera preta)', pos: V(-3.4, 8.4, 6.2), range: 3,
      act: (g) => {
        if (g.q.items.has('ferro')) { g.notify('O baú está vazio. Você já levou o que havia dentro.'); return; }
        g.q.give('ferro');
        g.q.clue('iron');
        g.notify('Dentro do baú: uma espada que não reflete a tocha. O Ferro Negro.');
        g.say(g.npcs.find(n => n.id === 'ysolda') || { say: () => {} }, 'Então você abriu. Agora ela sabe onde você dorme.');
      },
    },
    {
      id: 'throne', label: 'Trono de Obsidiana', pos: V(0, 8.6, -9.8), range: 3,
      act: (g) => {
        g.q.mark('sat_throne');
        g.notify('Você se senta no Trono de Obsidiana. A pedra está quente — e alguém respira atrás do encosto.');
        g.player.health = Math.min(100, g.player.health + 25);
        g.q.gold += 5;
        // pose sentada por um instante
        g.player.pos.set(0, FLOOR.second + 3.0, -10.8);
        g.player.yaw = Math.PI;
        g.player.rig.root.position.copy(g.player.pos);
        g.player.rig.root.rotation.y = Math.PI;
        animate(g.player.rig, 'sitThrone', 0.016);
      },
    },
    {
      id: 'crypt_hand', label: 'O rei de mão aberta', pos: V(8.4, -3.4, -15.4), range: 3.2,
      act: (g) => {
        g.q.clue('crypt_hand');
        g.notify('A palma de pedra está quente, como se tivesse segurado uma moeda até agora.');
        g.q.gold += 2;
      },
    },
    {
      id: 'oven', label: 'Fornalha da cozinha', pos: V(-12.6, 0.8, 4.4), range: 3,
      act: (g) => {
        g.q.clue('oven');
        g.notify('Você encosta o ouvido no metal: um choro fino, de criança, vem de dentro da cinza.');
      },
    },
    {
      id: 'well_gate', label: 'Poço do pátio', pos: V(-10, 0.8, 17), range: 3,
      act: (g) => {
        g.notify('Você puxa o balde: a água está salgada. Salgada, no meio do continente.');
        g.q.clue('salt');
      },
    },
    {
      id: 'dragon_altar', label: 'Altar na boca do dragão', pos: V(213, 6.4, 116), range: 4,
      act: (g) => {
        g.q.clue('rock');
        g.notify('O altar está coberto de coral moído e cera preta. Alguém reza aqui — e não é o septon.');
        g.q.gold += 3;
      },
    },
    {
      id: 'stone_circle', label: 'Pedra do círculo antigo', pos: V(-70, 2.4, 120), range: 4,
      act: (g) => {
        g.q.clue('beast');
        g.notify('A pedra vibra como um sino abafado. Anciã Brega diz que a pedra ouve juramentos.');
        g.q.bless();
      },
    },
  ];
}
void MAT_WATER; void MAT_GLOW; void MAT_GLOW_FOG; void C;
