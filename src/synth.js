// The Sound room's instruments, drum kits, silly sounds and ready-made loops.
//
// Everything is made with the Web Audio API: no samples to download, so the
// room opens at once and costs nothing in memory until a sound is used. The
// instruments and kits come from Ditty (inkmotor/ditty-offky,
// src/audio/instruments.js), cut down to the friendliest ones.
//
// Every voice works on any context, live or offline: play(ctx, out, time, ...).
// Anything that lands on the timeline is rendered once to a buffer (render())
// so the timeline only ever holds plain audio: a voice, a loop, a beat, a tune
// and a boing are all chopped, looped and moved the same way.

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}
function noise(ctx, time, dur) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  src.start(time, Math.random() * 0.5);
  src.stop(time + dur);
  return src;
}
function osc(ctx, type, freq, time, stop, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, time);
  if (detune) o.detune.setValueAtTime(detune, time);
  o.start(time);
  o.stop(stop);
  return o;
}
function gain(ctx, v = 1) { const g = ctx.createGain(); g.gain.value = v; return g; }
function filter(ctx, type, freq, q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  return f;
}
// A quick hit: up to `peak` in `a` seconds, then down to nothing over `d`.
function env(param, time, peak, a, d) {
  param.setValueAtTime(0.0001, time);
  param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + a);
  param.exponentialRampToValueAtTime(0.0001, time + a + d);
  return time + a + d;
}
// Attack, decay, sustain, release. Returns when it's silent.
function adsr(param, time, dur, vel, { a = 0.01, d = 0.1, s = 0.7, r = 0.1 } = {}) {
  const peak = Math.max(0.0001, vel), sus = Math.max(0.0001, peak * s), end = time + Math.max(dur, a);
  param.setValueAtTime(0.0001, time);
  param.exponentialRampToValueAtTime(peak, time + a);
  param.setTargetAtTime(sus, time + a, d / 3);
  const held = sus + (peak - sus) * Math.exp(-(end - time - a) / (d / 3));
  param.setValueAtTime(held, end);
  param.setTargetAtTime(0.0001, end, r / 4);
  return end + r * 1.5;
}
function vibrato(ctx, targets, time, stop, { rate = 5.5, cents = 12, delay = 0.25 } = {}) {
  const lfo = osc(ctx, 'sine', rate, time, stop), depth = ctx.createGain();
  depth.gain.setValueAtTime(0, time);
  depth.gain.linearRampToValueAtTime(cents, time + delay + 0.2);
  lfo.connect(depth);
  for (const t of targets) depth.connect(t.detune);
}

// Karplus-Strong plucked string, made once per pitch.
const ksCache = new WeakMap();
function pluck(ctx, midi, bright = 0.55) {
  let map = ksCache.get(ctx);
  if (!map) ksCache.set(ctx, (map = new Map()));
  const key = midi + ':' + bright;
  if (map.has(key)) return map.get(key);
  const sr = ctx.sampleRate, period = sr / midiToFreq(midi), n = Math.max(2, Math.floor(period));
  const len = Math.round(sr * 1.8), buf = ctx.createBuffer(1, len, sr), y = buf.getChannelData(0);
  const decay = 0.996;
  let lp = 0;
  for (let i = 0; i < Math.min(n + 1, len); i++) { lp += bright * (Math.random() * 2 - 1 - lp); y[i] = lp; }
  for (let i = n + 1; i < len; i++) y[i] = decay * 0.5 * (y[i - n] + y[i - n - 1]);
  const info = { buf, rate: (n + 0.5) / period };
  map.set(key, info);
  return info;
}

