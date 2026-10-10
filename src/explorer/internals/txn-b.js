// internals-E1: mvcc, timestamp-oracle, isolation-levels, deadlock-detector
import * as THREE from 'three';
import { Kit, tablePlane, C, H } from './txn-kit.js';

/* ---------- local dynamic-content helpers (own their geometry; cleared with clearGroup) ---------- */
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, emissive: o.emissive ?? 0, emissiveIntensity: 0.5, transparent: o.opacity != null, opacity: o.opacity ?? 1 });
function dBox(p, w, h, d, color, x, y, z = 0, o = {}) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, o)); m.position.set(x, y, z); p.add(m); return m; }
function dSphere(p, r, color, x, y, z = 0) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat(color, { emissive: color })); m.position.set(x, y, z); p.add(m); return m; }
function dLabel(ctx, p, text, x, y, z = 0, o = {}) { const s = ctx.makeLabel(text, { size: 0.4, color: C.text, ...o }); s.position.set(x, y, z); p.add(s); return s; }
function dArrow(p, a, b, color = C.edge, th = 0.05) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), dir = B.clone().sub(A), len = dir.length(), n = dir.clone().normalize();
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color });
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(th, th, Math.max(0.05, len - 0.3), 6), m);
  cyl.position.copy(A.clone().add(B).multiplyScalar(0.5).sub(n.clone().multiplyScalar(0.15)));
  const head = new THREE.Mesh(new THREE.ConeGeometry(th * 3, 0.3, 8), m); head.position.copy(B.clone().sub(n.clone().multiplyScalar(0.15)));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); cyl.quaternion.copy(q); head.quaternion.copy(q);
  g.add(cyl, head); p.add(g); return g;
}
function clearGroup(g) {
  while (g.children.length) {
    const c = g.children.pop();
    c.traverse(o => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
  }
}
function base(ctx) { const kit = new Kit(ctx); const dyn = new THREE.Group(); kit.group.add(dyn); return { kit, dyn }; }
const cfgv = (ctx, slot, def) => (ctx.config && ctx.config[slot]) || def;
const lines = (...a) => a.join('\n');

/* =====================================================================================
   MVCC
   ===================================================================================== */
let I_mvcc = null;
const MV_SCHEMES = [
  { value: 'append-only', label: 'append-only (PostgreSQL heap + VACUUM)' },
  { value: 'delta-undo', label: 'delta / undo chain (InnoDB roll ptr + read view)' },
  { value: 'time-travel', label: 'time-travel table (SQL Server / Hekaton style)' },
];
function buildMvcc(ctx) {
  const { kit, dyn } = base(ctx);
  let scheme = cfgv(ctx, 'mvcc-storage', 'append-only');
  let S = 25, t30 = false;
  const fresh = () => [
    { id: 1, val: 100, xmin: 10, xmax: 20, xminC: true, xmaxC: true },
    { id: 2, val: 200, xmin: 20, xmax: 30, xminC: true, xmaxC: false },
    { id: 3, val: 300, xmin: 30, xmax: null, xminC: false, xmaxC: false },
  ];
  let vers = fresh();
  const effEnd = v => (v.xmax != null && v.xmaxC ? v.xmax : Infinity);
  const visible = v => v.xminC && v.xmin <= S && effEnd(v) > S;
  const dead = v => v.xminC && effEnd(v) <= S; // horizon H = oldest active snapshot = S
  const tx = ts => -7.2 + ts * 0.4;
  let walk = [], walkPos = [], walkT = 0, result = null;
  const title = kit.label('', 0, 5.8, 0, { size: 0.5, color: H(C.red) });
  const sub = kit.label('', 0, 5.1, 0, { size: 0.34, color: C.dim });

  function reasonFor(v) {
    const cr = v.xminC ? `creator T${v.xmin} committed` : `creator T${v.xmin} still ACTIVE`;
    if (!v.xminC) return `${cr} -> invisible`;
    if (v.xmin > S) return `${cr}, but ts ${v.xmin} > S=${S} -> invisible`;
    if (effEnd(v) <= S) return `${cr}; deleter T${v.xmax} committed at ${v.xmax} <= S -> invisible`;
    if (v.xmax != null && !v.xmaxC) return `${cr}; deleter T${v.xmax} not committed -> still live: VISIBLE`;
    return `${cr}; ts ${v.xmin} <= S=${S}, not deleted -> VISIBLE`;
  }
  function rebuild() {
    clearGroup(dyn); walk = []; walkPos = []; walkT = 0;
    const order = scheme === 'append-only' ? vers.slice() : vers.slice().reverse(); // oldest->newest vs newest->oldest
    // positions
    const pos = {};
    const nameOf = scheme === 'append-only' ? 'heap tuple' : scheme === 'delta-undo' ? 'record' : 'version';
    const hdr = {
      'append-only': 'HEAP PAGE: UPDATE = new tuple appended; old tuple keeps xmax. t_ctid links old -> new. Dead tuples wait for VACUUM.',
      'delta-undo': 'CLUSTERED INDEX holds ONLY the newest row; older versions are rebuilt by applying UNDO deltas via DB_ROLL_PTR.',
      'time-travel': 'MASTER table holds newest version; older versions are moved to a separate TIME-TRAVEL table (begin/end ts).',
    }[scheme];
    kit.setLabel(sub, hdr.replace(/(.{80,}?) /, '$1\n'), { size: 0.34, color: C.dim });
    const n = vers.length;
    if (scheme === 'append-only') {
      vers.forEach((v, i) => { pos[v.id] = [-5.6 + i * 5.6, 2.1]; });
      dLabel(ctx, dyn, 'index -> TID of oldest', -9.2, 4.1, 0, { size: 0.3, color: H(C.cyan) });
    } else if (scheme === 'delta-undo') {
      const nv = vers.slice().reverse();
      nv.forEach((v, i) => { pos[v.id] = i === 0 ? [-6.6, 2.1] : [-0.6 + (i - 1) * 5.6, 2.1]; });
      dBox(dyn, 11.3, 4.0, 0.1, 0x14182a, 2.2, 2.1, -0.3);
      dLabel(ctx, dyn, 'UNDO LOG (rollback segment)', 3.3, 4.3, 0, { size: 0.32, color: H(C.orange) });
      dLabel(ctx, dyn, 'clustered idx', -6.6, 4.3, 0, { size: 0.32, color: H(C.cyan) });
    } else {
      const nv = vers.slice().reverse();
      nv.forEach((v, i) => { pos[v.id] = i === 0 ? [-6.6, 2.1] : [-0.6 + (i - 1) * 5.6, 2.1]; });
      dBox(dyn, 11.3, 4.0, 0.1, 0x14182a, 2.2, 2.1, -0.3);
      dLabel(ctx, dyn, 'master table', -6.6, 4.3, 0, { size: 0.32, color: H(C.cyan) });
      dLabel(ctx, dyn, 'TIME-TRAVEL table (history, begin|end)', 3.3, 4.3, 0, { size: 0.32, color: H(C.orange) });
    }
    // boxes
    vers.forEach((v, idx) => {
      const [x, y] = pos[v.id];
      const vis = visible(v), dd = dead(v), unc = !v.xminC;
      const col = vis ? C.green : dd ? 0x3a3f58 : unc ? 0x7a5a2a : 0x2a3552;
      dBox(dyn, 4.6, 2.9, 0.2, col, x, y, 0, { emissive: vis ? 0x1a4a10 : 0 });
      const isNewestMain = scheme !== 'append-only' && v.id === vers[vers.length - 1].id;
      let txt;
      const cm = ts => ts; 
      if (scheme === 'append-only') txt = lines(`tuple v${v.id}  val=${v.val}`, `xmin=${v.xmin}${v.xminC ? '' : '?'}  xmax=${v.xmax ?? '0'}${v.xmax != null && !v.xmaxC ? '?' : ''}`, vers[idx + 1] ? `t_ctid -> v${vers[idx + 1].id}` : 't_ctid -> self (newest)', dd ? 'DEAD (vacuum-able)' : vis ? 'VISIBLE to S' : unc ? 'uncommitted' : '');
      else if (scheme === 'delta-undo') txt = isNewestMain ? lines(`row  val=${v.val}`, `DB_TRX_ID=${v.xmin}${v.xminC ? '' : ' (active)'}`, vers.length > 1 ? 'DB_ROLL_PTR -> undo' : 'ROLL_PTR = null', vis ? 'VISIBLE to S' : unc ? 'invisible: in ReadView' : '') : lines(`undo: restores`, `val=${v.val} (trx ${v.xmin})`, vers[idx - 1] && idx > 0 ? `prev ptr -> older` : 'prev ptr = null', dd ? 'purgeable' : vis ? 'VISIBLE to S' : '');
      else txt = isNewestMain ? lines(`master  val=${v.val}`, `begin=${v.xmin}${v.xminC ? '' : '?'} end=inf`, vers.length > 1 ? 'chain -> time-travel tbl' : '', vis ? 'VISIBLE to S' : unc ? 'uncommitted' : '') : lines(`hist  val=${v.val}`, `begin=${v.xmin} end=${v.xmax}${v.xmaxC ? '' : '?'}`, dd ? 'dead: purge' : vis ? 'VISIBLE to S' : '');
      dLabel(ctx, dyn, txt, x, y, 0.2, { size: 0.33, color: vis ? '#0b0d14' : C.text });
      pos[v.id].push(vis);
    });
    // chain arrows
    const chain = scheme === 'append-only' ? vers : vers.slice().reverse();
    for (let i = 0; i < chain.length - 1; i++) { const a = pos[chain[i].id], b = pos[chain[i + 1].id]; dArrow(dyn, [a[0] + 2.35, a[1], 0.3], [b[0] - 2.35, b[1], 0.3], scheme === 'append-only' ? C.cyan : C.orange, 0.06); }
    // walk
    for (const v of (scheme === 'append-only' ? vers : vers.slice().reverse())) {
      walk.push({ v, ok: visible(v), why: reasonFor(v) }); walkPos.push([pos[v.id][0], pos[v.id][1] + 1.9]);
      if (visible(v)) break;
    }
    const hit = walk.find(w => w.ok);
    result = hit ? hit.v : null;
    // timeline
    dLabel(ctx, dyn, 'timeline (ts)   version valid-interval [xmin, xmax)', 0, -1.2, 0, { size: 0.32, color: C.dim });
    for (let t = 0; t <= 40; t += 10) { dLabel(ctx, dyn, String(t), tx(t), -5.9, 0, { size: 0.3, color: C.dim }); dBox(dyn, 0.03, 4.0, 0.02, 0x2a3050, tx(t), -3.6, -0.1); }
    vers.forEach((v, i) => {
      const y = -2.0 - i * 0.9, s = v.xmin, e = Math.min(40, effEnd(v) === Infinity ? 40 : effEnd(v)); const w = Math.max(0.1, (e - s) * 0.4);
      dBox(dyn, w, 0.5, 0.15, dead(v) ? 0x3a3f58 : visible(v) ? C.green : v.xminC ? C.blue : C.yellow, tx(s) + w / 2, y, 0);
      dLabel(ctx, dyn, `v${v.id}`, tx(s) - 0.7, y, 0.1, { size: 0.33 });
      dLabel(ctx, dyn, `${v.val}`, tx(s) + w / 2, y, 0.2, { size: 0.3, color: '#0b0d14' });
    });
    dBox(dyn, 0.08, 4.3, 0.1, C.yellow, tx(S), -3.6, 0.2);
    dLabel(ctx, dyn, `S=${S} (snapshot = GC horizon H)`, tx(S) + (S > 28 ? -3.2 : 3.2), -5.5, 0.2, { size: 0.32, color: H(C.yellow) });
    // reader marker
    marker.visible = walkPos.length > 0; if (walkPos[0]) marker.position.set(walkPos[0][0], walkPos[0][1], 0.5);
    const ndead = vers.filter(dead).length;
    kit.setLabel(title, hit ? `Reader (S=${S}) sees v${hit.v.id} : val=${hit.v.val}` : `Reader (S=${S}) sees NO version (row does not exist yet)`, { size: 0.5, color: hit ? H(C.green) : H(C.red) });
    ctx.onInfo(`<b>MVCC row k=42 &mdash; ${MV_SCHEMES.find(s => s.value === scheme).label}</b><br>` +
      walk.map(w => `v${w.v.id}: ${w.why}`).join('<br>') +
      `<br><br><b>GC:</b> oldest active snapshot H=${S}. Versions with deleter commit &le; H are invisible to <i>every</i> current and future reader: <b>${ndead} dead</b>. ` +
      (scheme === 'append-only' ? 'VACUUM marks the tuple slot reusable (PG cannot shrink the page; dead tuples bloat heap and indexes; a long-running txn pins H and blocks cleanup).' : scheme === 'delta-undo' ? 'The purge thread frees undo records older than the oldest ReadView; a long txn makes the history list grow and reads walk longer chains.' : 'Old versions are purged from the time-travel table; the master table stays compact, so scans stay fast.') +
      `<br><br>Visibility rule: <code>xmin committed &amp;&amp; xmin &le; S &amp;&amp; (xmax = null || xmax not committed || xmax &gt; S)</code>`);
  }
  const marker = kit.sphere(0.35, C.yellow, 0, 0, 0.5); marker.visible = false;
  rebuild();
  const inst = {
    group: kit.group,
    update(dt) {
      kit.tick(dt); walkT += dt;
      if (walkPos.length) { const i = Math.max(0, Math.min(walkPos.length - 1, Math.floor(walkT / 0.9))); const p = walkPos[i]; marker.position.x += (p[0] - marker.position.x) * 0.2; marker.position.y += (p[1] + Math.sin(walkT * 4) * 0.08 - marker.position.y) * 0.2; }
    },
    dispose() { clearGroup(dyn); kit.dispose(); I_mvcc = null; },
    onConfigChange(c) { if (c['mvcc-storage'] && c['mvcc-storage'] !== scheme) { scheme = c['mvcc-storage']; rebuild(); } },
    setScheme(v) { scheme = v; rebuild(); }, setS(v) { S = v; rebuild(); },
    commit() { t30 = true; const v3 = vers.find(v => v.id === 3), v2 = vers.find(v => v.id === 2); if (v3) v3.xminC = true; if (v2) v2.xmaxC = true; rebuild(); },
    vacuum() { vers = vers.filter(v => !dead(v)); rebuild(); },
    reset() { vers = fresh(); t30 = false; S = 25; rebuild(); },
    steps: [
      { title: 'A row, many versions', text: 'Row k=42 was written by T10 (val 100), updated by T20 (200) and by T30 (300, not yet committed). An UPDATE never overwrites in place; it creates a new version stamped with the writer id (xmin/begin) and ends the old one (xmax/end). Bars below show each version\'s validity interval.', run() { inst.reset(); } },
      { title: 'Snapshot read S=25', text: 'A reader takes snapshot S=25. Walk the chain applying the visibility rule: v1 was ended by T20 (<=25) so it is invisible; v2 was created at 20 and its deleter T30 has not committed, so v2 is VISIBLE. No locks taken, writers are not blocked.', run() { inst.setS(25); } },
      { title: 'Uncommitted writer invisible', text: 'Move to S=35: v3 has ts 30 <= 35, but T30 is still active (it sits in the ReadView / snapshot xip list), so v3 is skipped. The reader still sees 200: readers never see uncommitted data.', run() { inst.setS(35); } },
      { title: 'T30 commits', text: 'After T30 commits, v2 gets a committed xmax=30 and v3 becomes visible to snapshots >= 30. A reader at S=25 still sees v2 - repeatable.', run() { inst.commit(); } },
      { title: 'GC horizon', text: 'H = oldest active snapshot. With S=25 the old version v1 (ended at 20 <= 25) can never be seen again: dead. A long-running reader at small S pins H low and keeps garbage alive (try S=15).', run() { inst.setS(25); } },
      { title: 'VACUUM / purge', text: 'Reclaim dead versions. Append-only: VACUUM marks tuple slots free (heap bloat risk). Undo: purge truncates the history list. Time-travel: delete from history table. Use the scheme selector to compare the three storage layouts.', run() { inst.vacuum(); } },
    ],
  };
  I_mvcc = inst; return inst;
}

/* =====================================================================================
   TIMESTAMP ORACLE
   ===================================================================================== */
let I_tso = null;
function buildTso(ctx) {
  const { kit, dyn } = base(ctx);
  const st = { now: 5000, lastP: 5000, lastL: -1, limit: 8000, rpc: 0, issued: 0, persists: 1, batch: true, rate: 4, pend: [], log: [], flush: 0, spawn: 0, seed: 7, prev: -1, ok: 0, dirty: true, failovers: 0, note: 'steady state' };
  const rnd = () => { st.seed = (st.seed * 16807) % 2147483647; return st.seed / 2147483647; };
  const CL = [[-9.2, 3.8], [-9.2, 0], [-9.2, -3.8]];
  CL.forEach((p, i) => { kit.box(2.6, 1.7, 0.2, 0x2a3552, p[0], p[1], 0); kit.label(`txn client ${'ABC'[i]}`, p[0], p[1] + 0.2, 0.3, { size: 0.32 }); });
  const clientTs = CL.map((p, i) => kit.label('-', p[0], p[1] - 0.35, 0.3, { size: 0.3, color: H(C.green) }));
  const tsoBox = kit.box(5.8, 4.6, 0.2, 0x3a2f5a, -1.8, 1.4, 0);
  kit.label('TSO  (PD leader)', -1.8, 3.3, 0.3, { size: 0.4, color: H(C.purple) });
  const tsoTxt = kit.label('', -1.8, 1.2, 0.3, { size: 0.36 });
  kit.box(5.8, 2.0, 0.2, 0x1e3a3f, -1.8, -3.8, 0);
  const rafBox = kit.group.children[kit.group.children.length - 1];
  const rafTxt = kit.label('', -1.8, -3.8, 0.3, { size: 0.33, color: H(C.cyan) });
  kit.arrow([-1.8, -0.8, 0.3], [-1.8, -2.7, 0.3], C.cyan);
  kit.label('persist high-water\nmark (Raft)', 0.8, -1.8, 0.3, { size: 0.28, color: C.dim });
  const stats = kit.label('', -1.8, 4.7, 0.3, { size: 0.34, color: C.dim });
  kit.label('ts = physical_ms << 18 | logical(18 bits)', -1.8, -5.6, 0.3, { size: 0.3, color: C.dim });
  // contrast panel
  const panels = [
    { id: 'timestamp-oracle', y: 4.0, t: lines('TSO (this view)', 'central counter, 1 RTT/batch', 'strict total order; Percolator,', 'TiDB/PD, Omid; SPOF -> Raft'), c: C.purple },
    { id: 'hlc', y: 0.4, t: lines('HLC (l, c) per node', 'l=max(l, pt, msg.l); c breaks ties', 'no RTT, causality only; CockroachDB', 'needs max clock offset (500ms)'), c: C.yellow },
    { id: 'truetime', y: -3.2, t: lines('TrueTime [earliest, latest]', 'GPS+atomic clocks, eps ~7ms', 'Spanner: commit-wait eps so ts', 'order = real-time order'), c: C.green },
  ];
  const clk = cfgv(ctx, 'clock', 'timestamp-oracle');
  panels.forEach(p => {
    const sel = clk === p.id;
    kit.box(7.9, 2.9, 0.2, sel ? 0x2e3558 : 0x151829, 8.2, p.y, -0.2);
    kit.label(p.t, 8.2, p.y, 0.1, { size: 0.3, color: sel ? H(p.c) : C.dim });
  });
  kit.label('contrast (clock slot)', 8.2, 5.8, 0, { size: 0.34, color: C.dim });
  const logLbl = kit.label('', 8.2, -6.4, 0.3, { size: 0.3, color: C.dim });

  const fmt = (p, l) => `${p}|${String(l).padStart(5, '0')}`;
  function refresh() {
    kit.setLabel(tsoTxt, lines(`physical = ${Math.floor(Math.max(st.now, st.lastP))} ms`, `logical  = ${Math.max(0, st.lastL)}`, `last ts  = ${st.lastL < 0 ? '-' : st.lastP * 262144 + st.lastL}`, `pending batch: ${st.pend.length}`), { size: 0.36 });
    kit.setLabel(rafTxt, lines(`persisted limit = ${st.limit} ms`, `(window now+3s; ${st.persists} writes)`), { size: 0.33, color: H(C.cyan) });
    kit.setLabel(stats, `${st.issued} ts issued / ${st.rpc} RPCs = ${(st.issued / Math.max(1, st.rpc)).toFixed(1)} ts per RPC  |  ${st.note}`, { size: 0.34, color: C.dim });
    kit.setLabel(logLbl, st.log.map(l => `${'ABC'[l.c]} <- ${l.ts}${l.ok ? '' : '  !!NOT MONOTONIC'}`).join('\n') || 'issued log', { size: 0.3, color: C.dim });
    ctx.onInfo(`<b>Timestamp Oracle</b><br>Every txn needs a begin_ts / commit_ts from a single strictly increasing sequence, so MVCC visibility (xmin&le;S) and write ordering reduce to integer comparison. A TSO packs <code>physical_ms&lt;&lt;18 | logical</code>: many ts per ms via the logical part.<br><br><b>Batching:</b> requests that arrive while an RPC is in flight share one call returning a range [n, n+k). ${st.batch ? 'ON' : 'OFF'} now: ${st.rpc} RPCs for ${st.issued} timestamps.<br><br><b>Crash safety:</b> the leader persists a high-water mark ~3s ahead (${st.limit}). After failover the new leader starts at the persisted limit, never reissuing a ts.`);
  }
  function fly(a, b, color, dur, done) {
    const s = dSphere(dyn, 0.22, color, a[0], a[1], 0.5);
    kit.tween(dur, (k, raw) => { s.position.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, 0.5); if (raw >= 1) { dyn.remove(s); s.geometry.dispose(); s.material.dispose(); done && done(); } });
  }
  function request(c) {
    const p = CL[c]; fly([p[0] + 1.4, p[1]], [-4.7, 1.4 + (c - 1) * 0.6], C.yellow, 0.5, () => {
      if (st.batch) { st.pend.push(c); } else { st.rpc++; issue([c]); }
      st.dirty = true;
    });
  }
  function issue(cs) {
    let p = Math.floor(Math.max(st.now, st.lastP)), l = p === st.lastP ? st.lastL + 1 : 0;
    const first = [p, l];
    cs.forEach(c => {
      if (l >= 262144) { p++; l = 0; }
      const ts = p * 262144 + l; const ok = ts > st.prev; st.prev = ts;
      st.log.unshift({ c, ts: fmt(p, l), ok }); st.log.length = Math.min(st.log.length, 4);
      st.issued++; const cp = CL[c];
      kit.setLabel(clientTs[c], `ts=${fmt(p, l)}`, { size: 0.28, color: H(C.green) });
      fly([-4.7, 1.4 + (c - 1) * 0.6], [cp[0] + 1.4, cp[1]], C.green, 0.5);
      l++;
    });
    st.lastP = p; st.lastL = l - 1;
    if (st.lastP > st.limit - 1500) { st.limit = st.lastP + 3000; st.persists++; st.note = 'persisted new window to Raft'; kit.tween(0.6, k => { rafBox.material.emissive.setHex(0x2ac3de); rafBox.material.emissiveIntensity = 1 - k; }); }
    st.dirty = true; return first;
  }
  function flush() {
    if (!st.pend.length) return; st.rpc++; const cs = st.pend.splice(0); issue(cs); st.note = `1 RPC served ${cs.length} txn(s): range [${cs.length}]`;
  }
  const inst = {
    group: kit.group,
    update(dt) {
      kit.tick(dt); st.now += dt * 1000; st.spawn += dt * st.rate; st.flush += dt;
      while (st.spawn >= 1) { st.spawn -= 1; request(Math.floor(rnd() * 3)); }
      if (st.flush >= 0.4) { st.flush = 0; flush(); }
      if (st.dirty) { st.dirty = false; refresh(); }
    },
    dispose() { clearGroup(dyn); kit.dispose(); I_tso = null; },
    onConfigChange() {},
    req() { request(Math.floor(rnd() * 3)); }, setBatch(v) { st.batch = !!v; if (!st.batch) flush(); st.note = st.batch ? 'batching ON' : 'batching OFF: 1 RPC per ts'; st.dirty = true; },
    setRate(v) { st.rate = v; },
    crash() {
      st.pend = []; st.failovers++; st.lastP = Math.max(st.lastP, st.limit); st.lastL = -1; st.note = `FAILOVER: new leader resumes at persisted limit ${st.limit}`; st.dirty = true;
      kit.tween(0.8, (k) => { tsoBox.material.emissive.setHex(0xf7768e); tsoBox.material.emissiveIntensity = 1 - k; });
    },
    steps: [
      { title: 'Why a global counter', text: 'MVCC and OCC need begin_ts and commit_ts that totally order transactions. One service handing out a strictly increasing integer makes "who is earlier" a trivial compare - at the cost of a network round trip per timestamp.', run() { inst.setRate(1); } },
      { title: 'Request one timestamp', text: 'A txn client sends GetTS to the TSO. The TSO combines its physical clock (ms) with a logical counter: within the same millisecond, logical++ so ts stay unique and increasing even at 100k+/s.', run() { inst.req(); } },
      { title: 'Batching ON', text: 'Under load, requests that arrive during the same window are served by a single RPC returning a range. Watch the "ts per RPC" ratio rise above 1 (PD client batches GetTS calls).', run() { inst.setRate(10); inst.setBatch(true); } },
      { title: 'Batching OFF', text: 'Without batching every txn pays its own RPC: throughput is bounded by RTT and the TSO CPU. Compare the ts-per-RPC ratio (resets as new samples accrue).', run() { inst.setBatch(false); } },
      { title: 'Crash / failover', text: 'The TSO never keeps its counter only in memory: it persists a high-water mark (now+3s) to Raft/etcd. A new leader starts from that limit, so timestamps remain monotonic even though some of the old window was never used.', run() { inst.setBatch(true); inst.crash(); } },
      { title: 'HLC vs TrueTime', text: 'Right panel: HLC (CockroachDB) gives causal order with no central service but needs bounded clock offset; TrueTime (Spanner) exposes uncertainty [earliest, latest] and uses commit-wait. The TSO is simplest but is a central dependency (and a cross-region RTT).', run() {} },
    ],
  };
  refresh(); I_tso = inst; return inst;
}

