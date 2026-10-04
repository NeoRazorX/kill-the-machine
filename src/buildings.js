import { CELL, TEAMS } from './config.js';
import { buildBuildingModel } from './models.js';
import { nextId, angleDiff } from './units.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Building {
  constructor(game, def, team, cx, cz, instant = false) {
    this.kind = 'building';
    this.game = game; this.def = def; this.id = nextId(); this.team = team;
    this.cx = cx; this.cz = cz; this.w = def.w; this.h = def.h;
    this.x = (cx + def.w / 2) * CELL; this.z = (cz + def.h / 2) * CELL;
    this.rect = { x0: cx * CELL, z0: cz * CELL, x1: (cx + def.w) * CELL, z1: (cz + def.h) * CELL };
    this.hp = this.maxHp = def.hp; this.cls = 'building';
    this.radius = Math.max(def.w, def.h) * CELL * 0.5;
    this.queue = []; this.rally = null;
    this.buildT = instant ? 1 : 0;
    this.selling = false; this.sellT = 0;
    this.selected = false; this.dead = false; this.lastHit = -99;
    this.cooldown = 0; this.target = null; this.scanT = Math.random() * 0.4; this.recoil = 0;
    this.fxT = Math.random(); this.seen = team === game.player || game.spectate;

    const front = TEAMS[team].front;
    this.front = front;
    this.dock = { x: this.x, z: this.z + front * (def.h * CELL / 2 + 2.6) };
    this.spawnPt = { x: this.x + (def.w > 2 ? CELL : 0) * 0.5, z: this.z + front * (def.h * CELL / 2 + 1.6) };

    const m = buildBuildingModel(def);
    this.mesh = m.group; this.parts = m.parts;
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = front < 0 ? Math.PI : 0;
    this.aim = Math.atan2(CELL * 64 - this.x, CELL * 64 - this.z);
    if (!instant) this.mesh.scale.y = 0.02;
    game.scene.add(this.mesh);
    this.mesh.visible = this.seen;
  }

  get complete() { return this.buildT >= 1 && !this.selling; }

  sell() {
    if (this.selling) return;
    this.selling = true; this.sellT = 0; this.queue = [];
  }

  update(dt) {
    const g = this.game, def = this.def, p = this.parts;
    if (this.buildT < 1) {
      this.buildT = Math.min(1, this.buildT + dt / 1.6);
      const t = this.buildT, e = 1 - Math.pow(1 - t, 3);
      this.mesh.scale.y = Math.max(0.02, e);
      if (Math.random() < dt * 14) g.fx.spawn(this.x + (Math.random() - 0.5) * def.w * CELL, 0.3, this.z + (Math.random() - 0.5) * def.h * CELL, (Math.random() - 0.5), 1.5, (Math.random() - 0.5), 0.9, 0.7, 1.6, [0.55, 0.5, 0.42], [0.3, 0.28, 0.25], -0.2, 1);
      this.syncVisible();
      return;
    }
    if (this.selling) {
      this.sellT += dt;
      this.mesh.scale.y = Math.max(0.02, 1 - this.sellT / 1.2);
      if (this.sellT >= 1.2) g.removeBuilding(this, 'sold');
      return;
    }
    const low = g.lowPower(this.team);
    if (def.produces) this.updateQueue(dt, low);
    if (def.weapon) this.updateTurret(dt, low);

    // animaciones decorativas
    if (p.dish) p.dish.rotation.y += dt * 1.2;
    if (p.crystal) { p.crystal.rotation.y += dt * 1.5; p.crystal.position.y = 5 + Math.sin(g.time * 2) * 0.15; }
    if (p.ring) { p.ring.rotation.z += dt * 1.8; }
    if (p.rings) p.rings.forEach((r, i) => { r.rotation.z += dt * (1.5 + i * 0.7); });

    // humo / fuego al estar dañado
    const frac = this.hp / this.maxHp;
    if (frac < 0.55) {
      this.fxT -= dt;
      if (this.fxT <= 0) {
        this.fxT = frac < 0.28 ? 0.12 : 0.35;
        g.fx.smoke(this.x + (Math.random() - 0.5) * this.w * CELL * 0.7, def.height * 0.7, this.z + (Math.random() - 0.5) * this.h * CELL * 0.7, 1 + (1 - frac), frac < 0.28);
      }
    }
    this.syncVisible();
  }

  syncVisible() {
    if (!this.seen && this.game.isVisibleEntity(this)) this.seen = true;
    this.mesh.visible = this.seen;
  }

  updateQueue(dt, low) {
    const it = this.queue[0];
    if (!it) return;
    const g = this.game, t = g.teams[this.team];
    const inc = Math.min(dt / it.def.time * (low ? 0.4 : 1), 1 - it.progress);
    const cost = it.def.cost * inc;
    if (t.credits >= cost) { t.credits -= cost; it.progress += inc; it.paid += cost; it.waiting = false; }
    else it.waiting = true;
    if (it.progress >= 0.9999) {
      this.queue.shift();
      g.spawnProduced(this, it.def);
    }
  }

  updateTurret(dt, low) {
    const g = this.game, w = this.def.weapon, p = this.parts;
    this.cooldown -= dt;
    if (this.target && (this.target.dead || g.distTo(this, this.target) > w.range + 1)) this.target = null;
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.3 + Math.random() * 0.2;
      const t = g.findTarget(this, w.range);
      if (t) this.target = t;
    }
    if (this.target) {
      const want = Math.atan2(this.target.x - this.x, this.target.z - this.z);
      const diff = angleDiff(want, this.aim), mx = 3.2 * dt;
      this.aim += clamp(diff, -mx, mx);
      if (Math.abs(angleDiff(want, this.aim)) < 0.12 && this.cooldown <= 0) {
        this.cooldown = w.cd * (low ? 2 : 1);
        g.fx.fireWeapon(this, this.target);
      }
    }
    if (p.turret) p.turret.rotation.y = angleDiff(this.aim, this.mesh.rotation.y);
    if (p.barrel) {
      this.recoil = Math.max(0, this.recoil - dt * 4);
      p.barrel.position.z = p.barrelZ - this.recoil * 0.35;
    }
  }
}
