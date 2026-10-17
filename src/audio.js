// Sonido 100% sintetizado con WebAudio + voz de la "computadora de mando" (speechSynthesis).
import { Music } from './music.js';
import { TEAMS } from './config.js';

const MASTER = 0.5;   // ganancia general con el volumen al 100 %
const VOLUME_KEY = 'ktm.audio';
// Volúmenes del menú de pausa (0–1), recordados entre partidas.
export const VOLUME_DEFAULTS = { master: 1, music: 1, sfx: 1, voice: 1 };
function loadVolumes() {
  const v = { ...VOLUME_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY));
    for (const k in v) if (Number.isFinite(saved?.[k])) v[k] = Math.max(0, Math.min(1, saved[k]));
  } catch { /* sin almacenamiento: valores por defecto */ }
  return v;
}

const MIN_GAP = { rifle: 45, zap: 45, rocket: 90, cannon: 90, plasma: 90, howitzer: 150, laser: 90, explosion: 60, bigexplosion: 150, cashup: 60 };

export class GameAudio {
  constructor(game) {
    this.game = game;
    this.ctx = null; this.master = null; this.noise = null;
    this.muted = false; this.last = {};
    this.lastVoice = 0; this.voiceQueue = [];
    this.music = null; this.musicTimer = null;
    this.volumes = loadVolumes();
  }

