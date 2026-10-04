// Krafty Sound: the Sound room.
//
// The screen is laid out as Krafty's Animate room: the film top left, the
// sound box top right (Record, Loops, Beats, Play, Sounds, Bring in), and the
// timeline under them. Everything you make lands on the timeline as a clip
// of plain sound, so a voice, a loop, a beat, a tune, a boing and an mp3 are
// all moved, chopped, looped, faded and made silly the same way.
//
// Built to fit and feel quick on a ChB (1366 × 768, touch and pen, 4 GB):
// sounds are mono, the timeline is only redrawn when something changes (the
// playhead is drawn over a cached picture), and nothing is downloaded.

import { S, FPS, on, emit, change, commit, snap, undo, redo, canUndo, canRedo, resetHistory, clipById, laneById, selected, clipEnd, laneFor, newId, newProject, frameOf, fitLength, MAX_LANES, addLane } from './state.js';
import * as A from './audio.js';
import { INSTRUMENTS, PAD_INSTRUMENTS, PADS, DRUMS, KITS, BEATS, SFX, LOOPS, drum, render, renderLoop, renderBeat, playTune } from './synth.js';
import * as TL from './timeline.js';
import { initViewer, drawFilm } from './viewer.js';
import { saveLocal, loadLocal, fileBlob, openFile, download } from './store.js';

const $ = (q) => document.querySelector(q);
const $$ = (q) => [...document.querySelectorAll(q)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// ---------------------------------------------------------------------------
// Little things you set, kept in this browser
// ---------------------------------------------------------------------------
const PREFS_KEY = 'krafty-sound-prefs';
let prefs = {};
try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { prefs = {}; }
const P = {
  tab: prefs.tab || 'record',
  soft: prefs.soft ?? true,
  film: prefs.film ?? true,
  count: prefs.count ?? true,
  inst: INSTRUMENTS[prefs.inst] ? prefs.inst : 'marimba',
  kit: KITS[prefs.kit] ? prefs.kit : 'studio',
  bpm: prefs.bpm || 110,
  grid: prefs.grid || gridFrom(BEATS.Stomp),
  preset: prefs.preset || 'Stomp',
  snap: !!prefs.snap,
  loop: prefs.loop ?? true,
};
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(P)); } catch { /* private window */ } }
function gridFrom(b) { const g = {}; for (const d of DRUMS) g[d.id] = (b[d.id] || Array(16).fill(false)).slice(); return g; }
S.snap = P.snap; S.loop = P.loop;

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = 0;
function toast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------------------------------------------------------------------------
// The chrome: brand, look, rooms, files, help
// ---------------------------------------------------------------------------
fetch('assets/logo.svg').then((r) => r.text()).then((svg) => { $('#brand').innerHTML = svg; }).catch(() => { $('#brand').textContent = 'Krafty'; });

function setLook(soft) {
  P.soft = soft;
  document.documentElement.classList.toggle('soft', soft);
  document.querySelector('meta[name=theme-color]').content = soft ? '#36373B' : '#FEF9EF';
  TL.recolour();
  savePrefs();
}
$('#btn-look').addEventListener('click', () => setLook(!P.soft));

// The room key. Standalone, the other rooms live in Krafty itself.
const ROOMS = [
  { id: 'make', name: 'Make', icon: '<path d="M4 20l1.2-4.6L15.8 4.8a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path d="m14 6.6 3.4 3.4"/>' },
  { id: 'paint', name: 'Paint', icon: '<path d="M14.5 4.5l5 5-7.8 7.8-5-5z"/><path d="M6.7 12.3c-2.2.4-3.2 2-3.2 4.2 0 1.3-.4 2.3-1 3 3.6.6 6.6-.2 7.9-2.3"/>' },
  { id: 'animate', name: 'Animate', icon: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7.5 5v14M16.5 5v14M3.5 9.7h4M3.5 14.3h4M16.5 9.7h4M16.5 14.3h4"/>' },
  { id: 'sound', name: 'Sound', icon: '<path d="M4 11v2M7.5 8v8M11 4.5v15M14.5 8.5v7M18 6.5v11M21 10.5v3"/>' },
];
$('#btn-room').addEventListener('click', () => {
  const m = $('#room-menu');
  if (!m.hidden) { m.hidden = true; return; }
  closePops();
  m.innerHTML = '';
  for (const r of ROOMS) {
    const b = el('button', r.id === 'sound' ? 'active' : '', `<svg viewBox="0 0 24 24">${r.icon}</svg>${r.name}${r.id === 'sound' ? '' : '<small>in Krafty</small>'}`);
    b.disabled = r.id !== 'sound';
    b.addEventListener('click', () => { m.hidden = true; });
    m.append(b);
  }
  const rr = $('#btn-room').getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(rr.left, innerWidth - 198)) + 'px';
  m.style.top = (rr.bottom + 8) + 'px';
  m.hidden = false;
});

function closePops(except) {
  for (const id of ['#room-menu', '#files-menu', '#help', '#voice-pop']) if (id !== except) $(id).hidden = true;
}
window.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.pop, #room-menu, #btn-room, #btn-files, #btn-help, #ct-voice')) closePops();
  A.audio();   // the first touch wakes the sound up
}, true);
$('#btn-files').addEventListener('click', () => { const m = $('#files-menu'); const was = m.hidden; closePops(); m.hidden = !was; });
$('#btn-help').addEventListener('click', () => { const m = $('#help'); const was = m.hidden; closePops(); m.hidden = !was; });

