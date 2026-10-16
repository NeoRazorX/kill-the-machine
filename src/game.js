import * as THREE from 'three';
import { N, CELL, SIZE, PLAYER, DEFS, ROLE, DIFFICULTY, BUILD_RADIUS, START_CREDITS, HARVEST_QUEUE, DOCK_QUEUE, DOCK_BOUND, other, visionRadius, canRepairBuilding } from './config.js';
import { GameMap, MapVisuals } from './map.js';
import { THEMES } from './themes.js';
import { Foundations } from './foundations.js';
import { Unit } from './units.js';
import { Building } from './buildings.js';
import { FX } from './fx.js';
import { GameAudio } from './audio.js';
import { AI } from './ai.js';
import { CashCrates, CASH_CRATE_RADIUS } from './cash-crates.js';
import { TechSites } from './tech-sites.js';
import { Superweapons } from './superweapons.js';
import { nearestFreeCell, canOccupy } from './pathfinding.js';

const HASH = 8, HN = SIZE / HASH;
const newTeam = () => ({
  credits: START_CREDITS, income: 1, structQueue: null,
  stats: { killed: 0, lost: 0, built: 0, earned: 0 },
  power: { prod: 0, use: 0 }, lastAttacked: null, lowPowerFlag: false,
});

export function rectDist(px, pz, r) {
  const dx = Math.max(r.x0 - px, 0, px - r.x1), dz = Math.max(r.z0 - pz, 0, pz - r.z1);
  return Math.hypot(dx, dz);
}

export class Game {
  constructor(scene, seed, theme = THEMES.temperate) {
    this.scene = scene;
    this.player = PLAYER; this.spectate = false;
    this.time = 0; this.navVersion = 1;
    this.map = new GameMap(seed);
    this.foundations = new Foundations(this);
    this.setTheme(theme);
    this.units = []; this.buildings = [];
    this.teams = { human: newTeam(), machine: newTeam() };
    this.fx = new FX(this, scene);
    this.audio = new GameAudio(this);
    this.ais = [];
    this.buckets = Array.from({ length: HN * HN }, () => []);
    this._q = [];
    this.over = null; this.paused = false;
    this.camTarget = { x: SIZE / 2, z: SIZE / 2 };
    this.onEvent = null;
    this.lastAlert = -99; this.oreT = 0;
    this.fog = new Uint8Array(N * N); this.fogT = 0;
    this.initFog();
    this.cashCrates = new CashCrates(this);
    this.techSites = new TechSites(this);
    this.superweapons = new Superweapons(this);
  }

  // Themes only change the look of the map, so they can be swapped from the menu before starting.
  setTheme(theme) {
    if (this.theme === theme) return;
    this.visuals?.dispose();
    this.theme = theme;
    this.map.name = theme.name;
    this.visuals = new MapVisuals(this.map, this.scene, theme, this.foundations.mask);
  }

  emit(type, data) { if (this.onEvent) this.onEvent(type, data); }

  // ------------------------------------------------------------------ inicio
  // slots: corner index per team; by default two different corners are drawn at random.
  // tech: the tech structure ids to place (see techSelection); null draws them at random.
  start(difficulty = 'normal', spectate = false, slots = null, tech = null) {
    this.spectate = spectate;
    this.difficulty = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.teams.machine.income = this.difficulty.income;
    this.assignStarts(slots);
    this.techSites.choice = tech;
    // The sites depend on which corners are in play: they sit at the same walking distance from both.
    this.techSites.place();
    for (const team of ['human', 'machine']) this.setupBase(team);
    this.ais.push(new AI(this, 'machine', this.difficulty));
    if (spectate) this.ais.push(new AI(this, 'human', DIFFICULTY.normal));
    this.recomputePower();
    this.updateFog(true);
    this.cashCrates.discover();
    this.cashCrates.update();
    this.techSites.discover();
  }

