// internals-E1 / part A: txn-manager, concurrency-control, lock-manager, latch
import * as THREE from 'three';
import { Kit, C, H, tablePlane, cfg } from './txn-kit.js';

const A = api => api.inst || api;
function clearGroup(g) {
  [...g.children].forEach(o => {
    o.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) { const ms = Array.isArray(x.material) ? x.material : [x.material]; ms.forEach(m => { m.map && m.map.dispose(); m.dispose(); }); } });
    g.remove(o);
  });
}
const sel = (id, label, options, value, key) => ({ id, label, type: 'select', options, value, onChange: (v, api) => A(api).act(key || id, v) });
const btn = (id, label, key, arg) => ({ id, label, type: 'button', onChange: (v, api) => A(api).act(key || id, arg) });
const tog = (id, label, value, key) => ({ id, label, type: 'toggle', value, onChange: (v, api) => A(api).act(key || id, v) });

/* ===================================================================== txn-manager */
function buildTxnManager(ctx) {
  const kit = new Kit(ctx); const G = kit.group;
  const NODE = { ACTIVE: [-7, 4.2], PREPARED: [0, 4.2], COMMITTED: [7, 5.4], ABORTED: [7, 2.4] };
  const NC = { ACTIVE: C.blue, PREPARED: C.purple, COMMITTED: C.green, ABORTED: C.red, COMMITTING: C.orange };
  for (const [st, [x, y]] of Object.entries(NODE)) {
    kit.box(3.9, 1.8, 0.2, NC[st], x, y, -0.15); kit.box(3.7, 1.6, 0.2, C.panel, x, y, -0.02);
    kit.label(st, x, y + 0.5, 0.15, { size: 0.42, color: H(NC[st]) });
  }
  const arr = (a, b, lab, lx, ly, col = C.edge) => { kit.arrow(a, b, col); if (lab) kit.label(lab, lx, ly, 0.1, { size: 0.3, color: C.dim }); };
  arr([-5.05, 4.2, 0], [-2.05, 4.2, 0], 'PREPARE\n(2PC only)', -3.55, 4.95);
  arr([2.05, 4.5, 0], [5.0, 5.2, 0], 'COMMIT', 3.4, 5.4);
  arr([2.05, 3.9, 0], [5.0, 2.8, 0], 'ABORT', 3.0, 3.0);
  kit.line([[-7, 5.1, 0], [-7, 6.8, 0], [7, 6.8, 0]], C.edge); kit.arrow([7, 6.8, 0], [7, 6.35, 0], C.edge);
  kit.label('COMMIT (1PC: durable commit record is the commit point)', -0.2, 7.3, 0, { size: 0.3, color: C.dim });
  kit.line([[-7, 3.3, 0], [-7, 1.6, 0], [4.8, 1.6, 0]], C.edge); kit.arrow([4.8, 1.6, 0], [5.05, 1.9, 0], C.edge);
  kit.label('ROLLBACK: walk undo chain, write CLRs', -1.2, 1.2, 0, { size: 0.3, color: C.dim });
  // commit path
  kit.label('COMMIT PATH', -8.8, -0.3, 0, { size: 0.35, color: C.dim });
  kit.box(6.6, 2.2, 0.2, C.red, -4, -2.6, -0.15); kit.box(6.4, 2.0, 0.2, C.panel, -4, -2.6, -0.02);
  kit.label('WAL log buffer', -4, -1.85, 0.15, { size: 0.36, color: H(C.red) });
  kit.box(4.4, 2.2, 0.2, C.cyan, 3.1, -2.6, -0.15); const disk = kit.box(4.2, 2.0, 0.2, C.panel, 3.1, -2.6, -0.02);
  kit.label('fsync -> log file', 3.1, -1.85, 0.15, { size: 0.36, color: H(C.cyan) });
  kit.box(3.0, 2.2, 0.2, C.green, 8.4, -2.6, -0.15); kit.box(2.8, 2.0, 0.2, C.panel, 8.4, -2.6, -0.02);
  kit.label('release locks\nack client', 8.4, -2.3, 0.15, { size: 0.32, color: H(C.green) });
  kit.arrow([-0.6, -2.6, 0], [0.85, -2.6, 0], C.edge); kit.arrow([5.4, -2.6, 0], [6.8, -2.6, 0], C.edge);
  const stat = kit.label('', 0, -5.0, 0, { size: 0.36 }); const mode = kit.label('', 0, -5.8, 0, { size: 0.32, color: C.dim });
  const prog = kit.box(0.1, 0.12, 0.1, C.yellow, -6.8, -3.9, 0.2); prog.visible = false;
  let tokId = 0, txns = [], pending = [], flush = null, waited = 0, fsyncs = 0, commits = 0, aborts = 0;
  let groupOn = true, twoPC = false, auto = true, spawnT = 0.5;
  const S = { stat: null };
  function refreshStat() {
    kit.setLabel(stat, `commits ${commits}   aborts ${aborts}   fsyncs ${fsyncs}   commits/fsync ${fsyncs ? (commits / fsyncs).toFixed(1) : '-'}`, { size: 0.36 });
    kit.setLabel(mode, `group commit ${groupOn ? 'ON (flush at 3 waiters or 0.9s)' : 'OFF (1 fsync per commit)'}   2PC prepare ${twoPC ? 'ON (2 fsyncs/txn)' : 'off'}`, { size: 0.32, color: C.dim });
  }
  function mkToken(n) {
    const g = new THREE.Group(); const geo = new THREE.SphereGeometry(0.3, 14, 10); const m = new THREE.MeshStandardMaterial({ color: C.blue, emissive: C.blue, emissiveIntensity: 0.3 });
    g.add(new THREE.Mesh(geo, m)); const l = ctx.makeLabel('T' + n, { size: 0.26, color: '#ffffff' }); l.position.set(0, 0.55, 0.1); g.add(l); g.userData.mat = m; G.add(g); return g;
  }
  function setState(t, st) { t.state = st; t.tok.userData.mat.color.setHex(NC[st]); t.tok.userData.mat.emissive.setHex(NC[st]); }
  function layout() {
    for (const st of Object.keys(NODE)) txns.filter(t => t.state === st).forEach((t, i) => kit.move(t.tok, [NODE[st][0] - 1.4 + i * 0.7, NODE[st][1] - 0.35, 0.3], 0.5));
    pending.forEach((t, i) => kit.move(t.tok, [-6.2 + i * 0.8, -2.9, 0.3], 0.4));
    if (flush) flush.batch.forEach((t, i) => kit.move(t.tok, [1.6 + i * 0.8, -2.9, 0.3], 0.4));
  }
  function prune() {
    ['COMMITTED', 'ABORTED'].forEach(st => { const l = txns.filter(t => t.state === st); while (l.length > 5) { const t = l.shift(); txns = txns.filter(x => x !== t); G.remove(t.tok); t.tok.traverse(o => { o.geometry && o.geometry.dispose(); o.material && (o.material.map && o.material.map.dispose(), o.material.dispose()); }); } });
  }
  function begin() { const t = { id: ++tokId, state: 'ACTIVE', phase: twoPC ? 0 : 1, tok: mkToken(tokId), born: kit.clock }; t.tok.position.set(NODE.ACTIVE[0] - 1.4, 6, 0.3); setState(t, 'ACTIVE'); txns.push(t); layout(); return t; }
  const oldest = st => txns.find(t => t.state === st);
  function commit(t) { t = t || oldest('ACTIVE') || oldest('PREPARED'); if (!t || t.queued) return; t.queued = true; t.cState = t.state; pending.push(t); t.tok.userData.mat.color.setHex(NC.COMMITTING); waited = 0; layout(); }
  function abort(t) { t = t || oldest('ACTIVE'); if (!t) return; setState(t, 'ABORTED'); aborts++; layout(); prune(); refreshStat(); }
  function finishFlush() {
    const b = flush.batch; flush = null;
    b.forEach(t => {
      t.queued = false;
      if (twoPC && t.state === 'ACTIVE') { setState(t, 'PREPARED'); kit.at(kit.clock + 0.7, () => commit(t)); }
      else { setState(t, 'COMMITTED'); commits++; }
    });
    layout(); prune(); refreshStat();
  }
  function update(dt) {
    kit.tick(dt);
    if (auto) {
      spawnT -= dt;
      if (spawnT <= 0) { spawnT = 1.1; if (txns.filter(t => t.state === 'ACTIVE').length < 5) begin(); }
      txns.filter(t => t.state === 'ACTIVE' && !t.queued && kit.clock - t.born > 2.2).forEach(t => { if (t.id % 6 === 0) abort(t); else commit(t); });
    }
    if (!flush && pending.length) {
      waited += dt;
      if (!groupOn || pending.length >= 3 || waited >= 0.9) { flush = { batch: groupOn ? pending.splice(0) : [pending.shift()], t: 0 }; fsyncs++; layout(); refreshStat(); }
    }
    if (flush) { flush.t += dt; disk.material.color.setHex(0x335a66); prog.visible = true; prog.scale.x = Math.min(1, flush.t / 0.8) * 40; prog.position.x = 1.2 + Math.min(1, flush.t / 0.8) * 2; if (flush.t >= 0.8) { finishFlush(); } }
    else { disk.material.color.setHex(C.panel); prog.visible = false; }
  }
  refreshStat();
  const html = `<b>Transaction manager</b><br>Assigns txn ids/timestamps, tracks state in the <i>transaction table</i> (xid, state, lastLSN, held locks), drives commit/abort. A commit is durable only when the COMMIT record is fsynced. Group commit lets many txns share one fsync (a few ms on HDD, ~0.1-1 ms NVMe), trading a little latency for throughput. With 2PC a PREPARE record must be durable before the coordinator decides.`;
  ctx.onInfo && ctx.onInfo(html);
  const steps = [
    { title: 'Begin transactions', text: 'BEGIN allocates an xid and creates a txn-table entry in state ACTIVE. Reads/writes now take locks / create versions and append log records.', run() { auto = false; groupOn = false; twoPC = false; txns.forEach(t => G.remove(t.tok)); txns = []; pending = []; flush = null; for (let i = 0; i < 3; i++) begin(); refreshStat(); } },
    { title: 'Single commit = 1 fsync', text: 'COMMIT appends a commit record to the log buffer, then the txn waits for fsync. Only after the flush is it COMMITTED (locks released, client acked). Without group commit each txn pays its own fsync.', run() { groupOn = false; commit(oldest('ACTIVE')); } },
    { title: 'Group commit', text: 'With group commit, commit records queue in the log buffer and one fsync makes the whole batch durable: commits/fsync rises well above 1.', run() { groupOn = true; txns.filter(t => t.state === 'ACTIVE').forEach(t => commit(t)); for (let i = 0; i < 2; i++) { const t = begin(); commit(t); } } },
    { title: 'Abort / rollback', text: 'ABORT moves ACTIVE -> ABORTED after undoing changes via the undo chain (writing compensation log records) and releasing locks.', run() { const t = begin(); abort(t); } },
    { title: 'Two-phase commit participant', text: 'In a distributed txn the participant first makes a PREPARE record durable (fsync #1) and may no longer unilaterally abort; after the coordinator decides it writes COMMIT (fsync #2).', run() { twoPC = true; groupOn = true; const t = begin(); commit(t); refreshStat(); } },
    { title: 'Run freely', text: 'Auto mode spawns transactions; every 6th aborts. Toggle group commit and 2PC and watch commits/fsync.', run() { auto = true; refreshStat(); } },
  ];
  return {
    group: G, update, dispose() { kit.dispose(); }, steps, onConfigChange() {},
    act(k, v) {
      if (k === 'begin') begin(); else if (k === 'commit') commit(); else if (k === 'abort') abort();
      else if (k === 'group') { groupOn = !!v; refreshStat(); } else if (k === 'twopc') { twoPC = !!v; refreshStat(); } else if (k === 'auto') auto = !!v;
    },
  };
}
const txnManagerControls = [btn('begin', 'BEGIN txn', 'begin'), btn('commit', 'COMMIT oldest', 'commit'), btn('abort', 'ABORT oldest', 'abort'),
  tog('group', 'group commit', true), tog('twopc', '2PC prepare', false), tog('auto', 'auto workload', true)];

