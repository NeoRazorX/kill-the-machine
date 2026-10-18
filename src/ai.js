import { N, CELL, ROLE, BUILD_RADIUS, buildingFront, other, canCapture, canRepairBuilding, visionRadius } from './config.js';

const SECTOR = 32; // lado en unidades de mundo de cada zona que explora el explorador
const SECTORS = N * CELL / SECTOR;

// Base layout, tried from the tidiest level to the loosest. gap: walkway between buildings, in cells
// (two let a harvester or a tank through; placement never allows less than one). The loose level also
// lets a turret stray from the base and a new building's own exit run into rocks, but no exit ever
// holds a building. Exits (cells): producers keep a strip in front, refineries a wider apron for
// the dock and its waiting harvesters. Turrets stay within TURRET_REACH (world units) of the base.
export const LAYOUT_LEVELS = [{ gap: 2 }, { gap: 1 }, { gap: 1, loose: true }];
// runway: the softer zone ahead of any exit that the layout prefers to leave open.
export const EXIT = { producer: { side: 1, depth: 3 }, refinery: { side: 2, depth: 4 }, runway: 8 };
const TURRET_REACH = 14;
// Economy: fields further than ORE_RANGE from every refinery dock are not worth the drive, a field with
// less than ORE_MIN left is treated as spent, and while harvesters or a refinery are missing the army
// waits until there are ECO_RESERVE credits. Idle units go for seen crates within CRATE_REACH.
const ORE_RANGE = 120, ORE_MIN = 400, ECO_RESERVE = 1000, CRATE_REACH = 90;
// How many harvesters a field keeps busy without them queueing for the ore.
export const fieldSlots = (f) => Math.max(2, Math.round(f.r / 3));

// Cells in front of a building that must stay clear: where units come out or harvesters unload.
// With depth, the same strip reaching that many cells out.
export function apron(b, depth = 0) {
  const e = b.def.role === 'refinery' ? EXIT.refinery : b.def.produces ? EXIT.producer : null;
  if (!e) return null;
  const f = b.front ?? 1, d = depth || e.depth;
  return { cx: b.cx - e.side, w: b.w + 2 * e.side, cz: f > 0 ? b.cz + b.h : b.cz - d, h: d };
}
// Stable per-AI noise so equal spots are not always picked the same way, without using Math.random.
const jitter = (cx, cz, seed) => ((Math.imul(cx * 73856093 ^ cz * 19349663, seed | 1) >>> 0) % 1000) / 1000;
const overlap = (a, b) => a.cx < b.cx + b.w && b.cx < a.cx + a.w && a.cz < b.cz + b.h && b.cz < a.cz + a.h;
// Free distance (world units, per axis, the larger one) between a footprint at (cx, cz) and a building.
function rectGap(cx, cz, def, b) {
  const dx = Math.max(0, b.cx - (cx + def.w), cx - (b.cx + b.w)), dz = Math.max(0, b.cz - (cz + def.h), cz - (b.cz + b.h));
  return Math.max(dx, dz) * CELL;
}

// IA de construcción, producción y ataque. Sirve para ambos bandos (modo espectador).
export class AI {
  constructor(game, team, diff) {
    this.g = game; this.team = team; this.enemy = other(team); this.diff = diff;
    this.acc = Math.random() * 0.5; this.think = diff.think;
    this.waveTimer = diff.firstWave; this.waveNo = 0;
    this.group = []; this.placeFail = 0; this.lastDefend = -99;
    this.scout = null; this.scoutGoal = null; this.scoutCorner = null; this.explored = new Set();
    // La IA no sabe en qué esquina empezó el rival: solo conoce lo que ha visto y dónde puede estar.
    const { spawns } = game.map, [ox, oz] = game.starts[team], own = spawns.findIndex(([x, z]) => x === ox && z === oz);
    const rivals = game.map.rivalSlots?.(own) ?? spawns.map((_, i) => i).filter((i) => i !== own);
    this.corners = rivals.map((i) => spawns[i]).map(([x, z]) => ({ x: x * CELL, z: z * CELL }));
    this.known = new Set(); this.enemyBase = null;
    this.engineer = null; this.techRetry = 0;
    this.crateHunt = new Map(); this.refineryBlocked = -99;
    this.seed = 1 + Math.floor(Math.random() * 1e6);
  }

