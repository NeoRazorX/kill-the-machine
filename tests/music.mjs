// Combat detection, hysteresis and crossfade of the procedural music, with a fake AudioContext.
const { MUSIC, combatScore, CombatMonitor, Music } = await import('../src/music.js');
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

// ---------------------------------------------------------------- crossfade
class Param {
  constructor(v = 0) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); this.target = v; return this; }
  exponentialRampToValueAtTime(v, t) { this.events.push(['exp', v, t]); return this; }
  cancelScheduledValues() { this.events.length = 0; return this; }
}
class Node {
  constructor(ctx) { this.ctx = ctx; this.gain = new Param(1); this.frequency = new Param(); this.detune = new Param(); this.Q = new Param(); this.delayTime = new Param(); }
  connect(n) { return n; }
  start(t) { this.ctx.started.push(t); } stop() {}
}
function fakeCtx() {
  const ctx = { currentTime: 0, started: [] };
  for (const k of ['createGain', 'createOscillator', 'createBiquadFilter', 'createDelay', 'createBufferSource']) ctx[k] = () => new Node(ctx);
  return ctx;
}
{
  const ctx = fakeCtx(), dest = new Node(ctx), music = new Music(ctx, dest, {});
  const { ambient, combat } = music.tracks;
  assert(music.bus.gain.value === MUSIC.level && MUSIC.level < 0.5, 'the music bus sits below the effects level');
  music.start(); music.tick();
  assert(ambient.on && ambient.out.gain.target === 1 && !combat.on && combat.out.gain.target === 0, 'the mission starts on the calm track');
  assert(ctx.started.length > 0, 'notes are scheduled ahead of time');
  ctx.currentTime = 5; ctx.started.length = 0; music.tick();
  const ambientNotes = ctx.started.length;
  assert(ambientNotes > 0 && ctx.started.every(t => t >= 5), 'the scheduler keeps going without frames');

  // Fight around the player's units: the music fades to the combat track.
  const g = world(); g.units.push(ent('human', { lastHit: 100 }), ent('human', { lastFired: 100 }), ent('human', { lastHit: 100 }), ent('human', { lastHit: 100 }));
  music.updateCombat(MUSIC.check, g);
  assert(music.combat && music.mode === 'combat', 'combat around the player switches the music');
  const up = combat.out.gain.events.find(e => e[0] === 'ramp'), down = ambient.out.gain.events.find(e => e[0] === 'ramp');
  assert(up[1] === 1 && Math.abs(up[2] - (5 + MUSIC.fadeIn)) < 1e-9 && down[1] === 0 && Math.abs(down[2] - (5 + MUSIC.fadeOut)) < 1e-9,
    'the switch is a crossfade: the combat track fades in while the calm one fades out');
  ctx.currentTime = 6; ctx.started.length = 0; music.tick();
  const during = ctx.started.length;
  ctx.currentTime = 20; ctx.started.length = 0; music.tick(); ctx.currentTime = 20.3; ctx.started.length = 0; music.tick();
  const after = ctx.started.length;
  assert(during > after && after > 0, 'both tracks play during the fade and only the combat track afterwards');

  // Calm: no combat for the calm period, measured in game time.
  g.time = 200; ctx.currentTime = 30;
  for (let t = 0; t < MUSIC.calm + MUSIC.check; t += MUSIC.check / 2) music.updateCombat(MUSIC.check / 2, g);
  assert(!music.combat && music.mode === 'ambient' && ambient.out.gain.target === 1 && combat.out.gain.target === 0, 'the music returns to the calm track');

  music.muted = true; ctx.currentTime = 50; ctx.started.length = 0; music.tick();
  assert(ctx.started.length === 0, 'muted music schedules no notes');
  music.muted = false; ctx.currentTime = 51; music.tick();
  assert(ctx.started.length > 0, 'unmuting resumes the music');
}
console.log('All music tests passed');
