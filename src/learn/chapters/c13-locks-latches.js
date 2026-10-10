import { h, btn, canvas, C } from '../kit.js';

const MODES = ['IS', 'IX', 'S', 'SIX', 'X'];
const COMPAT = { IS: { IS: 1, IX: 1, S: 1, SIX: 1, X: 0 }, IX: { IS: 1, IX: 1, S: 0, SIX: 0, X: 0 }, S: { IS: 1, IX: 0, S: 1, SIX: 0, X: 0 }, SIX: { IS: 1, IX: 0, S: 0, SIX: 0, X: 0 }, X: { IS: 0, IX: 0, S: 0, SIX: 0, X: 0 } };

function mountWfg(el) {
  const T = ['T1', 'T2', 'T3', 'T4']; let edges = []; let victim = null;
  const { cv, ctx, w, h: H } = canvas(720, 220); const out = h('div', { class: 'out' });
  const P = [[120, 50], [320, 50], [320, 170], [120, 170]].map(([x, y], i) => [x + 120 * (i % 2 ? 1 : 0), y]);
  const pos = { T1: [140, 60], T2: [380, 60], T3: [380, 170], T4: [140, 170] };
  function cycle() { const adj = {}; edges.forEach(([a, b]) => (adj[a] = adj[a] || []).push(b)); const st = {}; const stack = []; let found = null; const dfs = (u) => { st[u] = 1; stack.push(u); for (const v of adj[u] || []) { if (st[v] === 1) { found = stack.slice(stack.indexOf(v)); return true; } if (!st[v] && dfs(v)) return true; } st[u] = 2; stack.pop(); return false; }; for (const t of T) if (!st[t] && dfs(t)) break; return found; }
  function draw() {
    const cyc = cycle(); ctx.clearRect(0, 0, w, H); ctx.font = '13px monospace';
    edges.forEach(([a, b]) => { const [x1, y1] = pos[a], [x2, y2] = pos[b]; const inC = cyc && cyc.includes(a) && cyc.includes(b) && cyc[(cyc.indexOf(a) + 1) % cyc.length] === b; ctx.strokeStyle = inC ? C.bad : C.dim; ctx.lineWidth = inC ? 3 : 1.5; const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L; ctx.beginPath(); ctx.moveTo(x1 + ux * 24, y1 + uy * 24); ctx.lineTo(x2 - ux * 26, y2 - uy * 26); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x2 - ux * 24, y2 - uy * 24); ctx.lineTo(x2 - ux * 36 - uy * 6, y2 - uy * 36 + ux * 6); ctx.lineTo(x2 - ux * 36 + uy * 6, y2 - uy * 36 - ux * 6); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); ctx.lineWidth = 1; });
    T.forEach((t) => { const [x, y] = pos[t]; ctx.fillStyle = t === victim ? '#3a2330' : cyc && cyc.includes(t) ? '#3a2330' : '#1d2a52'; ctx.strokeStyle = t === victim ? C.bad : C.accent; ctx.beginPath(); ctx.arc(x, y, 22, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = C.fg; ctx.fillText(t, x - 9, y + 4); });
    out.innerHTML = (edges.length ? edges.map(([a, b]) => `${a} waits for ${b}`).join('   ') : 'no waits') + '\n' + (cyc ? `<b class="bad">DEADLOCK: cycle ${cyc.join(' -> ')} -> ${cyc[0]}</b>. Typical victim: youngest / fewest locks held / least work to undo.` : '<b class="good">no cycle: waits resolve when holders commit</b>');
  }
  const sa = h('select', { class: 'dbtn' }, T.map((t) => h('option', t))), sb = h('select', { class: 'dbtn' }, T.map((t) => h('option', t))); sb.selectedIndex = 1;
  el.append(h('div', { class: 'row' }, sa, h('span', { class: 'dim' }, 'waits for'), sb, btn('Add wait edge', () => { const a = sa.value, b = sb.value; if (a !== b && !edges.some((e) => e[0] === a && e[1] === b)) edges.push([a, b]); victim = null; draw(); }), btn('Abort victim', () => { const c = cycle(); if (c) { victim = c[c.length - 1]; edges = edges.filter((e) => e[0] !== victim && e[1] !== victim); } draw(); }), btn('Clear', () => { edges = []; victim = null; draw(); }), btn('Example deadlock', () => { edges = [['T1', 'T2'], ['T2', 'T3'], ['T3', 'T1']]; victim = null; draw(); })), cv, out); draw();
}