/* ===================================================================== concurrency-control */
const OPS = { 1: [['R', 'X'], ['W', 'X'], ['C']], 2: [['R', 'X'], ['W', 'Y'], ['C']], 3: [['R', 'Y'], ['W', 'X'], ['C']] };
const IDS = [1, 2, 3];
function findCycle(g) {
  for (const s of Object.keys(g)) {
    const path = []; const seen = new Set();
    const dfs = u => { if (path.includes(u)) return path.slice(path.indexOf(u)); if (seen.has(u) || !g[u]) return null; seen.add(u); path.push(u); for (const v of g[u]) { const r = dfs(v); if (r) return r; } path.pop(); return null; };
    const r = dfs(+s); if (r) return r;
  } return null;
}
const mkRows = () => ({ 1: [], 2: [], 3: [] });
function sim2pl() {
  const rows = mkRows(), st = {}; IDS.forEach(i => st[i] = { pc: 0, done: false, delay: 0, locks: {} });
  const nl = s => Object.keys(s.locks).length;
  for (let tk = 0; tk < 14 && IDS.some(i => !st[i].done); tk++) {
    const wf = {};
    for (const i of IDS) {
      const s = st[i];
      if (s.done) { rows[i].push(null); continue; }
      if (s.delay > 0) { s.delay--; rows[i].push({ k: 'wait', a: 'restart', b: 'backoff', locks: 0 }); continue; }
      const op = OPS[i][s.pc];
      if (op[0] === 'C') { const n = nl(s); s.locks = {}; s.done = true; rows[i].push({ k: 'commit', a: 'COMMIT', b: '-' + n + ' locks', locks: 0 }); continue; }
      const need = op[0] === 'R' ? 'S' : 'X', cur = s.locks[op[1]];
      const hs = IDS.filter(o => o !== i && st[o].locks[op[1]] && !(st[o].locks[op[1]] === 'S' && need === 'S'));
      if (hs.length) { wf[i] = hs; rows[i].push({ k: 'block', a: `${op[0]}(${op[1]})`, b: 'wait ' + hs.map(h => 'T' + h).join(','), locks: nl(s) }); }
      else { const nm = (cur === 'X' || need === 'X') ? 'X' : 'S'; s.locks[op[1]] = nm; s.pc++; rows[i].push({ k: 'op', a: `${op[0]}(${op[1]})`, b: (cur && cur !== nm ? 'upgr ' : '+') + nm + '(' + op[1] + ')', locks: nl(s) }); }
    }
    const cyc = findCycle(wf);
    if (cyc) { const v = Math.max(...cyc); const s = st[v]; s.locks = {}; s.pc = 0; s.delay = 2; rows[v][tk] = { k: 'abort', a: 'ABORT', b: 'deadlock', locks: 0 }; }
  }
  return rows;
}
function simOcc() {
  const rows = mkRows(), st = {}, committed = []; IDS.forEach(i => st[i] = { pc: 0, start: 0, rs: new Set(), ws: new Set(), done: false, delay: 0 });
  for (let tk = 0; tk < 12 && IDS.some(i => !st[i].done); tk++) for (const i of IDS) {
    const s = st[i];
    if (s.done) { rows[i].push(null); continue; }
    if (s.delay > 0) { s.delay--; rows[i].push({ k: 'wait', a: 'restart', b: 'new start', locks: 0 }); continue; }
    const op = OPS[i][s.pc];
    if (op[0] === 'R') { s.rs.add(op[1]); s.pc++; rows[i].push({ k: 'op', a: `R(${op[1]})`, b: 'READ phase', locks: 0 }); }
    else if (op[0] === 'W') { s.ws.add(op[1]); s.pc++; rows[i].push({ k: 'op', a: `W(${op[1]})`, b: 'private copy', locks: 0 }); }
    else {
      const c = committed.find(c => c.tick >= s.start && [...s.rs].some(k => c.ws.has(k)));
      if (c) { rows[i].push({ k: 'abort', a: 'VALIDATE', b: `fail: T${c.id}`, locks: 0 }); s.pc = 0; s.rs = new Set(); s.ws = new Set(); s.start = tk + 2; s.delay = 1; }
      else { rows[i].push({ k: 'commit', a: 'VALIDATE', b: 'ok: WRITE', locks: 0 }); committed.push({ id: i, tick: tk, ws: new Set(s.ws) }); s.done = true; }
    }
  }
  return rows;
}
function simMvto() {
  const rows = mkRows(), st = {}, vers = { X: [{ w: 0, r: 0, by: 0 }], Y: [{ w: 0, r: 0, by: 0 }] }; let ctr = 3;
  IDS.forEach(i => st[i] = { pc: 0, ts: i, done: false, delay: 0 });
  const vis = (k, ts) => vers[k].filter(v => v.w <= ts).sort((a, b) => b.w - a.w)[0];
  for (let tk = 0; tk < 12 && IDS.some(i => !st[i].done); tk++) for (const i of IDS) {
    const s = st[i];
    if (s.done) { rows[i].push(null); continue; }
    if (s.delay > 0) { s.delay--; rows[i].push({ k: 'wait', a: 'restart', b: 'ts=' + s.ts, locks: 0 }); continue; }
    const op = OPS[i][s.pc];
    if (op[0] === 'R') { const v = vis(op[1], s.ts); v.r = Math.max(v.r, s.ts); s.pc++; rows[i].push({ k: 'op', a: `R(${op[1]}) ts${s.ts}`, b: `reads ${op[1]}@${v.w}`, locks: 0 }); }
    else if (op[0] === 'W') {
      const v = vis(op[1], s.ts);
      if (v.r > s.ts) { rows[i].push({ k: 'abort', a: `W(${op[1]}) ABORT`, b: `rts${v.r}>ts${s.ts}`, locks: 0 }); IDS; for (const k in vers) vers[k] = vers[k].filter(x => x.by !== i); s.pc = 0; s.ts = ++ctr; s.delay = 1; }
      else { vers[op[1]].push({ w: s.ts, r: s.ts, by: i }); s.pc++; rows[i].push({ k: 'op', a: `W(${op[1]}) ts${s.ts}`, b: `new ${op[1]}@${s.ts}`, locks: 0 }); }
    } else { s.done = true; rows[i].push({ k: 'commit', a: 'COMMIT', b: 'ts=' + s.ts, locks: 0 }); }
  }
  return rows;
}
function simSsi() {
  const o = (a, b) => ({ k: 'op', a, b, locks: 0 }), w = { k: 'wait', a: 'restart', b: 'backoff', locks: 0 };
  return {
    1: [o('R(X)', 'snapshot s0'), o('W(X)', 'new version'), { k: 'commit', a: 'COMMIT', b: 'first wins', locks: 0 }, null, null, null, null],
    2: [o('R(X)', 'snapshot s0'), o('W(Y)', 'new version'), { k: 'abort', a: 'ABORT', b: 'pivot T3>T2>T1', locks: 0 }, w, o('R(X)', 'snapshot s1'), o('W(Y)', 'new version'), { k: 'commit', a: 'COMMIT', b: 'rw ok', locks: 0 }],
    3: [o('R(Y)', 'snapshot s0'), { k: 'block', a: 'W(X)', b: 'row lock: T1', locks: 0 }, { k: 'block', a: 'W(X)', b: 'row lock: T1', locks: 0 }, { k: 'abort', a: 'ABORT', b: 'ww: T1 won', locks: 0 }, o('R(Y)', 'snapshot s1'), o('W(X)', 'new version'), { k: 'commit', a: 'COMMIT', b: 'rw ok', locks: 0 }],
  };
}
function simCalvin() {
  const s = (n) => ({ k: 'seq', a: 'SEQ #' + n, b: 'epoch 0 batch', locks: 0 }), q = (b) => ({ k: 'wait', a: 'queued', b, locks: 0 });
  return {
    1: [s(1), { k: 'op', a: 'R(X) W(X)', b: 'locks granted', locks: 0 }, { k: 'commit', a: 'COMMIT', b: 'no abort', locks: 0 }, null, null, null, null],
    2: [s(2), q('X behind T1'), q('X behind T1'), { k: 'op', a: 'R(X) W(Y)', b: 'locks granted', locks: 0 }, { k: 'commit', a: 'COMMIT', b: 'no abort', locks: 0 }, null, null],
    3: [s(3), q('X behind T2'), q('X behind T2'), q('X behind T2'), q('Y behind T2'), { k: 'op', a: 'R(Y) W(X)', b: 'locks granted', locks: 0 }, { k: 'commit', a: 'COMMIT', b: 'no abort', locks: 0 }],
  };
}
const CC = {
  '2pl': { name: 'Strict 2PL', sim: sim2pl, rule: ['Growing phase: acquire S before read, X before write; never release.', 'Strict: X (rigorous: all) locks held until COMMIT, then released at once.', 'Conflicts BLOCK; the deadlock detector aborts the youngest in the cycle.'], html: 'Pessimistic: conflicting accesses wait on the lock table. Result is conflict-serializable (serial order = lock-point order). Cost: blocking, lock-table overhead and deadlocks. T1/T2 both hold S(X) and both want X -> classic upgrade deadlock combined with T3.' },
  'occ': { name: 'OCC', sim: simOcc, rule: ['READ: read committed data, buffer writes in a private workspace (no locks).', 'VALIDATE (backward): abort if a txn committed since my start wrote my read set.', 'WRITE: install private writes atomically. Never blocks, but wasted work on abort.'], html: 'Optimistic: assume conflicts are rare. No blocking at all, but T2 does all its work then discovers at validation that T1 changed X. Good for read-mostly, bad for hot rows (abort storms).' },
  'mvcc-timestamp': { name: 'MVCC Timestamp Ordering', sim: simMvto, rule: ['Each txn gets ts at begin; version = (wts, rts). Read picks newest wts <= ts, bumps rts.', 'Write(X): find version v with wts <= ts; abort if v.rts > ts (a younger txn already read it).', 'Readers never block or abort-writers-wait; restarted txns get a NEW (larger) ts.'], html: 'Multi-version T/O (Reed). Reads never block, but a write that would invalidate a younger reader aborts. Restarts take a new timestamp. Real systems add commit-dependency tracking for recoverability.' },
  'mvcc-ssi': { name: 'MVCC + Serializable Snapshot Isolation', sim: simSsi, rule: ['Snapshot reads: no read locks. First-committer-wins on write-write (row lock waits).', 'SSI tracks rw-antidependencies (SIREAD). A pivot with in AND out rw edge is dangerous.', 'Abort the pivot (T2: T3 -rw-> T2 -rw-> T1 and T1 committed first) -> serializable.'], html: 'Postgres-style SSI (Cahill/Ports-Grittner). Snapshot isolation alone would let T2 commit (write skew-like cycle). Detection of the dangerous structure aborts the pivot; false positives are possible but no read blocking.' },
  'deterministic-calvin': { name: 'Calvin (deterministic)', sim: simCalvin, rule: ['A sequencer batches txns per epoch and fixes a global order BEFORE execution (replicated via Paxos).', 'Lock manager grants locks strictly in that order; read/write sets known up front.', 'Deterministic order => no deadlocks, no aborts from conflicts, no 2PC; replicas replay same order.'], html: 'Calvin/FaunaDB-style. Concurrency is resolved by agreeing on order first. Cost: needs read/write sets in advance (reconnaissance queries for dependent txns) and epoch batching latency.' },
};
const KC = { op: 0x3d59a1, block: 0x9a7b22, abort: 0xb03a4f, commit: 0x4f7a2c, val: 0x6b4fa3, wait: 0x3b4261, seq: 0x1f7a8c };

