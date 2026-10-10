import { h, btn, C } from '../kit.js';

function mountMvcc(el) {
  // Versions of row x: each {val, begin, end (null=live), xid}
  const steps = [
    { t: 'Initial: row x=10 committed at ts=5. T1 begins with snapshot ts=10.', apply: (s) => { s.chain = [{ v: 10, b: 5, e: null, by: 'init' }]; s.t1 = { snap: 10 }; s.log = 'T1 snapshot=10'; } },
    { t: 'T2 begins (snapshot=10) and runs UPDATE x=20. A new version is created; the old one gets end=T2 (uncommitted).', apply: (s) => { s.chain[0].e = 'T2*'; s.chain.unshift({ v: 20, b: 'T2*', e: null, by: 'T2' }); s.log = 'T2 wrote v=20 (uncommitted, begin=T2*)'; } },
    { t: 'T1 reads x. Newest version was written by an uncommitted txn, so it is invisible; T1 follows the chain to v=10.', apply: (s) => { s.read1 = 10; s.log = 'T1 read x -> 10 (skipped uncommitted v=20)'; } },
    { t: 'T2 commits at ts=12. Its version becomes begin=12, old version end=12.', apply: (s) => { s.chain[0].b = 12; s.chain[1].e = 12; s.log = 'T2 committed @12'; } },
    { t: 'T1 (snapshot 10) reads x again. v=20 began at 12 > 10, so it is still invisible: repeatable read, no lock taken.', apply: (s) => { s.read1 = 10; s.log = 'T1 read x -> 10 again (12 > snapshot 10)'; } },
    { t: 'T3 begins at ts=13 and reads x: v=20 has begin=12 <= 13 < end=infinity, so it sees 20. Old v=10 is garbage once no snapshot < 12 remains.', apply: (s) => { s.log = 'T3 read x -> 20; GC may now reclaim v=10 after T1 ends'; } },
  ];
  let i = -1; const view = h('div', { class: 'out' }); const msg = h('div', { class: 'cap' }); let st = {};
  function render() {
    if (i < 0) { view.textContent = '(press Next)'; msg.textContent = ''; return; }
    st = {}; for (let k = 0; k <= i; k++) steps[k].apply(st);
    const vis = (v) => (typeof v.b === 'number' && v.b <= 10 && (v.e === null || (typeof v.e === 'number' ? v.e > 10 : true))) ? ' <-- visible to T1 (snapshot 10)' : '';
    view.innerHTML = 'version chain for row x (newest first):\n' + st.chain.map((v) => `  [ v=${v.v}  begin=${v.b}  end=${v.e === null ? '∞' : v.e}  ]${vis(v)}`).join('\n') + '\n\n' + st.log; msg.textContent = steps[i].t;
  }
  el.append(msg, view, h('div', { class: 'row' }, btn('Next ▶', () => { if (i < steps.length - 1) { i++; render(); } }), btn('Reset', () => { i = -1; render(); }))); render();
}

function mountCc(el) {
  const { sliderEl } = {}; const rangeIn = (label, min, max, val) => { const i = h('input', { type: 'range', min, max, value: val }); const o = h('span', { class: 'val' }, val); i.addEventListener('input', () => { o.textContent = i.value; run(); }); return { i, el: h('label', { class: 'ctl' }, h('span', { class: 'lbl' }, label), i, o) }; };
  const hot = rangeIn('hot-key contention %', 0, 100, 30), wr = rangeIn('write ratio %', 0, 100, 40), thr = rangeIn('concurrent txns', 2, 64, 16);
  const out = h('div', { class: 'out' });
  function run() {
    const p = hot.i.value / 100, w = wr.i.value / 100, T = +thr.i.value; const pc = p * (0.3 + 0.7 * w); // probability two txns conflict on a key
    const expectedWaiters = (T - 1) * pc;
    const tpl = 1 / (1 + expectedWaiters * 1.2); // 2PL: waits, blocked throughput
    const abortRate = Math.min(0.95, 1 - Math.pow(1 - pc, T - 1)); const tocc = (1 - abortRate) / (1 + 0.1 * (T > 8 ? 0.5 : 0)) + 0.05; // OCC: wasted work on abort
    const tmv = (1 - Math.min(0.9, p * w * (T - 1) * 0.35)) * 0.95 + 0.03; // MVCC: only write-write conflicts
    out.innerHTML = `relative throughput (1.0 = no contention)\n2PL     ${'█'.repeat(Math.round(tpl * 40)).padEnd(40)} ${tpl.toFixed(2)}   (readers block writers; deadlocks possible)\nOCC     ${'█'.repeat(Math.round(Math.min(1, tocc) * 40)).padEnd(40)} ${Math.min(1, tocc).toFixed(2)}   (abort+retry rate ${(abortRate * 100).toFixed(0)}% wasted work)\nMVCC    ${'█'.repeat(Math.round(tmv * 40)).padEnd(40)} ${tmv.toFixed(2)}   (only write-write conflicts; reads never block)\nToy analytic model for intuition only: low contention favours OCC/MVCC (no lock overhead); high write contention hurts OCC most because aborts waste whole transactions.`;
  }
  el.append(h('div', { class: 'row' }, hot.el, wr.el, thr.el), out); run();
}

