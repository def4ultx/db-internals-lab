import { h, slider, canvas, C, toggle } from '../kit.js';

function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function mount(el) {
  const R = rng(7); const N = 100000;
  // skewed ages 0..99: zipf-like
  const data = new Array(N); for (let i = 0; i < N; i++) data[i] = Math.min(99, Math.floor(Math.pow(R(), 2.2) * 100));
  const cnt = new Array(100).fill(0); data.forEach((v) => cnt[v]++);
  const buckets = slider({ label: 'buckets', min: 2, max: 20, value: 6, onInput: draw });
  const lo = slider({ label: 'age >=', min: 0, max: 99, value: 5, onInput: draw });
  const hi = slider({ label: 'age <=', min: 0, max: 99, value: 12, onInput: draw });
  const eq = toggle({ label: 'equi-depth (off = equi-width)', value: false, onChange: draw });
  const { cv, ctx, w, h: H } = canvas(720, 200); const out = h('div', { class: 'out' });
  function draw() {
    const B = buckets.get(), a = Math.min(lo.get(), hi.get()), b = Math.max(lo.get(), hi.get());
    let edges = [0];
    if (!eq.get()) for (let i = 1; i <= B; i++) edges.push(Math.round(100 * i / B)); else { let acc = 0, k = 1; for (let v = 0; v < 100; v++) { acc += cnt[v]; if (acc >= N * k / B && k < B) { edges.push(v + 1); k++; } } edges.push(100); edges = [...new Set(edges)]; }
    const bk = []; for (let i = 0; i < edges.length - 1; i++) { let c = 0; for (let v = edges[i]; v < edges[i + 1]; v++) c += cnt[v]; bk.push({ l: edges[i], r: edges[i + 1], c }); }
    let est = 0; bk.forEach((x) => { const ov = Math.max(0, Math.min(b + 1, x.r) - Math.max(a, x.l)); est += x.c * ov / (x.r - x.l); });
    let truth = 0; for (let v = a; v <= b; v++) truth += cnt[v];
    ctx.clearRect(0, 0, w, H); const mx = Math.max(...cnt);
    for (let v = 0; v < 100; v++) { ctx.fillStyle = v >= a && v <= b ? C.warn : '#34406a'; const bh = cnt[v] / mx * 150; ctx.fillRect(10 + v * 6.4, 170 - bh, 5, bh); }
    ctx.strokeStyle = C.accent; ctx.fillStyle = C.accent; ctx.font = '11px monospace';
    bk.forEach((x) => { const px = 10 + x.l * 6.4; ctx.beginPath(); ctx.moveTo(px, 20); ctx.lineTo(px, 175); ctx.stroke(); const avg = x.c / (x.r - x.l); ctx.fillStyle = C.good; ctx.fillRect(px, 170 - avg / mx * 150, (x.r - x.l) * 6.4, 2); });
    ctx.fillStyle = C.dim; ctx.fillText('value 0..99 (bar = true frequency, green line = histogram average, blue = bucket edges)', 10, 192);
    const err = est / Math.max(truth, 1);
    out.innerHTML = `true rows: ${truth.toLocaleString()}   estimated: ${Math.round(est).toLocaleString()}   q-error: <b class="${Math.max(err, 1 / err) < 1.5 ? 'good' : 'bad'}">${Math.max(err, 1 / err).toFixed(2)}x</b>\nEqui-width buckets assume uniformity inside a bucket; the skew at small ages breaks that. Equi-depth puts equal rows per bucket, so hot regions get finer resolution.`;
  }
  el.append(h('div', { class: 'row' }, buckets.el, lo.el, hi.el, eq.el), cv, out); draw();
}
function mountCross(el) {
  const N = 10000000, rowsPerPage = 100, pages = N / rowsPerPage;
  const sel = slider({ label: 'selectivity', min: 0, max: 100, step: 0.5, value: 1, fmt: (v) => (v / 10).toFixed(2) + '%', onInput: draw });
  const rpc = slider({ label: 'random/seq page cost', min: 1, max: 10, step: 0.5, value: 4, fmt: (v) => v + 'x', onInput: draw });
  const { cv, ctx, w, h: H } = canvas(720, 190); const out = h('div', { class: 'out' });
  function draw() {
    const R = rpc.get(), s = sel.get() / 1000;
    const seq = pages; const idx = (p) => Math.min(N * p, pages * 3) * R + 3 * R;
    ctx.clearRect(0, 0, w, H);
    const mxY = pages * R * 1.2; const X = (p) => 40 + p * 660, Y = (c) => 170 - Math.min(1, c / mxY) * 150;
    ctx.strokeStyle = C.good; ctx.beginPath(); ctx.moveTo(X(0), Y(seq)); ctx.lineTo(X(1), Y(seq)); ctx.stroke();
    ctx.strokeStyle = C.bad; ctx.beginPath(); for (let i = 0; i <= 200; i++) { const p = i / 200 * 0.1; ctx.lineTo(X(p * 10), Y(idx(p))); } ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '11px monospace'; ctx.fillText('selectivity 0% to 10%  (green: seq scan, red: index scan with heap fetches)', 40, 186);
    const cross = ((pages / R) / N) * 100; ctx.fillStyle = C.warn; const cx = X(cross / 10); ctx.fillRect(cx, 20, 1, 150);
    ctx.fillStyle = C.fg; ctx.beginPath(); ctx.arc(X(s * 10), Y(Math.min(idx(s), 1e12)), 4, 0, 7); ctx.fill();
    out.innerHTML = `10M rows, ${pages.toLocaleString()} pages. Seq scan cost: ${seq.toLocaleString()}. Index scan at ${(s * 100).toFixed(2)}%: ${Math.round(idx(s)).toLocaleString()}\nWinner: <b class="${idx(s) < seq ? 'good' : 'bad'}">${idx(s) < seq ? 'index scan' : 'sequential scan'}</b>. Crossover near ${cross.toFixed(2)}% selectivity (a wrong estimate flips the plan). Real planners also use bitmap scans in between.`;
  }
  el.append(h('div', { class: 'row' }, sel.el, rpc.el), cv, out); draw();
}