/* =====================================================================================
   ISOLATION LEVELS
   ===================================================================================== */
const LV = ['RU', 'RC', 'RR', 'SI', 'SER'];
const LV_NAME = { RU: 'READ UNCOMMITTED', RC: 'READ COMMITTED', RR: 'REPEATABLE READ (2PL read locks)', SI: 'SNAPSHOT', SER: 'SERIALIZABLE' };
const LV_VALUE = { RU: 'read-uncommitted', RC: 'read-committed', RR: 'repeatable-read', SI: 'snapshot', SER: 'serializable' };
const CFG2LV = { 'read-uncommitted': 'RU', 'read-committed': 'RC', 'repeatable-read': 'RR', snapshot: 'SI', serializable: 'SER' };
const ANOMS = {
  dirty: { name: 'Dirty read', init: { x: 100 }, ops: [{ t: 1, o: 'W', k: 'x', f: () => 200 }, { t: 2, o: 'R', k: 'x', as: 'v' }, { t: 1, o: 'A' }, { t: 2, o: 'C' }], occurs: r => r.vars[2]?.v === 200 },
  nr: { name: 'Non-repeatable read', init: { x: 1 }, ops: [{ t: 1, o: 'R', k: 'x', as: 'a' }, { t: 2, o: 'W', k: 'x', f: () => 2 }, { t: 2, o: 'C' }, { t: 1, o: 'R', k: 'x', as: 'b' }, { t: 1, o: 'C' }], occurs: r => r.vars[1]?.a !== undefined && r.vars[1]?.b !== undefined && r.vars[1].a !== r.vars[1].b },
  phantom: { name: 'Phantom', init: { a1: 10, a2: 20 }, ops: [{ t: 1, o: 'RP', k: 'a', as: 'p1' }, { t: 2, o: 'INS', k: 'a3', f: () => 30 }, { t: 2, o: 'C' }, { t: 1, o: 'RP', k: 'a', as: 'p2' }, { t: 1, o: 'C' }], occurs: r => r.vars[1]?.p1 !== undefined && r.vars[1]?.p2 !== undefined && r.vars[1].p1 !== r.vars[1].p2 },
  lost: { name: 'Lost update', init: { c: 100 }, ops: [{ t: 1, o: 'R', k: 'c', as: 'v' }, { t: 2, o: 'R', k: 'c', as: 'v' }, { t: 1, o: 'W', k: 'c', f: v => v.v + 10 }, { t: 1, o: 'C' }, { t: 2, o: 'W', k: 'c', f: v => v.v + 20 }, { t: 2, o: 'C' }], occurs: r => r.st[1] === 'committed' && r.st[2] === 'committed' && r.final.c !== 130 },
  skew: { name: 'Write skew', init: { x: 1, y: 1 }, ops: [{ t: 1, o: 'R', k: 'x', as: 'a' }, { t: 1, o: 'R', k: 'y', as: 'b' }, { t: 2, o: 'R', k: 'x', as: 'a' }, { t: 2, o: 'R', k: 'y', as: 'b' }, { t: 1, o: 'W', k: 'x', f: v => (v.a + v.b >= 2 ? 0 : v.a) }, { t: 2, o: 'W', k: 'y', f: v => (v.a + v.b >= 2 ? 0 : v.b) }, { t: 1, o: 'C' }, { t: 2, o: 'C' }], occurs: r => r.st[1] === 'committed' && r.st[2] === 'committed' && r.final.x + r.final.y === 0 },
  ro: { name: 'Read-only anomaly', init: { x: 0, y: 0 }, ops: [{ t: 2, o: 'R', k: 'x', as: 'a' }, { t: 2, o: 'R', k: 'y', as: 'b' }, { t: 1, o: 'R', k: 'y', as: 'b' }, { t: 1, o: 'W', k: 'y', f: v => v.b + 20 }, { t: 1, o: 'C' }, { t: 3, o: 'R', k: 'x', as: 'a' }, { t: 3, o: 'R', k: 'y', as: 'b' }, { t: 3, o: 'C' }, { t: 2, o: 'W', k: 'x', f: v => (v.a + v.b - 10 < 0 ? v.a - 11 : v.a - 10) }, { t: 2, o: 'C' }], occurs: r => r.vars[3]?.b === 20 && r.vars[3]?.a === 0 && r.st[2] === 'committed' && r.final.x === -11 },
};
const SHORT = { dirty: 'Dirty read', nr: 'Non-rep. read', phantom: 'Phantom', lost: 'Lost update', skew: 'Write skew', ro: 'Read-only anom.' };
const AN_ORDER = ['dirty', 'nr', 'phantom', 'lost', 'skew', 'ro'];
const AN_DESC = {
  dirty: 'T1 writes x=200 then ABORTS. T2 reads x between: sees 200, a value that never existed.',
  nr: 'T1 reads x twice; T2 commits x=2 in between. T1 sees 1 then 2.',
  phantom: 'T1 counts rows with key a*; T2 inserts a3 and commits; T1 counts again.',
  lost: 'c=100. T1 and T2 both read 100 and add 10 / 20 (read-modify-write). Serial result is 130.',
  skew: 'x,y = doctors on call (invariant x+y>=1). Each reads both, sees 2, takes THEIR OWN row off call. Disjoint writes.',
  ro: 'Fekete: T2 withdraws from x (fee if x+y<10). T1 deposits 20 into y. Read-only T3 reports x=0,y=20 before T2 commits.',
};
function simulate(an, lvl, ser) {
  const A = ANOMS[an]; const mode = lvl === 'SER' ? (ser === '2pl' ? 'SER2' : 'SSI') : lvl;
  const snapBased = mode === 'SI' || mode === 'SSI', readLocks = mode === 'RR' || mode === 'SER2';
  const vers = {}; for (const k in A.init) vers[k] = [{ val: A.init[k], ts: 0 }];
  let clock = 0; const T = {}; A.ops.forEach(o => { if (!T[o.t]) T[o.t] = { id: o.t, snap: null, st: 'active', vars: {}, w: {}, wk: new Set(), r: new Set(), preds: [], in: new Set(), out: new Set(), S: new Set(), X: new Set(), pl: [], cts: null }; });
  const log = [], tags = new Set(), msgs = []; let blockCount = 0, abortCount = 0;
  const push = (t, kind, text) => log.push({ t, kind, text });
  const latest = k => { const a = vers[k]; return a && a.length ? a[a.length - 1] : null; };
  const snapVal = (t, k) => { const a = vers[k] || []; for (let i = a.length - 1; i >= 0; i--) if (a[i].ts <= t.snap) return a[i]; return null; };
  const others = t => Object.values(T).filter(u => u !== t);
  const live = u => u.st === 'active';
  const edge = (a, b) => { a.out.add(b); b.in.add(a); };
  function releaseAll(t) { t.S.clear(); t.X.clear(); t.pl = []; }
  function abortTx(t, why) { t.st = 'aborted'; t.w = {}; releaseAll(t); abortCount++; if (why) msgs.push(why); }
  function doRead(t, k) {
    if (k in t.w) return { val: t.w[k] };
    if (readLocks) { const b = others(t).filter(u => live(u) && u.X.has(k)); if (b.length) return { block: b }; t.S.add(k); }
    let ver;
    if (mode === 'RU') { const d = others(t).filter(u => live(u) && k in u.w).pop(); if (d) return { val: d.w[k] }; ver = latest(k); }
    else if (snapBased) {
      ver = snapVal(t, k);
      if (mode === 'SSI') for (const u of others(t)) if ((live(u) && k in u.w) || (u.st === 'committed' && u.wk.has(k) && u.cts > t.snap)) edge(t, u);
      const lt = latest(k); if ((lt && ver && lt !== ver) || others(t).some(u => live(u) && k in u.w)) tags.add('snapshot');
    } else { ver = latest(k); if (mode === 'RC' && others(t).some(u => live(u) && k in u.w)) tags.add('commitonly'); }
    t.r.add(k); return { val: ver ? ver.val : null };
  }
  function doRP(t, p) {
    const keys = Object.keys(vers).filter(k => k.startsWith(p));
    if (readLocks) { const b = others(t).filter(u => live(u) && keys.some(k => u.X.has(k))); if (b.length) return { block: b }; keys.forEach(k => t.S.add(k)); if (mode === 'SER2') t.pl.push(p); }
    let n = 0;
    keys.forEach(k => { const ver = snapBased ? snapVal(t, k) : latest(k); if (ver) n++; });
    if (snapBased && keys.some(k => latest(k) && snapVal(t, k) !== latest(k))) tags.add('snapshot');
    if (mode === 'SSI') { t.preds.push(p); for (const u of others(t)) for (const k of Object.keys(u.w)) if (k.startsWith(p) && live(u)) edge(t, u); for (const u of others(t)) if (u.st === 'committed' && u.cts > t.snap && [...u.wk].some(k => k.startsWith(p))) edge(t, u); }
    return { val: n };
  }
  function doWrite(t, k, val, ins) {
    const b = others(t).filter(u => live(u) && (u.X.has(k) || (readLocks && u.S.has(k))));
    if (b.length) return { block: b };
    if (mode === 'SER2') { const pb = others(t).filter(u => live(u) && u.pl.some(p => k.startsWith(p))); if (pb.length) { tags.add('predlock'); return { block: pb }; } }
    if (snapBased) { const lt = latest(k); if (lt && lt.ts > t.snap) { tags.add('fcw'); return { abort: `first-committer-wins: ${k} was committed at ts ${lt.ts} > snapshot ${t.snap}`, short: 'write-write\nconflict (FCW)' }; } }
    t.X.add(k); t.w[k] = val; t.wk.add(k);
    if (mode === 'SSI') for (const u of others(t)) if ((u.r.has(k) || u.preds.some(p => k.startsWith(p))) && (live(u) || (u.st === 'committed' && u.cts > t.snap))) edge(u, t);
    return { ok: true };
  }
  function doCommit(t) {
    if (mode === 'SSI') {
      const ins = [...t.in].filter(u => u.st !== 'aborted'), outs = [...t.out].filter(u => u.st !== 'aborted');
      if (ins.length && outs.length) { tags.add('ssi'); return { abort: `SSI: dangerous structure T${ins[0].id} -rw-> T${t.id} -rw-> T${outs[0].id} (pivot T${t.id})`, short: 'SSI abort\nrw-cycle' }; }
    }
    clock++; t.cts = clock;
    for (const k in t.w) { (vers[k] = vers[k] || []).push({ val: t.w[k], ts: clock }); }
    t.st = 'committed'; releaseAll(t); return { ok: true };
  }
  const txt = o => o.o === 'W' ? `W(${o.k})` : o.o === 'R' ? `R(${o.k})` : o.o === 'RP' ? `R(${o.k}*)` : o.o === 'INS' ? `INS(${o.k})` : o.o === 'C' ? 'COMMIT' : 'ABORT';
  function exec(op, t) {
    if (t.snap == null) t.snap = clock;
    let r;
    switch (op.o) {
      case 'R': r = doRead(t, op.k); if (r.block) return r; t.vars[op.as] = r.val; push(op.t, 'read', `R(${op.k})\n=${r.val}`); return r;
      case 'RP': r = doRP(t, op.k); if (r.block) return r; t.vars[op.as] = r.val; push(op.t, 'read', `R(${op.k}*)\ncount=${r.val}`); return r;
      case 'W': case 'INS': { const val = op.f(t.vars); r = doWrite(t, op.k, val); if (r.block) return r; if (r.abort) { abortTx(t, `T${t.id}: ${r.abort}`); push(op.t, 'abort', r.short); return r; } push(op.t, 'write', `${op.o === 'W' ? 'W' : 'INS'}(${op.k})\n=${val}`); return r; }
      case 'C': r = doCommit(t); if (r.abort) { abortTx(t, `T${t.id}: ${r.abort}`); push(op.t, 'abort', r.short); } else push(op.t, 'commit', 'COMMIT'); return r;
      case 'A': abortTx(t); push(op.t, 'abort', 'ROLLBACK'); return { ok: true };
    }
  }
  let pend = A.ops.map(o => ({ ...o, logged: false })), guard = 0;
  while (pend.length && guard++ < 400) {
    let progressed = false; const blocked = new Set();
    for (let i = 0; i < pend.length; i++) {
      const op = pend[i], t = T[op.t];
      if (t.st !== 'active') { pend.splice(i, 1); progressed = true; break; }
      if (blocked.has(op.t)) continue;
      const r = exec(op, t);
      if (r.block) { blocked.add(op.t); if (!op.logged) { op.logged = true; blockCount++; tags.add('lock'); push(op.t, 'block', `${txt(op)}\nwaits T${r.block.map(u => u.id).join(',T')}`); } continue; }
      pend.splice(i, 1); progressed = true; break;
    }
    if (!progressed) {
      const ids = [...new Set(pend.map(o => o.t))].filter(id => T[id].st === 'active'); const v = Math.max(...ids);
      tags.add('deadlock'); abortTx(T[v], `T${v}: deadlock (wait-for cycle between ${ids.map(i => 'T' + i).join(', ')}) - youngest aborted`); push(v, 'abort', 'DEADLOCK\nvictim');
    }
  }
  const final = {}; for (const k in vers) { const l = latest(k); if (l) final[k] = l.val; }
  const st = {}, vars = {}; for (const id in T) { st[id] = T[id].st; vars[id] = T[id].vars; }
  return { log, tags, msgs, blockCount, abortCount, final, st, vars, occurs: !!A.occurs({ vars, st, final }), nT: Object.keys(T).length };
}
const NO_PROTECT = {
  RU: 'READ UNCOMMITTED: no read locks, reads the newest version even if its writer is uncommitted - nothing orders this conflict.',
  RC: 'READ COMMITTED: reads only committed data, but takes a fresh view per statement and holds no read locks, so other commits slip in between statements.',
  RR: 'Row read locks protect rows that EXIST; a newly inserted row has no lock to conflict with. No predicate/gap lock => phantom.',
  SI: 'Snapshot isolation only detects WRITE-WRITE conflicts (first-committer-wins). These txns wrote different rows, so the rw-dependency cycle goes unnoticed.',
  SER: 'unexpected',
};
function mechanism(res, lvl, ser) {
  const t = res.tags, m = res.msgs.join(' | ');
  if (t.has('ssi')) return `SSI tracks rw-antidependencies (read of a version someone else overwrote). ${m}`;
  if (t.has('fcw')) return `${m}. The loser aborts and retries on a fresh snapshot.`;
  if (t.has('deadlock')) return `Locks held to commit (2PL) turn the conflict into a wait cycle; ${m}.`;
  if (t.has('predlock')) return 'Predicate/gap lock on the scanned range blocks the conflicting insert until the reader commits (SERIALIZABLE 2PL).';
  if (t.has('lock')) return 'Strict 2PL: S/X locks are held to commit, so the conflicting op WAITS (see yellow box) until the holder finishes.';
  if (t.has('snapshot')) return 'MVCC snapshot: every read returns the version valid at the snapshot ts, so concurrent commits are invisible.';
  if (t.has('commitonly')) return 'Readers only see COMMITTED versions: the uncommitted write exists but is invisible to this read.';
  return 'No conflicting interleaving materialised for this level.';
}
let I_iso = null;
function buildIso(ctx) {
  const { kit, dyn } = base(ctx);
  let an = 'skew', lvl = CFG2LV[cfgv(ctx, 'isolation-default', 'snapshot')] || 'SI', ser = 'ssi';
  let res = null, shown = 0, t0 = 0, matrix = null; const lvlOf = {};
  const KC = { read: 0x2d4a7a, write: 0x5a3f7a, commit: 0x2f6a3a, abort: 0x8a2f3f, block: 0x8a6a1a, note: 0x333 };
  const head = kit.label('', 0, 6.0, 0, { size: 0.48 });
  const desc = kit.label('', 0, 5.2, 0, { size: 0.32, color: C.dim });
  const verdict = kit.label('', 0, 0.8, 0, { size: 0.42 });
  const mech = kit.label('', 0, -0.1, 0, { size: 0.32, color: C.text });
  const opt = kit.label('', 0, -0.9, 0, { size: 0.28, color: C.dim });
  let tbl = null;
  function drawMatrix() {
    matrix = AN_ORDER.map(a => LV.map(l => simulate(a, l, ser).occurs));
    const rows = [['anomaly \\ level', 'RU', 'RC', 'RR(2PL)', 'SNAPSHOT', 'SERIAL.']];
    AN_ORDER.forEach((a, i) => rows.push([SHORT[a], ...LV.map((l, j) => (matrix[i][j] ? 'occurs' : 'prevented') + (a === an && l === lvl ? ' <' : ''))]));
    if (tbl) { kit.group.remove(tbl); }
    tbl = tablePlane(kit, rows, { cellW: 160, cellH: 34, font: 18, scale: 0.0195, headCol: true, color: (r, c) => { if (r === 0 || c === 0) return null; const a = AN_ORDER[r - 1], l = LV[c - 1]; const cur = a === an && l === lvl; return matrix[r - 1][c - 1] ? (cur ? '#ff9aa8' : '#b4616f') : (cur ? '#c3f08a' : '#6f9a5c'); } });
    tbl.position.set(0, -3.8, 0); kit.group.add(tbl);
  }
  function lanes() {
    clearGroup(dyn);
    const n = res.nT, yOf = i => 4.1 - i * 1.0, colW = 1.55, x0 = -8.2;
    for (let i = 0; i < n; i++) { dLabel(ctx, dyn, `T${i + 1}`, -9.6, yOf(i), 0, { size: 0.42, color: H([C.blue, C.orange, C.purple][i]) }); dBox(dyn, 19, 0.02, 0.02, 0x333a5a, 0, yOf(i) - 0.45, -0.1); }
    res.log.slice(0, shown).forEach((e, ci) => { const x = x0 + ci * colW + 0.8, y = yOf(e.t - 1); dBox(dyn, colW - 0.1, 0.85, 0.2, KC[e.kind] ?? 0x333333, x, y, 0); dLabel(ctx, dyn, e.text, x, y, 0.15, { size: 0.28 }); });
  }
  function run() {
    res = simulate(an, lvl, ser); shown = 0; t0 = 0;
    kit.setLabel(head, `${ANOMS[an].name}  @  ${LV_NAME[lvl]}${lvl === 'SER' ? (ser === 'ssi' ? ' (SSI)' : ' (2PL+predicate locks)') : ''}`, { size: 0.48, color: H(C.yellow) });
    kit.setLabel(desc, AN_DESC[an].replace(/(.{85,}?) /, '$1\n'), { size: 0.3, color: C.dim });
    kit.setLabel(verdict, res.occurs ? 'ANOMALY OCCURS' : 'ANOMALY PREVENTED', { size: 0.42, color: res.occurs ? H(C.red) : H(C.green) });
    const why = res.occurs ? NO_PROTECT[lvl] : mechanism(res, lvl, ser);
    kit.setLabel(mech, why.length > 105 ? why.replace(/(.{70,}?)\s/g, '$1\n') : why, { size: 0.3, color: C.text });
    kit.setLabel(opt, `pessimistic (locks): ${res.blockCount} waits, ${res.tags.has('deadlock') ? 1 : 0} deadlock abort   |   optimistic (snapshot/SSI): ${(res.tags.has('fcw') || res.tags.has('ssi')) ? 'conflict -> ABORT at write/commit, no waiting' : 'no validation abort here'}   |   final=${JSON.stringify(res.final)}`, { size: 0.28, color: C.dim });
    drawMatrix(); lanes();
    ctx.onInfo(`<b>${ANOMS[an].name} @ ${LV_NAME[lvl]}</b><br>${AN_DESC[an]}<br><br><b>${res.occurs ? 'Occurs.' : 'Prevented.'}</b> ${why}<br><br>` +
      `<b>Mechanisms:</b> RU/RC = no read protection (RC: committed-only reads); RR = read locks held to commit (2PL), phantoms because no predicate lock; SNAPSHOT = MVCC reads + first-committer-wins on write-write; SERIALIZABLE = predicate locks (2PL) or SSI aborting on rw-antidependency dangerous structures (T1 -rw-> T2 -rw-> T3).<br>` +
      `<i>Note: PostgreSQL REPEATABLE READ and InnoDB's default behave like snapshot variants; the RR column here is the textbook lock-based level.</i>`);
  }
  run();
  const inst = {
    group: kit.group,
    update(dt) { kit.tick(dt); t0 += dt; const n = Math.min(res.log.length, Math.floor(t0 / 0.55) + 1); if (n !== shown) { shown = n; lanes(); } },
    dispose() { clearGroup(dyn); kit.dispose(); I_iso = null; },
    onConfigChange(c) { const l = CFG2LV[c['isolation-default']]; if (l && l !== lvl) { lvl = l; run(); } },
    set(a, l, s) { if (a) an = a; if (l) lvl = l; if (s) ser = s; run(); },
    steps: [
      ['dirty', 'RU', 'Dirty read @ READ UNCOMMITTED', 'T2 reads T1\'s uncommitted x=200; T1 then rolls back. T2 acted on data that never existed.'],
      ['dirty', 'RC', 'Same schedule @ READ COMMITTED', 'The read only returns committed versions, so T2 sees 100. Prevented by visibility (or a short S lock in lock-based engines).'],
      ['nr', 'RC', 'Non-repeatable read @ READ COMMITTED', 'Each statement re-reads the newest committed row, so T1 sees x=1 then x=2.'],
      ['nr', 'RR', 'Same schedule @ REPEATABLE READ', 'T1 keeps its S lock on x until commit, so T2\'s write waits (yellow). With snapshot reads the same guarantee comes from the old version, with no waiting.'],
      ['phantom', 'RR', 'Phantom @ REPEATABLE READ', 'Row locks cover existing rows only. The inserted row a3 matches the predicate but had no lock to conflict with.'],
      ['lost', 'RC', 'Lost update @ READ COMMITTED', 'Read-modify-write on stale reads: T2 overwrites T1\'s +10. Fixes: SELECT FOR UPDATE, atomic UPDATE c=c+n, snapshot FCW.'],
      ['lost', 'SI', 'Lost update @ SNAPSHOT', 'First-committer-wins: T2\'s write sees a version committed after its snapshot and aborts.'],
      ['skew', 'SI', 'Write skew @ SNAPSHOT', 'T1 and T2 write different rows, so FCW sees no conflict; both snapshots said "2 on call". Invariant broken.'],
      ['skew', 'SER', 'Write skew @ SERIALIZABLE', 'SSI sees T1 -rw-> T2 and T2 -rw-> T1 (each read what the other wrote): a cycle, so one aborts. 2PL variant: deadlock instead.'],
      ['ro', 'SI', 'Read-only anomaly @ SNAPSHOT', 'Even a read-only T3 can observe a state no serial order explains (y=20 committed but T2 still based its fee on y=0).'],
    ].map(([a, l, title, text]) => ({ title, text, run() { inst.set(a, l); } })),
  };
  I_iso = inst; return inst;
}

