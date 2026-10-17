// Menú de pausa (Esc o ☰): continuar, reiniciar con la misma configuración, controles, abandonar
// y volúmenes de sonido. Mientras está abierto la partida queda en pausa y no se aceptan órdenes.
import { DIFFICULTY } from './config.js';

const $ = (id) => document.getElementById(id);
const pct = (v) => `${Math.round(v * 100)} %`;
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// Dirección que repite esta partida: dificultad, bando, aspecto y escenario del mapa, esquinas
// y estructuras tecnológicas. Las cajas de dinero se vuelven a repartir.
export function restartUrl(game, base = location) {
  const p = new URLSearchParams();
  p.set('autostart', Object.keys(DIFFICULTY).find((k) => DIFFICULTY[k] === game.difficulty) || 'normal');
  if (game.spectate) p.set('spectate', '1'); else p.set('side', game.player);
  p.set('map', game.theme.id);
  if (Number.isFinite(game.map.seed)) p.set('seed', game.map.seed);
  if (game.startSlots) p.set('spawn', `${game.startSlots.human},${game.startSlots.machine}`);
  const tech = [...new Set(game.techSites.items.map((b) => b.def.id))];
  p.set('tech', tech.length ? tech.join(',') : 'none');
  const speed = new URLSearchParams(base.search).get('speed');
  if (speed) p.set('speed', speed);
  return `${base.pathname}?${p}`;
}

const CONFIRM = {
  restart: ['Se perderá la partida actual y empezará otra con la misma configuración.', 'Reiniciar'],
  quit: ['Se perderá la partida actual y volverás al menú principal.', 'Abandonar'],
};

export class GameMenu {
  constructor(game, navigate = (url) => location.assign(url)) {
    this.game = game; this.navigate = navigate;
    this.open = false; this.wasPaused = false; this.pending = null;
    this.el = $('game-menu');
    this.el.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act) this.act(act);
      else if (e.target === this.el) this.close();   // clic fuera de la tarjeta
    });
    for (const input of this.el.querySelectorAll('input[data-vol]')) {
      const kind = input.dataset.vol, out = input.parentElement.querySelector('output');
      const show = () => { out.textContent = pct(game.audio.volumes[kind]); input.value = Math.round(game.audio.volumes[kind] * 100); };
      input.oninput = () => { game.audio.setVolume(kind, input.value / 100); out.textContent = pct(input.value / 100); };
      show();
    }
    $('btn-menu').onclick = () => this.toggle();
  }

  toggle() { if (this.open) this.close(); else this.show(); }

  show() {
    if (this.open) return;
    const g = this.game;
    this.open = true; this.wasPaused = g.paused; g.paused = true;
    $('pause').classList.add('hidden');
    $('gm-title').textContent = g.over ? 'Partida terminada' : 'Partida en pausa';
    $('gm-info').textContent = [g.difficulty?.label, g.theme?.label, clock(g.over?.time ?? g.time)].filter(Boolean).join(' · ');
    this.confirm(null);
    this.el.classList.remove('hidden');
    this.el.querySelector('[data-act="resume"]').focus();
    g.audio.play('click');
  }

  close() {
    if (!this.open) return;
    const g = this.game;
    this.open = false; this.pending = null;
    this.el.classList.add('hidden');
    $('help').classList.add('hidden');
    g.paused = this.wasPaused;
    $('pause').classList.toggle('hidden', !g.paused);
    document.activeElement?.blur();
  }

  // Esc dentro del menú: cierra primero la ayuda o la confirmación, después el menú.
  back() {
    if (!$('help').classList.contains('hidden')) $('help').classList.add('hidden');
    else if (this.pending) this.confirm(null);
    else this.close();
  }

  act(a) {
    if (a === 'resume') this.close();
    else if (a === 'help') $('help').classList.remove('hidden');
    else if (a === 'restart' || a === 'quit') {
      // Con la partida ya terminada no hay nada que perder: sin confirmación.
      if (this.game.over) this.leave(a); else this.confirm(a);
    } else if (a === 'cancel') this.confirm(null);
    else if (a === 'confirm' && this.pending) this.leave(this.pending);
  }

  leave(what) { this.navigate(what === 'restart' ? restartUrl(this.game) : location.pathname); }

  confirm(what) {
    this.pending = what;
    $('gm-actions').hidden = !!what;
    $('gm-confirm').hidden = !what;
    if (!what) return;
    const [text, label] = CONFIRM[what], ok = this.el.querySelector('[data-act="confirm"]');
    $('gm-confirm-text').textContent = text;
    ok.textContent = label;
    ok.focus();
  }
}