$('#files-menu').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  closePops();
  const what = b.dataset.file;
  if (what === 'new') {
    stopAll();
    change(() => { S.project = newProject(); });
    S.sel = null; S.playhead = 0; S.view.t0 = 0; S.view.pps = 0;
    toast('A fresh start. Undo brings it all back', 2400);
  } else if (what === 'open') $('#open-input').click();
  else if (what === 'save') { download(fileBlob(S.project), 'My sounds.ksound'); toast('Saved'); }
  else if (what === 'wav') {
    if (!S.project.clips.length) { toast('Nothing to save yet: record or drop in a sound'); return; }
    toast('Mixing it down…', 6000);
    const buf = await A.mixdown(S.project);
    download(A.wavBlob(buf), 'Krafty sound.wav');
    toast('Saved as a sound');
  } else if (what === 'demo') makeDemo();
});
$('#open-input').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const p = await openFile(f, A.addBuf);
    stopAll();
    change(() => { S.project = p; });
    S.sel = null; S.playhead = 0; S.view.t0 = 0; S.view.pps = 0;
    toast('Opened ' + f.name.replace(/\.ksound$/, ''));
  } catch { toast("That isn't a Krafty sound file", 2400); }
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function setTab(t) {
  P.tab = t; savePrefs();
  for (const b of $$('#tabs button')) b.classList.toggle('active', b.dataset.tab === t);
  for (const p of $$('.tab')) p.classList.toggle('active', p.id === 'tab-' + t);
  if (t !== 'beats') stopTry();
  if (t !== 'loops') stopLoopPreview();
}
for (const b of $$('#tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------
function startPlay(from = S.playhead) {
  if (from >= S.project.length - 0.02) from = 0;
  stopPreviews();
  S.playFrom = from; S.playhead = from;
  A.play(S.project, from, S.project.length);
  S.playing = true;
  refreshTransport();
}
function stopPlay(back = false) {
  A.stop();
  S.playing = false;
  if (back) S.playhead = S.playFrom;
  refreshTransport();
}
function togglePlay() {
  if (S.rec) { stopRecording(); return; }
  if (counting) { cancelCount(); return; }
  if (S.playing) stopPlay(); else startPlay();
}
function stopAll() { if (S.rec) stopRecording(); cancelCount(); stopPlay(); stopPreviews(); }
function seek(t) {
  S.playhead = Math.max(0, t);
  if (S.playing && !S.rec) startPlay(S.playhead);
  needFilm = true;
}
on('seek', seek);
// While playing, an edit is heard straight away.
let replayTimer = 0;
on('change', () => {
  if (S.playing && !S.rec) { clearTimeout(replayTimer); replayTimer = setTimeout(() => { if (S.playing && !S.rec) { const f = S.playFrom; startPlay(S.playhead); S.playFrom = f; } }, 40); }
});
function refreshTransport() {
  $('#tl-play').classList.toggle('playing', S.playing && !S.rec);
  $('#tl-play').innerHTML = S.playing && !S.rec
    ? '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg>';
  $('#tl-rec').classList.toggle('on', !!S.rec && S.rec.kind === 'voice');
  $('#rec-big').classList.toggle('on', !!S.rec && S.rec.kind === 'voice');
  $('#tune-rec').classList.toggle('on', !!S.rec && S.rec.kind === 'tune');
  $('#rec-say').textContent = S.rec?.kind === 'voice' ? 'Tap to stop' : counting ? 'Get ready…' : 'Tap to record';
}
$('#tl-play').addEventListener('click', togglePlay);
$('#tl-start').addEventListener('click', () => seek(0));
$('#tl-loop').addEventListener('click', () => { S.loop = !S.loop; P.loop = S.loop; savePrefs(); refreshBar(); toast(S.loop ? 'Plays round and round' : 'Plays once'); });
$('#tl-snap').addEventListener('click', () => { S.snap = !S.snap; P.snap = S.snap; savePrefs(); refreshBar(); TL.redraw(); toast(S.snap ? 'Snaps to the beat' : 'Snaps to frames'); });
$('#tl-in').addEventListener('click', () => TL.zoom(1.5));
$('#tl-out').addEventListener('click', () => TL.zoom(1 / 1.5));
$('#tl-undo').addEventListener('click', () => { if (undo()) toast('Undone', 900); });
$('#tl-redo').addEventListener('click', () => { if (redo()) toast('Redone', 900); });
$('#tl-secs').addEventListener('change', (e) => {
  const v = Math.max(1, Math.min(600, Math.round(+e.target.value || S.project.length)));
  change(() => { S.project.length = v; });
  S.view.pps = 0; TL.clampView(); TL.redraw();
  refreshBar();
});
function refreshBar() {
  $('#tl-loop').classList.toggle('on', S.loop);
  $('#tl-snap').classList.toggle('on', S.snap);
  $('#tl-undo').disabled = !canUndo();
  $('#tl-redo').disabled = !canRedo();
  if (document.activeElement !== $('#tl-secs')) $('#tl-secs').value = S.project.length;
  $('#tl-empty').hidden = S.project.clips.length > 0 || !!S.rec;
}

// ---------------------------------------------------------------------------
// Recording your voice
// ---------------------------------------------------------------------------
let counting = null;   // the 3-2-1 under way: { timer, resolve }
function countdown() {
  return new Promise((resolve) => {
    const cd = $('#countdown');
    let n = 3;
    const show = () => {
      cd.textContent = n; cd.hidden = false;
      cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
      INSTRUMENTS.marimba.play(A.audio(), A.out(), A.ctx.currentTime + 0.01, n === 1 ? 84 : 72, 0.1, 0.5);
    };
    show();
    counting = { resolve, timer: setInterval(() => {
      n--;
      if (n > 0) show();
      else { clearInterval(counting.timer); counting = null; cd.hidden = true; resolve(true); }
    }, 650) };
    refreshTransport();
  });
}
function cancelCount() {
  if (!counting) return;
  clearInterval(counting.timer);
  const r = counting.resolve; counting = null;
  $('#countdown').hidden = true;
  r(false);
  refreshTransport();
}

async function recordVoice() {
  if (S.rec) { stopRecording(); return; }
  if (counting) { cancelCount(); return; }
  stopPreviews(); stopTry();
  if (S.playing) stopPlay();
  try {
    await A.mic.open();
    $('#mic-help').hidden = true;
  } catch (e) { micTrouble(e); return; }
  if (P.count && !(await countdown())) return;
  beginTake('voice');
  A.mic.onChunk = (pk) => { if (S.rec) S.rec.peaks.push(pk); };
  A.mic.start();
}
function micTrouble(e) {
  const box = $('#mic-help');
  const name = e?.name || e?.message;
  box.innerHTML = !window.isSecureContext
    ? 'The microphone only works over https (or on this computer at localhost). You can still <button data-go="bring">bring in a sound</button>.'
    : name === 'NotAllowedError' || name === 'SecurityError'
      ? 'Krafty isn’t allowed to use the microphone. Tap the little icon at the left of the address bar to allow it, or <button data-go="bring">bring in a sound</button> from your phone.'
      : 'No microphone found. Plug one in, or <button data-go="bring">bring in a sound</button> from your phone instead.';
  box.hidden = false;
  setTab('record');
  toast('No microphone', 1600);
}
$('#mic-help').addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) setTab(g.dataset.go); });

