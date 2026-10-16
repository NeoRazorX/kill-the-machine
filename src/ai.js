import { N, CELL, ROLE, other, canCapture, canRepairBuilding, visionRadius } from './config.js';

const SECTOR = 32; // lado en unidades de mundo de cada zona que explora el explorador
const SECTORS = N * CELL / SECTOR;

// IA de construcción, producción y ataque. Sirve para ambos bandos (modo espectador).
export class AI {
  constructor(game, team, diff) {
    this.g = game; this.team = team; this.enemy = other(team); this.diff = diff;
    this.acc = Math.random() * 0.5; this.think = diff.think;
    this.waveTimer = diff.firstWave; this.waveNo = 0;
    this.group = []; this.placeFail = 0; this.lastDefend = -99;
    this.scout = null; this.scoutGoal = null; this.scoutCorner = null; this.explored = new Set();
    // La IA no sabe en qué esquina empezó el rival: solo conoce lo que ha visto.
    const [ox, oz] = game.starts[team];
    this.corners = game.map.spawns.filter(([x, z]) => x !== ox || z !== oz).map(([x, z]) => ({ x: x * CELL, z: z * CELL }));
    this.known = new Set(); this.enemyBase = null;
    this.engineer = null; this.techRetry = 0;
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
    this.manageWaves(d);
    this.manageDefense();
    this.manageScout();
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
    const pw = T.power;
    const want = [];
    if (pw.use + 25 > pw.prod) want.push('power');
    if (!has('barracks')) want.push('barracks');
    if (!has('factory')) want.push('factory');
    if (n('refinery') < 2 && T.credits > 1300 && n('factory') >= 1) want.push('refinery');
    if (n('turret') < Math.min(1 + this.waveNo, 6) && has('barracks')) want.push('turret');
    if (T.credits > 2500 && n('factory') < 2) want.push('factory');
    if (T.credits > 1800 && n('barracks') < 2) want.push('barracks');
    if (pw.prod - pw.use < 60 && T.credits > 1500) want.push('power');
    if (T.credits > 3200 && n('turret') < 8) want.push('turret');
    for (const r of want) {
      const def = ROLE[team][r];
      if (T.credits < def.cost * 0.35) continue;
      if (g.startStruct(team, def.id)) break;
    }
  }

  placeStructure(def) {
    const g = this.g, hq = this.hq;
    if (!hq) return;
    const hcx = Math.floor(hq.x / CELL), hcz = Math.floor(hq.z / CELL);
    const R = 8 + this.placeFail * 2;
    let best = null, bestS = 1e9;
    const stage = this.stage();
    let field = null;
    if (def.role === 'refinery') {
      let bd = 1e9;
      for (const f of g.map.fields) { const d = Math.hypot(f.x - hq.x, f.z - hq.z); if (d < bd && d < 70) { bd = d; field = f; } }
    }
    for (let k = 0; k < 90; k++) {
      const cx = hcx + Math.round((Math.random() - 0.5) * 2 * R) - 1;
      const cz = hcz + Math.round((Math.random() - 0.5) * 2 * R) - 1;
      if (!g.canPlace(this.team, def, cx, cz, true)) continue;
      const px = (cx + def.w / 2) * CELL, pz = (cz + def.h / 2) * CELL;
      let s = Math.hypot(px - hq.x, pz - hq.z);
      if (def.role === 'turret' && stage) s = Math.hypot(px - stage.x, pz - stage.z) * 0.6 + Math.random() * 6;
      if (field) s = Math.hypot(px - field.x, pz - field.z) + Math.random() * 3;
      if (s < bestS) { bestS = s; best = { cx, cz }; }
    }
    if (best) { g.placeStruct(this.team, best.cx, best.cz); this.placeFail = 0; }
    else if (++this.placeFail >= 8) { g.cancelStruct(this.team); this.placeFail = 0; }
  }

  // ----------------------------------------------------------------- unidades
  manageUnits() {
    const g = this.g, team = this.team, T = g.teams[team];
    const st = this.stage();
    const producers = g.buildings.filter((b) => b.team === team && g.canProduceAt(b));
    for (const b of producers) if (st && !b.rally) b.rally = { x: st.x + (Math.random() - 0.5) * 10, z: st.z + (Math.random() - 0.5) * 10 };
    if (!producers.length) return;

    const harvDef = ROLE[team].harv;
    const refs = g.teamBuildings(team, 'refinery').length;
    const wantH = refs >= 2 ? 3 : 2;
    const haveH = g.units.filter((u) => u.team === team && !u.dead && u.def.harvester).length + g.queuedCount(team, harvDef.id);
    if (haveH < wantH && g.hasRole(team, 'factory') && T.credits >= 400) { g.queueUnit(team, harvDef.id); return; }

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
    return this.g.units.filter((u) => u.team === this.team && !u.dead && !u.def.harvester && (u.def.weapon || u.def.repair) && u !== this.scout && !this.group.includes(u) && (u.order.type === 'idle' || (u.order.type === 'move' && !u.path)));
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
    const hunting = !this.enemyBase && this.corners.length > 0;
    // Everyone knows how many tech structures the map holds, so the scout keeps looking for them.
    const unexplored = this.explored.size < SECTORS * SECTORS;
    const missingTech = g.techSites.items.some((b) => !b.tech.found[this.team]);
    const looting = (unexplored && (missingTech || crates.items.some((c) => !c.collected))) || crates.discoveredBy(this.team).length > 0;
    if (!hunting && !looting) { this.scout = null; return; }
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
    if (hunting) {
      // Keep heading to the same corner until it has been seen, so the scout never dithers.
      if (!this.corners.includes(this.scoutCorner)) this.scoutCorner = this.nearestCorner(s);
      const c = this.scoutCorner;
      if (s.order.type !== 'move' || s.order.x !== c.x || s.order.z !== c.z) s.cmdMove(c.x, c.z);
      this.scoutGoal = null;
      return;
    }
    let best = null, bd = 1e9;
    for (const c of crates.discoveredBy(this.team)) {
      const d = Math.hypot(c.x - s.x, c.z - s.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) {
      if (s.order.type !== 'move' || s.order.x !== best.x || s.order.z !== best.z) s.cmdMove(best.x, best.z);
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
