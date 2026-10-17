// Pistas de la banda sonora. Cada una: play(m, t, compás, paso 0–15, segundos por paso) sobre un
// Synth. `sections` solo sirve al laboratorio (tools/music-lab.html); `loops` = vueltas por turno
// en la cola de ambiente; `entry` = compás por el que entra la pista de combate.
import { hz, midi, ch, melody, hit, starts, span } from './synth.js';

// ---------------------------------------------------------------------------- la de siempre
// Voces del motor original, tal cual, para que la pista ambiental de siempre suene igual: su
// propio eco de 0,34 s y un `level` que la iguala en sonoridad con las nuevas.
class Classic {
  constructor(m) {
    this.m = m; const ctx = m.ctx;
    this.level = 3.4;
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 0.34;
    const fb = m.gain(0.32), tone = m.filter('lowpass', 2200, 1);
    this.send = m.gain(0.28); this.wet = m.gain(this.level);
    this.send.connect(this.delay); this.delay.connect(tone); tone.connect(fb); fb.connect(this.delay);
    tone.connect(this.wet); this.wet.connect(m.master);
  }
  static of(m) { return (m.classic ??= new Classic(m)); }
  get ctx() { return this.m.ctx; }
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
  out(node, send = 0) {
    const l = this.m.gain(this.level); node.connect(l); l.connect(this.m.bus.dry);
    if (send) { const s = this.m.gain(send); node.connect(s); s.connect(this.send); }
  }
  pad(f, t, dur, gain) {
    const g = this.ctx.createGain(), lp = this.m.filter('lowpass', 700, 2);
    lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(1100, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(500, t + dur);
    for (const d of [-9, 9]) this.osc('sawtooth', f, t, dur, d).connect(lp);
    lp.connect(g); this.env(g, t, gain, 1.6, dur, 1.4); this.out(g, 0.4);
  }
  bass(f, t, dur, gain, cutoff) {
    const g = this.ctx.createGain(), lp = this.m.filter('lowpass', cutoff, 6);
    lp.frequency.setValueAtTime(cutoff, t); lp.frequency.exponentialRampToValueAtTime(cutoff * 0.3, t + dur);
    this.osc('sawtooth', f, t, dur).connect(lp); this.osc('square', f / 2, t, dur).connect(lp);
    lp.connect(g); this.env(g, t, gain, 0.005, dur, 0.04); this.out(g);
  }
  pluck(f, t, dur, gain) {
    const g = this.ctx.createGain(), lp = this.m.filter('lowpass', 2400, 3);
    lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(400, t + dur);
    this.osc('square', f, t, dur).connect(lp);
    lp.connect(g); this.env(g, t, gain, 0.004, dur * 0.2, dur * 0.8); this.out(g, 0.7);
  }
  kick(t, gain) {
    const g = this.ctx.createGain(), o = this.osc('sine', 120, t, 0.3);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    o.connect(g); this.env(g, t, gain, 0.003, 0.12, 0.18); this.out(g);
  }
  noiseHit(t, dur, gain, type, f, q, send = 0) {
    const s = this.ctx.createBufferSource(); s.buffer = this.m.noiseBuf; s.loop = true;
    const b = this.m.filter(type, f, q), g = this.ctx.createGain();
    s.connect(b); b.connect(g); this.env(g, t, gain, 0.002, dur * 0.3, dur * 0.7); this.out(g, send);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.1);
  }
  hat(t, gain, dur) { this.noiseHit(t, dur, gain, 'highpass', 7000, 1); }
  clank(t, gain) {
    this.noiseHit(t, 0.25, gain, 'bandpass', 2600, 9, 0.6);
    for (const f of [1870, 2630, 3910]) {
      const g = this.ctx.createGain(); this.osc('square', f, t, 0.3).connect(g);
      this.env(g, t, gain * 0.12, 0.002, 0.05, 0.25); this.out(g, 0.6);
    }
  }
}

