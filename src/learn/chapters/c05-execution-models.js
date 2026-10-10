import { h, slider, btn, canvas, C } from '../kit.js';

function mount(el) {
  const rowsS = slider({ label: 'rows', min: 4, max: 8, step: 0.5, value: 6, fmt: (v) => '10^' + v, onInput: draw });
  const bS = slider({ label: 'batch size', min: 1, max: 4096, step: 1, value: 1024, onInput: draw });
  const out = h('div', { class: 'out' }); const { cv, ctx, w, h: H } = canvas(720, 130);
  function draw() {
    const N = Math.pow(10, rowsS.get()), B = bS.get(); const ops = 4; // scan, filter, project, agg
    const callsV = N * ops; // volcano: one next() virtual call per operator per tuple
    const callsB = Math.ceil(N / B) * ops;
    const tV = callsV * (12 + 4) / 1e9, tB = (callsB * 12 + N * ops * 0.6) / 1e9; // ns: 12 call+branch overhead, 4 ns work per tuple vs 0.6 ns vectorized per op
    const tC = N * 1.2 / 1e9; // compiled pipeline fused loop ~1.2 ns/tuple
    ctx.clearRect(0, 0, w, H); ctx.font = '12px monospace';
    [['Volcano (tuple at a time)', tV, C.bad], ['Vectorized (batch ' + B + ')', tB, C.good], ['Compiled (fused loop)', tC, C.accent]].forEach(([l, t, c], i) => {
      const mx = Math.max(tV, tB, tC); const y = 12 + i * 38; ctx.fillStyle = C.dim; ctx.fillText(l, 6, y + 12); ctx.fillStyle = c; ctx.fillRect(210, y, Math.max(2, t / mx * 380), 18); ctx.fillStyle = C.fg; ctx.fillText(t < 1 ? (t * 1000).toFixed(1) + ' ms' : t.toFixed(2) + ' s', 210 + t / mx * 380 + 8, y + 13);
    });
    out.textContent = `plan: Scan -> Filter -> Project -> Sum.  next() calls: volcano ${callsV.toExponential(1)}, vectorized ${callsB.toExponential(1)} (${(callsV / callsB).toFixed(0)}x fewer).\nModel numbers are illustrative: ~12 ns per virtual call + branch mispredictions, ~0.6 ns per value in a tight SIMD-friendly loop. Try batch=1: vectorized degenerates into volcano.`;
  }
  el.append(h('div', { class: 'row' }, rowsS.el, bS.el), cv, out); draw();
}

function mountPipe(el) {
  const ops = ['Scan(orders)', 'Filter', 'Probe HT(customers)', 'Agg(build)', 'Sort', 'Output'];
  const breaker = [false, false, false, true, true, false]; // agg build and sort are breakers; HT build is another pipeline
  const state = ops.map((_, i) => breaker[i]);
  const out = h('div', { class: 'out' });
  const row = h('div', { class: 'row' });
  function draw() {
    row.replaceChildren(...ops.map((o, i) => h('button', { class: 'dbtn' + (state[i] ? ' on' : ''), onclick: () => { state[i] = !state[i]; draw(); } }, (state[i] ? '⛔ ' : '→ ') + o)));
    let pipes = [[]]; ops.forEach((o, i) => { pipes[pipes.length - 1].push(o); if (state[i] && i < ops.length - 1) pipes.push([]); });
    out.textContent = pipes.map((p, i) => `Pipeline ${i + 1}: ${p.join(' -> ')}`).join('\n') + `\n\nClick an operator to toggle "materializes everything before continuing" (pipeline breaker). Tuples inside a pipeline stay in CPU registers/L1 in a compiled engine; a breaker writes to a hash table, sort buffer or exchange buffer.`;
  }
  el.append(row, out); draw();
}

