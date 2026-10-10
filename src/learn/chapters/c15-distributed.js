import { h, btn, slider, canvas, C, toggle } from '../kit.js';

function mountRing(el) {
  const nodes = ['A', 'B', 'C']; const cols = { A: C.accent, B: C.good, C: C.warn, D: C.purple, E: C.orange, F: C.cyan, G: C.bad };
  const vS = slider({ label: 'virtual nodes per server', min: 1, max: 64, value: 8, onInput: draw });
  let cur = ['A', 'B', 'C']; const { cv, ctx, w, h: H } = canvas(720, 250); const out = h('div', { class: 'out' });
  const hash = (s) => { let a = 2166136261; for (let i = 0; i < s.length; i++) { a ^= s.charCodeAt(i); a = Math.imul(a, 16777619); } a ^= a >>> 13; a = Math.imul(a, 0x5bd1e995); a ^= a >>> 15; return (a >>> 0) / 4294967296; };
  const K = 3000; const keys = Array.from({ length: K }, (_, i) => hash('key' + i));
  const owner = (list, v, x) => { let best = null, bd = 2; for (const n of list) for (let i = 0; i < v; i++) { const p = hash(n + '#' + i); const d = (p - x + 1) % 1; if (d < bd) { bd = d; best = n; } } return best; }; // clockwise successor
  let prev = null;
  function draw(change) {
    const v = vS.get(); const now = keys.map((k) => owner(cur, v, k)); let moved = 0; if (prev && prev.length === now.length) now.forEach((o, i) => { if (o !== prev[i]) moved++; });
    const cnt = {}; cur.forEach((n) => (cnt[n] = 0)); now.forEach((o) => cnt[o]++);
    ctx.clearRect(0, 0, w, H); const cx = 130, cy = 125, R = 100; ctx.strokeStyle = C.line; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    cur.forEach((n) => { for (let i = 0; i < v; i++) { const a = hash(n + '#' + i) * 2 * Math.PI - Math.PI / 2; ctx.fillStyle = cols[n]; ctx.beginPath(); ctx.arc(cx + R * Math.cos(a), cy + R * Math.sin(a), 4, 0, 7); ctx.fill(); } });
    ctx.font = '12px monospace'; const mx = Math.max(...Object.values(cnt));
    cur.forEach((n, i) => { ctx.fillStyle = cols[n]; ctx.fillRect(300, 20 + i * 28, cnt[n] / mx * 180, 18); ctx.fillStyle = C.fg; ctx.fillText(`${n}: ${cnt[n]} keys (${(cnt[n] / K * 100).toFixed(1)}%)`, 306 + cnt[n] / mx * 180, 33 + i * 28 - 0); });
    const ideal = K / cur.length; const sd = Math.sqrt(cur.map((n) => (cnt[n] - ideal) ** 2).reduce((a, b) => a + b, 0) / cur.length);
    out.innerHTML = (prev && change ? `last change moved <b class="${moved / K < 1.5 / cur.length ? 'good' : 'bad'}">${moved}</b> of ${K} keys (${(moved / K * 100).toFixed(1)}%). Naive hash(key) mod N would move ~${((1 - 1 / Math.max(cur.length, 2)) * 100).toFixed(0)}%.\n` : '') + `load imbalance (std dev) = ${(sd / ideal * 100).toFixed(1)}% of ideal. More virtual nodes smooth the load.`;
    prev = now;
  }
  const names = 'ABCDEFG';
  const add = btn('Add server', () => { if (cur.length < 7) { prev = prev; cur.push(names[cur.length]); draw(true); } }), rem = btn('Remove server', () => { if (cur.length > 2) { cur.pop(); draw(true); } });
  vS.el.addEventListener('input', () => { prev = null; });
  el.append(h('div', { class: 'row' }, vS.el, add, rem), cv, out); draw();
}

