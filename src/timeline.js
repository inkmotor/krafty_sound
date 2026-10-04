// The timeline: lanes of sounds under a ruler, drawn on a canvas.
//
// Tap empty space (or the ruler) to put the playhead there, and drag to scrub.
// Tap a sound to pick it; drag it to move it (along, and to another lane);
// drag its ends to trim it, and its top corners to fade it in and out. Pinch,
// Ctrl + wheel or the zoom keys zoom; a plain wheel or a two-finger drag on a
// ChB touchpad slides along. Everything snaps to Krafty's frames (24 a
// second); with the magnet on, to the beat too, and always gently to the
// playhead, the start and other sounds' ends.

import { S, FPS, emit, clipById, laneById, clipEnd, snap as snapshot, commit, fitLength, frameOf, addLane, MAX_LANES, changed } from './state.js';
import { bufs, peaks, PEAK_BLOCK } from './audio.js';

const RULER = 30, PADL = 14, EDGE_MIN = 9, EDGE_MAX = 16, MIN_DUR = 0.05;
let cv, g, wrap, W = 0, H = 0, dpr = 1;
let staticCv, sg;                 // everything but the playhead, redrawn only when something changes
let dirty = true, drop = null;    // drop: a sound being dragged in, { t, lane, len, color }

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
let C = {};
function readColours() {
  C = { lane: css('--lane'), lane2: css('--lane-2'), rule: css('--rule'), ink: css('--ink'), faint: css('--faint'), muted: css('--muted'),
    surface: css('--surface'), play: css('--play'), rec: css('--rec'), field: css('--field'), gold: css('--gold'), soft: document.documentElement.classList.contains('soft') };
}

export const pps = () => S.view.pps || fitPps();
const fitPps = () => Math.max(8, (W - PADL - 24) / Math.max(1, S.project.length));
export const xOf = (t) => PADL + (t - S.view.t0) * pps();
export const tOf = (x) => S.view.t0 + (x - PADL) / pps();
export function laneH() { return Math.max(30, Math.min(84, (H - RULER) / Math.max(1, S.project.lanes.length))); }
const laneAt = (y) => { const i = Math.floor((y - RULER) / laneH()); return S.project.lanes[Math.max(0, Math.min(S.project.lanes.length - 1, i))]; };
const laneY = (id) => RULER + S.project.lanes.findIndex((l) => l.id === id) * laneH();