const VIGILIA = (() => {
  // re menor: i – VI – VII – v (la mayor al final para tensar la vuelta)
  const C = { D: [62, 65, 69], Bb: [58, 62, 65], C: [60, 64, 67], Am: [57, 60, 64], A: [57, 61, 64] };
  const bars = ['D', 'D', 'Bb', 'Bb', 'C', 'C', 'Am', 'A'];
  const roots = [38, 38, 34, 34, 36, 36, 33, 33];
  return {
    id: 'vigilia', name: 'Vigilia', mode: 'ambient', bpm: 88, key: 'Re menor', bars: 8, loops: 4,
    desc: 'La de siempre: latido de bajo, colchón y arpegio 3 contra 4.',
    sections: [[0, 'Latido'], [4, 'Arpegio']],
    play(m, t, bar, step, s) {
      const c = Classic.of(m), chord = C[bars[bar]], root = roots[bar];
      if (step === 0 && bar % 2 === 0) for (const n of chord) c.pad(hz(n), t, s * 32, 0.022);
      if (step === 0 || step === 3) c.bass(hz(root), t, s * 2.5, 0.11, 260);            // latido
      if (step === 0 || step === 8) c.kick(t, 0.32);
      if (step === 4 || step === 12) c.hat(t, 0.028, 0.05);
      if (step === 10 && bar % 4 === 1) c.hat(t, 0.018, 0.04);
      if (step === 12 && bar % 2 === 1) c.clank(t, 0.05);
      if (bar >= 4 && step % 3 === 0 && step < 15) {                                    // arpegio 3 contra 4
        const n = chord[(step / 3) % 3] + 12 * (step >= 9 ? 1 : 0);
        c.pluck(hz(n), t, s * 1.5, 0.03);
      }
    },
  };
})();

