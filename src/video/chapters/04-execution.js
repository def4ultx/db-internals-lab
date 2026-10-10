import { W, C, L, p, ease, win, hexA, hash, lerp, text, box, arrow, packet, pill, callout, rrect, clamp, cells, code } from '../helpers.js';
export const title = 'Execution';
export const subtitle = 'Volcano, vectorized, compiled — and how work spreads across cores and nodes';
export const color = '#9ece6a';
export const duration = 62;
export const focus = ['execution'];
export const narration = [
  { at: 0.6, text: 'Execution turns the plan into work. The classic Volcano model gives every operator a next call: each tuple climbs the tree one function call at a time.' },
  { at: 11.4, text: 'Vectorized engines pass batches of a thousand values through tight loops that the CPU can pipeline and SIMD can accelerate. Compiled engines fuse a whole pipeline into one loop.' },
  { at: 22.6, text: 'Pull versus push is about who drives. Pull asks the child for a row; push lets the scan drive data through the pipeline, keeping values in registers.' },
  { at: 33.6, text: 'To use every core, morsel-driven parallelism hands workers small chunks of about a hundred thousand rows from a shared queue, so fast cores simply take more.' },
  { at: 44.2, text: 'Across machines, an exchange operator hashes rows to partitions, so matching join keys meet on the same node.' },
  { at: 51.8, text: 'And adaptive execution watches actual row counts, switching to a broadcast join when the estimate was wrong.' },
];
const hdr = (ctx, str) => text(ctx, str, 80, 135, { size: 28, color: L.execution, weight: 700 });
function morselSim() { const sp = [1, 1, .6, 1.35], free = [0, 0, 0, 0], out = []; for (let m = 0; m < 24; m++) { let w = 0; for (let i = 1; i < 4; i++) if (free[i] < free[w] - 1e-9) w = i; const s = free[w], d = 1.15 / sp[w]; out.push({ w, s, e: s + d }); free[w] = s + d; } return out; }
const SIM = morselSim();
export function draw(ctx, t, h) {
  // ---------- A: three execution models (2.6 .. 22.4)
  const sA = win(t, 2.8, 22.3, .5);
  if (sA > 0) {
    ctx.save(); ctx.globalAlpha *= sA; hdr(ctx, 'THREE WAYS TO RUN  Scan → Filter(price>100) → Project(total*1.2)');
    const cx = [340, 960, 1580], names = ['Volcano (iterator)', 'Vectorized', 'Compiled (data-centric)'], cols = [C.bad, C.cyan, C.good], ts = [3, 11.6, 17];
    cx.forEach((x, c) => { const a = p(t, ts[c] - .3, ts[c] + .4); text(ctx, names[c], x, 195, { size: 30, weight: 800, color: cols[c], align: 'center', alpha: a });
      ctx.save(); ctx.globalAlpha *= a * .5; ctx.strokeStyle = hexA(cols[c], .5); rrect(ctx, x - 300, 215, 600, 620, 18); ctx.stroke(); ctx.restore(); });
    // Volcano
    { const x = 340, a = p(t, 3, 3.8); const ys = [330, 510, 690]; const nm = ['Project', 'Filter', 'Scan'];
      if (c0(t)) { }
      ys.forEach((y, i) => box(ctx, { x: x - 130, y: y - 40, w: 260, h: 80, label: nm[i], color: L.execution, alpha: a, size: 24, glow: 0 }));
      const per = 1.5, ph = ((t - 4) / per); const k = Math.floor(ph), f = ph - k;
      if (t > 4 && t < 22) { // one tuple travels: next() down x3 then tuple up x3
        const path = [[x + 160, 330], [x + 160, 690]]; // calls down (right side)
        const dn = p(f, 0, .45, ease.lin), up = p(f, .5, 1, ease.lin);
        packet(ctx, [[x + 150, 380], [x + 150, 650]], dn, { color: C.warn, size: 8, alpha: f < .45 ? 1 : 0 });
        packet(ctx, [[x - 150, 650], [x - 150, 380]], up, { color: C.good, size: 11, alpha: f >= .5 ? 1 : 0, label: f >= .5 ? 'tuple' : '' });
        text(ctx, 'next()', x + 190, 520, { size: 24, color: C.warn, mono: true, alpha: f < .5 ? 1 : .3 }); }
      arrow(ctx, [[x + 150, 380], [x + 150, 650]], { color: hexA(C.warn, .35), progress: a, width: 2, head: false });
      arrow(ctx, [[x - 150, 650], [x - 150, 380]], { color: hexA(C.good, .35), progress: a, width: 2, head: false });
      const calls = Math.max(0, Math.floor((t - 4) / 1.5)) * 6; text(ctx, `virtual calls: ${calls}`, x, 780, { size: 26, color: C.bad, mono: true, align: 'center', alpha: a });
      text(ctx, '1 tuple per call · 2 indirect calls per op', x, 815, { size: 20, color: C.dim, align: 'center', alpha: p(t, 6, 7) }); }
    // Vectorized
    { const x = 960, a = p(t, 11.6, 12.4); const ys = [330, 510, 690]; const nm = ['Project', 'Filter', 'Scan'];
      ys.forEach((y, i) => box(ctx, { x: x - 130, y: y - 40, w: 260, h: 80, label: nm[i], color: L.execution, alpha: a, size: 24 }));
      const ph = (t - 12.5) / 2.4, f = ph - Math.floor(ph);
      if (t > 12.5 && t < 22) { const bu = [[x - 150, 650], [x - 150, 380]]; const u = f; const q = [x - 150, lerp(650, 380, u)];
        ctx.save(); for (let i = 0; i < 8; i++) { const al = a; ctx.globalAlpha *= clamp(al); rrect(ctx, q[0] - 70 + i * 17, q[1] - 14, 15, 28, 3); ctx.fillStyle = hexA(C.cyan, .85); ctx.shadowColor = C.cyan; ctx.shadowBlur = 14; ctx.fill(); } ctx.restore();
        text(ctx, '1024 values', q[0] - 20, q[1] - 34, { size: 18, color: C.cyan, mono: true, align: 'center' }); }
      arrow(ctx, [[x - 150, 650], [x - 150, 380]], { color: hexA(C.cyan, .35), progress: a, width: 2, head: false });
      // SIMD lanes
      const sy = 770; text(ctx, 'filter loop on a batch, 8 lanes / AVX2', x, sy - 28, { size: 20, color: C.dim, align: 'center', alpha: p(t, 13, 14) });
      for (let i = 0; i < 8; i++) { const on = hash(i + Math.floor(t * 4)) > .5; cells(ctx, [{ label: on ? '✓' : '·', color: on ? C.good : C.dim, glow: on }], { x: x - 175 + i * 44, y: sy, cw: 40, ch: 40, size: 20, alpha: p(t, 13, 14) }); }
      text(ctx, 'overhead amortised over 1024 tuples', x, 836 - 12, { size: 20, color: C.cyan, align: 'center', alpha: p(t, 15, 16) }); }
    // Compiled
    { const x = 1580, a = p(t, 17.2, 18); box(ctx, { x: x - 270, y: 250, w: 540, h: 360, color: C.good, alpha: a, r: 14, label: '' });
      text(ctx, 'one fused loop per pipeline (LLVM / JIT)', x, 285, { size: 22, color: C.good, align: 'center', alpha: a });
      const src = ['for (row : orders) {', '  if (row.price > 100) {', '    out.push(row.total*1.2);', '  }', '}']; src.forEach((l, i) => text(ctx, l, x - 250, 340 + i * 44, { size: 24, mono: true, color: i === 1 ? C.warn : C.fg, alpha: p(t, 17.8 + i * .35, 18.4 + i * .35), weight: 500 }));
      const hl = Math.floor(t * 5) % 5; if (t > 20) ctx.save(), ctx.fillStyle = 'rgba(158,206,106,.15)', ctx.fillRect(x - 262, 318 + hl * 44, 524, 38), ctx.restore();
      for (let i = 0; i < 4; i++) packet(ctx, [[x - 250, 660], [x + 250, 660]], (t * 1.2 + i / 4) % 1, { color: C.good, size: 8, trail: .15, alpha: a });
      text(ctx, 'registers, no calls', x, 625, { size: 20, color: C.dim, align: 'center', alpha: a });
      text(ctx, 'HyPer/Umbra, Spark WholeStage', x, 780, { size: 22, color: C.good, align: 'center', alpha: p(t, 20, 21) }); text(ctx, 'compile time ~ ms vs run time gains', x, 815, { size: 20, color: C.dim, align: 'center', alpha: p(t, 20, 21) }); }
    ctx.restore();
  }
  // ---------- B: pull vs push (22.6 .. 33.4)
  const sB = win(t, 22.8, 33.2, .5);
  if (sB > 0) {
    ctx.save(); ctx.globalAlpha *= sB; hdr(ctx, 'WHO DRIVES THE DATA?');
    const rows = [['PULL  (Volcano, Postgres)', 290, C.warn, true], ['PUSH  (HyPer, DuckDB pipelines, Spark)', 610, C.good, false]];
    rows.forEach(([n, y, col, pull], r) => { const a = p(t, 23.2 + r * 3, 23.9 + r * 3); text(ctx, n, 120, y - 40, { size: 28, color: col, weight: 800, alpha: a });
      const xs = pull ? [1500, 1000, 500] : [500, 1000, 1500]; const nm = pull ? ['Output', 'Filter', 'Scan'] : ['Scan', 'Filter', 'Output']; if (!pull) { }
      const pos = [[500, y + 40], [1000, y + 40], [1500, y + 40]]; const labels = pull ? ['Scan', 'Filter', 'Output'] : ['Scan', 'Filter', 'Output'];
      pos.forEach(([x, yy], i) => box(ctx, { x: x - 110, y: yy - 40, w: 220, h: 80, label: labels[i], color: L.execution, alpha: a, size: 24 }));
      // data always flows scan->output
      arrow(ctx, [[610, y + 40], [890, y + 40]], { color: hexA(C.good, .5), progress: a, width: 3 }); arrow(ctx, [[1110, y + 40], [1390, y + 40]], { color: hexA(C.good, .5), progress: a, width: 3 });
      if (pull) { arrow(ctx, [[1390, y + 110], [1110, y + 110]], { color: C.warn, progress: a, width: 3, label: 'next()', labelDy: 24 }); arrow(ctx, [[890, y + 110], [610, y + 110]], { color: C.warn, progress: a, width: 3, label: 'next()', labelDy: 24 });
        const f = ((t - 24) * .5) % 1; if (t > 24) { packet(ctx, [[1390, y + 110], [610, y + 110]], clamp(f * 2), { color: C.warn, size: 7, alpha: f < .5 ? 1 : 0 }); packet(ctx, [[610, y + 40], [1390, y + 40]], clamp(f * 2 - 1), { color: C.good, size: 9, alpha: f >= .5 ? 1 : 0, label: 'row' }); }
        text(ctx, 'consumer decides when to ask → simple, composable, one call per row', 120, y + 170, { size: 22, color: C.dim, alpha: p(t, 26, 27) }); }
      else { const f = ((t - 28.5) * .9); if (t > 28) for (let k = 0; k < 4; k++) packet(ctx, [[610, y + 40], [1390, y + 40]], ((f + k / 4) % 1), { color: C.good, size: 9, trail: .1, alpha: 1, label: k === 0 ? 'batch' : '' });
        text(ctx, 'producer pushes into the pipeline → tuple stays in registers/L1, fused loop', 120, y + 130, { size: 22, color: C.dim, alpha: p(t, 30.5, 31.5) }); } });
    ctx.restore();
  }
  // ---------- C: morsel-driven (33.6 .. 44)
  const sC = win(t, 33.8, 43.9, .5);
  if (sC > 0) {
    ctx.save(); ctx.globalAlpha *= sC; hdr(ctx, 'MORSEL-DRIVEN PARALLELISM  —  one shared work queue, per-core workers');
    const t0 = 35, tt = Math.max(0, t - t0), wc = [C.accent, C.purple, C.warn, C.good];
    text(ctx, 'table split into morsels (~100k rows each)', 100, 205, { size: 22, color: C.dim, alpha: p(t, 34, 34.8) });
    SIM.forEach((m, i) => { const col = i % 12, row = Math.floor(i / 12), x = 100 + col * 140, y = 225 + row * 62; const done = tt >= m.e, run = tt >= m.s && tt < m.e; const a = p(t, 34 + i * .03, 34.5 + i * .03);
      box(ctx, { x, y, w: 128, h: 48, label: 'm' + i, color: done || run ? wc[m.w] : C.dim, alpha: a * (done ? .45 : 1), size: 20, r: 8, glow: run ? .7 : 0 }); });
    const cores = ['Core 0 (socket A)', 'Core 1 (socket A)', 'Core 2 (slow, shared)', 'Core 3 (socket B)']; const done = [0, 0, 0, 0];
    SIM.forEach(m => { if (tt >= m.e) done[m.w]++; });
    cores.forEach((n, i) => { const y = 400 + i * 100; const a = p(t, 34.6 + i * .15, 35.2 + i * .15); box(ctx, { x: 100, y, w: 280, h: 74, label: n, color: wc[i], alpha: a, size: 20 }); text(ctx, `${done[i]} morsels`, 1740, y + 37, { size: 22, color: wc[i], align: 'right', mono: true, base: 'middle', alpha: a });
      SIM.filter(m => m.w === i).forEach(m => { const x0 = 400 + (m.s / 9) * 1250, x1 = 400 + (m.e / 9) * 1250; if (tt < m.s) return; const w = Math.min(x1, 400 + (tt / 9) * 1250) - x0; ctx.save(); rrect(ctx, x0 + 2, y + 10, Math.max(4, w - 4), 54, 8); ctx.fillStyle = hexA(wc[i], .35); ctx.fill(); ctx.strokeStyle = hexA(wc[i], .9); ctx.stroke(); ctx.restore(); }); });
    for (let i = 0; i < 4; i++) { const q = SIM.filter(m => m.w === i && tt >= m.s - .5 && tt < m.s + .1); q.forEach(m => packet(ctx, [[100 + (m.s * 7 % 12) * 140 + 64, 270], [380, 437 + i * 100]], p(tt, m.s - .5, m.s + .1), { color: wc[i], size: 7, trail: .1 })); }
    text(ctx, 'fast workers take more morsels → no straggler; NUMA-local morsels; work stealing at the tail', 100, 845, { size: 22, color: C.fg, alpha: p(t, 40, 41) });
    ctx.restore();
  }
  // ---------- D: exchange / shuffle (44.2 .. 51.6)
  const sD = win(t, 44.4, 51.4, .5);
  if (sD > 0) {
    ctx.save(); ctx.globalAlpha *= sD; hdr(ctx, 'EXCHANGE / SHUFFLE  —  hash(join key) mod 3 decides the destination node');
    const dc = [C.accent, C.warn, C.good]; const sy = [250, 450, 650];
    sy.forEach((y, i) => { const a = p(t, 45 + i * .2, 45.6 + i * .2); box(ctx, { x: 100, y, w: 300, h: 130, label: 'Node ' + (i + 1), sub: 'scan + partial', color: C.dim, alpha: a, size: 24 }); box(ctx, { x: 1500, y, w: 300, h: 130, label: 'Node ' + (i + 1), sub: 'join partition ' + i, color: dc[i], alpha: a, size: 24 }); });
    for (let s = 0; s < 3; s++) for (let d = 0; d < 3; d++) arrow(ctx, [[400, sy[s] + 65], [1500, sy[d] + 65]], { color: hexA(dc[d], .22), progress: p(t, 46, 47), width: 2, head: false });
    for (let k = 0; k < 18; k++) { const s = k % 3, key = Math.floor(hash(k * 3.3) * 90) + 10, d = key % 3; const ts = 46.5 + (k * .22) % 3.5; const u = p(t, ts, ts + 1.4, ease.inOut);
      packet(ctx, [[400, sy[s] + 65], [1500, sy[d] + 65]], u, { color: dc[d], size: 9, alpha: u > 0 && u < 1 ? 1 : 0, label: u > .08 && u < .3 ? 'k=' + key : '' }); }
    text(ctx, 'same key → same node, so each node joins its partition locally', 960, 830, { size: 24, color: C.fg, align: 'center', alpha: p(t, 49, 50) });
    ctx.restore();
  }
  // ---------- E: AQE (51.8 .. 62)
  const sE = win(t, 52, 61.7, .5);
  if (sE > 0) {
    ctx.save(); ctx.globalAlpha *= sE; hdr(ctx, 'ADAPTIVE QUERY EXECUTION  —  re-plan with real statistics');
    const sw = p(t, 56.5, 58, ease.inOut);
    box(ctx, { x: 150, y: 220, w: 560, h: 110, label: 'Stage 1: scan + filter dim table', sub: 'planner estimate: 5,000,000 rows', color: C.dim, alpha: p(t, 52.5, 53.2), size: 24 });
    box(ctx, { x: 150, y: 460, w: 560, h: 110, label: 'Stage 2: join with fact table', sub: sw < .5 ? 'shuffle hash join (both sides shuffled)' : 'broadcast hash join (no shuffle of fact)', color: sw < .5 ? C.warn : C.good, alpha: p(t, 53.4, 54), size: 24, glow: sw > .5 ? .8 : 0 });
    arrow(ctx, [[430, 330], [430, 460]], { color: C.dim, progress: p(t, 53.6, 54.2), width: 3, label: 'shuffle files + stats', labelDy: 0 });
    packet(ctx, [[430, 330], [430, 460]], p(t, 54.2, 55.4), { color: C.good, size: 9 });
    box(ctx, { x: 900, y: 220, w: 800, h: 260, color: C.bad, alpha: p(t, 55, 55.8), r: 14 });
    text(ctx, 'Runtime stats arrive', 940, 270, { size: 28, color: C.bad, weight: 800, alpha: p(t, 55, 55.8) });
    text(ctx, 'estimated 5,000,000 rows', 940, 330, { size: 26, mono: true, color: C.dim, alpha: p(t, 55.2, 56) }); text(ctx, 'actual        12,400 rows', 940, 380, { size: 26, mono: true, color: C.good, alpha: p(t, 55.6, 56.4), weight: 800 });
    text(ctx, '12,400 rows × 100 B = 1.2 MB  →  fits in memory on every node', 940, 440, { size: 22, color: C.fg, alpha: p(t, 56.8, 57.6) });
    callout(ctx, '→ switch to broadcast join, coalesce 200 shuffle partitions to 4, split skewed ones', 900, 560, { color: C.good, alpha: p(t, 58, 58.8), size: 24 });
    text(ctx, 'Spark 3 AQE · Snowflake · Dataflow · Presto/Trino adaptive joins', 150, 700, { size: 22, color: C.dim, alpha: p(t, 59, 60) });
    ctx.restore();
  }
}
function c0() { return true; }
