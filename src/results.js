// Pantalla de resultados: tabla comparada de los dos bandos y curvas de la partida (valor del
// ejército y créditos ganados). Se construye con nodos y textContent; nada de HTML interpolado.
import { TEAMS } from './config.js';

const SIDES = ['human', 'machine'];
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const num = (v) => Math.round(v || 0).toLocaleString('es-ES');

// [etiqueta, valor(stats), más es mejor]
const ROWS = [
  ['Combate'],
  ['Unidades destruidas', (s) => s.unitsKilled, true],
  ['Unidades perdidas', (s) => s.unitsLost, false],
  ['Edificios destruidos', (s) => s.buildingsKilled, true],
  ['Edificios perdidos', (s) => s.buildingsLost, false],
  ['Producción'],
  ['Unidades producidas', (s) => s.trained, true],
  ['Edificios construidos', (s) => s.built, true],
  ['Economía'],
  ['Créditos ganados', (s) => s.earned, true],
  ['· de la cosecha', (s) => s.harvested, true],
  ['· de cajas de dinero', (s) => s.crateCredits, true, (s) => `${num(s.crates)} ${s.crates === 1 ? 'caja' : 'cajas'}`],
  ['· de la mina de tibero', (s) => s.mined, true],
  ['Tecnología'],
  ['Estructuras capturadas', (s) => s.captured, true],
  ['Superarmas lanzadas', (s) => s.strikes, true],
];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export function renderResults(root, game) {
  root.replaceChildren();
  const meta = [`Duración ${clock(game.over?.time ?? game.time)}`, game.map?.name, game.difficulty && `IA en ${game.difficulty.label}`];
  root.append(el('div', 'res-meta', meta.filter(Boolean).join(' · ')));
  root.append(table(game));
  if ((game.history?.length || 0) >= 2) root.append(chart(game));
}

function who(game, team) {
  if (game.spectate) return 'IA';
  return team === game.player ? 'Tú' : 'IA';
}

function table(game) {
  const t = el('table', 'res-table'), head = el('tr');
  head.append(el('th'));
  for (const team of SIDES) {
    const th = el('th', `res-side ${team}`);
    th.append(el('b', null, TEAMS[team].name), el('small', null, who(game, team)));
    head.append(th);
  }
  t.appendChild(el('thead')).append(head);
  const body = t.appendChild(el('tbody'));
  for (const [label, get, more, extra] of ROWS) {
    if (!get) { const tr = el('tr', 'res-group'); tr.append(el('th', null, label)); tr.lastChild.colSpan = 3; body.append(tr); continue; }
    const vals = SIDES.map((team) => get(game.teams[team].stats) || 0);
    const best = vals[0] === vals[1] ? -1 : (more ? vals.indexOf(Math.max(...vals)) : vals.indexOf(Math.min(...vals)));
    const tr = el('tr'); tr.append(el('th', null, label));
    vals.forEach((v, i) => {
      const td = el('td', i === best ? 'best' : null, num(v));
      if (extra) td.append(el('small', null, extra(game.teams[SIDES[i]].stats)));
      tr.append(td);
    });
    body.append(tr);
  }
  return t;
}