function buildCC(ctx) {
  const kit = new Kit(ctx); const G = kit.group; const gg = new THREE.Group(); G.add(gg);
  let proto = cfg(ctx, 'concurrency-control', '2pl'); if (!CC[proto]) proto = '2pl';
  let speed = 1, playing = true, end = 0, cells = [];
  const CW = 1.8, X0 = -7.2, LY = { 1: 2.4, 2: 0.4, 3: -1.6 };
  kit.label('Same schedule under every protocol: T1: R(X) W(X) C   T2: R(X) W(Y) C   T3: R(Y) W(X) C   (all start together)', 0, 6.4, 0, { size: 0.3, color: C.dim });
  const title = kit.label('', 0, 5.6, 0, { size: 0.5, color: H(C.red) });
  IDS.forEach(i => { kit.box(1.3, 1.4, 0.2, C.panel, -9.2, LY[i], 0); kit.label('T' + i, -9.2, LY[i], 0.2, { size: 0.5, color: H([C.blue, C.yellow, C.green][i - 1]) }, G); });
  const stats = kit.label('', 0, -3.6, 0, { size: 0.36 }); const ruleLabels = [0, 1, 2].map(i => kit.label('', 0, -4.7 - i * 0.7, 0, { size: 0.31, color: C.dim }));
  const legend = kit.label('blue op | yellow BLOCK | red ABORT | green COMMIT | purple validate | teal sequenced | bar = locks held', 0, -7.0, 0, { size: 0.28, color: C.dim });
  function setProto(p) {
    proto = CC[p] ? p : '2pl'; clearGroup(gg); cells = [];
    const def = CC[proto], rows = def.sim(); let maxT = 0, nA = 0, nB = 0, nC = 0; const order = [];
    kit.timers = []; kit.resetTimers();
    IDS.forEach(i => rows[i].forEach((c, tk) => {
      if (!c) return; maxT = Math.max(maxT, tk);
      const g = new THREE.Group(); g.position.set(X0 + tk * CW, LY[i], 0);
      const bg = new THREE.BoxGeometry(CW - 0.12, 1.4, 0.25), bm = new THREE.MeshStandardMaterial({ color: KC[c.k], roughness: 0.7 });
      g.add(new THREE.Mesh(bg, bm));
      const la = ctx.makeLabel(c.a, { size: 0.31, color: '#ffffff' }); la.position.set(0, 0.22, 0.2); g.add(la);
      const lb = ctx.makeLabel(c.b, { size: 0.25, color: '#dfe3f3' }); lb.position.set(0, -0.3, 0.2); g.add(lb);
      if (c.locks) { const hg = new THREE.BoxGeometry(0.22, 0.22 * c.locks + 0.02, 0.1), hm = new THREE.MeshBasicMaterial({ color: C.yellow }); const hb = new THREE.Mesh(hg, hm); hb.position.set(CW / 2 - 0.2, -0.7 + (0.22 * c.locks) / 2, 0.15); g.add(hb); }
      g.visible = false; gg.add(g); cells.push(g);
      kit.at(0.5 + tk * 0.9 / speed, () => { g.visible = true; });
      if (c.k === 'abort') nA++; if (c.k === 'block') nB++; if (c.k === 'commit') { nC++; order.push([tk, i]); }
    }));
    for (let tk = 0; tk <= maxT; tk++) kit.label('t' + tk, X0 + tk * CW, 3.7, 0, { size: 0.3, color: C.dim }, gg);
    order.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    kit.setLabel(title, def.name, { size: 0.5, color: H(C.red) });
    kit.setLabel(stats, `commits ${nC}   aborts ${nA}   blocked ticks ${nB}   commit order ${order.map(o => 'T' + o[1]).join(' > ')}   finishes at t${maxT}`, { size: 0.36 });
    ruleLabels.forEach((l, i) => kit.setLabel(l, def.rule[i], { size: 0.31, color: C.dim }));
    end = 0.5 + (maxT + 1) * 0.9 / speed + 3;
    ctx.onInfo && ctx.onInfo(`<b>${def.name}</b><br>${def.html}`);
  }
  setProto(proto);
  const stepList = ['2pl', 'occ', 'mvcc-timestamp', 'mvcc-ssi', 'deterministic-calvin'].map(p => ({ title: CC[p].name, text: CC[p].html, run() { setProto(p); } }));
  return {
    group: G, dispose() { kit.dispose(); }, steps: stepList,
    update(dt) { if (playing) { kit.tick(dt); if (kit.clock > end) { cells.forEach(c => c.visible = false); kit.resetTimers(); } } else cells.forEach(c => c.visible = true); },
    onConfigChange(c) { const p = c && c['concurrency-control']; if (p && p !== proto) setProto(p); },
    act(k, v) { if (k === 'proto') setProto(v); else if (k === 'replay') { cells.forEach(c => c.visible = false); kit.resetTimers(); playing = true; } else if (k === 'play') playing = !!v; },
  };
}
const ccControls = [sel('proto', 'protocol', Object.keys(CC).map(k => ({ value: k, label: CC[k].name })), '2pl'), btn('replay', 'Replay timeline', 'replay'), tog('play', 'animate (off = show all)', true)];

