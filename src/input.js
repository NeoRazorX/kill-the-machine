import * as THREE from 'three';
import { SIZE, CELL, N, PLAYER, other, canRepair, canCapture, buildingFront } from './config.js';
import { buildBuildingModel } from './models.js';
import { concreteTexture, CONCRETE_TILE, SLAB_MARGIN } from './foundations.js';
import { nearestFreeCell } from './pathfinding.js';

const PITCH = 0.98;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Input {
  constructor(game, camera, renderer, sun) {
    this.game = game; this.camera = camera; this.dom = renderer.domElement; this.sun = sun;
    this.target = { x: SIZE / 2, z: SIZE / 2 }; this.dist = 70;
    this.sel = []; this.groups = {}; this.lastGroupKey = null; this.lastGroupT = 0;
    this.placing = null; this.ghost = null; this.attackMode = false; this.superTarget = null;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, inside: false };
    this.drag = null; this.pan = null; this.hover = null;
    this.lastClick = { t: 0, id: -1 };
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.box = new THREE.Box3(); this.tmp = new THREE.Vector3(); this.tmp2 = new THREE.Vector3();
    this.ui = null;
    this.onSelectionChange = null;
    this.bind();
    this.updateCamera();
  }

  get player() { return this.game.player; }

  // ------------------------------------------------------------- cámara
  centerOn(x, z) { this.target.x = clamp(x, 10, SIZE - 10); this.target.z = clamp(z, 10, SIZE - 10); }

  updateCamera() {
    const t = this.target, c = this.camera;
    c.position.set(t.x, Math.sin(PITCH) * this.dist, t.z + Math.cos(PITCH) * this.dist);
    c.lookAt(t.x, 0, t.z);
    c.updateMatrixWorld();
    this.game.camTarget = t;
    if (this.sun) {
      this.sun.position.set(t.x + 45, 90, t.z + 30);
      this.sun.target.position.set(t.x, 0, t.z);
      this.sun.target.updateMatrixWorld();
    }
  }

  setNdc(cx, cy) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  }

  groundAt(cx, cy) {
    this.setNdc(cx, cy);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.ray.intersectPlane(this.plane, this.tmp2);
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  project(x, y, z) {
    const v = this.tmp.set(x, y, z).project(this.camera);
    const r = this.dom.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, z: v.z };
  }

  viewCorners() {
    const r = this.dom.getBoundingClientRect(), out = [];
    for (const [px, py] of [[0, 0], [r.width, 0], [r.width, r.height], [0, r.height]]) {
      const g = this.groundAt(r.left + px, r.top + py);
      out.push(g || { x: this.target.x, z: this.target.z });
    }
    return out;
  }

  // ------------------------------------------------------------- picking
  entityBox(e) {
    if (e.kind === 'building') {
      const r = e.rect;
      this.box.min.set(r.x0, 0, r.z0); this.box.max.set(r.x1, e.def.height, r.z1);
    } else {
      const rr = e.radius + 0.35, h = e.def.height;
      this.box.min.set(e.x - rr, 0, e.z - rr); this.box.max.set(e.x + rr, h, e.z + rr);
    }
    return this.box;
  }

  pickEntity(cx, cy, teamFilter = null) {
    this.setNdc(cx, cy);
    this.ray.setFromCamera(this.ndc, this.camera);
    let best = null, bt = Infinity;
    const test = (e) => {
      if (e.dead || !e.mesh.visible) return;
      if (teamFilter && e.team !== teamFilter) return;
      const hit = this.ray.ray.intersectBox(this.entityBox(e), this.tmp2);
      if (!hit) return;
      const t = hit.distanceTo(this.ray.ray.origin);
      if (t < bt) { bt = t; best = e; }
    };
    for (const u of this.game.units) test(u);
    for (const b of this.game.buildings) test(b);
    return best;
  }

  fieldAt(x, z) {
    for (const f of this.game.map.fields) if (Math.hypot(f.x - x, f.z - z) < f.r + 1) return f;
    return null;
  }

  // ----------------------------------------------------------- selección
  setSelection(list, silent = false) {
    for (const e of this.sel) e.selected = false;
    this.sel = list.filter((e) => !e.dead);
    for (const e of this.sel) e.selected = true;
    if (!silent && this.sel.length) this.game.audio.play('select');
    if (this.onSelectionChange) this.onSelectionChange(this.sel);
  }
  selUnits() { return this.sel.filter((e) => e.kind === 'unit' && e.team === this.player && !e.dead); }

  selectInRect(x0, y0, x1, y1, shift) {
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    const found = [];
    for (const u of this.game.units) {
      if (u.dead || u.team !== this.player) continue;
      const p = this.project(u.x, u.def.height * 0.5, u.z);
      if (p.z < 1 && p.x >= lx && p.x <= hx && p.y >= ly && p.y <= hy) found.push(u);
    }
    if (shift) { const s = new Set(this.sel); found.forEach((u) => s.add(u)); this.setSelection([...s]); }
    else if (found.length) this.setSelection(found);
    else {
      const b = this.game.buildings.find((bb) => {
        if (bb.team !== this.player || bb.dead) return false;
        const p = this.project(bb.x, bb.def.height * 0.4, bb.z);
        return p.x >= lx && p.x <= hx && p.y >= ly && p.y <= hy;
      });
      this.setSelection(b ? [b] : []);
    }
  }

  selectSameType(unit) {
    const r = this.dom.getBoundingClientRect();
    const list = this.game.units.filter((u) => {
      if (u.dead || u.team !== this.player || u.def.id !== unit.def.id) return false;
      const p = this.project(u.x, 1, u.z);
      return p.z < 1 && p.x >= 0 && p.x <= r.width && p.y >= 0 && p.y <= r.height;
    });
    this.setSelection(list);
  }

  // -------------------------------------------------------------- órdenes
  movementUnits() { return this.selUnits().filter((u) => u.def.weapon || u.def.repair || u.def.radar); }

  setMovementMode(attackMove) {
    if (this.game.spectate || this.game.over) return;
    const units = this.movementUnits();
    if (!units.length) return;
    for (const u of units) {
      u.attackMoveDefault = !!attackMove;
      const o = u.order;
      if (o.type === 'move' || o.type === 'attackmove') u.cmdMove(o.x, o.z, attackMove);
    }
    this.attackMode = false; this.superTarget = null; this.cancelPlacement();
    this.game.audio.play('click');
    this.ui?.refreshMovementControls();
  }

  stopSelected() {
    if (this.game.spectate || this.game.over || !this.selUnits().length) return;
    for (const u of this.selUnits()) u.cmdStop();
    this.attackMode = false; this.superTarget = null; this.cancelPlacement();
    this.game.audio.play('order');
  }

  formation(units, x, z) {
    const n = units.length;
    if (n === 1) return [{ x, z }];
    const maxR = Math.max(...units.map((u) => u.radius));
    const sp = Math.max(2.5, maxR * 2 + 0.7);
    const cols = Math.ceil(Math.sqrt(n * 1.2)), rows = Math.ceil(n / cols);
    let cx = 0, cz = 0;
    for (const u of units) { cx += u.x; cz += u.z; }
    cx /= n; cz /= n;
    let dx = x - cx, dz = z - cz; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const slots = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols), col = i % cols;
      let sx = x + (col - (cols - 1) / 2) * sp, sz = z + (row - (rows - 1) / 2) * sp;
      const c = nearestFreeCell(this.game.map.grid, sx, sz, 8);
      if (c >= 0 && this.game.map.blockedXZ(sx, sz)) { sx = ((c % N) + 0.5) * CELL; sz = (((c / N) | 0) + 0.5) * CELL; }
      slots.push({ x: sx, z: sz });
    }
    const us = units.slice().sort((a, b) => ((b.x - cx) * dx + (b.z - cz) * dz) - ((a.x - cx) * dx + (a.z - cz) * dz));
    slots.sort((a, b) => ((b.x - x) * dx + (b.z - z) * dz) - ((a.x - x) * dx + (a.z - z) * dz));
    const map = new Map();
    us.forEach((u, i) => map.set(u, slots[i]));
    return units.map((u) => map.get(u));
  }

  orderMove(units, x, z, attackMove = null) {
    const pts = this.formation(units, x, z);
    const crate = attackMove !== true && this.game.cashCrates?.at(x, z);
    let collector = -1;
    if (crate && units.length) {
      let nearest = 0;
      for (let i = 1; i < units.length; i++) {
        if (Math.hypot(units[i].x - crate.x, units[i].z - crate.z) < Math.hypot(units[nearest].x - crate.x, units[nearest].z - crate.z)) nearest = i;
      }
      // Keep one unit on the crate even when the formation leaves its center empty.
      pts[nearest] = { x: crate.x, z: crate.z };
      collector = nearest;
    }
    units.forEach((u, i) => u.cmdMove(pts[i].x, pts[i].z, i === collector ? false : (attackMove ?? !!u.attackMoveDefault)));
  }

  commandAt(cx, cy) {
    const g = this.game;
    let units = this.selUnits();
    const gp = this.groundAt(cx, cy);
    if (!gp) return;
    if (!units.length) {
      const b = this.sel.length === 1 && this.sel[0].kind === 'building' && this.sel[0].team === this.player ? this.sel[0] : null;
      if (b && b.def.produces) { b.rally = { x: gp.x, z: gp.z }; g.fx.marker(gp.x, gp.z, 'rally'); g.audio.play('order'); }
      return;
    }
    const hit = this.pickEntity(cx, cy);
    // Right click on a tech structure that is not ours: engineers go in to capture it.
    const engineers = hit ? units.filter((u) => canCapture(u, hit)) : [];
    if (engineers.length) {
      engineers.forEach((u) => u.cmdCapture(hit));
      g.fx.marker(hit.x, hit.z, 'rally');
      units = units.filter((u) => !engineers.includes(u));
      if (!units.length) { g.audio.play('order'); return; }
    }
    // Neutral ruins cannot be attacked: a click on them is a move order.
    if (hit && hit.team && hit.team !== this.player) {
      for (const u of units) u.cmdAttack(hit);
      g.fx.marker(hit.x, hit.z, 'attack');
      g.audio.play('attack');
      return;
    }
    let rest = units;
    if (hit && hit.kind === 'unit' && hit.team === this.player) {
      // Clic derecho sobre un aliado herido: los sanadores compatibles lo atienden.
      const healers = units.filter((u) => canRepair(u, hit));
      if (healers.length && hit.hp < hit.maxHp) {
        healers.forEach((u) => u.cmdRepair(hit));
        g.fx.marker(hit.x, hit.z, 'move');
        rest = units.filter((u) => !healers.includes(u));
        if (!rest.length) { g.audio.play('order'); return; }
      }
    }
    units = rest;
    const harvs = units.filter((u) => u.def.harvester), others = units.filter((u) => !u.def.harvester);
    let handled = false;
    if (harvs.length) {
      if (hit && hit.kind === 'building' && hit.def.role === 'refinery' && hit.team === this.player) {
        harvs.forEach((u) => u.cmdReturn(hit)); handled = true;
        g.fx.marker(hit.x, hit.z, 'move');
      } else {
        const f = this.fieldAt(gp.x, gp.z);
        if (f) { harvs.forEach((u) => u.cmdHarvest(f)); handled = true; g.fx.marker(f.x, f.z, 'move'); }
      }
    }
    if (handled) { if (others.length) this.orderMove(others, gp.x, gp.z); }
    else { this.orderMove(units, gp.x, gp.z); g.fx.marker(gp.x, gp.z, units.some((u) => u.attackMoveDefault) ? 'attack' : 'move'); }
    g.audio.play('order');
  }

  attackMoveAt(cx, cy) {
    const gp = this.groundAt(cx, cy), units = this.selUnits().filter((u) => u.def.weapon || u.def.repair || u.def.radar);
    if (!gp || !units.length) return;
    this.orderMove(units, gp.x, gp.z, true);
    this.game.fx.marker(gp.x, gp.z, 'attack');
    this.game.audio.play('attack');
  }

  // ---------------------------------------------------------- superarmas
  beginSuperTarget(b) {
    if (!this.game.superweapons.isReady(b) || b.team !== this.player) return;
    this.cancelPlacement();
    this.attackMode = false;
    this.superTarget = b;
    this.game.audio.play('click');
  }

  fireSuperAt(cx, cy) {
    const g = this.game, b = this.superTarget, gp = this.groundAt(cx, cy);
    if (!b || !gp) return;
    if (g.superweapons.fire(b, gp.x, gp.z)) { this.superTarget = null; g.audio.play('attack'); return; }
    g.audio.play('error');
    if (this.ui) this.ui.toast('Solo puedes apuntar a zonas exploradas del mapa', 'warn');
  }

  // ------------------------------------------------------- colocar edificio
  beginPlacement(def) {
    this.cancelPlacement();
    this.placing = def;
    this.attackMode = false; this.superTarget = null;
    const grp = new THREE.Group();
    const model = buildBuildingModel(def).group;
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.45, depthWrite: false });
    model.traverse((o) => { if (o.isMesh) { o.material = ghostMat; o.castShadow = false; o.receiveShadow = false; } });
    model.rotation.y = buildingFront(def) < 0 ? Math.PI : 0;
    grp.add(model);
    this.ghostMat = ghostMat;
    // The concrete pad that will be poured with the building.
    const pw = def.w + 2 * SLAB_MARGIN, ph = def.h + 2 * SLAB_MARGIN, tex = concreteTexture().clone();
    tex.repeat.set(pw * CELL / CONCRETE_TILE, ph * CELL / CONCRETE_TILE);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(pw * CELL, ph * CELL).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false }));
    pad.position.y = 0.06; pad.renderOrder = 2;
    grp.add(pad);
    this.ghostTiles = [];
    const tg = new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92).rotateX(-Math.PI / 2);
    for (let z = 0; z < def.h; z++) for (let x = 0; x < def.w; x++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.5, depthWrite: false }));
      m.position.set((x + 0.5 - def.w / 2) * CELL, 0.12, (z + 0.5 - def.h / 2) * CELL);
      m.renderOrder = 3;
      grp.add(m); this.ghostTiles.push({ mesh: m, x, z });
    }
    this.ghost = grp; this.ghost.visible = false;
    this.game.scene.add(grp);
  }

  cancelPlacement() {
    if (this.ghost) {
      this.game.scene.remove(this.ghost);
      // Tile and pad geometries/materials belong to this preview; the model's are shared.
      for (const t of this.ghostTiles) t.mesh.material.dispose();
      this.ghostTiles[0]?.mesh.geometry.dispose();
      const pad = this.ghost.children[1];
      pad.geometry.dispose(); pad.material.map.dispose(); pad.material.dispose(); this.ghostMat.dispose();
      this.ghost = null;
    }
    this.placing = null;
  }

  updateGhost() {
    const q = this.game.teams[this.player].structQueue;
    if (this.placing && (!q || !q.ready || q.def !== this.placing)) { this.cancelPlacement(); return; }
    if (!this.placing || !this.ghost) return;
    if (!this.mouse.inside) { this.ghost.visible = false; return; }
    const gp = this.groundAt(this.mouse.cx, this.mouse.cy);
    if (!gp) { this.ghost.visible = false; return; }
    const def = this.placing, g = this.game;
    const cx = Math.round(gp.x / CELL - def.w / 2), cz = Math.round(gp.z / CELL - def.h / 2);
    this.ghostCell = { cx, cz };
    this.ghost.position.set((cx + def.w / 2) * CELL, 0, (cz + def.h / 2) * CELL);
    this.ghost.visible = true;
    const ok = g.canPlace(this.player, def, cx, cz);
    this.ghostOk = ok;
    this.ghostMat.color.setHex(ok ? 0x66ff88 : 0xff5050);
    for (const t of this.ghostTiles) {
      const blocked = g.map.blockedCell(cx + t.x, cz + t.z);
      t.mesh.material.color.setHex(blocked ? 0xff3030 : ok ? 0x66ff88 : 0xffb040);
    }
  }

  tryPlace() {
    if (!this.placing || !this.ghostCell) return;
    const g = this.game, { cx, cz } = this.ghostCell;
    if (this.ghostOk && g.placeStruct(this.player, cx, cz)) { this.cancelPlacement(); return; }
    g.audio.play('error');
    if (this.ui) this.ui.toast('No se puede construir aquí (debe estar cerca de tus edificios y en terreno libre)', 'warn');
  }

  // --------------------------------------------------------------- eventos
  bind() {
    const dom = this.dom;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mouseup', (e) => this.onUp(e));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    dom.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    dom.addEventListener('mouseenter', () => { this.mouse.inside = true; });
    document.addEventListener('mouseleave', () => { this.mouse.edge = null; });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = clamp(this.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1), 32, 130);
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onDown(e) {
    this.game.audio.init();
    if (this.game.over) return;
    this.mouse.cx = e.clientX; this.mouse.cy = e.clientY;
    if (e.button === 1) {
      e.preventDefault();
      this.pan = { anchor: this.groundAt(e.clientX, e.clientY) };
      return;
    }
    if (e.button === 2) {
      if (this.placing) { this.cancelPlacement(); return; }
      if (this.attackMode) { this.attackMode = false; return; }
      if (this.superTarget) { this.superTarget = null; return; }
      this.commandAt(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0) return;
    if (this.placing) { this.tryPlace(); return; }
    if (this.superTarget) { this.fireSuperAt(e.clientX, e.clientY); return; }
    if (this.attackMode) { this.attackMode = false; this.attackMoveAt(e.clientX, e.clientY); return; }
    this.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, active: false, shift: e.shiftKey };
  }

  onMove(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    this.mouse.cx = e.clientX; this.mouse.cy = e.clientY;
    const r = this.dom.getBoundingClientRect();
    this.mouse.inside = e.target === this.dom;
    this.mouse.edge = { l: e.clientX <= r.left + 6, r: e.clientX >= window.innerWidth - 6, t: e.clientY <= 6, b: e.clientY >= window.innerHeight - 6 };
    if (this.pan && this.pan.anchor) {
      const g = this.groundAt(e.clientX, e.clientY);
      if (g) this.centerOn(this.target.x + (this.pan.anchor.x - g.x), this.target.z + (this.pan.anchor.z - g.z));
      this.updateCamera();
    }
    if (this.drag) {
      this.drag.x1 = e.clientX; this.drag.y1 = e.clientY;
      if (!this.drag.active && Math.hypot(this.drag.x1 - this.drag.x0, this.drag.y1 - this.drag.y0) > 6) this.drag.active = true;
    }
  }

  onUp(e) {
    if (e.button === 1) { this.pan = null; return; }
    if (e.button !== 0 || !this.drag) return;
    const d = this.drag; this.drag = null;
    const rect = this.dom.getBoundingClientRect();
    if (d.active) {
      this.selectInRect(d.x0 - rect.left, d.y0 - rect.top, d.x1 - rect.left, d.y1 - rect.top, d.shift);
      return;
    }
    // clic simple
    const hit = this.pickEntity(e.clientX, e.clientY);
    const now = performance.now();
    if (hit && hit.team === this.player) {
      if (hit.kind === 'unit' && this.lastClick.id === hit.def.id && now - this.lastClick.t < 380) { this.selectSameType(hit); this.lastClick = { t: 0, id: -1 }; return; }
      this.lastClick = { t: now, id: hit.kind === 'unit' ? hit.def.id : -1 };
      if (d.shift) {
        const s = new Set(this.sel);
        if (s.has(hit)) s.delete(hit); else s.add(hit);
        this.setSelection([...s]);
      } else this.setSelection([hit]);
    } else if (hit && hit.team !== this.player) {
      if (!d.shift) this.setSelection([hit]);
    } else if (!d.shift) this.setSelection([]);
  }

  onKey(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const code = e.code;
    if (e.target?.tagName === 'BUTTON' && (code === 'Space' || code === 'Enter')) return;
    if (down) this.keys.add(code); else this.keys.delete(code);
    if (!down) return;
    const g = this.game;
    if (code === 'Escape') { this.cancelPlacement(); this.attackMode = false; this.superTarget = null; this.setSelection([], true); return; }
    if (code === 'KeyP') { if (this.ui) this.ui.togglePause(); return; }
    if (code === 'KeyM') { if (this.ui) this.ui.toggleMute(); return; }
    if (g.over) return;
    if (code === 'KeyA' && !e.ctrlKey) { if (this.selUnits().some((u) => u.def.weapon || u.def.repair || u.def.radar)) { this.attackMode = true; this.superTarget = null; this.cancelPlacement(); } return; }
    if (code === 'KeyA' && e.ctrlKey) { e.preventDefault(); this.setSelection(g.units.filter((u) => u.team === this.player && !u.dead)); return; }
    if (code === 'KeyS') { this.stopSelected(); return; }
    if (code === 'KeyH') { const hq = g.teamBuildings(this.player, 'hq')[0]; if (hq) { this.centerOn(hq.x, hq.z); } return; }
    if (code === 'Space') { e.preventDefault(); if (this.lastAlert) this.centerOn(this.lastAlert.x, this.lastAlert.z); return; }
    if (code === 'Delete' || code === 'Backspace') {
      for (const b of this.sel) if (b.kind === 'building' && b.team === this.player) g.sellBuilding(b);
      return;
    }
    const m = /^Digit([1-9])$/.exec(code);
    if (m) {
      const k = m[1];
      if (e.ctrlKey) {
        e.preventDefault();
        this.groups[k] = this.sel.filter((s) => s.team === this.player);
        if (this.ui) this.ui.toast(`Grupo ${k} asignado (${this.groups[k].length})`, 'info');
      } else if (this.groups[k]) {
        const list = this.groups[k].filter((s) => !s.dead);
        this.groups[k] = list;
        if (list.length) {
          this.setSelection(list);
          const now = performance.now();
          if (this.lastGroupKey === k && now - this.lastGroupT < 400) {
            const c = list.reduce((a, s) => ({ x: a.x + s.x / list.length, z: a.z + s.z / list.length }), { x: 0, z: 0 });
            this.centerOn(c.x, c.z);
          }
          this.lastGroupKey = k; this.lastGroupT = now;
        }
      }
    }
  }

  // ---------------------------------------------------------------- ciclo
  update(dt) {
    const k = this.keys, sp = this.dist * 1.15 * dt;
    let mx = 0, mz = 0;
    if (k.has('ArrowUp')) mz -= 1;
    if (k.has('ArrowDown')) mz += 1;
    if (k.has('ArrowLeft')) mx -= 1;
    if (k.has('ArrowRight')) mx += 1;
    if (k.has('KeyQ')) this.dist = clamp(this.dist * (1 + dt * 1.2), 32, 130);
    if (k.has('KeyE')) this.dist = clamp(this.dist / (1 + dt * 1.2), 32, 130);
    const ed = this.mouse.edge;
    if (ed && this.mouse.inside && !this.pan) {
      if (ed.l) mx -= 1; if (ed.r) mx += 1; if (ed.t) mz -= 1; if (ed.b) mz += 1;
    }
    if (mx || mz) { const l = Math.hypot(mx, mz); this.centerOn(this.target.x + (mx / l) * sp, this.target.z + (mz / l) * sp); }
    this.updateCamera();

    this.sel = this.sel.filter((e) => !e.dead);
    this.updateGhost();
    if (this.superTarget && !this.game.superweapons.isReady(this.superTarget)) this.superTarget = null;
    this.hover = this.mouse.inside && !this.drag?.active && !this.placing && !this.superTarget ? this.pickEntity(this.mouse.cx, this.mouse.cy) : null;

    let cur = 'default';
    if (this.placing || this.attackMode || this.superTarget) cur = 'crosshair';
    else if (this.hover && this.selUnits().some((u) => canCapture(u, this.hover))) cur = 'copy';
    else if (this.hover && this.hover.team && this.hover.team !== this.player && this.selUnits().some((u) => u.def.weapon)) cur = 'crosshair';
    else if (this.hover && this.hover.team === this.player && this.hover.hp < this.hover.maxHp && this.selUnits().some((u) => canRepair(u, this.hover))) cur = 'cell';
    else if (this.hover && (this.hover.team === this.player || this.hover.def.tech)) cur = 'pointer';
    this.dom.style.cursor = cur;
  }
}
