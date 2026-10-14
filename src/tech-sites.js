import { N, CELL, TEAMS, TECH_IDS, TECH_SITE_COUNT } from './config.js';
import { mulberry32, routeDistance } from './map.js';
import { canOccupy } from './pathfinding.js';

const rectDist = (px, pz, r) => Math.hypot(Math.max(r.x0 - px, 0, px - r.x1), Math.max(r.z0 - pz, 0, pz - r.z1));

// Placement rules, in cells. Sites sit well outside both starting bases, at almost the same walking
// distance from each, leave room to walk around them and keep off the authored roads.
export const TECH_MIN_START = 46;
export const TECH_MARGIN = 3;
const FOOTPRINT = 4;
const ROAD_CLEARANCE = 3;
const SPACING = 40;
// Armies move at the pace of their vehicles, so distances only use gaps the largest one fits through.
const VEHICLE_RADIUS = 1.6;
export const fairTolerance = (a, b) => Math.max(4, 0.05 * (a + b) / 2);

// Walking distance in cells from a start to every reachable cell: octile moves, no corner cutting.
export function walkDistances(grid, [sx, sz]) {
  const dist = new Float64Array(N * N).fill(Infinity);
  const heapD = [], heapI = [];
  const push = (d, i) => {
    let k = heapD.length; heapD.push(d); heapI.push(i);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p] <= d) break;
      heapD[k] = heapD[p]; heapI[k] = heapI[p]; k = p;
    }
    heapD[k] = d; heapI[k] = i;
  };
  const pop = () => {
    const top = heapI[0], d = heapD.pop(), i = heapI.pop();
    if (heapD.length) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= heapD.length) break;
        if (c + 1 < heapD.length && heapD[c + 1] < heapD[c]) c++;
        if (heapD[c] >= d) break;
        heapD[k] = heapD[c]; heapI[k] = heapI[c]; k = c;
      }
      heapD[k] = d; heapI[k] = i;
    }
    return top;
  };
  const blocked = (x, z) => x < 0 || z < 0 || x >= N || z >= N || grid[z * N + x] !== 0;
  const start = Math.floor(sz) * N + Math.floor(sx);
  dist[start] = 0; push(0, start);
  while (heapD.length) {
    const d0 = heapD[0], i = pop();
    if (d0 > dist[i]) continue;
    const cx = i % N, cz = (i / N) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (blocked(nx, nz) || (dx && dz && (blocked(cx + dx, cz) || blocked(cx, cz + dz)))) continue;
      const nd = d0 + (dx && dz ? Math.SQRT2 : 1), j = nz * N + nx;
      if (nd < dist[j]) { dist[j] = nd; push(nd, j); }
    }
  }
  return dist;
}

// Distance in cells from every cell to the nearest authored road; the roads never change.
const roadCache = new WeakMap();
function roadDistances(map) {
  if (!roadCache.has(map)) {
    const road = new Float32Array(N * N);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) road[z * N + x] = routeDistance(x + .5, z + .5, map.routes);
    roadCache.set(map, road);
  }
  return roadCache.get(map);
}

// Every footprint that fits the rules for this pair of starts. Distances are measured from the
// footprint's centre cell, which is free ground until the site is placed.
export function techCandidates(map, starts, crates = [], slack = 1) {
  const grid = map.grid, f = FOOTPRINT, m = TECH_MARGIN;
  const roomy = new Uint8Array(N * N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) roomy[z * N + x] = canOccupy(grid, (x + .5) * CELL, (z + .5) * CELL, VEHICLE_RADIUS) ? 0 : 1;
  const [da, db] = starts.map((s) => walkDistances(roomy, s));
  const road = roadDistances(map);
  const out = [];
  for (let cz = m + 1; cz + f + m < N - 1; cz++) {
    for (let cx = m + 1; cx + f + m < N - 1; cx++) {
      const centre = (cz + f / 2) * N + cx + f / 2, a = da[centre], b = db[centre];
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.min(a, b) < TECH_MIN_START) continue;
      if (Math.abs(a - b) > fairTolerance(a, b) * slack) continue;
      let ok = true;
      for (let z = cz - m; z < cz + f + m && ok; z++) for (let x = cx - m; x < cx + f + m; x++) {
        const inside = x >= cx && x < cx + f && z >= cz && z < cz + f;
        if (grid[z * N + x] !== 0 || (inside && road[z * N + x] < ROAD_CLEARANCE)) { ok = false; break; }
      }
      if (!ok) continue;
      const rect = { x0: cx * CELL, z0: cz * CELL, x1: (cx + f) * CELL, z1: (cz + f) * CELL };
      if (map.fields.some((fl) => rectDist(fl.x, fl.z, rect) < fl.r + 4)) continue;
      if (crates.some((c) => rectDist(c.x, c.z, rect) < 6)) continue;
      out.push({ cx, cz, a, b });
    }
  }
  return out;
}

