import { W, C, L, p, ease, win, hexA, hash, lerp, text, box, arrow, packet, pill, callout, rrect, clamp, cells, bar, pathPoint } from '../helpers.js';
export const title = 'Distributed databases';
export const subtitle = 'Sharding · replication · Raft · 2PC vs Calvin · clocks · disaggregated storage';
export const color = '#ff9e64';
export const duration = 68;
export const focus = ['distributed', 'txn'];
export const narration = [
  { at: 0.6, text: 'One machine eventually runs out of room. Sharding splits the data by hash, by range, or on a consistent-hash ring, and a router sends each key to its shard.' },
  { at: 12.2, text: 'Replication keeps copies. Synchronous replication waits for followers: safe but slow. Asynchronous acknowledges early: fast, but a failover can lose recent writes.' },
  { at: 21.6, text: 'Raft makes replication safe. Followers elect a leader by majority vote in a numbered term, and an entry commits once a majority holds it, so any new leader has it.' },
  { at: 34.4, text: 'Across shards, two-phase commit has every participant prepare, then commit, but it blocks if the coordinator dies. Calvin orders transactions up front and skips it.' },
  { at: 45.6, text: 'Clocks matter too. Lamport counters order events, hybrid logical clocks track wall time, and Spanner TrueTime exposes uncertainty and waits it out before commit.' },
  { at: 56, text: 'Finally, cloud databases separate compute from storage: stateless nodes cache data from an object store like S3, so each scales independently.' },
];
const D = L.distributed;
const hdr = (ctx, s) => text(ctx, s, 80, 135, { size: 28, color: D, weight: 700 });
const node = (ctx, x, y, w, h, label, sub, color, a = 1, extra = {}) => box(ctx, { x: x - w / 2, y: y - h / 2, w, h, label, sub, color, alpha: a, size: 24, subSize: 17, ...extra });
export function draw(ctx, t, h) { sharding(ctx, t); replication(ctx, t); raft(ctx, t); commit(ctx, t); clocks(ctx, t); disagg(ctx, t); }
function sharding(ctx, t) {
  const s = win(t, 2.8, 12, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'SHARDING   —   who owns this key?');
  node(ctx, 230, 480, 240, 120, 'Router / coordinator', 'shard map', D, p(t, 3, 3.6));
  const sh = [0, 1, 2, 3]; const SY = [260, 400, 540, 680];
  sh.forEach(i => node(ctx, 700, SY[i], 240, 100, 'Shard ' + i, i === 0 ? 'hash%4 = 0' : 'hash%4 = ' + i, L.storage, p(t, 3.4 + i * .2, 4 + i * .2)));
  const keys = [['user:17', 1], ['user:42', 3], ['user:8', 0], ['user:91', 2], ['user:5', 1], ['user:63', 0]];
  keys.forEach(([k, d], i) => { const at = 4.6 + i * .8; const pts = [[350, 480], [580, SY[d]]]; arrow(ctx, pts, { color: hexA(D, .18), progress: 1, width: 2, head: false, alpha: p(t, 4, 4.6) }); packet(ctx, pts, p(t, at, at + .8), { color: D, size: 8, label: p(t, at, at + .8) < .6 ? k : '' }); });
  text(ctx, 'hash(key) mod N: even spread, but resharding moves ~everything', 100, 760, { size: 22, color: C.dim, alpha: p(t, 6, 6.8) });
  text(ctx, 'range partitioning keeps scans local but can create hot spots', 100, 800, { size: 22, color: C.dim, alpha: p(t, 7.4, 8.2) });
  // ring
  const cx = 1380, cy = 500, R = 190; const ra = p(t, 7, 7.8); ctx.save(); ctx.globalAlpha *= ra; ctx.strokeStyle = hexA(D, .5); ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke(); ctx.restore();
  text(ctx, 'consistent-hash ring', cx, cy - R - 40, { size: 24, color: D, align: 'center', weight: 700, alpha: ra });
  const ns = [0.05, 0.3, 0.55, 0.8]; const add = p(t, 9.4, 10.2, ease.back);
  ns.forEach((u, i) => { const a = u * Math.PI * 2 - Math.PI / 2; ctx.save(); ctx.globalAlpha *= ra; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 18, 0, 7); ctx.fillStyle = [C.accent, C.good, C.warn, C.purple][i]; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 16; ctx.fill(); ctx.restore(); text(ctx, 'N' + (i + 1), cx + Math.cos(a) * (R + 42), cy + Math.sin(a) * (R + 42), { size: 20, align: 'center', base: 'middle', alpha: ra }); });
  const a5 = .42 * Math.PI * 2 - Math.PI / 2; ctx.save(); ctx.globalAlpha *= add; ctx.beginPath(); ctx.arc(cx + Math.cos(a5) * R, cy + Math.sin(a5) * R, 18 * add, 0, 7); ctx.fillStyle = C.bad; ctx.shadowColor = C.bad; ctx.shadowBlur = 20; ctx.fill(); ctx.restore(); text(ctx, 'N5 joins', cx + Math.cos(a5) * (R + 62), cy + Math.sin(a5) * (R + 62), { size: 20, color: C.bad, align: 'center', base: 'middle', alpha: add });
  for (let i = 0; i < 14; i++) { const u = (i + hash(i)) / 14, a = u * Math.PI * 2 - Math.PI / 2; const moved = u > .3 && u < .42 && add > .5; ctx.save(); ctx.globalAlpha *= ra * .9; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (R - 38), cy + Math.sin(a) * (R - 38), 5, 0, 7); ctx.fillStyle = moved ? C.bad : C.fg; ctx.fill(); ctx.restore(); }
  text(ctx, 'only the keys between N2 and N5 move (~1/N)', cx, cy + R + 110, { size: 20, color: C.bad, align: 'center', alpha: p(t, 10.2, 11) });
  text(ctx, 'Dynamo · Cassandra · Vitess vindexes · Spanner ranges', 100, 840, { size: 20, color: C.dim, alpha: p(t, 8.6, 9.4) });
  ctx.restore();
}
function replication(ctx, t) {
  const s = win(t, 12.4, 21.4, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'REPLICATION   —   when does the client get its ack?');
  const rows = [['SYNCHRONOUS', 290, C.good, 14, 'ack after replicas persist → no data loss, latency = slowest replica'], ['ASYNCHRONOUS', 600, C.warn, 17, 'ack right away → low latency; replication lag; failover may lose w42']];
  rows.forEach(([n, y, c, t0, note], r) => { text(ctx, n, 100, y - 70, { size: 28, color: c, weight: 800, alpha: p(t, t0 - 1.5, t0 - .9) });
    const X = [200, 700, 1200, 1620]; const nm = ['Client', 'Leader', 'Follower 1', 'Follower 2']; X.forEach((x, i) => node(ctx, x, y, 200, 80, nm[i], '', i === 1 ? D : i === 0 ? L.client : L.storage, p(t, t0 - 1.6, t0 - 1, ease.back)));
    const w1 = [[300, y], [600, y]], w2 = [[800, y - 20], [1100, y - 20]], w3 = [[800, y + 20], [1520, y + 20]]; [w1, w2, w3].forEach(pp => arrow(ctx, pp, { color: hexA(C.dim, .4), progress: p(t, t0 - 1, t0 - .5), width: 2, head: false }));
    const a1 = p(t, t0, t0 + .8), a2 = p(t, t0 + .8, t0 + 1.8); packet(ctx, w1, a1, { color: C.accent, size: 9, label: 'w42' }); packet(ctx, w2, a2, { color: C.accent, size: 9 }); packet(ctx, w3, p(t, t0 + .8, t0 + 2.2), { color: C.accent, size: 9 });
    if (r === 0) { packet(ctx, [[1100, y + 5], [600, y + 5]], p(t, t0 + 1.9, t0 + 2.7), { color: C.good, size: 8, label: 'ack' }); packet(ctx, [[600, y - 30], [300, y - 30]], p(t, t0 + 2.7, t0 + 3.3), { color: C.good, size: 9, label: 'ack' }); }
    else { packet(ctx, [[600, y - 30], [300, y - 30]], p(t, t0 + .9, t0 + 1.5), { color: C.good, size: 9, label: 'ack' }); if (t > t0 + 2.6) { text(ctx, '⚡', 700, y - 55, { size: 40, color: C.bad, align: 'center', glow: 12, alpha: p(t, t0 + 2.6, t0 + 3) }); callout(ctx, 'leader crashes: Follower 2 never saw w42', 1000, y + 100, { color: C.bad, alpha: p(t, t0 + 3, t0 + 3.6), align: 'center', size: 20 }); } }
    text(ctx, note, 100, y + 150 - (r ? 0 : 20), { size: 22, color: C.fg, alpha: p(t, t0 + 1.5, t0 + 2.3) }); });
  ctx.restore();
}
function raft(ctx, t) {
  const s = win(t, 21.8, 34.2, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'RAFT   —   leader election and log replication');
  const X = [260, 620, 980, 1340, 1700], Y = 300; const crashed = t > 30 && t < 33; const leader1 = t > 24.2 && t < 30; const term = t < 22.6 ? 1 : t < 30.6 ? 2 : 3;
  const who = i => (i === 2 && t > 30) ? 'dead' : (i === 2 && leader1 ? 'leader' : (i === 0 && t > 32.2 ? 'leader' : 'follower'));
  X.forEach((x, i) => { const st = who(i); const c = st === 'leader' ? C.good : st === 'dead' ? C.dim : (i === 2 && t > 22.6 && t < 24.2) ? C.warn : C.accent; node(ctx, x, Y, 240, 100, 'N' + (i + 1) + (st === 'leader' ? '  ♛' : ''), st === 'dead' ? 'crashed' : (i === 2 && t > 22.6 && t < 24.2 ? 'candidate' : st) + ' · term ' + (i === 2 && t < 30 ? Math.max(term, 1) : term), c, p(t, 22, 22.6) * (st === 'dead' ? .5 : 1), { glow: st === 'leader' ? .8 : 0 }); if (st === 'dead') text(ctx, '✕', x, Y, { size: 60, color: C.bad, align: 'center', base: 'middle' }); });
  // election 1
  if (t > 22.6 && t < 25) { [0, 1, 3, 4].forEach((i, k) => { const pts = [[X[2], Y + 50], [X[i], Y + 50]]; packet(ctx, pts, p(t, 22.8, 23.6), { color: C.warn, size: 8, label: k === 0 ? 'RequestVote t2' : '' }); packet(ctx, [[X[i], Y + 70], [X[2], Y + 70]], p(t, 23.6, 24.4), { color: C.good, size: 8, alpha: i === 4 && false ? 0 : 1 }); }); text(ctx, 'votes: 5/5  ≥ majority 3  → N3 becomes leader', 960, 430, { size: 24, color: C.good, align: 'center', alpha: p(t, 24, 24.8) }); }
  // log replication
  const logs = [[1, 1, 2, 2], [1, 1, 2, 2], [1, 1, 2, 2], [1, 1, 2, 2], [1, 1, 2, 2]]; const ent = p(t, 26, 26.6); const ack = i => p(t, 26.8 + (i === 4 ? .7 : i === 3 ? .5 : i), 27.3 + (i === 4 ? .7 : i === 3 ? .5 : i));
  X.forEach((x, i) => { const base = logs[i]; const recv = i === 2 ? ent : i === 4 ? 0 : p(t, 26.5 + (i < 2 ? .3 : .5), 27 + (i < 2 ? .3 : .5)); const c2 = base.map((tm, k) => ({ label: tm, color: C.accent, alpha: p(t, 22.4, 23) })); if (t > 26 && !(i === 4 && t < 31.5) && !(i === 2 && t > 30)) c2.push({ label: 'x=5', color: t > 28 ? C.good : C.warn, alpha: i === 2 ? ent : recv, size: 17, glow: t > 28 && t < 28.8 });
    cells(ctx, c2, { x: x - 100, y: 470, cols: 5, cw: 54, ch: 46, gap: 4, size: 19, alpha: i === 2 && t > 30 ? .4 : 1 }); text(ctx, 'log (term per entry)', x, 462, { size: 15, color: C.dim, align: 'center', alpha: p(t, 22.4, 23) }); });
  if (t > 26 && t < 30) { [0, 1, 3, 4].forEach(i => { const pts = [[X[2], Y + 50], [X[i], Y + 50]]; packet(ctx, pts, p(t, 26.2, 26.9), { color: C.accent, size: 8, label: i === 0 ? 'AppendEntries' : '', alpha: i === 4 ? .25 : 1 }); if (i !== 4) packet(ctx, [[X[i], Y + 72], [X[2], Y + 72]], p(t, 26.9, 27.6), { color: C.good, size: 7 }); }); }
  if (t > 27.6 && t < 30) { text(ctx, 'majority (3/5) hold entry → COMMIT index advances → ack client', 960, 580, { size: 24, color: C.good, align: 'center', alpha: p(t, 27.6, 28.4) }); text(ctx, 'N5 was slow: it catches up later', 960, 620, { size: 20, color: C.dim, align: 'center', alpha: p(t, 28.4, 29) }); }
  if (t > 30) text(ctx, '⚡ leader crashes → election timeout → N1 asks for votes', 960, 580, { size: 26, color: C.bad, align: 'center', alpha: p(t, 30, 30.8) });
  if (t > 31.4) { [1, 3, 4].forEach(i => packet(ctx, [[X[0], Y + 50], [X[i], Y + 50]], p(t, 31.4, 32.2), { color: C.warn, size: 8, label: i === 1 ? 'RequestVote t3' : '' })); text(ctx, 'voters grant only to a log at least as up-to-date → any winner holds every committed entry', 960, 660, { size: 22, color: C.fg, align: 'center', alpha: p(t, 32.2, 33) }); }
  text(ctx, 'etcd · CockroachDB · TiKV · Consul · Kafka KRaft', 960, 780, { size: 20, color: C.dim, align: 'center', alpha: p(t, 32.6, 33.4) });
  ctx.restore();
}
function commit(ctx, t) {
  const s = win(t, 34.6, 45.4, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'DISTRIBUTED COMMIT');
  // 2PC left
  text(ctx, 'TWO-PHASE COMMIT', 100, 215, { size: 28, color: C.warn, weight: 800, alpha: p(t, 35, 35.6) });
  const cx = 280, cy = 330; node(ctx, cx, cy, 240, 90, 'Coordinator', 'txn T9', C.warn, p(t, 35, 35.6), { glow: t > 41.8 ? 0 : 0 });
  const P = [[160, 560], [420, 560], [680, 560]]; P.forEach(([x, y], i) => node(ctx, x, y, 200, 80, 'Shard ' + (i + 1), t > 37.2 && t < 41 ? 'prepared' : (t > 41 && t < 43 ? 'in doubt' : ''), L.storage, p(t, 35.2 + i * .2, 35.8 + i * .2), { glow: t > 41 && t < 43.4 ? .8 : 0 }));
  const ph = [[36, 37, 'PREPARE?', C.accent], [37.2, 38.2, 'vote yes', C.good], [38.6, 39.6, 'COMMIT', C.warn]];
  P.forEach(([x, y], i) => { const dn = [[cx, cy + 45], [x, y - 40]]; arrow(ctx, dn, { color: hexA(C.dim, .4), width: 2, progress: p(t, 35.8, 36.3), head: false }); packet(ctx, dn, p(t, 36, 37), { color: C.accent, size: 8, label: i === 0 && t < 37 ? 'PREPARE' : '' }); packet(ctx, [[x + 12, y - 40], [cx + 12, cy + 45]], p(t, 37.2, 38.2), { color: C.good, size: 8, label: i === 0 && t > 37.2 && t < 38.2 ? 'yes' : '' }); if (t < 41) packet(ctx, dn, p(t, 38.6, 39.6), { color: C.warn, size: 8, label: i === 0 && t > 38.6 && t < 39.6 ? 'COMMIT' : '' }); });
  if (t > 40.4) { text(ctx, '✕', cx, cy, { size: 70, color: C.bad, align: 'center', base: 'middle', alpha: p(t, 40.4, 40.9) }); text(ctx, 'coordinator dies after PREPARE', 100, 700, { size: 22, color: C.bad, alpha: p(t, 40.6, 41.2) }); text(ctx, 'participants block holding locks until recovery', 100, 740, { size: 22, color: C.fg, alpha: p(t, 41.6, 42.4) }); }
  text(ctx, '2 round trips + 2 forced log writes per commit', 100, 800, { size: 20, color: C.dim, alpha: p(t, 39.8, 40.6) });
  // Calvin right
  const rx = 1000; text(ctx, 'CALVIN  (deterministic ordering)', rx, 215, { size: 28, color: C.good, weight: 800, alpha: p(t, 41.8, 42.4) });
  node(ctx, rx + 250, 330, 360, 90, 'Sequencer', 'global order T9 < T10 < T11', C.good, p(t, 42, 42.6));
  [0, 1, 2].forEach(i => { const x = rx + 80 + i * 260; node(ctx, x, 560, 220, 90, 'Shard ' + (i + 1), 'executes in order', L.storage, p(t, 42.2 + i * .2, 42.8 + i * .2)); const pts = [[rx + 250, 375], [x, 515]]; arrow(ctx, pts, { color: hexA(C.good, .4), width: 2, progress: p(t, 42.8, 43.3), head: false }); packet(ctx, pts, p(t, 43.2 + i * .15, 44.2 + i * .15), { color: C.good, size: 8, label: i === 0 && t > 43.2 && t < 44.2 ? 'batch [T9,T10,T11]' : '' }); });
  text(ctx, 'replicas apply the same input log → same result, no 2PC, no distributed locking', rx, 700, { size: 21, color: C.fg, alpha: p(t, 44, 44.8), maxWidth: 800 });
  text(ctx, 'FaunaDB · FoundationDB-style batching', rx, 750, { size: 20, color: C.dim, alpha: p(t, 44.4, 45) });
  ctx.restore();
}
function clocks(ctx, t) {
  const s = win(t, 45.8, 55.8, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'ORDERING EVENTS WITHOUT A SHARED CLOCK');
  const P = [['LAMPORT', 100, C.accent], ['HYBRID LOGICAL CLOCK', 700, C.purple], ['TRUETIME (Spanner)', 1300, C.warn]]; P.forEach(([n, x, c], i) => { box(ctx, { x, y: 190, w: 520, h: 640, color: c, alpha: p(t, 46.2 + i * .3, 46.8 + i * .3), r: 14 }); text(ctx, n, x + 260, 235, { size: 26, weight: 900, color: c, align: 'center', alpha: p(t, 46.4 + i * .3, 47 + i * .3) }); });
  // Lamport
  const lx = [180, 440]; lx.forEach((x, i) => { ctx.save(); ctx.globalAlpha *= p(t, 47, 47.6); ctx.fillStyle = hexA(C.accent, .5); ctx.fillRect(x, 290, 4, 400); ctx.restore(); text(ctx, i ? 'B' : 'A', x + 2, 270, { size: 24, align: 'center', weight: 800, alpha: p(t, 47, 47.6) }); });
  [[350, 1, 0, 47.8], [450, 2, 0, 48.3], [520, 3, 1, 49.4], [600, 4, 1, 50]].forEach(([y, c, pr, at]) => { const a = p(t, at, at + .5); box(ctx, { x: lx[pr] - 40, y: y - 20, w: 84, h: 40, label: String(c), color: C.accent, alpha: a, mono: true, size: 20, r: 8 }); });
  arrow(ctx, [[184, 460], [440, 520]], { color: C.good, progress: p(t, 48.8, 49.4), width: 3, label: 'msg ts=2', labelDy: -18 }); packet(ctx, [[184, 460], [440, 520]], p(t, 48.8, 49.4), { color: C.good, size: 8 });
  text(ctx, 'receive: max(local, msg)+1 = 3', 120, 730, { size: 19, color: C.fg, alpha: p(t, 49.4, 50) }); text(ctx, 'orders causally, no wall time', 120, 770, { size: 19, color: C.dim, alpha: p(t, 50, 50.6) });
  // HLC
  text(ctx, '(wall, logical)', 960, 300, { size: 20, color: C.dim, align: 'center', alpha: p(t, 47.4, 48) });
  ['(10:00:00.005, 0)', '(10:00:00.005, 1)', '(10:00:00.009, 0)'].forEach((v, i) => { const a = p(t, 48 + i * .8, 48.6 + i * .8, ease.back); box(ctx, { x: 740, y: 340 + i * 90, w: 440, h: 64, label: v, color: C.purple, alpha: a, mono: true, size: 24, r: 10 }); if (i) arrow(ctx, [[960, 340 + i * 90 - 26], [960, 340 + i * 90]], { color: C.dim, progress: a, width: 2 }); });
  text(ctx, 'close to physical time, still causal', 740, 650, { size: 20, color: C.fg, alpha: p(t, 50.8, 51.4) }); text(ctx, 'CockroachDB · YugabyteDB · MongoDB', 740, 690, { size: 19, color: C.dim, alpha: p(t, 51.2, 51.8) });
  // TrueTime
  const ex = 1340, ey = 400, wv = 440; ctx.save(); ctx.globalAlpha *= p(t, 48, 48.8); ctx.fillStyle = 'rgba(138,147,181,.4)'; ctx.fillRect(ex, ey, wv, 4); ctx.restore(); const eps = 150 * p(t, 48.4, 49.4, ease.back);
  ctx.save(); ctx.globalAlpha *= p(t, 48.4, 49); ctx.fillStyle = hexA(C.warn, .3); ctx.fillRect(ex + 220 - eps, ey - 26, eps * 2, 56); ctx.strokeStyle = C.warn; ctx.strokeRect(ex + 220 - eps, ey - 26, eps * 2, 56); ctx.restore(); text(ctx, 'TT.now() = [earliest, latest]', ex + 220, ey - 50, { size: 20, color: C.warn, align: 'center', alpha: p(t, 49, 49.6) });
  text(ctx, 'ε ≈ 1–7 ms (GPS + atomic clocks)', ex + 220, ey + 70, { size: 20, color: C.dim, align: 'center', alpha: p(t, 49.4, 50) });
  const cw = p(t, 50.6, 53, ease.lin); box(ctx, { x: ex, y: 560, w: wv, h: 70, label: 'commit wait', sub: 'wait until timestamp is in the past', color: C.warn, alpha: p(t, 50.4, 51), size: 24, subSize: 17 }); bar(ctx, ex, 650, wv * cw, 20, 1, C.warn);
  text(ctx, 'external consistency: ts order = real-time order', ex, 720, { size: 19, color: C.fg, alpha: p(t, 52.6, 53.4) });
  ctx.restore();
}
function disagg(ctx, t) {
  const s = win(t, 56.2, 67.6, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'DISAGGREGATED STORAGE   —   Snowflake, Aurora, Neon, Redshift RA3, Databricks');
  const n = t > 62.4 ? 4 : 3; const X = [380, 780, 1180, 1580];
  for (let i = 0; i < n; i++) { const a = i === 3 ? p(t, 62.4, 63.2, ease.back) : p(t, 56.8 + i * .3, 57.4 + i * .3, ease.back); node(ctx, X[i], 280, 330, 120, 'Compute node ' + (i + 1), 'stateless · local SSD cache', L.execution, clamp(a), { glow: i === 3 ? .6 : 0 }); }
  const os = p(t, 57.4, 58.2); box(ctx, { x: 160, y: 600, w: 1600, h: 200, color: D, alpha: os, r: 14 }); text(ctx, 'OBJECT STORE  (S3 / GCS)  —  immutable files, 11 nines durability, ~$23 / TB-month', 960, 645, { size: 26, color: D, weight: 800, align: 'center', alpha: os });
  for (let i = 0; i < 12; i++) box(ctx, { x: 200 + i * 128, y: 690, w: 110, h: 70, label: 'part-' + i, color: D, alpha: p(t, 58 + i * .05, 58.5 + i * .05), size: 17, r: 8 });
  for (let i = 0; i < n; i++) { const pts = [[X[i], 340], [X[i], 600]]; arrow(ctx, pts, { color: hexA(C.dim, .5), progress: p(t, 58.6, 59.2), width: 2, head: false }); packet(ctx, pts, ((t - 59) * .55 + i * .27) % 1, { color: C.good, size: 8, alpha: p(t, 59.2, 59.6), label: ((t - 59) * .55 + i * .27) % 1 > .5 ? '' : '' }); packet(ctx, [[X[i] + 20, 600], [X[i] + 20, 340]], ((t - 59) * .55 + i * .27 + .5) % 1, { color: C.warn, size: 6, alpha: p(t, 59.2, 59.6) * .7 }); }
  text(ctx, 'cache hit: ~100 µs SSD', 160, 470, { size: 22, color: C.good, alpha: p(t, 59.6, 60.4) }); text(ctx, 'miss: ~20–80 ms GET (range read of a Parquet-like file)', 160, 505, { size: 22, color: C.warn, alpha: p(t, 60.2, 61) });
  callout(ctx, 'add a node in seconds: no data to move', 1100, 470, { color: C.good, alpha: p(t, 62.6, 63.4), align: 'left' });
  text(ctx, 'scale compute and storage independently · shared log/page service in Aurora & Neon · pause compute to $0', 160, 850, { size: 22, color: C.dim, alpha: p(t, 64, 65) });
  ctx.restore();
}
