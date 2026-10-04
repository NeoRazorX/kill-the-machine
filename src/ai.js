import { N, CELL, ROLE, other } from './config.js';

// IA de construcción, producción y ataque. Sirve para ambos bandos (modo espectador).
export class AI {
  constructor(game, team, diff) {
    this.g = game; this.team = team; this.enemy = other(team); this.diff = diff;
    this.acc = Math.random() * 0.5; this.think = diff.think;
    this.waveTimer = diff.firstWave; this.waveNo = 0;
    this.group = []; this.placeFail = 0; this.lastDefend = -99;
  }

  update(dt) {
    this.acc += dt;
    if (this.acc < this.think) return;
    const d = this.acc; this.acc = 0;
    if (this.g.over) return;
    this.manageStructures();
    this.manageUnits();
    this.manageWaves(d);
    this.manageDefense();
  }

  get hq() {
    const l = this.g.teamBuildings(this.team);
    return l.find((b) => b.def.role === 'hq') || l[0] || null;
  }

  stage() {
    const hq = this.hq;
    if (!hq) return null;
    const e = this.g.teamBuildings(this.enemy)[0];
    const tx = e ? e.x : N * CELL / 2, tz = e ? e.z : N * CELL / 2;
    const dx = tx - hq.x, dz = tz - hq.z, d = Math.hypot(dx, dz) || 1;
    return { x: hq.x + (dx / d) * 34, z: hq.z + (dz / d) * 34 };
  }

  // -------------------------------------------------------------- estructuras
  manageStructures() {
    const g = this.g, team = this.team, T = g.teams[team];
    if (T.structQueue) {
      if (T.structQueue.ready) this.placeStructure(T.structQueue.def);
      return;
    }
    const has = (r) => g.hasRole(team, r);
    const n = (r) => g.teamBuildings(team, r).length;
    const pw = T.power;
    const want = [];
    if (pw.use + 25 > pw.prod) want.push('power');
    if (!has('barracks')) want.push('barracks');
    if (!has('factory') && has('refinery')) want.push('factory');
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
    const enemyB = g.teamBuildings(this.enemy)[0];
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
    const producers = g.buildings.filter((b) => b.team === team && !b.dead && b.complete && b.def.produces);
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
    if (g.hasRole(team, 'barracks')) choices.push([R.inf1, 0.34], [R.inf2, 0.26]);
    if (g.hasRole(team, 'factory')) choices.push([R.tank, 0.28], [R.arty, 0.12]);
    let tot = choices.reduce((a, c) => a + c[1], 0), acc = 0;
    for (const [def, w] of choices) {
      acc += w / tot;
      if (r <= acc) { if (T.credits >= def.cost * 0.5) g.queueUnit(team, def.id); break; }
    }
  }

  armyIdle() {
    return this.g.units.filter((u) => u.team === this.team && !u.dead && !u.def.harvester && u.def.weapon && !this.group.includes(u) && (u.order.type === 'idle' || (u.order.type === 'move' && !u.path)));
  }

  pickTarget(from) {
    const g = this.g;
    let best = null, bd = 1e9;
    for (const b of g.buildings) {
      if (b.team !== this.enemy || b.dead) continue;
      const d = Math.hypot(b.x - from.x, b.z - from.z) - (b.def.role === 'hq' ? 25 : 0) + (b.def.weapon ? 15 : 0);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) return { x: best.x, z: best.z };
    const u = g.units.find((e) => e.team === this.enemy && !e.dead);
    return u ? { x: u.x, z: u.z } : null;
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

  manageDefense() {
    const g = this.g, T = g.teams[this.team], hq = this.hq;
    const la = T.lastAttacked;
    if (!hq || !la || g.time - la.t > 6 || g.time - this.lastDefend < 5) return;
    if (Math.hypot(la.x - hq.x, la.z - hq.z) > 60) return;
    this.lastDefend = g.time;
    for (const u of this.armyIdle()) u.cmdMove(la.x, la.z, true);
  }
}