export function initTimeline() {
  cv = document.getElementById('tl'); wrap = document.getElementById('tl-wrap');
  g = cv.getContext('2d');
  staticCv = document.createElement('canvas'); sg = staticCv.getContext('2d');
  new ResizeObserver(resize).observe(wrap);
  cv.addEventListener('pointerdown', down);
  cv.addEventListener('pointermove', hover);
  cv.addEventListener('wheel', wheel, { passive: false });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  readColours();
  resize();
}
function resize() {
  const r = wrap.getBoundingClientRect();
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(1, r.width); H = Math.max(1, r.height);
  for (const c of [cv, staticCv]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  clampView();
  dirty = true;
  emit('lanes-resized', laneH(), RULER);
}
export function redraw() { dirty = true; }
export function recolour() { readColours(); dirty = true; }

export function clampView() {
  const v = S.view, span = (W - PADL - 24) / pps();
  const maxT0 = Math.max(0, S.project.length + 1 - span);
  v.t0 = Math.max(0, Math.min(v.t0, maxT0));
  if (v.pps && v.pps <= fitPps() + 0.01) v.pps = 0;   // zoomed right out: fit it
}
export function zoom(by, atX = W / 2) {
  const t = tOf(atX), p = Math.max(fitPps(), Math.min(1600, pps() * by));
  S.view.pps = p;
  S.view.t0 = t - (atX - PADL) / p;
  clampView(); dirty = true;
}
// Keep the playhead in sight while playing.
export function follow() {
  const x = xOf(S.playhead);
  if (x > W - 30 || x < PADL) { S.view.t0 = Math.max(0, S.playhead - 30 / pps()); clampView(); dirty = true; }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
export function draw() {
  if (dirty) { drawStatic(); dirty = false; }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(staticCv, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (S.rec) drawRec(g);
  drawPlayhead(g);
}

function rr(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function drawStatic() {
  const c = sg, p = S.project, lh = laneH(), P = pps();
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  // Lanes
  p.lanes.forEach((l, i) => {
    c.fillStyle = i % 2 ? C.lane2 : C.lane;
    c.fillRect(0, RULER + i * lh, W, lh);
    c.fillStyle = C.rule; c.fillRect(0, RULER + (i + 1) * lh - 1, W, 1);
  });
  // Beyond the end of the film: dimmed
  const xe = xOf(p.length);
  if (xe < W) { c.fillStyle = C.soft ? 'rgba(0,0,0,.22)' : 'rgba(60,45,20,.08)'; c.fillRect(xe, RULER, W - xe, H - RULER); }
  // Grid: beats when snapping, else seconds
  const t0 = Math.max(0, tOf(0)), t1 = tOf(W);
  if (S.snap) {
    const beat = 60 / p.bpm;
    for (let b = Math.ceil(t0 / beat); b * beat <= t1; b++) {
      c.fillStyle = b % 4 ? (C.soft ? 'rgba(255,255,255,.035)' : 'rgba(60,45,20,.05)') : (C.soft ? 'rgba(255,255,255,.08)' : 'rgba(60,45,20,.1)');
      c.fillRect(Math.round(xOf(b * beat)), RULER, 1, H - RULER);
    }
  } else {
    for (let s = Math.ceil(t0); s <= t1; s++) { c.fillStyle = C.soft ? 'rgba(255,255,255,.05)' : 'rgba(60,45,20,.07)'; c.fillRect(Math.round(xOf(s)), RULER, 1, H - RULER); }
  }
  // Ruler: frames, quarter seconds, seconds
  c.fillStyle = C.surface; c.fillRect(0, 0, W, RULER);
  c.fillStyle = C.rule; c.fillRect(0, RULER - 1, W, 1);
  const every = P < 30 ? 5 : P < 60 ? 2 : 1;
  c.font = '600 11px ' + css('--font-display'); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  if (P / FPS >= 5) for (let f = Math.ceil(t0 * FPS); f / FPS <= t1; f++) { if (f % FPS) { c.fillStyle = C.rule; c.fillRect(Math.round(xOf(f / FPS)), RULER - 5, 1, 4); } }
  for (let q = Math.ceil(t0 * 4); q / 4 <= t1; q++) {
    const x = Math.round(xOf(q / 4)), sec = q % 4 === 0;
    if (!sec && P < 40) continue;
    c.fillStyle = sec ? C.faint : C.rule;
    c.fillRect(x, RULER - (sec ? 9 : 6), 1, sec ? 8 : 5);
    if (sec && (q / 4) % every === 0) { c.fillStyle = C.muted; c.fillText(q / 4 + 's', x, 15); }
  }
  // The end of the film
  if (xe < W) { c.fillStyle = C.faint; c.fillRect(Math.round(xe), 0, 2, H); const right = xe + 30 > W; c.textAlign = right ? 'right' : 'left'; c.fillText('end', Math.round(xe) + (right ? -5 : 5), 26); }
  // Clips: the selected one last, on top
  const sel = clipById(S.sel);
  for (const k of p.clips) if (k !== sel) drawClip(c, k, false);
  if (sel) drawClip(c, sel, true);
  if (drop) drawDrop(c);
}

function drawClip(c, k, isSel) {
  const lh = laneH(), y = laneY(k.lane) + 3, h = lh - 7, x = xOf(k.start), w = Math.max(3, k.dur * pps());
  if (x > W || x + w < 0 || y < 0) return;
  const lane = laneById(k.lane), muted = lane?.mute || (S.project.lanes.some((l) => l.solo) && !lane?.solo);
  c.save();
  c.globalAlpha = muted ? 0.35 : 1;
  rr(c, x, y, w, h, 7);
  c.fillStyle = k.color; c.fill();
  c.clip();
  // The wave
  drawWave(c, k, x, y + 14, w, h - 16);
  // Loop seams
  const buf = bufs.get(k.buf);
  if (k.loop && buf) {
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.setLineDash([3, 3]); c.lineWidth = 1;
    const L = buf.duration;
    for (let s = L - (k.offset % L); s < k.dur; s += L) { const sx = Math.round(x + s * pps()) + 0.5; c.beginPath(); c.moveTo(sx, y); c.lineTo(sx, y + h); c.stroke(); }
    c.setLineDash([]);
  }
  // Fades: a shaded wedge
  c.fillStyle = 'rgba(0,0,0,.22)';
  if (k.fi > 0) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + k.fi * pps(), y); c.lineTo(x, y + h); c.fill(); }
  if (k.fo > 0) { c.beginPath(); c.moveTo(x + w, y); c.lineTo(x + w - k.fo * pps(), y); c.lineTo(x + w, y + h); c.fill(); }
  // Name
  c.font = '600 11.5px ' + css('--font-display'); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.fillStyle = 'rgba(255,255,255,.95)'; c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 2;
  const label = (k.loop ? '↻ ' : '') + k.name + (k.voice && k.voice !== 'normal' ? ' · ' + k.voice : '');
  if (w > 26) c.fillText(label, x + 7, y + 13);
  c.restore();
  if (isSel) {
    c.save();
    rr(c, x - 1, y - 1, w + 2, h + 2, 8);
    c.lineWidth = 2.5; c.strokeStyle = C.ink; c.stroke();
    // Trim handles at the ends, fade dots at the top corners
    c.fillStyle = C.ink;
    rr(c, x + 2, y + h / 2 - 9, 4, 18, 2); c.fill();
    rr(c, x + w - 6, y + h / 2 - 9, 4, 18, 2); c.fill();
    for (const fx of [x + (k.fi || 0) * pps(), x + w - (k.fo || 0) * pps()]) {
      c.beginPath(); c.arc(Math.max(x + 6, Math.min(x + w - 6, fx)), y + 1, 5, 0, Math.PI * 2);
      c.fillStyle = '#fff'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = C.ink; c.stroke();
    }
    c.restore();
  }
}

// The wave of a clip, from its sound's peaks, mirrored about the middle.
function drawWave(c, k, x, y, w, h) {
  const pk = peaks.get(k.buf), buf = bufs.get(k.buf);
  if (!pk || !buf || h < 4) return;
  const per = buf.sampleRate / PEAK_BLOCK, P = pps(), mid = y + h / 2, L = buf.duration;
  const x0 = Math.max(Math.floor(x), 0), x1 = Math.min(Math.ceil(x + w), W);
  c.fillStyle = 'rgba(255,255,255,.42)';
  c.beginPath();
  for (let px = x0; px < x1; px += 1) {
    let a = k.offset + (px - x) / P, b = k.offset + (px + 1 - x) / P;
    if (k.loop) { a %= L; b = a + 1 / P; }
    let m = 0;
    const i0 = Math.floor(a * per), i1 = Math.max(i0 + 1, Math.ceil(b * per));
    for (let i = i0; i < i1 && i < pk.length; i++) if (pk[i] > m) m = pk[i];
    const v = Math.min(1, m * (k.gain ?? 1)) * h / 2;
    if (v > 0.3) c.rect(px, mid - v, 1, v * 2);
  }
  c.fill();
}

function drawRec(c) {
  const r = S.rec, lh = laneH(), y = laneY(r.lane) + 3, h = lh - 7, x = xOf(r.start), w = Math.max(3, r.len * pps());
  c.save();
  rr(c, x, y, w, h, 7);
  c.fillStyle = C.rec; c.globalAlpha = 0.9; c.fill(); c.clip();
  c.globalAlpha = 1;
  c.fillStyle = 'rgba(255,255,255,.5)';
  const mid = y + 8 + (h - 8) / 2, n = r.peaks.length;
  if (n) for (let px = 0; px < w; px++) {
    const v = r.peaks[Math.min(n - 1, Math.floor(px / w * n))] * (h - 10) / 2;
    c.fillRect(x + px, mid - v, 1, v * 2);
  }
  c.font = '600 11.5px ' + css('--font-display'); c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.fillText(r.kind === 'tune' ? '● Recording a tune…' : '● Recording…', x + 7, y + 13);
  c.restore();
}

function drawDrop(c) {
  const lh = laneH(), y = laneY(drop.lane) + 3, h = lh - 7, x = xOf(drop.t), w = Math.max(6, drop.len * pps());
  c.save();
  rr(c, x, y, w, h, 7);
  c.globalAlpha = 0.55; c.fillStyle = drop.color; c.fill();
  c.globalAlpha = 1; c.setLineDash([5, 4]); c.lineWidth = 2; c.strokeStyle = C.ink; c.stroke();
  c.restore();
}

function drawPlayhead(c) {
  const x = Math.round(xOf(S.playhead)) + 0.5;
  if (x < -40 || x > W + 40) return;
  c.fillStyle = C.play;
  c.fillRect(x - 1, RULER - 2, 2, H - RULER + 2);
  const label = String(frameOf(S.playhead));
  c.font = '700 12px ' + css('--font-display');
  const tw = Math.max(22, c.measureText(label).width + 14);
  rr(c, x - tw / 2, 3, tw, 21, 6); c.fill();
  c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(label, x, 14);
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------
function snapT(t, skip, extra = []) {
  const near = 9 / pps();
  let best = null, bd = near;
  const cands = [0, S.playhead, S.project.length, ...extra];
  for (const k of S.project.clips) if (k.id !== skip) cands.push(k.start, clipEnd(k));
  for (const v of cands) { const d = Math.abs(v - t); if (d < bd) { bd = d; best = v; } }
  if (best != null) return best;
  if (S.snap) { const beat = 60 / S.project.bpm / 2; return Math.round(t / beat) * beat; }
  return Math.round(t * FPS) / FPS;
}

// ---------------------------------------------------------------------------
// Pointer
// ---------------------------------------------------------------------------
const touches = new Map();
let drag = null;

function local(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function hitClip(x, y) {
  const lh = laneH();
  const order = [...S.project.clips].reverse();
  const sel = clipById(S.sel);
  if (sel) order.unshift(sel);
  for (const k of order) {
    const cx = xOf(k.start), cw = Math.max(3, k.dur * pps()), cy = laneY(k.lane) + 3, ch = lh - 7;
    if (x >= cx - 4 && x <= cx + cw + 4 && y >= cy - 6 && y <= cy + ch) {
      const edge = Math.max(EDGE_MIN, Math.min(EDGE_MAX, cw / 4));
      let part = 'move';
      if (k === sel) {
        const fiX = Math.max(cx + 6, Math.min(cx + cw - 6, cx + (k.fi || 0) * pps()));
        const foX = Math.max(cx + 6, Math.min(cx + cw - 6, cx + cw - (k.fo || 0) * pps()));
        if (Math.hypot(x - fiX, y - (cy + 1)) < 11) part = 'fi';
        else if (Math.hypot(x - foX, y - (cy + 1)) < 11) part = 'fo';
      }
      if (part === 'move') {
        if (x < cx + edge) part = 'left';
        else if (x > cx + cw - edge) part = 'right';
      }
      return { clip: k, part };
    }
  }
  return null;
}

function hover(e) {
  if (drag || e.pointerType !== 'mouse') return;
  const { x, y } = local(e);
  if (y < RULER) { cv.style.cursor = 'text'; return; }
  const h = hitClip(x, y);
  cv.style.cursor = !h ? 'default' : h.part === 'left' || h.part === 'right' ? 'ew-resize' : h.part === 'move' ? 'grab' : 'pointer';
}

function down(e) {
  cv.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, local(e));
  if (touches.size === 2) {     // a pinch: zoom and slide
    if (drag?.before) { S.project = drag.before; changed(); }
    const [a, b] = [...touches.values()];
    drag = { kind: 'pinch', d0: Math.abs(a.x - b.x) || 1, mid: (a.x + b.x) / 2, pps0: pps(), t: tOf((a.x + b.x) / 2) };
    return;
  }
  if (e.button === 1 || e.button === 2) { drag = { kind: 'pan', x0: local(e).x, t0: S.view.t0 }; return; }
  const { x, y } = local(e);
  const h = y >= RULER ? hitClip(x, y) : null;
  if (h) {
    const k = h.clip;
    if (S.sel !== k.id) { S.sel = k.id; emit('select'); dirty = true; }
    drag = { kind: h.part, id: k.id, x0: x, y0: y, orig: { ...k }, before: snapshot(), moved: false };
  } else {
    if (S.sel && y >= RULER) { S.sel = null; emit('select'); dirty = true; }
    drag = { kind: 'scrub' };
    emit('seek', Math.max(0, Math.round(tOf(x) * FPS) / FPS));
  }
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
}

function move(e) {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, local(e));
  if (!drag) return;
  const { x, y } = local(e);
  if (drag.kind === 'pinch') {
    if (touches.size < 2) return;
    const [a, b] = [...touches.values()];
    const d = Math.abs(a.x - b.x) || 1, mid = (a.x + b.x) / 2;
    S.view.pps = Math.max(fitPps(), Math.min(1600, drag.pps0 * d / drag.d0));
    S.view.t0 = drag.t - (mid - PADL) / pps();
    clampView(); dirty = true;
    return;
  }
  if (drag.kind === 'pan') { S.view.t0 = drag.t0 - (x - drag.x0) / pps(); clampView(); dirty = true; return; }
  if (drag.kind === 'scrub') { emit('seek', Math.max(0, Math.round(tOf(x) * FPS) / FPS)); return; }
  const k = clipById(drag.id); if (!k) return;
  if (!drag.moved && Math.hypot(x - drag.x0, y - drag.y0) < 5) return;
  drag.moved = true;
  const o = drag.orig, dt = (x - drag.x0) / pps(), buf = bufs.get(k.buf), L = buf ? buf.duration : o.dur;
  if (drag.kind === 'move') {
    let s = Math.max(0, o.start + dt);
    const a = snapT(s, k.id), b = snapT(s + o.dur, k.id) - o.dur;
    s = Math.abs(a - s) <= Math.abs(b - s) ? a : b;
    k.start = Math.max(0, s);
    k.lane = laneAt(y).id;
  } else if (drag.kind === 'left') {
    let s = snapT(o.start + dt, k.id);
    s = Math.min(s, o.start + o.dur - MIN_DUR);
    if (!o.loop) s = Math.max(s, o.start - o.offset);
    s = Math.max(0, s);
    const d = s - o.start;
    k.start = s; k.dur = o.dur - d;
    k.offset = o.loop ? (((o.offset + d) % L) + L) % L : o.offset + d;
    k.fi = Math.min(o.fi || 0, k.dur); if (!k.fi) delete k.fi;
  } else if (drag.kind === 'right') {
    let e2 = snapT(o.start + o.dur + dt, k.id);
    e2 = Math.max(e2, o.start + MIN_DUR);
    if (!o.loop) e2 = Math.min(e2, o.start + (L - o.offset));
    k.dur = e2 - o.start;
    k.fo = Math.min(o.fo || 0, k.dur); if (!k.fo) delete k.fo;
  } else if (drag.kind === 'fi') {
    k.fi = Math.max(0, Math.min(k.dur - (k.fo || 0), (o.fi || 0) + dt));
    if (k.fi < 0.01) delete k.fi;
  } else if (drag.kind === 'fo') {
    k.fo = Math.max(0, Math.min(k.dur - (k.fi || 0), (o.fo || 0) - dt));
    if (k.fo < 0.01) delete k.fo;
  }
  dirty = true;
  emit('editing');
}

function up(e) {
  touches.delete(e.pointerId);
  if (touches.size) return;
  cv.removeEventListener('pointermove', move);
  cv.removeEventListener('pointerup', up);
  cv.removeEventListener('pointercancel', up);
  const d = drag; drag = null;
  if (!d) return;
  if (d.before && d.moved) { fitLength(); commit(d.before); }
  else if (d.before && !d.moved && d.kind === 'move') emit('tapclip', clipById(d.id));
  dirty = true;
}

function wheel(e) {
  e.preventDefault();
  const { x } = local(e);
  if (e.ctrlKey || e.metaKey) zoom(Math.exp(-e.deltaY * 0.01), x);
  else { S.view.t0 += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / pps(); clampView(); dirty = true; }
}

// ---------------------------------------------------------------------------
// Dragging a sound in from the sound box
// ---------------------------------------------------------------------------
export function dropAt(clientX, clientY, len, color) {
  const r = cv.getBoundingClientRect();
  const x = clientX - r.left, y = clientY - r.top;
  if (x < 0 || y < RULER - 10 || x > r.width || y > r.height) { if (drop) { drop = null; dirty = true; } return null; }
  const t = snapT(Math.max(0, tOf(x) - Math.min(len, 0.25)), null);
  drop = { t: Math.max(0, t), lane: laneAt(Math.max(RULER, y)).id, len, color };
  dirty = true;
  return drop;
}
export function endDrop() { const d = drop; drop = null; dirty = true; return d; }

export function addLaneIfRoom() {
  if (S.project.lanes.length >= MAX_LANES) return false;
  const before = snapshot(); addLane(); commit(before);
  return true;
}