// ---------------------------------------------------------------------------
// Instruments, for the Play pads and the loops.
// ---------------------------------------------------------------------------
export const INSTRUMENTS = {
  piano: { name: 'Piano', icon: '🎹', play(ctx, out, time, midi, dur = 0.4, vel = 0.8) {
    const f = midiToFreq(midi), g = gain(ctx), decay = midi < 60 ? 1.6 : 1.0;
    const stop = adsr(g.gain, time, dur, vel * 0.45, { a: 0.004, d: decay, s: 0.15, r: 0.25 });
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * (4 + 6 * vel), time);
    lp.frequency.exponentialRampToValueAtTime(f * 2, time + decay);
    osc(ctx, 'triangle', f, time, stop).connect(lp);
    osc(ctx, 'sine', f * 2, time, stop, 3).connect(gain(ctx, 0.3)).connect(lp);
    osc(ctx, 'sawtooth', f, time, stop, -4).connect(gain(ctx, 0.08)).connect(lp);
    lp.connect(g).connect(out);
    return stop;
  } },
  marimba: { name: 'Marimba', icon: '🪵', play(ctx, out, time, midi, dur, vel = 0.8) {
    const f = midiToFreq(midi), g = gain(ctx);
    env(g.gain, time, vel * 0.6, 0.003, 0.6);
    osc(ctx, 'sine', f, time, time + 0.7).connect(g);
    const h = gain(ctx); env(h.gain, time, vel * 0.25, 0.001, 0.08);
    osc(ctx, 'sine', f * 4, time, time + 0.1).connect(h).connect(g);
    g.connect(out);
    return time + 0.7;
  } },
  bells: { name: 'Bells', icon: '🔔', play(ctx, out, time, midi, dur, vel = 0.8) {
    const f = midiToFreq(midi + 12), g = gain(ctx, vel * 0.2);
    for (const [ratio, amp, decay] of [[1, 1, 2.2], [2.76, 0.5, 1.1], [5.4, 0.3, 0.5], [8.93, 0.15, 0.25]]) {
      const a = gain(ctx); env(a.gain, time, amp, 0.002, decay);
      osc(ctx, 'sine', f * ratio, time, time + decay + 0.05).connect(a).connect(g);
    }
    g.connect(out);
    return time + 2.3;
  } },
  guitar: { name: 'Guitar', icon: '🎸', play(ctx, out, time, midi, dur = 0.5, vel = 0.8) {
    const { buf, rate } = pluck(ctx, midi), src = ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = rate;
    const g = gain(ctx), end = time + Math.max(dur, 0.25);
    g.gain.setValueAtTime(vel * 0.9, time);
    g.gain.setValueAtTime(vel * 0.9, end);
    g.gain.setTargetAtTime(0.0001, end, 0.08);
    const body = filter(ctx, 'peaking', 200); body.gain.value = 5;
    src.connect(body).connect(g).connect(out);
    src.start(time); src.stop(end + 0.4);
    return end + 0.4;
  } },
  flute: { name: 'Flute', icon: '🪈', play(ctx, out, time, midi, dur = 0.4, vel = 0.8) {
    const f = midiToFreq(midi + 12), g = gain(ctx);
    const stop = adsr(g.gain, time, dur, vel * 0.35, { a: 0.05, d: 0.2, s: 0.8, r: 0.12 });
    const o = osc(ctx, 'sine', f, time, stop), o2 = osc(ctx, 'triangle', f * 2, time, stop);
    vibrato(ctx, [o, o2], time, stop, { cents: 10, rate: 5, delay: 0.2 });
    o.connect(g); o2.connect(gain(ctx, 0.12)).connect(g);
    const bg = gain(ctx); bg.gain.setValueAtTime(0.4, time); bg.gain.setTargetAtTime(0.1, time + 0.05, 0.05);
    noise(ctx, time, stop - time).connect(filter(ctx, 'bandpass', f * 2, 2)).connect(bg).connect(g);
    g.connect(out);
    return stop;
  } },
  chip: { name: '8-bit', icon: '👾', play(ctx, out, time, midi, dur = 0.2, vel = 0.8) {
    const f = midiToFreq(midi), g = gain(ctx), end = time + Math.max(dur - 0.01, 0.06);
    g.gain.setValueAtTime(vel * 0.12, time);
    g.gain.setValueAtTime(vel * 0.12, end);
    g.gain.linearRampToValueAtTime(0, end + 0.01);
    osc(ctx, 'square', f, time, end + 0.02).connect(g).connect(out);
    return end + 0.02;
  } },
  // Not on the pads: the loops' bass and pads.
  bass: { name: 'Bass', hidden: true, play(ctx, out, time, midi, dur = 0.3, vel = 0.8) {
    const f = midiToFreq(midi), g = gain(ctx);
    const stop = adsr(g.gain, time, dur, vel * 0.5, { a: 0.005, d: 0.25, s: 0.6, r: 0.08 });
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
    lp.frequency.setValueAtTime(f * 2, time);
    lp.frequency.linearRampToValueAtTime(f * (6 + 8 * vel), time + 0.01);
    lp.frequency.setTargetAtTime(f * 2.5, time + 0.01, 0.08);
    osc(ctx, 'sawtooth', f, time, stop).connect(lp);
    osc(ctx, 'square', f / 2, time, stop).connect(gain(ctx, 0.35)).connect(lp);
    lp.connect(g).connect(out);
    return stop;
  } },
  pluckbass: { name: 'Pluck bass', hidden: true, play(ctx, out, time, midi, dur = 0.3, vel = 0.8) {
    const f = midiToFreq(midi), g = gain(ctx);
    env(g.gain, time, vel * 0.7, 0.004, Math.max(0.2, dur));
    osc(ctx, 'triangle', f, time, time + dur + 0.3).connect(g);
    osc(ctx, 'sine', f / 2, time, time + dur + 0.3).connect(gain(ctx, 0.5)).connect(g);
    g.connect(out);
    return time + dur + 0.3;
  } },
  pad: { name: 'Pad', hidden: true, play(ctx, out, time, midi, dur = 1, vel = 0.8) {
    const f = midiToFreq(midi), g = gain(ctx);
    const stop = adsr(g.gain, time, dur, vel * 0.08, { a: 0.3, d: 0.4, s: 0.8, r: 0.6 });
    const lp = filter(ctx, 'lowpass', f * 3, 0.5);
    for (const dt of [-8, 0, 8]) osc(ctx, 'sawtooth', f, time, stop, dt).connect(lp);
    lp.connect(g).connect(out);
    return stop;
  } },
  organ: { name: 'Organ', hidden: true, play(ctx, out, time, midi, dur = 0.3, vel = 0.8) {
    const f = midiToFreq(midi), g = gain(ctx);
    const stop = adsr(g.gain, time, dur, vel * 0.16, { a: 0.01, d: 0.05, s: 1, r: 0.08 });
    for (const [r, a] of [[0.5, 0.5], [1, 1], [2, 0.6], [3, 0.3], [4, 0.25]]) osc(ctx, 'sine', f * r, time, stop).connect(gain(ctx, a)).connect(g);
    g.connect(out);
    return stop;
  } },
};
export const PAD_INSTRUMENTS = Object.entries(INSTRUMENTS).filter(([, v]) => !v.hidden).map(([k]) => k);

