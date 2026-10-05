import { SIZE, canRepair } from './config.js';
import { findPath, clearLine } from './pathfinding.js';
import { buildUnitModel } from './models.js';
import { RANKS, isCombatUnit } from './experience.js';

let NEXT_ID = 1;
export const nextId = () => NEXT_ID++;
const TAU = Math.PI * 2;
export function angleDiff(to, from) {
  let d = to - from;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Unit {
  constructor(game, def, x, z, team) {
    this.kind = 'unit';
    this.game = game; this.def = def; this.id = nextId(); this.team = team;
    this.x = x; this.z = z;
    this.heading = Math.atan2(SIZE / 2 - x, SIZE / 2 - z);
    this.aim = this.heading;
    this.hp = this.maxHp = def.hp;
    this.kills = 0; this.rank = 0; this.damageMultiplier = 1;
    this.radius = def.radius; this.cls = def.cls;
    this.order = { type: def.harvester ? 'harvest' : 'idle' };
    this.path = null; this.pathI = 0; this.dest = null; this.navVer = 0;
    this.target = null; this.guard = { x, z };
    this.cooldown = Math.random() * 0.5; this.scanT = Math.random() * 0.4; this.repathT = 0;
    this.stuckT = 0; this.stuckCount = 0; this.lastPX = x; this.lastPZ = z;
    this.moving = false; this.anim = Math.random() * 10; this.walk = 0; this.recoil = 0;
    this.selected = false; this.dead = false; this.lastHit = -99;
    this.speedMul = 1;
    // cosechadora
    this.load = 0; this.hstate = 'idle'; this.field = null; this.refinery = null; this.waitT = 0;

    const m = buildUnitModel(def, team);
    this.mesh = m.group; this.parts = m.parts;
    game.scene.add(this.mesh);
    this.syncMesh(0);
  }

  recordKill(victim) {
    if (this.dead || !isCombatUnit(this) || victim.kind !== 'unit' || victim.team === this.team) return;
    this.kills++;
    const nextRank = this.kills >= RANKS[2].kills ? 2 : this.kills >= RANKS[1].kills ? 1 : 0;
    if (nextRank === this.rank) return;
    const healthFraction = clamp(this.hp / this.maxHp, 0, 1);
    this.rank = nextRank;
    const bonus = RANKS[this.rank];
    this.damageMultiplier = bonus.damage;
    this.maxHp = this.def.hp * bonus.health;
    this.hp = this.maxHp * healthFraction;
    if (this.team === this.game.player && !this.game.spectate) {
      this.game.emit('toast', { text: `${this.def.name}: rango ${bonus.name}`, kind: 'info' });
    }
  }

  // ------------------------------------------------------------- órdenes
  cmdMove(x, z, attackMove = false) {
    if (this.def.harvester) attackMove = false;
    this.order = { type: attackMove ? 'attackmove' : 'move', x, z };
    this.target = null;
    if (!this.pathTo(x, z)) this.becomeIdle();
  }
  cmdAttack(t) {
    if (!this.def.weapon) { this.cmdMove(t.x, t.z); return; }
    this.order = { type: 'attack', target: t };
    this.target = t; this.path = null; this.dest = null; this.repathT = 0;
  }
  cmdRepair(t) {
    if (!canRepair(this, t)) { this.cmdMove(t.x, t.z); return; }
    this.order = { type: 'repair', target: t };
    this.target = t; this.path = null; this.dest = null; this.repathT = 0;
  }
  cmdStop() {
    this.becomeIdle();
    if (this.def.harvester) { this.order = { type: 'idle' }; }
  }
  cmdHarvest(field) {
    if (!this.def.harvester) return;
    this.order = { type: 'harvest', field };
    this.field = field; this.path = null;
    this.hstate = this.load >= this.def.capacity * 0.98 ? 'return' : 'idle';
  }
  cmdReturn(refinery) {
    if (!this.def.harvester) return;
    this.order = { type: 'harvest', field: this.field };
    this.refinery = refinery; this.hstate = 'return'; this.path = null;
  }
  becomeIdle() {
    this.order = { type: 'idle' };
    this.path = null; this.dest = null; this.target = null;
    this.guard = { x: this.x, z: this.z };
  }

  pathTo(x, z, recovering = false) {
    this.dest = { x, z };
    this.path = findPath(this.game.map.grid, this.x, this.z, x, z, this.radius);
    this.pathI = 0; this.navVer = this.game.navVersion; this.stuckT = 0;
    if (!recovering) this.stuckCount = 0;
    this.lastPX = this.x; this.lastPZ = this.z;
    return !!this.path;
  }

  // ----------------------------------------------------------- movimiento
  tryMove(nx, nz) {
    const g = this.game, r = this.radius;
    if (g.canStand(nx, nz, r)) { this.x = nx; this.z = nz; return true; }
    if (g.canStand(nx, this.z, r)) { this.x = nx; return true; }
    if (g.canStand(this.x, nz, r)) { this.z = nz; return true; }
    return false;
  }

  followPath(dt) {
    if (!this.path) return true;
    const g = this.game;
    if (this.navVer !== g.navVersion) {
      this.navVer = g.navVersion;
      if (this.dest) this.pathTo(this.dest.x, this.dest.z, true);
      if (!this.path) return true;
    }
    let wp = this.path[this.pathI];
    let dx = wp.x - this.x, dz = wp.z - this.z, d = Math.hypot(dx, dz);
    const last = this.pathI === this.path.length - 1;
    const next = this.path[this.pathI + 1];
    const canSkip = !next || clearLine(g.map.grid, this.x, this.z, next.x, next.z, this.radius);
    if (d < (last ? 0.5 : .35) && canSkip) {
      this.pathI++;
      if (this.pathI >= this.path.length) { this.path = null; return true; }
      wp = this.path[this.pathI]; dx = wp.x - this.x; dz = wp.z - this.z; d = Math.hypot(dx, dz);
    }
    const diff = angleDiff(Math.atan2(dx, dz), this.heading);
    const maxTurn = this.def.turn * dt;
    this.heading += clamp(diff, -maxTurn, maxTurn);
    let sp = this.def.speed * this.speedMul;
    const ad = Math.abs(diff);
    if (ad > 0.5 && this.def.turn < 4) sp *= Math.max(0.15, 1 - ad / 1.6);
    const step = Math.min(sp * dt, d);
    const oldX = this.x, oldZ = this.z;
    // Turn on the spot if the curved approach would leave the safe path at a corner.
    const nx = this.x + Math.sin(this.heading) * step, nz = this.z + Math.cos(this.heading) * step;
    if (clearLine(g.map.grid, this.x, this.z, nx, nz, this.radius) && clearLine(g.map.grid, nx, nz, wp.x, wp.z, this.radius)) this.tryMove(nx, nz);
    else if (Math.abs(diff) < .1) this.tryMove(nx, nz);
    this.moving = Math.hypot(this.x - oldX, this.z - oldZ) > .0001;

    this.stuckT += dt;
    if (this.stuckT >= 0.5) {
      const moved = Math.hypot(this.x - this.lastPX, this.z - this.lastPZ);
      this.stuckT = 0; this.lastPX = this.x; this.lastPZ = this.z;
      if (moved < this.def.speed * 0.12) {
        this.stuckCount++;
        if ((this.stuckCount === 2 || this.stuckCount === 4) && this.dest) this.pathTo(this.dest.x, this.dest.z, true);
        else if (this.stuckCount >= 7) { this.path = null; return true; }
      } else this.stuckCount = 0;
    }
    return false;
  }

  separate(dt) {
    const g = this.game;
    const near = g.queryUnits(this.x, this.z, this.radius + 2.4);
    let px = 0, pz = 0;
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o === this || o.dead) continue;
      const dx = this.x - o.x, dz = this.z - o.z, min = this.radius + o.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      const w = (o.moving && !this.moving) ? 1 : (this.moving && !o.moving ? 0.25 : 0.5);
      if (d < 0.01) { px += (Math.random() - 0.5) * 0.4; pz += (Math.random() - 0.5) * 0.4; }
      else { px += (dx / d) * (min - d) * w; pz += (dz / d) * (min - d) * w; }
    }
    if (px !== 0 || pz !== 0) {
      const k = Math.min(1, dt * 9);
      const nx = this.x + px * k, nz = this.z + pz * k;
      if (g.canStand(nx, nz, this.radius)) { this.x = nx; this.z = nz; }
      else if (g.canStand(nx, this.z, this.radius)) this.x = nx;
      else if (g.canStand(this.x, nz, this.radius)) this.z = nz;
    }
  }

  // --------------------------------------------------------------- combate
  scan(dt, radius) {
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 0.3 + Math.random() * 0.2;
    const t = this.game.findTarget(this, radius);
    if (t) this.target = t;
    else if (this.order.type !== 'attack') this.target = null;
  }

  faceTarget(t, dt) {
    const want = Math.atan2(t.x - this.x, t.z - this.z);
    this.aimed = true;
    if (this.def.turret) {
      const diff = angleDiff(want, this.aim), mx = this.def.turretTurn * dt;
      this.aim += clamp(diff, -mx, mx);
      return Math.abs(angleDiff(want, this.aim)) < 0.12;
    }
    const diff = angleDiff(want, this.heading), mx = this.def.turn * dt;
    this.heading += clamp(diff, -mx, mx);
    this.aim = this.heading;
    return Math.abs(angleDiff(want, this.heading)) < 0.12;
  }

  tryFire(t, dt) {
    const aligned = this.faceTarget(t, dt);
    if (aligned && this.cooldown <= 0) {
      const w = this.def.weapon;
      this.cooldown = w.cd * (0.9 + Math.random() * 0.2);
      this.game.fx.fireWeapon(this, t);
    }
  }

  approachPoint(t) {
    if (t.kind === 'building') {
      const r = t.rect;
      const px = clamp(this.x, r.x0, r.x1), pz = clamp(this.z, r.z0, r.z1);
      const dx = this.x - px, dz = this.z - pz, d = Math.hypot(dx, dz) || 1;
      const off = Math.min(this.def.weapon.range * 0.7, d);
      return { x: px + (dx / d) * off, z: pz + (dz / d) * off };
    }
    return { x: t.x, z: t.z };
  }

  // Dispara si está en rango; si no, persigue.
  engage(dt) {
    const t = this.target, w = this.def.weapon, g = this.game;
    const d = g.distTo(this, t);
    if (d <= w.range) {
      this.path = null; this.dest = null;
      this.tryFire(t, dt);
    } else {
      this.repathT -= dt;
      if (!this.path || this.repathT <= 0) {
        this.repathT = 0.8;
        const p = this.approachPoint(t);
        this.pathTo(p.x, p.z);
      }
      this.followPath(dt);
    }
  }

  updateCombat(dt) {
    const o = this.order, w = this.def.weapon, g = this.game;
    if (this.target && this.target.dead) this.target = null;
    switch (o.type) {
      case 'idle': {
        if (!w) break;
        this.scan(dt, Math.max(w.range, this.def.sight));
        if (this.target) {
          const d = g.distTo(this, this.target);
          if (d <= w.range) this.engage(dt);
          else if (d < this.def.sight && Math.hypot(this.x - this.guard.x, this.z - this.guard.z) < 22) this.engage(dt);
          else { this.target = null; if (Math.hypot(this.x - this.guard.x, this.z - this.guard.z) > 6) this.cmdMove(this.guard.x, this.guard.z); }
        }
        break;
      }
      case 'move': {
        if (this.followPath(dt)) this.becomeIdle();
        if (w && this.def.fireOnMove) {
          this.scan(dt, w.range);
          if (this.target && g.distTo(this, this.target) <= w.range) this.tryFire(this.target, dt);
        }
        break;
      }
      case 'attackmove': {
        if (!this.target) this.scan(dt, Math.max(w ? w.range : 0, this.def.sight));
        if (this.target) this.engage(dt);
        else {
          if (!this.path && !this.pathTo(o.x, o.z)) { this.becomeIdle(); break; }
          if (this.followPath(dt)) this.becomeIdle();
        }
        break;
      }
      case 'attack': {
        if (!o.target || o.target.dead) { this.becomeIdle(); break; }
        this.target = o.target;
        this.engage(dt);
        break;
      }
    }
  }

  // -------------------------------------------------------- médico / reparador
  // Aliado compatible más dañado (en proporción) dentro del radio.
  findPatient(radius) {
    let best = null, bestF = 0.999;
    const q = this.game.queryUnits(this.x, this.z, radius + 2);
    for (let i = 0; i < q.length; i++) {
      const u = q[i];
      if (!canRepair(this, u) || Math.hypot(u.x - this.x, u.z - this.z) > radius) continue;
      const f = u.hp / u.maxHp;
      if (f < bestF) { bestF = f; best = u; }
    }
    return best;
  }

  // Cura si está a su alcance; si no, se acerca. Devuelve false cuando el paciente ya no lo necesita.
  tend(dt) {
    const t = this.target, r = this.def.repair, g = this.game;
    if (!t || !canRepair(this, t) || t.hp >= t.maxHp) { this.target = null; return false; }
    const d = Math.hypot(t.x - this.x, t.z - this.z) - t.radius - this.radius;
    if (d <= r.range) {
      this.path = null; this.dest = null;
      this.faceTarget(t, dt);
      t.hp = Math.min(t.maxHp, t.hp + r.rate * dt);
      if (this.cooldown <= 0) { this.cooldown = 0.3; g.fx.repairBeam(this, t); }
      this.healing = true;
    } else {
      this.repathT -= dt;
      if (!this.path || this.repathT <= 0) { this.repathT = 0.8; this.pathTo(t.x, t.z); }
      this.followPath(dt);
    }
    return true;
  }

  updateSupport(dt) {
    const o = this.order, sight = this.def.sight;
    switch (o.type) {
      case 'idle': {
        this.scanT -= dt;
        if (!this.target && this.scanT <= 0) {
          this.scanT = 0.4 + Math.random() * 0.2;
          this.target = this.findPatient(sight);
        }
        // No se aleja demasiado de su posición de guardia.
        if (this.target && Math.hypot(this.target.x - this.guard.x, this.target.z - this.guard.z) > 22) this.target = null;
        if (this.tend(dt)) break;
        if (!this.path && Math.hypot(this.x - this.guard.x, this.z - this.guard.z) > 6) this.pathTo(this.guard.x, this.guard.z);
        if (this.path) this.followPath(dt);
        break;
      }
      case 'move': {
        if (this.followPath(dt)) this.becomeIdle();
        break;
      }
      case 'attackmove': {
        // Avanza con el grupo y se detiene a atender a los heridos que encuentra.
        this.scanT -= dt;
        if (!this.target && this.scanT <= 0) { this.scanT = 0.4 + Math.random() * 0.2; this.target = this.findPatient(sight); }
        if (this.tend(dt)) break;
        if (!this.path && !this.pathTo(o.x, o.z)) { this.becomeIdle(); break; }
        if (this.followPath(dt)) this.becomeIdle();
        break;
      }
      case 'repair': {
        this.target = o.target;
        if (!this.tend(dt)) this.becomeIdle();
        break;
      }
    }
  }

  // ------------------------------------------------------------ cosechadora
  updateHarvester(dt) {
    const g = this.game, d = this.def, o = this.order;
    if (o.type !== 'harvest') {
      if (o.type === 'move' && this.followPath(dt)) this.becomeIdle();
      return;
    }
    switch (this.hstate) {
      case 'idle': {
        if (this.waitT > 0) { this.waitT -= dt; break; }
        if (this.load >= d.capacity * 0.98) { this.hstate = 'return'; break; }
        let f = o.field && o.field.amount > 20 ? o.field : null;
        if (!f) f = g.nearestField(this.x, this.z);
        if (!f) { if (this.load > 0) this.hstate = 'return'; else this.waitT = 2; break; }
        this.field = f; o.field = f;
        const a = Math.random() * TAU, rr = Math.random() * f.r * 0.6;
        if (!this.pathTo(f.x + Math.cos(a) * rr, f.z + Math.sin(a) * rr)) { this.waitT = 1; break; }
        this.hstate = 'toField';
        break;
      }
      case 'toField': {
        const f = this.field;
        if (!f || f.amount <= 5) { this.hstate = 'idle'; this.path = null; break; }
        const arrived = this.followPath(dt);
        if (arrived || Math.hypot(this.x - f.x, this.z - f.z) < f.r * 0.55) {
          this.path = null;
          if (Math.hypot(this.x - f.x, this.z - f.z) > f.r + 4) { this.hstate = 'idle'; this.waitT = 1; }
          else this.hstate = 'gather';
        }
        break;
      }
      case 'gather': {
        const f = this.field;
        if (!f || f.amount <= 0) { this.hstate = this.load > 0 ? 'return' : 'idle'; break; }
        const amt = Math.min(d.gatherRate * dt, f.amount, d.capacity - this.load);
        f.amount -= amt; this.load += amt;
        const diff = angleDiff(Math.atan2(f.x - this.x, f.z - this.z), this.heading);
        this.heading += clamp(diff, -2 * dt, 2 * dt);
        if (Math.random() < dt * 8) g.fx.spawn(this.x + Math.sin(this.heading) * 2, 0.8, this.z + Math.cos(this.heading) * 2, (Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.5, 0.3, 0.05, [0.4, 1, 0.8], [0.1, 0.5, 0.4], 8, 0.5);
        this.gathering = true;
        if (this.load >= d.capacity - 0.5 || f.amount <= 0) this.hstate = 'return';
        break;
      }
      case 'return': {
        let r = this.refinery && !this.refinery.dead ? this.refinery : g.nearestRefinery(this.team, this.x, this.z);
        if (!r) { this.waitT = 1.5; this.hstate = 'noref'; break; }
        this.refinery = r;
        if (!this.pathTo(r.dock.x, r.dock.z)) { this.waitT = 1; this.hstate = 'noref'; break; }
        this.hstate = 'toRefinery';
        break;
      }
      case 'noref': {
        this.waitT -= dt;
        if (this.waitT <= 0) this.hstate = 'return';
        break;
      }
      case 'toRefinery': {
        const r = this.refinery;
        if (!r || r.dead) { this.refinery = null; this.hstate = 'return'; break; }
        const arrived = this.followPath(dt);
        if (arrived || g.distTo(this, r) <= 3.4) { this.path = null; this.hstate = 'unload'; }
        break;
      }
      case 'unload': {
        const r = this.refinery;
        if (!r || r.dead) { this.refinery = null; this.hstate = 'return'; break; }
        const amt = Math.min(this.load, d.unloadRate * dt);
        this.load -= amt;
        g.addCredits(this.team, amt, this);
        if (this.load <= 0.01) { this.load = 0; this.hstate = 'idle'; this.refinery = null; }
        break;
      }
    }
  }

  // ----------------------------------------------------------------- ciclo
  update(dt) {
    this.cooldown -= dt;
    this.moving = false; this.aimed = false; this.gathering = false; this.healing = false;
    if (this.def.harvester) this.updateHarvester(dt);
    else if (this.def.repair) this.updateSupport(dt);
    else this.updateCombat(dt);
    this.separate(dt);
    if (!this.aimed) {
      if (this.def.turret) {
        const diff = angleDiff(this.heading, this.aim), mx = (this.def.turretTurn || 2) * dt;
        this.aim += clamp(diff, -mx, mx);
      } else this.aim = this.heading;
    }
    this.syncMesh(dt);
  }

  syncMesh(dt) {
    const g = this.game, m = this.mesh, p = this.parts, t = g.time;
    m.position.set(this.x, 0, this.z);
    m.rotation.y = this.heading;
    this.walk += ((this.moving ? 1 : 0) - this.walk) * Math.min(1, dt * 8);
    if (this.moving) this.anim += dt * this.def.speed * 1.5;
    const w = this.walk;
    if (p.legs) {
      p.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.anim + i * Math.PI) * 0.7 * w; });
      if (p.body) p.body.position.y = Math.abs(Math.sin(this.anim)) * 0.07 * w;
    }
    if (p.spider) p.spider.forEach((l, i) => {
      l.quaternion.copy(p.spiderRest[i]);
      l.rotateY(Math.sin(this.anim * 0.8 + (i % 2) * Math.PI) * 0.22 * w);
    });
    if (p.turret) p.turret.rotation.y = angleDiff(this.aim, this.heading);
    if (p.barrel) {
      this.recoil = Math.max(0, this.recoil - dt * 4);
      p.barrel.position.copy(p.barrelRest).addScaledVector(p.recoilAxis, -this.recoil * 0.4);
    }
    if (p.bob) {
      p.bob.position.y = p.bobBase + Math.sin(t * 3 + this.id) * 0.12;
      p.ring.rotation.y += dt * 6;
    }
    if (p.drill && (this.moving || this.gathering)) p.drill.rotation.z += dt * 9;
    if (p.fill) {
      const frac = clamp(this.load / this.def.capacity, 0, 1);
      p.fill.visible = frac > 0;
      p.fill.scale.y = frac;
      p.fill.position.y = p.fillBottom + (p.fillH * frac) / 2;
    }
    m.visible = g.isVisibleEntity(this);
  }
}
