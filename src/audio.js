// The Sound room's engine: one AudioContext, the sounds it holds, playing the
// timeline, the microphone, bringing sounds in, and mixing it all down.
//
// Every sound is a mono AudioBuffer, kept by id in `bufs`; a buffer is never
// changed once made, so a clip (src/main.js) is only a few numbers pointing at
// one, and undo is cheap. Mono keeps memory down on a 4 GB ChB: three minutes
// of song is about 35 MB.

export let ctx = null;
export const bufs = new Map();     // id → AudioBuffer
export const peaks = new Map();    // id → Float32Array, the loudest sample in each PEAK_BLOCK
export const PEAK_BLOCK = 256;
let master, limiter, analyser;

export function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    master = ctx.createGain();
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 12;
    limiter.attack.value = 0.003; limiter.release.value = 0.2;
    analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
    master.connect(limiter).connect(analyser).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
export const out = () => (audio(), master);
export const rate = () => audio().sampleRate;

let nextId = 1;
export function addBuf(buf, id) {
  id = id || 'b' + Date.now().toString(36) + (nextId++).toString(36);
  bufs.set(id, buf);
  peaks.set(id, makePeaks(buf.getChannelData(0)));
  return id;
}
export function makePeaks(d) {
  const n = Math.ceil(d.length / PEAK_BLOCK), p = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let m = 0;
    const end = Math.min(d.length, (b + 1) * PEAK_BLOCK);
    for (let i = b * PEAK_BLOCK; i < end; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > m) m = v; }
    p[b] = m;
  }
  return p;
}
export function monoBuffer(samples, sampleRate) {
  const b = new AudioBuffer({ length: Math.max(1, samples.length), sampleRate, numberOfChannels: 1 });
  b.copyToChannel(samples, 0);
  return b;
}

// How loud the mix is right now (0..1), for the meters.
const meterData = new Float32Array(1024);
export function level() {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(meterData);
  let m = 0;
  for (let i = 0; i < meterData.length; i++) { const v = Math.abs(meterData[i]); if (v > m) m = v; }
  return m;
}

// ---------------------------------------------------------------------------
// Playing the timeline. A clip plays its buffer from `offset` for `dur`
// seconds, starting at `start` on the timeline; a looping clip goes round its
// whole buffer, `offset` being where in the loop it begins.
// ---------------------------------------------------------------------------
const FADE = 0.004;   // a few milliseconds in and out, so no clip ever clicks

// Lays clips out on any context (live or offline) from timeline time `from`,
// with the timeline's `from` at context time `when`. Returns the sources.
export function schedule(c, dest, project, from, when, until = Infinity) {
  const srcs = [];
  const audible = audibleLanes(project);
  for (const clip of project.clips) {
    const buf = bufs.get(clip.buf);
    if (!buf || !audible.has(clip.lane)) continue;
    const end = Math.min(clip.start + clip.dur, until);
    if (end <= from || clip.start >= until) continue;
    const s = c.createBufferSource();
    s.buffer = buf;
    const g = c.createGain();
    const into = Math.max(0, from - clip.start);          // how far into the clip we start
    const at = when + Math.max(0, clip.start - from);
    const len = end - clip.start - into;
    if (len <= 0.001) continue;
    // Fades: the clip's own (fi, fo, seconds), and always a tiny one. Walked
    // as points in the clip's own time, from where we come in to where we stop.
    const vol = clip.gain ?? 1, D = clip.dur;
    let fi = Math.max(FADE, clip.fi || 0), fo = Math.max(FADE, clip.fo || 0);
    if (fi + fo > D) { const k = D / (fi + fo); fi *= k; fo *= k; }
    const vAt = (u) => Math.max(0, vol * Math.min(1, u / fi, (D - u) / fo));
    const p = g.gain, u1 = into + len;
    p.setValueAtTime(vAt(into), at);
    for (const u of [fi, D - fo]) if (u > into && u < u1) p.linearRampToValueAtTime(vAt(u), at + (u - into));
    if (u1 < D - 1e-6) {   // cut short (the end of the timeline): a tiny fade out
      p.linearRampToValueAtTime(vAt(Math.max(into, u1 - FADE)), at + Math.max(0, len - FADE));
      p.linearRampToValueAtTime(0, at + len);
    } else p.linearRampToValueAtTime(0, at + len);
    s.connect(g).connect(dest);
    if (clip.loop) {
      s.loop = true; s.loopStart = 0; s.loopEnd = buf.duration;
      s.start(at, (clip.offset + into) % buf.duration);
      s.stop(at + len);
    } else {
      const off = clip.offset + into;
      if (off >= buf.duration) continue;
      s.start(at, off, Math.min(len, buf.duration - off));
    }
    srcs.push(s);
  }
  return srcs;
}
export function audibleLanes(project) {
  const solo = project.lanes.some((l) => l.solo);
  return new Set(project.lanes.filter((l) => (solo ? l.solo : !l.mute)).map((l) => l.id));
}