// The pads: a major pentatonic over two octaves, so anything a kid taps
// sounds good together. The colours are Krafty's Milan palette and friends.
export const PADS = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81].map((midi, i) => ({
  midi, key: 'asdfghjkl;'[i],
  color: ['#E04B32', '#F2A93B', '#F7D560', '#8FA37A', '#4F8A8B', '#3E7CB1', '#8E6BB8', '#D9A0A0', '#C96F4A', '#5B9C4A'][i],
}));

// ---------------------------------------------------------------------------
// Drums
// ---------------------------------------------------------------------------
function kick(ctx, out, time, vel, { start = 150, end = 45, decay = 0.45, click = 0.4 } = {}) {
  const o = osc(ctx, 'sine', start, time, time + decay + 0.1);
  o.frequency.exponentialRampToValueAtTime(end, time + 0.12);
  const g = gain(ctx);
  g.gain.setValueAtTime(vel, time);
  g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  o.connect(g).connect(out);
  if (click) {
    const cg = gain(ctx); env(cg.gain, time, vel * click, 0.001, 0.015);
    noise(ctx, time, 0.02).connect(filter(ctx, 'highpass', 1500)).connect(cg).connect(out);
  }
}
function snare(ctx, out, time, vel, { tone = 185, decay = 0.2, bright = 1800 } = {}) {
  const ng = gain(ctx); env(ng.gain, time, vel * 0.7, 0.001, decay);
  noise(ctx, time, decay + 0.05).connect(filter(ctx, 'highpass', bright)).connect(ng).connect(out);
  const o = osc(ctx, 'triangle', tone, time, time + 0.15);
  o.frequency.exponentialRampToValueAtTime(tone * 0.7, time + 0.1);
  const og = gain(ctx); env(og.gain, time, vel * 0.6, 0.001, 0.1);
  o.connect(og).connect(out);
}
function clap(ctx, out, time, vel) {
  const g = gain(ctx);
  g.gain.setValueAtTime(0.0001, time);
  for (const off of [0, 0.011, 0.023]) {
    g.gain.setValueAtTime(vel * 0.9, time + off);
    g.gain.exponentialRampToValueAtTime(0.05, time + off + 0.009);
  }
  g.gain.setValueAtTime(vel * 0.7, time + 0.034);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
  noise(ctx, time, 0.25).connect(filter(ctx, 'bandpass', 1400, 1.2)).connect(g).connect(out);
}
function hat(ctx, out, time, vel, decay = 0.05, cutoff = 7000) {
  const g = gain(ctx); env(g.gain, time, vel * 0.4, 0.001, decay);
  noise(ctx, time, decay + 0.02).connect(filter(ctx, 'highpass', cutoff)).connect(g).connect(out);
}
function tom(ctx, out, time, vel, f = 160) {
  const o = osc(ctx, 'sine', f, time, time + 0.4);
  o.frequency.exponentialRampToValueAtTime(f * 0.56, time + 0.25);
  const g = gain(ctx);
  g.gain.setValueAtTime(vel * 0.8, time);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.35);
  o.connect(g).connect(out);
}
function cowbell(ctx, out, time, vel) {
  const g = gain(ctx); env(g.gain, time, vel * 0.25, 0.001, 0.3);
  const bp = filter(ctx, 'bandpass', 800, 3);
  osc(ctx, 'square', 540, time, time + 0.35).connect(bp);
  osc(ctx, 'square', 800, time, time + 0.35).connect(bp);
  bp.connect(g).connect(out);
}

