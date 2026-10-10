import { h, slider, btn, canvas, C } from '../kit.js';

function mount(el) {
  const wS = slider({ label: 'workers', min: 2, max: 8, value: 4, onInput: draw });
  const skS = slider({ label: 'skew (slow data)', min: 0, max: 10, value: 6, fmt: (v) => v + '/10', onInput: draw });
  const reroll = btn('New data', () => { seed = (seed * 7 + 3) % 1000; draw(); });
  let seed = 11; const { cv, ctx, w, h: H } = canvas(720, 250); const out = h('div', { class: 'out' });
  function draw() {
    const W = wS.get(), sk = skS.get() / 10, M = 96; let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    // morsel costs: the first 25% of morsels hit hot/expensive data in proportion to skew
    const cost = Array.from({ length: M }, (_, i) => 1 + (i < M / 4 ? sk * 6 : 0) + rnd() * 0.5);
    // static: contiguous ranges
    const per = M / W; const staticT = Array.from({ length: W }, (_, k) => { let t = 0; for (let i = Math.floor(k * per); i < Math.floor((k + 1) * per); i++) t += cost[i]; return t; });
    // morsel: dispatcher hands next morsel to earliest-free worker
    const free = new Array(W).fill(0); const gantt = Array.from({ length: W }, () => []);
    cost.forEach((c, i) => { let k = 0; for (let j = 1; j < W; j++) if (free[j] < free[k]) k = j; gantt[k].push([free[k], free[k] + c, i]); free[k] += c; });
    const ms = Math.max(...free), ss = Math.max(...staticT), total = cost.reduce((a, b) => a + b, 0);
    ctx.clearRect(0, 0, w, H); ctx.font = '11px monospace'; const sc = 600 / Math.max(ms, ss);
    ctx.fillStyle = C.dim; ctx.fillText('static partitioning', 8, 12);
    staticT.forEach((t, k) => { const y = 18 + k * 12; ctx.fillStyle = C.bad; ctx.fillRect(90, y, t * sc, 9); });
    const oy = 28 + W * 12; ctx.fillStyle = C.dim; ctx.fillText('morsel-driven', 8, oy);
    gantt.forEach((g, k) => g.forEach(([a, b, i]) => { ctx.fillStyle = i % 2 ? C.good : '#6a9a45'; ctx.fillRect(90 + a * sc, oy + 6 + k * 12, Math.max(0.5, (b - a) * sc), 9); }));
    ctx.strokeStyle = C.warn; ctx.beginPath(); ctx.moveTo(90 + ss * sc, 14); ctx.lineTo(90 + ss * sc, oy + 6 + W * 12); ctx.stroke();
    out.innerHTML = `ideal (total/workers) = ${(total / W).toFixed(1)}   static finish = <b class="bad">${ss.toFixed(1)}</b> (${(ss / (total / W)).toFixed(2)}x ideal)   morsel finish = <b class="good">${ms.toFixed(1)}</b> (${(ms / (total / W)).toFixed(2)}x ideal)\nStatic ranges leave workers idle waiting for the slowest one. With ~100K-tuple morsels pulled from a shared dispatcher, the tail is at most one morsel.`;
  }
  el.append(h('div', { class: 'row' }, wS.el, skS.el, reroll), cv, out); draw();
}