let playing = null;   // { srcs, t0, from, until }
export function play(project, from, until) {
  const c = audio();
  stop();
  const when = c.currentTime + 0.06;
  playing = { srcs: schedule(c, master, project, from, when, until), when, from, until };
  return playing;
}
export function stop() {
  if (!playing) return;
  for (const s of playing.srcs) { try { s.stop(); } catch { /* already done */ } }
  playing = null;
}
export const isPlaying = () => !!playing;
// Where the playhead is, on the timeline, while playing (what you hear now).
export function playTime() {
  if (!playing) return null;
  const heard = ctx.currentTime - (ctx.outputLatency || 0);
  if (playing.next != null && heard >= playing.next) { playing.when = playing.next; playing.from = 0; playing.next = null; }
  return playing.from + Math.max(0, heard - playing.when);
}
// Lines up the next time round, from the start, for when this one ends.
export function queueLoop(project, until) {
  if (!playing || playing.next != null) return;
  const at = playing.when + (until - playing.from);
  playing.srcs.push(...schedule(ctx, master, project, 0, at, until));
  playing.next = at;
}
export const playClock = () => playing && { when: playing.when, from: playing.from };

// One sound, now (a preview). Returns a stopper.
let previewSrc = null;
export function preview(buf, { offset = 0, dur } = {}) {
  const c = audio();
  stopPreview();
  const s = c.createBufferSource();
  s.buffer = buf; s.connect(master);
  s.start(c.currentTime + 0.01, offset, dur ?? buf.duration - offset);
  previewSrc = s;
  s.onended = () => { if (previewSrc === s) previewSrc = null; };
  return s;
}
export function stopPreview() { try { previewSrc?.stop(); } catch { /* done */ } previewSrc = null; }

// ---------------------------------------------------------------------------
// The whole timeline as one sound, for saving as a WAV.
// ---------------------------------------------------------------------------
export async function mixdown(project, sampleRate = rate()) {
  const len = project.length;
  const off = new OfflineAudioContext(1, Math.ceil(len * sampleRate), sampleRate);
  const lim = off.createDynamicsCompressor();
  lim.threshold.value = -6; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.2;
  lim.connect(off.destination);
  schedule(off, lim, project, 0, 0, len);
  return off.startRendering();
}
export function wavBlob(buf) {
  const d = buf.getChannelData(0), sr = buf.sampleRate, n = d.length;
  const ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 0x7fff, true);
  return new Blob([ab], { type: 'audio/wav' });
}

// ---------------------------------------------------------------------------
// Bringing sounds in: an mp3, wav, m4a, ogg... from the computer or a phone
// (on a ChB the file picker reaches Google Drive). Made mono, at our rate.
// ---------------------------------------------------------------------------
export async function decodeFile(file) {
  const c = audio();
  const buf = await c.decodeAudioData(await file.arrayBuffer());
  if (buf.numberOfChannels === 1) return buf;
  const mono = new Float32Array(buf.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels;
  }
  return monoBuffer(mono, buf.sampleRate);
}