export default {
  n: 11, title: 'Transactions, ACID, concurrency control', minutes: 20, cmu: 'CMU 15-445 L15-L18, 15-721 L2 (MVCC)',
  components: ['txn-manager', 'concurrency-control', 'mvcc', 'timestamp-oracle'],
  goals: ['State ACID precisely and which component provides each letter.', 'Explain serializability, conflict graphs, 2PL/strict 2PL, OCC and timestamp ordering.', 'Walk through MVCC version chains and snapshot visibility, and compare Postgres, InnoDB and time-travel storage.'],
  body: `
<h2>ACID</h2>
<ul><li><b>Atomicity</b>: all or nothing, via the undo log or never-visible new versions (WAL/rollback).</li>
<li><b>Consistency</b>: constraints hold after commit (the application plus constraint checking, not magic).</li>
<li><b>Isolation</b>: concurrent transactions behave as if serial (to a degree set by the isolation level).</li>
<li><b>Durability</b>: committed data survives crashes (WAL fsync, replication).</li></ul>
<h2>Serializability</h2>
<p>A schedule interleaves operations of several transactions. It is <b>conflict serializable</b> if swapping non-conflicting operations yields a serial order; equivalently its <b>precedence graph</b> (edge Ti to Tj if Ti has an operation conflicting with and before one of Tj, where conflict means same item, different txns, at least one write) is acyclic. Concurrency control protocols are ways to guarantee this without checking graphs explicitly.</p>
<h2>Pessimistic: two-phase locking</h2>
<p><b>2PL</b>: a transaction acquires all locks before releasing any (growing phase, then shrinking). This yields conflict serializability but allows cascading aborts. <b>Strong strict 2PL</b> holds all exclusive locks (and in practice all locks) until commit, giving recoverable schedules. Deadlocks are possible and must be detected or prevented (chapter 13). Used by SQL Server (default locking mode), DB2, InnoDB for writes, MySQL's SELECT FOR UPDATE.</p>
<h2>Optimistic: OCC</h2>
<p>Kung and Robinson (1981): three phases. <b>Read</b>: read and write into a private workspace; <b>validate</b>: at commit check that no concurrent committed transaction wrote what you read (backward validation); <b>write</b>: install writes. Cheap when conflicts are rare; under heavy contention many transactions run to completion and then abort. Silo, FaRM, and many in-memory engines use OCC variants.</p>
<h2>MVCC</h2>
<p>Keep multiple versions of each record, each tagged with the creating (and deleting) transaction timestamps. A reader picks the version visible at its snapshot timestamp, so <b>readers never block writers and writers never block readers</b>. Write-write conflicts are still handled with locks or first-committer-wins.</p>
<div data-demo="0"></div>
<h3>Where versions live</h3>
<table><tr><th>Scheme</th><th>How</th><th>Systems</th><th>Trade-off</th></tr>
<tr><td>Append-only (N2O/O2N)</td><td>new version is a new tuple in the same heap; xmin/xmax on every tuple; VACUUM reclaims dead tuples</td><td>PostgreSQL</td><td>Fast rollback, simple; table bloat, index maintenance, vacuum needed</td></tr>
<tr><td>Delta / undo log</td><td>latest version in place; older versions rebuilt from undo records via roll pointer</td><td>InnoDB, Oracle</td><td>Compact main table; old snapshots reconstruct by applying many undo records; purge thread</td></tr>
<tr><td>Time-travel table</td><td>old versions in a separate table</td><td>SQL Server (tempdb version store), Hekaton</td><td>Main table stays clean; extra join for old reads</td></tr></table>
<p>PostgreSQL visibility: a tuple is visible if <code>xmin</code> committed and is in the snapshot's past, and <code>xmax</code> is unset, aborted, or not yet visible. A snapshot is (xmin, xmax, in-progress list of xids).</p>
<h2>Timestamp ordering and oracles</h2>
<p>Each transaction gets a timestamp; operations that violate the order abort (basic T/O). Distributed systems need a timestamp source: a single <b>timestamp oracle</b> (Percolator, TiDB's PD service; one RPC per transaction, batched to 1M+/s) or clocks (Spanner TrueTime, CockroachDB HLC). The oracle is a latency/availability trade-off, covered in chapter 15.</p>
<h2>Serializable snapshot isolation and deterministic CC</h2>
<p><b>SSI</b> (Cahill; PostgreSQL's SERIALIZABLE) runs snapshot isolation and tracks read-write antidependencies; it aborts a transaction when it detects a dangerous structure (two consecutive rw edges). <b>Calvin</b> sequences all transactions into a global order first and executes deterministically on every replica, avoiding 2PC, at the price of needing read/write sets in advance.</p>
<div data-demo="1"></div>`,
  demos: [{ title: 'MVCC visibility stepper', caption: 'Two writers and readers over one row with snapshot timestamps.', mount: mountMvcc }, { title: '2PL vs OCC vs MVCC under contention', caption: 'Toy model: vary hot-key contention and write ratio.', mount: mountCc }],
  tradeoffs: { head: ['Protocol', 'Conflicts handled by', 'Strength', 'Weakness'], rows: [['2PL', 'Blocking', 'Serializable, simple semantics', 'Deadlocks, readers block writers'], ['OCC', 'Abort at validation', 'No locks during execution; great for low contention', 'Wasted work, starvation under contention'], ['MVCC + first-committer-wins', 'Versions + abort on ww conflict', 'Non-blocking reads', 'Write skew under SI; version GC'], ['SSI', 'Dependency tracking', 'Serializable with SI performance', 'False-positive aborts, bookkeeping'], ['Calvin', 'Deterministic ordering', 'No 2PC, replicas independent', 'Needs predeclared read/write sets, sequencing latency']] },
  ripples: [{ to: 'Storage', text: 'MVCC dictates tuple headers (xmin/xmax, 23 bytes in Postgres) or undo segments, and index entries must tolerate several versions.' }, { to: 'Garbage collection', text: 'old versions pile up while any long transaction holds an old snapshot (vacuum bloat, undo history list growth).' }, { to: 'Replication', text: 'deterministic CC lets replicas replay a command log instead of data changes.' }, { to: 'Distributed', text: 'a global timestamp oracle sets the floor for commit latency and availability.' }],
  quiz: [{ q: 'Which schedule property do you need for serializability testing?', options: ['Precedence graph is acyclic', 'All txns commit', 'No NULLs'], answer: 0, why: 'An acyclic conflict graph means an equivalent serial order exists.' }, { q: 'In PostgreSQL, where is the older row version stored after an UPDATE?', options: ['In an undo log', 'As another tuple in the same heap', 'In a separate time-travel table'], answer: 1, why: 'Append-only version storage; VACUUM removes dead tuples later.' }, { q: 'Why does a long-running transaction hurt an MVCC system?', options: ['It holds locks', 'It prevents garbage collection of versions newer than its snapshot', 'It blocks the WAL'], answer: 1, why: 'Versions it might still need cannot be pruned.' }],
  refs: [{ title: 'Wu et al., An Empirical Evaluation of In-Memory MVCC (VLDB 2017)', url: 'https://www.vldb.org/pvldb/vol10/p781-Wu.pdf' }, { title: 'Kung & Robinson, On Optimistic Methods for Concurrency Control', url: 'https://dl.acm.org/doi/10.1145/319566.319567' }, { title: 'Cahill et al., Serializable Isolation for Snapshot Databases', url: 'https://dl.acm.org/doi/10.1145/1620585.1620587' }, { title: 'PostgreSQL: Concurrency Control (MVCC)', url: 'https://www.postgresql.org/docs/current/mvcc.html' }, { title: 'Thomson et al., Calvin (SIGMOD 2012)', url: 'http://cs.yale.edu/homes/thomson/publications/calvin-sigmod12.pdf' }, { title: 'CMU 15-445 schedule (Fall 2024)', url: 'https://15445.courses.cs.cmu.edu/fall2024/schedule.html' }],
};