// The map turns but is not a mirror image, so two neighbouring corners do not always have a spot
// exactly between them. The tolerance widens a little if needed; failing that, the two sites
// compensate each other: each may favour a different side, by about the same distance.
export const FAIR_SLACK = [1, 1.5, 2];
const BALANCED_LIMIT = 5;

// Draws the sites and their types. Types never repeat within a match.
export function chooseTechSites(map, starts, crates, random) {
  const all = techCandidates(map, starts, crates, Infinity);
  const types = TECH_IDS.slice();
  const shuffle = (list) => {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list;
  };
  shuffle(types);
  const spaced = (c, picked) => picked.every((p) => Math.hypot(p.cx - c.cx, p.cz - c.cz) >= SPACING);
  const site = (c, i, fairness) => ({ id: types[i], cx: c.cx, cz: c.cz, a: c.a, b: c.b, fairness });
  for (const slack of FAIR_SLACK) {
    const candidates = all.filter((c) => Math.abs(c.a - c.b) <= fairTolerance(c.a, c.b) * slack), picked = [];
    while (picked.length < TECH_SITE_COUNT) {
      const free = candidates.filter((c) => spaced(c, picked));
      if (!free.length) break;
      picked.push(site(free[Math.floor(random() * free.length)], picked.length, slack));
    }
    if (picked.length === TECH_SITE_COUNT) return picked;
  }
  const near = shuffle(all.filter((c) => Math.abs(c.a - c.b) <= fairTolerance(c.a, c.b) * BALANCED_LIMIT));
  const lead = (c) => c.a - c.b;
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const p = near[i], q = near[j];
      if (!spaced(p, [q]) || Math.abs(lead(p) + lead(q)) > fairTolerance(p.a + q.a, p.b + q.b)) continue;
      return [site(p, 0, 'balanced'), site(q, 1, 'balanced')];
    }
  }
  // Last resort on a map with no fair room at all: the fairest spots available.
  const picked = [];
  for (const c of all.sort((p, q) => Math.abs(lead(p)) / (p.a + p.b) - Math.abs(lead(q)) / (q.a + q.b))) {
    if (picked.length < TECH_SITE_COUNT && spaced(c, picked)) picked.push(site(c, picked.length, 'closest'));
  }
  return picked;
}

const NEUTRAL = 0xc9cdd2;

export class TechSites {
  constructor(game, seed = Math.floor(Math.random() * 0x100000000)) {
    this.game = game;
    this.seed = seed;
    this.items = [];
  }

  // Called once the corners are drawn, before the bases are laid out.
  place() {
    const g = this.game;
    const spots = chooseTechSites(g.map, [g.starts.human, g.starts.machine], g.cashCrates?.items ?? [], mulberry32(this.seed));
    for (const s of spots) {
      const b = g.placeBuilding(null, s.id, s.cx, s.cz, true);
      b.tech = { state: 'ruin', progress: 0, paid: 0, repairing: false, waiting: false, found: {}, announced: false,
        view: { team: null, state: 'ruin', progress: 0 } };
      b.hp = b.maxHp * b.def.ruin;
      const beacon = b.parts.beacon;
      if (beacon) beacon.material = beacon.material.clone();
      this.items.push(b);
      this.refreshView(b, true);
    }
  }

  // Each side discovers sites with its own units and buildings, independently of the player's fog.
  discover() {
    const g = this.game;
    for (const b of this.items) {
      const t = b.tech;
      for (const e of [...g.units, ...g.buildings]) {
        if (e.dead || !e.team || t.found[e.team] || e === b) continue;
        if (rectDist(e.x, e.z, b.rect) <= e.def.sight) t.found[e.team] = true;
      }
    }
  }

  foundBy(team) { return this.items.filter((b) => b.tech.found[team]); }

  // Visible now to the player: owners and spectators always; others only inside current vision.
  inSight(b) {
    const g = this.game, r = b.rect;
    return g.spectate || (b.team && b.team === g.player) || g.visibleAt(b.x, b.z) ||
      g.visibleAt(r.x0 + 1, r.z0 + 1) || g.visibleAt(r.x1 - 1, r.z0 + 1) || g.visibleAt(r.x0 + 1, r.z1 - 1) || g.visibleAt(r.x1 - 1, r.z1 - 1);
  }

