// Sintetizador WebAudio de la música: reverb de convolución, eco ping-pong a tempo, breakbeats,
// graves, colchones, coros y voces melódicas. Cada pista escribe en su propio bus (seco + envíos)
// para poder fundirla sin cortar las colas de las demás. Todo sintetizado, sin archivos de audio.

export const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midi(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`nota no válida: ${name}`);
  return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
export const ch = (s) => s.trim().split(/\s+/).map(midi);

// Melodía en rejilla de semicorcheas: 16 fichas por compás; nota, '-' prolonga, '.' silencio.
// Devuelve, por compás, [paso, midi, duración en pasos].
export function melody(bars) {
  const out = bars.map(() => []);
  let cur = null;
  bars.forEach((b, bi) => {
    const toks = b.trim().split(/\s+/);
    if (toks.length !== 16) throw new Error(`compás ${bi} con ${toks.length} pasos: "${b}"`);
    toks.forEach((k, i) => {
      if (k === '-') { if (cur) cur[2]++; return; }
      cur = null;
      if (k !== '.') { cur = [i, midi(k), 1]; out[bi].push(cur); }
    });
  });
  return out;
}

const V = { '.': 0, o: 0.3, x: 0.75, X: 1 };
export const hit = (p, st) => V[p[st]];
// el acorde empieza en este compás / cuántos compases dura
export const starts = (prog, k) => k === 0 || prog[k] !== prog[k - 1];
export const span = (prog, k) => { let n = 1; while (k + n < prog.length && prog[k + n] === prog[k]) n++; return n; };

export class Synth {
  constructor(ctx, destination) {
    this.ctx = ctx;
    const sr = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, sr * 2, sr);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.curves = {};

    this.master = this.gain(0.5);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1;
    this.master.connect(comp); comp.connect(lim); lim.connect(destination);
    this.output = lim;

    // reverb de sala grande, con cola que se oscurece
    this.verbIn = this.gain(1);
    const hp = this.filter('highpass', 180, 0.7), conv = ctx.createConvolver(), vOut = this.gain(0.7);
    conv.buffer = this.impulse(3.4);
    this.verbIn.connect(hp); hp.connect(conv); conv.connect(vOut); vOut.connect(this.master);