const KIT_SETS = {
  studio: { kick: {}, snare: {}, hat: 0.05, ohat: 0.32, cut: 7000 },
  boom: { kick: { start: 110, end: 38, decay: 1.0, click: 0.15 }, snare: { tone: 220, decay: 0.15, bright: 2500 }, hat: 0.035, ohat: 0.25, cut: 9000 },
  lofi: { kick: { start: 120, end: 50, decay: 0.3, click: 0.1 }, snare: { tone: 160, decay: 0.25, bright: 900 }, hat: 0.06, ohat: 0.25, cut: 4500 },
};
export const KITS = { studio: 'Studio', boom: 'Boom', lofi: 'Lo-fi' };
export const DRUMS = [
  { id: 'kick', name: 'Boom', color: '#E04B32' },
  { id: 'snare', name: 'Bap', color: '#F2A93B' },
  { id: 'clap', name: 'Clap', color: '#D9A0A0' },
  { id: 'hat', name: 'Tss', color: '#8FA37A' },
  { id: 'ohat', name: 'Tsss', color: '#4F8A8B' },
  { id: 'tom', name: 'Tom', color: '#3E7CB1' },
  { id: 'cow', name: 'Bell', color: '#8E6BB8' },
];
export function drum(ctx, out, id, time, vel = 0.85, kit = 'studio') {
  const k = KIT_SETS[kit] || KIT_SETS.studio;
  switch (id) {
    case 'kick': return kick(ctx, out, time, vel, k.kick);
    case 'snare': return snare(ctx, out, time, vel, k.snare);
    case 'clap': return clap(ctx, out, time, vel);
    case 'hat': return hat(ctx, out, time, vel, k.hat, k.cut);
    case 'ohat': return hat(ctx, out, time, vel, k.ohat, k.cut);
    case 'tom': return tom(ctx, out, time, vel);
    case 'cow': return cowbell(ctx, out, time, vel);
  }
}

// Starting beats for the drum grid: 16 steps, rows as in DRUMS.
const B = (s) => s.split('').map((c) => c === 'x');
export const BEATS = {
  'Stomp': { kick: B('x...x...x...x...'), snare: B('....x.......x...'), hat: B('x.x.x.x.x.x.x.x.') },
  'Bounce': { kick: B('x.....x...x.....'), snare: B('....x.......x...'), hat: B('xxxxxxxxxxxxxxxx'), clap: B('............x...') },
  'Disco': { kick: B('x...x...x...x...'), clap: B('....x.......x...'), hat: B('x.x.x.x.x.x.x.x.'), ohat: B('..x...x...x...x.') },
  'Gallop': { kick: B('x..x..x.x..x..x.'), tom: B('......x.......xx'), hat: B('x.xxx.xxx.xxx.xx') },
  'Jungle': { kick: B('x.........x.....'), snare: B('....x..x.x..x...'), tom: B('..x...x....x..x.'), cow: B('x..x..x...x..x..') },
  'Empty': {},
};