  assignStarts(slots = null) {
    if (!slots) {
      const n = this.map.spawns.length, human = Math.floor(Math.random() * n);
      slots = { human, machine: (human + 1 + Math.floor(Math.random() * (n - 1))) % n };
    }
    this.startSlots = slots;
    this.starts = { human: this.map.spawns[slots.human], machine: this.map.spawns[slots.machine] };
  }

  setupBase(team) {
    const [sx, sz] = this.starts[team];
    // Refinery towards the centre of the map, whichever corner the base is in.
    const side = sx < N / 2 ? 1 : -1;
    // Two-cell walkways either side of the HQ, whatever its width.
    const layout = [['hq', 0, 0], ['power', -5, 1], ['refinery', ROLE[team].hq.w + 2, -1]];
    for (const [role, dx, dz] of layout) {
      const def = ROLE[team][role];
      const cx = side > 0 ? sx - 1 + dx : sx + 2 - dx - def.w;
      this.placeBuilding(team, def.id, cx, sz - 1 + dz, true);
    }
    // unidades iniciales, en el lado de la base que mira al centro
    const f = sz < N / 2 ? 1 : -1;
    const bx = sx * CELL, bz = sz * CELL;
    const light = ROLE[team].inf1, tank = ROLE[team].tank, harv = ROLE[team].harv;
    for (let i = 0; i < 4; i++) this.spawnUnit(light, team, bx + (i - 1.5) * 2.4, bz + f * 10);
    for (let i = 0; i < 2; i++) this.spawnUnit(tank, team, bx + (i - 0.5) * 4.5, bz + f * 15);
    this.spawnUnit(harv, team, bx - 4, bz - f * 9);
  }

  // ----------------------------------------------------------------- niebla
  initFog() {
    this.fogData = new Uint8Array(N * N * 4);
    this.fogTex = new THREE.DataTexture(this.fogData, N, N, THREE.RGBAFormat);
    this.fogTex.magFilter = THREE.LinearFilter; this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.generateMipmaps = false; this.fogTex.needsUpdate = true;
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.fogCanvas.height = N;
    this.fogCtx = this.fogCanvas.getContext('2d');
    this.fogImg = this.fogCtx.createImageData(N, N);
  }

