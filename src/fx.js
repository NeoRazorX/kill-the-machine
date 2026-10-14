import * as THREE from 'three';

// Height of an arcing shell's flight over a horizontal distance d. Weapons with `lob` fly a flatter
// arc, so guns that elevate to fire it never need to point steeply up.
export const lobApex = (w, d) => (w.lob ? 1 + w.lob * d : Math.min(30, 4 + d * 0.28));
// Where shots aim on a target.
export const hitY = (t) => (t.kind === 'building' ? Math.max(0.8, t.def.height * 0.45) : t.def.height * 0.45);

const MAXP = 2200;
const FIRE0 = [1, 0.85, 0.35], FIRE1 = [0.55, 0.1, 0.02];
const SMOKE0 = [0.34, 0.34, 0.34], SMOKE1 = [0.1, 0.1, 0.1];
const DEBRIS0 = [0.25, 0.22, 0.2], DEBRIS1 = [0.1, 0.1, 0.1];
const SPARK0 = [1, 1, 0.7], SPARK1 = [1, 0.5, 0.1];
const GREEN0 = [0.5, 1, 0.8], GREEN1 = [0.1, 0.5, 0.4];
const RED0 = [1, 0.5, 0.4], RED1 = [0.6, 0.05, 0.05];

const PROJ_STYLE = {
  bullet:    { speed: 95, color: 0xffe9a0, geo: 'tracer', trail: null },
  laserbolt: { speed: 80, color: 0xff4a3a, geo: 'tracer', trail: null },
  rocket:    { speed: 34, color: 0xffffff, geo: 'rocket', trail: 'smoke', homing: true },
  shell:     { speed: 60, color: 0xffb040, geo: 'ball', size: 0.28, trail: null },
  plasma:    { speed: 44, color: 0xff5040, geo: 'ball', size: 0.38, trail: 'red' },
  arty:      { speed: 26, color: 0x2a2a2a, geo: 'ball', size: 0.4, trail: 'smoke', arc: true },
  plasmalob: { speed: 26, color: 0xff3a60, geo: 'ball', size: 0.5, trail: 'red', arc: true },
};

export class FX {
  constructor(game, scene) {
    this.game = game; this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);