export default {
  n: 3, title: 'Statistics & cardinality', minutes: 14, cmu: 'CMU 15-445 L14-L15, 15-721 optimizer lectures',
  components: ['statistics', 'cardinality-estimator', 'cost-model'],
  goals: ['Explain what statistics a DBMS keeps (row counts, NDV, histograms, MCVs, sketches).', 'Estimate selectivity with the independence and uniformity assumptions and know when they fail.', 'Explain why a cardinality error flips a plan choice, such as index vs sequential scan.'],
  body: `
<h2>What the optimizer needs to know</h2>
<p>The optimizer compares plans by <b>estimated cost</b>, and cost is dominated by <b>cardinality</b>: how many rows each operator emits. Statistics provide the inputs: table row count and page count, per-column <b>number of distinct values (NDV)</b>, null fraction, min/max, <b>most common values (MCV)</b> with frequencies, and a <b>histogram</b> of the rest.</p>
<table><tr><th>Statistic</th><th>How built</th><th>Used for</th></tr>
<tr><td>Equi-width histogram</td><td>buckets of equal value range</td><td>cheap; poor under skew</td></tr>
<tr><td>Equi-depth histogram</td><td>buckets with equal row counts (PostgreSQL <code>histogram_bounds</code>, default 100 buckets)</td><td>range predicates</td></tr>
<tr><td>MCV list</td><td>top-k values with frequencies (default 100)</td><td>equality on skewed values</td></tr>
<tr><td>HyperLogLog</td><td>sketch of hash leading zeros, ~1.6% error with 2^12 registers (~4 KB)</td><td>NDV and group counts; mergeable across partitions</td></tr>
<tr><td>DDSketch / t-digest</td><td>quantile sketch with relative-error guarantee</td><td>percentiles and histograms in distributed OLAP</td></tr>
<tr><td>Sample</td><td>random pages/rows (ANALYZE reads ~30,000 rows by default in Postgres)</td><td>join/correlation estimates (DuckDB, Hyper, learned)</td></tr></table>
<h2>Selectivity arithmetic</h2>
<p>For <code>age = 40</code>: use MCV frequency if present, else <code>(1 - nullfrac - sum(mcv)) / (NDV - #mcv)</code>. For <code>age BETWEEN a AND b</code>: sum fully covered buckets plus a fraction of partial ones assuming uniformity inside a bucket. For <code>p AND q</code>, the independence assumption multiplies: <code>sel(p) * sel(q)</code>. For a foreign-key join <code>R ⨝ S</code> the textbook estimate is <code>|R| * |S| / max(NDV(R.a), NDV(S.b))</code>.</p>
<div data-demo="0"></div>
<h2>Where it goes wrong</h2>
<ul><li><b>Correlation</b>: <code>city='Bangkok' AND country='TH'</code> is nearly as selective as <code>city='Bangkok'</code> alone, but independence multiplies them and underestimates by orders of magnitude. PostgreSQL offers <code>CREATE STATISTICS</code> (functional dependencies, multivariate NDV, MCV); SQL Server and Oracle have column-group stats.</li>
<li><b>Errors compound through joins</b>: Leis et al. ("How Good Are Query Optimizers, Really?") measured estimates off by factors of 10<sup>3</sup>-10<sup>6</sup> after 4+ joins on JOB; the cost model mattered much less than cardinalities.</li>
<li><b>Staleness</b>: stats are computed by ANALYZE / background jobs, so a bulk load can make them wrong until the next run.</li></ul>
<h2>Why the error matters: choosing an access path</h2>
<p>An index scan costs roughly one random page read per matching row (up to the number of pages), while a sequential scan reads every page cheaply. Below some selectivity the index wins; above it, scanning wins. The crossover is typically 1% or lower on spinning disks and a few percent on SSDs. A 10x cardinality error near the crossover turns a 50 ms query into a 50 s one.</p>
<div data-demo="1"></div>
<div class="callout ripple"><div class="t">Execution feedback</div><p>Adaptive execution (Spark AQE, Umbra, Oracle adaptive plans) observes true cardinalities at pipeline breakers and re-plans the rest, trading planning complexity for robustness.</p></div>`,
  demos: [{ title: 'Histogram range estimates', caption: 'Compare equi-width and equi-depth on a skewed column (100,000 rows).', mount }, { title: 'Index scan vs sequential scan crossover', caption: 'Slide the selectivity across the crossover.', mount: mountCross }],
  tradeoffs: { head: ['Method', 'Accuracy', 'Cost', 'Weak spot'], rows: [['Equi-width histogram', 'Poor on skew', 'Cheapest', 'Hot values hidden in wide buckets'], ['Equi-depth + MCV', 'Good for single column', 'Sort/sample at ANALYZE', 'Correlations, joins'], ['HyperLogLog sketch', '~1-2% NDV', 'Tiny, mergeable, streaming', 'No value distribution'], ['Sampling at plan time', 'Handles correlations and joins', 'Latency at planning', 'Rare values missed'], ['Learned estimators', 'Best on trained workloads', 'Training, drift, inference time', 'Robustness, maintenance']] },
  ripples: [{ to: 'Optimizer', text: 'join order and algorithm choice are only as good as the cardinalities fed in.' }, { to: 'Plan cache', text: 'a cached plan built on old stats keeps being used; parameter-sensitive plans (skewed values) need generic vs custom plan logic.' }, { to: 'Execution', text: 'hash table sizing and memory grants come from estimates; underestimates cause spills.' }],
  quiz: [{ q: 'Independence assumption: sel(a)=0.1, sel(b)=0.1, perfectly correlated. Estimate vs truth?', options: ['0.01 vs 0.1 (underestimate 10x)', '0.1 vs 0.01', 'Exact'], answer: 0, why: 'Independence multiplies to 0.01 but if b implies a, the real selectivity is 0.1.' }, { q: 'Why is HyperLogLog popular in distributed engines?', options: ['It gives exact counts', 'Sketches merge across partitions with tiny state', 'It replaces indexes'], answer: 1, why: 'Registers merge by element-wise max, so partial results combine cheaply.' }, { q: 'Index scan beats seq scan when…', options: ['selectivity is high (most rows match)', 'selectivity is low (few rows match)', 'the table is small and cached only'], answer: 1, why: 'Few matches means few random reads; many matches means a scan is cheaper.' }],
  refs: [{ title: 'Leis et al., How Good Are Query Optimizers, Really? (VLDB 2015)', url: 'https://www.vldb.org/pvldb/vol9/p204-leis.pdf' }, { title: 'Flajolet et al., HyperLogLog (2007)', url: 'https://algo.inria.fr/flajolet/Publications/FlFuGaMe07.pdf' }, { title: 'PostgreSQL: Planner statistics', url: 'https://www.postgresql.org/docs/current/planner-stats.html' }, { title: 'CMU 15-721 schedule', url: 'https://15721.courses.cs.cmu.edu/spring2024/schedule.html' }],
};