function mountClock(el) {
  const P = ['P1', 'P2', 'P3']; const lam = [0, 0, 0]; const vec = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; const log = []; let useVec = false; let sel = 0;
  const out = h('div', { class: 'out' }); const info = h('div', { class: 'out' });
  function show() {
    out.innerHTML = P.map((p, i) => `${p}: Lamport=<b>${lam[i]}</b>   vector=[${vec[i].join(',')}]`).join('\n') + '\n\nlog:\n' + log.slice(-8).join('\n');
    // concurrency check on last two events
    const ev = events; if (ev.length >= 2) { const a = ev[ev.length - 2], b = ev[ev.length - 1]; const le = (x, y) => x.every((v, i) => v <= y[i]); const rel = le(a.v, b.v) && !le(b.v, a.v) ? 'happened-before' : le(b.v, a.v) && !le(a.v, b.v) ? 'happened-after' : 'CONCURRENT'; info.innerHTML = `last two events: Lamport ${a.l} vs ${b.l} (Lamport cannot tell concurrency)\nvector clocks say: <b class="${rel === 'CONCURRENT' ? 'warn' : 'good'}">${rel}</b>`; } else info.textContent = 'Create events: local step, or send a message between processes.';
  }
  const events = [];
  const local = (i) => { lam[i]++; vec[i][i]++; events.push({ l: lam[i], v: [...vec[i]] }); log.push(`${P[i]} local event  L=${lam[i]} V=[${vec[i]}]`); show(); };
  const send = (i, j) => { lam[i]++; vec[i][i]++; const ml = lam[i], mv = [...vec[i]]; log.push(`${P[i]} sends to ${P[j]} (L=${ml}, V=[${mv}])`); lam[j] = Math.max(lam[j], ml) + 1; vec[j] = vec[j].map((x, k) => Math.max(x, mv[k])); vec[j][j]++; events.push({ l: lam[j], v: [...vec[j]] }); log.push(`${P[j]} receives -> L=max(${ml},..)+1=${lam[j]} V=[${vec[j]}]`); show(); };
  const row1 = h('div', { class: 'row' }, ...P.map((p, i) => btn(`${p} local`, () => local(i)))); const row2 = h('div', { class: 'row' });
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== j) row2.append(btn(`${P[i]}→${P[j]}`, () => send(i, j)));
  el.append(row1, row2, out, info, btn('Reset', () => { lam.fill(0); vec.forEach((v) => v.fill(0)); log.length = 0; events.length = 0; show(); })); show();
}