  // Under fog the player keeps the last state seen: owner, ruin or repair progress.
  refreshView(b, force = false) {
    if (!force && !this.inSight(b)) return;
    const t = b.tech, v = t.view;
    v.team = b.team; v.state = t.state; v.progress = t.progress;
    const p = b.parts;
    if (p.intact) {
      p.intact.visible = v.progress > 0.001;
      p.intact.scale.y = Math.max(0.02, v.progress);
    }
    if (p.wreck) p.wreck.visible = v.state !== 'online';
    if (p.beacon) {
      const color = v.team ? TEAMS[v.team].color : NEUTRAL, m = p.beacon.material;
      m.color?.setHex(color);
      m.emissive?.setHex(color);
    }
  }

  capture(b, unit) {
    const g = this.game, t = b.tech, prev = b.team, name = b.def.name;
    if (!t || unit.dead || b.team === unit.team) return false;
    b.team = unit.team;
    t.found[unit.team] = true;
    if (t.state === 'ruin') { t.state = 'repairing'; t.progress = 0; t.paid = 0; }
    // A captured site resumes repairs for its new owner; paid work stays with the building.
    t.repairing = t.state === 'repairing';
    t.waiting = false;
    // A superweapon starts charging again for its new owner.
    t.charge = 0; t.announcedReady = false;
    // Work in progress belonged to the old owner and is lost with the building.
    b.target = null; b.lastHit = -99; b.queue = []; b.rally = null;
    g.consumeUnit(unit);
    g.recomputePower();
    if (this.inSight(b)) g.fx.marker(b.x, b.z, 'rally');
    // The player learns at once about their own losses; anything else only when seen.
    this.refreshView(b, prev === g.player || unit.team === g.player);
    if (!g.spectate) {
      if (unit.team === g.player) {
        g.audio.play('ready');
        g.audio.say('Estructura capturada', 3000);
        g.emit('toast', { text: t.state === 'online' ? `${name} capturado` : `${name} capturado: reparación en curso`, kind: 'good' });
      } else if (prev === g.player) {
        g.audio.say('Hemos perdido una estructura', 4000);
        g.emit('toast', { text: `¡El enemigo ha capturado ${name}!`, kind: 'warn' });
        g.emit('alert', { x: b.x, z: b.z });
      }
    }
    return true;
  }

  // Destroying a captured site leaves it in ruins again, ready for the next engineer.
  wreck(b) {
    const g = this.game, t = b.tech, prev = b.team;
    g.fx.bigExplosion(b.x, b.z, b.w * CELL, b.h * CELL, b.def.height);
    g.audio.play('bigexplosion', b.x, b.z);
    b.team = null; b.hp = b.maxHp * b.def.ruin; b.target = null; b.queue = []; b.rally = null;
    Object.assign(t, { state: 'ruin', progress: 0, paid: 0, repairing: false, waiting: false, charge: 0, announcedReady: false });
    g.recomputePower();
    this.refreshView(b, prev === g.player);
    if (prev === g.player && !g.spectate) g.emit('toast', { text: `${b.def.name} destruido: vuelve a estar en ruinas`, kind: 'warn' });
  }

  setRepairing(b, on) {
    const t = b.tech;
    if (!t || t.state !== 'repairing') return false;
    t.repairing = !!on; t.waiting = false;
    return true;
  }

  // Repairs are paid as they progress, like production, and run slower without enough power.
  updateRepair(b, dt) {
    const g = this.game, t = b.tech, def = b.def;
    if (t.state !== 'repairing' || !t.repairing || !b.team) return;
    const T = g.teams[b.team];
    const inc = Math.min(dt / def.repairTime * (g.lowPower(b.team) ? 0.4 : 1), 1 - t.progress);
    const cost = def.repairCost * inc;
    if (T.credits < cost) { t.waiting = true; return; }
    T.credits -= cost; t.paid += cost; t.progress += inc; t.waiting = false;
    b.hp = Math.min(b.maxHp, b.hp + b.maxHp * (1 - def.ruin) * inc);
    if (t.progress < 0.9999) return;
    t.progress = 1; t.state = 'online'; t.repairing = false;
    g.recomputePower();
    if (b.maxHp - b.hp < 1e-6) b.hp = b.maxHp;
    if (b.team === g.player && !g.spectate) {
      g.audio.play('ready');
      g.audio.say('Reparación completa', 3000);
      g.emit('toast', { text: `${def.name} reparado y operativo`, kind: 'good' });
    }
  }

  update(dt) {
    const g = this.game;
    for (const b of this.items) {
      this.updateRepair(b, dt);
      this.refreshView(b);
      if (!b.tech.announced && b.seen && !g.spectate) {
        b.tech.announced = true;
        g.emit('toast', { text: `Estructura tecnológica descubierta: ${b.def.name}`, kind: 'info' });
        g.audio.say('Estructura tecnológica detectada', 4000);
      }
    }
  }
}