    // eco ping-pong sincronizado al tempo
    this.delayIn = this.gain(1);
    this.dl = ctx.createDelay(2); this.dr = ctx.createDelay(2);
    const tone = this.filter('lowpass', 2800, 0.7), fbl = this.gain(0.38), fbr = this.gain(0.38), wet = this.gain(0.8);
    const pl = ctx.createStereoPanner(), pr = ctx.createStereoPanner(); pl.pan.value = -0.65; pr.pan.value = 0.65;
    this.delayIn.connect(tone); tone.connect(this.dl);
    this.dl.connect(pl); pl.connect(wet); this.dl.connect(fbl); fbl.connect(this.dr);
    this.dr.connect(pr); pr.connect(wet); this.dr.connect(fbr); fbr.connect(tone);
    const toVerb = this.gain(0.3);
    wet.connect(this.master); wet.connect(toVerb); toVerb.connect(this.verbIn);
    this.setTempo(120);
  }

  setTempo(bpm) { const t = (60 / bpm) * 0.75; this.dl.delayTime.value = t; this.dr.delayTime.value = t; }

  impulse(sec) {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * sec), buf = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let y = 0;
      for (let i = 0; i < len; i++) {
        const x = i / len, a = 0.9 - 0.75 * x;
        y += a * ((Math.random() * 2 - 1) - y);
        d[i] = y * Math.pow(1 - x, 2.2) * Math.min(1, i / (sr * 0.012));
      }
    }
    return buf;
  }

  // Cada pista escribe en su propio bus (seco + envíos) para poder fundirla sin cortar colas ajenas.
  makeBus() {
    const b = { dry: this.gain(1), verb: this.gain(1), delay: this.gain(1) };
    b.dry.connect(this.master); b.verb.connect(this.verbIn); b.delay.connect(this.delayIn);
    return b;
  }
  fadeBus(b, to, time) {
    const now = this.ctx.currentTime;
    for (const g of [b.dry, b.verb, b.delay]) {
      g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(to, now + time);
    }
  }

  // ---------------------------------------------------------------------------------- piezas
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  filter(type, f, q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  panner(p) { const n = this.ctx.createStereoPanner(); n.pan.value = p; return n; }
  osc(type, f, t, end, detune = 0) {
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f, t); if (detune) o.detune.setValueAtTime(detune, t);
    o.start(t); o.stop(end); return o;
  }
  shaper(k) {
    if (!this.curves[k]) {
      const c = new Float32Array(1024);
      for (let i = 0; i < c.length; i++) { const x = (i / (c.length - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
      this.curves[k] = c;
    }
    const s = this.ctx.createWaveShaper(); s.curve = this.curves[k]; s.oversample = '2x'; return s;
  }
  // ataque lineal, sostiene hasta t+hold y cae exponencialmente en r segundos; devuelve el final
  env(g, t, peak, a, hold, r) {
    const h = Math.max(a, hold), p = g.gain;
    p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(peak, t + a);
    p.setValueAtTime(peak, t + h); p.exponentialRampToValueAtTime(0.0001, t + h + r);
    return t + h + r;
  }
  out(node, { pan = 0, verb = 0, delay = 0 } = {}) {
    const b = this.bus;
    if (pan) { const p = this.panner(pan); node.connect(p); p.connect(b.dry); } else node.connect(b.dry);
    if (verb) { const g = this.gain(verb); node.connect(g); g.connect(b.verb); }
    if (delay) { const g = this.gain(delay); node.connect(g); g.connect(b.delay); }
  }
  noise(t, dur, v, type, f, q = 1, opts = {}) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const b = this.filter(type, f, q), g = this.gain(0);
    src.connect(b); b.connect(g);
    const end = this.env(g, t, v, opts.attack ?? 0.001, dur * 0.25, dur * 0.75);
    src.start(t, Math.random() * 1.5); src.stop(end + 0.05);
    this.out(g, opts);
    return b;
  }

  // ---------------------------------------------------------------------------------- batería
  kick(t, v) {
    const o = this.osc('sine', 150, t, t + 0.6), g = this.gain(0);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.07); o.frequency.exponentialRampToValueAtTime(40, t + 0.45);
    o.connect(g); this.env(g, t, v, 0.002, 0.1, 0.38); this.out(g);
    this.noise(t, 0.02, v * 0.25, 'highpass', 3000);
  }
  snare(t, v, verb = 0.18) {
    this.noise(t, 0.22, v, 'bandpass', 1900, 0.7, { verb });
    this.noise(t, 0.09, v * 0.45, 'highpass', 6000, 0.7);
    const o = this.osc('triangle', 230, t, t + 0.2), g = this.gain(0);
    o.frequency.exponentialRampToValueAtTime(165, t + 0.06);
    o.connect(g); this.env(g, t, v * 0.8, 0.001, 0.03, 0.09); this.out(g);
  }
  ghost(t, v) { this.noise(t, 0.08, v, 'bandpass', 2200, 0.8, { pan: 0.1 }); }
  hat(t, v, open = false, pan = 0.25) { this.noise(t, open ? 0.32 : 0.05, v, 'highpass', 7800, 0.8, { pan, verb: open ? 0.15 : 0 }); }
  shaker(t, v, pan = -0.3) { this.noise(t, 0.07, v, 'bandpass', 5500, 1.5, { pan, attack: 0.012 }); }
  tom(t, f, v, pan = 0) {
    const o = this.osc('sine', f * 1.7, t, t + 0.8), g = this.gain(0);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    o.connect(g); this.env(g, t, v, 0.002, 0.05, 0.45); this.out(g, { pan, verb: 0.35 });
    this.noise(t, 0.08, v * 0.25, 'lowpass', 900, 0.7, { pan });
  }
  // golpe metálico inarmónico, de fábrica
  clank(t, v, pan = 0) {
    this.noise(t, 0.3, v, 'bandpass', 2600, 9, { pan, verb: 0.6, delay: 0.2 });
    for (const f of [1870, 2630, 3910, 5270]) {
      const g = this.gain(0); this.osc('square', f, t, t + 0.5).connect(g);
      this.env(g, t, v * 0.1, 0.002, 0.04, 0.35); this.out(g, { pan, verb: 0.6, delay: 0.2 });
    }
  }
  riser(t, dur, v) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = this.filter('bandpass', 300, 3), g = this.gain(0);
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(6000, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    src.connect(bp); bp.connect(g); src.start(t); src.stop(t + dur + 0.1);
    this.out(g, { verb: 0.5 });
  }
  impact(t, v) {
    const o = this.osc('sine', 95, t, t + 2), g = this.gain(0);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
    o.connect(g); this.env(g, t, v, 0.003, 0.1, 1.6); this.out(g, { verb: 0.7 });
    this.noise(t, 1.4, v * 0.5, 'lowpass', 700, 0.7, { verb: 0.8 });
  }

  // ---------------------------------------------------------------------------------- graves
  sub(f, t, dur, v) {
    const g = this.gain(0), end = t + dur + 0.2;
    this.osc('sine', f, t, end).connect(g);
    const g2 = this.gain(0.18); this.osc('triangle', f * 2, t, end).connect(g2); g2.connect(g);
    this.env(g, t, v, 0.008, dur, 0.08); this.out(g);
  }
  // dos sierras desafinadas saturadas; `wob` hace oscilar el filtro
  reese(f, t, dur, v, cut = 900, wob = 0) {
    const lp = this.filter('lowpass', cut, 4), pre = this.gain(0.5), sh = this.shaper(2.5), g = this.gain(0), end = t + dur + 0.2;
    for (const d of [-16, 16]) this.osc('sawtooth', f, t, end, d).connect(lp);
    lp.frequency.setValueAtTime(cut * 1.8, t); lp.frequency.exponentialRampToValueAtTime(cut, t + 0.08);
    if (wob) { const l = this.osc('sine', wob, t, end), lg = this.gain(cut * 0.6); l.connect(lg); lg.connect(lp.frequency); }
    lp.connect(pre); pre.connect(sh); sh.connect(g); this.env(g, t, v, 0.004, dur, 0.06); this.out(g, { verb: 0.05 });
  }

  // ---------------------------------------------------------------------------------- colchones
  pad(notes, t, dur, v, { cut = 900, verb = 0.55, att = 1.4 } = {}) {
    const lp = this.filter('lowpass', cut, 1.2), g = this.gain(0), end = t + dur + 2;
    lp.frequency.setValueAtTime(cut * 0.55, t); lp.frequency.linearRampToValueAtTime(cut, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(cut * 0.6, t + dur);
    notes.forEach((n, i) => {
      const p = this.panner((i % 2 ? 0.5 : -0.5) * (0.4 + 0.6 * i / notes.length));
      for (const d of [-11, 7]) this.osc('sawtooth', hz(n), t, end, d).connect(p);
      p.connect(lp);
    });
    lp.connect(g); this.env(g, t, v / Math.sqrt(notes.length), Math.min(att, dur * 0.4), dur, 1.6); this.out(g, { verb });
  }
  // sierras pasadas por formantes de "aah", con vibrato
  choir(notes, t, dur, v, { verb = 0.8 } = {}) {
    const sum = this.gain(1), mix = this.gain(1), g = this.gain(0), end = t + dur + 2.5;
    const lfo = this.osc('sine', 5.1, t, end), lg = this.gain(9); lfo.connect(lg);
    notes.forEach((n, i) => {
      const p = this.panner(i % 2 ? 0.6 : -0.6);
      for (const d of [-8, 8]) { const o = this.osc('sawtooth', hz(n), t, end, d); lg.connect(o.detune); o.connect(p); }
      p.connect(sum);
    });
    for (const [f, q, a] of [[650, 6, 1], [1080, 7, 0.55], [2650, 9, 0.22]]) {
      const b = this.filter('bandpass', f, q), ga = this.gain(a); sum.connect(b); b.connect(ga); ga.connect(mix);
    }
    mix.connect(g); this.env(g, t, (v / Math.sqrt(notes.length)) * 2.5, Math.min(1.2, dur * 0.4), dur, 2); this.out(g, { verb });
  }

  // ---------------------------------------------------------------------------------- melódicos
  arp(f, t, dur, v, cut = 1500, pan = 0) {
    const lp = this.filter('lowpass', cut, 8), g = this.gain(0), end = t + dur * 2 + 0.2;
    this.osc('sawtooth', f, t, end).connect(lp); this.osc('square', f, t, end, -6).connect(lp);
    lp.frequency.setValueAtTime(cut * 2.2, t); lp.frequency.exponentialRampToValueAtTime(cut * 0.5, t + dur * 1.5);
    lp.connect(g); this.env(g, t, v, 0.003, dur * 0.3, dur * 1.2); this.out(g, { pan, verb: 0.25, delay: 0.3 });
  }
  pluck(f, t, dur, v, pan = 0) {
    const lp = this.filter('lowpass', 3000, 3), g = this.gain(0);
    lp.frequency.setValueAtTime(3500, t); lp.frequency.exponentialRampToValueAtTime(450, t + dur);
    this.osc('square', f, t, t + dur + 0.3).connect(lp);
    lp.connect(g); this.env(g, t, v, 0.003, dur * 0.2, dur * 0.8); this.out(g, { pan, verb: 0.4, delay: 0.45 });
  }
  // campana FM: el modulador se apaga y deja una sinusoide limpia
  bell(f, t, v, { dur = 2.5, pan = 0, verb = 0.6, delay = 0.3 } = {}) {
    const end = t + dur + 0.1, c = this.osc('sine', f, t, end), m = this.osc('sine', f * 3.5, t, end), mg = this.gain(0);
    mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.6);
    m.connect(mg); mg.connect(c.frequency);
    const g = this.gain(0); c.connect(g);
    const hg = this.gain(0.2); this.osc('sine', f * 2.01, t, end).connect(hg); hg.connect(g);
    this.env(g, t, v, 0.002, 0.02, dur); this.out(g, { pan, verb, delay });
  }
  lead(f, t, dur, v, { cut = 2600, verb = 0.35, delay = 0.22, pan = 0, wave = 'sawtooth' } = {}) {
    const end = t + dur + 0.4, lp = this.filter('lowpass', cut, 1.5), g = this.gain(0);
    const vib = this.osc('sine', 5.4, t, end), vg = this.gain(0); vib.connect(vg);
    vg.gain.setValueAtTime(0, t + 0.2); vg.gain.linearRampToValueAtTime(14, t + 0.6);
    for (const [type, d] of [[wave, -5], ['square', 5]]) {
      const o = this.osc(type, f * 0.985, t, end, d);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.05); vg.connect(o.detune); o.connect(lp);
    }
    lp.frequency.setValueAtTime(cut * 0.5, t); lp.frequency.exponentialRampToValueAtTime(cut, t + 0.05);
    lp.connect(g); this.env(g, t, v, 0.015, dur, 0.18); this.out(g, { pan, verb, delay });
  }
  // metales sintéticos: el filtro se abre de golpe y se asienta
  brass(notes, t, dur, v, { cut = 2200, verb = 0.4 } = {}) {
    notes = [].concat(notes);
    const lp = this.filter('lowpass', 300, 1.4), g = this.gain(0), end = t + dur + 0.5;
    notes.forEach((n, i) => {
      const p = this.panner(notes.length > 1 ? (i / (notes.length - 1) - 0.5) * 0.8 : 0);
      for (const d of [-12, 0, 12]) this.osc('sawtooth', hz(n), t, end, d).connect(p);
      p.connect(lp);
    });
    lp.frequency.setValueAtTime(280, t); lp.frequency.linearRampToValueAtTime(cut, t + 0.09);
    lp.frequency.exponentialRampToValueAtTime(cut * 0.55, t + Math.max(0.2, dur));
    lp.connect(g); this.env(g, t, v / Math.sqrt(notes.length), 0.04, dur, 0.25); this.out(g, { verb });
  }
  // acorde distorsionado y corto
  stab(notes, t, dur, v) {
    const pre = this.gain(0.35), sh = this.shaper(3), lp = this.filter('lowpass', 3200, 3), g = this.gain(0), end = t + dur + 0.2;
    for (const n of notes) for (const d of [-14, 14]) this.osc('sawtooth', hz(n), t, end, d).connect(pre);
    pre.connect(sh); sh.connect(lp);
    lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(500, t + dur);
    lp.connect(g); this.env(g, t, v, 0.003, dur, 0.07); this.out(g, { verb: 0.2, delay: 0.15 });
  }
}