function beginTake(kind) {
  if (S.playhead >= S.project.length - 0.05) S.playhead = 0;
  const start = S.playhead, c = A.audio();
  const lane = laneFor(kind, start, 2);
  let when = c.currentTime + 0.06;
  if (P.film || kind === 'tune') { A.play(S.project, start, S.project.length); when = A.playClock().when; }
  S.rec = { kind, lane, start, when, peaks: [], len: 0, notes: [], hit: 0 };
  S.playing = true; S.playFrom = start;
  refreshTransport(); refreshBar();
}

async function stopRecording() {
  const r = S.rec; if (!r) return;
  S.rec = null;
  A.stop(); S.playing = false;
  S.playhead = r.start;
  refreshTransport();
  if (r.kind === 'voice') await finishVoice(r);
  else await finishTune(r);
  refreshBar(); TL.redraw();
}

let takes = 0;
async function finishVoice(r) {
  const c = A.audio(), sr = c.sampleRate;
  // Line the take up with what you heard: the sound took a moment to reach
  // the speakers, and your voice a moment to come back in.
  const late = P.film ? (c.outputLatency || 0) + (c.baseLatency || 0) : 0;
  const d = A.mic.stop(r.when + late);
  if (d.length < sr * 0.1) { toast('That was very short!'); return; }
  const [a, b] = A.quietEnds(d, sr);
  if (b - a < sr * 0.08) { toast('I didn’t hear anything. Is the microphone on?', 2600); return; }
  let part = d.slice(a, b);
  let pk = 0;
  for (let i = 0; i < part.length; i++) pk = Math.max(pk, Math.abs(part[i]));
  if (pk > 0 && pk < 0.35) { const k = 0.7 / pk; for (let i = 0; i < part.length; i++) part[i] *= k; }   // quiet voices, brought up
  const id = A.addBuf(A.monoBuffer(part, sr));
  takes++;
  const clip = { id: newId(), lane: r.lane, start: r.start + a / sr, offset: 0, dur: part.length / sr, buf: id, gain: 1, kind: 'voice', name: 'Take ' + takes, color: '#F0525A' };
  change(() => { clip.lane = laneFor('voice', clip.start, clip.dur, r.lane); S.project.clips.push(clip); });
  S.sel = clip.id; lastTake = clip.id;
  emit('select');
  toast('Got it! Press play, or make it silly', 2200);
}

// ---------------------------------------------------------------------------
// Silly voices
// ---------------------------------------------------------------------------
let lastTake = null;
const voiceCache = new Map();
function sillyTarget() {
  const s = selected();
  if (s && !s.loop) return s;
  const l = clipById(lastTake);
  return l && !l.loop ? l : null;
}
async function applyVoice(k, id) {
  if (!k || k.loop) return;
  stopPreviews();
  const src = k.src || { buf: k.buf, offset: k.offset, dur: k.dur };
  let bufId;
  if (id === 'normal') bufId = src.buf;
  else {
    const key = [src.buf, src.offset.toFixed(4), src.dur.toFixed(4), id].join('|');
    bufId = voiceCache.get(key);
    if (!bufId || !A.bufs.has(bufId)) {
      bufId = A.addBuf(await A.voiceFx(A.bufs.get(src.buf), src.offset, src.dur, id));
      voiceCache.set(key, bufId);
    }
  }
  const buf = A.bufs.get(bufId);
  change(() => {
    const c = clipById(k.id); if (!c) return;
    if (id === 'normal') { c.buf = src.buf; c.offset = src.offset; c.dur = src.dur; delete c.src; delete c.voice; }
    else { c.src = src; c.buf = bufId; c.offset = 0; c.dur = buf.duration; c.voice = id; }
    if (c.fi > c.dur) c.fi = c.dur;
    if (c.fo > c.dur) c.fo = c.dur;
  });
  const c = clipById(k.id);
  if (c) A.preview(A.bufs.get(c.buf), { offset: c.offset, dur: c.dur });
  refreshSilly();
}
function voiceButtons(host, cls, onPick) {
  host.innerHTML = '';
  for (const v of A.VOICES) {
    const b = el('button', cls, `<span class="emo">${v.icon}</span>${v.name}`);
    b.dataset.voice = v.id;
    b.addEventListener('click', () => onPick(v.id));
    host.append(b);
  }
}
voiceButtons($('#silly-row'), 'chip', (id) => applyVoice(sillyTarget(), id));
voiceButtons($('#voice-pop'), '', (id) => { applyVoice(selected(), id); });
function refreshSilly() {
  const k = sillyTarget();
  $('#silly-row').classList.toggle('ready', !!k);
  $('#silly-what').textContent = k ? `(${k.name})` : '(record something first)';
  for (const b of $$('#silly-row .chip')) b.classList.toggle('active', !!k && (k.voice || 'normal') === b.dataset.voice);
  const s = selected();
  for (const b of $$('#voice-pop button')) b.classList.toggle('active', !!s && (s.voice || 'normal') === b.dataset.voice);
}
$('#rec-big').addEventListener('click', recordVoice);
$('#tl-rec').addEventListener('click', recordVoice);
$('#opt-film').checked = P.film; $('#opt-count').checked = P.count;
$('#opt-film').addEventListener('change', (e) => { P.film = e.target.checked; savePrefs(); });
$('#opt-count').addEventListener('change', (e) => { P.count = e.target.checked; savePrefs(); });