// ---------------------------------------------------------------------------
// Silly sounds: tap to hear, drag onto the timeline. Each makes itself on any
// context at `t` and says how long it lasts.
// ---------------------------------------------------------------------------
function sweep(ctx, out, t, type, f0, f1, dur, vol = 0.3, curve = 'exp') {
  const o = osc(ctx, type, f0, t, t + dur + 0.05), g = gain(ctx);
  if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  else o.frequency.linearRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.setValueAtTime(vol, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  return o;
}
function tone(ctx, out, t, type, f, dur, vol = 0.3, a = 0.005) {
  const g = gain(ctx); env(g.gain, t, vol, a, dur);
  osc(ctx, type, f, t, t + a + dur + 0.02).connect(g).connect(out);
}
function burst(ctx, out, t, dur, vol, type, freq, q = 1, a = 0.002) {
  const g = gain(ctx); env(g.gain, t, vol, a, dur);
  noise(ctx, t, a + dur + 0.02).connect(filter(ctx, type, freq, q)).connect(g).connect(out);
  return g;
}

export const SFX = [
  { id: 'boing', name: 'Boing', icon: '🌀', color: '#F2A93B', len: 0.9, make(ctx, out, t) {
    const o = osc(ctx, 'sine', 110, t, t + 0.9), g = gain(ctx), lfo = osc(ctx, 'sine', 14, t, t + 0.9), d = gain(ctx);
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(330, t + 0.08); o.frequency.exponentialRampToValueAtTime(180, t + 0.8);
    d.gain.setValueAtTime(60, t); d.gain.exponentialRampToValueAtTime(5, t + 0.8);
    lfo.connect(d).connect(o.frequency);
    env(g.gain, t, 0.5, 0.005, 0.85); o.connect(g).connect(out);
  } },
  { id: 'pop', name: 'Pop', icon: '🫧', color: '#D9A0A0', len: 0.15, make(ctx, out, t) {
    sweep(ctx, out, t, 'sine', 400, 1600, 0.06, 0.5);
    burst(ctx, out, t, 0.03, 0.2, 'bandpass', 2000, 2);
  } },
  { id: 'whoosh', name: 'Whoosh', icon: '💨', color: '#8FA37A', len: 0.8, make(ctx, out, t) {
    const g = gain(ctx); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    const bp = filter(ctx, 'bandpass', 300, 1.5); bp.frequency.exponentialRampToValueAtTime(2500, t + 0.4); bp.frequency.exponentialRampToValueAtTime(600, t + 0.8);
    noise(ctx, t, 0.85).connect(bp).connect(g).connect(out);
  } },
  { id: 'zap', name: 'Zap', icon: '⚡', color: '#F7D560', len: 0.35, make(ctx, out, t) {
    sweep(ctx, out, t, 'sawtooth', 1800, 80, 0.3, 0.18);
    sweep(ctx, out, t, 'square', 1200, 60, 0.3, 0.08);
  } },
  { id: 'laser', name: 'Pew pew', icon: '🔫', color: '#E04B32', len: 0.55, make(ctx, out, t) {
    sweep(ctx, out, t, 'square', 1500, 200, 0.18, 0.12);
    sweep(ctx, out, t + 0.25, 'square', 1500, 200, 0.18, 0.12);
  } },
  { id: 'splat', name: 'Splat', icon: '💥', color: '#C96F4A', len: 0.45, make(ctx, out, t) {
    burst(ctx, out, t, 0.35, 0.8, 'lowpass', 900, 1);
    sweep(ctx, out, t, 'sine', 180, 40, 0.2, 0.6);
  } },
  { id: 'ding', name: 'Ding', icon: '🛎️', color: '#F7D560', len: 1.6, make(ctx, out, t) {
    INSTRUMENTS.bells.play(ctx, out, t, 79, 1, 1.2);
  } },
  { id: 'tada', name: 'Ta-da!', icon: '🎉', color: '#E2A951', len: 1.6, make(ctx, out, t) {
    for (const m of [60, 64, 67]) INSTRUMENTS.organ.play(ctx, out, t, m, 0.12, 0.8);
    for (const m of [65, 69, 72, 77]) INSTRUMENTS.organ.play(ctx, out, t + 0.2, m, 1.0, 0.9);
    hat(ctx, out, t + 0.2, 0.9, 1.2, 5000);
  } },
  { id: 'honk', name: 'Honk', icon: '📯', color: '#3E7CB1', len: 0.6, make(ctx, out, t) {
    for (const f of [330, 415]) {
      const g = gain(ctx); env(g.gain, t, 0.15, 0.02, 0.5);
      osc(ctx, 'sawtooth', f, t, t + 0.6).connect(filter(ctx, 'bandpass', 1200, 2)).connect(g).connect(out);
    }
  } },
  { id: 'fart', name: 'Raspberry', icon: '💨', color: '#7A5C4F', len: 0.9, make(ctx, out, t) {
    const o = osc(ctx, 'sawtooth', 90, t, t + 0.9), g = gain(ctx), lfo = osc(ctx, 'square', 23, t, t + 0.9), d = gain(ctx, 30);
    o.frequency.linearRampToValueAtTime(65, t + 0.8);
    lfo.connect(d).connect(o.frequency);
    env(g.gain, t, 0.45, 0.02, 0.8);
    o.connect(filter(ctx, 'lowpass', 500, 4)).connect(g).connect(out);
  } },
  { id: 'up', name: 'Slide up', icon: '⤴️', color: '#5B9C4A', len: 0.7, make(ctx, out, t) {
    const o = sweep(ctx, out, t, 'sine', 300, 1600, 0.65, 0.3);
    vibrato(ctx, [o], t, t + 0.7, { rate: 7, cents: 30, delay: 0 });
  } },
  { id: 'down', name: 'Slide down', icon: '⤵️', color: '#4F8A8B', len: 0.8, make(ctx, out, t) {
    const o = sweep(ctx, out, t, 'sine', 1400, 200, 0.75, 0.3);
    vibrato(ctx, [o], t, t + 0.8, { rate: 7, cents: 30, delay: 0 });
  } },
  { id: 'jump', name: 'Jump', icon: '🦘', color: '#8E6BB8', len: 0.3, make(ctx, out, t) {
    sweep(ctx, out, t, 'square', 200, 800, 0.25, 0.1);
  } },
  { id: 'coin', name: 'Coin', icon: '🪙', color: '#F2A93B', len: 0.5, make(ctx, out, t) {
    tone(ctx, out, t, 'square', 988, 0.08, 0.1, 0.002);
    tone(ctx, out, t + 0.08, 'square', 1319, 0.38, 0.1, 0.002);
  } },
  { id: 'magic', name: 'Magic', icon: '✨', color: '#8E6BB8', len: 1.5, make(ctx, out, t) {
    const notes = [72, 76, 79, 84, 88, 91, 96];
    notes.forEach((m, i) => INSTRUMENTS.bells.play(ctx, out, t + i * 0.07, m - 12, 0.3, 0.5));
  } },
  { id: 'buzz', name: 'Uh-oh', icon: '❌', color: '#E04B32', len: 0.8, make(ctx, out, t) {
    tone(ctx, out, t, 'sawtooth', 160, 0.3, 0.15, 0.01);
    tone(ctx, out, t + 0.35, 'sawtooth', 120, 0.4, 0.15, 0.01);
  } },
  { id: 'boom', name: 'Kaboom', icon: '💣', color: '#3A3232', len: 1.6, make(ctx, out, t) {
    burst(ctx, out, t, 1.5, 1, 'lowpass', 400, 0.7, 0.005);
    kick(ctx, out, t, 1, { start: 90, end: 30, decay: 1.2, click: 0 });
  } },
  { id: 'crash', name: 'Crash', icon: '🥁', color: '#E2A951', len: 1.8, make(ctx, out, t) {
    burst(ctx, out, t, 1.7, 0.5, 'highpass', 4000, 0.5);
    burst(ctx, out, t, 0.6, 0.3, 'bandpass', 6000, 1);
  } },
  { id: 'roll', name: 'Drum roll', icon: '🪘', color: '#C96F4A', len: 2.2, make(ctx, out, t) {
    for (let i = 0; i < 40; i++) snare(ctx, out, t + i * 0.045, 0.25 + 0.5 * (i / 40), { decay: 0.08 });
    snare(ctx, out, t + 1.85, 1); burst(ctx, out, t + 1.85, 1.2, 0.4, 'highpass', 4000, 0.5);
  } },
  { id: 'snip', name: 'Snip', icon: '✂️', color: '#8FA37A', len: 0.3, make(ctx, out, t) {
    burst(ctx, out, t, 0.04, 0.6, 'bandpass', 5000, 3);
    burst(ctx, out, t + 0.12, 0.05, 0.7, 'bandpass', 4000, 3);
  } },
  { id: 'thunk', name: 'Thunk', icon: '📦', color: '#7A5C4F', len: 0.35, make(ctx, out, t) {
    sweep(ctx, out, t, 'sine', 160, 60, 0.18, 0.7);
    burst(ctx, out, t, 0.06, 0.4, 'lowpass', 1500);
  } },
  { id: 'tink', name: 'Tink', icon: '📌', color: '#4F8A8B', len: 0.6, make(ctx, out, t) {
    for (const [f, a] of [[2400, 0.2], [5900, 0.08]]) tone(ctx, out, t, 'sine', f, 0.5, a, 0.001);
  } },
  { id: 'squeak', name: 'Squeak', icon: '🐭', color: '#D9A0A0', len: 0.35, make(ctx, out, t) {
    const o = osc(ctx, 'sine', 1800, t, t + 0.35), g = gain(ctx);
    o.frequency.setValueAtTime(1800, t); o.frequency.linearRampToValueAtTime(2600, t + 0.1); o.frequency.linearRampToValueAtTime(2000, t + 0.3);
    env(g.gain, t, 0.25, 0.01, 0.3); o.connect(g).connect(out);
  } },
  { id: 'dingdong', name: 'Doorbell', icon: '🚪', color: '#3E7CB1', len: 1.8, make(ctx, out, t) {
    INSTRUMENTS.marimba.play(ctx, out, t, 76, 0.5, 0.9);
    INSTRUMENTS.marimba.play(ctx, out, t + 0.5, 72, 0.8, 0.9);
    tone(ctx, out, t, 'sine', midiToFreq(76), 0.9, 0.2); tone(ctx, out, t + 0.5, 'sine', midiToFreq(72), 1.2, 0.2);
  } },
  { id: 'tick', name: 'Tick tock', icon: '⏰', color: '#5F6B78', len: 2.0, make(ctx, out, t) {
    for (let i = 0; i < 4; i++) burst(ctx, out, t + i * 0.5, 0.03, 0.6, 'bandpass', i % 2 ? 1800 : 2600, 6);
  } },
  { id: 'heart', name: 'Heartbeat', icon: '💓', color: '#E04B32', len: 1.6, make(ctx, out, t) {
    for (const s of [0, 0.8]) { kick(ctx, out, t + s, 0.8, { start: 80, end: 40, decay: 0.2, click: 0 }); kick(ctx, out, t + s + 0.2, 0.6, { start: 70, end: 40, decay: 0.2, click: 0 }); }
  } },
  { id: 'clapping', name: 'Hooray', icon: '👏', color: '#E2A951', len: 2.4, make(ctx, out, t) {
    for (let i = 0; i < 60; i++) {
      const s = t + Math.random() * 1.8, v = 0.15 + Math.random() * 0.25;
      burst(ctx, out, s, 0.04, v * (1 - (s - t) / 2.4), 'bandpass', 900 + Math.random() * 1800, 1.5, 0.001);
    }
  } },
  { id: 'bubble', name: 'Bubbles', icon: '🐟', color: '#4F8A8B', len: 1.2, make(ctx, out, t) {
    for (let i = 0; i < 7; i++) {
      const s = t + i * 0.14 + Math.random() * 0.05, f = 300 + Math.random() * 500;
      sweep(ctx, out, s, 'sine', f, f * 2.5, 0.06, 0.25);
    }
  } },
  { id: 'thunder', name: 'Thunder', icon: '⛈️', color: '#3A3232', len: 2.8, make(ctx, out, t) {
    burst(ctx, out, t, 0.25, 0.7, 'highpass', 1500, 0.5);
    const g = gain(ctx); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.7);
    const lp = filter(ctx, 'lowpass', 300, 0.5), lfo = osc(ctx, 'sine', 3, t, t + 2.8), d = gain(ctx, 150);
    lfo.connect(d).connect(lp.frequency);
    noise(ctx, t, 2.8).connect(lp).connect(g).connect(out);
  } },
];