/* ===================================================================== lock-manager */
const MODES = ['IS', 'IX', 'S', 'SIX', 'X'];
const COMPAT = { IS: { IS: 1, IX: 1, S: 1, SIX: 1, X: 0 }, IX: { IS: 1, IX: 1, S: 0, SIX: 0, X: 0 }, S: { IS: 1, IX: 0, S: 1, SIX: 0, X: 0 }, SIX: { IS: 1, IX: 0, S: 0, SIX: 0, X: 0 }, X: { IS: 0, IX: 0, S: 0, SIX: 0, X: 0 } };
const RANK = { IS: 0, IX: 1, S: 1, SIX: 2, X: 3 };
const lub = (a, b) => a === b ? a : (RANK[a] === 1 && RANK[b] === 1) ? 'SIX' : RANK[a] >= RANK[b] ? a : b;
const MC = { IS: 0x2ac3de, IX: 0x7aa2f7, S: 0x9ece6a, SIX: 0xbb9af7, X: 0xf7768e };
const RES = [
  { id: 'TABLE', label: 'TABLE emp', lvl: 0, parent: null }, { id: 'P7', label: 'PAGE 7', lvl: 1, parent: 'TABLE' },
  { id: 'R71', label: 'ROW (7,1)', lvl: 2, parent: 'P7' }, { id: 'R72', label: 'ROW (7,2)', lvl: 2, parent: 'P7' },
  { id: 'P8', label: 'PAGE 8', lvl: 1, parent: 'TABLE' }, { id: 'R81', label: 'ROW (8,1)', lvl: 2, parent: 'P8' },
];
const bucketOf = id => [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 8;

function buildLockMgr(ctx) {
  const kit = new Kit(ctx); const G = kit.group; const qg = new THREE.Group(); G.add(qg);
  const Y = {}; RES.forEach((r, i) => Y[r.id] = 4.6 - i * 1.75);
  const q = {}; RES.forEach(r => q[r.id] = []);
  let hl = null, logs = [], threshold = 3, sel = { txn: 1, res: 'R71', mode: 'S' };
  kit.label('LOCK TABLE: hash(resource) -> bucket -> queue of requests', -4.6, 6.7, 0, { size: 0.34, color: C.dim });
  RES.forEach(r => {
    const x = -8.6 + r.lvl * 0.7; kit.box(3.1, 1.3, 0.2, C.grey, x, Y[r.id], -0.1);
    kit.label(r.label, x, Y[r.id] + 0.2, 0.1, { size: 0.36 }); kit.label('bucket ' + bucketOf(r.id), x, Y[r.id] - 0.33, 0.1, { size: 0.25, color: C.dim });
    kit.line([[-6.9 + r.lvl * 0.7, Y[r.id], 0], [-5.4, Y[r.id], 0]], C.edge);
    if (r.parent) kit.line([[-8.6 + (r.lvl - 1) * 0.7 - 1.3, Y[r.parent] - 0.65, 0], [-8.6 + (r.lvl - 1) * 0.7 - 1.3, Y[r.id], 0], [-8.6 + r.lvl * 0.7 - 1.55, Y[r.id], 0]], C.edge);
  });
  const rows = [[''].concat(MODES)].concat(MODES.map(a => [a].concat(MODES.map(b => COMPAT[a][b] ? 'ok' : 'NO'))));
  const mat = tablePlane(kit, rows, { cellW: 74, cellH: 44, font: 22, scale: 0.0165, headCol: true, color: (i, j) => hl && i > 0 && j > 0 && MODES[i - 1] === hl.a && MODES[j - 1] === hl.b ? (hl.ok ? '#9ece6a' : '#f7768e') : (i > 0 && j > 0 ? (COMPAT[MODES[i - 1]][MODES[j - 1]] ? '#1f3326' : '#3a1f26') : null) });
  mat.position.set(5.8, 4.2, 0); G.add(mat);
  kit.label('compatibility: requested (row) vs granted (col)', 5.8, 6.9, 0, { size: 0.3, color: C.dim });
  const logL = kit.label('', 5.8, 0.6, 0, { size: 0.28, color: C.dim, align: 'left' });
  const redraw = () => mat.userData.redraw(rows, (i, j) => hl && i > 0 && j > 0 && MODES[i - 1] === hl.a && MODES[j - 1] === hl.b ? (hl.ok ? '#9ece6a' : '#f7768e') : (i > 0 && j > 0 ? (COMPAT[MODES[i - 1]][MODES[j - 1]] ? '#1f3326' : '#3a1f26') : null));
  const TC = [0, 0x7aa2f7, 0xe0af68, 0x9ece6a];
  function log(m) { logs.push(m); if (logs.length > 7) logs.shift(); kit.setLabel(logL, logs.join('\n'), { size: 0.28, color: C.dim, align: 'left' }); }
  function drawQ() {
    clearGroup(qg);
    RES.forEach(r => q[r.id].forEach((e, i) => {
      const g = new THREE.Group(); g.position.set(-4.4 + i * 1.75, Y[r.id], 0);
      const geo = new THREE.BoxGeometry(1.6, 1.0, 0.25), m = new THREE.MeshStandardMaterial({ color: e.granted ? MC[e.mode] : 0x8a6d1f, roughness: 0.7, transparent: !e.granted, opacity: e.granted ? 1 : 0.85 });
      g.add(new THREE.Mesh(geo, m));
      const txt = e.granted ? `T${e.txn} ${e.mode}` : (e.conv ? `T${e.txn} ${e.from}>${e.mode}` : `T${e.txn} ${e.mode}`);
      const l = ctx.makeLabel(txt, { size: 0.3, color: e.granted ? '#0b0d14' : '#ffffff' }); l.position.set(0, 0.12, 0.2); g.add(l);
      const l2 = ctx.makeLabel(e.granted ? 'granted' : 'WAITING', { size: 0.2, color: e.granted ? '#0b0d14' : '#ffe9a8' }); l2.position.set(0, -0.28, 0.2); g.add(l2);
      qg.add(g);
    }));
    redraw();
  }
  const holdersOther = (rid, t) => q[rid].filter(e => e.granted && e.txn !== t);
  function pump(rid) {
    const L = q[rid];
    for (;;) {
      const w = L.find(e => !e.granted); if (!w) break;
      if (!holdersOther(rid, w.txn).every(o => COMPAT[w.mode][o.mode])) break;
      const old = L.findIndex(e => e.granted && e.txn === w.txn); if (old >= 0) L.splice(old, 1);
      w.granted = true; log(`T${w.txn} granted ${w.mode} on ${rid}`);
      // keep granted entries before waiters
      L.sort((a, b) => (b.granted ? 1 : 0) - (a.granted ? 1 : 0));
      if (w.cont) { const c = w.cont; w.cont = null; c(); }
    }
  }
  function request(txn, rid, mode, cont) {
    const L = q[rid], ex = L.find(e => e.txn === txn && e.granted);
    const want = ex ? lub(ex.mode, mode) : mode;
    if (ex && want === ex.mode) { log(`T${txn} already holds ${ex.mode} on ${rid}`); cont && cont(); return true; }
    const others = holdersOther(rid, txn), blk = others.find(e => !COMPAT[want][e.mode]);
    hl = { a: want, b: (blk || others[0] || { mode: 'IS' }).mode, ok: !blk };
    const waiters = L.filter(e => !e.granted);
    if (!blk && (ex || waiters.length === 0)) {
      if (ex) { log(`T${txn} converts ${ex.mode}->${want} on ${rid}`); ex.mode = want; } else { L.push({ txn, mode: want, granted: true }); log(`T${txn} gets ${want} on ${rid}`); }
      drawQ(); cont && cont(); return true;
    }
    const ent = { txn, mode: want, granted: false, conv: !!ex, from: ex && ex.mode, cont };
    if (ex) { const fi = L.findIndex(e => !e.granted); if (fi < 0) L.push(ent); else L.splice(fi, 0, ent); } else L.push(ent);
    log(`T${txn} WAITS for ${want} on ${rid} (${blk ? 'conflicts with T' + blk.txn + ' ' + blk.mode : 'FIFO behind waiter'})`); drawQ(); return false;
  }
  function path(rid) { const a = []; let r = RES.find(x => x.id === rid); while (r.parent) { r = RES.find(x => x.id === r.parent); a.unshift(r.id); } return a; }
  function acquire(txn, rid, mode, done) {
    const intent = (mode === 'S' || mode === 'IS') ? 'IS' : 'IX';
    const seq = path(rid).map(p => [p, intent]).concat([[rid, mode]]);
    const step = i => { if (i >= seq.length) { done && done(); maybeEscalate(txn); return; } request(txn, seq[i][0], seq[i][1], () => step(i + 1)); };
    step(0);
  }
  function maybeEscalate(txn) {
    const rowsHeld = RES.filter(r => r.lvl === 2 && q[r.id].some(e => e.txn === txn && e.granted));
    if (rowsHeld.length < threshold) return;
    const anyX = rowsHeld.some(r => q[r.id].some(e => e.txn === txn && e.granted && e.mode === 'X'));
    log(`ESCALATE: T${txn} holds ${rowsHeld.length} row locks >= ${threshold}`);
    request(txn, 'TABLE', anyX ? 'X' : 'S', () => { RES.filter(r => r.lvl > 0).forEach(r => { const n = q[r.id].length; q[r.id] = q[r.id].filter(e => !(e.txn === txn && e.granted)); if (q[r.id].length !== n) pump(r.id); }); log(`T${txn} row/page locks freed, table lock covers them`); drawQ(); });
  }
  function release(txn) {
    [...RES].reverse().forEach(r => { q[r.id] = q[r.id].filter(e => e.txn !== txn); });
    log(`T${txn} releases all locks`); [...RES].reverse().forEach(r => pump(r.id)); drawQ();
  }
  function reset() { RES.forEach(r => q[r.id] = []); logs = []; hl = null; log('lock table empty'); drawQ(); }
  reset();
  const html = `<b>Lock manager</b><br>A hash table keyed by resource id; each entry holds a FIFO queue of <b>granted</b> then <b>waiting</b> requests with a mode. A request is granted only if compatible with every granted lock (and no one is queued ahead). Intent locks (IS/IX/SIX) at table/page let a table-level S/X test conflict with row locks in O(1). Conversions (S->X) jump ahead of new waiters; two converters = deadlock. Escalation trades concurrency for memory.`;
  ctx.onInfo && ctx.onInfo(html);
  const steps = [
    { title: 'Row read takes intent locks', text: 'T1 reads row (7,1): acquires IS on TABLE, IS on PAGE 7, then S on the row (top-down). IS only announces "shared locks below".', run() { reset(); acquire(1, 'R71', 'S'); } },
    { title: 'Different row, no conflict', text: 'T2 updates row (7,2): IX on TABLE and PAGE 7 is compatible with T1\'s IS, X on a different row does not conflict.', run() { acquire(2, 'R72', 'X'); } },
    { title: 'Same row, conflict waits', text: 'T3 wants X on row (7,1): conflicts with T1\'s S, so it queues WAITING. The matrix highlights S vs X = NO.', run() { acquire(3, 'R71', 'X'); } },
    { title: 'Table lock vs intents', text: 'T3 does not need to scan row locks to check a table-level S: IX held by T2 on TABLE is incompatible with S, one lookup is enough.', run() { request(3, 'TABLE', 'S'); } },
    { title: 'Release grants waiters', text: 'T1 commits: strict 2PL releases everything. The queue head is re-examined and waiting requests are granted in FIFO order while compatible.', run() { release(1); } },
    { title: 'Lock escalation', text: 'T1 scans rows. At the threshold the manager swaps many row locks for one table lock (SQL Server ~5000, here 3). If other IX holders exist, escalation itself must wait.', run() { release(2); release(3); reset(); [['R71'], ['R72'], ['R81']].forEach(r => acquire(1, r[0], 'S')); } },
  ];
  return {
    group: G, dispose() { kit.dispose(); }, steps, onConfigChange() {}, update(dt) { kit.tick(dt); },
    act(k, v) {
      if (k === 'txn') sel.txn = +v; else if (k === 'res') sel.res = v; else if (k === 'mode') sel.mode = v;
      else if (k === 'req') acquire(sel.txn, sel.res, sel.mode); else if (k === 'rel') release(sel.txn); else if (k === 'reset') reset();
      else if (k === 'scan') { RES.filter(r => r.lvl === 2).forEach(r => acquire(sel.txn, r.id, 'S')); } else if (k === 'thr') { threshold = +v; log('escalation threshold = ' + threshold); }
    },
  };
}
const lockControls = [sel('txn', 'txn', [{ value: 1, label: 'T1' }, { value: 2, label: 'T2' }, { value: 3, label: 'T3' }], 1), sel('res', 'resource', RES.map(r => ({ value: r.id, label: r.label })), 'R71'),
  sel('mode', 'mode', MODES, 'S'), btn('req', 'Request lock (auto-intents)', 'req'), btn('rel', 'Release txn locks', 'rel'), btn('scan', 'Txn scans all rows (S)', 'scan'),
  { id: 'thr', label: 'escalation threshold', type: 'range', min: 2, max: 3, value: 3, onChange: (v, api) => A(api).act('thr', v) }, btn('reset', 'Reset table', 'reset')];

/* ===================================================================== latch */
function buildLatch(ctx) {
  const kit = new Kit(ctx); const G = kit.group; const pg = new THREE.Group(); G.add(pg);
  let panel = 'crab', op = 'ins55', protocol = 'crab', interfere = true, period = 8;
  // static tree data
  const CAP = 3;
  const N = {
    N0: { x: 0, y: 4.0, keys: [50], lvl: 0 }, N1: { x: -5, y: 1.0, keys: [20, 35], lvl: 1 }, N2: { x: 5, y: 1.0, keys: [70, 85], lvl: 1 },
    L1: { x: -7.5, y: -2.2, keys: [5, 10, 15], lvl: 2 }, L2: { x: -2.5, y: -2.2, keys: [20, 25, 30], lvl: 2 }, L3: { x: 2.5, y: -2.2, keys: [50, 60], lvl: 2 }, L4: { x: 7.5, y: -2.2, keys: [70, 80], lvl: 2 },
  };
  const edges = [['N0', 'N1'], ['N0', 'N2'], ['N1', 'L1'], ['N1', 'L2'], ['N2', 'L3'], ['N2', 'L4']];
  let nodeViz = {}, thread, caption, heldLbl, extra = null, ver = {};
  const lcol = { none: C.grey, R: C.green, W: C.red };
  function txt(k) { return '[' + k.join('|') + ']'; }
  function buildTree() {
    nodeViz = {}; ver = { N0: 10, N1: 12, N2: 12, L1: 4, L2: 6, L3: 8, L4: 6 };
    edges.forEach(([a, b]) => kit.line([[N[a].x, N[a].y - 0.6, 0], [N[b].x, N[b].y + 0.6, 0]], C.edge, pg));
    for (const [id, n] of Object.entries(N)) {
      const body = kit.box(3.2, 1.2, 0.2, n.lvl === 2 ? 0x2a4a58 : 0x2b3150, n.x, n.y, 0, {}, pg);
      const lat = kit.box(0.5, 0.5, 0.3, C.grey, n.x - 1.35, n.y + 0.85, 0.1, {}, pg);
      const key = kit.label(txt(n.keys), n.x + 0.1, n.y + 0.12, 0.2, { size: 0.36 }, pg);
      kit.label(id + '  ' + n.keys.length + '/' + CAP, n.x + 0.1, n.y - 0.35, 0.2, { size: 0.24, color: C.dim }, pg);
      const vl = kit.label('', n.x + 0.9, n.y + 0.85, 0.1, { size: 0.26, color: H(C.yellow) }, pg);
      nodeViz[id] = { body, lat, key, vl, st: 'none' };
    }
    thread = kit.sphere(0.35, C.yellow, 0, 6, 0.4, pg); thread.visible = false;
  }
  function setLatch(id, st) { const v = nodeViz[id]; v.st = st; v.lat.material.color.setHex(lcol[st]); v.lat.material.emissive.setHex(st === 'none' ? 0 : lcol[st]); showHeld(); }
  const held = () => Object.entries(nodeViz).filter(([, v]) => v.st !== 'none').map(([k, v]) => k + ':' + v.st);
  function showHeld() { if (heldLbl) kit.setLabel(heldLbl, protocol === 'olc' && panel === 'crab' ? 'latches held: none (optimistic readers take no latch)' : 'latches held: ' + (held().join('  ') || 'none'), { size: 0.34, color: H(C.yellow) }); }
  function say(t) { kit.setLabel(caption, t, { size: 0.32, color: C.text }); }
  function showVer(id, flash) { const v = nodeViz[id]; kit.setLabel(v.vl, protocol === 'olc' ? 'v' + ver[id] : '', { size: 0.26, color: flash ? '#f7768e' : H(C.yellow) }); }
  function toThread(id) { const n = N[id]; thread.visible = true; kit.move(thread, [n.x - 1.6, n.y + 0.2, 0.4], 0.5); }
  function pathOf() { return op === 'ins27' ? ['N0', 'N1', 'L2'] : ['N0', 'N2', 'L3']; }
  const isWrite = () => op !== 'srch55';
  function run() {
    kit.timers = []; kit.resetTimers(); pg.clear && null; rebuildCrab(false);
    const p = pathOf(); let t = 0.4; const ev = (dt, fn) => { t += dt; kit.at(t, fn); };
    const keyTxt = op === 'srch55' ? 'search(55)' : op === 'ins55' ? 'insert(55)' : 'insert(27) into FULL leaf';
    ev(0, () => say(keyTxt + (protocol === 'olc' ? ' via optimistic latch coupling' : ' via latch crabbing')));
    if (protocol === 'crab') {
      let heldIds = [];
      p.forEach((id, i) => {
        const mode = isWrite() ? 'W' : 'R';
        ev(0.9, () => { toThread(id); say(`${mode}-latch ${id} (${isWrite() ? 'exclusive' : 'shared'}) while still holding parent`); setLatch(id, mode); });
        heldIds.push(id);
        const safe = !isWrite() || N[id].keys.length < CAP;
        if (i > 0) ev(0.8, () => {
          if (!isWrite()) { say(`read: child ${id} latched, release parent ${p[i - 1]} (coupling)`); setLatch(p[i - 1], 'none'); }
          else if (safe) { say(`${id} is SAFE (${N[id].keys.length}/${CAP}: a split cannot propagate up) -> release ancestors`); p.slice(0, i).forEach(h => setLatch(h, 'none')); }
          else say(`${id} is FULL: a split will push a key into the parent -> keep ancestors latched`);
        });
      });
      if (op === 'ins55') ev(0.9, () => { N.L3.keys = [50, 55, 60]; kit.setLabel(nodeViz.L3.key, txt(N.L3.keys), { size: 0.36 }); say('insert 55 into L3 under W-latch; no split needed'); });
      if (op === 'ins27') ev(0.9, () => {
        say('split L2: move upper half to a new leaf, push separator 27 into N1 (needs N1 W-latch!)');
        const nl = kit.box(3.2, 1.2, 0.2, 0x2a4a58, -2.5, -5.0, 0, {}, pg); kit.label('[27|30]  new leaf', -2.4, -5.0, 0.2, { size: 0.3 }, pg); nl.material.emissive.setHex(0x335a66);
        kit.setLabel(nodeViz.L2.key, '[20|25]', { size: 0.36 }); kit.setLabel(nodeViz.N1.key, '[20|27|35]', { size: 0.36 }); kit.line([[-5, 0.4, 0], [-2.5, -4.4, 0]], C.edge, pg);
      });
      ev(1.2, () => { say('release all latches (leaf last held; writers exit)'); p.forEach(id => setLatch(id, 'none')); });
    } else {
      p.forEach((id, i) => {
        ev(0.9, () => { toThread(id); showVer(id); say(`read ${id} version v${ver[id]} (no latch, no write to shared memory)`); });
        if (i > 0) ev(0.7, () => {
          if (interfere && !run.bumped && id === 'N2' || interfere && !run.bumped && id === 'N1') {
            run.bumped = true; ver[p[i - 1]] += 2; showVer(p[i - 1], true); say(`a concurrent writer split ${p[i - 1]} (v bumped): validate FAILS -> restart from root`);
            kit.at(kit.clock + 1.2, () => { toThread('N0'); ver['N0'] = ver['N0']; say('RESTART: re-read root version'); run.bumped = true; const restart = p.slice(); restart.forEach((rid, j) => kit.at(kit.clock + 0.9 * (j + 1), () => { toThread(rid); ver[rid] = ver[rid]; showVer(rid); say(`retry: read ${rid} v${ver[rid]}, validate parent unchanged OK`); })); kit.at(kit.clock + 0.9 * (restart.length + 1), () => finishOlc()); });
          } else { say(`validate parent ${p[i - 1]} still v${ver[p[i - 1]]} -> safe to follow pointer`); }
        });
      });
      if (!interfere) ev(1.0, () => finishOlc());
      else kit.timers.push({ t: 99999, fn() {}, done: false });
    }
    function finishOlc() {
      const leaf = p[2];
      if (isWrite()) { say(`upgrade: CAS ${leaf} version v${ver[leaf]} -> locked (odd), modify, then v${ver[leaf] + 2} (unlock)`); setLatch(leaf, 'W'); ver[leaf] += 2; showVer(leaf); kit.at(kit.clock + 1.2, () => { setLatch(leaf, 'none'); say('done: only the leaf was ever write-latched'); }); }
      else say(`search done: validated every step, zero latch writes (scales across cores)`);
    }
    run.bumped = false;
  }
  function rebuildCrab(reset = true) {
    clearGroup(pg); N.L3.keys = [50, 60]; N.L2.keys = [20, 25, 30]; N.N1.keys = [20, 35];
    buildTree(); const labs = { crab: 'LATCH CRABBING (pessimistic coupling)', olc: 'OPTIMISTIC LATCH COUPLING (version validation)' };
    kit.label(labs[protocol] + '  |  op: ' + (op === 'srch55' ? 'search 55' : op === 'ins55' ? 'insert 55' : 'insert 27 (leaf full)'), 0, 6.3, 0, { size: 0.42, color: H(C.red) }, pg);
    caption = kit.label('press Run', 0, -6.0, 0, { size: 0.32 }, pg); heldLbl = kit.label('', 0, -6.8, 0, { size: 0.34, color: H(C.yellow) }, pg);
    kit.label('capacity 3 keys/node; "safe" = not full', -8.6, 6.3, 0, { size: 0.0001 }, pg);
    Object.keys(N).forEach(id => showVer(id)); showHeld();
  }
  function buildVsLock() {
    clearGroup(pg);
    const rows = [['', 'LATCH', 'LOCK'], ['Protects', 'in-memory structure', 'logical DB object'], ['Held by', 'a thread', 'a transaction'], ['Duration', 'one operation (us)', 'until commit/abort'], ['Modes', 'S / X (or version)', 'IS IX S SIX X ...'], ['Deadlocks', 'avoided by ordering', 'detected / timed out'], ['Rollback', 'none (just release)', 'released on abort'], ['Visible in', 'only wait stats', 'lock table views'], ['Cost', '~10-100 ns (CAS)', '~us (hash+queue)']];
    const t = tablePlane(kit, rows, { cellW: 330, cellH: 52, font: 24, scale: 0.0165, headCol: true }); t.position.set(0, 0.5, 0); pg.add(t);
    kit.label('LATCH vs LOCK', 0, 6.2, 0, { size: 0.5, color: H(C.red) }, pg);
    kit.label('Example: a lock keeps row 7 from being rewritten until I commit; a latch keeps the page bytes from tearing for the 200 ns I copy a tuple.', 0, -5.4, 0, { size: 0.28, color: C.dim }, pg);
    ctx.onInfo && ctx.onInfo('<b>Latch vs lock</b><br>Locks give <i>transactional</i> isolation between txns; latches give <i>physical</i> consistency between threads. Latches are not in the deadlock detector, so code must follow a strict acquisition order (top-down, left-to-right) or use try-latch.');
  }
  let cards = [];
  function buildPrims() {
    clearGroup(pg); kit.timers = []; kit.resetTimers(); cards = [];
    kit.label('LATCH PRIMITIVES (shared word in memory)', 0, 6.3, 0, { size: 0.45, color: H(C.red) }, pg);
    const defs = [
      { x: -6.6, title: 'Spinlock (TAS/CAS)', code: 'while(!CAS(&w,0,1)) pause;\n... critical ...\nstore(&w,0)', ev: [[0, '0', 'idle'], [1, '1', 'A: CAS 0->1 ok, in critical section'], [2.2, '1', 'B: CAS fails, spins (burns CPU)'], [3.5, '0', 'A: store 0 (release)'], [4.5, '1', 'B: CAS ok'], [6, '0', 'B releases']] },
      { x: 0, title: 'Reader-writer latch', code: 'word = [W bit | reader count]\nS: CAS(cnt+1) if !W\nX: CAS(0 -> W) if cnt==0', ev: [[0, 'W0 r0', 'idle'], [1, 'W0 r1', 'R1 shares'], [1.8, 'W0 r2', 'R2 shares'], [2.8, 'W0 r2', 'writer waits for readers to drain'], [4, 'W0 r0', 'readers leave'], [5, 'W1 r0', 'writer CAS 0->W ok'], [6.2, 'W0 r0', 'writer done']] },
      { x: 6.6, title: 'Version word (OLC)', code: 'read: v=load(w); read data;\n validate load(w)==v\nwrite: CAS v->v+1(locked)\n  ... ; store v+2', ev: [[0, 'v=4', 'reader loads v=4'], [1.2, 'v=5*', 'writer CAS 4->5 (odd = locked)'], [2.2, 'v=5*', 'writer mutates data'], [3.2, 'v=6', 'writer stores 6 (unlock)'], [4.2, 'v=6', 'reader validate 4 != 6: RETRY'], [5.5, 'v=6', 'reader reloads v=6, validates OK']] },
    ];
    defs.forEach(d => {
      kit.box(6.0, 7.6, 0.2, C.panel, d.x, -0.1, -0.1, {}, pg); kit.label(d.title, d.x, 3.3, 0.1, { size: 0.34, color: H(C.cyan) }, pg);
      kit.label(d.code, d.x, 1.4, 0.1, { size: 0.24, color: C.dim }, pg);
      const w = kit.box(3.2, 1.0, 0.2, 0x3d59a1, d.x, -1.3, 0.1, {}, pg); const wl = kit.label('', d.x, -1.3, 0.3, { size: 0.5, color: '#ffffff' }, pg);
      const sl = kit.label('', d.x, -3.0, 0.1, { size: 0.26, color: C.text }, pg);
      d.ev.forEach(([t, word, s]) => kit.at(t, () => { kit.setLabel(wl, word, { size: 0.5, color: '#ffffff' }); kit.setLabel(sl, s, { size: 0.26, color: C.text }); w.material.color.setHex(word.includes('1') || word.includes('*') ? 0xb03a4f : 0x3d59a1); }));
    });
    ctx.onInfo && ctx.onInfo('<b>Latch primitives</b><br>All latches are built on atomic CAS. A spinlock burns CPU while contended; an rwlock lets readers share but every reader still writes the word (cache-line ping-pong); optimistic version locks let readers only <i>read</i> memory and validate, which is why OLC B-trees (ART, Bw/OLC B+tree) scale.');
  }
  function show(p) { panel = p; kit.timers = []; kit.resetTimers(); if (p === 'crab') { rebuildCrab(); ctx.onInfo && ctx.onInfo('<b>Latch crabbing / OLC</b><br>Crabbing: latch child before releasing parent, so no thread can restructure the path under you. Writers release ancestors once the child is <i>safe</i> (not full for insert). Optimistic latch coupling avoids writing to shared latch words on the read path: read version, validate, restart on change.'); } else if (p === 'vs') buildVsLock(); else buildPrims(); }
  show('crab');
  const steps = [
    { title: 'Latch vs lock', text: 'Locks isolate transactions logically; latches protect physical structures between threads, held for microseconds, no deadlock detection.', run() { show('vs'); } },
    { title: 'Crabbing: search', text: 'Readers latch the child then release the parent: at most 2 S-latches at once, the root is released almost immediately.', run() { show('crab'); protocol = 'crab'; op = 'srch55'; rebuildCrab(); run(); } },
    { title: 'Crabbing: safe insert', text: 'Writers W-latch the path but release all ancestors as soon as a SAFE (non-full) node is latched: a split cannot propagate above it.', run() { show('crab'); protocol = 'crab'; op = 'ins55'; rebuildCrab(); run(); } },
    { title: 'Crabbing: split', text: 'Leaf L2 is full, so N1 stays W-latched while L2 splits and the separator is inserted into N1. Longer hold times, so root contention is avoided only because N0 was released.', run() { show('crab'); protocol = 'crab'; op = 'ins27'; rebuildCrab(); run(); } },
    { title: 'Optimistic latch coupling', text: 'Readers take NO latches: read node version, read pointer, re-validate the parent version. A concurrent split changes the version and forces a restart.', run() { show('crab'); protocol = 'olc'; op = 'ins55'; rebuildCrab(); run(); } },
    { title: 'Primitives', text: 'Spinlock, reader-writer word and version word: all just atomic CAS on a shared memory word.', run() { show('prims'); } },
  ];
  return {
    group: G, dispose() { kit.dispose(); }, steps, onConfigChange() {},
    update(dt) { kit.tick(dt); if (panel === 'prims' && kit.clock > period) kit.resetTimers(); },
    act(k, v) {
      if (k === 'panel') show(v); else if (k === 'proto') { protocol = v; if (panel === 'crab') rebuildCrab(); } else if (k === 'op') { op = v; if (panel === 'crab') rebuildCrab(); }
      else if (k === 'run') { if (panel !== 'crab') show('crab'); rebuildCrab(); run(); } else if (k === 'interfere') interfere = !!v;
    },
  };
}
const latchControls = [sel('panel', 'panel', [{ value: 'crab', label: 'B+tree latching' }, { value: 'vs', label: 'latch vs lock' }, { value: 'prims', label: 'primitives (CAS)' }], 'crab'),
  sel('proto', 'protocol', [{ value: 'crab', label: 'crabbing (latch coupling)' }, { value: 'olc', label: 'optimistic latch coupling' }], 'crab'),
  sel('op', 'operation', [{ value: 'srch55', label: 'search 55' }, { value: 'ins55', label: 'insert 55 (safe leaf)' }, { value: 'ins27', label: 'insert 27 (full leaf, split)' }], 'ins55', 'op'),
  tog('interfere', 'concurrent writer (OLC)', true), btn('run', 'Run operation', 'run')];

export const views = {
  'txn-manager': { build: buildTxnManager, controls: txnManagerControls },
  'concurrency-control': { build: buildCC, controls: ccControls },
  'lock-manager': { build: buildLockMgr, controls: lockControls },
  'latch': { build: buildLatch, controls: latchControls },
};
