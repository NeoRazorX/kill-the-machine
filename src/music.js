// Música procedural con WebAudio: una pista ambiental tensa y otra de combate, en re menor,
// con fundido cruzado según la intensidad del combate. Sin archivos de audio.

export const MUSIC = {
  level: 0.2,         // bus de música, por debajo de los efectos (que suenan a 0.1–0.7)
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

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
// re menor: i – VI – VII – v (la mayor al final para tensar la vuelta)
const CHORDS = { D: [62, 65, 69], Bb: [58, 62, 65], C: [60, 64, 67], Am: [57, 60, 64], A: [57, 61, 64], F: [57, 60, 65], E: [56, 59, 64] };

const AMBIENT = {
  bpm: 88,
  bars: ['D', 'D', 'Bb', 'Bb', 'C', 'C', 'Am', 'A'],
  roots: [38, 38, 34, 34, 36, 36, 33, 33],
  play(m, t, bar, step, s) {
    const chord = CHORDS[this.bars[bar]], root = this.roots[bar];
    if (step === 0 && bar % 2 === 0) for (const n of chord) m.pad(hz(n), t, s * 32, 0.022);
    if (step === 0 || step === 3) m.bass(hz(root), t, s * 2.5, 0.11, 260);            // latido
    if (step === 0 || step === 8) m.kick(t, 0.32);
    if (step === 4 || step === 12) m.hat(t, 0.028, 0.05);
    if (step === 10 && bar % 4 === 1) m.hat(t, 0.018, 0.04);
    if (step === 12 && bar % 2 === 1) m.clank(t, 0.05);
    if (bar >= 4 && step % 3 === 0 && step < 15) {                                    // arpegio 3 contra 4
      const n = chord[(step / 3) % 3] + 12 * (step >= 9 ? 1 : 0);
      m.pluck(hz(n), t, s * 1.5, 0.03);
    }
  },
};

const RIFF = [[0, 74], [3, 72], [6, 69], [8, 70], [10, 69], [12, 65], [14, 67]];
const COMBAT = {
  bpm: 128,
  bars: ['D', 'D', 'Bb', 'C', 'D', 'D', 'F', 'E'],
  roots: [38, 38, 34, 36, 38, 38, 41, 40],
  gallop: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 3, 0, 12, 7],
  play(m, t, bar, step, s) {
    const chord = CHORDS[this.bars[bar]], root = this.roots[bar];
    m.bass(hz(root + this.gallop[step]), t, s * 0.8, 0.075, step % 4 === 0 ? 1500 : 800);
    if (step % 4 === 0 || (step === 14 && bar % 4 === 3)) m.kick(t, 0.42);
    if (step === 4 || step === 12) m.snare(t, 0.14);
    if (step % 2 === 1) m.hat(t, step % 4 === 3 ? 0.032 : 0.016, 0.03);
    if (bar % 2 === 0 && (step === 0 || step === 3 || step === 6)) for (const n of chord) m.stab(hz(n), t, s * 1.2, 0.022);
    if (step === 10 && bar % 4 === 1) m.clank(t, 0.05);
    if (bar >= 4) for (const [st, n] of RIFF) if (st === step) m.lead(hz(n + (bar === 7 ? -1 : 0)), t, s * 1.8, 0.03);
  },
};

class Track {
  constructor(music, score) {
    this.music = music; this.score = score;
    this.out = music.ctx.createGain(); this.out.gain.value = 0;
    this.out.connect(music.bus);
    this.on = false; this.until = 0; this.next = 0; this.step = 0;
  }
  // Pista activa (o terminando su fundido): programa notas por adelantado.
  schedule(now, ahead) {
    if (!this.on && now > this.until) return;
    this.music.current = this;   // las voces escriben en la pista que se está programando
    if (this.next < now) { this.next = now + 0.05; this.step = 0; }
    const s = 60 / this.score.bpm / 4;
    while (this.next < now + ahead) {
      const bar = Math.floor(this.step / 16) % this.score.bars.length;
      if (!this.music.muted) this.score.play(this.music, this.next, bar, this.step % 16, s);
      this.step++; this.next += s;
    }
  }
}

export class Music {
  constructor(ctx, destination, noise) {
    this.ctx = ctx; this.noise = noise; this.muted = false;
    this.monitor = new CombatMonitor(); this.checkT = 0;
    this.bus = ctx.createGain(); this.bus.gain.value = MUSIC.level;
    this.bus.connect(destination);
    // eco suave para dar espacio
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 0.34;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2200;
    this.send = ctx.createGain(); this.send.gain.value = 0.28;
    this.send.connect(this.delay); this.delay.connect(tone); tone.connect(fb); fb.connect(this.delay);
    tone.connect(this.bus);
    this.tracks = { ambient: new Track(this, AMBIENT), combat: new Track(this, COMBAT) };
    this.mode = null;
  }

  get combat() { return this.monitor.combat; }