// ---------------------------------------------------------------------------- nuevas
const TORMENTA = (() => {
  const C = {
    Dm: ch('D3 A3 D4 F4'), Eb: ch('Eb3 Bb3 D4 G4'), Dm7: ch('D3 A3 C4 F4'), Cm: ch('C3 G3 Eb4 G4'),
    Bb: ch('Bb2 F3 A3 D4'), Asus: ch('A2 E3 A3 D4'), A: ch('A2 E3 A3 C#4'),
  };
  const prog = ['Dm', 'Dm', 'Eb', 'Eb', 'Dm7', 'Dm7', 'Cm', 'Cm', 'Dm', 'Dm', 'Eb', 'Eb', 'Bb', 'Bb', 'Asus', 'A'];
  const roots = ch('D2 D2 Eb2 Eb2 D2 D2 C2 C2 D2 D2 Eb2 Eb2 Bb1 Bb1 A1 A1');
  const tema = melody([
    'D5 - - - - - - - - - - - Eb5 - D5 -',
    'C5 - - - - - - - A4 - - - - - - -',
    'Bb4 - - - - - - - - - - - C5 - D5 -',
    'Eb5 - - - - - - - G5 - - - F5 - - -',
    'D5 - - - - - - - - - - - . . . .',
    '. . . . A4 - - - D5 - - - F5 - - -',
    'G5 - - - - - - - - - - - Eb5 - - -',
    'F5 - - - Eb5 - - - D5 - - - C5 - - -',
    'D5 - - - - - - - - - - - - - - -',
    '. . . . . . . . A5 - - - G5 - F5 -',
    'G5 - - - - - - - - - - - F5 - Eb5 -',
    'D5 - - - - - - - Bb4 - - - - - - -',
    'D5 - - - - - - - F5 - - - - - - -',
    'A5 - - - - - - - - - - - - - - -',
    'E5 - - - - - - - D5 - - - - - - -',
    'C#5 - - - - - - - - - - - - - - -',
  ]);
  const KICK = ['x.........x.o...', 'x.....x...x.....'];
  const GHOST = ['...o..........o.', '...o.o.......ooo'];
  const HATS = 'x.o.x.oox.o.x.o.';
  const ARP = [0, 1, 2, 1, 0, 2, 1, 2];
  return {
    id: 'tormenta', name: 'Tormenta iónica', mode: 'ambient', bpm: 84, key: 'Re frigio', bars: 32,
    desc: 'Lenta y opresiva: breakbeat a medio tiempo, sub-bajo profundo, colchón oscuro y una campana FM que flota en la reverb. Golpes metálicos lejanos.',
    sections: [[0, 'Intro'], [8, 'Ritmo'], [16, 'Tema'], [24, 'Coro'], [30, 'Respiro']],
    play(m, t, bar, st, s) {
      const k = bar % 16, chord = C[prog[k]], root = roots[k];
      const intro = bar < 8, drums = bar >= 8 && bar < 30;
      if (st === 0 && starts(prog, k)) m.pad(chord, t, span(prog, k) * 16 * s, 0.11, { cut: intro ? 650 : 1000 });
      if (st === 0 && bar >= 24 && starts(prog, k)) m.choir(chord.slice(1), t, span(prog, k) * 16 * s, 0.07);
      if (st === 0) m.sub(hz(root), t, s * (drums ? 9 : 15), 0.3);
      if (drums && st === 10) m.sub(hz(root), t, s * 5, 0.24);
      if (drums) {
        const kv = hit(KICK[bar % 2], st); if (kv) m.kick(t, 0.85 * kv);
        if (st === 8) m.snare(t, 0.42, 0.3);
        if (hit(GHOST[bar % 4 === 3 ? 1 : 0], st)) m.ghost(t, 0.09);
        const h = hit(HATS, st); if (h) m.hat(t, 0.07 * h);
        if (st === 14 && bar % 2 === 1) m.hat(t, 0.05, true, -0.3);
        if (st % 2 === 0) {
          const ph = ((bar - 8) % 8 + st / 16) / 8;
          m.arp(hz(chord[1 + ARP[st / 2] % 3] + 12), t, s * 2, 0.045, 700 + 1800 * Math.sin(Math.PI * ph), st % 4 ? 0.35 : -0.35);
        }
      }
      if (st === 12 && bar % 4 === 2) m.clank(t, 0.05, -0.5);
      if (st === 6 && bar % 8 === 5) m.clank(t, 0.04, 0.5);
      if (intro && st === 0 && bar % 4 === 0) m.bell(hz(midi('A5')), t, 0.05, { dur: 3, pan: 0.4, delay: 0.5 });
      if (bar >= 16) for (const [p, n, len] of tema[bar - 16]) if (p === st) {
        if (bar < 24) m.bell(hz(n), t, 0.13, { dur: Math.max(1.5, len * s * 1.5), pan: -0.15 });
        else { m.lead(hz(n), t, len * s, 0.06, { wave: 'triangle', cut: 2200, verb: 0.5, delay: 0.3 }); m.bell(hz(n), t, 0.05, { dur: 1.2 }); }
      }
      if (st === 0 && (bar === 7 || bar === 31)) m.riser(t, 16 * s, 0.06);
      if (st === 0 && bar === 8) m.impact(t, 0.4);
    },
  };
})();