  update(dt) {
    this.acc += dt;
    if (this.acc < this.think) return;
    const d = this.acc; this.acc = 0;
    if (this.g.over) return;
    this.updateIntel();
    this.manageStructures();
    this.manageRepairs();
    this.manageUnits();
    this.manageHarvesters();
    this.manageWaves(d);
    this.manageDefense();
    this.manageScout();
    this.manageCrates();
    this.manageTech();
    this.manageSuperweapons();
  }

  get hq() {
    const l = this.g.teamBuildings(this.team).filter((b) => !b.def.tech);
    return l.find((b) => b.def.role === 'hq') || l[0] || null;
  }

  stage() {
    const hq = this.hq;
    if (!hq) return null;
    const e = this.enemyBase || { x: N * CELL / 2, z: N * CELL / 2 };
    const dx = e.x - hq.x, dz = e.z - hq.z, d = Math.hypot(dx, dz) || 1;
    return { x: hq.x + (dx / d) * 34, z: hq.z + (dz / d) * 34 };
  }

  // ------------------------------------------------------------ información
  // Enemy buildings become known once inside the sight of an own unit or building; a corner
  // counts as explored once something has looked at it.
  updateIntel() {
    const g = this.g;
    const eyes = [...g.units, ...g.buildings].filter((e) => e.team === this.team && !e.dead);
    const sees = (x, z, pad) => eyes.some((e) => Math.hypot(e.x - x, e.z - z) <= visionRadius(e) + pad);
    // Captured structures change hands, so a known target stops being one when it does.
    for (const b of this.known) if (b.dead || b.team !== this.enemy) this.known.delete(b);
    for (const b of g.buildings) {
      if (b.team !== this.enemy || b.dead || this.known.has(b) || !sees(b.x, b.z, b.radius)) continue;
      this.known.add(b);
      // An enemy-held tech structure is a target, but says nothing about where the base is.
      if (!this.enemyBase && !b.def.tech) {
        const corner = this.corners.find((c) => Math.hypot(c.x - b.x, c.z - b.z) < 60);
        this.enemyBase = corner ? { x: corner.x, z: corner.z } : { x: b.x, z: b.z };
      }
    }
    this.corners = this.corners.filter((c) => !sees(c.x, c.z, -4));
    // Por eliminación: si solo queda una esquina por ver, el enemigo está ahí.
    if (!this.enemyBase && this.corners.length === 1) this.enemyBase = { x: this.corners[0].x, z: this.corners[0].z };
  }