function mountMatrix(el) {
  const a = h('select', { class: 'dbtn' }, MODES.map((m) => h('option', m))), b = h('select', { class: 'dbtn' }, MODES.map((m) => h('option', m))); b.selectedIndex = 2;
  const out = h('div', { class: 'out' });
  function draw() {
    const rows = ['      ' + MODES.map((m) => m.padEnd(4)).join('')].concat(MODES.map((r) => r.padEnd(6) + MODES.map((c) => (COMPAT[r][c] ? '✓' : '✗').padEnd(4)).join('')));
    out.innerHTML = `held: ${a.value}  requested: ${b.value}  =>  <b class="${COMPAT[a.value][b.value] ? 'good' : 'bad'}">${COMPAT[a.value][b.value] ? 'GRANTED' : 'MUST WAIT'}</b>\n\nrows = held, columns = requested\n` + rows.join('\n') + '\n\nIS/IX on table = "I intend to S/X-lock some rows". S on a table is only compatible with IS (and S): it conflicts with writers below.';
  }
  [a, b].forEach((s) => s.addEventListener('change', draw)); el.append(h('div', { class: 'row' }, h('span', { class: 'dim' }, 'held'), a, h('span', { class: 'dim' }, 'requested'), b), out); draw();
}

export default {
  n: 13, title: 'Locks, latches, deadlocks', minutes: 16, cmu: 'CMU 15-445 L17 (2PL), L18-L19',
  components: ['lock-manager', 'latch', 'deadlock-detector'],
  goals: ['Distinguish locks (logical, transaction duration) from latches (physical, microseconds).', 'Use the multi-granularity compatibility matrix (IS/IX/S/SIX/X).', 'Detect a deadlock with a waits-for graph and compare detection with prevention schemes.'],
  body: `
<h2>Locks vs latches</h2>
<table><tr><th></th><th>Lock</th><th>Latch</th></tr>
<tr><td>Protects</td><td>logical objects: rows, key ranges, tables</td><td>physical data structures: buffer-pool page table, B+tree node, lock table</td></tr>
<tr><td>Held by</td><td>transaction, until commit (2PL)</td><td>thread, for a few instructions to microseconds</td></tr>
<tr><td>Modes</td><td>S, X, intent modes, many</td><td>read / write (shared / exclusive)</td></tr>
<tr><td>Deadlock</td><td>detected or prevented by the DBMS</td><td>avoided by ordering (the code must be correct)</td></tr>
<tr><td>Implementation</td><td>lock table: hash from object id to queue of granted/waiting requests</td><td>spinlock, mutex, rw-latch, optimistic version counter</td></tr></table>
<h2>Multi-granularity locking</h2>
<p>Locking a billion rows one by one is absurd, so locks form a hierarchy: database, table, page, row. To lock a row in X mode, take <b>IX</b> on the table, then X on the row. A scan that reads most of a table takes one <b>S</b> on the table instead. <b>SIX</b> = S on the table plus intent to X individual rows (scan and update a few). The matrix tells whether a new request is compatible with held locks:</p>
<div data-demo="1"></div>
<h3>Lock escalation</h3>
<p>When a transaction accumulates many row locks (SQL Server: ~5,000), the engine escalates to a table lock to save memory, at the cost of concurrency. PostgreSQL and Oracle store row locks in the tuple header (no memory table), so they never escalate. InnoDB stores row locks as bitmaps per page in the lock table.</p>
<h2>Deadlocks</h2>
<p>T1 holds A and waits for B; T2 holds B and waits for A. Options:</p>
<ul><li><b>Detection</b>: build the waits-for graph (nodes = txns, edge Ti to Tj if Ti waits for a lock Tj holds); a cycle means deadlock. Run periodically (PostgreSQL after <code>deadlock_timeout</code> = 1 s of waiting; InnoDB checks immediately) or on every wait. Pick a victim (youngest, least work, fewest locks), abort and retry.</li>
<li><b>Prevention</b> by timestamps: <b>wait-die</b> (older waits for younger; a younger requester aborts) and <b>wound-wait</b> (older requester aborts the younger holder). Both guarantee no cycles because waits only go one direction of age. Aborted txns restart with their <i>original</i> timestamp so they eventually become oldest.</li>
<li><b>Ordered acquisition</b>: acquire locks in a global order (Calvin sorts, application convention). No cycles by construction.</li>
<li><b>Timeouts</b>: simplest; used by distributed engines where a global graph is expensive (<code>innodb_lock_wait_timeout</code> = 50 s default as a backstop).</li></ul>
<div data-demo="0"></div>
<h2>Latching a B+tree</h2>
<p>Latch crabbing: take the child latch, then release the parent if the child is <b>safe</b> (insert: not full; delete: more than half full). Writers briefly hold X on the root, which is a scalability disaster; optimistic latching assumes leaf-only modification: read-latch down, X-latch only the leaf, restart pessimistically on a split. Modern designs (LeanStore, Umbra) use <b>optimistic lock coupling</b>: a version counter per node; readers read without writing any shared memory (no cache-line bouncing) and validate the version afterwards. Spinlocks burn CPU under contention; mutexes sleep (futex); reader-writer latches add fairness concerns.</p>
<div class="callout ripple"><div class="t">Hot spots</div><p>A monotonically increasing key (auto-increment id, timestamp) makes every insert hit the rightmost leaf: that single latch and page become the bottleneck. Fixes: hash-prefix or reverse keys, per-core insert partitioning, or an LSM.</p></div>`,
  demos: [{ title: 'Waits-for graph', caption: 'Add wait edges. When they form a cycle the detector highlights it and lets you abort a victim.', mount: mountWfg }, { title: 'Lock compatibility matrix', caption: 'Pick held and requested modes.', mount: mountMatrix }],
  tradeoffs: { head: ['Strategy', 'Pros', 'Cons'], rows: [['Detect (waits-for graph)', 'Aborts only when a real cycle exists', 'Graph maintenance, cost grows with waits'], ['Wait-die / wound-wait', 'No detection needed, no cycles', 'Unnecessary aborts, especially wound-wait'], ['Timeouts', 'Trivial, distributed-friendly', 'Slow to resolve, false positives'], ['Ordered locking', 'Zero deadlocks', 'Needs lock set up front']] },
  ripples: [{ to: 'Isolation', text: 'repeatable read/serializable need range or gap locks, which are what generate many MySQL deadlocks.' }, { to: 'Index design', text: 'B+tree latching protocol and optimistic coupling decide multi-core scalability.' }, { to: 'Scheduler', text: 'thread-per-core designs replace latches with message passing and one writer per shard.' }, { to: 'Application', text: 'deadlock victims return an error; retries are mandatory in robust code.' }],
  quiz: [{ q: 'T1 holds IX on a table. Which request by T2 is granted?', options: ['S on the table', 'IX on the table', 'X on the table'], answer: 1, why: 'IX is compatible with IS and IX only.' }, { q: 'Wait-die: older T1 requests a lock held by younger T2. What happens?', options: ['T1 aborts', 'T1 waits', 'T2 waits'], answer: 1, why: 'In wait-die the older transaction waits; the younger would die.' }, { q: 'Latches are held for…', options: ['until commit', 'a short critical section', 'until checkpoint'], answer: 1, why: 'They protect in-memory structures, not logical transaction state.' }],
  refs: [{ title: 'Gray et al., Granularity of Locks and Degrees of Consistency', url: 'https://dl.acm.org/doi/10.1145/1282480.1282481' }, { title: 'Leis et al., The ART of Practical Synchronization (DaMoN 2016)', url: 'https://db.in.tum.de/~leis/papers/artsync.pdf' }, { title: 'Graefe, A Survey of B-Tree Locking Techniques', url: 'https://dl.acm.org/doi/10.1145/1806907.1806908' }, { title: 'MySQL: InnoDB Locking', url: 'https://dev.mysql.com/doc/refman/8.0/en/innodb-locking.html' }, { title: 'CMU 15-445 schedule (Fall 2024)', url: 'https://15445.courses.cs.cmu.edu/fall2024/schedule.html' }],
};