// ---------------------------------------------------------------------------
// Loops: a whole little band, four bars long, in a mood.
// ---------------------------------------------------------------------------
const CH = { I: [0, 4, 7], ii: [2, 5, 9], iii: [4, 7, 11], IV: [5, 9, 12], V: [7, 11, 14], vi: [9, 12, 16], i: [0, 3, 7], iv: [5, 8, 12], v: [7, 10, 14], VI: [8, 12, 15], VII: [10, 14, 17], III: [3, 7, 10] };
export const LOOPS = [
  { id: 'happy', name: 'Happy', icon: '😀', color: '#F2A93B', bpm: 118, root: 60, chords: ['I', 'V', 'vi', 'IV'], lead: 'marimba', arp: [0, 1, 2, 1, 0, 1, 2, 1], bass: 'pluckbass', bassPat: 'x...x...x.x.x...', beat: 'Bounce', kit: 'studio' },
  { id: 'sneaky', name: 'Sneaky', icon: '🕵️', color: '#4F8A8B', bpm: 96, root: 57, minor: true, chords: ['i', 'i', 'iv', 'v'], lead: 'bells', arp: [0, -1, 2, -1, 1, -1, 2, -1], bass: 'pluckbass', bassPat: 'x.x.x.x.x.x.x.x.', walk: true, beat: null, hats: B('..x...x...x...x.'), kit: 'lofi' },
  { id: 'chase', name: 'Chase!', icon: '🏃', color: '#E04B32', bpm: 150, root: 62, minor: true, chords: ['i', 'VI', 'VII', 'i'], lead: 'chip', arp: [0, 1, 2, 3, 2, 1, 0, 1], bass: 'bass', bassPat: 'xxxxxxxxxxxxxxxx', beat: 'Stomp', kit: 'boom' },
  { id: 'sleepy', name: 'Sleepy', icon: '😴', color: '#8E6BB8', bpm: 72, root: 65, chords: ['I', 'vi', 'IV', 'V'], lead: 'bells', arp: [0, 2, 1, 2, -1, -1, -1, -1], bass: 'pad', bassPat: 'x...............', beat: null, kit: 'lofi' },
  { id: 'disco', name: 'Disco', icon: '🪩', color: '#D9A0A0', bpm: 120, root: 57, minor: true, chords: ['i', 'iv', 'VII', 'III'], lead: 'piano', arp: [-1, 0, -1, 1, -1, 2, -1, 1], bass: 'bass', bassPat: 'x.x.x.x.x.x.x.x.', octaves: true, beat: 'Disco', kit: 'studio' },
  { id: 'pirate', name: 'Pirate', icon: '🏴‍☠️', color: '#7A5C4F', bpm: 108, root: 62, minor: true, chords: ['i', 'VII', 'i', 'v'], lead: 'organ', arp: [0, -1, 1, 2, -1, 1, 0, -1], bass: 'pluckbass', bassPat: 'x.....x.x.....x.', beat: 'Gallop', kit: 'lofi' },
  { id: 'space', name: 'Space', icon: '🚀', color: '#3E7CB1', bpm: 90, root: 57, minor: true, chords: ['i', 'VI', 'III', 'VII'], lead: 'flute', arp: [0, 2, 3, 2, 1, -1, 0, -1], bass: 'pad', bassPat: 'x...............', beat: null, hats: B('x...x...x...x...'), kit: 'boom' },
  { id: 'jungle', name: 'Jungle', icon: '🐒', color: '#5B9C4A', bpm: 112, root: 60, chords: ['I', 'IV', 'I', 'V'], lead: 'marimba', arp: [0, 2, 1, 2, 0, 3, 1, 2], bass: 'pluckbass', bassPat: 'x..x..x.x..x..x.', beat: 'Jungle', kit: 'studio' },
];