// ---------------------------------------------------------------------------
// The microphone. Each chunk carries the context time of its first sample
// (from Ditty's recorder), so a take lines up with what was playing.
// ---------------------------------------------------------------------------
const WORKLET = `
class KraftyCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage({ t: currentTime, data: ch.slice(0) });
    return true;
  }
}
registerProcessor('krafty-capture', KraftyCapture);
`;
let workletLoaded = false;
export const mic = {
  stream: null, node: null, src: null, chunks: [], capturing: false, onChunk: null, level: 0,
  async open() {
    if (this.stream) return;
    const c = audio();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('nomic');
    this.stream = await navigator.mediaDevices.getUserMedia({
      // Kids in a busy classroom: tidy the sound up, and keep it at a steady loudness.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.src = c.createMediaStreamSource(this.stream);
    const sink = c.createGain(); sink.gain.value = 0; sink.connect(c.destination);
    if (c.audioWorklet) {
      if (!workletLoaded) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await c.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        workletLoaded = true;
      }
      this.node = new AudioWorkletNode(c, 'krafty-capture');
      this.node.port.onmessage = (e) => this.push(e.data.t, e.data.data);
    } else {
      this.node = c.createScriptProcessor(2048, 1, 1);
      this.node.onaudioprocess = (e) => this.push(e.playbackTime - 2048 / c.sampleRate, e.inputBuffer.getChannelData(0).slice(0));
    }
    this.src.connect(this.node).connect(sink);
    this.stream.getAudioTracks()[0]?.addEventListener('ended', () => this.close());
  },
  push(t, data) {
    let pk = 0;
    for (let i = 0; i < data.length; i++) { const v = data[i] < 0 ? -data[i] : data[i]; if (v > pk) pk = v; }
    this.level = Math.max(pk, this.level * 0.9);
    if (this.capturing) { this.chunks.push({ t, data }); this.onChunk?.(pk); }
  },
  start() { this.chunks = []; this.capturing = true; },
  // The take, from context time `from` on (anything earlier dropped).
  stop(from) {
    this.capturing = false;
    const c = audio(), sr = c.sampleRate, chunks = this.chunks;
    this.chunks = [];
    if (!chunks.length) return new Float32Array(0);
    const total = chunks.reduce((n, ch) => n + ch.data.length, 0), all = new Float32Array(total);
    let o = 0;
    for (const ch of chunks) { all.set(ch.data, o); o += ch.data.length; }
    const skip = Math.max(0, Math.round((from - chunks[0].t) * sr));
    return all.subarray(Math.min(skip, all.length));
  },
  close() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.src?.disconnect(); this.node?.disconnect();
    this.stream = this.src = this.node = null;
    this.capturing = false;
  },
};

// Where a take's sound really starts and ends: the quiet before and after it
// trimmed off (the timing stays right: the clip just starts later).
export function quietEnds(d, sampleRate, thresh = 0.02) {
  const win = Math.round(sampleRate * 0.01);
  let a = 0, b = d.length;
  const loud = (i) => { let m = 0; for (let k = i; k < Math.min(d.length, i + win); k++) m = Math.max(m, Math.abs(d[k])); return m > thresh; };
  while (a < d.length && !loud(a)) a += win;
  while (b > a && !loud(Math.max(0, b - win))) b -= win;
  const pad = Math.round(sampleRate * 0.06);
  return [Math.max(0, a - pad), Math.min(d.length, b + pad)];
}