const CAMPOS = (() => {
  const C = {
    Em: ch('E3 B3 D4 F#4 G4'), C: ch('C3 G3 B3 E4'), Am: ch('A2 E3 G3 C4 E4'),
    Bsus: ch('B2 F#3 A3 E4'), B7: ch('B2 F#3 A3 D#4'),
  };
  const A = {
    Em: ch('E4 G4 B4 D5 F#5'), C: ch('C4 E4 G4 B4 E5'), Am: ch('A3 C4 E4 G4 B4'),
    Bsus: ch('B3 E4 F#4 A4 B4'), B7: ch('B3 D#4 F#4 A4 B4'),
  };
  const prog = ['Em', 'Em', 'C', 'C', 'Am', 'Am', 'Bsus', 'B7'];
  const roots = ch('E2 E2 C2 C2 A1 A1 B1 B1');
  const tema = melody([
    'B4 - - - - - - - E5 - - - D5 - - -',
    'B4 - - - - - - - - - - - A4 - G4 -',
    'G4 - - - - - - - E4 - - - G4 - - -',
    'B4 - - - - - - - - - - - . . . .',
    'A4 - - - - - - - C5 - - - B4 - - -',
    'A4 - - - E4 - - - G4 - - - A4 - - -',
    'F#4 - - - - - - - - - - - - - - -',
    'A4 - - - - - - - B4 - - - D#5 - - -',
    'E5 - - - - - - - G5 - - - F#5 - - -',
    'E5 - - - - - - - - - - - D5 - B4 -',
    'C5 - - - - - - - B4 - - - G4 - - -',
    'E5 - - - - - - - - - - - D5 - E5 -',
    'C5 - - - - - - - B4 - - - A4 - - -',
    'E5 - - - - - - - - - - - D5 - C5 -',
    'B4 - - - - - - - - - - - - - - -',
    '. . . . . . . . F#4 - - - A4 - B4 -',
  ]);
  const KICK = ['x......x.x......', 'x......x..x...x.'];
  const ARP = [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 1, 3, 4, 3, 2, 1];
  return {
    id: 'campos', name: 'Campos de tiberio', mode: 'ambient', bpm: 96, swing: 0.14, key: 'Mi menor', bars: 32,
    desc: 'Exploración: trip-hop con swing y un arpegio resonante cuyo filtro respira cada cuatro compases. Coro sintético y melodía con vibrato.',
    sections: [[0, 'Intro'], [8, 'Ritmo'], [16, 'Tema'], [24, 'Tema 2']],
    play(m, t, bar, st, s) {
      const k = bar % 8, name = prog[k], chord = C[name], root = roots[k];
      const drums = bar >= 8;
      if (st === 0 && starts(prog, k)) m.pad(chord, t, span(prog, k) * 16 * s, 0.1, { cut: 1100 });
      if (st === 0 && drums && starts(prog, k)) m.choir(chord.slice(1), t, span(prog, k) * 16 * s, 0.06);
      if (!drums) { if (st === 0) m.sub(hz(root), t, s * 14, 0.28); }
      else {
        if (st === 0) m.sub(hz(root), t, s * 6, 0.3);
        if (st === 7) m.sub(hz(root), t, s * 2, 0.24);
        if (st === 10) m.sub(hz(root + 12), t, s * 4, 0.2);
        const kv = hit(KICK[bar % 2], st); if (kv) m.kick(t, 0.8 * kv);
        if (st === 4 || st === 12) m.snare(t, 0.38, 0.22);
        if (st === 6 || st === 15) m.ghost(t, 0.08);
        if (st === 14 && bar % 2 === 1) m.hat(t, 0.045, true, -0.3);
      }
      if (bar >= 4) {
        if (st % 2 === 0) m.hat(t, st % 4 ? 0.035 : 0.06);
        m.shaker(t, st % 2 ? 0.02 : 0.03);
      }
      const ph = ((bar * 16 + st) % 64) / 64, open = 0.5 - 0.5 * Math.cos(2 * Math.PI * ph);
      const cut = 500 + (bar < 4 ? 400 : 2600) * open;
      m.arp(hz(A[name][ARP[st]]), t, s, 0.045, cut, st % 2 ? 0.4 : -0.4);
      if (st === 8 && bar % 4 === 2) m.bell(hz(midi('E6')), t, 0.03, { dur: 2.5, pan: 0.6, delay: 0.5 });
      if (bar >= 16) for (const [p, n, len] of tema[bar - 16]) if (p === st) m.lead(hz(n), t, len * s, 0.075, { cut: 2400, verb: 0.4, delay: 0.25 });
      if (st === 0 && (bar === 7 || bar === 15)) m.riser(t, 16 * s, 0.05);
      if (st === 0 && bar === 8) m.impact(t, 0.35);
    },
  };
})();