// Lays a loop out on a context, starting at t. Returns its length in seconds.
export function playLoop(ctx, out, loop, t = 0) {
  const beat = 60 / loop.bpm, step = beat / 4, bar = beat * 4;
  const lead = gain(ctx, 0.8), bass = gain(ctx, 0.9), drums = gain(ctx, 0.85);
  lead.connect(out); bass.connect(out); drums.connect(out);
  loop.chords.forEach((name, b) => {
    const tones = CH[name].map((n) => n + loop.root), t0 = t + b * bar;
    // The bass: the chord's root, down low.
    const bp = B(loop.bassPat);
    bp.forEach((on, s) => {
      if (!on) return;
      let m = tones[0] - 24;
      if (loop.walk) m += [0, 0, 3, 3, 5, 5, 7, 7, 0, 0, 3, 3, 5, 5, 6, 6][s] - 0;
      if (loop.octaves && s % 4 === 2) m += 12;
      const len = loop.bass === 'pad' ? bar * 0.95 : step * 1.6;
      if (loop.bass === 'pad') { for (const n of tones) INSTRUMENTS.pad.play(ctx, bass, t0 + s * step, n - 12, len, 0.8); }
      else INSTRUMENTS[loop.bass].play(ctx, bass, t0 + s * step, m, len, 0.8);
    });
    // The lead: the chord, broken into a tune, two steps a note.
    loop.arp.forEach((i, k) => {
      if (i < 0) return;
      const m = tones[i % 3] + (i >= 3 ? 12 : 0);
      INSTRUMENTS[loop.lead].play(ctx, lead, t0 + k * step * 2, m, step * 1.8, 0.7);
    });
    // The drums.
    const pat = loop.beat ? BEATS[loop.beat] : { hat: loop.hats };
    for (const d of DRUMS) {
      const row = pat[d.id]; if (!row) continue;
      row.forEach((on, s) => { if (on) drum(ctx, drums, d.id, t0 + s * step, 0.75, loop.kit); });
    }
  });
  return bar * loop.chords.length;
}