  updateFog(force = false) {
    const fog = this.fog;
    for (let i = 0; i < fog.length; i++) if (fog[i] === 2) fog[i] = 1;
    if (this.spectate) fog.fill(2);
    else {
      const mark = (e, sight) => {
        const rc = sight / CELL, cx = e.x / CELL, cz = e.z / CELL;
        const x0 = Math.max(0, Math.floor(cx - rc)), x1 = Math.min(N - 1, Math.ceil(cx + rc));
        const z0 = Math.max(0, Math.floor(cz - rc)), z1 = Math.min(N - 1, Math.ceil(cz + rc));
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
          if (dx * dx + dz * dz <= rc * rc) fog[z * N + x] = 2;
        }
      };
      for (const u of this.units) if (u.team === this.player && !u.dead) mark(u, u.def.sight);
      for (const b of this.buildings) if (b.team === this.player && !b.dead) mark(b, visionRadius(b));
    }
    const d = this.fogData, img = this.fogImg.data;
    if (!this.fogA) { this.fogA = new Float32Array(N * N); this.fogB = new Float32Array(N * N); }
    const A = this.fogA, Bf = this.fogB;
    for (let i = 0; i < N * N; i++) A[i] = fog[i] === 2 ? 0 : fog[i] === 1 ? 125 : 255;
    for (let pass = 0; pass < 2; pass++) {
      for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
        let sum = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, z = cz + dz;
          if (x < 0 || z < 0 || x >= N || z >= N) continue;
          sum += A[z * N + x]; n++;
        }
        Bf[cz * N + cx] = sum / n;
      }
      A.set(Bf);
    }
    for (let cz = 0; cz < N; cz++) {
      for (let cx = 0; cx < N; cx++) {
        const a = Math.round(A[cz * N + cx]);
        const o = ((N - 1 - cz) * N + cx) * 4;
        d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = a;
        const m = (cz * N + cx) * 4;
        img[m] = 0; img[m + 1] = 0; img[m + 2] = 0; img[m + 3] = a;
      }
    }
    this.fogTex.needsUpdate = true;
    this.fogCtx.putImageData(this.fogImg, 0, 0);
  }

  visibleAt(x, z) {
    if (this.spectate) return true;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) return false;
    return this.fog[cz * N + cx] === 2;
  }

  isVisibleEntity(e) {
    if (this.spectate || e.team === this.player) return true;
    if (e.kind === 'building') return e.seen || this.visibleAt(e.x, e.z) || this.visibleAt(e.rect.x0 + 1, e.rect.z0 + 1) || this.visibleAt(e.rect.x1 - 1, e.rect.z1 - 1);
    return this.visibleAt(e.x, e.z);
  }

  // --------------------------------------------------------------- consultas
  rebuildHash() {
    for (const b of this.buckets) b.length = 0;
    for (const u of this.units) {
      if (u.dead) continue;
      const cx = Math.min(HN - 1, Math.max(0, Math.floor(u.x / HASH))), cz = Math.min(HN - 1, Math.max(0, Math.floor(u.z / HASH)));
      this.buckets[cz * HN + cx].push(u);
    }
  }

  queryUnits(x, z, r) {
    const q = this._q; q.length = 0;
    const x0 = Math.max(0, Math.floor((x - r) / HASH)), x1 = Math.min(HN - 1, Math.floor((x + r) / HASH));
    const z0 = Math.max(0, Math.floor((z - r) / HASH)), z1 = Math.min(HN - 1, Math.floor((z + r) / HASH));
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const b = this.buckets[cz * HN + cx];
      for (let i = 0; i < b.length; i++) q.push(b[i]);
    }
    return q;
  }

  distTo(a, t) {
    if (t.kind === 'building') return rectDist(a.x, a.z, t.rect);
    return Math.hypot(t.x - a.x, t.z - a.z) - t.radius;
  }

  findTarget(att, range) {
    const enemy = other(att.team), fogged = !this.spectate && att.team === this.player;
    let best = null, bestS = 1e9;
    const q = this.queryUnits(att.x, att.z, range + 2.5);
    for (let i = 0; i < q.length; i++) {
      const u = q[i];
      if (u.team !== enemy || u.dead) continue;
      const d = Math.hypot(u.x - att.x, u.z - att.z) - u.radius;
      if (d > range) continue;
      if (fogged && !this.visibleAt(u.x, u.z)) continue;
      const s = d + (u.def.weapon ? 0 : 5);
      if (s < bestS) { bestS = s; best = u; }
    }
    for (const b of this.buildings) {
      if (b.team !== enemy || b.dead || b.selling) continue;
      const d = rectDist(att.x, att.z, b.rect);
      if (d > range) continue;
      if (fogged && !this.isVisibleEntity(b)) continue;
      const s = d + 4 + (b.def.weapon ? -6 : 0);
      if (s < bestS) { bestS = s; best = b; }
    }
    return best;
  }

  canStand(x, z, r) {
    return canOccupy(this.map.grid, x, z, r);
  }

  nearestField(x, z) {
    let best = null, bd = 1e9;
    for (const f of this.map.fields) {
      if (f.amount < 40) continue;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  nearestRefinery(team, x, z) {
    let best = null, bd = 1e9;
    for (const b of this.buildings) {
      if (b.team !== team || b.dead || b.def.role !== 'refinery' || !b.complete) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // Like C&C, a harvester prefers a free refinery over a busy one, as long as it is not much farther:
  // every harvester already heading to, waiting at or unloading in a refinery adds HARVEST_QUEUE.busyCost.
  pickRefinery(u) {
    let best = null, bs = 1e9;
    for (const b of this.buildings) {
      if (b.team !== u.team || b.dead || b.def.role !== 'refinery' || !b.complete) continue;
      let busy = 0;
      for (const o of this.units) {
        if (o !== u && !o.dead && o.refinery === b && o.order.type === 'harvest' && DOCK_BOUND.has(o.hstate)) busy++;
      }
      const s = Math.hypot(b.dock.x - u.x, b.dock.z - u.z) + busy * HARVEST_QUEUE.busyCost;
      if (s < bs) { bs = s; best = b; }
    }
    return best;
  }

  // Harvesters waiting for or holding a refinery's dock, oldest first. The first one owns the dock;
  // anyone who died, got another order, gave up or lost the refinery drops out here.
  dockQueue(r) {
    const q = r.dockQueue || (r.dockQueue = []);
    for (let i = q.length - 1; i >= 0; i--) {
      const u = q[i];
      if (r.dead || r.selling || u.dead || u.refinery !== r || u.order.type !== 'harvest' || !DOCK_QUEUE.has(u.hstate)) q.splice(i, 1);
    }
    return q;
  }

  // Parking spots beside and ahead of the dock, nearest first, clear of the dock's own approach.
  dockWaitSpots(r, radius) {
    if (r.waitSpots && r.waitSpotsVer === this.navVersion) return r.waitSpots;
    const d = r.dock, f = r.front || 1, spots = [];
    const { side, ahead, gap } = HARVEST_QUEUE;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) for (const s of [-1, 1]) {
      const x = d.x + s * (side + col * gap), z = d.z + f * (ahead + row * gap);
      if (this.canStand(x, z, radius + 0.4)) spots.push({ x, z });
    }
    spots.sort((a, b) => Math.hypot(a.x - d.x, a.z - d.z) - Math.hypot(b.x - d.x, b.z - d.z));
    r.waitSpots = spots; r.waitSpotsVer = this.navVersion;
    return spots;
  }

  teamBuildings(team, role = null) {
    return this.buildings.filter((b) => b.team === team && !b.dead && !b.selling && (!role || b.def.role === role));
  }
  teamUnits(team) { return this.units.filter((u) => u.team === team && !u.dead); }
  hasRole(team, role) { return this.buildings.some((b) => b.team === team && !b.dead && b.complete && b.def.role === role); }

  // --------------------------------------------------------------- economía
  addCredits(team, amt) {
    const t = this.teams[team];
    t.credits += amt * t.income;
    t.stats.earned += amt * t.income;
  }

  recomputePower() {
    for (const k of ['human', 'machine']) {
      let prod = 0, use = 0;
      for (const b of this.buildings) {
        if (b.team !== k || b.dead || !b.complete) continue;
        // Tech structures only draw power once repaired.
        if (b.tech && b.tech.state !== 'online') continue;
        if (b.def.power > 0) prod += b.def.power; else use -= b.def.power;
      }
      const t = this.teams[k];
      t.power.prod = prod; t.power.use = use;
      const low = use > prod;
      if (low && !t.lowPowerFlag && k === this.player && !this.spectate) { this.audio.say('Energía baja', 6000); this.emit('toast', { text: '⚠ Energía baja: producción ralentizada y defensas apagadas', kind: 'warn' }); }
      t.lowPowerFlag = low;
    }
  }
  lowPower(team) { const p = this.teams[team].power; return p.use > p.prod; }

  // A tech factory only produces once it has been repaired.
  canProduceAt(b) { return !b.dead && b.complete && !!b.def.produces && (!b.tech || b.tech.state === 'online'); }
  producers(team, producer) { return this.buildings.filter((b) => b.team === team && b.def.produces === producer && this.canProduceAt(b)); }

  requirementsMet(team, def) {
    if (def.kind === 'unit') return this.producers(team, def.producer).length > 0;
    return (def.requires || []).every((r) => this.hasRole(team, r));
  }

  // -- estructuras
  startStruct(team, defId) {
    const t = this.teams[team], def = DEFS[defId];
    if (t.structQueue || !def.buildable || !this.requirementsMet(team, def)) return false;
    t.structQueue = { def, progress: 0, paid: 0, ready: false, waiting: false };
    return true;
  }
  cancelStruct(team) {
    const t = this.teams[team], q = t.structQueue;
    if (!q) return;
    t.credits += q.paid; t.structQueue = null;
  }
  updateStructQueue(team, dt) {
    const t = this.teams[team], q = t.structQueue;
    if (!q || q.ready) return;
    const inc = Math.min(dt / q.def.time * (this.lowPower(team) ? 0.4 : 1), 1 - q.progress);
    const cost = q.def.cost * inc;
    if (t.credits >= cost) { t.credits -= cost; q.progress += inc; q.paid += cost; q.waiting = false; } else q.waiting = true;
    if (q.progress >= 0.9999) {
      q.ready = true; q.progress = 1;
      if (team === this.player && !this.spectate) { this.audio.play('ready'); this.audio.say('Construcción completa', 2500); this.emit('toast', { text: `${q.def.name} lista para colocar`, kind: 'good' }); }
    }
  }
  placeStruct(team, cx, cz) {
    const t = this.teams[team], q = t.structQueue;
    if (!q || !q.ready || !this.canPlace(team, q.def, cx, cz)) return null;
    const b = this.placeBuilding(team, q.def.id, cx, cz);
    t.structQueue = null;
    if (team === this.player) this.audio.play('place', b.x, b.z);
    return b;
  }

  // -- unidades
  queueUnit(team, defId) {
    const def = DEFS[defId];
    const cands = this.producers(team, def.producer);
    if (!cands.length) return false;
    cands.sort((a, b) => a.queue.length - b.queue.length);
    if (cands[0].queue.length >= 6) return false;
    cands[0].queue.push({ def, progress: 0, paid: 0, waiting: false });
    return true;
  }
  cancelUnit(team, defId) {
    let best = null;
    for (const b of this.buildings) {
      if (b.team !== team || b.dead) continue;
      for (let i = b.queue.length - 1; i >= 0; i--) {
        if (b.queue[i].def.id === defId && (!best || b.queue.length > best.b.queue.length)) { best = { b, i }; break; }
      }
    }
    if (!best) return false;
    const [it] = best.b.queue.splice(best.i, 1);
    this.teams[team].credits += it.paid;
    return true;
  }
  queuedCount(team, defId) {
    let n = 0;
    for (const b of this.buildings) if (b.team === team && !b.dead) for (const it of b.queue) if (it.def.id === defId) n++;
    return n;
  }
  queueProgress(team, defId) {
    let p = -1, waiting = false;
    for (const b of this.buildings) {
      if (b.team !== team || b.dead) continue;
      const it = b.queue[0];
      if (it && it.def.id === defId && it.progress > p) { p = it.progress; waiting = it.waiting; }
    }
    return { progress: p, waiting };
  }

  spawnProduced(b, def) {
    const spot = this.findSpawnSpot(b, def.radius);
    const u = this.spawnUnit(def, b.team, spot.x, spot.z);
    if (def.harvester) u.cmdHarvest(null);
    else {
      const r = b.rally || { x: spot.x + (Math.random() - 0.5) * 6, z: spot.z + b.front * (7 + Math.random() * 3) };
      u.cmdMove(r.x, r.z);
    }
    if (b.team === this.player && !this.spectate) {
      this.audio.play('ready');
      this.audio.say(def.harvester ? 'Cosechadora lista' : 'Unidad lista', 3000);
    }
    return u;
  }

  findSpawnSpot(b, r) {
    const base = b.spawnPt;
    for (let k = 0; k < 9; k++) {
      const n = k === 0 ? 1 : k * 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + k;
        const x = base.x + Math.cos(a) * k * 1.8, z = base.z + Math.sin(a) * k * 1.8;
        if (!this.canStand(x, z, r)) continue;
        const near = this.queryUnits(x, z, r + 2);
        if (near.every((o) => Math.hypot(o.x - x, o.z - z) > r + o.radius)) return { x, z };
      }
    }
    return { x: base.x, z: base.z };
  }

  spawnUnit(def, team, x, z) {
    const u = new Unit(this, def, x, z, team);
    this.units.push(u);
    return u;
  }

  // ------------------------------------------------------------- edificios
  setCells(b, v) {
    for (let z = b.cz; z < b.cz + b.h; z++) for (let x = b.cx; x < b.cx + b.w; x++) this.map.grid[z * N + x] = v;
  }

  canPlace(team, def, cx, cz, margin = false) {
    if (cx < 1 || cz < 1 || cx + def.w > N - 1 || cz + def.h > N - 1) return false;
    const g = this.map.grid;
    for (let z = cz; z < cz + def.h; z++) for (let x = cx; x < cx + def.w; x++) if (g[z * N + x] !== 0) return false;
    const r = { x0: cx * CELL, z0: cz * CELL, x1: (cx + def.w) * CELL, z1: (cz + def.h) * CELL };
    for (const crate of this.cashCrates?.items ?? []) {
      if (!crate.collected && rectDist(crate.x, crate.z, r) < CASH_CRATE_RADIUS) return false;
    }
    for (const f of this.map.fields) if (rectDist(f.x, f.z, r) < f.r * 0.85) return false;
    // Keep a walkway around tech structures so an engineer can always reach them.
    for (const b of this.techSites?.items ?? []) {
      const dx = Math.max(0, r.x0 - b.rect.x1, b.rect.x0 - r.x1), dz = Math.max(0, r.z0 - b.rect.z1, b.rect.z0 - r.z1);
      if (Math.max(dx, dz) < 2 * CELL) return false;
    }
    // Nothing may cover a refinery's unloading apron, or its harvesters could never deliver.
    for (const b of this.buildings) {
      if (b.dead || b.def.role !== 'refinery') continue;
      const d = b.dock;
      if (r.x0 < Math.max(b.rect.x1, d.x + 3) && r.x1 > Math.min(b.rect.x0, d.x - 3) &&
          r.z0 < Math.max(b.z, d.z + 3) && r.z1 > Math.min(b.z, d.z - 3)) return false;
    }
    if (margin) {
      for (let z = cz - 1; z <= cz + def.h; z++) for (let x = cx - 1; x <= cx + def.w; x++) {
        if (x >= 0 && z >= 0 && x < N && z < N && g[z * N + x] === 2) return false;
      }
    }
    for (const b of this.buildings) {
      if (b.team !== team || b.dead || b.selling || b.def.tech) continue;
      const dx = Math.max(0, r.x0 - b.rect.x1, b.rect.x0 - r.x1), dz = Math.max(0, r.z0 - b.rect.z1, b.rect.z0 - r.z1);
      if (Math.hypot(dx, dz) <= BUILD_RADIUS) return true;
    }
    return false;
  }

  placeBuilding(team, defId, cx, cz, instant = false) {
    const def = DEFS[defId];
    const b = new Building(this, def, team, cx, cz, instant);
    this.buildings.push(b);
    this.foundations?.add(b);
    this.setCells(b, 2);
    this.navVersion++;
    this.displaceUnits(b);
    if (team) this.teams[team].stats.built++;
    if (instant) { b.announced = true; this.onBuildingComplete(b); }
    this.recomputePower();
    return b;
  }

  onBuildingComplete(b) {
    this.recomputePower();
    if (b.def.role === 'refinery') {
      const spot = this.findSpawnSpot(b, 1.6);
      const u = this.spawnUnit(ROLE[b.team].harv, b.team, spot.x, spot.z);
      u.cmdHarvest(null);
    }
  }

  displaceUnits(b) {
    const g = this.map.grid;
    for (const u of this.units) {
      if (u.dead || u.x < b.rect.x0 - u.radius || u.x > b.rect.x1 + u.radius || u.z < b.rect.z0 - u.radius || u.z > b.rect.z1 + u.radius) continue;
      const c = nearestFreeCell(g, u.x, u.z, 10, u.radius);
      if (c < 0) continue;
      let nx = ((c % N) + 0.5) * CELL, nz = (((c / N) | 0) + 0.5) * CELL;
      // alejar del borde del edificio lo suficiente para el radio de la unidad
      const dx = nx - b.x, dz = nz - b.z, d = Math.hypot(dx, dz) || 1;
      if (!this.canStand(nx, nz, u.radius)) { nx += (dx / d) * u.radius; nz += (dz / d) * u.radius; }
      u.x = nx; u.z = nz;
    }
  }

  // Switches a structure's repair on or off. Turning it on needs a damaged, finished, owned building.
  setBuildingRepair(b, on) {
    if (!on) { const was = b.repairing; b.repairing = b.repairWaiting = false; return was; }
    if (b.repairing || !canRepairBuilding(b)) return false;
    b.repairing = true; b.repairWaiting = false;
    return true;
  }

  sellBuilding(b) {
    if (b.dead || b.selling || b.def.role === 'hq' || b.def.tech || !b.complete) return false;
    this.teams[b.team].credits += b.def.cost * 0.5;
    for (const it of b.queue) this.teams[b.team].credits += it.paid;
    b.sell();
    if (b.team === this.player) this.audio.play('sell');
    return true;
  }

  // An engineer that enters a structure leaves the map without counting as a loss.
  consumeUnit(u) {
    if (u.dead) return;
    u.dead = true;
    this.scene.remove(u.mesh);
  }

  removeBuilding(b, reason) {
    if (b.dead) return;
    b.dead = true;
    this.setCells(b, 0);
    this.foundations?.remove(b, reason);
    this.navVersion++;
    this.scene.remove(b.mesh);
    this.recomputePower();
    this.checkVictory();
  }

  // ----------------------------------------------------------------- combate
  damage(target, amount, srcTeam, srcPos, source = null) {
    // Ruins belong to nobody and cannot be damaged.
    if (target.dead || amount <= 0 || !target.team) return;
    target.hp -= amount; target.lastHit = this.time;
    const tt = this.teams[target.team];
    tt.lastAttacked = { x: target.x, z: target.z, t: this.time, src: srcPos || null };
    if (target.team === this.player && !this.spectate && this.time - this.lastAlert > 9) {
      this.lastAlert = this.time;
      this.audio.play('alert'); this.audio.say('Estamos bajo ataque', 5000);
      this.emit('alert', { x: target.x, z: target.z });
    }
    if (target.hp <= 0) this.kill(target, srcTeam, source);
  }

  kill(e, byTeam, source = null) {
    if (e.dead) return;
    e.hp = 0;
    this.teams[e.team].stats.lost++;
    if (byTeam && this.teams[byTeam]) this.teams[byTeam].stats.killed++;
    if (source?.team === byTeam) source.recordKill?.(e);
    if (e.kind === 'unit') {
      e.dead = true;
      this.scene.remove(e.mesh);
      const big = e.radius > 1.1;
      this.fx.explosion(e.x, 0.6, e.z, big ? 2.4 : 1.2);
      if (big) this.fx.scorch(e.x, e.z, 1.8, 0.4);
      this.audio.play('explosion', e.x, e.z);
      if (e.def.harvester && e.team === this.player && !this.spectate) { this.audio.say('Cosechadora perdida', 5000); this.emit('toast', { text: 'Cosechadora destruida', kind: 'warn' }); }
    } else if (e.def.tech) {
      this.techSites.wreck(e);
    } else {
      this.fx.bigExplosion(e.x, e.z, e.w * CELL, e.h * CELL, e.def.height);
      this.audio.play('bigexplosion', e.x, e.z);
      this.removeBuilding(e, 'destroyed');
      if (e.team === this.player && !this.spectate) this.emit('toast', { text: `${e.def.name} destruido`, kind: 'warn' });
    }
  }

  impact(p) {
    const w = p.weapon, t = p.target, enemy = other(p.team);
    const multFor = (e) => (w.mult[e.cls] ?? 1);
    const src = { x: p.x, z: p.z };
    if (p.splash > 0) {
      this.fx.explosion(p.x, Math.max(0.3, p.y * 0.5), p.z, 0.7 + p.splash * 0.45);
      this.audio.play('explosion', p.x, p.z);
      const R = p.splash;
      const q = this.queryUnits(p.x, p.z, R + 2).slice();
      for (const u of q) {
        if (u.team !== enemy || u.dead) continue;
        const d = Math.max(0, Math.hypot(u.x - p.x, u.z - p.z) - u.radius);
        if (d > R) continue;
        this.damage(u, p.dmg * multFor(u) * (1 - 0.6 * d / R), p.team, src, p.source);
      }
      for (const b of this.buildings.slice()) {
        if (b.team !== enemy || b.dead || b.selling) continue;
        const d = rectDist(p.x, p.z, b.rect);
        if (d > R) continue;
        this.damage(b, p.dmg * multFor(b) * (1 - 0.6 * d / R), p.team, src, p.source);
      }
    } else {
      this.fx.hitSpark(p.x, p.y, p.z, p.type === 'laserbolt' || p.type === 'beam');
      // A captured structure may have changed hands while the shot was in flight.
      if (t && !t.dead && t.team === enemy) this.damage(t, p.dmg * multFor(t), p.team, src, p.source);
    }
  }

  checkVictory() {
    if (this.over) return;
    for (const team of ['human', 'machine']) {
      // Tech structures do not keep a defeated side in the game.
      if (!this.buildings.some((b) => b.team === team && !b.dead && !b.selling && !b.def.tech)) {
        this.over = { winner: other(team), loser: team, time: this.time };
        this.emit('over', this.over);
        return;
      }
    }
  }

  // ------------------------------------------------------------------- ciclo
  update(dt) {
    if (this.paused) return;
    this.time += dt;
    this.rebuildHash();
    for (const u of this.units) if (!u.dead) u.update(dt);
    for (const b of this.buildings) if (!b.dead) b.update(dt);
    // edificios que acaban de completarse
    for (const b of this.buildings) {
      if (!b.dead && b.buildT >= 1 && !b.announced) { b.announced = true; if (!b.selling) this.onBuildingComplete(b); }
    }
    this.fx.update(dt);
    for (const t of ['human', 'machine']) this.updateStructQueue(t, dt);
    for (const ai of this.ais) ai.update(dt);

    this.fogT -= dt;
    if (this.fogT <= 0) { this.fogT = 0.18; this.updateFog(); this.cashCrates.discover(); this.techSites.discover(); this.foundations?.update(); }
    this.cashCrates.update();
    this.techSites.update(dt);
    this.superweapons?.update(dt);

    this.oreT += dt;
    if (this.oreT >= 1) {
      for (const f of this.map.fields) if (f.amount < f.max) f.amount = Math.min(f.max, f.amount + 2.5 * this.oreT);
      this.oreT = 0;
      this.visuals.updateOre();
    }
    if (this.units.some((u) => u.dead)) this.units = this.units.filter((u) => !u.dead);
    if (this.buildings.some((b) => b.dead)) this.buildings = this.buildings.filter((b) => !b.dead);
  }
}