// ---------------------------------------------------------------------------
// Dragging a thing from the sound box onto the timeline
// ---------------------------------------------------------------------------
function draggable(node, { info, tap, dropped }) {
  node.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const x0 = e.clientX, y0 = e.clientY, inf = info();
    let dragging = false;
    try { node.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const ghost = $('#drag-ghost');
    const mv = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) {
        dragging = true;
        ghost.textContent = inf.label; ghost.style.setProperty('--c', inf.color); ghost.hidden = false;
      }
      if (!dragging) return;
      ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
      $('#timeline').classList.toggle('drop-on', !!TL.dropAt(ev.clientX, ev.clientY, inf.len, inf.color));
    };
    const end = (ev) => {
      node.removeEventListener('pointermove', mv);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
      ghost.hidden = true;
      $('#timeline').classList.remove('drop-on');
      const d = TL.endDrop();
      if (dragging) { if (d && ev.type === 'pointerup') dropped(d.t, d.lane); }
      else if (ev.type === 'pointerup') tap();
    };
    node.addEventListener('pointermove', mv);
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
  });
}

// Puts a sound on the timeline: at `t` on `lane` (or the playhead, on the
// lane it likes), picked, and the film made long enough for it.
function putIn(buf, { t = S.playhead, lane, kind, name, color, loop = false, dur }) {
  const id = A.addBuf(buf);
  const clip = { id: newId(), lane: null, start: Math.max(0, t), offset: 0, dur: dur ?? buf.duration, buf: id, gain: 1, kind, name, color };
  if (loop) clip.loop = true;
  change(() => { clip.lane = lane || laneFor(kind, clip.start, clip.dur); S.project.clips.push(clip); });
  S.sel = clip.id; emit('select');
  refreshBar();
  return clip;
}

// ---------------------------------------------------------------------------
// Loops
// ---------------------------------------------------------------------------
const loopBufs = new Map();   // loop id → AudioBuffer, made the first time it's wanted
async function loopBuf(l) {
  if (!loopBufs.has(l.id)) loopBufs.set(l.id, renderLoop(A.rate(), l));
  return loopBufs.get(l.id);
}
let loopPick = null, loopSrc = null;
function stopLoopPreview() {
  try { loopSrc?.stop(); } catch { /* done */ }
  loopSrc = null;
  for (const t of $$('#loop-grid .tile')) t.classList.remove('playing');
}
for (const l of LOOPS) {
  const t = el('button', 'tile', `<span class="emo">${l.icon}</span>${l.name}<small>${l.bpm} bpm</small>`);
  t.style.setProperty('--c', l.color);
  draggable(t, {
    info: () => ({ len: (60 / l.bpm) * 4 * l.chords.length, color: l.color, label: l.icon + ' ' + l.name }),
    tap: async () => {
      const was = t.classList.contains('playing');
      stopLoopPreview(); A.stopPreview();
      loopPick = l;
      for (const x of $$('#loop-grid .tile')) x.classList.toggle('active', x === t);
      $('#loop-add').disabled = false;
      if (was) return;
      if (S.playing) stopPlay();
      t.classList.add('playing');
      const buf = await loopBuf(l);
      if (!t.classList.contains('playing')) return;
      const c = A.audio(), s = c.createBufferSource();
      s.buffer = buf; s.loop = true; s.connect(A.out()); s.start(c.currentTime + 0.02);
      loopSrc = s;
    },
    dropped: async (time, lane) => { const buf = await loopBuf(l); addLoop(l, buf, time, lane); },
  });
  $('#loop-grid').append(t);
}
function addLoop(l, buf, t, lane) {
  stopLoopPreview();
  putIn(buf, { t, lane, kind: 'loop', name: l.name, color: l.color, loop: true });
  if (!S.project.clips.some((c) => c.kind === 'beat' || (c.kind === 'loop' && c.id !== S.sel))) S.project.bpm = l.bpm;
  toast(`${l.icon} ${l.name} is in. Drag its end to make it longer`, 2400);
}
$('#loop-add').addEventListener('click', async () => { if (loopPick) addLoop(loopPick, await loopBuf(loopPick)); });