// The drum grid laid out on a context: `bars` times round. Returns the length.
export function playBeat(ctx, out, grid, bpm, kit, t = 0, bars = 1) {
  const step = 60 / bpm / 4;
  for (let b = 0; b < bars; b++) {
    for (const d of DRUMS) {
      const row = grid[d.id]; if (!row) continue;
      row.forEach((on, s) => { if (on) drum(ctx, out, d.id, t + (b * 16 + s) * step, 0.85, kit); });
    }
  }
  return step * 16 * bars;
}

// A tune you played on the pads: [{ t, midi }] (t from its start).
export function playTune(ctx, out, notes, inst, t = 0) {
  let end = 0;
  for (const n of notes) end = Math.max(end, INSTRUMENTS[inst].play(ctx, out, t + n.t, n.midi, n.dur ?? 0.35, n.vel ?? 0.8) - t);
  return end;
}

// Renders something to a plain mono buffer, offline. `fill(ctx, out)` lays it
// out from time 0; the buffer is `len` seconds long (plus a short tail if
// `tail`, trimmed back to where it falls quiet).
export async function render(sampleRate, len, fill, { tail = 0 } = {}) {
  const frames = Math.max(1, Math.ceil((len + tail) * sampleRate));
  const off = new OfflineAudioContext(1, frames, sampleRate);
  const out = off.createGain();
  out.connect(off.destination);
  fill(off, out);
  const buf = await off.startRendering();
  if (tail) {
    const d = buf.getChannelData(0);
    let end = d.length;
    while (end > Math.ceil(len * sampleRate) && Math.abs(d[end - 1]) < 0.0015) end--;
    if (end < d.length) {
      const cut = new AudioBuffer({ length: Math.max(1, end), sampleRate, numberOfChannels: 1 });
      cut.copyToChannel(d.subarray(0, end), 0);
      return cut;
    }
  }
  return buf;
}

// A loop's sound, rendered: it fits end to end, so the tail of the last
// notes is folded back onto the start, and it loops without a click.
export async function renderLoop(sampleRate, loop) {
  const len = (60 / loop.bpm) * 4 * loop.chords.length;
  const buf = await render(sampleRate, len + 2, (ctx, out) => playLoop(ctx, out, loop, 0));
  return foldTail(buf, len, sampleRate);
}
export async function renderBeat(sampleRate, grid, bpm, kit) {
  const len = (60 / bpm) * 4;
  const buf = await render(sampleRate, len + 1.5, (ctx, out) => playBeat(ctx, out, grid, bpm, kit, 0, 1));
  return foldTail(buf, len, sampleRate);
}
function foldTail(buf, len, sampleRate) {
  const n = Math.round(len * sampleRate), d = buf.getChannelData(0);
  const out = new AudioBuffer({ length: n, sampleRate, numberOfChannels: 1 }), o = out.getChannelData(0);
  o.set(d.subarray(0, n));
  for (let i = n; i < d.length; i++) o[(i - n) % n] += d[i];
  return out;
}
