// Combat detection, hysteresis, ambient queue and crossfade of the procedural music, with a fake AudioContext.
const { MUSIC, combatScore, CombatMonitor, Music } = await import('../src/music.js');
const { PLAYLIST, TRACKS } = await import('../src/music-tracks.js');
const assert = (ok, text) => { if (!ok) throw new Error(text); console.log(`PASS ${text}`); };

// ---------------------------------------------------------------- detection
function world({ spectate = false, visible = () => false } = {}) {
  return { player: 'human', spectate, time: 100, units: [], buildings: [], isVisibleEntity: visible };
}
const ent = (team, extra = {}) => ({ team, dead: false, ...extra });
{
  const g = world();
  g.units.push(ent('human', { lastHit: 99 }), ent('human', { lastFired: 98 }), ent('human', { lastHit: 90 }), ent('human'));
  g.buildings.push(ent('human', { lastHit: 99.5 }), ent(null, { lastHit: 99.9 }), ent('human', { lastHit: 99.9, dead: true }));
  assert(combatScore(g) === 3, 'own entities hit or firing recently count; old, idle, dead and ownerless ones do not');
}
{
  const g = world();
  g.units.push(ent('machine', { lastHit: 99.8 }), ent('machine', { lastFired: 99.8, seen: true }));
  assert(combatScore(g) === 0, 'enemy combat under the fog is not heard');
  g.isVisibleEntity = (e) => !!e.seen;
  assert(combatScore(g) === 1, 'enemy combat in view counts');
  g.spectate = true; g.isVisibleEntity = () => false;
  assert(combatScore(g) === 2, 'in spectator mode every fight counts');
}

// --------------------------------------------------------------- hysteresis
function run(m, seconds, score, step = MUSIC.check) {
  const changes = [];
  for (let t = 0; t < seconds - 1e-9; t += step) if (m.update(step, typeof score === 'function' ? score(t) : score)) changes.push(m.combat);
  return changes;
}
{
  const m = new CombatMonitor();
  assert(run(m, 60, 1).length === 0 && !m.combat, 'a single skirmisher below the threshold keeps the calm track');
  assert(run(m, 0.5, MUSIC.enter).length === 0, 'a brief burst does not switch at once');
  assert(run(m, MUSIC.enterHold, MUSIC.enter).join() === 'true' && m.combat, 'sustained combat switches to the combat track');
  const m2 = new CombatMonitor();
  assert(run(m2, 0.5, MUSIC.enter * 2).join() === 'true', 'a big fight switches immediately');
}
{
  const m = new CombatMonitor(); run(m, 2, 5);
  // Fighting that comes and goes with gaps shorter than the calm period must not flicker.
  const flicker = run(m, 60, (t) => (Math.floor(t / 4) % 2 ? 0 : 3));
  assert(flicker.length === 0 && m.combat, 'intermittent fighting holds the combat track without flicker');
  assert(run(m, MUSIC.calm - 1, 0).length === 0 && m.combat, 'the combat track holds until the calm period passes');
  assert(run(m, 1.5, 0).join() === 'false' && !m.combat, 'it returns to the calm track after the calm period');
  assert(run(m, 0.5, 1).length === 0 && !m.combat, 'leftover sporadic fire does not bring the combat track back');
}

// ---------------------------------------------------------------- tracks
const turnSec = (sc) => (sc.loops || 1) * sc.bars * 16 * 60 / sc.bpm / 4;
assert(PLAYLIST.ambient.length >= 3 && PLAYLIST.ambient.every(sc => sc.mode === 'ambient') && PLAYLIST.combat.every(sc => sc.mode === 'combat'),
  'the ambient queue holds several calm tracks and the combat list only combat tracks');
assert(PLAYLIST.ambient.every(sc => turnSec(sc) > 60 && turnSec(sc) < 120), 'each ambient track holds the floor for one to two minutes');
assert(TRACKS.every(sc => sc.sections.every(([from]) => from < sc.bars) && (sc.entry || 0) < sc.bars), 'sections and entry bars fall inside each track');