/* =====================================================================================
   DEADLOCK DETECTOR
   ===================================================================================== */
const DL_MODES = [
  { value: 'wait-for-graph', label: 'wait-for graph + cycle detection' },
  { value: 'timeout', label: 'lock timeout' },
  { value: 'wait-die-wound-wait', label: 'wait-die / wound-wait (timestamps)' },
  { value: 'ordered-acquire', label: 'ordered acquisition (prevention)' },
];
function simDeadlock(mode, ww, pol) {
  const ids = [1, 2, 3, 4], RES = ['A', 'B', 'C', 'D'], TIMEOUT = 8;
  const needs = { 1: ['A', 'B'], 2: ['B', 'C'], 3: ['C', 'A'], 4: ['D', 'A'] };
  if (mode === 'ordered-acquire') ids.forEach(i => needs[i].sort());
  const holder = {}, queue = {}; RES.forEach(r => { holder[r] = null; queue[r] = []; });
  const stt = {}, pc = {}, ws = {}; ids.forEach(i => { stt[i] = 'running'; pc[i] = 0; });
  let clk = 0; const frames = [];
  const held = i => RES.filter(r => holder[r] === i);
  const edges = () => { const e = []; RES.forEach(r => queue[r].forEach(w => { if (holder[r] != null) e.push([w, holder[r]]); })); return e; };
  const snap = (note, x = {}) => frames.push({ note, holder: { ...holder }, queue: Object.fromEntries(RES.map(r => [r, [...queue[r]]])), st: { ...stt }, edges: edges(), timers: Object.fromEntries(ids.filter(i => stt[i] === 'waiting').map(i => [i, (clk - ws[i]) / TIMEOUT])), ...x });
  function grantNext(r) { if (holder[r] == null && queue[r].length) { const w = queue[r].shift(); holder[r] = w; pc[w]++; stt[w] = 'running'; } }
  function abortTx(v, why) { RES.forEach(r => { queue[r] = queue[r].filter(x => x !== v); }); const hs = held(v); stt[v] = 'aborted'; hs.forEach(r => { holder[r] = null; }); hs.forEach(grantNext); }
  function request(id, res) {
    clk++;
    if (holder[res] == null) { holder[res] = id; pc[id]++; snap(`T${id} X-locks ${res}`); return; }
    const h = holder[res];
    if (mode === 'wait-die-wound-wait') {
      const older = id < h;
      if (ww === 'wait-die') {
        if (older) { queue[res].push(id); stt[id] = 'waiting'; ws[id] = clk; snap(`wait-die: T${id}(ts${id}) is OLDER than holder T${h} -> allowed to WAIT for ${res}`); }
        else { abortTx(id); snap(`wait-die: T${id}(ts${id}) is YOUNGER than holder T${h} -> DIES (aborts, restarts with same ts)`, { victim: id }); }
      } else if (older) { abortTx(h); snap(`wound-wait: T${id}(ts${id}) OLDER than holder T${h} -> WOUNDS it (T${h} aborted, locks released)`, { victim: h }); request(id, res); }
      else { queue[res].push(id); stt[id] = 'waiting'; ws[id] = clk; snap(`wound-wait: T${id}(ts${id}) younger than holder T${h} -> WAITS for ${res}`); }
      return;
    }
    queue[res].push(id); stt[id] = 'waiting'; ws[id] = clk; snap(`T${id} requests ${res} held by T${h} -> WAITS (queue ${res}: ${queue[res].map(x => 'T' + x).join(',')})`);
  }
  snap(mode === 'ordered-acquire' ? 'Each txn declares its locks and acquires them in global order A<B<C<D' : 'T1..T4 start; each acquires its first lock, then its second');
  let guard = 0;
  while (guard++ < 120) {
    const running = ids.filter(i => stt[i] === 'running');
    if (running.length) {
      for (const id of running) {
        if (stt[id] !== 'running') continue;
        if (pc[id] >= needs[id].length) { clk++; held(id).forEach(r => { holder[r] = null; }); const hs = RES.slice(); stt[id] = 'committed'; hs.forEach(grantNext); snap(`T${id} commits, releases all locks (strict 2PL), waiters granted`); }
        else request(id, needs[id][pc[id]]);
      }
      continue;
    }
    const waiting = ids.filter(i => stt[i] === 'waiting'); if (!waiting.length) break;
    if (mode === 'wait-for-graph') {
      const adj = {}; edges().forEach(([a, b]) => { (adj[a] = adj[a] || []).push(b); });
      let cycle = null; const visited = new Set();
      snap('Detector wakes up: build wait-for graph from lock queues (waiter -> holder), run DFS for a cycle');
      const dfs = (n, path) => {
        path.push(n); visited.add(n);
        snap(`DFS visit T${n}; path = ${path.map(x => 'T' + x).join(' -> ')}`, { dfs: [...path] });
        for (const m of adj[n] || []) {
          if (cycle) return;
          if (path.includes(m)) { cycle = path.slice(path.indexOf(m)); snap(`back-edge T${n} -> T${m}: CYCLE ${cycle.map(x => 'T' + x).join(' -> ')} -> T${m}`, { dfs: [...path], cycle: [...cycle] }); return; }
          if (!visited.has(m)) dfs(m, path);
        }
        if (!cycle) path.pop();
      };
      for (const n of ids) if (!cycle && !visited.has(n) && adj[n]) dfs(n, []);
      if (!cycle) break;
      const cost = i => held(i).length;
      const v = pol === 'fewest-locks' ? cycle.slice().sort((a, b) => cost(a) - cost(b) || b - a)[0] : Math.max(...cycle);
      snap(`Victim policy "${pol === 'fewest-locks' ? 'fewest locks held (least work lost)' : 'youngest txn'}" -> abort T${v}`, { cycle: [...cycle], victim: v });
      abortTx(v); snap(`T${v} rolled back; its locks released, queue heads granted -> cycle broken`, { victim: v });
    } else if (mode === 'timeout') {
      clk++; snap(`all txns blocked; timers advance (lock timeout = ${TIMEOUT} ticks)`);
      const exp = waiting.filter(i => clk - ws[i] >= TIMEOUT).sort((a, b) => ws[a] - ws[b])[0];
      if (exp != null) { abortTx(exp); snap(`T${exp} timed out after ${TIMEOUT} ticks -> aborted. (Timeout cannot tell a deadlock from a slow holder: T4 would be killed too if its timer expired first)`, { victim: exp }); }
    } else { snap('stuck (unexpected)'); break; }
  }
  snap(mode === 'ordered-acquire' ? 'Done: no cycle was possible - waits only point toward higher-ordered resources' : 'All remaining txns finished' + (ids.some(i => stt[i] === 'aborted') ? ' (aborted txns would retry)' : ''));
  return frames;
}
let I_dl = null;
function buildDl(ctx) {
  const { kit, dyn } = base(ctx);
  let mode = cfgv(ctx, 'deadlock-handling', 'wait-for-graph'), ww = 'wait-die', pol = 'youngest';
  let frames = [], fi = 0, playing = true, tm = 0;
  const NP = { 1: [3.5, 3.4], 2: [9, 3.4], 3: [9, -1.6], 4: [3.5, -1.6] };
  const stCol = { running: C.blue, waiting: C.yellow, aborted: C.red, committed: C.green };
  const RES = ['A', 'B', 'C', 'D'], ry = i => 3.9 - i * 2.2;
  kit.label('LOCK TABLE  (hash on resource id -> queue)', -5.2, 6.0, 0, { size: 0.34, color: C.dim });
  kit.label('WAIT-FOR GRAPH  (waiter -> holder)', 6.2, 6.0, 0, { size: 0.34, color: C.dim });
  const noteL = kit.label('', 0, -5.2, 0, { size: 0.36 });
  const ruleL = kit.label('', 0, -6.3, 0, { size: 0.3, color: C.dim });
  const stepL = kit.label('', 0, -7.0, 0, { size: 0.28, color: C.dim });
  function rule() {
    const r = { 'wait-for-graph': 'Detection: periodically build graph from queues, DFS for cycle, abort a victim (youngest / fewest locks). InnoDB runs it on every wait; PostgreSQL after deadlock_timeout=1s.', timeout: 'Timeout: abort any lock wait longer than T (MySQL innodb_lock_wait_timeout=50s). Cheap, no graph, but false positives and slow resolution.', 'wait-die-wound-wait': ww === 'wait-die' ? 'WAIT-DIE (non-preemptive): older requester waits; younger requester dies. Aborts are always younger txns; ts kept on restart so no starvation.' : 'WOUND-WAIT (preemptive): older requester wounds (aborts) younger holder; younger requester waits. Waits only point old->... never cycle.', 'ordered-acquire': 'Prevention: acquire locks in a global order (A<B<C<D). A wait-for cycle would need a txn holding a higher lock waiting for a lower one - impossible.' }[mode];
    kit.setLabel(ruleL, r.replace(/(.{95,}?)\s/g, '$1\n'), { size: 0.28, color: C.dim });
  }
  function show() {
    clearGroup(dyn); const f = frames[fi]; if (!f) return;
    RES.forEach((r, i) => {
      const y = ry(i); dBox(dyn, 1.5, 1.4, 0.15, 0x2a3552, -9.2, y, 0); dLabel(ctx, dyn, r, -9.2, y, 0.2, { size: 0.55 });
      dBox(dyn, 17.5 - 12, 0.02, 0.02, 0x333a5a, -4.8, y - 0.9, -0.1);
      const h = f.holder[r]; dBox(dyn, 1.7, 1.2, 0.15, h ? C.green : 0x1c2036, -7.0, y, 0); dLabel(ctx, dyn, h ? `T${h}\nGRANTED X` : 'free', -7.0, y, 0.2, { size: 0.28, color: h ? '#0b0d14' : C.dim });
      f.queue[r].forEach((w, qi) => { dBox(dyn, 1.7, 1.2, 0.15, C.yellow, -4.9 + qi * 1.9, y, 0); dLabel(ctx, dyn, `T${w}\nWAIT X`, -4.9 + qi * 1.9, y, 0.2, { size: 0.28, color: '#0b0d14' }); });
    });
    // edges
    const cyc = f.cycle || [], inCyc = (a, b) => cyc.includes(a) && cyc.includes(b) && cyc.indexOf(b) === (cyc.indexOf(a) + 1) % cyc.length;
    f.edges.forEach(([a, b]) => {
      const A = NP[a], B = NP[b], d = [B[0] - A[0], B[1] - A[1]], L = Math.hypot(...d), u = [d[0] / L, d[1] / L];
      dArrow(dyn, [A[0] + u[0] * 1.0, A[1] + u[1] * 1.0, 0.1], [B[0] - u[0] * 1.0, B[1] - u[1] * 1.0, 0.1], inCyc(a, b) ? C.red : C.cyan, 0.07);
    });
    [1, 2, 3, 4].forEach(i => {
      const p = NP[i], s = f.st[i], onPath = f.dfs && f.dfs.includes(i);
      const n = dSphere(dyn, 0.9, onPath ? C.orange : stCol[s], p[0], p[1], 0);
      if (f.victim === i) { const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.07, 8, 32), new THREE.MeshBasicMaterial({ color: C.red })); ring.position.set(p[0], p[1], 0); dyn.add(ring); }
      dLabel(ctx, dyn, mode === 'wait-die-wound-wait' ? `T${i}\nts=${i}` : `T${i}`, p[0], p[1], 1.0, { size: 0.4, color: '#0b0d14' });
      dLabel(ctx, dyn, s, p[0] + (i === 1 || i === 4 ? -1.9 : 1.9), p[1] + 0.9, 0.2, { size: 0.26, color: H(stCol[s]) });
      if (mode === 'timeout' && f.timers[i] != null) { const fr = Math.min(1, f.timers[i]); dBox(dyn, 2.0, 0.22, 0.1, 0x222640, p[0], p[1] - 1.35, 0); dBox(dyn, Math.max(0.02, 2.0 * fr), 0.22, 0.12, fr > 0.7 ? C.red : C.yellow, p[0] - 1.0 + fr, p[1] - 1.35, 0.05); }
    });
    if (f.dfs) dLabel(ctx, dyn, `DFS stack: ${f.dfs.map(x => 'T' + x).join(' > ')}${f.cycle ? '   CYCLE!' : ''}`, 6.2, -3.9, 0, { size: 0.32, color: f.cycle ? H(C.red) : H(C.orange) });
    kit.setLabel(noteL, f.note.replace(/(.{85,}?)\s/g, '$1\n'), { size: 0.36, color: f.victim ? H(C.red) : C.text });
    kit.setLabel(stepL, `frame ${fi + 1}/${frames.length}${playing ? '' : ' (paused)'}`, { size: 0.28, color: C.dim });
    ctx.onInfo(`<b>Deadlock handling: ${DL_MODES.find(m => m.value === mode).label}</b><br>${f.note}<br><br>` +
      `Scenario: T1 holds A needs B, T2 holds B needs C, T3 holds C needs A, T4 holds D needs A. The wait-for graph (edges from queue entries to holders) has the cycle T1&rarr;T2&rarr;T3&rarr;T1; T4 merely waits on the cycle.<br><br>` +
      `<b>Detect:</b> graph + DFS (cost O(V+E), run periodically). <b>Timeout:</b> no graph but false positives. <b>Avoid:</b> wait-die/wound-wait use txn timestamps (from the timestamp oracle) to decide who waits, so cycles can never form. <b>Prevent:</b> ordered acquisition.`);
  }
  function resim() { frames = simDeadlock(mode, ww, pol); fi = 0; tm = 0; rule(); show(); }
  resim();
  const inst = {
    group: kit.group,
    update(dt) { kit.tick(dt); if (playing && fi < frames.length - 1) { tm += dt; if (tm >= 1.5) { tm = 0; fi++; show(); } } },
    dispose() { clearGroup(dyn); kit.dispose(); I_dl = null; },
    onConfigChange(c) { if (c['deadlock-handling'] && c['deadlock-handling'] !== mode) { mode = c['deadlock-handling']; resim(); } },
    setMode(v) { mode = v; resim(); }, setWw(v) { ww = v; resim(); }, setPol(v) { pol = v; resim(); },
    play(v) { playing = v; show(); }, stepOne() { playing = false; if (fi < frames.length - 1) fi++; show(); }, restart() { fi = 0; tm = 0; playing = true; show(); },
    jump(pred) { const i = frames.findIndex(pred); if (i >= 0) { fi = i; playing = false; show(); } },
    steps: [
      { title: 'Four txns, four locks', text: 'Each transaction takes its first X lock. The lock table maps resource -> holder + FIFO queue of waiters.', run() { inst.restart(); inst.play(false); } },
      { title: 'Waits form edges', text: 'T1 waits on B (held by T2), T2 on C (held by T3), T3 on A (held by T1). Each queue entry adds a waiter->holder edge to the wait-for graph; T4 hangs off the cycle.', run() { inst.jump(f => f.st[4] === 'waiting'); } },
      { title: 'Resolve (current policy)', text: 'Detector: DFS finds T1->T2->T3->T1 and aborts a victim. Timeout: the oldest wait expires. Wait-die/wound-wait: the cycle is never allowed to form. Ordered: no cycle possible. Change the policy with the selector.', run() { inst.jump(f => f.victim != null || f.cycle); } },
      { title: 'Run to the end', text: 'After the victim\'s locks are released the queue heads are granted and the survivors commit. The aborted txn restarts (keeping its original timestamp under wait-die/wound-wait to avoid starvation).', run() { inst.restart(); } },
    ],
  };
  I_dl = inst; return inst;
}