  nearestCorner(from) {
    let best = null, bd = 1e9;
    for (const c of this.corners) {
      const d = Math.hypot(c.x - from.x, c.z - from.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // ----------------------------------------------------------------- economía
  // Ore fields worth working from these refineries: with ore left, within reach of a dock and away
  // from the enemy base once it is known.
  oreFields(refs) {
    const e = this.enemyBase;
    return this.g.map.fields.filter((f) => f.amount > ORE_MIN && (!e || Math.hypot(f.x - e.x, f.z - e.z) > 60)
      && refs.some((r) => Math.hypot(r.dock.x - f.x, r.dock.z - f.z) < ORE_RANGE));
  }

  // Economic targets for this think: refineries by difficulty and match time, harvesters per refinery
  // up to what the nearby ore keeps busy. short: something economic is missing, so the army waits.
  economy() {
    const g = this.g, team = this.team, d = this.diff;
    const refs = g.teamBuildings(team, 'refinery'), done = refs.filter((b) => b.complete);
    const harvesters = g.units.filter((u) => u.team === team && !u.dead && u.def.harvester).length;
    const queued = g.queuedCount(team, ROLE[team].harv.id);
    const slots = this.oreFields(refs).reduce((a, f) => a + fieldSlots(f), 0);
    const wantHarv = Math.min(Math.max(1, done.length) * d.harvPerRef, Math.max(2, slots));
    // Another refinery, past the difficulty's time for each one, once the current ones have their harvesters.
    let wantRefs = Math.max(1, refs.length);
    const building = refs.length > done.length || g.teams[team].structQueue?.def.role === 'refinery';
    if (!building && refs.length < d.maxRefineries && g.time >= d.expandAt * refs.length && g.time >= this.refineryBlocked
      && harvesters + queued >= done.length * d.harvPerRef - 1) wantRefs = refs.length + 1;
    const factory = g.hasRole(team, 'factory');
    const missing = factory ? Math.max(0, wantHarv - harvesters - queued) : 0;
    return { wantHarv, wantRefs, refs: refs.length, harvesters, queued, missing, short: missing > 0 || wantRefs > refs.length || building };
  }

  // Spreads the harvesters over the ore near its refineries: each field takes a few, the fields closest
  // to a dock fill first, and a harvester moves on when its field runs dry or is crowded. One that is
  // already driving to or working a field finishes its load there.
  manageHarvesters() {
    const g = this.g, team = this.team;
    const refs = g.teamBuildings(team, 'refinery').filter((b) => b.complete);
    const harv = g.units.filter((u) => u.team === team && !u.dead && u.def.harvester && u.order.type === 'harvest');
    if (!refs.length || !harv.length) return;
    const fields = this.oreFields(refs);
    if (!fields.length) return;
    const dist = new Map(fields.map((f) => [f, Math.min(...refs.map((r) => Math.hypot(r.dock.x - f.x, r.dock.z - f.z)))]));
    const load = new Map(fields.map((f) => [f, 0]));
    const working = (u) => u.hstate === 'gather' || u.hstate === 'toField';
    harv.sort((a, b) => working(b) - working(a));
    const free = [];
    for (const u of harv) {
      const f = u.order.field;
      if (f && load.has(f) && (load.get(f) < fieldSlots(f) || working(u))) load.set(f, load.get(f) + 1);
      else free.push(u);
    }
    for (const u of free) {
      let best = null, bs = 1e9;
      for (const f of fields) {
        const n = load.get(f), s = dist.get(f) + n * 12 + (n >= fieldSlots(f) ? 400 : 0);
        if (s < bs) { bs = s; best = f; }
      }
      load.set(best, load.get(best) + 1);
      u.order.field = best;
      if (u.hstate === 'idle') u.field = best;
    }
  }

  // Idle units near a crate their side has seen go and pick it up, a few at a time; the scout takes
  // the far ones. Crates by the known enemy base are left alone.
  manageCrates() {
    const g = this.g;
    for (const [c, u] of this.crateHunt) {
      if (c.collected || u.dead || u.order.type !== 'move' || u.order.x !== c.x || u.order.z !== c.z) this.crateHunt.delete(c);
    }
    if (g.time < this.diff.scoutDelay) return;
    let pool = null;
    for (const c of g.cashCrates.discoveredBy(this.team)) {
      if (this.crateHunt.size >= this.diff.crateHunters) break;
      if (this.crateHunt.has(c) || this.scoutCrate === c) continue;
      if (this.enemyBase && Math.hypot(c.x - this.enemyBase.x, c.z - this.enemyBase.z) < 60) continue;
      pool ||= this.armyIdle().filter((u) => u.def.weapon);
      let best = null, bd = CRATE_REACH;
      for (const u of pool) {
        const d = Math.hypot(u.x - c.x, u.z - c.z);
        if (d < bd) { bd = d; best = u; }
      }
      if (!best) continue;
      best.cmdMove(c.x, c.z);
      this.crateHunt.set(c, best);
      pool = pool.filter((u) => u !== best);
    }
  }

  // -------------------------------------------------------------- estructuras
  // Repairs structures below 80 % while there is money to spare, and lets them wait when funds run
  // low so production and rebuilding keep priority.
  manageRepairs() {
    const g = this.g, credits = g.teams[this.team].credits;
    for (const b of g.teamBuildings(this.team)) {
      if (b.repairing && credits < 150) g.setBuildingRepair(b, false);
      else if (!b.repairing && credits >= 400 && canRepairBuilding(b) && b.hp < b.maxHp * 0.8) g.setBuildingRepair(b, true);
    }
  }

  manageStructures() {
    const g = this.g, team = this.team, T = g.teams[team];
    if (T.structQueue) {
      if (T.structQueue.ready) this.placeStructure(T.structQueue.def);
      return;
    }
    const has = (r) => g.hasRole(team, r);
    const n = (r) => g.teamBuildings(team, r).length;
    // Asegurar ingresos antes de ampliar el ejército, también tras perder la economía.
    for (const role of ['power', 'refinery']) {
      if (has(role)) continue;
      const def = ROLE[team][role];
      if (!n(role) && T.credits >= def.cost * 0.35) g.startStruct(team, def.id);
      // Esperar a que termine de desplegarse sin encargar otro edificio igual.
      return;
    }
    const pw = T.power, eco = this.economy();
    const want = [];
    if (pw.use + 25 > pw.prod) want.push('power');
    // Another refinery comes before anything military, and the AI saves up for it.
    if (eco.wantRefs > n('refinery')) want.push('refinery');
    if (!has('barracks')) want.push('barracks');
    if (!has('factory')) want.push('factory');
    if (n('turret') < Math.min(1 + this.waveNo, 6) && has('barracks')) want.push('turret');
    if (T.credits > 2500 && n('factory') < 2) want.push('factory');
    if (T.credits > 1800 && n('barracks') < 2) want.push('barracks');
    if (pw.prod - pw.use < 60 && T.credits > 1500) want.push('power');
    if (T.credits > 3200 && n('turret') < 8) want.push('turret');
    for (const r of want) {
      const def = ROLE[team][r];
      if (T.credits < def.cost * 0.35) {
        if (r === 'refinery') break;
        continue;
      }
      if (g.startStruct(team, def.id)) break;
    }
  }

  // Lays the base out like a C&C AI: walkways between buildings, refinery docks and producer exits kept
  // clear, refineries by the ore and turrets on the side facing the enemy. When room runs short the
  // spacing shrinks one step at a time, and as a last resort any valid spot that leaves exits clear will do.
  placeStructure(def) {
    const g = this.g, hq = this.hq;
    if (!hq) return;
    const spot = this.layoutSpot(def);
    if (spot) { g.placeStruct(this.team, spot.cx, spot.cz); this.placeFail = 0; }
    else if (++this.placeFail >= 8) {
      // No room: a refinery is not tried again for a while, so the AI does not keep saving for it.
      if (def.role === 'refinery') this.refineryBlocked = g.time + 60;
      g.cancelStruct(this.team); this.placeFail = 0;
    }
  }

  layoutSpot(def) {
    const g = this.g, team = this.team, hq = this.hq;
    const own = g.teamBuildings(team).filter((b) => !b.def.tech);
    const core = own.filter((b) => b.def.role !== 'turret');
    const others = g.buildings.filter((b) => !b.dead);
    const aprons = others.map((b) => apron(b)).filter(Boolean);
    // Beyond each exit, units still need room to get going: keep that ground open where possible.
    const runways = others.map((b) => apron(b, EXIT.runway)).filter(Boolean);
    const turrets = own.filter((b) => b.def.role === 'turret');
    // Direction to the enemy (or the map centre while it is unknown), for turrets and production.
    const e = this.enemyBase || { x: N * CELL / 2, z: N * CELL / 2 };
    const el = Math.hypot(e.x - hq.x, e.z - hq.z) || 1, ex = (e.x - hq.x) / el, ez = (e.z - hq.z) / el;
    let field = null;
    if (def.role === 'refinery') {
      // The nearest field, preferring one no refinery of its own serves yet so the harvesters spread out.
      const docks = own.filter((b) => b.def.role === 'refinery').map((b) => b.dock);
      let bs = 1e9;
      for (const f of g.map.fields) {
        if (f.amount <= 0) continue;
        const d = core.reduce((m, b) => Math.min(m, Math.hypot(f.x - b.x, f.z - b.z)), 1e9);
        if (d >= 70) continue;
        const served = docks.filter((k) => Math.hypot(k.x - f.x, k.z - f.z) < f.r + 24).length;
        const s = d + served * 45 + (f.amount < 2000 ? 40 : 0);
        if (s < bs) { bs = s; field = f; }
      }
    }
    // Every cell that could still lie within the build radius, scored first and validated in order.
    const reach = Math.ceil(BUILD_RADIUS / CELL) + Math.max(def.w, def.h);
    let x0 = N, z0 = N, x1 = 0, z1 = 0;
    for (const b of own) { x0 = Math.min(x0, b.cx); z0 = Math.min(z0, b.cz); x1 = Math.max(x1, b.cx + b.w); z1 = Math.max(z1, b.cz + b.h); }
    const cands = [];
    for (let cz = Math.max(1, z0 - reach); cz <= Math.min(N - 1 - def.h, z1 + reach); cz++) {
      for (let cx = Math.max(1, x0 - reach); cx <= Math.min(N - 1 - def.w, x1 + reach); cx++) {
        const px = (cx + def.w / 2) * CELL, pz = (cz + def.h / 2) * CELL;
        const dx = px - hq.x, dz = pz - hq.z, along = dx * ex + dz * ez, dist = Math.hypot(dx, dz);
        let s, far = false;
        if (def.role === 'turret') {
          // Out on the front, spread apart, but never far from the buildings they guard.
          far = core.reduce((m, b) => Math.min(m, rectGap(cx, cz, def, b)), 1e9) > TURRET_REACH;
          s = -along + turrets.reduce((a, t) => a + Math.max(0, 16 - Math.hypot(t.x - px, t.z - pz)) * 2, 0);
        } else if (field) {
          // Refinery docks face +Z: put the dock, not the building, next to the ore.
          const dkx = px + (def.dock?.x ?? 0), dkz = (cz + def.h) * CELL + (def.dock?.clearance ?? 2.6);
          s = Math.hypot(dkx - field.x, dkz - field.z) - field.r + dist * 0.25;
        } else {
          // Power at the back, production towards the front so units come out facing the enemy.
          s = dist + (def.role === 'power' ? 0.4 : def.produces ? -0.3 : 0) * along;
        }
        const rect = { cx, cz, w: def.w, h: def.h };
        if (runways.some((r) => overlap(rect, r))) s += 8;
        const run = apron({ cx, cz, w: def.w, h: def.h, def, front: buildingFront(def) }, EXIT.runway);
        if (run && others.some((b) => overlap(run, b))) s += 20;
        // Rows: prefer lining up with an edge of a neighbour.
        if (own.some((b) => b.cx === cx || b.cz === cz || b.cz + b.h === cz + def.h)) s -= 1.5;
        cands.push({ cx, cz, far, s: s + jitter(cx, cz, this.seed) });
      }
    }
    cands.sort((a, b) => a.s - b.s);
    for (const level of LAYOUT_LEVELS) {
      for (const c of cands) {
        if (c.far && !level.loose) continue;
        if (this.layoutFits(def, c.cx, c.cz, level, others, aprons)) return c;
      }
    }
    return null;
  }

  layoutFits(def, cx, cz, { gap, loose }, others, aprons) {
    const g = this.g;
    const rect = { cx, cz, w: def.w, h: def.h };
    for (const b of others) if (rectGap(cx, cz, def, b) < gap * CELL) return false;
    // Nothing may sit on another building's exit, and this building's own exit must be open ground.
    for (const a of aprons) if (overlap(rect, a)) return false;
    const mine = apron({ cx, cz, w: def.w, h: def.h, def, front: buildingFront(def) });
    if (mine) {
      if (!loose && (mine.cx < 1 || mine.cz < 1 || mine.cx + mine.w > N - 1 || mine.cz + mine.h > N - 1)) return false;
      for (let z = Math.max(0, mine.cz); z < Math.min(N, mine.cz + mine.h); z++) {
        for (let x = Math.max(0, mine.cx); x < Math.min(N, mine.cx + mine.w); x++) {
          const v = g.map.grid[z * N + x];
          if (v === 2 || (v && !loose)) return false;
        }
      }
    }
    return g.canPlace(this.team, def, cx, cz, true);
  }

  // ----------------------------------------------------------------- unidades
  manageUnits() {
    const g = this.g, team = this.team, T = g.teams[team];
    const st = this.stage();
    const producers = g.buildings.filter((b) => b.team === team && g.canProduceAt(b));
    for (const b of producers) if (st && !b.rally) b.rally = { x: st.x + (Math.random() - 0.5) * 10, z: st.z + (Math.random() - 0.5) * 10 };
    if (!producers.length) return;

    // Missing harvesters go first: one per factory at a time, moved to the front of its queue.
    const harvDef = ROLE[team].harv, eco = this.economy();
    const factories = g.producers(team, 'factory').length;
    if (eco.missing > 0 && eco.queued < factories && g.queueUnit(team, harvDef.id)) {
      for (const b of producers) {
        const i = b.queue.findIndex((it) => it.def === harvDef);
        if (i > 0) b.queue.unshift(...b.queue.splice(i, 1));
      }
      return;
    }
    // While it saves for harvesters or a refinery the army waits, unless the base is under attack.
    const la = T.lastAttacked, attacked = la && g.time - la.t < 15;
    if (eco.short && !attacked && T.credits < ECO_RESERVE) return;

    const queued = producers.reduce((a, b) => a + b.queue.length, 0);
    if (queued >= producers.length * 2) return;
    const r = Math.random();
    const choices = [];
    const R = ROLE[team];
    // Sanadores: como mucho uno por cada seis unidades de su tipo.
    const own = (producer) => g.units.filter((u) => u.team === team && !u.dead && !u.def.harvester && u.def.producer === producer);
    const fewHealers = (producer, role) => {
      const list = own(producer), healers = list.filter((u) => u.def.repair).length + g.queuedCount(team, R[role].id);
      return list.length >= 4 && healers * 6 < list.length;
    };
    if (g.hasRole(team, 'barracks')) {
      choices.push([R.inf1, 0.34], [R.inf2, 0.26]);
      if (fewHealers('barracks', 'medic')) choices.push([R.medic, 0.1]);
    }
    if (g.hasRole(team, 'factory')) {
      choices.push([R.tank, 0.28], [R.arty, 0.12]);
      if (fewHealers('factory', 'repair')) choices.push([R.repair, 0.08]);
      const radars = own('factory').filter((u) => u.def.radar).length + g.queuedCount(team, R.radar.id);
      if (!radars) choices.push([R.radar, 0.08]);
    }
    // Captured, repaired tech factories turn out their super-units alongside the regular army.
    for (const role of ['mammoth', 'juggernaut']) if (g.requirementsMet(team, R[role])) choices.push([R[role], 0.3]);
    let tot = choices.reduce((a, c) => a + c[1], 0), acc = 0;
    for (const [def, w] of choices) {
      acc += w / tot;
      if (r <= acc) { if (T.credits >= def.cost * 0.5) g.queueUnit(team, def.id); break; }
    }
  }

  armyIdle() {
    return this.g.units.filter((u) => u.team === this.team && !u.dead && !u.def.harvester && (u.def.weapon || u.def.repair) && u !== this.scout && !this.group.includes(u) && !this.isCrateHunter(u) && (u.order.type === 'idle' || (u.order.type === 'move' && !u.path)));
  }

  isCrateHunter(u) {
    for (const h of this.crateHunt.values()) if (h === u) return true;
    return false;
  }

  pickTarget(from) {
    const g = this.g;
    let best = null, bd = 1e9;
    for (const b of this.known) {
      if (b.dead || b.selling) continue;
      const d = Math.hypot(b.x - from.x, b.z - from.z) - (b.def.role === 'hq' ? 25 : 0) + (b.def.weapon ? 15 : 0);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) return { x: best.x, z: best.z };
    // Sin objetivos conocidos, el ataque explora la esquina pendiente más cercana.
    const corner = this.nearestCorner(from);
    if (corner) return corner;
    // Every corner checked and nothing known left: chase the remaining buildings rather than stall.
    const rest = g.teamBuildings(this.enemy);
    for (const b of rest) {
      const d = Math.hypot(b.x - from.x, b.z - from.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best ? { x: best.x, z: best.z } : null;
  }

  manageWaves(dt) {
    this.waveTimer -= dt;
    this.group = this.group.filter((u) => !u.dead);
    if (this.group.length) {
      let cx = 0, cz = 0;
      for (const u of this.group) { cx += u.x; cz += u.z; }
      const c = { x: cx / this.group.length, z: cz / this.group.length };
      const tgt = this.pickTarget(c);
      if (!tgt || this.group.length <= 2) { this.group = []; return; }
      for (const u of this.group) if (u.order.type === 'idle' && !u.target) u.cmdMove(tgt.x, tgt.z, true);
      // refuerzos que llegan al punto de reunión se suman al grupo si es grande
      return;
    }
    const army = this.armyIdle();
    const min = this.diff.minArmy + this.waveNo * 2;
    if (this.waveTimer <= 0 && army.length >= min) {
      const hq = this.hq;
      const tgt = this.pickTarget(hq || { x: 0, z: 0 });
      if (!tgt) return;
      this.group = army.slice(0, Math.ceil(min * 1.6)); this.waveNo++; this.waveTimer = this.diff.waveGap;
      for (const u of this.group) u.cmdMove(tgt.x, tgt.z, true);
    }
  }

  // ------------------------------------------------------------- exploración
  // Una unidad rápida busca primero la base enemiga por las esquinas y después recoge
  // las cajas que su bando ha descubierto.
  manageScout() {
    const g = this.g, crates = g.cashCrates;
    if (this.scout?.dead) this.scout = null;
    if (!this.scout) this.scoutCrate = null;
    const hunting = !this.enemyBase && this.corners.length > 0;
    // Everyone knows how many tech structures the map holds, so the scout keeps looking for them.
    const unexplored = this.explored.size < SECTORS * SECTORS;
    const missingTech = g.techSites.items.some((b) => !b.tech.found[this.team]);
    const looting = (unexplored && (missingTech || crates.items.some((c) => !c.collected))) || crates.discoveredBy(this.team).length > 0;
    if (!hunting && !looting) { this.scout = null; this.scoutCrate = null; return; }
    if (!this.scout) {
      // En fácil el explorador sale más tarde para dar ventaja al jugador.
      if (g.time < this.diff.scoutDelay) return;
      const army = this.armyIdle().filter((u) => u.def.weapon);
      const radar = g.units.find((u) => u.team === this.team && !u.dead && u.def.radar && u.order.type === 'idle');
      this.scout = radar || army.sort((a, b) => b.def.speed - a.def.speed)[0] || null;
      this.scoutGoal = null; this.scoutCorner = null;
      if (!this.scout) return;
    }
    const s = this.scout;
    this.explored.add(this.sectorAt(s.x, s.z));
    // Seen crates nobody else is fetching; while it hunts for the enemy it only detours for close ones.
    let best = null, bd = hunting ? 40 : 1e9;
    for (const c of crates.discoveredBy(this.team)) {
      if (this.crateHunt.has(c)) continue;
      const d = Math.hypot(c.x - s.x, c.z - s.z);
      if (d < bd) { bd = d; best = c; }
    }
    this.scoutCrate = best;
    if (best) {
      if (s.order.type !== 'move' || s.order.x !== best.x || s.order.z !== best.z) s.cmdMove(best.x, best.z);
      this.scoutGoal = null;
      return;
    }
    if (hunting) {
      // Keep heading to the same corner until it has been seen, so the scout never dithers.
      if (!this.corners.includes(this.scoutCorner)) this.scoutCorner = this.nearestCorner(s);
      const c = this.scoutCorner;
      if (s.order.type !== 'move' || s.order.x !== c.x || s.order.z !== c.z) s.cmdMove(c.x, c.z);
      this.scoutGoal = null;
      return;
    }
    if (this.scoutGoal !== null && s.order.type === 'move' && s.path) return;
    // Llegó, se atascó o el camino solo alcanzaba un punto cercano: la zona queda descartada.
    if (this.scoutGoal !== null) this.explored.add(this.scoutGoal);
    // Siguiente zona sin explorar más cercana, evitando la base enemiga si ya la conoce.
    const e = this.enemyBase;
    let goal = null; bd = 1e9;
    for (let k = 0; k < SECTORS * SECTORS; k++) {
      if (this.explored.has(k)) continue;
      const x = (k % SECTORS + 0.5) * SECTOR, z = (Math.floor(k / SECTORS) + 0.5) * SECTOR;
      if (e && Math.hypot(x - e.x, z - e.z) < 48) { this.explored.add(k); continue; }
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < bd) { bd = d; goal = { k, x, z }; }
    }
    this.scoutGoal = goal?.k ?? null;
    if (goal) s.cmdMove(goal.x, goal.z);
  }

  // ------------------------------------------------- estructuras tecnológicas
  // Once its delay has passed, sends one engineer at a time with an escort to the nearest discovered
  // structure that is not its own, whether in ruins or held by the enemy.
  manageTech() {
    const g = this.g, team = this.team, T = g.teams[team], hq = this.hq;
    if (!hq || g.time < this.diff.techDelay) return;
    if (this.engineer?.dead) { this.engineer = null; this.techRetry = g.time + 45; }
    let goal = null, bd = 1e9;
    for (const b of g.techSites.foundBy(team)) {
      if (b.team === team) continue;
      const d = Math.hypot(b.x - hq.x, b.z - hq.z);
      if (d < bd) { bd = d; goal = b; }
    }
    if (!goal) return;
    // An engineer that came out of the barracks reports for duty.
    this.engineer ||= g.units.find((u) => u.team === team && !u.dead && u.def.engineer) || null;
    const e = this.engineer, def = ROLE[team].engineer;
    if (!e) {
      if (g.time >= this.techRetry && g.hasRole(team, 'barracks') && !g.queuedCount(team, def.id) && T.credits >= def.cost) g.queueUnit(team, def.id);
      return;
    }
    if (e.order.type === 'capture' && e.order.target === goal) return;
    if (!canCapture(e, goal)) return;
    e.cmdCapture(goal);
    // The escort clears the way and stays behind to guard the site.
    const escort = this.armyIdle().filter((u) => u.def.weapon)
      .sort((a, b) => Math.hypot(a.x - e.x, a.z - e.z) - Math.hypot(b.x - e.x, b.z - e.z)).slice(0, goal.team ? 6 : 3);
    escort.forEach((u, i) => {
      const a = (i / escort.length) * Math.PI * 2;
      u.cmdMove(goal.x + Math.cos(a) * 9, goal.z + Math.sin(a) * 9, true);
    });
  }

  // ---------------------------------------------------------- superarmas
  // Fires a ready superweapon at the most valuable spot it knows of: known enemy buildings and enemy
  // units its own forces can see, minus what it would lose of its own. Waits for a worthwhile target.
  manageSuperweapons() {
    const g = this.g, sw = g.superweapons;
    if (!sw) return;
    for (const b of sw.ready(this.team)) {
      const t = this.superTarget(b.def.superweapon);
      if (t) sw.fire(b, t.x, t.z);
    }
  }

  superTarget(w) {
    const g = this.g, R = w.radius;
    const eyes = [...g.units, ...g.buildings].filter((e) => e.team === this.team && !e.dead);
    const seen = g.units.filter((u) => u.team === this.enemy && !u.dead && eyes.some((e) => Math.hypot(e.x - u.x, e.z - u.z) <= visionRadius(e)));
    const targets = [...[...this.known].filter((b) => !b.dead && b.team === this.enemy), ...seen];
    const worth = (e) => (e.def.role === 'hq' ? 1500 : e.def.tech ? 2000 : e.def.cost || 300) * (e.def.role === 'power' || e.def.role === 'refinery' ? 1.5 : 1);
    // Measured like the blast: to a building's walls, to a unit's centre.
    const reach = (e, x, z) => (e.kind === 'building' ? Math.hypot(Math.max(e.rect.x0 - x, 0, x - e.rect.x1), Math.max(e.rect.z0 - z, 0, z - e.rect.z1)) : Math.hypot(e.x - x, e.z - z));
    // Aim points: every target, and the midpoint of every pair close enough to be caught together.
    const points = targets.map((e) => ({ x: e.x, z: e.z }));
    for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i], b = targets[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) < 2 * R + 8) points.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    }
    let best = null, bestScore = w.kind === 'nuke' ? 2000 : 1200;
    for (const p of points) {
      let score = 0;
      for (const e of targets) if (reach(e, p.x, p.z) <= R * 0.9) score += worth(e);
      for (const e of eyes) if (reach(e, p.x, p.z) <= R + 4) score -= 2 * worth(e);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  sectorAt(x, z) {
    const c = (v) => Math.max(0, Math.min(SECTORS - 1, Math.floor(v / SECTOR)));
    return c(z) * SECTORS + c(x);
  }

  manageDefense() {
    const g = this.g, T = g.teams[this.team], hq = this.hq;
    const la = T.lastAttacked;
    if (!hq || !la || g.time - la.t > 6 || g.time - this.lastDefend < 5) return;
    if (Math.hypot(la.x - hq.x, la.z - hq.z) > 60) return;
    this.lastDefend = g.time;
    for (const u of this.armyIdle()) u.cmdMove(la.x, la.z, true);
  }
}