export default {
  n: 5, title: 'Execution models', minutes: 18, cmu: 'CMU 15-445 L12-L13, 15-721 L5-L8',
  components: ['executor', 'operators', 'pipeline-dag', 'codegen', 'adaptive-execution', 'exchange-shuffle'],
  goals: ['Compare volcano, materialization, vectorized and compiled execution by function calls, cache behaviour and memory use.', 'Define pipelines and pipeline breakers and map a plan onto them.', 'Explain push vs pull, codegen vs precompiled primitives, adaptive execution and shuffles.'],
  body: `
<h2>Volcano / iterator (pull, tuple at a time)</h2>
<p>Graefe's Volcano model gives each operator <code>open()</code>, <code>next()</code>, <code>close()</code>; the root repeatedly calls <code>next()</code> on its child, which calls its child, down to the scan. It is simple and composable, and pipelines naturally with tiny memory. But every tuple costs one virtual call per operator, bad branch prediction and poor instruction cache use: at ~10-20 ns of overhead per call, 100M tuples through 4 operators burn several seconds before any real work. Used by PostgreSQL, MySQL (historically), SQLite (a bytecode VM variant).</p>
<h2>Materialization and vectorization</h2>
<p><b>Materialization model</b>: each operator processes all input and returns all output at once (VoltDB, MonetDB's BAT algebra). Good for OLTP's tiny inputs; terrible when intermediates are huge. <b>Vectorized model</b> (MonetDB/X100, Vectorwise, DuckDB, ClickHouse): <code>next()</code> returns a batch of ~1,000-2,048 values per column. Overhead amortizes over the batch, loops are tight and SIMD-friendly, and a batch fits in L1/L2 cache. Selection vectors or bitmaps carry which rows survived a filter.</p>
<div data-demo="0"></div>
<h2>Compiled / data-centric (push)</h2>
<p>HyPer (Neumann, VLDB 2011) turns each <b>pipeline</b> into one fused loop via LLVM: <code>for t in orders: if t.x &gt; 5: probe(ht, t.k) ...</code>. Data stays in registers, with no per-tuple calls. It is <b>push-based</b>: the scan pushes tuples to consumers (<code>produce/consume</code>), so control flow lives in the loop, not in iterator state. Cost: compile time (tens to hundreds of ms for LLVM, which hurts short queries), harder debugging. Umbra answers with its own IR and adaptive compilation (interpret first, switch to machine code if the query runs long).</p>
<h3>Codegen vs precompiled primitives</h3>
<p>Vectorwise and DuckDB precompile a library of vectorized primitives (<code>add_int32_vec_vec</code>, <code>filter_lt_int64_const</code>) with templates: no compile latency, easy to test, SIMD tuned per type, but each operator pass writes an intermediate vector. JIT fuses operators with no intermediates but costs compile time. Production engines often combine both: ClickHouse JIT-compiles expression chains; Spark whole-stage codegen compiles Java source with Janino.</p>
<h2>Pipelines and breakers</h2>
<p>A <b>pipeline</b> is a maximal chain of operators a tuple can flow through without being stored. A <b>pipeline breaker</b> must consume all input before producing output: hash-join build, aggregation, sort, and exchange. The plan becomes a DAG of pipelines; the scheduler runs a pipeline's tasks in parallel and starts dependents when it finishes.</p>
<div data-demo="1"></div>
<h2>Adaptive execution and shuffles</h2>
<p>Breakers are natural places to re-plan: once the hash-join build is done you know its true size. Spark's <b>AQE</b> uses shuffle statistics to coalesce small partitions, switch sort-merge to broadcast join, and split skewed partitions. In distributed engines an <b>exchange</b> (shuffle) repartitions data by hash or range over the network and is itself a breaker, usually the most expensive operator in the query: every row can cross the network once per join.</p>
<div class="callout"><div class="t">Rule of thumb</div><p>OLTP (few rows, short): iterator or bytecode is fine, planning latency matters. OLAP (billions of values): vectorize or compile, minimise intermediate materialization, and design operators around cache-sized batches.</p></div>`,
  demos: [{ title: 'Calls and time per execution model', caption: 'Scan -> Filter -> Project -> Sum over N rows. Batch size 1 turns vectorized into volcano.', mount }, { title: 'Where do pipelines break?', caption: 'Toggle breakers and see how the plan splits.', mount: mountPipe }],
  tradeoffs: { head: ['Model', 'Pros', 'Cons', 'Used by'], rows: [['Volcano (pull, tuple)', 'Simple, low memory, easy ops', 'Per-tuple call overhead, no SIMD', 'PostgreSQL, MySQL, SQLite'], ['Materialization', 'No call overhead, good for tiny inputs', 'Huge intermediates', 'VoltDB, MonetDB'], ['Vectorized + primitives', 'Amortized overhead, SIMD, no JIT latency', 'Intermediate vectors per op', 'DuckDB, ClickHouse, Vectorwise'], ['Compiled push (JIT)', 'Tightest loops, data in registers', 'Compile latency, complexity', 'HyPer, Umbra, Spark codegen'], ['Hybrid adaptive', 'Interpret now, compile if long', 'Two code paths to maintain', 'Umbra, Velox JIT']] },
  ripples: [{ to: 'Storage', text: 'vectorized and compiled engines want columnar batches; row pages need transposing (a cost) before SIMD helps.' }, { to: 'Scheduler', text: 'pipelines are the unit morsel-driven parallelism splits; breakers define sync points.' }, { to: 'Optimizer', text: 'the optimizer decides where breakers appear (hash vs nested loop) and whether to shuffle.' }, { to: 'Memory', text: 'breakers need spillable state (grace hash join, external sort) or queries OOM.' }],
  quiz: [{ q: 'Which of these is a pipeline breaker?', options: ['Filter', 'Projection', 'Hash-join build'], answer: 2, why: 'The build must finish before probing, so everything is materialized into the hash table.' }, { q: 'Why does vectorization beat volcano on analytics?', options: ['It uses fewer rows', 'Per-call overhead is amortized and loops become SIMD-friendly', 'It removes the optimizer'], answer: 1, why: 'One next() per ~1,000 values instead of per tuple.' }, { q: 'What is the main downside of JIT compilation for OLTP-ish queries?', options: ['Wrong results', 'Compile latency exceeds runtime', 'No parallelism'], answer: 1, why: 'LLVM compile can take tens of ms; a point query takes microseconds.' }],
  refs: [{ title: 'Boncz et al., MonetDB/X100: Hyper-Pipelining Query Execution (CIDR 2005)', url: 'https://www.cidrdb.org/cidr2005/papers/P19.pdf' }, { title: 'Neumann, Efficiently Compiling Efficient Query Plans (VLDB 2011)', url: 'https://www.vldb.org/pvldb/vol4/p539-neumann.pdf' }, { title: 'Kersten et al., Everything You Always Wanted to Know About Compiled and Vectorized Queries', url: 'https://www.vldb.org/pvldb/vol11/p2209-kersten.pdf' }, { title: 'Spark SQL: Adaptive Query Execution', url: 'https://spark.apache.org/docs/latest/sql-performance-tuning.html' }, { title: 'CMU 15-721 schedule', url: 'https://15721.courses.cs.cmu.edu/spring2024/schedule.html' }],
};