function mount2pc(el) {
  const crashT = toggle({ label: 'coordinator crashes after PREPARE votes', value: false, onChange: reset }); const noVote = toggle({ label: 'participant P2 votes NO', value: false, onChange: reset });
  let i = 0; const msg = h('div', { class: 'cap' }); const { cv, ctx, w, h: H } = canvas(720, 170); const out = h('div', { class: 'out' });
  function script() {
    const s = [{ t: 'Coordinator logs BEGIN and sends PREPARE to P1, P2, P3.', st: ['prep', 'prep', 'prep'], co: 'sent PREPARE' }];
    s.push({ t: noVote.get() ? 'P1, P3 force-write PREPARED and vote YES. P2 votes NO (constraint violation) and aborts locally.' : 'Each participant force-writes a PREPARED record (locks held, outcome now outside its control) and votes YES.', st: ['yes', noVote.get() ? 'no' : 'yes', 'yes'], co: 'collecting votes' });
    if (noVote.get()) { s.push({ t: 'Any NO => coordinator decides ABORT, logs it, sends ABORT. P1 and P3 roll back and release locks.', st: ['abort', 'abort', 'abort'], co: 'ABORT logged' }); }
    else if (crashT.get()) { s.push({ t: 'Coordinator CRASHES before logging/sending its decision. P1-P3 are PREPARED: they cannot commit or abort alone and keep holding locks. This is 2PC blocking.', st: ['blocked', 'blocked', 'blocked'], co: 'CRASHED' }); s.push({ t: 'Recovery: when the coordinator restarts it reads its log; with no decision record it aborts and informs participants. Until then locks block other transactions (3PC/Paxos Commit remove this by replicating the coordinator).', st: ['abort', 'abort', 'abort'], co: 'recovered: ABORT' }); }
    else { s.push({ t: 'All YES: coordinator force-logs COMMIT (the commit point), sends COMMIT.', st: ['commit', 'commit', 'commit'], co: 'COMMIT logged' }); s.push({ t: 'Participants log COMMIT, release locks, ACK; coordinator logs END.', st: ['done', 'done', 'done'], co: 'END' }); }
    return s;
  }
  let steps = script();
  function reset() { i = 0; steps = script(); draw(); }
  function draw() {
    const s = steps[i]; msg.textContent = s.t; ctx.clearRect(0, 0, w, H); ctx.font = '12px monospace';
    ctx.fillStyle = s.co === 'CRASHED' ? '#3a2330' : '#1d2a52'; ctx.strokeStyle = s.co === 'CRASHED' ? C.bad : C.accent; ctx.fillRect(280, 10, 160, 40); ctx.strokeRect(280, 10, 160, 40); ctx.fillStyle = C.fg; ctx.fillText('Coordinator: ' + s.co, 286, 34);
    const col = { prep: C.warn, yes: C.good, no: C.bad, abort: C.bad, commit: C.good, done: C.dim, blocked: C.warn };
    s.st.forEach((st, k) => { const x = 60 + k * 240; ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(360, 50); ctx.lineTo(x + 60, 100); ctx.stroke(); ctx.fillStyle = '#171d2e'; ctx.strokeStyle = col[st]; ctx.fillRect(x, 100, 120, 44); ctx.strokeRect(x, 100, 120, 44); ctx.fillStyle = C.fg; ctx.fillText('P' + (k + 1) + ': ' + st, x + 10, 126); });
    out.textContent = `step ${i + 1}/${steps.length}`;
  }
  el.append(h('div', { class: 'row' }, crashT.el, noVote.el), msg, cv, out, h('div', { class: 'row' }, btn('Next ▶', () => { i = Math.min(steps.length - 1, i + 1); draw(); }), btn('Restart', reset))); draw();
}

