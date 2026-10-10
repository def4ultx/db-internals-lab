// Drawing helpers passed to every chapter as the third argument of draw(ctx, t, h).
// ALL functions are pure functions of their arguments (no Date/Math.random) so frames are deterministic.
import { LAYERS, layerById, EDGE_KINDS } from '../shared/layers.js';

export { LAYERS };
export const W = 1920, H = 1080;
export const C = {
  bg: '#0b0e17', bg2: '#121726', panel: '#171d2e', panel2: '#1d2540', line: '#2a3350', fg: '#d7def5', dim: '#8a93b5',
  accent: '#7aa2f7', good: '#9ece6a', warn: '#e0af68', bad: '#f7768e', cyan: '#2ac3de', purple: '#bb9af7', orange: '#ff9e64',
  sans: 'Inter, -apple-system, "Helvetica Neue", Arial, sans-serif', mono: 'Menlo, "SF Mono", Consolas, monospace',
};
export const L = Object.fromEntries(LAYERS.map(l => [l.id, l.color]));   // L.client, L.frontend, ...
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, u) => a + (b - a) * u;
export const ease = {
  lin: u => u,
  in: u => u * u * u,
  out: u => 1 - Math.pow(1 - u, 3),
  inOut: u => (u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  expo: u => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
  back: u => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); },
  elastic: u => (u === 0 || u === 1 ? u : Math.pow(2, -10 * u) * Math.sin((u * 10 - .75) * (2 * Math.PI) / 3) + 1),
};
/** progress of t between a and b, clamped 0..1, optionally eased: p(t, 3, 4.5, ease.out) */
export const p = (t, a, b, fn = ease.inOut) => fn(clamp((t - a) / (b - a)));
/** 1 -> 0 between a and b */
export const pOut = (t, a, b, fn = ease.inOut) => 1 - p(t, a, b, fn);
/** visible window with fade in/out: win(t, 3, 10) -> alpha 0..1 (0.4s fades) */
export const win = (t, a, b, f = .4) => Math.min(clamp((t - a) / f), clamp((b - t) / f));
export const rng = seed => { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
export const hash = n => { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export function hexA(hex, a) { // '#rrggbb' + alpha -> rgba()
  const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${clamp(a)})`;
}
export function mix(c1, c2, u) {
  const a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
  const f = s => Math.round(lerp(a >> s & 255, b >> s & 255, clamp(u)));
  return `rgb(${f(16)},${f(8)},${f(0)})`;
}

/** text(ctx, 'hello', x, y, {size=32, color, weight=600, align='left', base='alphabetic'|'middle', mono, alpha, glow, maxWidth}) */
export function text(ctx, str, x, y, o = {}) {
  const { size = 32, color = C.fg, weight = 600, align = 'left', base = 'alphabetic', mono = false, alpha = 1, glow = 0, maxWidth, italic = false } = o;
  if (alpha <= 0.002) return 0;
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${mono ? C.mono : C.sans}`;
  ctx.textAlign = align; ctx.textBaseline = base; ctx.fillStyle = color;
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  if (maxWidth) ctx.fillText(str, x, y, maxWidth); else ctx.fillText(str, x, y);
  const w = ctx.measureText(str).width;
  ctx.restore();
  return w;
}
export function measure(ctx, str, size = 32, mono = false, weight = 600) { ctx.save(); ctx.font = `${weight} ${size}px ${mono ? C.mono : C.sans}`; const w = ctx.measureText(str).width; ctx.restore(); return w; }
/** multi-line text; lines = array of strings or one string with \n. Returns bottom y. */
export function lines(ctx, arr, x, y, o = {}) {
  const a = Array.isArray(arr) ? arr : String(arr).split('\n'); const lh = o.lh || (o.size || 32) * 1.3;
  a.forEach((s, i) => text(ctx, s, x, y + i * lh, o)); return y + a.length * lh;
}
/** typewriter: reveals chars at cps characters/sec starting at t0. Returns true when finished. */
export function type(ctx, str, x, y, t, t0, cps = 30, o = {}) {
  const n = Math.floor(clamp((t - t0) * cps, 0, str.length));
  if (t < t0) return false;
  const shown = str.slice(0, n);
  const w = text(ctx, shown, x, y, { ...o, mono: o.mono ?? true });
  if (n < str.length || Math.floor(t * 2) % 2 === 0) { // caret
    const al = o.align === 'center' ? x + w / 2 : x + w;
    ctx.save(); ctx.fillStyle = o.color || C.fg; ctx.globalAlpha *= .8; ctx.fillRect(al + 2, y - (o.size || 32) * .8, 3, (o.size || 32) * .95); ctx.restore();
  }
  return n >= str.length;
}
/** kinetic typography: words fly/scale in with stagger. Returns total width. */
export function kinetic(ctx, str, x, y, t, t0, o = {}) {
  const { size = 72, color = C.fg, stagger = .12, dur = .6, align = 'center', weight = 800, colors = [] } = o;
  const words = str.split(' ');
  ctx.save(); ctx.font = `${weight} ${size}px ${C.sans}`;
  const sp = size * .3; const ws = words.map(w => ctx.measureText(w).width); const total = ws.reduce((a, b) => a + b, 0) + sp * (words.length - 1);
  ctx.restore();
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  words.forEach((w, i) => {
    const u = p(t, t0 + i * stagger, t0 + i * stagger + dur, ease.back);
    const a = p(t, t0 + i * stagger, t0 + i * stagger + dur * .6, ease.out);
    ctx.save(); ctx.translate(cx + ws[i] / 2, y + (1 - u) * size * .6); ctx.scale(.7 + .3 * u, .7 + .3 * u);
    text(ctx, w, 0, 0, { size, color: colors[i] || color, weight, align: 'center', alpha: a, glow: o.glow || 0 });
    ctx.restore(); cx += ws[i] + sp;
  });
  return total;
}
export function rrect(ctx, x, y, w, h, r = 12) {
  r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/** Component box. o: {x,y,w,h,label,sub,color,alpha=1,glow=0..1,fill,r,size,subSize,mono,dashed,lw,scale=1,icon} (x,y = top-left). */
export function box(ctx, o) {
  const { x, y, w, h, label, sub, color = C.accent, alpha = 1, glow = 0, r = 14, size = 26, subSize = 18, scale = 1, lw = 2, dashed = false } = o;
  if (alpha <= .003) return;
  ctx.save(); ctx.globalAlpha *= clamp(alpha);
  if (scale !== 1) { ctx.translate(x + w / 2, y + h / 2); ctx.scale(scale, scale); ctx.translate(-x - w / 2, -y - h / 2); }
  if (glow > 0) { ctx.shadowColor = color; ctx.shadowBlur = 10 + 40 * glow; }
  rrect(ctx, x, y, w, h, r); ctx.fillStyle = o.fill || hexA(color, .10 + .18 * glow); ctx.fill();
  ctx.shadowBlur = 0; ctx.lineWidth = lw + glow * 2; ctx.strokeStyle = hexA(color, .55 + .45 * glow); if (dashed) ctx.setLineDash([10, 8]); ctx.stroke(); ctx.setLineDash([]);
  if (label) {
    const cy = sub ? y + h / 2 - subSize * .55 : y + h / 2;
    text(ctx, label, x + w / 2, cy, { size, color: o.textColor || C.fg, align: 'center', base: 'middle', weight: 700, mono: o.mono, maxWidth: w - 16 });
    if (sub) text(ctx, sub, x + w / 2, cy + size * .95, { size: subSize, color: C.dim, align: 'center', base: 'middle', weight: 500, mono: o.subMono, maxWidth: w - 16 });
  }
  ctx.restore();
}
export function pill(ctx, str, x, y, o = {}) { // centred pill badge
  const { color = C.accent, size = 20, alpha = 1, pad = 14, mono = false } = o; const w = measure(ctx, str, size, mono) + pad * 2, h = size * 1.7;
  ctx.save(); ctx.globalAlpha *= clamp(alpha); rrect(ctx, x - w / 2, y - h / 2, w, h, h / 2); ctx.fillStyle = hexA(color, .2); ctx.fill(); ctx.strokeStyle = hexA(color, .8); ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
  text(ctx, str, x, y, { size, color, align: 'center', base: 'middle', alpha, mono });
}
/** point along a polyline at fraction u (0..1) -> [x,y,angle] */
export function pathPoint(pts, u) {
  const seg = []; let tot = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); tot += d; }
  let d = clamp(u) * tot;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) { const f = seg[i] ? d / seg[i] : 0; const a = pts[i], b = pts[i + 1]; return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), Math.atan2(b[1] - a[1], b[0] - a[0])]; }
    d -= seg[i];
  }
  return [...pts[0], 0];
}
/** Labelled arrow along polyline pts=[[x,y],...]. o:{color,label,progress=1,width=3,dashed,alpha,labelSide=-1 (above) ,labelAt=.5,head=true,labelSize=20} */
export function arrow(ctx, pts, o = {}) {
  const { color = C.dim, label, progress = 1, width = 3, dashed = false, alpha = 1, labelAt = .5, head = true, labelSize = 20, labelDy = -16 } = o;
  if (alpha <= .003 || progress <= 0) return;
  const n = 40; const path = []; for (let i = 0; i <= n; i++) path.push(pathPoint(pts, progress * i / n));
  ctx.save(); ctx.globalAlpha *= clamp(alpha); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; if (dashed) ctx.setLineDash([12, 9]);
  ctx.beginPath(); path.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke(); ctx.setLineDash([]);
  if (head && progress > .98) { const e = path[path.length - 1], a = e[2], s = 8 + width * 2; ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(e[0], e[1]); ctx.lineTo(e[0] - s * Math.cos(a - .45), e[1] - s * Math.sin(a - .45)); ctx.lineTo(e[0] - s * Math.cos(a + .45), e[1] - s * Math.sin(a + .45)); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  if (label && progress > .5) { const m = pathPoint(pts, labelAt); const w = measure(ctx, label, labelSize) + 16; ctx.save(); ctx.globalAlpha *= clamp(alpha) * clamp((progress - .5) * 2); rrect(ctx, m[0] - w / 2, m[1] + labelDy - labelSize * .8, w, labelSize * 1.6, 8); ctx.fillStyle = 'rgba(11,14,23,.85)'; ctx.fill(); ctx.restore(); text(ctx, label, m[0], m[1] + labelDy, { size: labelSize, color, align: 'center', base: 'middle', alpha: alpha * clamp((progress - .5) * 2), weight: 600 }); }
}
/** Glowing data packet at fraction u along pts. o:{color,label,size=11,alpha,trail=.12} */
export function packet(ctx, pts, u, o = {}) {
  const { color = C.good, label, size = 11, alpha = 1, trail = .12 } = o;
  if (u <= 0.001 || u >= 0.999 || alpha <= .003) return;
  ctx.save(); ctx.globalAlpha *= clamp(alpha);
  for (let i = 5; i >= 1; i--) { const q = pathPoint(pts, clamp(u - trail * i / 5)); ctx.fillStyle = hexA(color, .12 * (6 - i) / 5); ctx.beginPath(); ctx.arc(q[0], q[1], size * (1 - i * .1), 0, 7); ctx.fill(); }
  const q = pathPoint(pts, u); ctx.shadowColor = color; ctx.shadowBlur = 28; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(q[0], q[1], size * .55, 0, 7); ctx.fill(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(q[0], q[1], size, 0, 7); ctx.globalAlpha *= .85; ctx.fill(); ctx.restore();
  if (label) text(ctx, label, q[0], q[1] - size - 16, { size: 20, color, align: 'center', base: 'middle', mono: true, alpha, glow: 8 });
}
/** Continuous stream of packets along a path, repeating. o:{rate=.5 (cycles/sec), count=3,color,label, from=0,to=1 (u window)} */
export function stream(ctx, pts, t, o = {}) {
  const { rate = .5, count = 3, ...rest } = o;
  for (let i = 0; i < count; i++) packet(ctx, pts, ((t * rate + i / count) % 1), rest);
}
/** Camera. keys=[{t,x,y,z}] world centre (x,y) shown at screen centre with zoom z. Returns a function cam(ctx, drawFn) wrapping drawing in the transform. */
export function camera(t, keys) {
  let a = keys[0], b = keys[0];
  for (let i = 0; i < keys.length; i++) { if (t >= keys[i].t) { a = keys[i]; b = keys[Math.min(i + 1, keys.length - 1)]; } }
  const u = a === b ? 0 : ease.inOut(clamp((t - a.t) / Math.max(.001, b.t - a.t)));
  const z = Math.exp(lerp(Math.log(a.z), Math.log(b.z), u)), x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u);
  return { x, y, z, apply(ctx) { ctx.translate(W / 2, H / 2 - 20); ctx.scale(z, z); ctx.translate(-x, -y); } };
}
/** Simple table. o:{x,y,cols:[{name,w,align?,mono?}],rows:[[..]],rowH=40,size=22,color,hl:(rowIdx)=>colour|null,reveal:0..1 (rows shown)} */
export function table(ctx, o) {
  const { x, y, cols, rows, rowH = 40, size = 22, color = C.accent, hl, reveal = 1, alpha = 1 } = o; const tw = cols.reduce((a, c) => a + c.w, 0);
  ctx.save(); ctx.globalAlpha *= clamp(alpha);
  rrect(ctx, x, y, tw, rowH, 8); ctx.fillStyle = hexA(color, .22); ctx.fill();
  let cx = x; cols.forEach(c => { text(ctx, c.name, cx + (c.align === 'right' ? c.w - 12 : 12), y + rowH / 2, { size: size - 2, color, base: 'middle', align: c.align === 'right' ? 'right' : 'left', weight: 700 }); cx += c.w; });
  rows.forEach((r, i) => {
    const ra = clamp(reveal * rows.length - i); if (ra <= 0) return; const yy = y + rowH * (i + 1);
    const h = hl && hl(i); ctx.globalAlpha = clamp(alpha) * ra; if (h) { ctx.fillStyle = hexA(h, .22); ctx.fillRect(x, yy, tw, rowH); } else if (i % 2) { ctx.fillStyle = 'rgba(255,255,255,.03)'; ctx.fillRect(x, yy, tw, rowH); }
    let cx = x; cols.forEach((c, j) => { text(ctx, String(r[j]), cx + (c.align === 'right' ? c.w - 12 : 12), yy + rowH / 2, { size, color: h || C.fg, base: 'middle', align: c.align === 'right' ? 'right' : 'left', mono: c.mono, weight: 500 }); cx += c.w; });
  });
  ctx.restore(); return y + rowH * (rows.length + 1);
}
/** Highlighted SQL/code snippet with simple syntax colouring. o:{size,alpha,hlTokens:[idx]} */
export function code(ctx, str, x, y, o = {}) {
  const { size = 28, alpha = 1 } = o; const kw = /^(SELECT|FROM|WHERE|JOIN|ON|GROUP|BY|ORDER|LIMIT|AND|OR|AS|INSERT|INTO|VALUES|UPDATE|SET|COMMIT|BEGIN|COUNT|SUM|AVG|DESC|ASC|HAVING|IN|NOT|NULL)$/i;
  const toks = str.match(/'[^']*'|\w+|\S|\s+/g) || []; let cx = x;
  toks.forEach(tk => { let col = C.fg; if (kw.test(tk)) col = C.purple; else if (/^'/.test(tk)) col = C.good; else if (/^\d+$/.test(tk)) col = C.orange; else if (/^[(),.*=<>+\-;]$/.test(tk)) col = C.dim; cx += text(ctx, tk, cx, y, { size, color: col, mono: true, alpha, weight: 600 }); });
  return cx - x;
}
/** Byte/cell grid. cells: array of {label,color,alpha?}; o:{x,y,cols,cw,ch,gap,size} */
export function cells(ctx, arr, o) {
  const { x, y, cols = arr.length, cw = 60, ch = 44, gap = 4, size = 18, alpha = 1 } = o;
  arr.forEach((c, i) => { const cx = x + (i % cols) * (cw + gap), cy = y + Math.floor(i / cols) * (ch + gap); const a = (c.alpha ?? 1) * alpha; if (a <= .003) return;
    ctx.save(); ctx.globalAlpha *= clamp(a); rrect(ctx, cx, cy, cw, ch, 6); ctx.fillStyle = hexA(c.color || C.accent, c.glow ? .5 : .18); if (c.glow) { ctx.shadowColor = c.color || C.accent; ctx.shadowBlur = 22; } ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = hexA(c.color || C.accent, .8); ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
    if (c.label !== undefined) text(ctx, String(c.label), cx + cw / 2, cy + ch / 2, { size: c.size || size, align: 'center', base: 'middle', mono: true, alpha: a, weight: 600 }); });
}
/** Horizontal progress/bar: bar(ctx,x,y,w,h,value01,color,{label}) */
export function bar(ctx, x, y, w, h, v, color = C.accent, o = {}) {
  ctx.save(); rrect(ctx, x, y, w, h, h / 2); ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fill(); if (v > 0) { rrect(ctx, x, y, Math.max(h, w * clamp(v)), h, h / 2); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.fill(); } ctx.restore();
  if (o.label) text(ctx, o.label, x - 14, y + h / 2, { size: o.size || 20, align: 'right', base: 'middle', color: C.dim });
}
/** Section heading used inside a chapter (kinetic-ish): heading(ctx,'Parser',t,t0,{sub}) top-left of content area */
export function heading(ctx, str, t, t0, o = {}) {
  const a = p(t, t0, t0 + .5, ease.out), { color = C.accent, sub, y = 150 } = o;
  text(ctx, str, 80 - (1 - a) * 40, y, { size: 54, weight: 800, color: C.fg, alpha: a });
  ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = color; ctx.fillRect(80, y + 16, 120 * a, 5); ctx.restore();
  if (sub) text(ctx, sub, 80, y + 62, { size: 26, color: C.dim, alpha: a, weight: 500 });
}
/** Callout label with a leader line: callout(ctx,'text',x,y,{color,alpha,align}) */
export function callout(ctx, str, x, y, o = {}) {
  const { size = 24, color = C.warn, alpha = 1, align = 'left' } = o; const w = measure(ctx, str, size) + 28;
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.save(); ctx.globalAlpha *= clamp(alpha); rrect(ctx, x0, y - size, w, size * 2, 10); ctx.fillStyle = hexA(color, .16); ctx.fill(); ctx.strokeStyle = hexA(color, .9); ctx.lineWidth = 1.6; ctx.stroke(); ctx.restore();
  text(ctx, str, x0 + w / 2, y, { size, color, align: 'center', base: 'middle', alpha });
}
export const helpers = { W, H, C, L, LAYERS, layerById, EDGE_KINDS, clamp, lerp, ease, p, pOut, win, rng, hash, hexA, mix, text, measure, lines, type, kinetic, rrect, box, pill, pathPoint, arrow, packet, stream, camera, table, code, cells, bar, heading, callout };
export default helpers;
