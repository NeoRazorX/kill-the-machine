import * as THREE from 'three';
import { DEFS, ROLE, TEAMS, N, SIZE, CELL, STRUCT_ROLES, UNIT_ROLES, ROLE_NAMES, PLAYER } from './config.js';
import { buildUnitModel, buildBuildingModel } from './models.js';
import { isCombatUnit, experienceText } from './experience.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Renderiza cada modelo 3D a un icono con un renderer auxiliar.
export function makeIcons(defs) {
  const out = {};
  const size = 128;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(size, size, false); r.setPixelRatio(1); r.setClearColor(0x000000, 0);
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xdfe8ff, 0x445060, 1.5));
  const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(3, 6, 4); sc.add(dl);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  for (const def of defs) {
    const model = (def.kind === 'building' ? buildBuildingModel(def) : buildUnitModel(def)).group;
    sc.add(model);
    const box = new THREE.Box3().setFromObject(model);
    const sph = box.getBoundingSphere(new THREE.Sphere());
    const dist = (sph.radius / Math.sin((cam.fov * Math.PI) / 360)) * 1.02;
    const dir = new THREE.Vector3(0.9, 0.7, 1.0).normalize();
    cam.position.copy(sph.center).addScaledVector(dir, dist);
    cam.lookAt(sph.center);
    r.render(sc, cam);
    out[def.id] = r.domElement.toDataURL('image/png');
    sc.remove(model);
  }
  r.dispose();
  if (r.forceContextLoss) r.forceContextLoss();
  return out;
}

export class UI {
  constructor(game, input, camera) {
    this.game = game; this.input = input; this.camera = camera;
    this.faction = game.spectate ? PLAYER : game.player;
    this.team = this.faction;
    input.ui = this;
    this.tab = 'struct';
    this.pings = [];
    this.credShown = game.teams[this.team].credits;
    this.selKey = '';
    this.t = 0;

    const defs = Object.values(DEFS).filter((d) => d.team === this.faction);
    this.icons = makeIcons(Object.values(DEFS));

    this.cv = $('overlay'); this.ctx = this.cv.getContext('2d');
    this.mini = $('minimap'); this.mctx = this.mini.getContext('2d');
    this.buildMiniBase();
    this.buildSidebar();
    this.bindMinimap();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    $('btn-pause').onclick = () => this.togglePause();
    $('btn-mute').onclick = () => this.toggleMute();
    $('btn-help').onclick = () => $('help').classList.toggle('hidden');
    $('help').onclick = () => $('help').classList.add('hidden');

    game.onEvent = (type, data) => this.onGameEvent(type, data);
    input.onSelectionChange = () => this.refreshSelPanel(true);
  }

  // -------------------------------------------------------------- eventos
  onGameEvent(type, data) {
    if (type === 'toast') this.toast(data.text, data.kind);
    else if (type === 'alert') {
      this.pings.push({ x: data.x, z: data.z, t: this.game.time });
      this.input.lastAlert = { x: data.x, z: data.z };
    } else if (type === 'over') this.showEnd(data);
  }

