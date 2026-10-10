import { W, C, L, p, ease, win, hexA, hash, lerp, text, box, arrow, packet, pill, callout, rrect, clamp, cells, bar, kinetic } from '../helpers.js';
export const title = 'Transactions';
export const subtitle = 'ACID · locks & latches · 2PL · OCC · MVCC · isolation · deadlock';
export const color = '#f7768e';
export const duration = 70;
export const focus = ['txn'];
export const narration = [
  { at: 0.6, text: 'A transaction groups operations so they behave as one. Transfer a hundred dollars: both updates happen or neither. That is atomicity; consistency, isolation and durability complete ACID.' },
  { at: 12.2, text: 'Do not confuse locks with latches. Locks protect logical data for a whole transaction. Latches are tiny, short-lived mutexes protecting in-memory structures like a B-tree page.' },
  { at: 23.4, text: 'Two-phase locking acquires locks, then only releases them. Optimistic control reads freely and validates at commit. MVCC keeps old versions, so readers never block writers.' },
  { at: 34, text: 'Each row version carries begin and end timestamps. A transaction sees only versions visible at its snapshot, and vacuum later reclaims dead ones.' },
  { at: 43.8, text: 'Weaker isolation permits anomalies: dirty reads, non-repeatable reads, phantoms, and write skew, where two doctors both go off call.' },
  { at: 52.6, text: 'When transactions wait on each other in a cycle, the deadlock detector finds the loop in the wait-for graph and aborts a victim.' },
  { at: 62.2, text: 'Isolation is a dial between correctness and concurrency.' },
];
const hdr = (ctx, s) => text(ctx, s, 80, 135, { size: 28, color: L.txn, weight: 700 });
export function draw(ctx, t, h) {
  acid(ctx, t); locks(ctx, t); schemes(ctx, t); mvcc(ctx, t); anomalies(ctx, t); deadlock(ctx, t); dial(ctx, t);
}
function acid(ctx, t) {
  const s = win(t, 2.8, 12, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'ACID   —   BEGIN; UPDATE acct SET bal=bal-100 WHERE id=A; UPDATE acct SET bal=bal+100 WHERE id=B; COMMIT;');
  [['A', 'Atomicity', 'all or nothing', C.bad], ['C', 'Consistency', 'invariants hold', C.warn], ['I', 'Isolation', 'looks serial', C.accent], ['D', 'Durability', 'survives crashes', C.good]].forEach(([l, n, d, c], i) => { const a = p(t, 3 + i * .5, 3.7 + i * .5, ease.back);
    box(ctx, { x: 100 + i * 440, y: 190, w: 400, h: 190, color: c, alpha: clamp(a), glow: .2, scale: .85 + .15 * clamp(a) }); text(ctx, l, 140 + i * 440, 320, { size: 120, color: c, weight: 900, alpha: clamp(a) * .9, glow: 18 }); text(ctx, n, 260 + i * 440, 270, { size: 30, weight: 800, alpha: a }); text(ctx, d, 260 + i * 440, 318, { size: 22, color: C.dim, alpha: a }); });
  const fail = t > 7.2 && t < 9.6; const bal = (who) => who === 'A' ? (t < 5.8 ? 500 : t < 9.6 ? (t < 7.2 ? 400 : (t < 8.6 ? 400 : 500)) : 400) : (t < 9.6 ? 200 : (t < 10.6 ? 200 : 300));
  box(ctx, { x: 250, y: 500, w: 340, h: 150, color: C.accent, glow: t > 5.8 && t < 6.6 ? .8 : 0, alpha: p(t, 4.5, 5.2) }); text(ctx, 'Account A', 420, 540, { size: 28, align: 'center', alpha: p(t, 4.5, 5.2) }); text(ctx, '$' + bal('A'), 420, 605, { size: 48, mono: true, align: 'center', alpha: p(t, 4.5, 5.2), weight: 800 });
  box(ctx, { x: 1330, y: 500, w: 340, h: 150, color: C.accent, glow: t > 10.2 && t < 11 ? .8 : 0, alpha: p(t, 4.5, 5.2) }); text(ctx, 'Account B', 1500, 540, { size: 28, align: 'center', alpha: p(t, 4.5, 5.2) }); text(ctx, '$' + bal('B'), 1500, 605, { size: 48, mono: true, align: 'center', alpha: p(t, 4.5, 5.2), weight: 800 });
  arrow(ctx, [[600, 575], [1320, 575]], { color: C.dim, progress: p(t, 5, 5.8), width: 3 });
  packet(ctx, [[600, 575], [1320, 575]], p(t, 5.8, 7.2, ease.lin), { color: C.warn, size: 13, label: '$100' });
  if (t > 7.2 && t < 9.6) { text(ctx, '⚡ crash before COMMIT', 960, 470, { size: 34, color: C.bad, align: 'center', weight: 800, alpha: p(t, 7.2, 7.6), glow: 16 }); text(ctx, 'ROLLBACK via undo log: A restored to $500', 960, 700, { size: 26, color: C.bad, align: 'center', alpha: p(t, 7.9, 8.5) }); }
  packet(ctx, [[600, 575], [1320, 575]], p(t, 9.6, 10.6, ease.lin), { color: C.good, size: 13, label: '$100' });
  if (t > 10.7) text(ctx, 'COMMIT ✓   total still $700 (consistency)', 960, 700, { size: 28, color: C.good, align: 'center', weight: 700, alpha: p(t, 10.7, 11.3) });
  ctx.restore();
}
function locks(ctx, t) {
  const s = win(t, 12.4, 23.2, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'LOCKS vs LATCHES');
  box(ctx, { x: 80, y: 190, w: 880, h: 600, color: C.bad, alpha: p(t, 12.8, 13.4), r: 14 }); box(ctx, { x: 1000, y: 190, w: 840, h: 600, color: C.cyan, alpha: p(t, 12.8, 13.4), r: 14 });
  text(ctx, 'LOCK  (lock manager)', 120, 240, { size: 30, color: C.bad, weight: 800, alpha: p(t, 13, 13.6) }); text(ctx, 'LATCH  (mutex / rwlock / atomics)', 1040, 240, { size: 30, color: C.cyan, weight: 800, alpha: p(t, 13, 13.6) });
  const lines = [['protects', 'logical objects: rows, keys, tables', 'physical memory: B-tree page, hash bucket'], ['held for', 'whole transaction (ms – s)', 'a few instructions (ns – µs)'], ['deadlock', 'possible → detector', 'avoided by ordering (crabbing)'], ['visible in', 'SQL: SHOW LOCKS, pg_locks', 'invisible, perf counters only']];
  lines.forEach(([k, a, b], i) => { const al = p(t, 14 + i * .6, 14.6 + i * .6); text(ctx, k, 120, 300 + i * 56, { size: 20, color: C.dim, alpha: al }); text(ctx, a, 250, 300 + i * 56, { size: 22, alpha: al }); text(ctx, k, 1040, 300 + i * 56, { size: 20, color: C.dim, alpha: al }); text(ctx, b, 1170, 300 + i * 56, { size: 22, alpha: al, maxWidth: 650 }); });
  // timeline
  const ty = 590; text(ctx, 'time →', 120, ty - 70, { size: 18, color: C.dim }); ctx.fillStyle = 'rgba(138,147,181,.4)'; ctx.fillRect(120, ty + 80, 800, 2); ctx.fillRect(1040, ty + 80, 760, 2);
  const lk = p(t, 17.5, 21, ease.lin); ctx.save(); rrect(ctx, 130, ty, 780 * lk, 50, 8); ctx.fillStyle = hexA(C.bad, .55); ctx.shadowColor = C.bad; ctx.shadowBlur = 14; ctx.fill(); ctx.restore(); text(ctx, 'X lock on row 42: BEGIN ………… COMMIT', 150, ty + 26, { size: 20, base: 'middle', alpha: p(t, 17.5, 18.3) });
  for (let i = 0; i < 9; i++) { const x = 1050 + i * 84, a = p(t, 17.6 + i * .3, 17.9 + i * .3); ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = C.cyan; ctx.shadowColor = C.cyan; ctx.shadowBlur = 12; ctx.fillRect(x, ty, 8, 50); ctx.restore(); }
  text(ctx, 'latch ticks around each page access', 1050, ty + 110, { size: 20, color: C.cyan, alpha: p(t, 19, 19.8) });
  // compat matrix
  const mx = 120, my = 690; text(ctx, 'compat', mx, my + 18, { size: 18, color: C.dim, alpha: p(t, 20, 20.6) }); [['', 'S', 'X'], ['S', '✓', '✕'], ['X', '✕', '✕']].forEach((r, i) => r.forEach((v, j) => text(ctx, v, mx + 110 + j * 70, my + i * 32, { size: 24, color: v === '✓' ? C.good : v === '✕' ? C.bad : C.fg, mono: true, align: 'center', alpha: p(t, 20, 20.8), weight: 700 })));
  ctx.restore();
}
function schemes(ctx, t) {
  const s = win(t, 23.6, 33.8, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'THREE CONCURRENCY-CONTROL STYLES');
  const P = [['2PL', 100, C.bad], ['OCC', 700, C.warn], ['MVCC', 1300, C.good]]; P.forEach(([n, x, c], i) => { box(ctx, { x, y: 190, w: 520, h: 600, color: c, alpha: p(t, 24 + i * .4, 24.6 + i * .4), r: 14 }); text(ctx, n, x + 260, 240, { size: 36, weight: 900, color: c, align: 'center', alpha: p(t, 24 + i * .4, 24.6 + i * .4) }); });
  // 2PL curve
  const x0 = 130, y0 = 700, w = 460, hh = 300; text(ctx, 'locks held', x0 - 10, y0 - hh - 10, { size: 18, color: C.dim, alpha: p(t, 25, 25.6) }); ctx.save(); ctx.strokeStyle = C.dim; ctx.globalAlpha *= p(t, 25, 25.6); ctx.beginPath(); ctx.moveTo(x0, y0 - hh); ctx.lineTo(x0, y0); ctx.lineTo(x0 + w, y0); ctx.stroke(); ctx.restore();
  const pr = p(t, 25.4, 28.4, ease.lin); ctx.save(); ctx.strokeStyle = C.bad; ctx.lineWidth = 4; ctx.shadowColor = C.bad; ctx.shadowBlur = 12; ctx.beginPath(); for (let i = 0; i <= 60; i++) { const u = i / 60 * pr; const y = u < .5 ? u * 2 : (1 - u) * 2; const px = x0 + u * w, py = y0 - y * hh * .9; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); ctx.restore();
  text(ctx, 'growing', x0 + 60, y0 + 34, { size: 20, color: C.bad, alpha: p(t, 26, 26.6) }); text(ctx, 'shrinking', x0 + 300, y0 + 34, { size: 20, color: C.bad, alpha: p(t, 27.4, 28) }); callout(ctx, 'lock point', x0 + w / 2, y0 - hh * .9 - 36, { color: C.warn, alpha: p(t, 26.8, 27.5), align: 'center', size: 20 });
  text(ctx, 'acquire, never re-acquire after release', 130, 770, { size: 20, color: C.dim, alpha: p(t, 28.4, 29) });
  // OCC phases
  ['READ', 'VALIDATE', 'WRITE'].forEach((n, i) => { const a = p(t, 26 + i * 1.1, 26.6 + i * 1.1, ease.back); box(ctx, { x: 730 + 0, y: 310 + i * 130, w: 460, h: 100, label: (i + 1) + '. ' + n, sub: ['private copy, no locks', 'did anyone change my reads?', 'install if clean, else retry'][i], color: C.warn, alpha: a, size: 28, subSize: 20 }); if (i) arrow(ctx, [[960, 310 + i * 130 - 28], [960, 310 + i * 130]], { color: C.dim, progress: a, width: 3 }); });
  text(ctx, 'wins with low contention', 730, 770, { size: 20, color: C.dim, alpha: p(t, 29.6, 30.2) });
  // MVCC lanes
  const lane = (y, n, c, ts) => { text(ctx, n, 1330, y - 14, { size: 20, color: c, alpha: p(t, ts, ts + .5) }); ctx.save(); ctx.globalAlpha *= p(t, ts, ts + .5); ctx.fillStyle = hexA(c, .25); ctx.fillRect(1330, y, 460, 36); ctx.restore(); };
  lane(330, 'writer T2: UPDATE row (new version)', C.accent, 28.6); lane(430, 'reader T1: SELECT (old version)', C.good, 29); const mv = p(t, 29.4, 33, ease.lin);
  ctx.save(); ctx.globalAlpha *= p(t, 29.4, 30); ctx.fillStyle = C.accent; rrect(ctx, 1330, 330, 460 * mv, 36, 6); ctx.fill(); ctx.fillStyle = C.good; rrect(ctx, 1330, 430, 460 * mv, 36, 6); ctx.fill(); ctx.restore();
  text(ctx, 'neither waits for the other', 1330, 540, { size: 24, color: C.good, weight: 700, alpha: p(t, 30.4, 31.2) }); text(ctx, 'Postgres · InnoDB · Oracle · Spanner · DuckDB', 1330, 585, { size: 20, color: C.dim, alpha: p(t, 31.4, 32) });
  ctx.restore();
}
function mvcc(ctx, t) {
  const s = win(t, 34.2, 43.6, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'MVCC VERSION CHAIN   —   row acct[A]');
  const V = [['v1', 10, 25, 500, 220], ['v2', 25, 40, 400, 760], ['v3', 40, '∞', 350, 1300]];
  V.forEach(([n, b, e, val, x], i) => { const a = p(t, 35 + i * .7, 35.6 + i * .7, ease.back); const dead = i === 0 && t > 41.2; box(ctx, { x, y: 300, w: 440, h: 180, color: dead ? C.dim : C.accent, alpha: clamp(a) * (dead ? 1 - p(t, 41.2, 42.4) : 1), r: 12 }); text(ctx, n + '  bal = $' + val, x + 30, 350, { size: 30, weight: 800, mono: true, alpha: a * (dead ? 1 - p(t, 41.2, 42.4) : 1) }); text(ctx, 'begin_ts = ' + b, x + 30, 400, { size: 22, mono: true, color: C.good, alpha: a * (dead ? 1 - p(t, 41.2, 42.4) : 1) }); text(ctx, 'end_ts   = ' + e, x + 30, 440, { size: 22, mono: true, color: C.bad, alpha: a * (dead ? 1 - p(t, 41.2, 42.4) : 1) });
    if (i) arrow(ctx, [[x, 390], [V[i - 1][4] + 440, 390]], { color: C.dim, progress: a, width: 3, label: i === 1 ? 'older' : '', labelDy: -14 }); });
  text(ctx, 'newest → oldest via prev pointer (Postgres: heap tuples; InnoDB: undo log)', 220, 255, { size: 20, color: C.dim, alpha: p(t, 36.4, 37.2) });
  const T = [['T1  snapshot=20', 20, 220, C.good, 37.4, 0], ['T2  snapshot=30', 30, 760, C.warn, 38.4, 1], ['T3  snapshot=45', 45, 1300, C.purple, 39.4, 2]];
  T.forEach(([n, ts, x, c, at, vi]) => { const a = p(t, at, at + .6); const bx = x + 40; box(ctx, { x: bx - 30, y: 620, w: 400, h: 70, label: n, color: c, size: 24, alpha: a, mono: true }); arrow(ctx, [[bx + 170, 620], [bx + 170, 484]], { color: c, progress: a, width: 3, label: 'sees ' + ['v1', 'v2', 'v3'][vi], labelDy: 36 }); packet(ctx, [[bx + 170, 620], [bx + 170, 484]], p(t, at + .3, at + 1.3), { color: c, size: 8 }); });
  text(ctx, 'visible if begin_ts ≤ snapshot < end_ts', 220, 760, { size: 26, color: C.fg, mono: true, alpha: p(t, 40, 40.8) });
  callout(ctx, 'VACUUM / purge: no snapshot older than 30 → v1 reclaimed', 760, 830, { color: C.bad, alpha: p(t, 41, 41.8), align: 'center', size: 22 });
  ctx.restore();
}
function anomalies(ctx, t) {
  const s = win(t, 44, 52.4, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'ANOMALY: WRITE SKEW   —   invariant: at least one doctor on call');
  const st = n => (t > 49 ? 'OFF' : t > 47.3 && n === 'A' ? 'OFF' : t > 48.3 && n === 'B' ? 'OFF' : 'ON');
  ['Alice', 'Bob'].forEach((n, i) => { const k = i ? 'B' : 'A'; const off = st(k) === 'OFF'; box(ctx, { x: 120 + i * 260, y: 190, w: 230, h: 100, label: n, sub: off ? 'off call' : 'on call', color: off ? C.bad : C.good, size: 28, alpha: p(t, 44.4, 45), glow: off ? .6 : 0 }); });
  [['T1', 'Alice goes off call', 47.3, 120, C.accent], ['T2', 'Bob goes off call', 48.3, 500, C.warn]].forEach(([n, d, at, x, c], i) => { const y = 380 + i * 160; text(ctx, n, 120, y + 6, { size: 28, weight: 800, color: c, alpha: p(t, 45.2, 45.8) });
    [['read: count(on call) = 2', 45.8 + i * .5], ['→ safe, update my row', 46.8 + i * .3], [d, at], ['COMMIT ✓', at + .8]].forEach(([l, ts2], j) => { box(ctx, { x: 190 + j * 220, y: y - 28, w: 205, h: 64, label: l, color: c, size: 17, alpha: p(t, ts2, ts2 + .5), r: 10 }); }); });
  text(ctx, 'snapshot isolation: no write-write conflict (different rows) → both commit', 120, 640, { size: 24, color: C.warn, alpha: p(t, 49.2, 50) });
  text(ctx, 'on call = 0  ✗  invariant broken', 120, 700, { size: 40, color: C.bad, weight: 800, alpha: p(t, 49.6, 50.4), glow: 14 });
  text(ctx, 'fix: SERIALIZABLE (SSI / 2PL / predicate locks) or SELECT … FOR UPDATE', 120, 760, { size: 22, color: C.dim, alpha: p(t, 50.6, 51.4) });
  // matrix right
  const mx = 1180, my = 190; const cols = ['dirty', 'non-rep.', 'phantom', 'skew']; const rows = [['READ UNCOMM.', [1, 1, 1, 1]], ['READ COMMITTED', [0, 1, 1, 1]], ['REPEATABLE READ', [0, 0, 1, 1]], ['SERIALIZABLE', [0, 0, 0, 0]]];
  text(ctx, 'anomalies allowed (✕) / prevented (✓)', mx, my - 14, { size: 20, color: C.dim, alpha: p(t, 46, 46.6) }); cols.forEach((c, j) => text(ctx, c, mx + 290 + j * 90, my + 20, { size: 17, color: C.dim, align: 'center', alpha: p(t, 46, 46.6) }));
  rows.forEach(([n, r], i) => { const a = p(t, 46.4 + i * .4, 47 + i * .4); text(ctx, n, mx, my + 70 + i * 60, { size: 19, weight: 700, alpha: a, base: 'middle' }); r.forEach((v, j) => text(ctx, v ? '✕' : '✓', mx + 290 + j * 90, my + 70 + i * 60, { size: 28, color: v ? C.bad : C.good, align: 'center', base: 'middle', alpha: a, weight: 800 })); });
  text(ctx, '(Postgres RR = snapshot isolation: no phantoms, but skew)', mx, my + 330, { size: 17, color: C.dim, alpha: p(t, 49.5, 50.3) });
  ctx.restore();
}
function deadlock(ctx, t) {
  const s = win(t, 52.8, 62, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'DEADLOCK   —   wait-for graph');
  const N = { T1: [960, 260], T2: [1260, 640], T3: [660, 640] }; const dead = t > 59; const cyc = t > 56.6 && !dead;
  const info = [['T1 holds lock A, wants B', 53.6], ['T2 holds lock B, wants C', 54.4], ['T3 holds lock C, wants A', 55.2]];
  info.forEach(([l, ts], i) => text(ctx, l, 100, 260 + i * 50, { size: 26, mono: true, alpha: p(t, ts, ts + .6), color: [C.accent, C.warn, C.purple][i] }));
  [['T1', 'T2', 53.8], ['T2', 'T3', 54.6], ['T3', 'T1', 55.4]].forEach(([a, b, ts]) => { const A = N[a], B = N[b]; const dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy); const ux = dx / d, uy = dy / d; if (dead && (a === 'T3' || b === 'T3')) return; arrow(ctx, [[A[0] + ux * 60, A[1] + uy * 60], [B[0] - ux * 62, B[1] - uy * 62]], { color: cyc ? C.bad : C.dim, width: cyc ? 5 : 3, progress: p(t, ts, ts + .7), label: 'waits for', labelDy: 0, alpha: 1 }); });
  Object.entries(N).forEach(([n, [x, y]], i) => { const gone = dead && n === 'T3'; const a = p(t, 53.2 + i * .2, 53.8 + i * .2, ease.back) * (gone ? 1 - p(t, 59, 60) : 1); ctx.save(); ctx.globalAlpha *= clamp(a); ctx.beginPath(); ctx.arc(x, y, 56, 0, 7); ctx.fillStyle = hexA(cyc || (n === 'T3' && t > 58) ? C.bad : C.accent, .25); ctx.fill(); ctx.strokeStyle = cyc ? C.bad : C.accent; ctx.lineWidth = 3; ctx.shadowColor = cyc ? C.bad : C.accent; ctx.shadowBlur = 18; ctx.stroke(); ctx.restore(); text(ctx, n, x, y, { size: 34, weight: 800, align: 'center', base: 'middle', alpha: clamp(a) }); });
  if (cyc) text(ctx, 'CYCLE DETECTED', 960, 760, { size: 40, color: C.bad, weight: 900, align: 'center', glow: 20, alpha: p(t, 56.6, 57.2) });
  if (t > 58.2) { callout(ctx, 'abort victim T3 (youngest / least work) → locks released', 960, 820, { color: C.good, alpha: p(t, 58.2, 58.9), align: 'center' }); }
  if (dead) text(ctx, 'T1 and T2 proceed; T3 retries', 960, 740, { size: 30, color: C.good, align: 'center', weight: 700, alpha: p(t, 59.6, 60.4) });
  text(ctx, 'alternatives: lock timeouts · wait-die / wound-wait · ordered acquisition', 100, 850 - 20, { size: 20, color: C.dim, alpha: p(t, 60, 60.8) });
  ctx.restore();
}
function dial(ctx, t) {
  const s = win(t, 62.4, 69.6, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'THE ISOLATION DIAL');
  const lv = ['Read Uncommitted', 'Read Committed', 'Repeatable Read / Snapshot', 'Serializable']; const x0 = 200, x1 = 1720, y = 450;
  ctx.fillStyle = 'rgba(138,147,181,.3)'; ctx.fillRect(x0, y - 3, x1 - x0, 6); const k = p(t, 63.2, 67, ease.inOut) * 3;
  lv.forEach((n, i) => { const x = lerp(x0, x1, i / 3); const on = Math.abs(k - i) < .5; ctx.beginPath(); ctx.arc(x, y, on ? 20 : 12, 0, 7); ctx.fillStyle = on ? C.accent : C.dim; ctx.shadowColor = C.accent; ctx.shadowBlur = on ? 24 : 0; ctx.fill(); ctx.shadowBlur = 0; text(ctx, n, x, y + 70, { size: 22, align: 'center', color: on ? C.fg : C.dim, weight: on ? 800 : 500 }); });
  const kx = lerp(x0, x1, k / 3); ctx.beginPath(); ctx.arc(kx, y, 26, 0, 7); ctx.strokeStyle = C.warn; ctx.lineWidth = 4; ctx.stroke();
  text(ctx, 'concurrency / throughput', 200, 280, { size: 24, color: C.good }); bar(ctx, 200, 300, 1100 * (1 - k / 3 * .7), 28, 1, C.good);
  text(ctx, 'correctness guarantees', 200, 610, { size: 24, color: C.accent }); bar(ctx, 200, 630, 1100 * (.25 + k / 3 * .75), 28, 1, C.accent);
  ctx.restore();
}
