import * as THREE from 'three';
import { DEFS, ROLE, TEAMS, N, SIZE, CELL, STRUCT_ROLES, UNIT_ROLES, ROLE_NAMES, PLAYER, globalRadarActive, buildingRepairCost, canRepairBuilding } from './config.js';
import { renderResults } from './results.js';
import { buildUnitModel, buildBuildingModel } from './models.js';
import { isCombatUnit, experienceText } from './experience.js';
import { SelectionRings } from './selection-rings.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clock = (s) => { const t = Math.ceil(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

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
    const built = def.kind === 'building' ? buildBuildingModel(def) : buildUnitModel(def), model = built.group;
    // Tech structures are shown repaired; the ruin is what the player finds on the map.
    if (built.parts.wreck) built.parts.wreck.visible = false;
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
    this.incomeLabels = [];
    this.credShown = game.teams[this.team].credits;
    this.selKey = '';
    this.t = 0;

    const defs = Object.values(DEFS).filter((d) => d.team === this.faction);
    this.icons = makeIcons(Object.values(DEFS));

    this.cv = $('overlay'); this.ctx = this.cv.getContext('2d');
    this.rings = new SelectionRings(game.scene);
    this.mini = $('minimap'); this.mctx = this.mini.getContext('2d');
    this.buildMiniBase();
    this.buildSidebar();
    this.bindMinimap();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // A ready superweapon of one's own is a button that starts aiming.
    $('supers').onclick = (e) => {
      const el = e.target.closest('.sw.own.ready');
      const b = el && game.techSites.items.find((s) => String(s.id) === el.dataset.id);
      if (b && !game.spectate) input.beginSuperTarget(b);
    };
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
    else if (type === 'income' && (data.team === this.game.player || this.game.spectate)) {
      this.incomeLabels.push({ ...data, t: this.game.time });
      if (this.incomeLabels.length > 32) this.incomeLabels.shift();
    }
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
    $('end-sub').textContent = win ? TEAMS[g.player].victory : TEAMS[g.player].defeat;
    if (g.spectate) $('end-sub').textContent = '';
    renderResults($('end-stats'), g);
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

  // Units from tech factories join the vehicle tab once their factory has been found on the map.
  techUnits() {
    const g = this.game, out = [];
    for (const b of g.techSites.items) {
      if (!b.def.produces || !(b.tech.found[this.team] || g.spectate)) continue;
      for (const d of Object.values(DEFS)) if (d.team === this.faction && d.producer === b.def.produces && !out.includes(d)) out.push(d);
    }
    return out;
  }

  renderTab() {
    this.lists.factory = [...UNIT_ROLES.factory.map((r) => ROLE[this.faction][r]), ...this.techUnits()];
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
    if (def.kind === 'unit') return g.requirementsMet(this.team, def) ? '' : `Requiere: ${ROLE_NAMES[def.producer]}`;
    // Requirements gate starting a build; losing one mid-construction must not strand the queued item,
    // or the lone struct queue stays occupied and the missing prerequisite can never be rebuilt.
    if (g.teams[this.team].structQueue?.def === def) return '';
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
    if (this.tab === 'factory' && this.lists.factory.length !== UNIT_ROLES.factory.length + this.techUnits().length) { this.renderTab(); return; }
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

  // ----------------------------------------------------------- superarmas
  refreshSupers() {
    const g = this.game, sw = g.superweapons, { own, enemy } = sw.status(this.team);
    // Spectators see every working superweapon, labelled with its side.
    const prefix = (b, mine) => (g.spectate ? `${TEAMS[b.team].name} · ` : mine ? '' : 'Enemigo · ');
    const row = (b, mine) => {
      const p = sw.progress(b), ready = p >= 1, low = !ready && g.lowPower(b.team);
      const state = ready ? 'LISTO' : low ? 'SIN ENERGÍA' : clock(sw.remaining(b));
      return `<div class="sw ${mine ? 'own' : 'enemy'}${ready ? ' ready' : ''}" data-id="${b.id}" title="${mine && ready ? 'Clic para elegir objetivo' : b.def.name}">` +
        `<img src="${this.icons[b.def.id]}" alt=""><div class="sw-body"><div class="sw-name"><span>${prefix(b, mine)}${b.def.superweapon.title}</span><span>${state}</span></div>` +
        `<div class="sw-bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div></div></div>`;
    };
    const all = g.spectate ? sw.sites.filter((b) => sw.online(b)) : null;
    const html = all ? all.map((b) => row(b, false)).join('') : own.map((b) => row(b, true)).join('') + enemy.map((b) => row(b, false)).join('');
    if (html !== this.supersHtml) { this.supersHtml = html; $('supers').innerHTML = html; }
  }

  // ----------------------------------------------------------- selección
  refreshSelPanel(force = false) {
    const sel = this.input.sel, panel = $('selpanel');
    // A tech structure redraws its panel whenever its owner, state or repair switch changes.
    // Structures also redraw when their repair button changes between repair, stop and hidden.
    const repair = (e) => e.kind === 'building' ? `:${e.repairing}:${canRepairBuilding(e)}` : '';
    const key = sel.map((e) => (e.tech ? `${e.id}:${this.techView(e).team}:${this.techView(e).state}:${e.tech.repairing}` :
      e.kind === 'building' && e.def.weapon ? `${e.id}:${this.game.lowPower(e.team)}` : e.id) + repair(e)).join(',');
    if (!force && key === this.selKey) {
      this.updateSelBars();
      return;
    }
    this.selKey = key;
    if (!sel.length) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
    panel.classList.remove('hidden');
    const g = this.game;
    if (sel.length === 1 && sel[0].def.tech) this.techPanel(sel[0], panel);
    else if (sel.length === 1 && sel[0].kind === 'building') {
      const b = sel[0], own = b.team === g.player;
      const pw = b.def.power;
      panel.innerHTML = `<div class="sp-head"><img src="${this.icons[b.def.id]}"><div><div class="sp-name">${b.def.name}</div>` +
        `<div class="sp-sub">${own ? (pw > 0 ? `⚡ +${pw}` : pw < 0 ? `⚡ ${pw}` : 'Base') : 'Edificio enemigo'}${b.def.produces && own ? ' · clic derecho: punto de reunión' : ''}${b.def.weapon && own && g.lowPower(b.team) ? ' · <b class="off">SIN ENERGÍA: apagada</b>' : ''}</div></div></div>` +
        `<div class="hpbar"><i></i></div>` + this.repairControls(b) +
        (own && b.def.role !== 'hq' ? `<button id="sell-btn">Vender (Supr)</button>` : '');
      const sb = $('sell-btn');
      if (sb) sb.onclick = () => { g.sellBuilding(b); };
      this.bindRepair(b);
    } else {
      const groups = new Map();
      for (const e of sel) { if (!groups.has(e.def.id)) groups.set(e.def.id, []); groups.get(e.def.id).push(e); }
      let html = '<div class="chips">';
      for (const [id, list] of groups) html += `<div class="chip" data-id="${id}" title="${list[0].def.name}"><img src="${this.icons[id]}"><b>${list.length}</b></div>`;
      html += '</div>';
      const names = [...groups.values()].map((l) => l[0].def.name);
      html += `<div class="sp-sub">${sel.length === 1 ? names[0] : sel.length + ' unidades'}${sel[0].team !== g.player ? ' · enemigo' : ''}</div><div class="hpbar"><i></i></div>`;
      if (sel.length === 1 && sel[0].def.radar) html += `<div class="sp-sub">Radio de detección: ${sel[0].def.sight} · Desarmado</div>`;
      if (sel.some(isCombatUnit)) html += '<div class="sp-experience"></div>';
      if (!g.spectate && this.input.selUnits().length) {
        html += '<fieldset class="unit-orders"><legend>Órdenes de movimiento</legend>';
        if (this.input.movementUnits().length) html +=
          '<div class="order-modes" role="radiogroup" aria-label="Modo de movimiento">' +
          '<button type="button" role="radio" aria-checked="false" data-movement="move" title="Prioriza llegar al destino sin detenerse a combatir">Mover</button>' +
          '<button type="button" role="radio" aria-checked="false" data-movement="attackmove" title="Avanza, se detiene a combatir y después continúa">Atacar-mover</button></div>' +
          '<div class="movement-help sp-sub" aria-live="polite"></div>';
        html += '<button type="button" class="unit-stop" title="Detener las unidades seleccionadas (S)">■ Detener</button></fieldset>';
      }
      panel.innerHTML = html;
      panel.querySelectorAll('.chip').forEach((c) => {
        c.onclick = () => { const list = groups.get(c.dataset.id); this.input.setSelection(list); };
      });
      panel.querySelectorAll('[data-movement]').forEach((button) => {
        button.onclick = () => this.input.setMovementMode(button.dataset.movement === 'attackmove');
        button.onkeydown = (event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const attack = event.key === 'ArrowRight' || event.key === 'End';
          this.input.setMovementMode(attack);
          panel.querySelector(`[data-movement="${attack ? 'attackmove' : 'move'}"]`).focus();
        };
      });
      const stop = panel.querySelector('.unit-stop');
      if (stop) stop.onclick = () => this.input.stopSelected();
    }
    this.updateSelBars();
  }

  refreshMovementControls() {
    const help = document.querySelector('#selpanel .movement-help');
    if (!help) return;
    const units = this.input.movementUnits();
    const allAttack = units.length > 0 && units.every((u) => u.attackMoveDefault);
    const allMove = units.length > 0 && units.every((u) => !u.attackMoveDefault);
    document.querySelectorAll('#selpanel [data-movement]').forEach((button) => {
      const checked = button.dataset.movement === 'attackmove' ? allAttack : allMove;
      button.setAttribute('aria-checked', String(checked));
      button.tabIndex = checked || (!allAttack && !allMove && button.dataset.movement === 'move') ? 0 : -1;
    });
    const text = allAttack ? 'Clic derecho: avanza combatiendo y retoma el destino.' :
      allMove ? 'Clic derecho: prioriza llegar al destino.' : 'El grupo tiene modos distintos. Elige uno para unificarlos.';
    if (help.textContent !== text) help.textContent = text;
  }

  // What the player knows about a tech structure: the live state if it is theirs, else the last one seen.
  techView(b) { return b.team === this.game.player || this.game.spectate ? { ...b.tech, team: b.team } : b.tech.view; }

  techPanel(b, panel) {
    const g = this.game, v = this.techView(b), own = v.team === g.player && !g.spectate;
    const owner = !v.team ? 'Sin dueño' : g.spectate ? TEAMS[v.team].name : own ? 'Bajo tu control' : 'En manos del enemigo';
    panel.innerHTML = `<div class="sp-head"><img src="${this.icons[b.def.id]}"><div><div class="sp-name">${b.def.name}</div>` +
      `<div class="sp-sub">Estructura tecnológica · ${owner}</div></div></div>` +
      `<div class="hpbar"><i></i></div><div class="sp-tech"></div>` +
      (v.state === 'repairing' ? '<div class="repairbar"><i></i></div>' : '') +
      (own && v.state === 'repairing' ? `<button id="repair-btn">${b.tech.repairing ? 'Pausar reparación' : 'Reanudar reparación'}</button>` : '') +
      (own && v.state === 'online' ? this.repairControls(b) : '') +
      `<div class="sp-desc">${b.def.desc}</div>`;
    const rb = $('repair-btn');
    if (rb) rb.onclick = () => { g.techSites.setRepairing(b, !b.tech.repairing); g.audio.play('click'); this.refreshSelPanel(true); };
    this.bindRepair(b);
  }

  // Repair switch for a damaged structure of the player's: a status line and a toggle button (R).
  repairControls(b) {
    const g = this.game;
    if (g.spectate || b.team !== g.player || (!b.repairing && !canRepairBuilding(b))) return '';
    return `<div class="sp-repair"></div><button id="bld-repair-btn">${b.repairing ? 'Detener reparación (R)' : 'Reparar (R)'}</button>`;
  }

  bindRepair(b) {
    const btn = $('bld-repair-btn');
    if (btn) btn.onclick = () => { this.input.toggleRepair([b]); this.refreshSelPanel(true); };
  }

  repairStatus(b) {
    const g = this.game, left = Math.ceil(buildingRepairCost(b.def) * (b.maxHp - b.hp) / b.maxHp);
    if (!b.repairing) return `Dañado · reparación completa: ${left} $`;
    return `Reparando · faltan ${left} $` + (b.repairWaiting ? ' · SIN FONDOS' : g.lowPower(b.team) ? ' · energía baja: más lenta' : '');
  }

  techStatus(b) {
    const g = this.game, v = this.techView(b), own = v.team === g.player && !g.spectate;
    if (v.state === 'online') {
      const sw = g.superweapons;
      if (b.def.globalRadar) {
        if (!own && !g.spectate) return 'Operativa';
        return globalRadarActive(b) ? 'Radar activo · visión de todo el mapa · ⚡ −50' : 'SIN ENERGÍA · cobertura global desactivada';
      }
      if (b.def.superweapon) {
        if (!own) return 'Operativa';
        if (sw.isReady(b)) return `${b.def.superweapon.title} LISTO · pulsa su botón en la barra lateral`;
        return `Cargando ${Math.floor(sw.progress(b) * 100)} % · ${clock(sw.remaining(b))}` + (g.lowPower(b.team) ? ' · SIN ENERGÍA' : '');
      }
      if (b.def.income) {
        if (!own && !g.spectate) return 'Operativa';
        const income = b.def.income, amount = income.amount * g.teams[b.team].income;
        return `Operativa · +${amount} $ cada ${income.interval} s · próximo ingreso en ${clock(income.interval - (b.tech.incomeT || 0))}`;
      }
      if (!b.def.produces) return 'Operativa';
      const unit = Object.values(DEFS).find((d) => d.producer === b.def.produces);
      return own ? `Operativa · construye el ${unit.name} desde Vehículos · clic derecho: punto de reunión` : 'Operativa';
    }
    if (v.state === 'ruin') return `En ruinas · clic derecho con un ${ROLE[this.faction].engineer.name.toLowerCase()} para capturarla`;
    const pct = Math.floor(v.progress * 100);
    if (!own) return `En reparación · ${pct} %`;
    const left = Math.ceil(b.def.repairCost - b.tech.paid);
    return `Reparando · ${pct} % · faltan ${left} $` + (!b.tech.repairing ? ' · EN PAUSA' : b.tech.waiting ? ' · SIN FONDOS' : '');
  }

  updateSelBars() {
    this.refreshMovementControls();
    const sel = this.input.sel, bar = document.querySelector('#selpanel .hpbar i');
    if (!bar || !sel.length) return;
    const tech = document.querySelector('#selpanel .sp-tech');
    if (tech && sel[0].tech) {
      tech.textContent = this.techStatus(sel[0]);
      const repair = document.querySelector('#selpanel .repairbar i');
      if (repair) repair.style.width = (this.techView(sel[0]).progress * 100).toFixed(1) + '%';
    }
    const repairLine = document.querySelector('#selpanel .sp-repair');
    if (repairLine && sel.length === 1) repairLine.textContent = this.repairStatus(sel[0]);
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
    // The ground texture extends past the playable square; the minimap shows only the square.
    const v = this.game.visuals, g = v.groundCanvas, m = g.width * v.groundMargin / (SIZE + 2 * v.groundMargin);
    x.drawImage(g, m, m, g.width - 2 * m, g.height - 2 * m, 0, 0, W, W);
    const colors = v.theme.mini;
    x.fillStyle = colors.tree;
    for (const t of this.game.map.trees) x.fillRect(t.x * k - 1, t.z * k - 1, 2.2, 2.2);
    x.fillStyle = colors.rock;
    for (const r of this.game.map.rocks) x.fillRect(r.x * k - 2.2, r.z * k - 2.2, 4.4, 4.4);
    x.fillStyle = colors.cliff;
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
        if (units.length) { this.input.orderMove(units, w.x, w.z); this.game.fx.marker(w.x, w.z, units.some((u) => u.attackMoveDefault) ? 'attack' : 'move'); this.game.audio.play('order'); }
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
    for (const crate of g.cashCrates.items) {
      if (crate.collected || !(crate.seen || g.spectate)) continue;
      const x = crate.x * k, z = crate.z * k;
      c.fillStyle = g.visibleAt(crate.x, crate.z) ? '#ffd36b' : '#a88c46';
      c.beginPath(); c.moveTo(x, z - 3); c.lineTo(x + 3, z); c.lineTo(x, z + 3); c.lineTo(x - 3, z); c.closePath(); c.fill();
      c.strokeStyle = '#332a13'; c.lineWidth = 1; c.stroke();
    }
    for (const b of g.buildings) {
      if (b.dead || b.def.tech || !(b.team === g.player || b.seen || g.spectate)) continue;
      c.fillStyle = TEAMS[b.team].css;
      const r = b.rect;
      c.fillRect(r.x0 * k, r.z0 * k, Math.max(3, (r.x1 - r.x0) * k), Math.max(3, (r.z1 - r.z0) * k));
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1;
      c.strokeRect(r.x0 * k, r.z0 * k, Math.max(3, (r.x1 - r.x0) * k), Math.max(3, (r.z1 - r.z0) * k));
    }
    // Tech structures: a diamond in the owner's colour (as last seen), white while in ruins.
    for (const b of g.techSites.items) {
      if (!(b.seen || g.spectate)) continue;
      const v = this.techView(b), x = b.x * k, z = b.z * k, r = 5.5;
      c.fillStyle = v.team ? TEAMS[v.team].css : '#e8ecef';
      c.beginPath(); c.moveTo(x, z - r); c.lineTo(x + r, z); c.lineTo(x, z + r); c.lineTo(x - r, z); c.closePath(); c.fill();
      c.strokeStyle = '#111'; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = '#111'; c.fillRect(x - 1.2, z - 1.2, 2.4, 2.4);
    }
    for (const u of g.units) {
      if (u.dead || !g.isVisibleEntity(u)) continue;
      if (u.selected && u.def.radar && (u.team === this.team || g.spectate)) {
        c.save();
        c.strokeStyle = TEAMS[u.team].css; c.lineWidth = 1;
        c.setLineDash([4, 3]);
        c.beginPath(); c.arc(u.x * k, u.z * k, u.def.sight * k, 0, Math.PI * 2); c.stroke();
        c.restore();
      }
      c.fillStyle = TEAMS[u.team].css;
      const s = u.radius > 2 ? 4 : u.radius > 1.1 ? 3 : 2;
      c.fillRect(u.x * k - s / 2, u.z * k - s / 2, s, s);
    }
    // superarmas en camino
    for (const s of g.superweapons.strikes) {
      c.strokeStyle = s.sw.kind === 'ion' ? '#6fd8ff' : '#ff4a3a'; c.lineWidth = 2;
      c.globalAlpha = 0.5 + 0.5 * Math.sin(g.time * 10);
      c.beginPath(); c.arc(s.x * k, s.z * k, Math.max(4, s.sw.radius * k), 0, 6.3); c.stroke();
      c.globalAlpha = 1;
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
    const col = own ? '#5cf08a' : e.team ? '#ff5a50' : '#d9dde2';
    c.lineWidth = mode === 'hover' ? 1.5 : 2;
    c.strokeStyle = mode === 'hover' ? 'rgba(255,255,255,0.8)' : col;
    let bx, by, bw;
    if (e.kind === 'unit') {
      const p = inp.project(e.x, 0.1, e.z), r = e.radius * 1.25;
      const px = inp.project(e.x + r, 0.1, e.z), pz = inp.project(e.x, 0.1, e.z + r);
      const rx = Math.abs(px.x - p.x), ry = Math.abs(pz.y - p.y);
      // The circle lies on the ground in the 3D scene, so the unit stays visible on top of it.
      if (mode !== 'bar') {
        if (this.rings) this.rings.add(e, mode === 'hover' ? '#ffffff' : col);
        else { c.beginPath(); c.ellipse(p.x, p.y, rx, ry, 0, 0, 6.3); c.stroke(); }
      }
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

  drawIncomeLabels() {
    const g = this.game, c = this.ctx;
    this.incomeLabels = this.incomeLabels.filter((label) => g.time - label.t < 2);
    if (!this.incomeLabels.length) return;
    c.save();
    c.font = 'bold 18px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillStyle = '#ffd36b'; c.strokeStyle = 'rgba(0,0,0,.9)'; c.lineWidth = 3;
    c.lineJoin = 'round'; c.shadowColor = '#000'; c.shadowBlur = 5;
    for (const label of this.incomeLabels) {
      if (!g.spectate && label.team !== g.player) continue;
      const p = this.input.project(label.x, label.height + 4, label.z);
      if (p.z < -1 || p.z > 1 || p.x < -50 || p.x > this.cv.width / this.dpr + 50) continue;
      const t = clamp((g.time - label.t) / 2, 0, 1), y = p.y - t * 32;
      c.globalAlpha = Math.min(1, (1 - t) * 2);
      const text = `+${label.amount.toLocaleString('es-ES', { maximumFractionDigits: 2 })} $`;
      c.strokeText(text, p.x, y); c.fillText(text, p.x, y);
    }
    c.restore();
  }

  drawOverlay() {
    const c = this.ctx, inp = this.input, g = this.game;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    const drawn = new Set();
    this.rings?.begin();
    for (const e of inp.sel) { this.drawEntity(e, 'sel'); drawn.add(e); }
    if (inp.hover && !drawn.has(inp.hover)) { this.drawEntity(inp.hover, 'hover'); drawn.add(inp.hover); }
    this.rings?.end();
    for (const e of [...g.units, ...g.buildings]) {
      if (drawn.has(e) || e.dead) continue;
      if ((e.hp < e.maxHp && g.time - e.lastHit < 6) || (e.kind === 'building' && e.team === g.player && e.hp < e.maxHp && inp.keys.has('AltLeft'))) this.drawEntity(e, 'bar');
    }
    for (const unit of g.units) this.drawRank(unit);
    // Own defences shut down by a power shortage show a blinking red bolt.
    if (g.lowPower(this.team) && Math.sin(g.time * 6) > -0.3) {
      c.save();
      c.fillStyle = '#ff453a'; c.strokeStyle = '#1a0605'; c.lineWidth = 1.5;
      for (const b of g.buildings) {
        if (b.dead || b.team !== this.team || !b.def.weapon || !b.complete || !b.mesh.visible) continue;
        const p = inp.project(b.x, b.def.height + 1.8, b.z);
        if (p.z < -1 || p.z > 1) continue;
        c.beginPath();
        for (const [x, y] of [[2, -11], [-6, 1], [-1, 1], [-3, 11], [6, -2], [1, -2], [4, -11]]) c.lineTo(p.x + x, p.y + y);
        c.closePath(); c.fill(); c.stroke();
      }
      c.restore();
    }
    c.save();
    c.font = 'bold 12px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    for (const crate of g.cashCrates.items) {
      if (crate.collected || !g.visibleAt(crate.x, crate.z)) continue;
      const p = inp.project(crate.x, 1.8, crate.z);
      if (p.z < -1 || p.z > 1) continue;
      const text = `Caja · +${crate.amount} $`, width = c.measureText(text).width;
      c.fillStyle = 'rgba(0,0,0,.75)'; c.fillRect(p.x - width / 2 - 5, p.y - 17, width + 10, 20);
      c.fillStyle = '#ffd36b'; c.fillText(text, p.x, p.y);
    }
    for (const b of g.techSites.items) {
      if (!g.techSites.inSight(b)) continue;
      const p = inp.project(b.x, b.def.height + 2.2, b.z);
      if (p.z < -1 || p.z > 1) continue;
      const v = this.techView(b);
      const state = v.state === 'ruin' ? 'en ruinas' : v.state === 'repairing' ? `reparando ${Math.floor(v.progress * 100)} %` : 'operativa';
      const text = `${b.def.name} · ${state}`, width = c.measureText(text).width;
      c.fillStyle = 'rgba(0,0,0,.75)'; c.fillRect(p.x - width / 2 - 5, p.y - 17, width + 10, 20);
      c.fillStyle = v.team ? TEAMS[v.team].css : '#e8ecef'; c.fillText(text, p.x, p.y);
    }
    c.restore();
    this.drawIncomeLabels();
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
    // Superweapon aim: the blast radius on the ground under the cursor.
    const st = inp.superTarget;
    if (st && inp.mouse.inside) {
      const gp = inp.groundAt(inp.mouse.cx, inp.mouse.cy);
      if (gp) {
        const R = st.def.superweapon.radius, ok = g.superweapons.canTarget(st.team, gp.x, gp.z);
        c.strokeStyle = ok ? (st.def.superweapon.kind === 'ion' ? '#6fd8ff' : '#ff6a50') : '#888';
        c.fillStyle = ok ? 'rgba(255,90,60,0.12)' : 'rgba(128,128,128,0.1)';
        c.lineWidth = 2; c.beginPath();
        for (let i = 0; i <= 48; i++) {
          const a = (i / 48) * Math.PI * 2, p = inp.project(gp.x + Math.cos(a) * R, 0.2, gp.z + Math.sin(a) * R);
          if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y);
        }
        c.fill(); c.stroke();
      }
    }
    $('modehint').classList.toggle('hidden', !(inp.attackMode || inp.placing || st));
    $('modehint').textContent = st ? `${st.def.superweapon.title.toUpperCase()} · clic izquierdo en una zona explorada · Esc o clic derecho cancela` :
      inp.attackMode ? 'ATACAR-MOVER · clic izquierdo en el destino · Esc cancela' : (inp.placing ? `Colocando: ${inp.placing.name} · clic izquierdo coloca · clic derecho cancela` : '');
  }

  // ---------------------------------------------------------------- ciclo
  update(dt) {
    const g = this.game, T = g.teams[this.team];
    this.t += dt;
    // créditos con contador animado; hace tic-tic mientras sube
    const shown = Math.floor(this.credShown);
    this.credShown += (T.credits - this.credShown) * Math.min(1, dt * 8);
    if (Math.abs(T.credits - this.credShown) < 1) this.credShown = T.credits;
    if (Math.floor(this.credShown) > shown) g.audio.play('cashup');
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
      this.refreshSupers();
    }
    this.drawMinimap();
  }
}