// ---------------------------------------------------------------------------
// Voice effects. Each makes a new buffer from part of one, offline.
// ---------------------------------------------------------------------------
function impulse(c, secs, decay) {
  const n = Math.round(c.sampleRate * secs), b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return b;
}
export const VOICES = [
  { id: 'normal', name: 'Natural' },
  { id: 'chipmunk', name: 'High', speed: 1.6 },
  { id: 'monster', name: 'Low', speed: 0.68 },
  { id: 'robot', name: 'Robot' },
  { id: 'radio', name: 'Radio' },
  { id: 'alien', name: 'Wobble' },
  { id: 'echo', name: 'Echo', tail: 1.6 },
  { id: 'cave', name: 'Hall', tail: 2.2 },
  { id: 'back', name: 'Reverse' },
];
export async function voiceFx(buf, offset, dur, id) {
  const v = VOICES.find((x) => x.id === id);
  const sr = buf.sampleRate, a = Math.round(offset * sr), b = Math.min(buf.length, Math.round((offset + dur) * sr));
  const part = buf.getChannelData(0).slice(a, b);
  if (!v || id === 'normal') return monoBuffer(part, sr);
  if (id === 'back') return monoBuffer(part.reverse(), sr);
  const speed = v.speed || 1, len = part.length / sr / speed + (v.tail || 0) + (id === 'robot' ? 0.05 : 0);
  const off = new OfflineAudioContext(1, Math.ceil(len * sr), sr);
  const s = off.createBufferSource();
  s.buffer = monoBuffer(part, sr);
  s.playbackRate.value = speed;
  let node = s;
  const to = (n) => { node.connect(n); node = n; return n; };
  const dry = off.createGain();
  if (id === 'monster') { const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; to(lp); }
  if (id === 'robot') {
    // Ring modulation, and a short metal tube to sing down.
    const ring = off.createGain(); ring.gain.value = 0;
    const lfo = off.createOscillator(); lfo.frequency.value = 55; lfo.connect(ring.gain); lfo.start();
    to(ring);
    const dl = off.createDelay(); dl.delayTime.value = 0.012;
    const fb = off.createGain(); fb.gain.value = 0.5;
    ring.connect(dl).connect(fb).connect(dl);
    const mix = off.createGain(); ring.connect(mix); dl.connect(mix);
    node = mix;
  }
  if (id === 'radio') {
    const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600; to(hp);
    const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2800; to(lp);
    const sh = off.createWaveShaper(); const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = i / 255.5 - 1; curve[i] = Math.tanh(4 * x) / Math.tanh(4); }
    sh.curve = curve; to(sh);
    const g = off.createGain(); g.gain.value = 0.6; to(g);
  }
  if (id === 'alien') {
    // A wobble in the pitch and a ring: a voice from very far away.
    const lfo = off.createOscillator(), d = off.createGain();
    lfo.frequency.value = 7; d.gain.value = 250; lfo.connect(d).connect(s.detune); lfo.start();
    s.detune.value = 500;
    const ring = off.createGain(); ring.gain.value = 0.5;
    const o = off.createOscillator(), og = off.createGain(); o.frequency.value = 30; og.gain.value = 0.5;
    o.connect(og).connect(ring.gain); o.start();
    to(ring);
  }
  if (id === 'echo') {
    const dl = off.createDelay(1); dl.delayTime.value = 0.28;
    const fb = off.createGain(); fb.gain.value = 0.45;
    const wet = off.createGain(); wet.gain.value = 0.6;
    node.connect(dl).connect(fb).connect(dl);
    dl.connect(wet).connect(off.destination);
  }
  if (id === 'cave') {
    const cv = off.createConvolver(); cv.buffer = impulse(off, 2.2, 2.5);
    const wet = off.createGain(); wet.gain.value = 0.55;
    node.connect(cv).connect(wet).connect(off.destination);
  }
  node.connect(dry).connect(off.destination);
  s.start();
  const r = await off.startRendering();
  // Trim the silent end of the tail.
  const d = r.getChannelData(0);
  let end = d.length;
  while (end > 1 && Math.abs(d[end - 1]) < 0.001) end--;
  return end < d.length ? monoBuffer(d.slice(0, end), sr) : r;
}

// Gets louder (or quieter) so its loudest bit is near the top: for quiet takes.
export function normalise(buf, offset, dur, peak = 0.89) {
  const sr = buf.sampleRate, d = buf.getChannelData(0).slice(Math.round(offset * sr), Math.round((offset + dur) * sr));
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m < 1e-4) return null;
  const k = peak / m;
  for (let i = 0; i < d.length; i++) d[i] *= k;
  return monoBuffer(d, sr);
}
