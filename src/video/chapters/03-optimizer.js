import { W, C, L, p, ease, win, hexA, hash, lerp, text, box, arrow, packet, pill, callout, rrect, clamp, bar, cells } from '../helpers.js';
export const title = 'Statistics, cardinality & the optimizer';
export const subtitle = 'How a database guesses, searches and chooses';
export const color = '#e0af68';
export const duration = 62;
export const focus = ['planning'];
export const narration = [
  { at: 0.6, text: 'The optimizer must pick one plan from millions. To compare them it has to guess how many rows each step produces, and that guess comes from statistics.' },
  { at: 11.3, text: 'A histogram splits a column into equal-count buckets, so a range predicate gives selectivity directly. A HyperLogLog sketch counts distinct values in a few kilobytes.' },
  { at: 24.2, text: 'Estimates compound. Assuming columns are independent, errors multiply up the tree: the optimizer expects one hundred twenty rows and gets forty-eight thousand.' },
  { at: 34.2, text: 'Then it searches. Bottom-up dynamic programming finds the best plan for every subset of tables. Cascades goes top-down, memoizing equivalent expressions and pruning by cost.' },
  { at: 46.2, text: 'The winner is a physical plan: hash join, index scan. It is cut into pipelines at breakers, like a hash build or a sort.' },
  { at: 55.6, text: 'A bad estimate costs orders of magnitude at runtime, which is why adaptive execution exists.' },
];
const hdr = (ctx, str, t, a) => text(ctx, str, 80, 135, { size: 28, color: L.planning, weight: 700, alpha: a });
export function draw(ctx, t, h) {
  // ---------- A: histogram + HLL (2.6 .. 24)
  const sA = win(t, 2.8, 23.8, .5);
  if (sA > 0) {
    ctx.save(); ctx.globalAlpha *= sA; hdr(ctx, 'STATISTICS  —  what the planner knows about the data', t, 1);
    // histogram
    const b = [0, 6, 13, 20, 27, 35, 44, 55, 68, 82, 100]; const x0 = 100, pw = 760, y0 = 700, sx = pw / 100;
    text(ctx, 'Equi-depth histogram of orders.price  (10M rows, 10 buckets × 1M rows)', 100, 178, { size: 24, color: C.fg, alpha: p(t, 3, 3.6) });
    for (let i = 0; i < 10; i++) { const a = p(t, 3.4 + i * .18, 4 + i * .18, ease.out), w = (b[i + 1] - b[i]) * sx, hh = 300 * 6 / (b[i + 1] - b[i]) * .78;
      const inR = i >= 3 && i <= 5, partial = i === 6; const act = t > 7 ? p(t, 7 + (i - 3) * .35, 7.5 + (i - 3) * .35) : 0; const col = (inR || partial) && act > 0 ? C.good : L.planning;
      ctx.save(); ctx.globalAlpha *= a; rrect(ctx, x0 + b[i] * sx + 2, y0 - hh * a, w - 4, hh * a, 5); ctx.fillStyle = hexA(col, .25 + .35 * ((inR || partial) ? act : 0)); ctx.fill(); ctx.strokeStyle = hexA(col, .9); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      text(ctx, '1M', x0 + b[i] * sx + w / 2, y0 - 14, { size: 16, color: C.dim, align: 'center', alpha: a * .9 }); }
    text(ctx, '0', x0, y0 + 28, { size: 18, color: C.dim }); text(ctx, '100', x0 + pw, y0 + 28, { size: 18, color: C.dim, align: 'right' }); text(ctx, 'price', x0 + pw / 2, y0 + 30, { size: 20, color: C.dim, align: 'center' });
    // predicate range
    const pa = p(t, 6, 7); if (pa > 0) { const xa = x0 + 20 * sx, xb = x0 + lerp(20, 45, pa) * sx; ctx.save(); ctx.fillStyle = 'rgba(158,206,106,.12)'; ctx.fillRect(xa, 235, xb - xa, y0 - 235); ctx.strokeStyle = C.good; ctx.setLineDash([8, 6]); ctx.strokeRect(xa, 235, xb - xa, y0 - 235); ctx.restore();
      text(ctx, 'WHERE price BETWEEN 20 AND 45', xa, 225, { size: 22, color: C.good, mono: true }); }
    text(ctx, '3 full buckets + 1/11 of the next ≈ 3.1 × 10% = 31% selectivity', 100, 770, { size: 24, color: C.fg, alpha: p(t, 8.5, 9.3) });
    text(ctx, '→ estimated 3.1M rows', 100, 812, { size: 32, color: C.good, weight: 800, mono: true, alpha: p(t, 9.5, 10.3), glow: 12 });
    // HLL
    const hx = 1000; text(ctx, 'HyperLogLog sketch: COUNT(DISTINCT user_id)', hx, 200, { size: 24, color: C.fg, alpha: p(t, 12, 12.6) });
    const regs = []; for (let i = 0; i < 32; i++) { let v = 0; for (let k = 0; k < 40; k++) if (hash(i * 97 + k * 13 + 3) * 40 < t - 12.5) v = Math.max(v, 1 + Math.floor(-Math.log2(1 - hash(i * 31 + k * 7 + 5) * .97) + .5)); regs.push(v); }
    cells(ctx, regs.map((v, i) => ({ label: v || '·', color: v ? C.cyan : C.dim, glow: false, alpha: p(t, 12.2 + i * .02, 12.8 + i * .02) })), { x: hx, y: 260, cols: 8, cw: 94, ch: 56, gap: 8, size: 26 });
    for (let i = 0; i < 4; i++) { const u = ((t * .7 + i / 4) % 1); packet(ctx, [[hx - 40, 520], [hx + 100 + hash(Math.floor(t * .7 + i / 4) + i) * 600, 400]], u, { color: C.cyan, size: 7, label: u < .5 ? '' : '', alpha: p(t, 12.5, 13) }); }
    text(ctx, 'hash(value) → register = first 5 bits, rank = leading zeros + 1', hx, 530, { size: 22, color: C.dim, alpha: p(t, 13.5, 14.3) });
    const est = Math.round(lerp(0, 998000, p(t, 14, 19, ease.out)) / 1000) * 1000;
    text(ctx, `NDV ≈ ${est.toLocaleString()}`, hx, 640, { size: 56, color: C.cyan, weight: 800, mono: true, alpha: p(t, 14, 14.8), glow: 14 });
    text(ctx, '±1% error  ·  12 KB for billions of values  ·  mergeable across shards', hx, 700, { size: 24, color: C.fg, alpha: p(t, 17.5, 18.5) });
    text(ctx, 'Also: DDSketch/t-digest quantiles · most-common values · null fraction · sampled correlation', hx, 760, { size: 22, color: C.dim, alpha: p(t, 20, 21) });
    ctx.restore();
  }
  // ---------- B: cardinality error (24.2 .. 34)
  const sB = win(t, 24.4, 33.8, .5);
  if (sB > 0) {
    ctx.save(); ctx.globalAlpha *= sB; hdr(ctx, 'CARDINALITY ESTIMATION  —  errors compound up the tree', t, 1);
    const ops = [['Scan orders', 1000000, 1000000], ['Filter city=‘Paris’\nAND country=‘FR’', 1200, 12000], ['Join customers', 600, 24000], ['Join products', 120, 48000]];
    const mult = ['×1', '×10', '×40', '×400'];
    ops.forEach(([n, est, act], i) => { const x = 110 + i * 440, a = p(t, 25 + i * 1.1, 25.7 + i * 1.1, ease.back);
      box(ctx, { x, y: 220, w: 370, h: 100, label: n.split('\n')[0], sub: n.split('\n')[1] || '', color: L.planning, alpha: clamp(a), size: 24, subSize: 17 });
      if (i < 3) arrow(ctx, [[x + 370, 270], [x + 440, 270]], { color: C.dim, progress: p(t, 25.4 + i * 1.1, 26 + i * 1.1) });
      const lg = v => Math.log10(v) / 6 * 240; const bx = x + 15;
      text(ctx, 'estimated', bx, 380, { size: 18, color: C.accent, alpha: a }); bar(ctx, bx, 392, lg(est), 24, 1, C.accent); text(ctx, est.toLocaleString(), bx + lg(est) + 10, 405, { size: 20, base: 'middle', mono: true, color: C.accent, alpha: a });
      text(ctx, 'actual', bx, 450, { size: 18, color: C.warn, alpha: a }); bar(ctx, bx, 462, lg(act) * p(t, 27 + i * .6, 28 + i * .6), 24, 1, C.warn); text(ctx, act.toLocaleString(), bx + lg(act) + 10, 475, { size: 20, base: 'middle', mono: true, color: C.warn, alpha: p(t, 27.6 + i * .6, 28.2 + i * .6) });
      const ea = p(t, 28 + i * .5, 28.6 + i * .5, ease.back); pill(ctx, 'error ' + mult[i], x + 185, 560, { color: i < 2 ? C.good : i < 3 ? C.warn : C.bad, size: 28, alpha: clamp(ea) }); });
    text(ctx, 'Independence assumption: P(city ∧ country) = P(city) · P(country)  —  but Paris implies France', 110, 660, { size: 26, color: C.fg, alpha: p(t, 30, 31) });
    text(ctx, 'Result: planner picks a nested-loop join for “120 rows” and executes 48,000 — hundreds of times slower', 110, 720, { size: 26, color: C.bad, alpha: p(t, 31.5, 32.5), weight: 700 });
    text(ctx, 'Fixes: multi-column stats · sampling · learned estimators · re-optimise at runtime', 110, 780, { size: 22, color: C.dim, alpha: p(t, 32.5, 33.2) });
    ctx.restore();
  }
  // ---------- C: search (34.2 .. 46)
  const sC = win(t, 34.4, 45.8, .5);
  if (sC > 0) {
    ctx.save(); ctx.globalAlpha *= sC; hdr(ctx, 'SEARCH  —  4 tables ⇒ 15 sub-plans to cost, thousands of join trees', t, 1);
    text(ctx, 'Bottom-up DP  (System R, PostgreSQL)', 100, 200, { size: 26, color: L.planning, weight: 700 });
    const lv = [['A', 'B', 'C', 'D'], ['AB', 'AC', 'AD', 'BC', 'BD', 'CD'], ['ABC', 'ABD', 'ACD', 'BCD'], ['ABCD']];
    const cost = [[10, 40, 25, 60], [90, 150, 210, 70, 180, 130], [310, 480, 350, 260], [410]]; let k = 0;
    lv.forEach((row, li) => row.forEach((n, i) => { const ts = 35 + k * .25; k++; const a = p(t, ts, ts + .4, ease.back); const w = li === 1 ? 130 : 160; const gap = 14; const tot = row.length * (w + gap) - gap; const x = 100 + (780 - tot) / 2 + i * (w + gap), y = 250 + li * 120;
      const best = (li === 0 && i === 3) || (li === 1 && i === 4) || (li === 2 && i === 3) || li === 3; const win_ = best && t > 41;
      box(ctx, { x, y, w, h: 80, label: n, sub: 'cost ' + cost[li][i], color: win_ ? C.good : L.planning, alpha: clamp(a), size: 24, subSize: 18, glow: win_ ? .8 : (t > ts && t < ts + .5 ? .8 : 0), r: 10 }); }));
    text(ctx, 'best(S) = min over splits of best(S₁) ⋈ best(S₂)', 100, 750, { size: 22, mono: true, color: C.dim, alpha: p(t, 38, 39) });
    // cascades
    const rx = 1000; text(ctx, 'Top-down Cascades  (SQL Server, Orca, Calcite, CockroachDB)', rx, 200, { size: 26, color: C.purple, weight: 700 });
    const groups = [['Group 7  {A⋈B⋈C}', [['HashJoin(G5,G3)', 410, 'ok'], ['HashJoin(G6,G1)', 380, 'best'], ['NLJoin(G2,G4)', 9900, 'pruned']], 250], ['Group 5  {A⋈B}', [['HashJoin(G1,G2)', 90, 'best'], ['MergeJoin(G1,G2)', 120, 'ok']], 470], ['Group 1  {A}', [['SeqScan(A)', 10, 'best'], ['IndexScan(A)', 25, 'ok']], 640]];
    groups.forEach(([gn, ex, y], gi) => { const a = p(t, 36 + gi * 1.2, 36.6 + gi * 1.2); box(ctx, { x: rx, y, w: 820, h: 40 + ex.length * 40 + 10, color: C.purple, alpha: a, r: 12 }); text(ctx, gn, rx + 20, y + 28, { size: 22, color: C.purple, weight: 700, alpha: a });
      ex.forEach(([n, c, st], i) => { const ea = p(t, 37 + gi * 1.2 + i * .35, 37.5 + gi * 1.2 + i * .35); const col = st === 'best' ? C.good : st === 'pruned' ? C.bad : C.fg; text(ctx, (st === 'pruned' ? '✕ ' : st === 'best' && t > 42 ? '✓ ' : '  ') + n, rx + 30, y + 70 + i * 40, { size: 22, mono: true, color: col, alpha: ea * (st === 'pruned' && t > 40 ? .55 : 1) }); text(ctx, 'cost ' + c, rx + 780, y + 70 + i * 40, { size: 22, mono: true, color: col, align: 'right', alpha: ea }); }); });
    arrow(ctx, [[rx + 780, 360], [rx + 780, 470]], { color: C.purple, progress: p(t, 38.5, 39.3), width: 2 }); arrow(ctx, [[rx + 780, 580], [rx + 780, 640]], { color: C.purple, progress: p(t, 39.3, 40), width: 2 });
    callout(ctx, 'branch-and-bound: cost 9,900 > best 380 → pruned', rx + 400, 800, { color: C.bad, alpha: p(t, 40.5, 41.3), align: 'center', size: 22 });
    ctx.restore();
  }
  // ---------- D: physical plan, pipelines (46.2 .. 62)
  const sD = win(t, 46.4, 61.7, .5);
  if (sD > 0) {
    ctx.save(); ctx.globalAlpha *= sD; hdr(ctx, 'PHYSICAL PLAN  →  PIPELINES', t, 1);
    const cands = [['Index nested-loop', 9.4, C.dim], ['Sort-merge join', 3.1, C.dim], ['Hash join', 1.2, C.good]];
    cands.forEach(([n, c, col], i) => { const a = p(t, 47 + i * .4, 47.6 + i * .4); text(ctx, n, 380, 205 + i * 46, { size: 24, color: col === C.good && t > 49 ? C.good : C.fg, align: 'right', alpha: a, weight: col === C.good ? 800 : 500 }); bar(ctx, 400, 190 + i * 46, 900 * (c / 9.4) * p(t, 47.4 + i * .4, 48.4 + i * .4), 26, 1, col === C.good && t > 49 ? C.good : C.warn); text(ctx, `cost ${c}M` + (col === C.good && t > 49 ? '  ← chosen' : ''), 410 + 900 * (c / 9.4) * p(t, 47.4 + i * .4, 48.4 + i * .4), 205 + i * 46, { size: 22, mono: true, base: 'middle', color: col === C.good && t > 49 ? C.good : C.dim, alpha: a }); });
    const lanes = [['Pipeline 1', [['Scan users', L.storage], ['HashBuild', L.execution]], 'breaker: hash table must be complete'], ['Pipeline 2', [['Scan orders', L.storage], ['Filter', L.execution], ['Probe', L.execution], ['PartialAgg', L.execution]], 'breaker: aggregate needs all input'], ['Pipeline 3', [['Scan groups', L.storage], ['Sort', L.execution], ['Output', L.client]], 'breaker: sort needs all input']];
    lanes.forEach(([ln, ops, br], li) => { const y = 420 + li * 135, ts = 50 + li * 2.2; const la = p(t, ts, ts + .6); text(ctx, ln, 80, y + 40, { size: 24, color: C.fg, weight: 700, alpha: la });
      ops.forEach(([n, c], i) => { const x = 280 + i * 260; const oa = p(t, ts + i * .3, ts + .5 + i * .3, ease.back); box(ctx, { x, y: y + 5, w: 220, h: 70, label: n, color: c, alpha: clamp(oa), size: 22, r: 10 }); if (i) arrow(ctx, [[x - 40, y + 40], [x, y + 40]], { color: C.dim, progress: oa, width: 2 }); });
      const ex = 280 + ops.length * 260 - 40; ctx.save(); ctx.globalAlpha *= la; ctx.fillStyle = C.bad; ctx.shadowColor = C.bad; ctx.shadowBlur = 14; rrect(ctx, ex + 8, y, 16, 80, 4); ctx.fill(); ctx.restore(); text(ctx, br, ex + 40, y + 42, { size: 20, color: C.bad, base: 'middle', alpha: p(t, ts + 1.2, ts + 1.8) });
      const u = p(t, ts + 1.5, ts + 3, ease.lin); for (let q = 0; q < 3; q++) packet(ctx, [[280, y + 40], [280 + ops.length * 260 - 60, y + 40]], clamp(u - q * .08) * (u > 0 && u < 1 ? 1 : 2), { color: C.good, size: 8, alpha: u > 0 && u < 1 ? 1 : 0 }); });
    arrow(ctx, [[160, 515], [160, 555]], { color: C.dim, progress: p(t, 52, 52.6), width: 2 }); arrow(ctx, [[160, 650], [160, 690]], { color: C.dim, progress: p(t, 54, 54.6), width: 2 });
    text(ctx, 'Within a pipeline tuples stay in registers/cache; breakers materialise state', 80, 840, { size: 22, color: C.dim, alpha: p(t, 56, 57) });
    ctx.restore();
  }
}
