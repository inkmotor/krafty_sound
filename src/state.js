// The Sound room's state, its undo, and a little "something changed" bus.
//
//   project = { length (s), bpm, lanes: [lane], clips: [clip] }
//   lane    = { id, name, mute? }
//   clip    = { id, lane, start, offset, dur, buf, gain, loop?, fi?, fo?,
//               kind, name, color, voice?, src? }
//     start   where it begins on the timeline, in seconds
//     offset  where in its sound it begins (a looping clip: where in the loop)
//     dur     how long it plays for (a looping clip can be longer than its sound)
//     fi, fo  fade in and out, seconds
//     kind    voice | loop | beat | tune | sfx | import
//     voice   the voice effect it has on; src = { buf, offset, dur }, the part
//             of the plain recording it was made from, so another voice (or
//             "Me") starts again from that
//
// Krafty's frames are 24 a second (src/anim.js FPS), and the room counts in
// them too, so a sound lands on the same frame as the card it goes with.

export const FPS = 24;
export const MAX_LANES = 6;

export const newProject = () => ({
  length: 8, bpm: 110,
  lanes: [
    { id: 'l1', name: 'Voice' },
    { id: 'l2', name: 'Music' },
    { id: 'l3', name: 'FX' },
    { id: 'l4', name: 'Track 4' },
  ],
  clips: [],
});

export const S = {
  project: newProject(),
  sel: null,             // the selected clip's id
  playhead: 0,           // seconds
  playing: false,
  playFrom: 0,           // where play began: it goes back there when it stops
  rec: null,             // a take under way: { kind, lane, start, peaks, len }
  view: { t0: 0, pps: 0 },   // the timeline's left edge (s) and zoom (pixels a second; 0 = fit)
  snap: false,           // snap to the beat
  loop: true,            // play round and round, as Krafty's timeline does
};

const listeners = new Map();
export function on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); }
export function emit(ev, ...a) { for (const fn of listeners.get(ev) || []) fn(...a); }

export const clipById = (id) => S.project.clips.find((c) => c.id === id);
export const laneById = (id) => S.project.lanes.find((l) => l.id === id);
export const selected = () => clipById(S.sel);
export const clipEnd = (c) => c.start + c.dur;
export const frameOf = (t) => Math.round(t * FPS);
let n = 1;
export const newId = (p = 'c') => p + Date.now().toString(36) + (n++).toString(36);

// ---------------------------------------------------------------------------
// Undo: whole snapshots of the project. Sounds themselves never change (a new
// one is made instead), so a snapshot is only a few numbers per clip.
// ---------------------------------------------------------------------------
const undos = [], redos = [];
export const snap = () => JSON.parse(JSON.stringify(S.project));
// Call with a snapshot taken before a change, once the change is made.
export function commit(before) {
  if (JSON.stringify(before) === JSON.stringify(S.project)) return;
  undos.push(before);
  if (undos.length > 120) undos.shift();
  redos.length = 0;
  changed();
}
// Make a change in one go: run fn, and remember how it was.
export function change(fn) {
  const before = snap();
  fn();
  fitLength();
  commit(before);
}
export function undo() {
  if (!undos.length) return false;
  redos.push(snap());
  S.project = undos.pop();
  if (!clipById(S.sel)) S.sel = null;
  changed();
  return true;
}
export function redo() {
  if (!redos.length) return false;
  undos.push(snap());
  S.project = redos.pop();
  if (!clipById(S.sel)) S.sel = null;
  changed();
  return true;
}
export const canUndo = () => undos.length > 0;
export const canRedo = () => redos.length > 0;
export function resetHistory() { undos.length = 0; redos.length = 0; }
export function changed() { emit('change'); }

// The film grows to fit what's on it (in whole seconds).
// Projects saved before the tracks had plain names.
const OLD_NAMES = { Voices: 'Voice', Sounds: 'FX', More: 'Track 4', Extra: 'Track 5', 'Even more': 'Track 6', Loads: 'Track 6' };
export function tidyNames(p) {
  for (const l of p.lanes) { if (OLD_NAMES[l.name]) l.name = OLD_NAMES[l.name]; delete l.icon; }
  return p;
}

export function fitLength() {
  const p = S.project;
  const end = p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  if (end > p.length) p.length = Math.min(600, Math.ceil(end - 1e-6));
}

// Which lane a new sound goes on: the one it likes (by kind) if it's free
// there, else any free lane, else a new lane (up to MAX_LANES), else its own.
const LIKES = { voice: 0, loop: 1, beat: 1, tune: 1, import: 1, sfx: 2 };
export function laneFor(kind, start, dur, prefer) {
  const lanes = S.project.lanes;
  const free = (l) => !S.project.clips.some((c) => c.lane === l.id && c.start < start + dur - 1e-6 && clipEnd(c) > start + 1e-6);
  const want = prefer ? laneById(prefer) : lanes[Math.min(LIKES[kind] ?? 3, lanes.length - 1)];
  if (want && free(want)) return want.id;
  const order = [...lanes.slice(lanes.indexOf(want) + 1), ...lanes.slice(0, lanes.indexOf(want))];
  const any = order.find(free);
  if (any) return any.id;
  if (lanes.length < MAX_LANES) return addLane().id;
  return (want || lanes[0]).id;
}
export function addLane() {
  const lanes = S.project.lanes;
  const l = { id: newId('l'), name: 'Track ' + (lanes.length + 1) };
  lanes.push(l);
  return l;
}
