import { W, C, L, p, ease, win, hexA, hash, lerp, text, box, arrow, packet, pill, callout, rrect, clamp, cells, bar, kinetic } from '../helpers.js';
export const title = 'Columnar storage & compression';
export const subtitle = 'Row vs column · PAX · encodings · zone maps · SIMD';
export const color = '#2ac3de';
export const duration = 52;
export const focus = ['storage', 'execution'];
export const narration = [
  { at: 0.6, text: 'Analytics asks different questions: sum one column across a billion rows. A row store drags every column through memory to answer it.' },
  { at: 10, text: 'A column store keeps each column contiguous, so a query reads only the columns it needs. PAX splits each row group into column chunks, keeping rows cheap to rebuild.' },
  { at: 22.5, text: 'Similar values sit together, so compression is dramatic: dictionaries turn strings into small codes, run-length encoding collapses repeats, and delta plus bit-packing shrinks timestamps.' },
  { at: 33.5, text: 'Each row group also stores minimum and maximum values. A filter on timestamp can skip whole groups without reading them.' },
  { at: 41.3, text: 'What remains is scanned with SIMD, directly on compressed data.' },
  { at: 45.8, text: 'Less I/O, better cache use, and vector-friendly loops: that is why analytics engines go columnar.' },
];
const CC = [C.accent, C.purple, C.warn, C.good, C.cyan], CN = ['id', 'name', 'city', 'price', 'ts'];
const hdr = (ctx, s) => text(ctx, s, 80, 135, { size: 28, color: L.storage, weight: 700 });
export function draw(ctx, t, h) {
  // ---- A: row vs column (2.6-10)
  const sA = win(t, 2.8, 9.8, .5);
  if (sA > 0) { ctx.save(); ctx.globalAlpha *= sA; hdr(ctx, 'ROW STORE vs COLUMN STORE   —   SELECT SUM(price) FROM orders');
    const cw = 84, ch = 56, gap = 4, x0 = 100;
    const q = p(t, 5, 5.8); text(ctx, 'NSM / row-major on disk', x0, 250, { size: 26, color: C.fg, weight: 700, alpha: p(t, 3, 3.6) });
    const rowCells = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) rowCells.push({ label: CN[c], color: CC[c], alpha: p(t, 3.2 + (r * 5 + c) * .03, 3.6 + (r * 5 + c) * .03), glow: false });
    const rs = p(t, 6, 8, ease.lin); cells(ctx, rowCells.map((c, i) => ({ ...c, glow: rs * 20 > i, color: c.color })), { x: x0, y: 275, cols: 20, cw, ch, gap, size: 18 });
    ctx.save(); ctx.globalAlpha *= rs > 0 ? .9 : 0; ctx.fillStyle = hexA(C.bad, .12); rrect(ctx, x0 - 6, 269, 20 * (cw + gap) + 4, ch + 12, 8); ctx.fill(); ctx.restore();
    text(ctx, 'column-major (DSM)', x0, 450, { size: 26, color: C.fg, weight: 700, alpha: p(t, 4, 4.6) });
    const colCells = []; for (let c = 0; c < 5; c++) for (let r = 0; r < 4; r++) colCells.push({ label: CN[c], color: CC[c], alpha: p(t, 4.2 + (c * 4 + r) * .03, 4.6 + (c * 4 + r) * .03) });
    cells(ctx, colCells.map((c, i) => ({ ...c, glow: Math.floor(i / 4) === 3 && rs > 0 })), { x: x0, y: 475, cols: 20, cw, ch, gap, size: 18 });
    ctx.save(); ctx.globalAlpha *= rs > 0 ? 1 : 0; ctx.strokeStyle = C.good; ctx.lineWidth = 3; rrect(ctx, x0 + 12 * (cw + gap) - 3, 469, 4 * (cw + gap) + 2, ch + 12, 8); ctx.stroke(); ctx.restore();
    const gb = v => Math.round(v) + ' GB'; text(ctx, 'bytes read from disk:', x0, 640, { size: 24, color: C.dim, alpha: p(t, 6, 6.6) });
    bar(ctx, 500, 668, 1100 * rs, 34, 1, C.bad); text(ctx, 'row store  ' + gb(400 * rs), 100, 686, { size: 24, color: C.bad, base: 'middle', alpha: p(t, 6, 6.6) });
    bar(ctx, 500, 728, 1100 * rs * .2, 34, 1, C.good); text(ctx, 'column store  ' + gb(80 * rs), 100, 746, { size: 24, color: C.good, base: 'middle', alpha: p(t, 6, 6.6) });
    text(ctx, '1 of 5 columns → 5× less I/O (20 columns → 20×)', 1000, 820, { size: 24, color: C.fg, alpha: p(t, 8, 9) });
    ctx.restore(); }
  // ---- B: PAX (10-22.4)
  const sB = win(t, 10.2, 22.3, .5);
  if (sB > 0) { ctx.save(); ctx.globalAlpha *= sB; hdr(ctx, 'PAX / ROW GROUPS   —   Parquet, ORC, ClickHouse parts, DuckDB, Redshift');
    for (let g = 0; g < 3; g++) { const x = 100 + g * 580, a = p(t, 10.8 + g * .6, 11.4 + g * .6, ease.back);
      box(ctx, { x, y: 230, w: 540, h: 420, color: L.storage, alpha: clamp(a), r: 14 }); text(ctx, `Row group ${g}  (~128K rows)`, x + 20, 270, { size: 24, weight: 700, alpha: a });
      for (let c = 0; c < 5; c++) { const sel = c === 3 && t > 14; const ca = p(t, 11.6 + g * .6 + c * .15, 12.2 + g * .6 + c * .15, ease.out);
        ctx.save(); ctx.globalAlpha *= a * ca; rrect(ctx, x + 20 + c * 100, 300, 90, 270 * ca, 8); ctx.fillStyle = hexA(CC[c], sel ? .55 : .25); if (sel) { ctx.shadowColor = CC[c]; ctx.shadowBlur = 20; } ctx.fill(); ctx.strokeStyle = CC[c]; ctx.lineWidth = sel ? 3 : 1.5; ctx.stroke(); ctx.restore();
        text(ctx, CN[c], x + 65 + c * 100, 345, { size: 20, align: 'center', alpha: a * ca, color: C.fg, weight: 700 }); }
      text(ctx, 'footer: min/max, offsets, encodings', x + 20, 610, { size: 18, color: C.dim, alpha: p(t, 16, 16.8) });
      if (t > 14) packet(ctx, [[x + 315, 610], [x + 315, 700], [960, 760]], p(t, 14.3 + g * .4, 15.6 + g * .4), { color: C.good, size: 8 }); }
    box(ctx, { x: 700, y: 730, w: 520, h: 70, label: 'SUM(price) reads only the price chunks', color: C.good, size: 22, alpha: p(t, 14.5, 15.3) });
    text(ctx, 'rows rebuilt from the same row group: column i, position k → cheap, cache-friendly', 100, 850, { size: 22, color: C.dim, alpha: p(t, 18, 19) });
    ctx.restore(); }
  // ---- C: compression (22.5-33.3)
  const sC = win(t, 22.7, 33.2, .5);
  if (sC > 0) { ctx.save(); ctx.globalAlpha *= sC; hdr(ctx, 'LIGHTWEIGHT ENCODINGS   —   decode cost is tiny, I/O savings are huge');
    const P = [{ x: 100, n: 'Dictionary', c: C.warn }, { x: 700, n: 'Run-length', c: C.purple }, { x: 1300, n: 'Delta + bit-packing', c: C.cyan }];
    P.forEach((q, i) => { box(ctx, { x: q.x, y: 200, w: 520, h: 600, color: q.c, alpha: p(t, 23 + i * .5, 23.6 + i * .5), r: 14 }); text(ctx, q.n, q.x + 260, 245, { size: 28, color: q.c, align: 'center', weight: 800, alpha: p(t, 23 + i * .5, 23.6 + i * .5) }); });
    // dictionary
    const city = ['Paris', 'Tokyo', 'Paris', 'Paris', 'Tokyo', 'Lima'], codes = [0, 1, 0, 0, 1, 2]; const m1 = p(t, 25.2, 26.6, ease.inOut);
    city.forEach((s, i) => text(ctx, s, 130 + (i % 3) * 160, 310 + Math.floor(i / 3) * 52, { size: 24, mono: true, alpha: (1 - m1 * .75) * p(t, 23.6, 24.2), color: C.fg }));
    text(ctx, '6 × 5 B = 30 B', 130, 440, { size: 22, color: C.dim, alpha: p(t, 24, 24.6) });
    codes.forEach((c, i) => { const a = p(t, 25.4 + i * .1, 25.9 + i * .1, ease.back); box(ctx, { x: 130 + i * 70, y: 480, w: 60, h: 56, label: String(c), color: C.warn, alpha: a, mono: true, size: 24, r: 8 }); });
    text(ctx, 'codes: 2 bits each = 2 B', 130, 580, { size: 22, color: C.warn, alpha: p(t, 26.2, 26.8) }); text(ctx, 'dict  0:Paris  1:Tokyo  2:Lima', 130, 625, { size: 22, mono: true, color: C.fg, alpha: p(t, 26.4, 27) });
    pill(ctx, '≈ 3× smaller + compare on codes', 360, 710, { color: C.warn, size: 20, alpha: p(t, 27, 27.8) });
    // RLE
    const seq = 'AAAAAABBBBCC'.split(''); seq.forEach((s, i) => { const a = p(t, 23.8 + i * .04, 24.3 + i * .04); const col = s === 'A' ? C.purple : s === 'B' ? C.warn : C.good; box(ctx, { x: 720 + (i % 6) * 80, y: 290 + Math.floor(i / 6) * 70, w: 70, h: 60, label: s, color: col, alpha: a * (1 - p(t, 27.2, 28) * .8), mono: true, size: 24, r: 8 }); });
    [['A', 6, C.purple], ['B', 4, C.warn], ['C', 2, C.good]].forEach(([k, n, c], i) => { const a = p(t, 28 + i * .4, 28.6 + i * .4, ease.back); box(ctx, { x: 720 + i * 160, y: 480, w: 150, h: 70, label: `(${k}, ${n})`, color: c, alpha: a, mono: true, size: 26, r: 10 }); });
    text(ctx, '12 values → 3 pairs', 720, 610, { size: 22, color: C.purple, alpha: p(t, 29.2, 29.8) }); text(ctx, 'sorted / low-cardinality columns: 100×+', 720, 650, { size: 22, color: C.dim, alpha: p(t, 29.6, 30.2) });
    pill(ctx, 'aggregate without decoding', 960, 710, { color: C.purple, size: 20, alpha: p(t, 30, 30.8) });
    // delta
    const ts = [1700000000, 1700000001, 1700000002, 1700000004, 1700000005, 1700000007]; ts.forEach((v, i) => text(ctx, String(v), 1330, 300 + i * 40, { size: 22, mono: true, color: C.fg, alpha: (1 - p(t, 26.5, 27.5) * .7) * p(t, 24, 24.6) }));
    text(ctx, '6 × 8 B = 48 B', 1330, 560, { size: 22, color: C.dim, alpha: p(t, 24.4, 25) });
    text(ctx, 'base = 1700000000', 1330, 610, { size: 22, mono: true, color: C.cyan, alpha: p(t, 27.5, 28.2) });
    [0, 1, 1, 2, 1, 2].forEach((d, i) => box(ctx, { x: 1330 + i * 62, y: 635, w: 54, h: 50, label: String(d), color: C.cyan, alpha: p(t, 28 + i * .1, 28.5 + i * .1, ease.back), mono: true, size: 22, r: 8 }));
    text(ctx, 'deltas fit in 2 bits → 12 bits + base', 1330, 725, { size: 20, color: C.cyan, alpha: p(t, 29.5, 30.2) });
    pill(ctx, '≈ 30× smaller', 1560, 770, { color: C.cyan, size: 20, alpha: p(t, 30.5, 31.3) });
    text(ctx, 'plus LZ4/ZSTD on top · FOR · bitmaps · FSST for strings', 100, 850, { size: 22, color: C.dim, alpha: p(t, 31.5, 32.3) });
    ctx.restore(); }
  // ---- D: zone maps (33.5-41)
  const sD = win(t, 33.7, 41.0, .5);
  if (sD > 0) { ctx.save(); ctx.globalAlpha *= sD; hdr(ctx, 'ZONE MAPS   —   min/max per row group');
    code(ctx, 'WHERE ts > 1700500000', 100, 240, 30, p(t, 34, 34.6));
    const mm = [[1699000000, 1699400000], [1699400000, 1699900000], [1699900000, 1700300000], [1700300000, 1700700000], [1700700000, 1701100000], [1701100000, 1701500000]];
    mm.forEach(([lo, hi], i) => { const x = 100 + i * 290, a = p(t, 34.4 + i * .15, 35 + i * .15, ease.back); const skip = hi < 1700500000; const sk = p(t, 36.2 + i * .25, 36.8 + i * .25);
      box(ctx, { x, y: 300, w: 270, h: 300, color: skip && sk > 0 ? C.dim : C.good, alpha: clamp(a) * (1 - (skip ? sk * .55 : 0)), r: 12, glow: !skip && sk > 0 ? .5 : 0 });
      text(ctx, 'RG ' + i, x + 135, 340, { size: 26, align: 'center', weight: 800, alpha: a }); text(ctx, 'min ' + lo, x + 135, 400, { size: 18, align: 'center', mono: true, alpha: a }); text(ctx, 'max ' + hi, x + 135, 435, { size: 18, align: 'center', mono: true, alpha: a });
      if (sk > 0) { text(ctx, skip ? 'SKIP' : 'READ', x + 135, 520, { size: 40, align: 'center', weight: 900, color: skip ? C.dim : C.good, alpha: sk, glow: skip ? 0 : 12 }); text(ctx, skip ? '0 bytes' : '(partial overlap: max > x)', x + 135, 560, { size: 18, align: 'center', color: C.dim, alpha: sk }); } });
    text(ctx, 'metadata only: no data pages touched for skipped groups — sorted/clustered data skips the most', 100, 700, { size: 24, color: C.fg, alpha: p(t, 38.5, 39.5) });
    text(ctx, 'also: bloom filters per chunk · ClickHouse sparse primary index · Snowflake micro-partitions', 100, 750, { size: 22, color: C.dim, alpha: p(t, 39.5, 40.3) });
    ctx.restore(); }
  // ---- E: SIMD + outro (41.3-52)
  const sE = win(t, 41.5, 51.8, .5);
  if (sE > 0) { ctx.save(); ctx.globalAlpha *= sE; hdr(ctx, 'SIMD SCAN   —   one instruction, 8–16 values');
    const vals = [84, 130, 97, 215, 101, 99, 180, 60], thr = 100; const a = p(t, 42, 42.8);
    text(ctx, 'AVX2 register (8 × 32-bit lanes)', 100, 215, { size: 22, color: C.dim, alpha: a });
    cells(ctx, vals.map((v, i) => ({ label: v, color: C.cyan, alpha: p(t, 42 + i * .06, 42.5 + i * .06) })), { x: 100, y: 240, cols: 8, cw: 150, ch: 64, gap: 10, size: 28 });
    text(ctx, '>  100   (vpcmpgtd)', 100, 350, { size: 24, color: C.warn, mono: true, alpha: p(t, 43.3, 44) });
    cells(ctx, vals.map((v, i) => ({ label: v > thr ? '1' : '0', color: v > thr ? C.good : C.dim, glow: v > thr && t > 44, alpha: p(t, 44 + i * .06, 44.5 + i * .06) })), { x: 100, y: 375, cols: 8, cw: 150, ch: 64, gap: 10, size: 28 });
    text(ctx, 'selection vector → [1, 3, 4, 6]', 100, 490, { size: 26, color: C.good, mono: true, alpha: p(t, 45, 45.8) });
    kinetic(ctx, 'Less I/O.', 960, 620, t, 46.3, { size: 76, color: C.good, glow: 14 }); kinetic(ctx, 'Better cache use.', 960, 710, t, 47.6, { size: 76, color: C.accent, glow: 14 }); kinetic(ctx, 'Vector loops.', 960, 800, t, 48.9, { size: 76, color: C.warn, glow: 14 });
    ctx.restore(); }
}
function code(ctx, str, x, y, size, a) { text(ctx, str, x, y, { size, mono: true, color: C.good, alpha: a, weight: 700 }); }