// ----------------------------------------------------------------------------- curvas
const W = 640, H = 220, PAD = { l: 52, r: 74, t: 14, b: 28 };
const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(SVG, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
const METRICS = [['army', 'Valor del ejército', (v) => `${num(v)} $`], ['earned', 'Créditos ganados', (v) => `${num(v)} $`]];

function niceStep(max, count = 4) {
  const raw = Math.max(1, max) / count, mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
}

function chart(game) {
  const box = el('section', 'res-chart'), bar = el('div', 'res-chart-bar');
  const tabs = el('div', 'res-tabs'), legend = el('div', 'res-legend');
  tabs.setAttribute('role', 'tablist');
  for (const team of SIDES) {
    const k = el('span', `res-key ${team}`); k.append(el('i'), document.createTextNode(TEAMS[team].name)); legend.append(k);
  }
  bar.append(tabs, legend);
  const wrap = el('div', 'res-plot'), tip = el('div', 'res-tip');
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  wrap.append(svg, tip);
  const data = el('details', 'res-data');
  box.append(bar, wrap, data);

  let metric = 'army';
  const buttons = METRICS.map(([key, label]) => {
    const b = el('button', null, label); b.type = 'button'; b.setAttribute('role', 'tab');
    b.onclick = () => { metric = key; draw(); };
    tabs.append(b);
    return [key, b];
  });

  function draw() {
    for (const [key, b] of buttons) { b.classList.toggle('active', key === metric); b.setAttribute('aria-selected', key === metric); }
    const [, label, fmt] = METRICS.find(([k]) => k === metric);
    const h = game.history, t1 = h[h.length - 1].t || 1;
    const max = Math.max(1, ...h.flatMap((s) => SIDES.map((team) => s[team][metric])));
    const step = niceStep(max), top = Math.ceil(max / step) * step;
    const x = (t) => PAD.l + (t / t1) * (W - PAD.l - PAD.r), y = (v) => H - PAD.b - (v / top) * (H - PAD.t - PAD.b);
    svg.replaceChildren();
    svg.setAttribute('aria-label', `${label} de cada bando a lo largo de la partida`);
    const grid = svg.appendChild(svgEl('g', { class: 'res-grid' }));
    for (let v = 0; v <= top + 1e-9; v += step) {
      grid.append(svgEl('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v) }));
      const tx = svgEl('text', { x: PAD.l - 8, y: y(v) + 4, 'text-anchor': 'end' }); tx.textContent = num(v); grid.append(tx);
    }
    const minuteStep = Math.max(1, Math.ceil(t1 / 60 / 6));
    for (let m = 0; m * 60 <= t1 + 1e-9; m += minuteStep) {
      const tx = svgEl('text', { x: x(m * 60), y: H - 8, 'text-anchor': 'middle' }); tx.textContent = `${m}:00`; grid.append(tx);
    }
    const ends = [];
    for (const team of SIDES) {
      const d = h.map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s[team][metric]).toFixed(1)}`).join('');
      svg.append(svgEl('path', { d, class: `res-line ${team}` }));
      ends.push([team, y(h[h.length - 1][team][metric])]);
    }
    // etiquetas directas al final de cada línea, separadas si se pisan
    ends.sort((a, b) => a[1] - b[1]);
    if (ends[1][1] - ends[0][1] < 14) { const mid = (ends[0][1] + ends[1][1]) / 2; ends[0][1] = mid - 7; ends[1][1] = mid + 7; }
    for (const [team, ly] of ends) {
      const tx = svgEl('text', { x: W - PAD.r + 8, y: ly + 4, class: 'res-end' }); tx.textContent = TEAMS[team].name; svg.append(tx);
    }
    const cross = svg.appendChild(svgEl('line', { class: 'res-cross', y1: PAD.t, y2: H - PAD.b }));
    const dots = SIDES.map((team) => svg.appendChild(svgEl('circle', { r: 4, class: `res-dot ${team}` })));
    const hit = svg.appendChild(svgEl('rect', { x: PAD.l, y: PAD.t, width: W - PAD.l - PAD.r, height: H - PAD.t - PAD.b, class: 'res-hit', tabindex: 0 }));
    const show = (i) => {
      const s = h[i], cx = x(s.t);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); svg.classList.add('hover');
      SIDES.forEach((team, j) => { dots[j].setAttribute('cx', cx); dots[j].setAttribute('cy', y(s[team][metric])); });
      tip.replaceChildren(el('div', 'res-tip-t', clock(s.t)));
      for (const team of SIDES) {
        const row = el('div', `res-tip-row ${team}`); row.append(el('i'), el('b', null, fmt(s[team][metric])), el('span', null, TEAMS[team].name));
        tip.append(row);
      }
      const r = svg.getBoundingClientRect(), px = (cx / W) * r.width;
      tip.style.left = `${Math.min(px + 12, r.width - tip.offsetWidth - 4)}px`;
      tip.classList.add('on');
    };
    const hide = () => { svg.classList.remove('hover'); tip.classList.remove('on'); };
    let at = h.length - 1;
    hit.onpointermove = (e) => {
      const r = svg.getBoundingClientRect(), t = ((e.clientX - r.left) / r.width * W - PAD.l) / (W - PAD.l - PAD.r) * t1;
      at = h.reduce((bi, s, i) => (Math.abs(s.t - t) < Math.abs(h[bi].t - t) ? i : bi), 0);
      show(at);
    };
    hit.onpointerleave = hide;
    hit.onfocus = () => show(at);
    hit.onblur = hide;
    hit.onkeydown = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); at = Math.max(0, Math.min(h.length - 1, at + (e.key === 'ArrowLeft' ? -1 : 1))); show(at); }
    };

    // vista en tabla de las mismas muestras
    data.replaceChildren(el('summary', null, 'Ver datos'));
    const dt = data.appendChild(el('table', 'res-table small')), hr = dt.appendChild(el('thead')).appendChild(el('tr'));
    hr.append(el('th', null, 'Tiempo'), ...SIDES.map((team) => el('th', null, TEAMS[team].name)));
    const db = dt.appendChild(el('tbody'));
    for (const s of h) { const tr = el('tr'); tr.append(el('th', null, clock(s.t)), ...SIDES.map((team) => el('td', null, fmt(s[team][metric])))); db.append(tr); }
  }
  draw();
  return box;
}