  setVolume(kind, value) {
    if (!(kind in this.volumes)) return;
    this.volumes[kind] = Math.max(0, Math.min(1, value));
    try { localStorage.setItem(VOLUME_KEY, JSON.stringify(this.volumes)); } catch { /* no se recuerda */ }
    this.applyVolumes();
    if (kind === 'voice' && !this.volumes.voice && window.speechSynthesis) window.speechSynthesis.cancel();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const v = this.volumes, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER * v.master, t, 0.02);
    this.sfx.gain.setTargetAtTime(v.sfx, t, 0.02);
    this.music?.setVolume(v.music);
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = MASTER;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp); comp.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);   // efectos, aparte de la música
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // Eco para las colas largas (trueno del cañón de iones): 2,4 s de ruido estéreo que decae.
      this.verb = this.ctx.createConvolver();
      const vlen = Math.floor(this.ctx.sampleRate * 2.4), ir = this.ctx.createBuffer(2, vlen, this.ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const ch = ir.getChannelData(c);
        for (let i = 0; i < vlen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / vlen, 3);
      }
      this.verb.buffer = ir;
      const vg = this.ctx.createGain(); vg.gain.value = 0.6;
      this.verb.connect(vg); vg.connect(this.sfx);
      this.music = new Music(this.ctx, this.master);
      this.applyVolumes();
    } catch (e) { this.ctx = null; }
  }

  // Arranca la pista ambiental; el programador va por su cuenta para no depender de los fotogramas.
  startMusic() {
    if (!this.music || this.musicTimer) return;
    this.music.muted = this.muted;
    this.music.start();
    this.music.tick();
    this.musicTimer = setInterval(() => this.music.tick(), 50);
  }

  updateMusic(dt) { if (this.music) this.music.updateCombat(dt, this.game); }

  toggleMute() {
    this.muted = !this.muted;
    this.applyVolumes();
    if (this.music) this.music.muted = this.muted;
    if (this.muted && window.speechSynthesis) window.speechSynthesis.cancel();
    return this.muted;
  }

  volumeAt(x, z) {
    if (x == null) return 1;
    const c = this.game.camTarget;
    if (!c) return 1;
    const d = Math.hypot(x - c.x, z - c.z);
    return Math.pow(Math.max(0, 1 - d / 150), 1.6);
  }

  play(name, x, z) {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < (MIN_GAP[name] || 0)) return;
    this.last[name] = now;
    const v = this.volumeAt(x, z);
    if (v < 0.03) return;
    const fn = this['s_' + name];
    if (fn) fn.call(this, v);
  }

  // ------------------------------------------------------------ primitivas
  // Conecta un sonido al bus de efectos y, con wet > 0, también al eco.
  out(node, wet = 0) {
    node.connect(this.sfx);
    if (wet) { const w = this.ctx.createGain(); w.gain.value = wet; node.connect(w); w.connect(this.verb); }
  }

  tone(f0, f1, dur, type = 'sine', gain = 0.2, delay = 0, wet = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); this.out(g, wet);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // A tone that grows louder while it sweeps, then cuts off: a charge building up.
  swell(f0, f1, dur, type = 'sawtooth', gain = 0.1, delay = 0, wet = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    o.connect(g); this.out(g, wet);
    o.start(t); o.stop(t + dur + 0.08);
  }

  // A tone rising in pitch and loudness with a tremolo that speeds up from rate0 to rate1 Hz:
  // capacitors charging. depth is the tremolo's share of the gain.
  throb(f0, f1, dur, type, gain, rate0, rate1, depth) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), am = c.createGain(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.06);
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.setValueAtTime(rate0, t); lfo.frequency.exponentialRampToValueAtTime(rate1, t + dur);
    lg.gain.value = depth; am.gain.value = 1 - depth;
    lfo.connect(lg); lg.connect(am.gain);
    o.connect(am); am.connect(g); this.out(g);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
  }

  burst(dur, f0, f1, gain = 0.2, type = 'lowpass', delay = 0, wet = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); this.out(g, wet);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------------- armas
  s_rifle(v) { this.burst(0.07, 3500, 900, 0.16 * v, 'bandpass'); }
  s_zap(v) { this.tone(1500, 380, 0.1, 'sawtooth', 0.07 * v); }
  s_rocket(v) { this.burst(0.45, 1400, 200, 0.22 * v); this.tone(220, 70, 0.3, 'sawtooth', 0.06 * v); }
  s_cannon(v) { this.burst(0.25, 900, 120, 0.35 * v); this.tone(150, 40, 0.25, 'sine', 0.35 * v); }
  s_plasma(v) { this.tone(500, 90, 0.3, 'sine', 0.22 * v); this.burst(0.2, 3000, 300, 0.1 * v, 'bandpass'); }
  s_howitzer(v) { this.burst(0.5, 600, 80, 0.4 * v); this.tone(100, 28, 0.5, 'sine', 0.4 * v); }
  s_laser(v) { this.tone(1100, 160, 0.22, 'square', 0.07 * v); this.tone(2200, 300, 0.12, 'sawtooth', 0.03 * v); }
  s_explosion(v) { this.burst(0.55, 1200, 70, 0.45 * v); this.tone(90, 28, 0.4, 'sine', 0.35 * v); }
  // ---------------------------------------------------------- superarmas
  // Ion cannon, "orbital strike": a low capacitor drone that trembles faster and faster through the
  // 1.5 s targeting delay (superweapon.delay in config.js), then a thunder crack with a deep rumble
  // and a long echo.
  s_ioncharge(v) {
    this.throb(55, 120, 1.5, 'sawtooth', 0.24 * v, 3, 22, 0.7);
    this.throb(110.5, 241, 1.5, 'sawtooth', 0.12 * v, 3, 22, 0.7);
    this.swell(800, 3000, 1.5, 'sine', 0.025 * v, 0, 0.3);
  }
  s_iondischarge(v) {
    this.burst(0.08, 8000, 2000, 0.9 * v, 'highpass');
    this.burst(2.6, 1600, 40, 0.75 * v, 'lowpass', 0.03, 0.6);
    this.tone(48, 18, 2.4, 'sine', 0.7 * v); this.tone(96, 30, 1.2, 'triangle', 0.25 * v);
  }
  s_missilelaunch(v) { this.burst(2.6, 250, 1800, 0.35 * v); this.tone(70, 190, 2.4, 'sawtooth', 0.08 * v); }
  s_bigexplosion(v) { this.burst(1.1, 1000, 50, 0.7 * v); this.tone(70, 20, 0.9, 'sine', 0.5 * v); }

  // ------------------------------------------------------------------- UI
  s_click(v) { this.tone(900, 700, 0.04, 'square', 0.05); }
  s_select(v) { this.tone(520, 880, 0.06, 'triangle', 0.1); }
  s_order(v) { this.tone(400, 300, 0.07, 'triangle', 0.1); }
  s_attack(v) { this.tone(300, 200, 0.09, 'sawtooth', 0.09); }
  s_error(v) { this.tone(160, 120, 0.18, 'square', 0.12); }
  s_ready(v) { this.tone(660, 660, 0.12, 'triangle', 0.14); this.tone(990, 990, 0.2, 'triangle', 0.14, 0.12); }
  s_place(v) { this.tone(110, 50, 0.3, 'sine', 0.4); this.burst(0.18, 600, 100, 0.25); }
  // Contador de créditos subiendo: chasquido metálico seco, sin tono definido, como la caja
  // registradora de C&C; alterna dos brillos para que suene tic-tic.
  s_cashup(v) {
    this.cashTick = !this.cashTick;
    this.burst(0.018, this.cashTick ? 4600 : 4000, 2400, 0.1, 'bandpass');
    this.tone(3300, 2900, 0.018, 'triangle', 0.025);
  }
  s_sell(v) { this.tone(1200, 1200, 0.07, 'square', 0.08); this.tone(1600, 1600, 0.1, 'square', 0.08, 0.08); }
  s_alert(v) { this.tone(880, 880, 0.12, 'square', 0.1); this.tone(660, 660, 0.12, 'square', 0.1, 0.14); }
  s_start(v) { for (let i = 0; i < 4; i++) this.tone(220 * Math.pow(1.5, i), 220 * Math.pow(1.5, i), 0.2, 'triangle', 0.14, i * 0.1); }
  // Promotion: a rising bell arpeggio over a soft shimmer; elite adds a higher, longer final chord.
  s_promote(v) {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, f, 0.32, 'triangle', 0.13, i * 0.07));
    this.tone(3136, 3136, 0.5, 'sine', 0.03, 0.21);
  }
  s_elite(v) {
    [659, 784, 988, 1319, 1568].forEach((f, i) => this.tone(f, f, 0.3, 'triangle', 0.13, i * 0.07));
    for (const f of [1319, 1568, 1976]) this.tone(f, f * 1.005, 0.9, 'triangle', 0.08, 0.38);
    this.tone(3951, 3951, 0.8, 'sine', 0.03, 0.38);
  }
  s_win(v) { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.35, 'triangle', 0.2, i * 0.16)); }
  s_lose(v) { [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.98, 0.45, 'sawtooth', 0.12, i * 0.24)); }

  // ----------------------------------------------------------------- voz
  say(text, minGap = 4000) {
    if (this.muted || !window.speechSynthesis || !this.volumes.voice) return;
    const now = performance.now();
    if (now - this.lastVoice < minGap) return;
    this.lastVoice = now;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = TEAMS[this.game.player]?.voice ?? TEAMS.human.voice;   // las máquinas, más graves y lentas
      u.lang = 'es-ES'; u.rate = v.rate; u.pitch = v.pitch; u.volume = 0.9 * this.volumes.voice * this.volumes.master;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* sin voz */ }
  }
}