export default {
  n: 6, title: 'Scheduling & parallelism', minutes: 14, cmu: 'CMU 15-445 L14, 15-721 L4 (Parallel execution)',
  components: ['scheduler', 'parallelism', 'exchange-shuffle'],
  goals: ['Distinguish inter-query, intra-query (inter-operator, intra-operator) parallelism.', 'Explain morsel-driven scheduling and why it handles skew and NUMA better than exchange-based plans.', 'Compare thread-per-connection, thread pool, and thread-per-core (shared-nothing per core).'],
  body: `
<h2>Kinds of parallelism</h2>
<ul><li><b>Inter-query</b>: different queries on different threads. The OLTP default; needs concurrency control and latches.</li>
<li><b>Intra-query, inter-operator (pipeline)</b>: different operators run concurrently, passing data (producer/consumer).</li>
<li><b>Intra-operator (data parallel)</b>: split one operator's input into partitions and run the same operator on each. Parallel scan, partitioned hash join, parallel aggregation (local then global merge).</li></ul>
<h2>Exchange-based vs morsel-driven</h2>
<p>The classic Volcano <b>exchange operator</b> inserts parallelism into a plan statically: the optimizer fixes a degree of parallelism and partitions data up front. If one partition is bigger or its thread gets descheduled, the query waits on the straggler.</p>
<p><b>Morsel-driven parallelism</b> (Leis et al., SIGMOD 2014, HyPer) keeps a fixed pool of worker threads, one per hardware thread. Input is cut into <b>morsels</b> of about 100,000 tuples. A dispatcher hands a free worker the next morsel of the currently running pipeline, preferring morsels whose memory is on the worker's NUMA node. The degree of parallelism can change mid-query (when a higher priority query arrives), and skew is absorbed because fast workers simply take more morsels. DuckDB, Umbra, Velox-based engines and Snowflake-like systems use variants.</p>
<div data-demo="0"></div>
<h2>Thread models for connections</h2>
<table><tr><th>Model</th><th>How</th><th>Pros</th><th>Cons</th></tr>
<tr><td>Process/thread per connection</td><td>PostgreSQL process per connection; MySQL thread per connection</td><td>Simple isolation; blocking I/O is easy</td><td>10K connections = 10K stacks, context switches; needs a pooler (PgBouncer)</td></tr>
<tr><td>Thread pool</td><td>fixed workers service a request queue (MySQL thread pool plugin)</td><td>Bounded concurrency</td><td>Long queries starve short ones; blocking inside a worker wastes it</td></tr>
<tr><td>Morsel-driven pool</td><td>one worker per core, tasks = morsels</td><td>Elastic, skew-tolerant, NUMA aware</td><td>Needs cooperative operators and a task scheduler</td></tr>
<tr><td>Thread-per-core (shared-nothing)</td><td>ScyllaDB/Seastar, TigerBeetle single thread; each core owns a data shard</td><td>No locks or latches, predictable latency, cache locality</td><td>Cross-shard requests need message passing; hot shard bottleneck</td></tr></table>
<div class="callout ripple"><div class="t">Scheduling shapes everything else</div><p>Thread-per-core removes the need for latches on data structures (one writer per shard) but forces data partitioning and a routing layer inside the process; the same logic as sharding across machines, applied to cores.</p></div>
<h2>Interaction with I/O</h2>
<p>With async I/O (io_uring, Seastar) a core never blocks; it switches to another task while a read is in flight. With blocking buffer-pool reads a thread-pool engine needs many more threads than cores to hide I/O latency, which then raises context-switch overhead.</p>`,
  demos: [{ title: 'Static partitions vs morsels', caption: 'Make a quarter of the data expensive and compare finish times.', mount }],
  tradeoffs: { head: ['Design', 'Skew handling', 'Contention', 'Best for'], rows: [['Static partition / exchange', 'Poor', 'Low (private partitions)', 'Distributed shuffles, simple plans'], ['Morsel-driven work stealing', 'Excellent', 'Shared dispatcher, small', 'Single-node analytics, NUMA'], ['Thread-per-core', 'Hot shard problem', 'None inside a shard', 'Low-latency KV/OLTP (Scylla, TigerBeetle)'], ['Thread per connection', 'n/a', 'High (latches, context switches)', 'Moderate concurrency OLTP']] },
  ripples: [{ to: 'Latches / concurrency', text: 'more threads touching shared structures means more latch contention; thread-per-core removes it.' }, { to: 'Buffer pool', text: 'a shared buffer pool is a contention point; per-core caches or partitioned pools help.' }, { to: 'Operators', text: 'aggregation and joins need thread-local state merged at the end, shaping hash table design.' }, { to: 'Storage', text: 'parallel scans want data in many files or row groups so morsels map to independent units.' }],
  quiz: [{ q: 'Why does morsel-driven scheduling tolerate skew?', options: ['It sorts the data first', 'Workers pull small units on demand, so fast workers do more', 'It uses more threads than cores'], answer: 1, why: 'Dynamic assignment removes the straggler effect of static ranges.' }, { q: 'What is the main cost of thread-per-core designs?', options: ['More locks', 'Cross-shard work needs messaging and hot shards cannot be shared', 'Slower disks'], answer: 1, why: 'Each core owns its data, so cross-core access is explicit message passing.' }, { q: 'Intra-operator parallelism means…', options: ['Many queries at once', 'Splitting one operator across threads/partitions', 'Pipelining two operators'], answer: 1, why: 'Same operator, different data partitions.' }],
  refs: [{ title: 'Leis et al., Morsel-Driven Parallelism (SIGMOD 2014)', url: 'https://db.in.tum.de/~leis/papers/morsels.pdf' }, { title: 'Seastar shared-nothing design', url: 'https://seastar.io/shared-nothing/' }, { title: 'CMU 15-721 schedule', url: 'https://15721.courses.cs.cmu.edu/spring2024/schedule.html' }, { title: 'Graefe, Encapsulation of Parallelism in the Volcano System (1990)', url: 'https://dl.acm.org/doi/10.1145/93597.98720' }],
};