// ---------------------------------------------------------------------------
// Beats: the drum grid
// ---------------------------------------------------------------------------
const gridEl = $('#grid');
function buildGrid() {
  gridEl.innerHTML = '';
  for (const d of DRUMS) {
    const nm = el('div', 'name', `<i></i>${d.name}`);
    nm.style.setProperty('--c', d.color);
    nm.addEventListener('pointerdown', () => drum(A.audio(), A.out(), d.id, A.ctx.currentTime + 0.01, 0.85, P.kit));
    gridEl.append(nm);
    for (let s = 0; s < 16; s++) {
      const st = el('div', 'step' + (Math.floor(s / 4) % 2 ? ' bar' : ''));
      st.dataset.drum = d.id; st.dataset.step = s;
      st.style.setProperty('--c', d.color);
      st.classList.toggle('on', !!P.grid[d.id][s]);
      gridEl.append(st);
    }
  }
}
let paint = null;   // dragging across the grid sets every square to the same
gridEl.addEventListener('pointerdown', (e) => {
  const st = e.target.closest('.step'); if (!st) return;
  e.preventDefault();
  paint = !P.grid[st.dataset.drum][st.dataset.step];
  setStep(st, paint);
});
window.addEventListener('pointermove', (e) => {
  if (paint == null) return;
  const st = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('#grid .step');
  if (st && !!P.grid[st.dataset.drum][st.dataset.step] !== paint) setStep(st, paint);
});
window.addEventListener('pointerup', () => { if (paint != null) { paint = null; savePrefs(); } });
function setStep(st, onv) {
  P.grid[st.dataset.drum][+st.dataset.step] = onv;
  st.classList.toggle('on', onv);
  if (onv && !tryState) drum(A.audio(), A.out(), st.dataset.drum, A.ctx.currentTime + 0.01, 0.85, P.kit);
  markPreset(null);
}
function markPreset(name) {
  P.preset = name;
  for (const b of $$('#beat-presets .chip')) b.classList.toggle('active', b.dataset.name === name);
}
for (const name of Object.keys(BEATS)) {
  const b = el('button', 'chip', name);
  b.dataset.name = name;
  b.addEventListener('click', () => { P.grid = gridFrom(BEATS[name]); buildGrid(); markPreset(name); savePrefs(); if (!tryState) startTry(); });
  $('#beat-presets').append(b);
}
for (const [id, name] of Object.entries(KITS)) {
  const b = el('button', '', name);
  b.dataset.kit = id;
  b.addEventListener('click', () => { P.kit = id; savePrefs(); refreshKit(); drum(A.audio(), A.out(), 'kick', A.ctx.currentTime + 0.01, 0.85, id); });
  $('#kit-seg').append(b);
}
function refreshKit() { for (const b of $$('#kit-seg button')) b.classList.toggle('active', b.dataset.kit === P.kit); }
const tempo = $('#tempo');
tempo.value = P.bpm;
const showTempo = () => { $('#tempo-val').textContent = P.bpm + ' bpm'; };
tempo.addEventListener('input', () => { P.bpm = +tempo.value; showTempo(); });
tempo.addEventListener('change', savePrefs);

// Trying the beat: played live, so changes are heard as you make them.
let tryState = null;
const stepMarks = [];
function startTry() {
  stopPreviews(); if (S.playing) stopPlay();
  const c = A.audio();
  tryState = { next: c.currentTime + 0.06, step: 0, timer: setInterval(schedTry, 25) };
  $('#beat-try').classList.add('on');
  $('#beat-try').innerHTML = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/></svg>Stop';
  schedTry();
}
function schedTry() {
  const c = A.ctx, st = tryState; if (!st) return;
  const dur = 60 / P.bpm / 4;
  while (st.next < c.currentTime + 0.12) {
    for (const d of DRUMS) if (P.grid[d.id][st.step]) drum(c, A.out(), d.id, st.next, st.step % 4 ? 0.7 : 0.9, P.kit);
    stepMarks.push({ step: st.step, at: st.next });
    st.step = (st.step + 1) % 16;
    st.next += dur;
  }
}
function stopTry() {
  if (!tryState) return;
  clearInterval(tryState.timer); tryState = null;
  stepMarks.length = 0;
  for (const s of $$('#grid .step.now')) s.classList.remove('now');
  $('#beat-try').classList.remove('on');
  $('#beat-try').innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg>Try it';
}
let shownStep = -1;
function showStep() {
  if (!tryState) return;
  const now = A.ctx.currentTime - (A.ctx.outputLatency || 0);
  let cur = null;
  while (stepMarks.length && stepMarks[0].at <= now) cur = stepMarks.shift();
  if (!cur || cur.step === shownStep) return;
  shownStep = cur.step;
  for (const s of $$('#grid .step')) s.classList.toggle('now', +s.dataset.step === cur.step);
}
$('#beat-try').addEventListener('click', () => (tryState ? stopTry() : startTry()));
$('#beat-add').addEventListener('click', async () => {
  if (!DRUMS.some((d) => P.grid[d.id].some(Boolean))) { toast('Tap some squares first'); return; }
  stopTry();
  const buf = await renderBeat(A.rate(), P.grid, P.bpm, P.kit);
  putIn(buf, { kind: 'beat', name: P.preset ? P.preset + ' beat' : 'My beat', color: '#E2A951', loop: true, dur: buf.duration * 2 });
  if (!S.project.clips.some((c) => c.kind === 'loop' || (c.kind === 'beat' && c.id !== S.sel))) S.project.bpm = P.bpm;
  toast('Your beat is in. Drag its end to make it go on', 2400);
});

// ---------------------------------------------------------------------------
// Play: the pads
// ---------------------------------------------------------------------------
for (const id of PAD_INSTRUMENTS) {
  const b = el('button', 'chip', `<span class="emo">${INSTRUMENTS[id].icon}</span>${INSTRUMENTS[id].name}`);
  b.dataset.inst = id;
  b.addEventListener('click', () => { P.inst = id; savePrefs(); refreshInst(); hitPad(PADS[0], null); });
  $('#inst-chips').append(b);
}
function refreshInst() { for (const b of $$('#inst-chips .chip')) b.classList.toggle('active', b.dataset.inst === P.inst); }
PADS.forEach((p, i) => {
  const b = el('button', 'pad', String((i + 1) % 10));
  b.style.setProperty('--c', p.color);
  p.el = b;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); hitPad(p, b); });
  $('#pads').append(b);
});
function hitPad(p, b) {
  const c = A.audio();
  INSTRUMENTS[P.inst].play(c, A.out(), c.currentTime + 0.005, p.midi, 0.35, 0.85);
  if (b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 120); }
  if (S.rec?.kind === 'tune') { S.rec.notes.push({ t: S.playhead - S.rec.start, midi: p.midi }); S.rec.hit = 1; }
}
async function recordTune() {
  if (S.rec) { stopRecording(); return; }
  if (counting) { cancelCount(); return; }
  stopPreviews(); stopTry(); if (S.playing) stopPlay();
  if (P.count && !(await countdown())) return;
  beginTake('tune');
  toast('Play the pads! Tap again to stop', 2000);
}
async function finishTune(r) {
  if (!r.notes.length) { toast('No notes played. Tap the pads while it records'); return; }
  const t0 = r.notes[0].t, notes = r.notes.map((n) => ({ ...n, t: n.t - t0 }));
  const len = notes[notes.length - 1].t + 0.5;
  const buf = await render(A.rate(), len, (c, o) => playTune(c, o, notes, P.inst, 0), { tail: 2.5 });
  putIn(buf, { t: r.start + t0, kind: 'tune', name: 'My ' + INSTRUMENTS[P.inst].name.toLowerCase() + ' tune', color: '#8E6BB8' });
  toast('Your tune is in!');
}
$('#tune-rec').addEventListener('click', recordTune);