/* =====================================================================================
   exported views
   ===================================================================================== */
export const views = {
  mvcc: {
    build: buildMvcc,
    controls: [
      { id: 'mvcc-scheme', label: 'storage scheme', type: 'select', options: MV_SCHEMES, value: 'append-only', onChange: v => I_mvcc && I_mvcc.setScheme(v) },
      { id: 'mvcc-snap', label: 'reader snapshot ts S', type: 'range', min: 0, max: 40, value: 25, onChange: v => I_mvcc && I_mvcc.setS(v) },
      { id: 'mvcc-commit', label: 'T30 commits', type: 'button', onChange: () => I_mvcc && I_mvcc.commit() },
      { id: 'mvcc-vacuum', label: 'VACUUM / purge dead', type: 'button', onChange: () => I_mvcc && I_mvcc.vacuum() },
      { id: 'mvcc-reset', label: 'reset', type: 'button', onChange: () => I_mvcc && I_mvcc.reset() },
    ],
  },
  'timestamp-oracle': {
    build: buildTso,
    controls: [
      { id: 'tso-req', label: 'request timestamp', type: 'button', onChange: () => I_tso && I_tso.req() },
      { id: 'tso-batch', label: 'batching', type: 'toggle', value: true, onChange: v => I_tso && I_tso.setBatch(v) },
      { id: 'tso-rate', label: 'txn/s', type: 'range', min: 1, max: 20, value: 4, onChange: v => I_tso && I_tso.setRate(v) },
      { id: 'tso-crash', label: 'crash TSO leader', type: 'button', onChange: () => I_tso && I_tso.crash() },
    ],
  },
  'isolation-levels': {
    build: buildIso,
    controls: [
      { id: 'iso-level', label: 'isolation level', type: 'select', options: LV.map(l => ({ value: l, label: LV_NAME[l] })), value: 'SI', onChange: v => I_iso && I_iso.set(null, v) },
      { id: 'iso-anomaly', label: 'schedule', type: 'select', options: AN_ORDER.map(a => ({ value: a, label: ANOMS[a].name })), value: 'skew', onChange: v => I_iso && I_iso.set(v) },
      { id: 'iso-ser', label: 'SERIALIZABLE via', type: 'select', options: [{ value: 'ssi', label: 'SSI (rw-dependencies)' }, { value: '2pl', label: 'strict 2PL + predicate locks' }], value: 'ssi', onChange: v => I_iso && I_iso.set(null, null, v) },
      { id: 'iso-replay', label: 'replay', type: 'button', onChange: () => I_iso && I_iso.set() },
    ],
  },
  'deadlock-detector': {
    build: buildDl,
    controls: [
      { id: 'dl-mode', label: 'policy', type: 'select', options: DL_MODES, value: 'wait-for-graph', onChange: v => I_dl && I_dl.setMode(v) },
      { id: 'dl-ww', label: 'timestamp rule', type: 'select', options: [{ value: 'wait-die', label: 'wait-die' }, { value: 'wound-wait', label: 'wound-wait' }], value: 'wait-die', onChange: v => I_dl && I_dl.setWw(v) },
      { id: 'dl-victim', label: 'victim', type: 'select', options: [{ value: 'youngest', label: 'youngest txn' }, { value: 'fewest-locks', label: 'fewest locks held' }], value: 'youngest', onChange: v => I_dl && I_dl.setPol(v) },
      { id: 'dl-play', label: 'auto-play', type: 'toggle', value: true, onChange: v => I_dl && I_dl.play(v) },
      { id: 'dl-step', label: 'step frame', type: 'button', onChange: () => I_dl && I_dl.stepOne() },
      { id: 'dl-restart', label: 'restart', type: 'button', onChange: () => I_dl && I_dl.restart() },
    ],
  },
};
