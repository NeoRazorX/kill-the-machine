// Laboratorio de música: reproduce y renderiza las pistas del juego (src/music-tracks.js) una a
// una, fuera de la partida, para escucharlas y ajustarlas.
import { Synth } from '../src/synth.js';
export { Synth };
export { TRACKS, PLAYLIST } from '../src/music-tracks.js';

export class Player {
  constructor(synth) { this.m = synth; this.track = null; this.timer = null; this.marks = []; this.bus = null; }

  play(track) {
    this.stop();
    const m = this.m;
    m.setTempo(track.bpm);
    this.bus = m.makeBus(); this.track = track; this.step = 0; this.marks = [];
    this.next = m.ctx.currentTime + 0.12;
    this.tick();
    this.timer = setInterval(() => this.tick(), 25);
  }

  tick() {
    const m = this.m, tr = this.track, s = 60 / tr.bpm / 4, horizon = m.ctx.currentTime + 0.2;
    m.bus = this.bus;
    while (this.next < horizon) {
      const bar = Math.floor(this.step / 16) % tr.bars, st = this.step % 16;
      if (st === 0) this.marks.push([this.next, bar]);
      tr.play(m, this.next + (st % 2 ? (tr.swing || 0) * s : 0), bar, st, s);
      this.step++; this.next += s;
    }
    if (this.marks.length > 16) this.marks.splice(0, 8);
  }

  // compás actual con fracción, según lo que de verdad está sonando
  position() {
    if (!this.track) return null;
    const now = this.m.ctx.currentTime, barLen = (60 / this.track.bpm) * 4;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const [t, bar] = this.marks[i];
      if (t <= now) return bar + Math.min(1, (now - t) / barLen);
    }
    return 0;
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer); this.timer = null;
    const b = this.bus;
    this.m.fadeBus(b, 0, 0.4);
    setTimeout(() => { b.dry.disconnect(); b.verb.disconnect(); b.delay.disconnect(); }, 4000);
    this.track = null;
  }
}

// Render sin tiempo real de una vuelta completa, para descargar o medir niveles. Programa compás
// a compás con suspend(): miles de nodos pendientes a la vez hacen el render varias veces más lento.
export async function render(track, { sampleRate = 44100, tail = 4 } = {}) {
  const s = 60 / track.bpm / 4, steps = track.bars * 16, barLen = 16 * s;
  const ctx = new OfflineAudioContext(2, Math.ceil((steps * s + tail) * sampleRate), sampleRate);
  const m = new Synth(ctx, ctx.destination);
  m.setTempo(track.bpm); m.bus = m.makeBus();
  let i = 0;
  const upTo = (time) => {
    for (; i < steps && 0.05 + i * s < time; i++) {
      const st = i % 16;
      track.play(m, 0.05 + i * s + (st % 2 ? (track.swing || 0) * s : 0), Math.floor(i / 16), st, s);
    }
  };
  upTo(barLen * 2);
  for (let b = 1; b < track.bars; b++) ctx.suspend(b * barLen).then(() => { upTo((b + 2) * barLen); ctx.resume(); });
  return ctx.startRendering();
}

export function toWav(buf) {
  const n = buf.length, chs = buf.numberOfChannels, bytes = 44 + n * chs * 2, view = new DataView(new ArrayBuffer(bytes));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, chs, true);
  view.setUint32(24, buf.sampleRate, true); view.setUint32(28, buf.sampleRate * chs * 2, true);
  view.setUint16(32, chs * 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, n * chs * 2, true);
  const data = [...Array(chs)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < chs; c++) {
    const v = Math.max(-1, Math.min(1, data[c][i])); view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

// pico y RMS en dBFS
export function levels(buf) {
  let peak = 0, sum = 0, n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const v = d[i]; if (!Number.isFinite(v)) return { peak: NaN, rms: NaN }; peak = Math.max(peak, Math.abs(v)); sum += v * v; n++; }
  }
  const db = (x) => 20 * Math.log10(x || 1e-9);
  return { peak: db(peak), rms: db(Math.sqrt(sum / n)) };
}