export default {
  n: 15, title: 'Distributed: sharding, replication, consensus, commit, clocks', minutes: 26, cmu: 'CMU 15-445 L23-L25, 15-721 L21-L23',
  components: ['sharding', 'replication', 'consensus', 'distributed-commit', 'logical-clocks', 'router-coordinator'],
  goals: ['Choose a sharding scheme (hash, range, consistent hash, directory) and compute data movement.', 'Compare sync, semi-sync, async and quorum replication, and describe Raft at the level of terms, votes and the commit index.', 'Explain 2PC blocking and alternatives (3PC, Paxos Commit, Percolator, Calvin) and the role of Lamport, vector, hybrid and TrueTime clocks.'],
  body: `
<h2>Sharding (partitioning)</h2>
<ul><li><b>Hash</b>: <code>shard = hash(key) mod N</code>: uniform load, no range scans; changing N reshuffles ~all keys.</li>
<li><b>Range</b>: contiguous key ranges (Bigtable tablets, Spanner, CockroachDB ranges ~512 MB, HBase regions): good scans, hot-spot risk on monotonically increasing keys, splits and merges adapt dynamically.</li>
<li><b>Consistent hashing</b> (Dynamo, Cassandra): servers and keys placed on a ring; a key belongs to the next server clockwise, so adding a node moves only ~1/N keys. <b>Virtual nodes</b> (many tokens per server) even out load.</li>
<li><b>Directory / vindex</b>: a lookup table or function maps keys to shards (Vitess vindexes, e.g. hash vindex on user_id plus lookup vindexes for secondary keys), flexible but the directory must be highly available.</li></ul>
<div data-demo="0"></div>
<p>Cross-shard queries need a <b>router/coordinator</b> to scatter, gather and merge; cross-shard transactions need distributed commit. Secondary indexes are either local (scatter reads) or global (distributed writes).</p>
<h2>Replication</h2>
<table><tr><th>Mode</th><th>Commit waits for</th><th>On primary failure</th></tr>
<tr><td>Async</td><td>local fsync only</td><td>may lose recent commits; replica lag seconds</td></tr>
<tr><td>Semi-sync (MySQL)</td><td>at least one replica ACK of the log</td><td>no loss of acknowledged commits if that replica is promoted</td></tr>
<tr><td>Sync (all replicas)</td><td>every replica applies</td><td>no loss, but one slow node stalls writes</td></tr>
<tr><td>Quorum / consensus (Raft, Paxos)</td><td>majority (2 of 3) persisted</td><td>automatic leader election, no loss of committed entries</td></tr></table>
<p>What is shipped: <b>statement</b> (non-deterministic functions break it), <b>row-based binlog</b> (row images), or <b>physical WAL</b> (byte-identical replicas, same version required). Replication lag creates read-your-writes anomalies on replicas.</p>
<h2>Consensus: Raft</h2>
<p>Time is divided into <b>terms</b>. Nodes are follower, candidate or leader. A follower that hears no heartbeat for a randomized timeout (150-300 ms) becomes a candidate, increments its term, votes for itself and asks for votes; a majority wins (each node votes once per term; a candidate's log must be at least as up to date). The leader appends client commands to its log and sends AppendEntries; once a <b>majority</b> store an entry it is <b>committed</b> (commit index advances) and applied to the state machine. A new leader never overwrites committed entries because voters reject candidates with shorter logs. Multi-Paxos is equivalent in power: a stable leader skips the prepare phase and runs only accept rounds. Write latency is one network round trip to a majority; 3 nodes tolerate 1 failure, 5 tolerate 2.</p>
<h2>Distributed commit</h2>
<div data-demo="2"></div>
<ul><li><b>2PC</b>: prepare then commit; blocking if the coordinator fails after prepare. Cost: 2 round trips and 2 forced log writes per participant, locks held across the network.</li>
<li><b>3PC</b>: adds a pre-commit phase to avoid blocking under crash-stop, but is not safe under network partitions and is rarely used.</li>
<li><b>Paxos Commit / Spanner</b>: make the coordinator and each participant a Paxos/Raft group, so a "crashed" coordinator is just a leader change. CockroachDB and TiDB do likewise.</li>
<li><b>Percolator</b> (Google, TiDB): snapshot isolation over Bigtable. A global timestamp oracle gives start_ts and commit_ts; the first written key is the <b>primary lock</b> and the commit point; secondary keys get locks that any reader can resolve by checking the primary. No dedicated coordinator process.</li>
<li><b>Calvin / deterministic</b>: a sequencing layer fixes a global transaction order and every replica executes it deterministically; no 2PC. Needs read/write sets up front (FaunaDB).</li></ul>
<h2>Clocks and ordering</h2>
<div data-demo="1"></div>
<ul><li><b>Lamport clock</b>: counter incremented on each event, <code>max(local, received) + 1</code> on receive. If a happened-before b then L(a) &lt; L(b), not the converse.</li>
<li><b>Vector clock</b>: one counter per node; detects concurrency exactly (Dynamo-style conflict detection) but grows with node count.</li>
<li><b>Hybrid logical clock (HLC)</b>: (physical time, logical counter) stays close to wall time while preserving causality; used by CockroachDB, YugabyteDB, MongoDB.</li>
<li><b>TrueTime</b> (Spanner): GPS and atomic clocks yield an interval [earliest, latest] with ε around 1-7 ms. A transaction picks commit timestamp s = TT.now().latest and <b>commit-waits</b> until TT.after(s), guaranteeing external consistency (strict serializability).</li>
<li><b>Timestamp oracle</b>: one service issues monotonically increasing timestamps (TiDB PD, Percolator): simple, 1 RTT per transaction, a single point to replicate with Raft.</li></ul>
<div class="callout"><div class="t">CAP and PACELC</div><p>During a partition (P) you pick availability or consistency (CAP). PACELC adds: Else (no partition), you still trade Latency against Consistency. Sync replication and consensus pay latency for consistency; Dynamo-style quorums with tunable R/W let you choose per request.</p></div>`,
  demos: [{ title: 'Consistent-hash ring', caption: 'Add or remove a server and count how many of 3,000 keys move.', mount: mountRing }, { title: 'Lamport and vector clocks', caption: 'Create events and messages; vector clocks reveal concurrency that Lamport timestamps hide.', mount: mountClock }, { title: 'Two-phase commit step-through', caption: 'Toggle a NO vote or a coordinator crash.', mount: mount2pc }],
  tradeoffs: { head: ['Mechanism', 'Latency', 'Availability', 'Notes'], rows: [['2PC', '2 RTTs + forced logs', 'Blocks on coordinator failure', 'Simple; common with XA'], ['Paxos/Raft-backed 2PC', '2 RTTs + consensus', 'Survives minority failure', 'Spanner, CockroachDB'], ['Percolator', 'oracle RTT + 2 write phases', 'Oracle must be HA', 'Snapshot isolation'], ['Calvin', 'Sequencer epoch (~10 ms)', 'Deterministic replicas', 'No interactive transactions'], ['TrueTime commit-wait', '+ε (1-7 ms)', 'Needs atomic clocks/GPS', 'Strict serializability without a central oracle']] },
  ripples: [{ to: 'Concurrency control', text: 'distributed MVCC needs a timestamp source (oracle, HLC, TrueTime) and cross-shard validation.' }, { to: 'WAL', text: 'the WAL becomes the replicated log in Raft-based systems, merging recovery and replication.' }, { to: 'Optimizer', text: 'data placement decides which joins are co-located; shuffle cost joins the cost model.' }, { to: 'Schema design', text: 'the shard key shapes which transactions are single-shard and therefore fast.' }],
  quiz: [{ q: 'Adding one node to a 10-node consistent-hash ring moves about…', options: ['All keys', '1/11 of keys', 'No keys'], answer: 1, why: 'Only the new node\'s share is taken from neighbours.' }, { q: 'Why is 2PC blocking?', options: ['It uses locks', 'After voting YES a participant cannot decide alone if the coordinator disappears', 'It requires 3 nodes'], answer: 1, why: 'The participant is in the uncertain state until it learns the outcome.' }, { q: 'Lamport(a) < Lamport(b) means…', options: ['a happened before b', 'a happened before b, or they are concurrent', 'b is a reply to a'], answer: 1, why: 'Lamport clocks are consistent with causality but cannot prove it.' }],
  refs: [{ title: 'Ongaro & Ousterhout, In Search of an Understandable Consensus Algorithm (Raft)', url: 'https://raft.github.io/raft.pdf' }, { title: 'Lamport, Paxos Made Simple', url: 'https://lamport.azurewebsites.net/pubs/paxos-simple.pdf' }, { title: 'Lamport, Time, Clocks, and the Ordering of Events', url: 'https://lamport.azurewebsites.net/pubs/time-clocks.pdf' }, { title: 'Corbett et al., Spanner (OSDI 2012)', url: 'https://research.google/pubs/spanner-googles-globally-distributed-database-2/' }, { title: 'Peng & Dabek, Percolator (OSDI 2010)', url: 'https://research.google/pubs/large-scale-incremental-processing-using-distributed-transactions-and-notifications/' }, { title: 'Thomson et al., Calvin (SIGMOD 2012)', url: 'http://cs.yale.edu/homes/thomson/publications/calvin-sigmod12.pdf' }, { title: 'DeCandia et al., Dynamo (SOSP 2007)', url: 'https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf' }, { title: 'Kulkarni et al., Hybrid Logical Clocks', url: 'https://cse.buffalo.edu/tech-reports/2014-04.pdf' }],
};
