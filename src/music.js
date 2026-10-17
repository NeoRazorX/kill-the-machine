// Música procedural con WebAudio: una cola de pistas de ambiente que rotan y una de combate, con
// fundido cruzado según la intensidad del combate. Las pistas están en music-tracks.js y el
// sintetizador en synth.js; sin archivos de audio.
import { Synth } from './synth.js';
import { PLAYLIST } from './music-tracks.js';

export const MUSIC = {
  level: 0.07,        // bus de música, por debajo de los efectos (que suenan a 0.1–0.7)
  window: 4,          // s: un golpe o disparo cuenta como combate durante este tiempo
  check: 0.5,         // s de juego entre mediciones
  enter: 2,           // entidades en combate para empezar a contar
  enterHold: 1,       // s seguidos por encima del umbral para pasar a combate
  calm: 10,           // s seguidos sin combate para volver a la pista normal
  fadeIn: 2.5,        // s del fundido hacia la pista entrante
  fadeOut: 5,         // s del fundido de la pista saliente
};

const T = (e, time, w) => (e.lastHit != null && time - e.lastHit < w) || (e.lastFired != null && time - e.lastFired < w);

// Entidades implicadas en combate reciente que el jugador debería "oír": las propias siempre,
// las ajenas solo si están a la vista. En modo espectador cuenta todo.
export function combatScore(game) {
  const time = game.time, w = MUSIC.window;
  let n = 0;
  const count = (e) => {
    if (e.dead || !e.team || !T(e, time, w)) return;
    if (game.spectate || e.team === game.player || game.isVisibleEntity(e)) n++;
  };
  for (const u of game.units) count(u);
  for (const b of game.buildings) count(b);
  return n;
}

// Histéresis: entra en combate tras `enterHold` s con puntuación ≥ `enter` (o al instante si
// se dobla el umbral) y sale tras `calm` s seguidos a cero. Cualquier actividad reinicia la calma.
export class CombatMonitor {
  constructor(cfg = MUSIC) { this.cfg = cfg; this.combat = false; this.hot = 0; this.quiet = 0; }

  update(dt, score) {
    const c = this.cfg;
    if (!this.combat) {
      this.hot = score >= c.enter ? this.hot + dt : 0;
      if (this.hot >= c.enterHold || score >= c.enter * 2) { this.combat = true; this.quiet = 0; this.hot = 0; return true; }
    } else {
      this.quiet = score > 0 ? 0 : this.quiet + dt;
      if (this.quiet >= c.calm) { this.combat = false; this.quiet = 0; return true; }
    }
    return false;
  }
}

// Una pista sonando: avanza paso a paso por delante del reloj de audio, en su propio bus.
class Track {
  constructor(music, score, at, { entry = 0, fade = 0, loops = score.loops || 1 } = {}) {
    this.music = music; this.score = score;
    this.bus = music.synth.makeBus();
    this.step = entry * 16; this.at = this.next = at;
    this.end = this.step + loops * score.bars * 16;
    this.on = true; this.until = Infinity;
    if (fade) for (const g of Object.values(this.bus)) { g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(1, at + fade); }
  }

  get done() { return this.step >= this.end; }

  schedule(now, ahead) {
    if (!this.on && now > this.until) return;
    const m = this.music.synth, sc = this.score, s = 60 / sc.bpm / 4;
    m.bus = this.bus;   // las voces escriben en la pista que se está programando
    if (this.next < now) this.next = now + 0.05;   // se quedó atrás (pestaña en segundo plano)
    while (this.next < now + ahead && !this.done && (this.on || this.next < this.until)) {
      const bar = Math.floor(this.step / 16) % sc.bars, st = this.step % 16;
      if (!this.music.muted) sc.play(m, this.next + (st % 2 ? (sc.swing || 0) * s : 0), bar, st, s);
      this.step++; this.next += s;
    }
  }

  fadeOut(now, time) {
    if (!this.on) return;
    this.on = false; this.until = now + time + 0.1;
    this.music.synth.fadeBus(this.bus, 0, time);
  }
}

export class Music {
  constructor(ctx, destination) {
    this.ctx = ctx; this.muted = false;
    this.monitor = new CombatMonitor(); this.checkT = 0;
    this.bus = ctx.createGain(); this.bus.gain.value = MUSIC.level;
    this.bus.connect(destination);
    this.synth = new Synth(ctx, this.bus);
    this.playlist = PLAYLIST;
    this.turn = { ambient: Math.floor(Math.random() * PLAYLIST.ambient.length) - 1, combat: -1 };
    this.playing = [];     // pistas sonando o terminando su fundido
    this.current = null; this.mode = null;
  }

  get combat() { return this.monitor.combat; }

  // volume 0–1 del menú, sobre el nivel base del bus
  setVolume(volume) { this.bus.gain.setTargetAtTime(MUSIC.level * volume, this.ctx.currentTime, 0.02); }

  start() { if (!this.mode) this.setMode('ambient'); }

  // Siguiente pista de la cola del modo, empezando en `at`.
  launch(mode, at, fade) {
    const list = this.playlist[mode], i = this.turn[mode] = (this.turn[mode] + 1) % list.length, score = list[i];
    const combat = mode === 'combat';   // el combate da vueltas hasta que acaba la batalla
    const tr = new Track(this, score, at, { entry: combat ? score.entry || 0 : 0, fade, loops: combat ? Infinity : undefined });
    this.synth.setTempo(score.bpm);
    this.playing.push(tr);
    return tr;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    const first = !this.mode, now = this.ctx.currentTime;
    this.mode = mode;
    for (const tr of this.playing) tr.fadeOut(now, MUSIC.fadeOut);
    this.current = this.launch(mode, now + 0.05, first ? 0 : MUSIC.fadeIn);
  }

  // dt de juego: mide el combate cada `check` s y cambia de pista con histéresis.
  updateCombat(dt, game) {
    this.checkT += dt;
    if (this.checkT < MUSIC.check) return;
    const step = this.checkT; this.checkT = 0;
    if (this.monitor.update(step, combatScore(game))) this.setMode(this.monitor.combat ? 'combat' : 'ambient');
  }

  tick() {
    const now = this.ctx.currentTime, cur = this.current;
    // La pista de ambiente agotó su turno: la siguiente de la cola entra justo en la frontera.
    if (cur && cur.done && this.mode) {
      cur.on = false; cur.until = cur.next;
      this.current = this.launch(this.mode, cur.next, 0);
    }
    for (const tr of this.playing) tr.schedule(now, 0.3);
    this.playing = this.playing.filter((tr) => {
      if (tr.on || now < tr.until + 5) return true;
      for (const g of Object.values(tr.bus)) g.disconnect();
      return false;
    });
  }
}