const FRENTE = (() => {
  const C = { Dm: ch('D3 A3 D4 F4'), Bb: ch('Bb2 F3 Bb3 D4'), C: ch('C3 G3 C4 E4'), Gm: ch('G2 D3 G3 Bb3'), A: ch('A2 E3 A3 C#4') };
  const prog = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A'];
  const roots = ch('D2 D2 Bb1 C2 D2 D2 G1 A1');
  const RIFF = { 0: [0, 2], 3: [0, 2], 6: [12, 1], 8: [0, 2], 10: [7, 1], 11: [12, 1], 14: [7, 2] };
  const tema = melody([
    'D5 - . A4 - . Bb4 - A4 - G4 - F4 - E4 -',
    'F4 - - - - - - - D4 - - - . . . .',
    'D5 - . A4 - . Bb4 - C5 - D5 - F5 - - -',
    'E5 - - - - - - - C5 - - - G4 - - -',
    'D5 - . A4 - . Bb4 - A4 - G4 - F4 - E4 -',
    'F4 - - - G4 - - - A4 - - - D5 - - -',
    'Bb4 - - - - - D5 - G5 - - - F5 - D5 -',
    'C#5 - - - - - - - E5 - - - A5 - - -',
  ]);
  const KICK = ['x.........x..x..', 'x.x.......x.....'];
  const HATS = 'xoxoxoxoxoxoxoxo';
  return {
    id: 'frente', name: 'Frente de máquinas', mode: 'combat', bpm: 140, key: 'Re menor', bars: 32, entry: 4,
    desc: 'Combate industrial: breakbeat rápido, bajo "reese" saturado en semicorcheas, acordes distorsionados y golpes de fábrica. Riff en menor armónica.',
    sections: [[0, 'Arranque'], [4, 'Batería'], [8, 'Acordes'], [16, 'Riff'], [24, 'Riff ×2']],
    play(m, t, bar, st, s) {
      const k = bar % 8, chord = C[prog[k]], root = roots[k];
      const r = RIFF[st];
      if (r) { m.sub(hz(root + (r[0] === 12 ? 12 : 0)), t, r[1] * s * 0.9, 0.24); m.reese(hz(root + 12 + r[0]), t, r[1] * s * 0.9, 0.1, bar < 4 ? 600 : 1100); }
      const h = hit(HATS, st); if (h) m.hat(t, 0.06 * h);
      if (st === 6 && bar % 2 === 1) m.clank(t, 0.06, 0.4);
      if (st === 13 && bar % 4 === 0) m.clank(t, 0.04, -0.5);
      if (bar >= 4) {
        const kv = hit(KICK[bar % 2], st); if (kv) m.kick(t, 0.9 * kv);
        if (st === 4 || st === 12) m.snare(t, 0.45);
        if (st === 7 || st === 9 || st === 15) m.ghost(t, 0.09);
        if (bar % 8 === 7 && st >= 12) m.tom(t, [196, 165, 131, 110][st - 12], 0.35, (st - 13.5) * 0.3);
      }
      if (bar >= 8) {
        if (st === 0 && starts(prog, k)) m.pad(chord, t, span(prog, k) * 16 * s, 0.07, { cut: 1300, verb: 0.4 });
        if (bar % 2 === 0 && (st === 0 || st === 3 || st === 6)) m.stab(chord.slice(1).map((n) => n + 12), t, s * 1.2, 0.05);
      }
      if (bar >= 16) for (const [p, n, len] of tema[(bar - 16) % 8]) if (p === st) {
        m.lead(hz(n), t, len * s * 0.95, 0.065, { cut: 3000, verb: 0.3, delay: 0.2 });
        if (bar >= 24) m.lead(hz(n - 12), t, len * s * 0.95, 0.045, { cut: 1800, pan: -0.3, verb: 0.2, delay: 0 });
      }
      if (st === 0 && (bar === 3 || bar === 15 || bar === 31)) m.riser(t, 16 * s, 0.06);
      if (st === 0 && (bar === 4 || bar === 16)) m.impact(t, 0.45);
    },
  };
})();


export const TRACKS = [VIGILIA, TORMENTA, CAMPOS, FRENTE];
// Ambiente: cola que rota entre pistas. Combate: la que suena al entrar en batalla.
export const PLAYLIST = { ambient: [VIGILIA, TORMENTA, CAMPOS], combat: [FRENTE] };
