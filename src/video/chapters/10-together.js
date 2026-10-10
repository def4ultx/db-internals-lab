import { W, C, L, LAYERS, p, ease, win, hexA, lerp, text, box, arrow, packet, pill, callout, rrect, clamp, kinetic, measure } from '../helpers.js';
export const title = 'Putting it together';
export const subtitle = 'How choices ripple, and how real systems choose';
export const color = '#c0caf5';
export const duration = 56;
export const focus = ['client', 'frontend', 'planning', 'execution', 'txn', 'storage', 'distributed'];
export const narration = [
  { at: 0.6, text: 'Every choice ripples. An LSM tree brings bloom filters, compaction and write amplification. Columnar wants vectorized execution, compression and batch loads.' },
  { at: 12.4, text: 'Pick MVCC and you need garbage collection and snapshot timestamps; pick replication and the storage engine must also produce a log.' },
  { at: 22, text: 'That is why real systems differ. InnoDB: clustered B-plus tree, undo MVCC, row locks. Postgres: heap, append-only versions, vacuum. DuckDB and ClickHouse: columnar and vectorized.' },
  { at: 34, text: 'Cassandra and Bigtable: LSM, write-heavy, scale out. FoundationDB and TigerBeetle: deterministic simulation. Vitess shards MySQL; Umbra compiles queries to machine code.' },
  { at: 45.4, text: 'Now explore: the 3D explorer lets you swap these choices live, learn walks each layer, and compare lines the systems up.' },
];
const LAY = ['client', 'frontend', 'planning', 'execution', 'txn', 'storage', 'distributed'];
const LN = ['Client', 'SQL frontend', 'Planning', 'Execution', 'Txn & recovery', 'Storage', 'Distributed'];
const BW = 230, GAP = (1800 - 7 * BW) / 6; const bx = i => 60 + i * (BW + GAP);
const SCENES = [
  { t0: 3.2, t1: 12.2, at: 'storage', label: 'LSM tree', color: C.cyan, tags: { client: 'write-heavy workloads', frontend: 'key-value / wide-column API', planning: 'cost model: read amp', execution: 'merge iterators', txn: 'WAL + memtable', storage: 'bloom · compaction · SSTables', distributed: 'ship immutable files' } },
  { t0: 12.6, t1: 17.4, at: 'storage', label: 'Columnar', color: C.good, tags: { client: 'bulk / batch loads', frontend: 'SELECT few columns of many', planning: 'zone-map pruning stats', execution: 'vectorized + SIMD', txn: 'coarse locks, batch commits', storage: 'compression · row groups', distributed: 'partitioned files, MPP' } },
  { t0: 17.6, t1: 21.8, at: 'txn', label: 'MVCC + replication', color: C.bad, tags: { client: 'snapshot reads don’t block', frontend: 'isolation level choice', planning: 'plan sees one snapshot', execution: 'visibility checks per tuple', txn: 'version chains · vacuum', storage: 'extra versions on pages', distributed: 'log → replicas, timestamps' } },
];
const SYS = [
  ['MySQL / InnoDB', 'clustered B+tree', 'Volcano, row-at-a-time', 'MVCC (undo) + row locks', 'binlog async / semi-sync'],
  ['PostgreSQL', 'heap + B-tree indexes', 'Volcano (+ optional JIT)', 'MVCC append-only, vacuum', 'WAL streaming'],
  ['DuckDB', 'columnar row groups', 'vectorized, morsel push', 'MVCC, optimistic', 'embedded, single node'],
  ['ClickHouse', 'MergeTree columnar parts', 'vectorized pipelines', 'insert-level atomicity', 'shards + Keeper (Raft)'],
  ['StarRocks', 'columnar tablets', 'vectorized MPP', 'versioned batch ingest', 'FE/BE replicas'],
  ['Spark SQL', 'Parquet/ORC on S3/HDFS', 'whole-stage codegen + AQE', 'none (Delta/Iceberg add)', 'shuffle, stateless execs'],
  ['Cassandra', 'LSM SSTables', 'single-partition reads', 'no txns (LWT via Paxos)', 'leaderless, tunable'],
  ['FoundationDB', 'ordered KV (B-tree)', 'KV API + layers', 'OCC + MVCC, strict serial', 'sync log replication'],
  ['TigerBeetle', 'LSM forest', 'batched state machine', 'strict serial, single leader', 'VSR consensus'],
  ['Umbra', 'var-size page buffer mgr', 'compiled (LLVM), adaptive', 'optimistic MVCC', 'single node'],
  ['Bigtable', 'LSM tablets on Colossus', 'scans, no joins', 'single-row transactions', 'tablet servers + GFS'],
  ['Vitess', 'MySQL / InnoDB shards', 'vtgate scatter-gather', 'per-shard MySQL, 2PC', 'vindex sharding'],
];
const HEAD = ['System', 'Storage / index', 'Execution', 'Concurrency control', 'Replication / scale'];
const CW = [250, 340, 360, 390, 360], CX = [70, 320, 660, 1020, 1410];
export function draw(ctx, t, h) {
  const sA = win(t, 2.8, 22.3, .5);
  if (sA > 0) { ctx.save(); ctx.globalAlpha *= sA; text(ctx, 'ONE DESIGN CHOICE → A RIPPLE ACROSS THE STACK', 80, 135, { size: 28, color: C.fg, weight: 700 });
    const sc = SCENES.find(s => t >= s.t0 - .3 && t < s.t1 + .3) || SCENES[0]; const si = SCENES.indexOf(sc); const sa = win(t, sc.t0 - .2, sc.t1, .5);
    LAY.forEach((id, i) => { const a = p(t, 3 + i * .1, 3.6 + i * .1, ease.back); const at = LAY.indexOf(sc.at); const dist = Math.abs(i - at); const ring = p(t, sc.t0 + .4 + dist * .55, sc.t0 + 1 + dist * .55); const g = ring > 0 && ring <= 1 ? 1 : 0; const on = t > sc.t0 + .6 + dist * .55;
      box(ctx, { x: bx(i), y: 330, w: BW, h: 100, label: LN[i], color: L[id], alpha: clamp(a), size: 24, glow: (on && sa > .3 ? .35 : 0) + g * .6 + (i === at && sa > .3 ? .6 : 0), scale: .9 + .1 * clamp(a) });
      if (on) { ctx.save(); ctx.globalAlpha *= sa; const lines = sc.tags[id].split(' · '); box(ctx, { x: bx(i) + 4, y: 470, w: BW - 8, h: 40 + lines.length * 34, color: L[id], r: 10, alpha: p(t, sc.t0 + .6 + dist * .55, sc.t0 + 1 + dist * .55) }); lines.forEach((ln, k) => text(ctx, ln, bx(i) + BW / 2, 510 + k * 34, { size: 19, align: 'center', color: C.fg, weight: 600, maxWidth: BW - 20, alpha: p(t, sc.t0 + .7 + dist * .55, sc.t0 + 1.2 + dist * .55) })); ctx.restore(); }
      if (i !== at) { const x1 = bx(at) + BW / 2, x2 = bx(i) + BW / 2; const pts = [[x1, 330], [x1, 290], [x2, 290], [x2, 330]]; arrow(ctx, pts, { color: hexA(sc.color, .5 * sa), width: 2, progress: p(t, sc.t0 + .2 + dist * .3, sc.t0 + .8 + dist * .55), head: true, alpha: sa }); packet(ctx, pts, p(t, sc.t0 + .3 + dist * .3, sc.t0 + 1 + dist * .55), { color: sc.color, size: 7, alpha: sa }); } });
    // choice badge
    const at = LAY.indexOf(sc.at); ctx.save(); ctx.globalAlpha *= sa; for (let r = 0; r < 3; r++) { const u = ((t - sc.t0) * .45 + r / 3) % 1; ctx.strokeStyle = hexA(sc.color, (1 - u) * .5); ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(bx(at) + BW / 2, 380, 120 + u * 800, 60 + u * 70, 0, 0, 7); ctx.stroke(); } ctx.restore();
    pill(ctx, 'choice: ' + sc.label, bx(at) + BW / 2, 570 + 160, { color: sc.color, size: 26, alpha: sa }); arrow(ctx, [[bx(at) + BW / 2, 700], [bx(at) + BW / 2, 560 + (sc.tags[sc.at].split(' · ').length) * 34 + 20]], { color: sc.color, width: 3, progress: sa, alpha: sa });
    text(ctx, ['Write-optimised — but reads touch many files', 'Scan-optimised — but point updates get expensive', 'Concurrency without blocking — paid for in garbage collection'][si], 960, 820, { size: 28, color: sc.color, align: 'center', weight: 700, alpha: sa });
    ctx.restore(); }
  // ---- matrix
  const sB = win(t, 22.4, 45, .5);
  if (sB > 0) { ctx.save(); ctx.globalAlpha *= sB; text(ctx, 'TWELVE REAL SYSTEMS, TWELVE BUNDLES OF CHOICES', 80, 135, { size: 28, color: C.fg, weight: 700 });
    const y0 = 165, rh = 48; HEAD.forEach((hd, j) => { text(ctx, hd, CX[j], y0 + 26, { size: 22, color: [C.fg, L.storage, L.execution, L.txn, L.distributed][j], weight: 800, base: 'middle', alpha: p(t, 22.8, 23.4) }); }); ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(70, y0 + 48, 1700 * p(t, 22.8, 23.6), 2);
    SYS.forEach((r, i) => { const at = 23.4 + i * (i < 6 ? 1.55 : 1.0) + (i >= 6 ? 0 : 0); const t0 = i < 6 ? 23.2 + i * 1.7 : 34 + (i - 6) * 1.4; const a = p(t, t0, t0 + .5); const y = y0 + 58 + i * rh; if (a <= 0) return; const hl = t > t0 && t < t0 + 1.4;
      ctx.save(); ctx.globalAlpha *= a; rrect(ctx, 60, y, 1790, rh - 6, 10); ctx.fillStyle = hl ? 'rgba(122,162,247,.18)' : (i % 2 ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.015)'); ctx.fill(); if (hl) { ctx.strokeStyle = hexA(C.accent, .8); ctx.lineWidth = 1.5; ctx.stroke(); } ctx.restore();
      r.forEach((v, j) => text(ctx, v, CX[j] + (1 - a) * 30, y + (rh - 6) / 2, { size: j ? 20 : 21, color: j ? C.fg : C.accent, weight: j ? 500 : 800, base: 'middle', alpha: a, maxWidth: CW[j] - 14 })); });
    ctx.restore(); }
  // ---- outro
  const sC = win(t, 45.4, 55.8, .5);
  if (sC > 0) { ctx.save(); ctx.globalAlpha *= sC;
    kinetic(ctx, 'Every design choice is a trade-off.', 960, 330, t, 46, { size: 84, color: C.fg, glow: 12, colors: [] });
    text(ctx, 'Understand the trade-off and the whole system becomes predictable.', 960, 430, { size: 32, color: C.dim, align: 'center', weight: 500, alpha: p(t, 48, 49) });
    [['3D Explorer', 'swap choices, watch internals', C.accent, 49.4], ['Learn', 'layer-by-layer lessons', C.good, 50.3], ['Compare', 'systems side by side', C.warn, 51.2]].forEach(([n, d, c, ts], i) => { const a = p(t, ts, ts + .6, ease.back); box(ctx, { x: 190 + i * 520, y: 550, w: 480, h: 190, label: n, sub: d, color: c, size: 44, subSize: 24, alpha: clamp(a), glow: .3 + .2 * Math.sin(t * 3 + i), scale: .85 + .15 * clamp(a) }); });
    text(ctx, 'DB Internals Lab', 960, 860 - 40, { size: 26, color: C.dim, align: 'center', alpha: p(t, 52.5, 53.5) });
    ctx.restore(); }
}
