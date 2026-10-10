import { W, C, L, p, ease, win, hexA, hash, lerp, text, box, arrow, packet, pill, callout, rrect, clamp, cells, bar } from '../helpers.js';
export const title = 'Durability';
export const subtitle = 'Write-ahead log · steal/no-force · ARIES recovery · binlog';
export const color = '#f7768e';
export const duration = 52;
export const focus = ['txn', 'storage'];
export const narration = [
  { at: 0.6, text: 'Durability means a committed transaction survives a crash. The trick is the write-ahead log: append a record describing the change, and flush it to disk before the data page itself.' },
  { at: 13.3, text: 'Fsync is slow, so group commit batches many commits into one flush. Steal lets uncommitted pages reach disk; no-force lets commits skip writing pages. ARIES chooses both.' },
  { at: 24.2, text: 'Now the power fails and the buffer pool vanishes. On restart, ARIES analyzes the log, redoes history, then undoes the losers.' },
  { at: 35.6, text: 'Checkpoints bound how far back recovery scans. MySQL keeps two logs, InnoDB redo for crashes and the binlog for replication, kept consistent by an internal two-phase commit.' },
  { at: 47.8, text: 'Postgres ships its WAL to replicas.' },
];
const hdr = (ctx, s) => text(ctx, s, 80, 135, { size: 28, color: L.txn, weight: 700 });
export function draw(ctx, t, h) { wal(ctx, t); policies(ctx, t); recovery(ctx, t); logs(ctx, t); ship(ctx, t); }
function wal(ctx, t) {
  const s = win(t, 2.8, 13.1, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'WRITE-AHEAD LOGGING   —   log first, page later');
  box(ctx, { x: 100, y: 230, w: 300, h: 100, label: 'Transaction T7', sub: 'COMMIT', color: L.client, size: 26, alpha: p(t, 3, 3.6) });
  box(ctx, { x: 560, y: 190, w: 520, h: 170, color: L.txn, alpha: p(t, 3.4, 4), r: 12 }); text(ctx, 'LOG BUFFER (RAM)', 580, 225, { size: 22, color: L.txn, weight: 700, alpha: p(t, 3.6, 4.2) });
  box(ctx, { x: 560, y: 520, w: 520, h: 220, color: L.txn, alpha: p(t, 3.6, 4.2), r: 12 }); text(ctx, 'LOG FILE (disk, sequential append)', 580, 555, { size: 22, color: L.txn, weight: 700, alpha: p(t, 3.8, 4.4) });
  box(ctx, { x: 1260, y: 190, w: 540, h: 170, color: L.storage, alpha: p(t, 4, 4.6), r: 12 }); text(ctx, 'BUFFER POOL (RAM)', 1280, 225, { size: 22, color: L.storage, weight: 700, alpha: p(t, 4.2, 4.8) });
  box(ctx, { x: 1260, y: 520, w: 540, h: 220, color: L.storage, alpha: p(t, 4.2, 4.8), r: 12 }); text(ctx, 'DATA FILE (disk, random writes)', 1280, 555, { size: 22, color: L.storage, weight: 700, alpha: p(t, 4.4, 5) });
  // 1 update modifies page in buffer pool and appends record
  const rec = 'LSN 1042 | prev 1038 | T7 | page 17 | undo bal=500 | redo bal=400';
  box(ctx, { x: 1290, y: 250, w: 220, h: 80, label: 'page 17', sub: t > 6 ? 'dirty  pageLSN=1042' : 'bal=500', color: t > 6 ? C.warn : L.storage, size: 24, subSize: 16, alpha: p(t, 4.6, 5.2), glow: t > 6 && t < 7 ? .8 : 0 });
  const r1 = p(t, 6, 6.8); box(ctx, { x: 580, y: 250, w: 480, h: 80, color: C.accent, alpha: r1, r: 10 }); text(ctx, 'LSN 1042  prev 1038  T7  page 17', 600, 280, { size: 19, mono: true, alpha: r1 }); text(ctx, 'undo: bal=500   redo: bal=400', 600, 308, { size: 19, mono: true, alpha: r1, color: C.warn });
  text(ctx, '① UPDATE: change page in RAM, append record', 100, 440, { size: 22, color: C.fg, alpha: p(t, 5.6, 6.2) });
  arrow(ctx, [[400, 280], [560, 290]], { color: C.accent, progress: p(t, 5.6, 6.2), width: 3 }); packet(ctx, [[400, 280], [560, 290]], p(t, 5.8, 6.5), { color: C.accent, size: 8 });
  // 2 fsync
  const fs = p(t, 8, 9.2); arrow(ctx, [[820, 360], [820, 520]], { color: C.bad, progress: p(t, 8, 8.6), width: 4, label: 'fsync', labelDy: 0 }); packet(ctx, [[820, 360], [820, 520]], fs, { color: C.bad, size: 11 });
  if (t > 9.2) { box(ctx, { x: 580, y: 600, w: 480, h: 80, color: C.accent, r: 10, glow: .5, alpha: p(t, 9.2, 9.6) }); text(ctx, 'LSN 1042 | T7 | page 17 | undo/redo', 600, 640, { size: 19, mono: true, alpha: p(t, 9.2, 9.6) }); }
  text(ctx, '② COMMIT: fsync log → durable → ack client', 100, 480, { size: 22, color: C.good, alpha: p(t, 8, 8.6) });
  if (t > 9.8) { packet(ctx, [[580, 600], [200, 330]], p(t, 9.8, 10.8), { color: C.good, size: 9, label: 'ack' }); }
  // 3 lazy flush
  text(ctx, '③ later: background writer flushes page 17 (only if log LSN ≥ pageLSN)', 100, 520, { size: 22, color: C.warn, alpha: p(t, 10.8, 11.5) });
  arrow(ctx, [[1530, 330], [1530, 520]], { color: C.warn, progress: p(t, 11, 11.6), width: 3, dashed: true }); packet(ctx, [[1530, 330], [1530, 520]], p(t, 11.2, 12.4), { color: C.warn, size: 9 });
  text(ctx, 'sequential log append ≈ 100× faster than random page writes', 100, 800, { size: 24, color: C.fg, alpha: p(t, 11.6, 12.4), weight: 700 });
  ctx.restore();
}
function policies(ctx, t) {
  const s = win(t, 13.5, 24, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'GROUP COMMIT   +   BUFFER-POOL POLICY');
  text(ctx, 'group commit', 100, 220, { size: 28, weight: 800, color: C.accent, alpha: p(t, 14, 14.6) });
  for (let i = 0; i < 6; i++) { const at = 14.6 + i * .35, a = p(t, at, at + .4, ease.back); const flush = p(t, 17.8, 18.8); box(ctx, { x: 100 + (i % 3) * 190, y: 260 + Math.floor(i / 3) * 90, w: 170, h: 70, label: 'T' + (i + 1) + ' COMMIT', color: flush > 0 ? C.good : C.warn, size: 20, alpha: a, r: 10, glow: flush > 0 && flush < 1 ? .8 : 0 }); }
  box(ctx, { x: 100, y: 500, w: 550, h: 90, label: 'one fsync covers all six', sub: '6 commits / 1 flush', color: C.bad, size: 26, subSize: 18, alpha: p(t, 17, 17.8) });
  arrow(ctx, [[375, 440], [375, 500]], { color: C.bad, progress: p(t, 17.2, 17.8), width: 3 }); packet(ctx, [[375, 440], [375, 500]], p(t, 17.4, 18.2), { color: C.bad, size: 8 });
  text(ctx, 'throughput ↑, commit latency + a few hundred µs', 100, 650, { size: 22, color: C.dim, alpha: p(t, 19, 19.8) });
  // grid
  const gx = 800, gy = 230; text(ctx, 'when may a dirty page be written?', gx, gy - 24, { size: 24, weight: 800, color: C.warn, alpha: p(t, 17.5, 18.2) });
  ['FORCE at commit', 'NO-FORCE'].forEach((n, j) => text(ctx, n, gx + 270 + j * 380, gy + 30, { size: 22, color: C.dim, align: 'center', alpha: p(t, 18, 18.6) })); ['NO-STEAL', 'STEAL'].forEach((n, i) => text(ctx, n, gx + 90, gy + 140 + i * 210, { size: 22, color: C.dim, align: 'center', alpha: p(t, 18, 18.6) }));
  const cellsd = [['no undo, no redo\nslow commits (random I/O)', C.dim], ['redo only\nbuffer must fit all dirty pages', C.dim], ['undo only\nforce = slow', C.dim], ['ARIES: undo + redo\nfast commits, any buffer size', C.good]];
  cellsd.forEach(([l, c], k) => { const i = Math.floor(k / 2), j = k % 2, a = p(t, 18.4 + k * .5, 19 + k * .5, ease.back); const win_ = k === 3 && t > 21; box(ctx, { x: gx + 170 + j * 380, y: gy + 50 + i * 210, w: 360, h: 190, color: win_ ? C.good : c, alpha: clamp(a), glow: win_ ? .8 : 0, r: 12 }); l.split('\n').forEach((q, z) => text(ctx, q, gx + 350 + j * 380, gy + 130 + i * 210 + z * 36, { size: z ? 19 : 24, color: z ? C.dim : C.fg, align: 'center', weight: z ? 500 : 800, alpha: a, maxWidth: 340 })); });
  ctx.restore();
}
function recovery(ctx, t) {
  const s = win(t, 24.4, 35.4, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'CRASH   →   ARIES RECOVERY');
  const recs = [['CP', 'checkpoint', C.cyan], ['1', 'T1 upd P5', C.accent], ['2', 'T2 upd P7', C.warn], ['3', 'T1 commit', C.accent], ['4', 'T3 upd P5', C.purple], ['5', 'T2 upd P9', C.warn], ['6', 'T2 commit', C.warn], ['7', 'T3 upd P7', C.purple]];
  const lx = 100, ly = 230, step = 196;
  recs.forEach(([n, l, c], i) => { const a = p(t, 25 + i * .12, 25.5 + i * .12, ease.back); box(ctx, { x: lx + i * step, y: ly, w: 178, h: 90, label: l, sub: 'LSN ' + (1000 + i * 10), color: c, size: 20, subSize: 16, alpha: a, r: 10 }); });
  text(ctx, 'LOG on disk', lx, ly - 18, { size: 20, color: C.dim });
  // crash
  const cr = p(t, 25.8, 26.3); if (t > 25.8 && t < 28.6) { ctx.save(); ctx.fillStyle = hexA(C.bad, .18 * (1 - p(t, 26.8, 28.6))); ctx.fillRect(0, 0, W, 1080); ctx.restore(); text(ctx, '⚡ POWER LOSS', 960, 470, { size: 70, weight: 900, color: C.bad, align: 'center', glow: 30, alpha: p(t, 25.8, 26.2) * (1 - p(t, 27.6, 28.4)) }); }
  box(ctx, { x: lx + 8 * step - 5, y: ly, w: 100, h: 90, label: '✕', color: C.bad, size: 40, alpha: cr });
  // passes
  const ph = [['1 ANALYSIS', 'scan forward from checkpoint: rebuild dirty page table + active txn table', 28.6, 30.8, C.cyan], ['2 REDO', 'repeat history from min recLSN: if pageLSN < LSN, reapply (even for losers)', 30.8, 33.2, C.good], ['3 UNDO', 'roll back loser T3 backwards, writing CLRs', 33.2, 35.2, C.bad]];
  ph.forEach(([n, d, a0, a1, c], i) => { const y = 400 + i * 110; const a = p(t, a0, a0 + .5); text(ctx, n, 100, y, { size: 30, weight: 900, color: c, alpha: a }); text(ctx, d, 340, y, { size: 22, alpha: a, maxWidth: 1450 }); const cur = t >= a0 && t < a1; ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = hexA(c, .6); ctx.shadowColor = c; ctx.shadowBlur = 14; ctx.fillRect(100, y + 18, 1700 * p(t, a0, a1, ease.lin), 8); ctx.restore(); });
  // scanning cursor along the log
  let cx0 = null; if (t >= 28.6 && t < 30.8) cx0 = lerp(0, 7, p(t, 28.6, 30.8, ease.lin)); else if (t >= 30.8 && t < 33.2) cx0 = lerp(0, 7, p(t, 30.8, 33.2, ease.lin)); else if (t >= 33.2 && t < 35.2) cx0 = lerp(7, 4, p(t, 33.2, 35.2, ease.lin));
  if (cx0 !== null) { const x = lx + cx0 * step + 89; arrow(ctx, [[x, ly + 150], [x, ly + 96]], { color: t < 30.8 ? C.cyan : t < 33.2 ? C.good : C.bad, progress: 1, width: 5 }); }
  // tables
  if (t > 29.6) { text(ctx, 'dirty page table: P5 (rec 1010)  P7 (1020)  P9 (1050)', 100, 760, { size: 22, mono: true, color: C.cyan, alpha: p(t, 29.6, 30.4) }); text(ctx, 'txn table: T1 committed · T2 committed · T3 ACTIVE → loser', 100, 800, { size: 22, mono: true, color: C.cyan, alpha: p(t, 30, 30.8) }); }
  if (t > 34.2) text(ctx, 'database is now exactly the committed state', 100, 850, { size: 28, color: C.good, weight: 800, alpha: p(t, 34.2, 35), glow: 10 });
  ctx.restore();
}
function logs(ctx, t) {
  const s = win(t, 35.8, 47.6, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'CHECKPOINTS   &   TWO LOGS IN MySQL');
  // checkpoint timeline
  text(ctx, 'checkpoint bounds recovery work', 100, 215, { size: 26, weight: 800, color: C.cyan, alpha: p(t, 36, 36.6) });
  const y = 300; ctx.fillStyle = 'rgba(138,147,181,.4)'; ctx.fillRect(100, y, 700 * p(t, 36.3, 37.3), 4);
  [0.05, 0.3, 0.55, 0.75].forEach((u, i) => { const a = p(t, 37 + i * .2, 37.4 + i * .2); ctx.save(); ctx.globalAlpha *= a; ctx.beginPath(); ctx.arc(100 + 700 * u, y + 2, i === 2 ? 14 : 8, 0, 7); ctx.fillStyle = i === 2 ? C.cyan : C.dim; ctx.fill(); ctx.restore(); });
  text(ctx, 'old log → truncated', 150, y - 24, { size: 18, color: C.dim, alpha: p(t, 38, 38.6) }); text(ctx, 'last checkpoint', 100 + 700 * .55, y - 28, { size: 18, color: C.cyan, align: 'center', alpha: p(t, 38, 38.6) }); text(ctx, 'crash', 100 + 700 * .78, y - 28, { size: 18, color: C.bad, alpha: p(t, 38, 38.6) });
  ctx.save(); ctx.globalAlpha *= p(t, 38.4, 39.2); ctx.fillStyle = hexA(C.good, .3); ctx.fillRect(100 + 700 * .55, y - 10, 700 * .23, 24); ctx.restore(); text(ctx, 'recovery scans only this', 100 + 700 * .55, y + 56, { size: 20, color: C.good, alpha: p(t, 39, 39.8) });
  text(ctx, 'fuzzy checkpoints: flush dirty pages in the background, record the DPT', 100, 400, { size: 20, color: C.dim, alpha: p(t, 39.8, 40.6) });
  // MySQL
  const x0 = 100, y0 = 470; text(ctx, 'MySQL: internal two-phase commit between two logs', x0, y0 - 10, { size: 24, weight: 800, color: C.warn, alpha: p(t, 40.4, 41) });
  const B = [['InnoDB redo log', 'physical page changes, circular', 'crash recovery', L.txn, 100], ['Binary log', 'logical row events, append-only', 'replication, point-in-time', L.distributed, 1000]];
  B.forEach(([n, d, u, c, x], i) => box(ctx, { x, y: y0 + 30, w: 780, h: 140, label: n, sub: d + '  —  ' + u, color: c, size: 26, subSize: 19, alpha: p(t, 41 + i * .4, 41.6 + i * .4) }));
  const st = [['① redo: PREPARE (fsync)', 100, 43, L.txn], ['② binlog: write + fsync', 1000, 44.3, L.distributed], ['③ redo: COMMIT', 100, 45.6, L.txn]];
  st.forEach(([l, x, ts, c], i) => { text(ctx, l, x + 20, y0 + 220 + (i === 2 ? 40 : 0), { size: 24, color: c, weight: 700, alpha: p(t, ts, ts + .5) }); packet(ctx, [[x + 100, y0 + 30 + 140], [x + 100, y0 + 220]], p(t, ts, ts + .8), { color: c, size: 8 }); });
  text(ctx, 'crash between steps? recovery compares: binlog has txn → commit it, else roll back', 100, 800, { size: 22, color: C.fg, alpha: p(t, 46.2, 47) });
  ctx.restore();
}
function ship(ctx, t) {
  const s = win(t, 47.9, 51.8, .4); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'WAL SHIPPING   —   the log is also the replication stream');
  box(ctx, { x: 150, y: 330, w: 340, h: 200, label: 'Primary', sub: 'WAL writer', color: L.txn, size: 30, alpha: p(t, 48, 48.5) });
  [0, 1].forEach(i => { box(ctx, { x: 1300, y: 250 + i * 240, w: 340, h: 170, label: 'Replica ' + (i + 1), sub: 'replays WAL', color: L.distributed, size: 28, alpha: p(t, 48.3 + i * .2, 48.8 + i * .2) }); const pts = [[490, 430], [900, 335 + i * 190], [1300, 335 + i * 240]]; arrow(ctx, pts, { color: C.bad, progress: p(t, 48.6, 49.2), width: 3, label: 'WAL records', labelAt: .55 }); for (let k = 0; k < 3; k++) packet(ctx, pts, ((t - 49) * .7 + k / 3) % 1, { color: C.bad, size: 8, alpha: p(t, 49, 49.4) }); });
  ctx.restore();
}