// ---------------------------------------------------------------------------
// Silly sounds
// ---------------------------------------------------------------------------
const sfxBufs = new Map();
async function sfxBuf(s) {
  if (!sfxBufs.has(s.id)) sfxBufs.set(s.id, render(A.rate(), s.len, (c, o) => s.make(c, o, 0), { tail: 0.6 }));
  return sfxBufs.get(s.id);
}
let sfxPick = null;
for (const s of SFX) {
  const t = el('button', 'tile', `<span class="emo">${s.icon}</span>${s.name}`);
  t.style.setProperty('--c', s.color);
  draggable(t, {
    info: () => ({ len: s.len, color: s.color, label: s.icon + ' ' + s.name }),
    tap: () => {
      const c = A.audio();
      s.make(c, A.out(), c.currentTime + 0.01);
      sfxPick = s;
      for (const x of $$('#sfx-grid .tile')) x.classList.toggle('active', x === t);
      t.classList.add('hit'); setTimeout(() => t.classList.remove('hit'), 140);
      $('#sfx-add').disabled = false;
    },
    dropped: async (time, lane) => putIn(await sfxBuf(s), { t: time, lane, kind: 'sfx', name: s.name, color: s.color }),
  });
  $('#sfx-grid').append(t);
}
{
  const foot = el('div', 'tab-foot', '<span class="hint">Tap to hear. Drag onto the timeline, or tap <b>Put it in</b> for the playhead.</span><button class="go" id="sfx-add" disabled>Put it in</button>');
  $('#tab-sounds').append(foot);
  $('#sfx-add').addEventListener('click', async () => { if (sfxPick) putIn(await sfxBuf(sfxPick), { kind: 'sfx', name: sfxPick.name, color: sfxPick.color }); });
}

// ---------------------------------------------------------------------------
// Bringing sounds in
// ---------------------------------------------------------------------------
async function bringIn(files) {
  const list = [...files].filter((f) => /^audio\/|^video\/(webm|mp4)/.test(f.type) || /\.(mp3|wav|m4a|mp4|ogg|oga|aac|flac|webm|opus)$/i.test(f.name));
  if (!list.length) { toast('That isn’t a sound I know. Try an mp3 or a wav', 2400); return; }
  let t = S.playhead;
  for (const f of list) {
    toast('Bringing in ' + f.name + '…', 8000);
    try {
      const buf = await A.decodeFile(f);
      // A long song is cut to the film (drag its end to hear more of it).
      const room = S.project.length - t;
      const dur = buf.duration > room && room >= 1 ? room : buf.duration;
      const name = f.name.replace(/\.[^.]+$/, '').slice(0, 28);
      const c = putIn(buf, { t, kind: 'import', name, color: '#4F8A8B', dur });
      t = clipEnd(c);
      toast(`${name} is in`);
    } catch { toast(`Couldn’t open ${f.name}`, 2400); }
  }
}
$('#drop').addEventListener('click', () => $('#import-input').click());
$('#import-input').addEventListener('change', (e) => { bringIn(e.target.files); e.target.value = ''; });
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; document.body.classList.add('dropping'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dropping');
  if (e.dataTransfer?.files?.length) bringIn(e.dataTransfer.files);
});

