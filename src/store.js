// Keeping the Sound room's work: autosaved in the browser (IndexedDB, as the
// sounds are too big for localStorage), and saved to or opened from a file.
//
// A file (.ksound) is: "KSND", a version byte, the length of a JSON header
// (4 bytes), the header, then each sound as 16-bit samples, one after another.
// The header is the project plus, for each sound, its id, rate and length.
// In Krafty itself the same header and sounds would ride along in a .krafty.

import { bufs, monoBuffer } from './audio.js';

const DB = 'krafty-sound', VER = 1;
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { r.result.createObjectStore('bufs'); r.result.createObjectStore('meta'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (store, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store), out = fn(s);
    t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => rej(t.error);
  });
};

const savedBufs = new Set();
// Saves the project, and any sound it uses that isn't saved yet.
export async function saveLocal(project) {
  try {
    const used = usedBufs(project);
    const d = await db();
    await new Promise((res, rej) => {
      const t = d.transaction(['bufs', 'meta'], 'readwrite');
      const bs = t.objectStore('bufs');
      for (const id of used) {
        if (savedBufs.has(id)) continue;
        const b = bufs.get(id); if (!b) continue;
        bs.put({ sr: b.sampleRate, data: b.getChannelData(0) }, id);
        savedBufs.add(id);
      }
      t.objectStore('meta').put(project, 'project');
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  } catch (e) { console.warn('Autosave failed', e); }
}
// The last project, with its sounds put back in `bufs`. Sounds nothing uses
// any more are cleared out.
export async function loadLocal(addBuf) {
  try {
    const project = await tx('meta', 'readonly', (s) => s.get('project'));
    if (!project) return null;
    const used = usedBufs(project);
    const keys = await tx('bufs', 'readonly', (s) => s.getAllKeys());
    for (const id of keys) {
      if (!used.has(id)) { await tx('bufs', 'readwrite', (s) => s.delete(id)); continue; }
      const rec = await tx('bufs', 'readonly', (s) => s.get(id));
      if (rec) { addBuf(monoBuffer(rec.data, rec.sr), id); savedBufs.add(id); }
    }
    project.clips = project.clips.filter((c) => bufs.has(c.buf));
    return project;
  } catch (e) { console.warn('Could not load the last sounds', e); return null; }
}
export function usedBufs(project) {
  const s = new Set();
  for (const c of project.clips) { s.add(c.buf); if (c.src?.buf) s.add(c.src.buf); }
  return s;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
export function fileBlob(project) {
  const ids = [...usedBufs(project)].filter((id) => bufs.has(id));
  const sounds = ids.map((id) => ({ id, sr: bufs.get(id).sampleRate, n: bufs.get(id).length }));
  const head = new TextEncoder().encode(JSON.stringify({ app: 'krafty-sound', v: 1, project, sounds }));
  const parts = [new TextEncoder().encode('KSND'), new Uint8Array([1])];
  const len = new DataView(new ArrayBuffer(4)); len.setUint32(0, head.length, true);
  parts.push(new Uint8Array(len.buffer), head);
  for (const id of ids) {
    const d = bufs.get(id).getChannelData(0), pcm = new Int16Array(d.length);
    for (let i = 0; i < d.length; i++) pcm[i] = Math.max(-1, Math.min(1, d[i])) * 0x7fff;
    parts.push(new Uint8Array(pcm.buffer));
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}
export async function openFile(file, addBuf) {
  const ab = await file.arrayBuffer(), u8 = new Uint8Array(ab);
  if (String.fromCharCode(...u8.subarray(0, 4)) !== 'KSND') throw new Error('notksound');
  const hl = new DataView(ab, 5, 4).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(u8.subarray(9, 9 + hl)));
  let o = 9 + hl;
  const rename = new Map();
  for (const s of head.sounds) {
    const pcm = new Int16Array(ab.slice(o, o + s.n * 2)); o += s.n * 2;
    const f = new Float32Array(s.n);
    for (let i = 0; i < s.n; i++) f[i] = pcm[i] / 0x7fff;
    rename.set(s.id, addBuf(monoBuffer(f, s.sr)));
  }
  const p = head.project;
  for (const c of p.clips) { c.buf = rename.get(c.buf); if (c.src) c.src.buf = rename.get(c.src.buf); }
  p.clips = p.clips.filter((c) => c.buf);
  return p;
}
export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