  toast(text, kind = 'info') {
    const box = $('toasts');
    const d = document.createElement('div');
    d.className = 'toast ' + kind; d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 5) box.removeChild(box.firstChild);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 500); }, 3800);
  }

  togglePause() {
    const g = this.game;
    g.paused = !g.paused;
    $('pause').classList.toggle('hidden', !g.paused);
    $('btn-pause').textContent = g.paused ? '▶' : '⏸';
  }
  toggleMute() {
    const m = this.game.audio.toggleMute();
    $('btn-mute').textContent = m ? '🔇' : '🔊';
  }

  showEnd(over) {
    const g = this.game, el = $('endscreen');
    const win = g.spectate ? true : over.winner === g.player;
    el.classList.remove('hidden');
    el.classList.toggle('win', win); el.classList.toggle('lose', !win);
    $('end-title').textContent = g.spectate ? `Ganan ${over.winner === 'human' ? 'los Humanos' : 'las Máquinas'}` : (win ? 'VICTORIA' : 'DERROTA');
    $('end-sub').textContent = win ? 'Las máquinas han sido destruidas. La humanidad respira.' : 'La red de máquinas ha tomado el control.';
    if (g.spectate) $('end-sub').textContent = '';
    const t = g.teams[g.spectate ? over.winner : g.player], m = Math.floor(over.time / 60), s = Math.floor(over.time % 60);
    $('end-stats').innerHTML = `<div><b>${m}:${String(s).padStart(2, '0')}</b><span>Duración</span></div>` +
      `<div><b>${t.stats.killed}</b><span>Bajas enemigas</span></div><div><b>${t.stats.lost}</b><span>Pérdidas</span></div>` +
      `<div><b>${Math.round(t.stats.earned)}</b><span>Créditos ganados</span></div>`;
    g.audio.play(win ? 'win' : 'lose');
    g.audio.say(win ? 'Misión cumplida. Victoria.' : 'Misión fallida. Derrota.', 0);
  }

  // ------------------------------------------------------------- sidebar
  buildSidebar() {
    const f = this.faction;
    this.lists = {
      struct: STRUCT_ROLES.map((r) => ROLE[f][r]),
      barracks: UNIT_ROLES.barracks.map((r) => ROLE[f][r]),
      factory: UNIT_ROLES.factory.map((r) => ROLE[f][r]),
    };
    const tabs = $('tabs'); tabs.innerHTML = '';
    const names = { struct: 'Estructuras', barracks: f === 'human' ? 'Infantería' : 'Drones', factory: 'Vehículos' };
    this.tabEls = {};
    for (const k of Object.keys(this.lists)) {
      const b = document.createElement('button');
      b.className = 'tab'; b.textContent = names[k]; b.dataset.tab = k;
      b.onclick = () => { this.tab = k; this.game.audio.play('click'); this.renderTab(); };
      tabs.appendChild(b); this.tabEls[k] = b;
    }
    this.renderTab();
  }

  renderTab() {
    const grid = $('build'); grid.innerHTML = '';
    for (const [k, el] of Object.entries(this.tabEls)) el.classList.toggle('active', k === this.tab);
    this.itemEls = {};
    for (const def of this.lists[this.tab]) {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `<img src="${this.icons[def.id]}" alt=""><div class="nm">${def.name}</div><div class="cost">$${def.cost}</div>` +
        `<div class="prog"><i></i></div><div class="badge"></div><div class="state"></div>`;
      el.onclick = (e) => this.onItem(def, e);
      el.oncontextmenu = (e) => { e.preventDefault(); this.onItemCancel(def); };
      grid.appendChild(el);
      this.itemEls[def.id] = { el, bar: el.querySelector('.prog i'), badge: el.querySelector('.badge'), state: el.querySelector('.state'), cost: el.querySelector('.cost') };
    }
    this.refreshItems();
  }

  reqText(def) {
    const g = this.game;
    if (def.kind === 'unit') return g.hasRole(this.team, def.producer) ? '' : `Requiere: ${ROLE_NAMES[def.producer]}`;
    const miss = (def.requires || []).filter((r) => !g.hasRole(this.team, r)).map((r) => ROLE_NAMES[r]);
    return miss.length ? `Requiere: ${miss.join(', ')}` : '';
  }

  onItem(def, e) {
    const g = this.game, T = g.teams[this.team];
    if (g.over || g.spectate) return;
    const req = this.reqText(def);
    if (req) { g.audio.play('error'); this.toast(req, 'warn'); return; }
    if (def.kind === 'building') {
      const q = T.structQueue;
      if (q && q.def === def && q.ready) { this.input.beginPlacement(def); g.audio.play('click'); return; }
      if (q) { g.audio.play('error'); this.toast(q.def === def ? 'Ya se está construyendo' : 'Ya hay una construcción en curso', 'warn'); return; }
      if (g.startStruct(this.team, def.id)) { g.audio.play('click'); g.audio.say('Construyendo', 3000); }
    } else {
      const n = e.shiftKey ? 5 : 1;
      let ok = false;
      for (let i = 0; i < n; i++) ok = g.queueUnit(this.team, def.id) || ok;
      if (ok) { g.audio.play('click'); g.audio.say('Entrenando', 3000); } else { g.audio.play('error'); this.toast('Cola llena', 'warn'); }
    }
    this.refreshItems();
  }

  onItemCancel(def) {
    const g = this.game, T = g.teams[this.team];
    if (g.over || g.spectate) return;
    if (def.kind === 'building') {
      if (T.structQueue && T.structQueue.def === def) { g.cancelStruct(this.team); this.input.cancelPlacement(); g.audio.play('sell'); g.audio.say('Cancelado', 2500); }
    } else if (g.cancelUnit(this.team, def.id)) { g.audio.play('sell'); g.audio.say('Cancelado', 2500); }
    this.refreshItems();
  }

  refreshItems() {
    const g = this.game, T = g.teams[this.team];
    for (const def of this.lists[this.tab]) {
      const it = this.itemEls[def.id];
      if (!it) continue;
      const req = this.reqText(def), afford = T.credits >= def.cost;
      let prog = 0, state = '', badge = '', busy = false;
      if (def.kind === 'building') {
        const q = T.structQueue;
        if (q && q.def === def) { prog = q.progress; state = q.ready ? 'LISTO' : (q.waiting ? 'SIN FONDOS' : ''); }
        else if (q) busy = true;
      } else {
        const n = g.queuedCount(this.team, def.id);
        if (n) badge = n;
        const p = g.queueProgress(this.team, def.id);
        if (p.progress >= 0) { prog = p.progress; if (p.waiting) state = 'SIN FONDOS'; }
      }
      it.el.classList.toggle('locked', !!req);
      it.el.classList.toggle('busy', busy);
      it.el.classList.toggle('ready', state === 'LISTO');
      it.cost.classList.toggle('poor', !afford);
      it.bar.style.width = (prog * 100).toFixed(1) + '%';
      it.badge.textContent = badge; it.badge.style.display = badge ? 'flex' : 'none';
      it.state.textContent = req ? '🔒' : state;
      it.el.title = `${def.name} — $${def.cost}\n${def.desc}${req ? '\n' + req : ''}`;
    }
    const q = T.structQueue;
    this.tabEls.struct.classList.toggle('alert', !!(q && q.ready));
  }

  // ----------------------------------------------------------- selección
  refreshSelPanel(force = false) {
    const sel = this.input.sel, panel = $('selpanel');
    const key = sel.map((e) => e.id).join(',');
    if (!force && key === this.selKey) {
      this.updateSelBars();
      return;
    }
    this.selKey = key;
    if (!sel.length) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
    panel.classList.remove('hidden');
    const g = this.game;
    if (sel.length === 1 && sel[0].kind === 'building') {
      const b = sel[0], own = b.team === g.player;
      const pw = b.def.power;
      panel.innerHTML = `<div class="sp-head"><img src="${this.icons[b.def.id]}"><div><div class="sp-name">${b.def.name}</div>` +
        `<div class="sp-sub">${own ? (pw > 0 ? `⚡ +${pw}` : pw < 0 ? `⚡ ${pw}` : 'Base') : 'Edificio enemigo'}${b.def.produces && own ? ' · clic derecho: punto de reunión' : ''}</div></div></div>` +
        `<div class="hpbar"><i></i></div>` +
        (own && b.def.role !== 'hq' ? `<button id="sell-btn">Vender (Supr)</button>` : '');
      const sb = $('sell-btn');
      if (sb) sb.onclick = () => { g.sellBuilding(b); };
    } else {
      const groups = new Map();
      for (const e of sel) { if (!groups.has(e.def.id)) groups.set(e.def.id, []); groups.get(e.def.id).push(e); }
      let html = '<div class="chips">';
      for (const [id, list] of groups) html += `<div class="chip" data-id="${id}" title="${list[0].def.name}"><img src="${this.icons[id]}"><b>${list.length}</b></div>`;
      html += '</div>';
      const names = [...groups.values()].map((l) => l[0].def.name);
      html += `<div class="sp-sub">${sel.length === 1 ? names[0] : sel.length + ' unidades'}${sel[0].team !== g.player ? ' · enemigo' : ''}</div><div class="hpbar"><i></i></div>`;
      if (sel.some(isCombatUnit)) html += '<div class="sp-experience"></div>';
      panel.innerHTML = html;
      panel.querySelectorAll('.chip').forEach((c) => {
        c.onclick = () => { const list = groups.get(c.dataset.id); this.input.setSelection(list); };
      });
    }
    this.updateSelBars();
  }

  updateSelBars() {
    const sel = this.input.sel, bar = document.querySelector('#selpanel .hpbar i');
    if (!bar || !sel.length) return;
    let hp = 0, max = 0;
    for (const e of sel) { hp += e.hp; max += e.maxHp; }
    const experience = document.querySelector('#selpanel .sp-experience');
    if (experience) {
      const combat = sel.filter(isCombatUnit);
      experience.textContent = combat.length === 1 && sel.length === 1 ? experienceText(combat[0]) :
        `${combat.reduce((sum, u) => sum + u.kills, 0)} bajas · ${combat.filter(u => u.rank === 1).length} veteranas · ${combat.filter(u => u.rank === 2).length} élite`;
    }
    const f = hp / max;
    bar.style.width = (f * 100) + '%';
    bar.style.background = f > 0.6 ? '#4cd964' : f > 0.3 ? '#ffcc00' : '#ff453a';
  }

  // ------------------------------------------------------------- minimapa
  buildMiniBase() {
    const W = this.mini.width;
    const c = document.createElement('canvas'); c.width = c.height = W;
    const x = c.getContext('2d'), k = W / SIZE;
    x.drawImage(this.game.visuals.groundCanvas, 0, 0, W, W);
    x.fillStyle = 'rgba(20,50,20,0.9)';
    for (const t of this.game.map.trees) x.fillRect(t.x * k - 1, t.z * k - 1, 2.2, 2.2);
    x.fillStyle = 'rgba(110,110,110,0.95)';
    for (const r of this.game.map.rocks) x.fillRect(r.x * k - 2.2, r.z * k - 2.2, 4.4, 4.4);
    x.fillStyle = '#969783';
    for (const l of this.game.map.landmarks) {
      x.beginPath(); x.arc(l.x * k, l.z * k, l.radius * k, 0, Math.PI * 2); x.fill();
    }
    this.miniBase = c;
  }

  bindMinimap() {
    const m = this.mini;
    const toWorld = (e) => {
      const r = m.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * SIZE, z: ((e.clientY - r.top) / r.height) * SIZE };
    };
    let drag = false;
    m.addEventListener('contextmenu', (e) => e.preventDefault());
    m.addEventListener('mousedown', (e) => {
      this.game.audio.init();
      const w = toWorld(e);
      if (e.button === 0) { drag = true; this.input.centerOn(w.x, w.z); }
      else if (e.button === 2) {
        const units = this.input.selUnits();
        if (units.length) { this.input.orderMove(units, w.x, w.z); this.game.fx.marker(w.x, w.z, 'move'); this.game.audio.play('order'); }
      }
    });
    window.addEventListener('mousemove', (e) => { if (drag) { const w = toWorld(e); this.input.centerOn(w.x, w.z); } });
    window.addEventListener('mouseup', () => { drag = false; });
  }

  drawMinimap() {
    const g = this.game, c = this.mctx, W = this.mini.width, k = W / SIZE;
    c.clearRect(0, 0, W, W);
    c.drawImage(this.miniBase, 0, 0);
    for (const f of g.map.fields) {
      const fr = Math.sqrt(Math.max(0, f.amount) / f.max);
      if (fr < 0.03) continue;
      c.fillStyle = 'rgba(70,255,205,0.6)';
      c.beginPath(); c.arc(f.x * k, f.z * k, Math.max(2, f.r * k * 0.75 * fr), 0, 6.3); c.fill();
    }
    c.imageSmoothingEnabled = true;
    if (!g.spectate) c.drawImage(g.fogCanvas, 0, 0, W, W);
    for (const b of g.buildings) {
      if (b.dead || !(b.team === g.player || b.seen || g.spectate)) continue;
      c.fillStyle = TEAMS[b.team].css;
      const r = b.rect;
      c.fillRect(r.x0 * k, r.z0 * k, Math.max(3, (r.x1 - r.x0) * k), Math.max(3, (r.z1 - r.z0) * k));
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1;
      c.strokeRect(r.x0 * k, r.z0 * k, Math.max(3, (r.x1 - r.x0) * k), Math.max(3, (r.z1 - r.z0) * k));
    }
    for (const u of g.units) {
      if (u.dead || !g.isVisibleEntity(u)) continue;
      c.fillStyle = TEAMS[u.team].css;
      const s = u.radius > 1.1 ? 3 : 2;
      c.fillRect(u.x * k - s / 2, u.z * k - s / 2, s, s);
    }
    // alertas
    this.pings = this.pings.filter((p) => g.time - p.t < 3.5);
    for (const p of this.pings) {
      const a = (g.time - p.t) / 3.5;
      c.strokeStyle = `rgba(255,60,60,${1 - a})`; c.lineWidth = 2;
      c.beginPath(); c.arc(p.x * k, p.z * k, 4 + a * 18, 0, 6.3); c.stroke();
    }
    // cámara
    const q = this.input.viewCorners();
    c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.5;
    c.beginPath();
    q.forEach((p, i) => { const x = clamp(p.x, 0, SIZE) * k, y = clamp(p.z, 0, SIZE) * k; if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.closePath(); c.stroke();
  }

  // ------------------------------------------------------------- overlay
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.input.dom.clientWidth, h = this.input.dom.clientHeight;
    this.cv.width = w * dpr; this.cv.height = h * dpr;
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.dpr = dpr;
  }

  hpColor(f) { return f > 0.6 ? '#4cd964' : f > 0.3 ? '#ffcc00' : '#ff453a'; }

  drawEntity(e, mode) {
    const c = this.ctx, inp = this.input, g = this.game;
    if (e.dead || !e.mesh.visible) return;
    const own = e.team === g.player;
    const col = own ? '#5cf08a' : '#ff5a50';
    c.lineWidth = mode === 'hover' ? 1.5 : 2;
    c.strokeStyle = mode === 'hover' ? 'rgba(255,255,255,0.8)' : col;
    let bx, by, bw;
    if (e.kind === 'unit') {
      const p = inp.project(e.x, 0.1, e.z), r = e.radius * 1.25;
      const px = inp.project(e.x + r, 0.1, e.z), pz = inp.project(e.x, 0.1, e.z + r);
      const rx = Math.abs(px.x - p.x), ry = Math.abs(pz.y - p.y);
      if (mode !== 'bar') { c.beginPath(); c.ellipse(p.x, p.y, rx, ry, 0, 0, 6.3); c.stroke(); }
      const top = inp.project(e.x, e.def.height + 0.7, e.z);
      bx = top.x; by = top.y; bw = Math.max(22, rx * 2.2);
    } else {
      const r = e.rect, pts = [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]].map(([x, z]) => inp.project(x, 0.1, z));
      if (mode !== 'bar') {
        // esquinas tipo "visor"
        c.beginPath();
        pts.forEach((p, i) => {
          const n = pts[(i + 1) % 4], pr = pts[(i + 3) % 4];
          const a = 0.25;
          c.moveTo(p.x + (pr.x - p.x) * a, p.y + (pr.y - p.y) * a); c.lineTo(p.x, p.y); c.lineTo(p.x + (n.x - p.x) * a, p.y + (n.y - p.y) * a);
        });
        c.stroke();
      }
      const top = inp.project(e.x, e.def.height + 1, e.z);
      bx = top.x; by = top.y; bw = clamp(Math.abs(pts[1].x - pts[0].x) * 0.9, 40, 110);
    }
    const f = clamp(e.hp / e.maxHp, 0, 1);
    c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(bx - bw / 2 - 1, by - 1, bw + 2, 6);
    c.fillStyle = this.hpColor(f); c.fillRect(bx - bw / 2, by, bw * f, 4);
    if (e.kind === 'unit' && e.def.harvester && own) {
      const l = clamp(e.load / e.def.capacity, 0, 1);
      c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(bx - bw / 2 - 1, by + 6, bw + 2, 5);
      c.fillStyle = '#37e6b8'; c.fillRect(bx - bw / 2, by + 7, bw * l, 3);
    }
    if (e.kind === 'building' && own && e.queue && e.queue.length && mode === 'sel') {
      const it = e.queue[0];
      c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(bx - bw / 2 - 1, by + 6, bw + 2, 5);
      c.fillStyle = '#6aa8ff'; c.fillRect(bx - bw / 2, by + 7, bw * it.progress, 3);
    }
  }

  drawRank(unit) {
    if (!unit.rank || unit.dead || !unit.mesh.visible || !this.game.isVisibleEntity(unit)) return;
    const p = this.input.project(unit.x, unit.def.height + .7, unit.z);
    if (p.z < -1 || p.z > 1) return;
    const c = this.ctx;
    c.save();
    c.strokeStyle = unit.rank === 2 ? '#ffd36b' : '#c6e1ef';
    c.lineWidth = 2;
    c.shadowColor = '#000'; c.shadowBlur = 3;
    for (let i = 0; i < unit.rank; i++) {
      const y = p.y - 8 - i * 5;
      c.beginPath(); c.moveTo(p.x - 5, y); c.lineTo(p.x, y - 4); c.lineTo(p.x + 5, y); c.stroke();
    }
    c.restore();
  }

  drawOverlay() {
    const c = this.ctx, inp = this.input, g = this.game;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    const drawn = new Set();
    for (const e of inp.sel) { this.drawEntity(e, 'sel'); drawn.add(e); }
    if (inp.hover && !drawn.has(inp.hover)) { this.drawEntity(inp.hover, 'hover'); drawn.add(inp.hover); }
    for (const e of [...g.units, ...g.buildings]) {
      if (drawn.has(e) || e.dead) continue;
      if ((e.hp < e.maxHp && g.time - e.lastHit < 6) || (e.kind === 'building' && e.team === g.player && e.hp < e.maxHp && inp.keys.has('AltLeft'))) this.drawEntity(e, 'bar');
    }
    for (const unit of g.units) this.drawRank(unit);
    // puntos de reunión
    for (const e of inp.sel) {
      if (e.kind === 'building' && e.rally && e.team === g.player) {
        const a = inp.project(e.x, 1, e.z), b = inp.project(e.rally.x, 0.2, e.rally.z);
        c.strokeStyle = 'rgba(255,208,64,0.8)'; c.setLineDash([5, 4]); c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
        c.fillStyle = '#ffd040'; c.beginPath(); c.arc(b.x, b.y, 4, 0, 6.3); c.fill();
      }
    }
    // caja de selección
    const d = inp.drag;
    if (d && d.active) {
      const r = inp.dom.getBoundingClientRect();
      const x = Math.min(d.x0, d.x1) - r.left, y = Math.min(d.y0, d.y1) - r.top, w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      c.fillStyle = 'rgba(92,240,138,0.12)'; c.fillRect(x, y, w, h);
      c.strokeStyle = 'rgba(92,240,138,0.9)'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w, h);
    }
    $('modehint').classList.toggle('hidden', !(inp.attackMode || inp.placing));
    $('modehint').textContent = inp.attackMode ? 'ATACAR-MOVER · clic izquierdo en el destino · Esc cancela' : (inp.placing ? `Colocando: ${inp.placing.name} · clic izquierdo coloca · clic derecho cancela` : '');
  }

  // ---------------------------------------------------------------- ciclo
  update(dt) {
    const g = this.game, T = g.teams[this.team];
    this.t += dt;
    // créditos con contador animado
    this.credShown += (T.credits - this.credShown) * Math.min(1, dt * 8);
    if (Math.abs(T.credits - this.credShown) < 1) this.credShown = T.credits;
    $('credits').textContent = '$ ' + Math.floor(this.credShown).toLocaleString('es-ES');
    const p = T.power, low = p.use > p.prod;
    $('power-fill').style.width = clamp((p.use / Math.max(1, p.prod)) * 100, 0, 100) + '%';
    $('power-fill').classList.toggle('low', low);
    $('power-text').textContent = `⚡ ${p.use} / ${p.prod}` + (low ? '  ¡BAJA!' : '');
    const m = Math.floor(g.time / 60), s = Math.floor(g.time % 60);
    $('clock').textContent = `${m}:${String(s).padStart(2, '0')}`;

    this.drawOverlay();
    if (this.t > 0.1) {
      this.t = 0;
      this.refreshItems();
      this.refreshSelPanel();
    }
    this.drawMinimap();
  }
}