// ---------------------------------------------------------------------------
// The selected clip's tools
// ---------------------------------------------------------------------------
function chop() {
  const t = S.playhead;
  const inside = (k) => t > k.start + 0.02 && t < clipEnd(k) - 0.02;
  const s = selected();
  const which = s ? (inside(s) ? [s] : []) : S.project.clips.filter(inside);
  if (!which.length) { toast(s ? 'Put the playhead over the sound to chop it there' : 'Pick a sound, then put the playhead where to chop', 2400); return; }
  let right = null;
  change(() => {
    for (const k of which) {
      const d = t - k.start, L = A.bufs.get(k.buf)?.duration || k.dur;
      const b = { ...k, id: newId(), start: t, dur: k.dur - d, offset: k.loop ? (k.offset + d) % L : k.offset + d };
      delete b.fi; k.dur = d; delete k.fo;
      if (b.src) b.src = { ...b.src };
      S.project.clips.push(b);
      right = b;
    }
  });
  if (right) { S.sel = right.id; emit('select'); }
  if (!S.playing) SFX.find((x) => x.id === 'snip').make(A.audio(), A.out(), A.ctx.currentTime + 0.01);
}
$('#ct-chop').addEventListener('click', chop);
$('#ct-loop').addEventListener('click', () => {
  const k = selected(); if (!k) return;
  const L = A.bufs.get(k.buf).duration;
  change(() => {
    const c = clipById(k.id);
    if (c.loop) { delete c.loop; if (c.offset + c.dur > L) { c.dur = Math.max(0.05, Math.min(c.dur, L - c.offset)); } }
    else { c.loop = true; delete c.src; delete c.voice; }
  });
  toast(clipById(k.id).loop ? 'Loop on: drag its end and it goes round and round' : 'Loop off', 2200);
});
$('#ct-fill').addEventListener('click', () => {
  const k = selected(); if (!k) return;
  const want = S.project.length - k.start;
  if (want <= 0.05) { toast('It’s already at the end'); return; }
  const L = A.bufs.get(k.buf).duration;
  change(() => {
    const c = clipById(k.id);
    if (!c.loop && L - c.offset < want) { c.loop = true; delete c.src; delete c.voice; }
    c.dur = c.loop ? want : Math.min(want, L - c.offset);
  });
});
$('#ct-voice').addEventListener('click', () => {
  const k = selected(); if (!k) return;
  if (k.loop) { toast('Silly voices are for sounds that don’t loop'); return; }
  const pop = $('#voice-pop');
  if (!pop.hidden) { pop.hidden = true; return; }
  closePops('#voice-pop');
  refreshSilly();
  pop.hidden = false;
  const r = $('#ct-voice').getBoundingClientRect(), pr = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(innerWidth - pr.width - 8, r.left + r.width / 2 - pr.width / 2)) + 'px';
  pop.style.top = Math.max(8, r.top - pr.height - 8) + 'px';
});
let gainBefore = null;
$('#ct-gain').addEventListener('input', (e) => {
  const k = selected(); if (!k) return;
  if (!gainBefore) gainBefore = snap();
  k.gain = +e.target.value;
  TL.redraw();
});
$('#ct-gain').addEventListener('change', () => { if (gainBefore) { commit(gainBefore); gainBefore = null; } });
function duplicate() {
  const k = selected(); if (!k) return;
  const c = { ...k, id: newId(), start: clipEnd(k) };
  if (c.src) c.src = { ...c.src };
  change(() => { c.lane = laneFor(k.kind, c.start, c.dur, k.lane); S.project.clips.push(c); });
  S.sel = c.id; emit('select');
}
$('#ct-copy').addEventListener('click', duplicate);
function del() {
  const k = selected(); if (!k) return;
  change(() => { S.project.clips = S.project.clips.filter((c) => c.id !== k.id); });
  S.sel = null; emit('select');
}
$('#ct-del').addEventListener('click', del);

function refreshClipBar() {
  const k = selected();
  $('#clip-tools').hidden = !k;
  $('#clip-hint').hidden = !!k;
  if (!k) { $('#voice-pop').hidden = true; return; }
  $('#ct-loop').classList.toggle('on', !!k.loop);
  $('#ct-voice').classList.toggle('on', !!k.voice && k.voice !== 'normal');
  $('#ct-voice').disabled = !!k.loop;
  const v = A.VOICES.find((x) => x.id === (k.voice || 'chipmunk'));
  $('#ct-voice .emo').textContent = k.voice && k.voice !== 'normal' ? v.icon : '🐿️';
  if (document.activeElement !== $('#ct-gain')) $('#ct-gain').value = k.gain ?? 1;
}
on('select', () => { refreshClipBar(); refreshSilly(); TL.redraw(); });
on('tapclip', (k) => { if (k && !S.playing) A.preview(A.bufs.get(k.buf), k.loop ? { offset: k.offset % A.bufs.get(k.buf).duration, dur: Math.min(k.dur, A.bufs.get(k.buf).duration - k.offset % A.bufs.get(k.buf).duration) } : { offset: k.offset, dur: k.dur }); });

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------
let laneHt = 50, rulerHt = 30;
on('lanes-resized', (h, r) => { laneHt = h; rulerHt = r; buildLanes(); });
function buildLanes() {
  const host = $('#lanes');
  host.innerHTML = '';
  host.style.paddingTop = rulerHt + 'px';
  for (const l of S.project.lanes) {
    const d = el('div', 'lane-head', `<span class="emo">${l.icon}</span><span class="nm">${l.name}</span>`);
    d.style.height = laneHt + 'px';
    const m = el('button', l.mute ? 'off' : '', l.mute
      ? '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>');
    m.title = l.mute ? 'Turn this lane back on' : 'Hush this lane';
    m.addEventListener('click', () => change(() => { const x = laneById(l.id); x.mute = !x.mute; if (!x.mute) delete x.mute; }));
    d.append(m);
    host.append(d);
  }
  if (S.project.lanes.length < MAX_LANES && laneHt * (S.project.lanes.length + 1) + rulerHt < host.clientHeight + laneHt * 0.6) {
    const add = el('button', '', '+ Lane');
    add.id = 'lane-add';
    add.addEventListener('click', () => { change(() => addLane()); });
    host.append(add);
  }
}

