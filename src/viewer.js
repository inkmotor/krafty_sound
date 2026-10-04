// The film. In Krafty this is the room's small viewer, playing your own box
// at the playhead. Standing in for it here: a paper fish in a paper box, so
// you can see sound and picture line up. It swims along with the playhead,
// its mouth opens with the voices (a first taste of lip-sync), it bobs to
// the music, and blows bubbles at the silly sounds.

let cv, g, W = 0, H = 0, dpr = 1;
const bubbles = [];
let lastSfx = 0, lastT = 0;

export function initViewer() {
  cv = document.getElementById('film');
  g = cv.getContext('2d');
  new ResizeObserver(() => {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }).observe(cv);
}

// Card: a filled shape with a soft shadow under it, as Krafty's cards.
function card(fill, path, lift = 6) {
  g.save();
  g.shadowColor = 'rgba(60, 40, 15, .32)'; g.shadowBlur = lift * 1.6; g.shadowOffsetX = lift * 0.5; g.shadowOffsetY = lift * 0.8;
  g.fillStyle = fill; path(); g.fill();
  g.restore();
}

export function drawFilm(t, lv, length) {
  if (!W) return false;   // not laid out yet: try again next frame
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = Math.min(W / 560, H / 330);
  // The stage: warm paper, lit from above, as Krafty's box.
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#F4E8D6'); bg.addColorStop(0.55, '#EED8BA'); bg.addColorStop(1, '#E6C9A2');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // The box's back wall and floor, faintly.
  g.strokeStyle = 'rgba(140, 150, 170, .55)'; g.lineWidth = 1.5;
  const inset = 0.14;
  g.beginPath();
  g.rect(W * inset, H * 0.1, W * (1 - 2 * inset), H * 0.62);
  g.moveTo(W * inset, H * 0.72); g.lineTo(W * 0.02, H * 0.96);
  g.moveTo(W * (1 - inset), H * 0.72); g.lineTo(W * 0.98, H * 0.96);
  g.moveTo(W * inset, H * 0.1); g.lineTo(W * 0.02, H * 0.02);
  g.moveTo(W * (1 - inset), H * 0.1); g.lineTo(W * 0.98, H * 0.02);
  g.stroke();
  // The sea: a pale blue card at the back.
  card('#BFD6D2', () => { g.beginPath(); g.rect(W * inset + 6, H * 0.1 + 6, W * (1 - 2 * inset) - 12, H * 0.62 - 12); }, 3);
  // Waving weed, swaying with time.
  const weed = (x0, hgt, col, ph) => card(col, () => {
    g.beginPath();
    const base = H * 0.86, sway = Math.sin(t * 1.6 + ph) * 12 * s;
    g.moveTo(x0 - 10 * s, base);
    g.bezierCurveTo(x0 - 18 * s + sway * 0.3, base - hgt * 0.4, x0 + sway, base - hgt * 0.7, x0 + sway * 1.3, base - hgt);
    g.bezierCurveTo(x0 + 14 * s + sway, base - hgt * 0.7, x0 + 6 * s + sway * 0.3, base - hgt * 0.4, x0 + 10 * s, base);
    g.closePath();
  }, 5);
  weed(W * 0.22, 120 * s, '#5B9C4A', 0);
  weed(W * 0.29, 80 * s, '#8FA37A', 1.3);
  weed(W * 0.8, 105 * s, '#4F8A8B', 2.1);
  // Sand
  card('#E2A951', () => {
    g.beginPath(); g.moveTo(0, H);
    g.lineTo(0, H * 0.86);
    g.bezierCurveTo(W * 0.3, H * 0.8, W * 0.6, H * 0.92, W, H * 0.84);
    g.lineTo(W, H); g.closePath();
  }, 6);

  // The fish: across and back over the film's length, bobbing to the music.
  const u = length > 0 ? (t / length) : 0;
  const swim = Math.sin(u * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;       // 0..1..0 over the film
  const dir = Math.cos(u * Math.PI * 2 - Math.PI / 2) >= 0 ? 1 : -1;
  const fx = W * (0.25 + 0.5 * swim), bob = Math.sin(t * 5) * 3 * s - lv.music * 16 * s;
  const fy = H * 0.45 + Math.sin(u * Math.PI * 4) * 18 * s + bob;
  const mouth = Math.min(1, lv.voice * 2.2);
  g.save();
  g.translate(fx, fy);
  g.scale(dir * s, s);
  g.rotate(Math.sin(t * 3) * 0.05 - lv.music * 0.1);
  // tail, wagging
  const wag = Math.sin(t * 10) * 0.25;
  card('#C96F4A', () => { g.beginPath(); g.moveTo(-58, 0); g.lineTo(-98, -30 + wag * 30); g.lineTo(-90, 0); g.lineTo(-98, 30 + wag * 30); g.closePath(); }, 7);
  // fin
  card('#D9A0A0', () => { g.beginPath(); g.moveTo(-20, -32); g.quadraticCurveTo(0, -62, 22, -34); g.closePath(); }, 7);
  // body, with the mouth cut out of its nose
  const m = 4 + mouth * 22;
  card('#F2A93B', () => {
    g.beginPath();
    g.moveTo(66, -m * 0.5);
    g.bezierCurveTo(40, -44, -40, -46, -62, 0);
    g.bezierCurveTo(-40, 46, 40, 44, 66, m * 0.5);
    g.lineTo(48, 0);
    g.closePath();
  }, 8);
  // stripes
  g.fillStyle = 'rgba(201, 111, 74, .55)';
  for (const sx of [-30, -6]) { g.beginPath(); g.ellipse(sx, 0, 6, 32, 0, 0, Math.PI * 2); g.fill(); }
  // eye
  g.fillStyle = '#FFFDF8'; g.beginPath(); g.arc(30, -12, 9, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#22303D'; g.beginPath(); g.arc(32 + mouth * 1.5, -12, 4.5, 0, Math.PI * 2); g.fill();
  // cheek
  g.fillStyle = 'rgba(224, 75, 50, .35)'; g.beginPath(); g.arc(36, 10, 6, 0, Math.PI * 2); g.fill();
  g.restore();

  // Bubbles at the silly sounds: one burst whenever one comes in.
  if (lv.sfx > 0.25 && lastSfx <= 0.25 && t !== lastT) {
    for (let i = 0; i < 6; i++) bubbles.push({ x: fx + dir * 66 * s, y: fy, vx: (Math.random() - 0.3) * 30 * dir, vy: -40 - Math.random() * 60, r: (3 + Math.random() * 6) * s, life: 1 });
  }
  lastSfx = lv.sfx;
  const dt = Math.max(0, Math.min(0.1, Math.abs(t - lastT)));
  lastT = t;
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.6;
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt * 0.7;
    if (b.life <= 0 || b.y < H * 0.1) { bubbles.splice(i, 1); continue; }
    g.globalAlpha = Math.min(1, b.life * 2);
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.stroke();
  }
  g.globalAlpha = 1;
}