// ---------------------------------------------------------------- playback
class Param {
  constructor(v = 0) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); this.target = v; return this; }
  exponentialRampToValueAtTime(v, t) { this.events.push(['exp', v, t]); return this; }
  cancelScheduledValues() { this.events.length = 0; return this; }
}
const PARAMS = ['gain', 'frequency', 'detune', 'Q', 'delayTime', 'pan', 'threshold', 'knee', 'ratio', 'attack', 'release'];
class Node {
  constructor(ctx) { this.ctx = ctx; for (const p of PARAMS) this[p] = new Param(p === 'gain' ? 1 : 0); }
  connect(n) { return n; } disconnect() {}
  start(t) { this.ctx.started.push(t); } stop() {}
}
function fakeCtx() {
  const ctx = { currentTime: 0, sampleRate: 8000, started: [] };
  for (const k of ['createGain', 'createOscillator', 'createBiquadFilter', 'createDelay', 'createBufferSource', 'createStereoPanner',
    'createConvolver', 'createDynamicsCompressor', 'createWaveShaper']) ctx[k] = () => new Node(ctx);
  ctx.createBuffer = (chs, len) => { const d = [...Array(chs)].map(() => new Float32Array(len)); return { getChannelData: (c) => d[c] }; };
  return ctx;
}
const lastRamp = (track) => track.bus.dry.gain.events.filter(e => e[0] === 'ramp').pop();
const near = (a, b) => Math.abs(a - b) < 1e-6;
{
  const ctx = fakeCtx(), music = new Music(ctx, new Node(ctx));
  assert(music.bus.gain.value === MUSIC.level && MUSIC.level < 0.5, 'the music bus sits below the effects level');
  music.start(); music.tick();
  const calm = music.current;
  assert(PLAYLIST.ambient.includes(calm.score) && calm.on, 'the mission starts on a track from the ambient queue');
  assert(ctx.started.length > 0, 'notes are scheduled ahead of time');
  ctx.started.length = 0;
  for (let t = 2; t < 5 - 1e-9; t += 0.05) { ctx.currentTime = t; music.tick(); }
  assert(ctx.started.length > 0 && ctx.started.every(t => t >= 2), 'the scheduler keeps going without frames');
  ctx.currentTime = 5;

  // Fight around the player's units: the music fades to the combat track.
  const g = world(); g.units.push(ent('human', { lastHit: 100 }), ent('human', { lastFired: 100 }), ent('human', { lastHit: 100 }), ent('human', { lastHit: 100 }));
  music.updateCombat(MUSIC.check, g);
  const fight = music.current;
  assert(music.combat && music.mode === 'combat' && PLAYLIST.combat.includes(fight.score), 'combat around the player switches the music');
  assert(fight.step === (fight.score.entry || 0) * 16, 'the combat track comes in at its entry bar, past the intro');
  const up = lastRamp(fight), down = lastRamp(calm);
  assert(up[1] === 1 && near(up[2], 5.05 + MUSIC.fadeIn) && down[1] === 0 && near(down[2], 5 + MUSIC.fadeOut) && !calm.on,
    'the switch is a crossfade: the combat track fades in while the calm one fades out');
  const advance = (t) => { const c = calm.step, f = fight.step; ctx.currentTime = t; music.tick(); return [calm.step > c, fight.step > f]; };
  assert(advance(6).join() === 'true,true', 'both tracks play during the fade');
  advance(20);
  assert(advance(20.3).join() === 'false,true', 'only the combat track plays once the fade is over');
  ctx.currentTime = 30; music.tick();
  assert(!music.playing.includes(calm) && music.playing.length === 1, 'the faded calm track is released afterwards');

  // Calm: no combat for the calm period, measured in game time. Back to the next track of the queue.
  g.time = 200;
  for (let t = 0; t < MUSIC.calm + MUSIC.check; t += MUSIC.check / 2) music.updateCombat(MUSIC.check / 2, g);
  const q = PLAYLIST.ambient, back = music.current;
  assert(!music.combat && music.mode === 'ambient' && back.score === q[(q.indexOf(calm.score) + 1) % q.length] && lastRamp(fight)[1] === 0,
    'after the fight the music fades back to the next track of the ambient queue');

  music.muted = true; ctx.currentTime = 50; ctx.started.length = 0; music.tick();
  assert(ctx.started.length === 0, 'muted music schedules no notes');
  music.muted = false;
  for (let t = 51; t < 55; t += 0.05) { ctx.currentTime = t; music.tick(); }
  assert(ctx.started.length > 0, 'unmuting resumes the music');
}
{
  // Left alone, the ambient tracks take turns, each one starting right where the previous ended.
  const ctx = fakeCtx(), music = new Music(ctx, new Node(ctx));
  music.start();
  const seen = [music.current.score], seams = [];
  for (let t = 0; t < 400; t += 0.05) {
    ctx.currentTime = t; const before = music.current; music.tick();
    if (music.current !== before) { seen.push(music.current.score); seams.push([before.next, music.current.at, lastRamp(music.current)]); }
  }
  const q = PLAYLIST.ambient, i0 = q.indexOf(seen[0]);
  assert(seen.length >= 4 && seen.every((sc, i) => sc === q[(i0 + i) % q.length]), 'the ambient queue rotates through every track in order');
  assert(seams.every(([end, at, fade]) => near(end, at) && fade === undefined) && music.playing.length <= 2, 'turns chain at the bar line without a fade or a pile-up of tracks');
}
console.log('All music tests passed');