// ---------------------------------------------------------------------------
// The example
// ---------------------------------------------------------------------------
async function makeDemo() {
  stopAll();
  toast('Making an example…', 4000);
  const happy = LOOPS[0], loop = await loopBuf(happy);
  const sfx = async (id) => sfxBuf(SFX.find((s) => s.id === id));
  const p = newProject();
  const mk = (buf, o) => ({ id: newId(), offset: 0, gain: 1, buf: A.addBuf(buf), dur: buf.duration, ...o });
  p.length = 8; p.bpm = happy.bpm;
  p.clips.push(mk(loop, { lane: 'l2', start: 0, dur: 8, loop: true, kind: 'loop', name: happy.name, color: happy.color, gain: 0.7, fo: 1 }));
  for (const [id, t] of [['bubble', 0.6], ['boing', 2], ['pop', 3.2], ['magic', 4.4], ['splat', 5.6], ['tada', 6.4]]) {
    const s = SFX.find((x) => x.id === id);
    p.clips.push(mk(await sfx(id), { lane: 'l3', start: t, kind: 'sfx', name: s.name, color: s.color }));
  }
  change(() => { S.project = p; });
  S.sel = null; S.playhead = 0; S.view.t0 = 0; S.view.pps = 0;
  TL.clampView();
  toast('Press play! Then record your own voice over it', 2600);
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------
// A tapped button or slider lets go of the keys, so Space plays rather than pressing it again.
window.addEventListener('click', (e) => { const b = e.target.closest?.('button'); if (b && e.detail > 0) b.blur(); });
window.addEventListener('change', (e) => { if (e.target.type === 'range') e.target.blur(); });
window.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input[type=number], input[type=text], input[type=range]');
  if (typing && e.key !== 'Escape') return;
  const mod = e.ctrlKey || e.metaKey, k = e.key;
  if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); (e.shiftKey ? redo : undo)(); return; }
  if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
  if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); duplicate(); return; }
  if (mod && (k === 's' || k === 'S')) { e.preventDefault(); download(fileBlob(S.project), 'My sounds.ksound'); toast('Saved'); return; }
  if (mod || e.altKey) return;
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'r' || k === 'R') recordVoice();
  else if (k === 's' || k === 'S') chop();
  else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); del(); }
  else if (k === 'Home') seek(0);
  else if (k === 'End') seek(S.project.length);
  else if (k === ',' || k === 'ArrowLeft') seek(Math.max(0, Math.round(S.playhead * FPS - 1) / FPS));
  else if (k === '.' || k === 'ArrowRight') seek(Math.round(S.playhead * FPS + 1) / FPS);
  else if (k === 'l' || k === 'L') $('#tl-loop').click();
  else if (k === '+' || k === '=') TL.zoom(1.5);
  else if (k === '-' || k === '_') TL.zoom(1 / 1.5);
  else if (k === 'Escape') { closePops(); if (S.sel) { S.sel = null; emit('select'); } }
  else if (/^[0-9]$/.test(k)) { const i = (+k + 9) % 10; hitPad(PADS[i], PADS[i].el); }
});

function stopPreviews() { A.stopPreview(); stopLoopPreview(); stopTry(); }

// ---------------------------------------------------------------------------
// Every frame
// ---------------------------------------------------------------------------
let needFilm = true, lastHead = -1, lastTimeTxt = '';
function levelAt(t) {
  const lv = { voice: 0, music: 0, sfx: 0 };
  for (const k of S.project.clips) {
    if (t < k.start || t >= clipEnd(k)) continue;
    const lane = laneById(k.lane); if (lane?.mute) continue;
    const buf = A.bufs.get(k.buf), pk = A.peaks.get(k.buf); if (!buf || !pk) continue;
    let pos = k.offset + (t - k.start);
    if (k.loop) pos %= buf.duration;
    const i = Math.floor(pos * buf.sampleRate / A.PEAK_BLOCK);
    let m = 0;
    for (let j = Math.max(0, i - 6); j < Math.min(pk.length, i + 6); j++) m = Math.max(m, pk[j]);
    m *= k.gain ?? 1;
    const key = k.kind === 'voice' ? 'voice' : k.kind === 'sfx' ? 'sfx' : 'music';
    lv[key] = Math.max(lv[key], m);
  }
  return lv;
}
function frame() {
  requestAnimationFrame(frame);
  const c = A.ctx;
  if (S.rec && c) {
    const heard = c.currentTime - (c.outputLatency || 0);
    S.playhead = S.rec.start + Math.max(0, heard - S.rec.when);
    S.rec.len = S.playhead - S.rec.start;
    if (S.rec.kind === 'tune') { S.rec.peaks.push(S.rec.hit); S.rec.hit *= 0.85; }
    TL.follow();
    if (S.rec.len > 120) { toast('Two minutes is plenty! Stopped'); stopRecording(); }
  } else if (S.playing) {
    // Round and round: the next time through is lined up just before the end, so there's no gap.
    if (S.loop && A.playTime() > S.project.length - 0.3) A.queueLoop(S.project, S.project.length);
    const t = A.playTime();
    if (t != null && t >= S.project.length && !S.loop) stopPlay(true);
    else if (t != null) S.playhead = Math.min(t, S.project.length);
    TL.follow();
  }
  if (S.playhead !== lastHead || S.playing || S.rec) { needFilm = true; lastHead = S.playhead; }
  TL.draw();
  if (needFilm) {
    const lv = levelAt(S.playhead);
    if (S.rec?.kind === 'voice') lv.voice = Math.max(lv.voice, A.mic.level * 1.5);
    drawFilm(S.playhead, lv, S.project.length);
    needFilm = S.playing || !!S.rec;
  }
  const txt = `${S.playhead.toFixed(2)} s<small>frame ${frameOf(S.playhead)}</small>`;
  if (txt !== lastTimeTxt) { $('#tl-time').innerHTML = txt; lastTimeTxt = txt; }
  if (S.rec?.kind === 'voice') $('#rec-big').style.setProperty('--lvl', Math.min(1, A.mic.level * 2.5).toFixed(3));
  showStep();
}

// ---------------------------------------------------------------------------
// Saving as you go
// ---------------------------------------------------------------------------
let saveTimer = 0;
on('change', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveLocal(S.project), 700);
  refreshBar(); refreshClipBar(); refreshSilly(); buildLanes();
  TL.clampView(); TL.redraw(); needFilm = true;
});
on('editing', () => { needFilm = true; });

// ---------------------------------------------------------------------------
// Off we go
// ---------------------------------------------------------------------------
async function start() {
  setLook(P.soft);
  setTab(P.tab);
  buildGrid(); markPreset(P.preset); refreshKit(); showTempo(); refreshInst();
  initViewer();
  TL.initTimeline();
  const saved = await loadLocal(A.addBuf);
  if (saved) {
    S.project = saved;
    takes = saved.clips.filter((c) => c.kind === 'voice').length;
    resetHistory();
  }
  fitLength();
  buildLanes(); refreshBar(); refreshClipBar(); refreshSilly(); refreshTransport();
  TL.redraw();
  requestAnimationFrame(frame);
  // Free the microphone when the tab is hidden, so the ChB's light goes off.
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (S.rec) stopRecording(); stopPlay(); stopPreviews(); A.mic.close(); } });
}
start();