    // partículas (SoA)
    this.n = 0;
    this.px = new Float32Array(MAXP); this.py = new Float32Array(MAXP); this.pz = new Float32Array(MAXP);
    this.vx = new Float32Array(MAXP); this.vy = new Float32Array(MAXP); this.vz = new Float32Array(MAXP);
    this.life = new Float32Array(MAXP); this.maxLife = new Float32Array(MAXP);
    this.s0 = new Float32Array(MAXP); this.s1 = new Float32Array(MAXP);
    this.c0 = new Float32Array(MAXP * 3); this.c1 = new Float32Array(MAXP * 3);
    this.grav = new Float32Array(MAXP); this.drag = new Float32Array(MAXP);
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    this.pm = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAXP);
    this.pm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3);
    this.pm.frustumCulled = false; this.pm.count = 0;
    this.group.add(this.pm);

    // destellos aditivos
    this.flashes = [];
    this.flashGeo = new THREE.SphereGeometry(1, 10, 8);
    // rayos
    this.beams = [];
    this.beamGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    // marcas de orden
    this.markers = [];
    this.markerGeo = new THREE.RingGeometry(0.55, 0.8, 24).rotateX(-Math.PI / 2);
    // quemaduras
    this.scorches = []; this.scorchIdx = 0;
    this.scorchGeo = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
    this.scorchMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    // proyectiles
    this.projectiles = [];
    this.projPool = {};
    this.tracerGeo = new THREE.BoxGeometry(0.1, 0.1, 1.1);
    this.rocketGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.8, 6).rotateX(Math.PI / 2);
    this.ballGeo = new THREE.SphereGeometry(1, 8, 6);
    this.delayed = [];
  }

  // ------------------------------------------------------------ partículas
  spawn(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, grav = 0, drag = 0) {
    if (this.n >= MAXP) return;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.c0.set(c0, i * 3); this.c1.set(c1, i * 3); this.grav[i] = grav; this.drag[i] = drag;
  }

  updateParticles(dt) {
    const arr = this.pm.instanceMatrix.array, col = this.pm.instanceColor.array;
    for (let i = 0; i < this.n;) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const l = --this.n;
        if (i !== l) {
          this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l];
          this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
          this.life[i] = this.life[l]; this.maxLife[i] = this.maxLife[l]; this.s0[i] = this.s0[l]; this.s1[i] = this.s1[l];
          this.grav[i] = this.grav[l]; this.drag[i] = this.drag[l];
          for (let k = 0; k < 3; k++) { this.c0[i * 3 + k] = this.c0[l * 3 + k]; this.c1[i * 3 + k] = this.c1[l * 3 + k]; }
        }
        continue;
      }
      const dr = 1 - Math.min(1, this.drag[i] * dt);
      this.vx[i] *= dr; this.vz[i] *= dr; this.vy[i] = this.vy[i] * dr - this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.05) { this.py[i] = 0.05; this.vy[i] *= -0.3; this.vx[i] *= 0.6; this.vz[i] *= 0.6; }
      const t = 1 - this.life[i] / this.maxLife[i];
      const s = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const o = i * 16;
      arr[o] = s; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = s; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = s; arr[o + 11] = 0;
      arr[o + 12] = this.px[i]; arr[o + 13] = this.py[i]; arr[o + 14] = this.pz[i]; arr[o + 15] = 1;
      for (let k = 0; k < 3; k++) col[i * 3 + k] = this.c0[i * 3 + k] + (this.c1[i * 3 + k] - this.c0[i * 3 + k]) * t;
      i++;
    }
    this.pm.count = this.n;
    this.pm.instanceMatrix.needsUpdate = true;
    this.pm.instanceColor.needsUpdate = true;
  }

  // --------------------------------------------------------------- efectos
  flash(x, y, z, size, color = 0xffaa40, life = 0.25) {
    let f = this.flashes.find((q) => q.life <= 0);
    if (!f) {
      if (this.flashes.length > 30) return;
      const m = new THREE.Mesh(this.flashGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.group.add(m);
      f = { mesh: m, life: 0 }; this.flashes.push(f);
    }
    f.mesh.material.color.setHex(color);
    f.mesh.position.set(x, y, z); f.size = size; f.life = f.max = life; f.mesh.visible = true;
  }

  explosion(x, y, z, size = 1.5) {
    this.flash(x, y + 0.5, z, size * 1.4, 0xffa040, 0.3);
    const nf = Math.round(5 + size * 5);
    for (let i = 0; i < nf; i++) {
      const a = Math.random() * 6.28, sp = Math.random() * size * 3;
      this.spawn(x, y + 0.3, z, Math.cos(a) * sp, Math.random() * size * 2.5, Math.sin(a) * sp, 0.35 + Math.random() * 0.45, size * 0.7, size * 0.1, FIRE0, FIRE1, 2, 1.5);
    }
    const ns = Math.round(3 + size * 3);
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * 6.28, sp = Math.random() * size * 1.2;
      this.spawn(x, y + 0.5, z, Math.cos(a) * sp, 1 + Math.random() * 2, Math.sin(a) * sp, 1 + Math.random() * 1.3, size * 0.5, size * 1.5, SMOKE0, SMOKE1, -0.5, 1.2);
    }
    const nd = Math.round(3 + size * 2);
    for (let i = 0; i < nd; i++) {
      const a = Math.random() * 6.28, sp = size * (1.5 + Math.random() * 3);
      this.spawn(x, y + 0.3, z, Math.cos(a) * sp, 3 + Math.random() * size * 3, Math.sin(a) * sp, 0.8 + Math.random() * 0.6, 0.18 + Math.random() * 0.2, 0.15, DEBRIS0, DEBRIS1, 16, 0.3);
    }
  }

  bigExplosion(cx, cz, w, h, height) {
    const n = Math.round(6 + (w * h) / 3);
    for (let i = 0; i < n; i++) {
      this.delayed.push({
        t: i * 0.12 + Math.random() * 0.1,
        fn: () => this.explosion(cx + (Math.random() - 0.5) * w, Math.random() * height * 0.8, cz + (Math.random() - 0.5) * h, 2 + Math.random() * 2.5),
      });
    }
    this.scorch(cx, cz, Math.max(w, h) * 0.75, 0.55);
  }

  smoke(x, y, z, size = 0.7, fire = false) {
    this.spawn(x, y, z, (Math.random() - 0.5) * 0.6, 1.5 + Math.random(), (Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 0.8, size * 0.5, size * 1.6, fire ? FIRE0 : SMOKE0, fire ? FIRE1 : SMOKE1, -0.3, 0.8);
  }

  muzzle(x, y, z, big = false) {
    this.flash(x, y, z, big ? 0.9 : 0.45, 0xffd070, 0.08);
    for (let i = 0; i < (big ? 4 : 2); i++) {
      this.spawn(x, y, z, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 0.2, 0.25, 0.05, SPARK0, SPARK1, 0, 2);
    }
  }

  hitSpark(x, y, z, red = false) {
    for (let i = 0; i < 3; i++) {
      this.spawn(x, y, z, (Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5, 0.25, 0.2, 0.04, red ? RED0 : SPARK0, red ? RED1 : SPARK1, 10, 1);
    }
  }

  scorch(x, z, r, op = 0.5) {
    let s = this.scorches[this.scorchIdx];
    if (!s) {
      const m = new THREE.Mesh(this.scorchGeo, this.scorchMat.clone());
      m.renderOrder = 1;
      this.group.add(m);
      s = { mesh: m, life: 0 }; this.scorches[this.scorchIdx] = s;
    }
    this.scorchIdx = (this.scorchIdx + 1) % 48;
    s.life = s.max = 40; s.op = op;
    s.mesh.position.set(x, 0.04, z);
    s.mesh.scale.set(r, 1, r);
    s.mesh.rotation.y = Math.random() * 6;
    s.mesh.visible = true;
  }

  marker(x, z, kind = 'move') {
    let m = this.markers.find((q) => q.life <= 0);
    if (!m) {
      const mesh = new THREE.Mesh(this.markerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
      this.group.add(mesh);
      m = { mesh, life: 0 }; this.markers.push(m);
    }
    m.mesh.material.color.setHex(kind === 'attack' ? 0xff4040 : kind === 'rally' ? 0xffd040 : 0x50ff90);
    m.mesh.position.set(x, 0.12, z);
    m.life = m.max = 0.7; m.mesh.visible = true;
  }

  beam(x0, y0, z0, x1, y1, z1, color, width = 1) {
    let b = this.beams.find((q) => q.life <= 0);
    if (!b) {
      const mesh = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.group.add(mesh);
      b = { mesh, life: 0 }; this.beams.push(b);
    }
    b.mesh.material.color.setHex(color);
    b.mesh.position.set(x0, y0, z0);
    b.mesh.lookAt(x1, y1, z1);
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    b.width = width;
    b.mesh.scale.set(width, width, len);
    b.life = b.max = 0.16; b.mesh.visible = true;
  }

  // Haz de curación (infantería) o arco de soldadura (vehículos) desde el emisor del sanador.
  repairBeam(src, t) {
    let x0 = src.x, y0 = src.def.height * 0.6, z0 = src.z;
    const muzzle = src.parts.muzzle;
    if (muzzle) {
      src.mesh.position.set(src.x, 0, src.z);
      src.mesh.rotation.y = src.heading;
      muzzle.updateWorldMatrix(true, false);
      const e = muzzle.matrixWorld.elements;
      x0 = e[12]; y0 = e[13]; z0 = e[14];
    }
    const x1 = t.x + (Math.random() - 0.5) * t.radius, y1 = this.hitY(t) + (Math.random() - 0.3) * 0.5, z1 = t.z + (Math.random() - 0.5) * t.radius;
    if (!this.game.isVisibleEntity(src) && !this.game.isVisibleEntity(t)) return;
    const weld = src.def.repair.targets === 'factory';
    this.beam(x0, y0, z0, x1, y1, z1, weld ? 0xffc860 : 0x60ffb0, weld ? 0.7 : 0.9);
    for (let i = 0; i < 3; i++) {
      if (weld) this.spawn(x1, y1, z1, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 0.3, 0.18, 0.04, SPARK0, SPARK1, 9, 1);
      else this.spawn(x1 + (Math.random() - 0.5) * 0.6, y1, z1 + (Math.random() - 0.5) * 0.6, 0, 1.2 + Math.random(), 0, 0.6, 0.22, 0.05, GREEN0, GREEN1, 0, 0.5);
    }
  }

  // ----------------------------------------------------------- proyectiles
  acquireProj(style) {
    const key = style.geo + style.color;
    const pool = this.projPool[key] || (this.projPool[key] = []);
    let m = pool.pop();
    if (!m) {
      const geo = style.geo === 'tracer' ? this.tracerGeo : style.geo === 'rocket' ? this.rocketGeo : this.ballGeo;
      m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: style.color }));
      m.userData.key = key;
      this.group.add(m);
    }
    m.visible = true;
    if (style.geo === 'ball') m.scale.setScalar(style.size);
    return m;
  }

  hitY(t) { return hitY(t); }

  fireWeapon(att, target) {
    const w = att.def.weapon, style = PROJ_STYLE[w.proj];
    const aim = att.aim;
    // Combat runs before syncMesh: synchronize the pose before reading the authored socket.
    att.mesh.position.set(att.x, 0, att.z);
    if (att.kind === 'unit') att.mesh.rotation.y = att.heading;
    if (att.parts.turret) att.parts.turret.rotation.y = aim - att.mesh.rotation.y;
    // Twin guns take turns.
    const twins = att.parts.muzzles;
    const muzzle = twins ? twins[att.shot = ((att.shot ?? -1) + 1) % twins.length] : att.parts.muzzle;
    muzzle.updateWorldMatrix(true, false);
    const e = muzzle.matrixWorld.elements;
    const mx = e[12], my = e[13], mz = e[14];
    const sp = target.kind === 'building' ? 1.2 : 0.35;
    const tx = target.x + (Math.random() - 0.5) * sp, tz = target.z + (Math.random() - 0.5) * sp, ty = this.hitY(target);
    att.recoil = 1;
    const big = w.proj === 'shell' || w.proj === 'plasma' || w.proj === 'arty' || w.proj === 'plasmalob';
    this.muzzle(mx, my, mz, big);
    const sfx = { bullet: 'rifle', laserbolt: 'zap', rocket: 'rocket', shell: 'cannon', plasma: 'plasma', arty: 'howitzer', plasmalob: 'howitzer', beam: 'laser' }[w.proj];
    this.game.audio.play(sfx, att.x, att.z);

    const p = {
      type: w.proj, x: mx, y: my, z: mz, tx, ty, tz, target, weapon: w, team: att.team, srcDef: att.def,
      source: att, dmg: w.damage * (att.damageMultiplier ?? 1), splash: w.splash || 0, life: 0,
    };
    if (w.proj === 'beam') {
      this.beam(mx, my, mz, tx, ty, tz, 0xff3a2a, 1.4);
      this.game.impact(p);
      return;
    }
    p.style = style;
    p.mesh = this.acquireProj(style);
    p.speed = style.speed;
    if (style.arc) {
      const d = Math.hypot(tx - mx, tz - mz);
      p.sx = mx; p.sy = my; p.sz = mz;
      p.T = Math.max(0.6, d / style.speed); p.t = 0; p.apex = lobApex(w, d);
    }
    p.mesh.position.set(mx, my, mz);
    this.projectiles.push(p);
  }

  releaseProj(p) {
    p.mesh.visible = false;
    this.projPool[p.mesh.userData.key].push(p.mesh);
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i], st = p.style;
      p.life += dt;
      let hit = false;
      const ox = p.x, oy = p.y, oz = p.z;
      if (st.arc) {
        p.t += dt / p.T;
        const t = Math.min(1, p.t);
        p.x = p.sx + (p.tx - p.sx) * t; p.z = p.sz + (p.tz - p.sz) * t;
        p.y = p.sy + (p.ty - p.sy) * t + Math.sin(t * Math.PI) * p.apex;
        hit = t >= 1;
      } else {
        if (st.homing && p.target && !p.target.dead) { p.tx = p.target.x; p.tz = p.target.z; }
        const dx = p.tx - p.x, dy = p.ty - p.y, dz = p.tz - p.z, d = Math.hypot(dx, dy, dz);
        const step = st.speed * dt;
        if (d <= step + 0.15) { p.x = p.tx; p.y = p.ty; p.z = p.tz; hit = true; }
        else { p.x += (dx / d) * step; p.y += (dy / d) * step; p.z += (dz / d) * step; }
        if (p.life > 6) hit = true;
      }
      p.mesh.position.set(p.x, p.y, p.z);
      if (st.geo !== 'ball') p.mesh.lookAt(p.x + (p.x - ox) + 1e-4, p.y + (p.y - oy), p.z + (p.z - oz));
      if (st.trail && Math.random() < 0.9) {
        if (st.trail === 'smoke') this.spawn(p.x, p.y, p.z, 0, 0.2, 0, 0.7, 0.3, 0.7, SMOKE0, SMOKE1, 0, 1);
        else this.spawn(p.x, p.y, p.z, 0, 0, 0, 0.3, 0.35, 0.05, RED0, RED1, 0, 0);
      }
      if (hit) {
        this.projectiles.splice(i, 1);
        this.releaseProj(p);
        this.game.impact(p);
      }
    }
  }

  update(dt) {
    this.updateParticles(dt);
    this.updateProjectiles(dt);
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const t = Math.max(0, f.life / f.max);
      f.mesh.scale.setScalar(f.size * (1.3 - 0.3 * t));
      f.mesh.material.opacity = t * 0.9;
      if (f.life <= 0) f.mesh.visible = false;
    }
    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const t = Math.max(0, b.life / b.max);
      b.mesh.scale.x = b.mesh.scale.y = b.width * t;
      b.mesh.material.opacity = t;
      if (b.life <= 0) b.mesh.visible = false;
    }
    for (const m of this.markers) {
      if (m.life <= 0) continue;
      m.life -= dt;
      const t = Math.max(0, m.life / m.max);
      m.mesh.scale.setScalar(1.8 - t * 1.0);
      m.mesh.material.opacity = t;
      if (m.life <= 0) m.mesh.visible = false;
    }
    for (const s of this.scorches) {
      if (!s || s.life <= 0) continue;
      s.life -= dt;
      s.mesh.material.opacity = s.op * Math.min(1, s.life / 12);
      if (s.life <= 0) s.mesh.visible = false;
    }
    for (let i = this.delayed.length - 1; i >= 0; i--) {
      const d = this.delayed[i];
      d.t -= dt;
      if (d.t <= 0) { this.delayed.splice(i, 1); d.fn(); }
    }
  }
}
