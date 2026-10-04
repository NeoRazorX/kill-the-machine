// Sonido 100% sintetizado con WebAudio + voz de la "computadora de mando" (speechSynthesis).

const MIN_GAP = { rifle: 45, zap: 45, rocket: 90, cannon: 90, plasma: 90, howitzer: 150, laser: 90, explosion: 60, bigexplosion: 150 };

export class GameAudio {
  constructor(game) {
    this.game = game;
    this.ctx = null; this.master = null; this.noise = null;
    this.muted = false; this.last = {};
    this.lastVoice = 0; this.voiceQueue = [];
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.5;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp); comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { this.ctx = null; }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
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
  tone(f0, f1, dur, type = 'sine', gain = 0.2, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  burst(dur, f0, f1, gain = 0.2, type = 'lowpass', delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
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
  s_bigexplosion(v) { this.burst(1.1, 1000, 50, 0.7 * v); this.tone(70, 20, 0.9, 'sine', 0.5 * v); }

  // ------------------------------------------------------------------- UI
  s_click(v) { this.tone(900, 700, 0.04, 'square', 0.05); }
  s_select(v) { this.tone(520, 880, 0.06, 'triangle', 0.1); }
  s_order(v) { this.tone(400, 300, 0.07, 'triangle', 0.1); }
  s_attack(v) { this.tone(300, 200, 0.09, 'sawtooth', 0.09); }
  s_error(v) { this.tone(160, 120, 0.18, 'square', 0.12); }
  s_ready(v) { this.tone(660, 660, 0.12, 'triangle', 0.14); this.tone(990, 990, 0.2, 'triangle', 0.14, 0.12); }
  s_place(v) { this.tone(110, 50, 0.3, 'sine', 0.4); this.burst(0.18, 600, 100, 0.25); }
  s_sell(v) { this.tone(1200, 1200, 0.07, 'square', 0.08); this.tone(1600, 1600, 0.1, 'square', 0.08, 0.08); }
  s_alert(v) { this.tone(880, 880, 0.12, 'square', 0.1); this.tone(660, 660, 0.12, 'square', 0.1, 0.14); }
  s_start(v) { for (let i = 0; i < 4; i++) this.tone(220 * Math.pow(1.5, i), 220 * Math.pow(1.5, i), 0.2, 'triangle', 0.14, i * 0.1); }
  s_win(v) { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.35, 'triangle', 0.2, i * 0.16)); }
  s_lose(v) { [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.98, 0.45, 'sawtooth', 0.12, i * 0.24)); }

  // ----------------------------------------------------------------- voz
  say(text, minGap = 4000) {
    if (this.muted || !window.speechSynthesis) return;
    const now = performance.now();
    if (now - this.lastVoice < minGap) return;
    this.lastVoice = now;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-ES'; u.rate = 1.1; u.pitch = 0.8; u.volume = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* sin voz */ }
  }
}