  start() { if (!this.mode) this.setMode('ambient'); }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    const now = this.ctx.currentTime;
    for (const [name, tr] of Object.entries(this.tracks)) {
      const g = tr.out.gain, on = name === mode, fade = on ? MUSIC.fadeIn : MUSIC.fadeOut;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(on ? 1 : 0, now + fade);
      tr.on = on;
      if (!on) tr.until = now + fade + 0.1;
    }
  }

  // dt de juego: mide el combate cada `check` s y cambia de pista con histéresis.
  updateCombat(dt, game) {
    this.checkT += dt;
    if (this.checkT < MUSIC.check) return;
    const step = this.checkT; this.checkT = 0;
    if (this.monitor.update(step, combatScore(game))) this.setMode(this.monitor.combat ? 'combat' : 'ambient');
  }

  tick() {
    const now = this.ctx.currentTime;
    for (const tr of Object.values(this.tracks)) tr.schedule(now, 0.3);
  }

  // --------------------------------------------------------------- voces
  env(g, t, peak, attack, dur, release = 0.05) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
  }
  osc(type, f, t, dur, detune = 0) {
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    o.start(t); o.stop(t + dur + 0.3);
    return o;
  }
  filter(type, f, q = 1) {
    const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b;
  }
  out(node, send = 0) {
    const tr = this.current; node.connect(tr.out);
    if (send) { const s = this.ctx.createGain(); s.gain.value = send; node.connect(s); s.connect(this.send); }
  }

  pad(f, t, dur, gain) {
    const g = this.ctx.createGain(), lp = this.filter('lowpass', 700, 2);
    lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(1100, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(500, t + dur);
    for (const d of [-9, 9]) this.osc('sawtooth', f, t, dur, d).connect(lp);
    lp.connect(g); this.env(g, t, gain, 1.6, dur, 1.4); this.out(g, 0.4);
  }
  bass(f, t, dur, gain, cutoff) {
    const g = this.ctx.createGain(), lp = this.filter('lowpass', cutoff, 6);
    lp.frequency.setValueAtTime(cutoff, t); lp.frequency.exponentialRampToValueAtTime(cutoff * 0.3, t + dur);
    this.osc('sawtooth', f, t, dur).connect(lp); this.osc('square', f / 2, t, dur).connect(lp);
    lp.connect(g); this.env(g, t, gain, 0.005, dur, 0.04); this.out(g);
  }
  pluck(f, t, dur, gain) {
    const g = this.ctx.createGain(), lp = this.filter('lowpass', 2400, 3);
    lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(400, t + dur);
    this.osc('square', f, t, dur).connect(lp);
    lp.connect(g); this.env(g, t, gain, 0.004, dur * 0.2, dur * 0.8); this.out(g, 0.7);
  }
  stab(f, t, dur, gain) {
    const g = this.ctx.createGain(), lp = this.filter('lowpass', 1800, 4);
    lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(600, t + dur);
    for (const d of [-12, 12]) this.osc('sawtooth', f, t, dur, d).connect(lp);
    lp.connect(g); this.env(g, t, gain, 0.008, dur, 0.06); this.out(g, 0.3);
  }
  lead(f, t, dur, gain) {
    const g = this.ctx.createGain(), lp = this.filter('lowpass', 2200, 2);
    const o = this.osc('square', f * 0.97, t, dur); o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    o.connect(lp); lp.connect(g); this.env(g, t, gain, 0.01, dur, 0.1); this.out(g, 0.5);
  }
  kick(t, gain) {
    const g = this.ctx.createGain(), o = this.osc('sine', 120, t, 0.3);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    o.connect(g); this.env(g, t, gain, 0.003, 0.12, 0.18); this.out(g);
  }
  noiseHit(t, dur, gain, type, f, q, send = 0) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const b = this.filter(type, f, q), g = this.ctx.createGain();
    s.connect(b); b.connect(g); this.env(g, t, gain, 0.002, dur * 0.3, dur * 0.7); this.out(g, send);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.1);
  }
  hat(t, gain, dur) { this.noiseHit(t, dur, gain, 'highpass', 7000, 1); }
  snare(t, gain) {
    this.noiseHit(t, 0.16, gain, 'bandpass', 1900, 0.8, 0.2);
    const g = this.ctx.createGain(), o = this.osc('triangle', 190, t, 0.1);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.1);
    o.connect(g); this.env(g, t, gain * 0.7, 0.002, 0.03, 0.07); this.out(g);
  }
  // golpe metálico inarmónico, de fábrica
  clank(t, gain) {
    this.noiseHit(t, 0.25, gain, 'bandpass', 2600, 9, 0.6);
    for (const f of [1870, 2630, 3910]) {
      const g = this.ctx.createGain(); this.osc('square', f, t, 0.3).connect(g);
      this.env(g, t, gain * 0.12, 0.002, 0.05, 0.25); this.out(g, 0.6);
    }
  }
}

