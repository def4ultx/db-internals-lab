import './landing.css';
const app = document.getElementById('app');
const stages = [
  ['Client', '#7aa2f7', 'SQL text', 'The client sends <b>SELECT name FROM users WHERE id = 42</b> over the wire protocol.'],
  ['Parser', '#bb9af7', 'AST', 'The lexer and parser turn text into a syntax tree. No table knowledge yet.'],
  ['Binder', '#bb9af7', 'bound AST', 'Names are resolved against the <b>catalog</b>: users is table 16384, id is INT.'],
  ['Optimizer', '#e0af68', 'physical plan', 'Statistics say id is unique, so an <b>index lookup</b> beats a scan. Cost: ~3 page reads.'],
  ['Executor', '#9ece6a', 'tuples', 'Operators pull (or push) tuples or vectors through the plan.'],
  ['Txn + Buffer pool', '#f7768e', 'pages / versions', 'MVCC picks the visible row version; the buffer pool serves the 8 KB page from memory.'],
  ['Storage', '#2ac3de', 'bytes', 'On a miss: one NVMe read (~100 us). Updates would also append to the <b>WAL</b> first.'],
];
const W = 150, G = 14;
const boxes = stages.map(([n, c, o], i) => {
  const x = 10 + i * ((1120 - 20 - W) / (stages.length - 1));
  return `<g class="box" data-i="${i}"><rect x="${x}" y="50" width="${W - 30}" height="64" rx="10" stroke="${c}"/><text x="${x + (W - 30) / 2}" y="78" text-anchor="middle">${n}</text><text class="sub" x="${x + (W - 30) / 2}" y="98" text-anchor="middle">${o}</text></g>`;
}).join('');
const xs = stages.map((_, i) => 10 + i * ((1120 - 20 - W) / (stages.length - 1)) + (W - 30) / 2);
const path = `M${xs[0]},82 ` + xs.slice(1).map((x) => `L${x},82`).join(' ');
const arrows = xs.slice(0, -1).map((x, i) => `<line x1="${x + (W - 30) / 2}" y1="82" x2="${xs[i + 1] - (W - 30) / 2}" y2="82" stroke="#2a3350" stroke-width="2"/>`).join('');
app.innerHTML = `<div class="land">
<section class="hero"><h1>See inside the database.</h1>
<p>An interactive lab for how SQL engines really work: from a parsed query to bytes on disk, and across a cluster. Built around CMU 15-445 and 15-721, with a focus on how one design choice ripples through every other component.</p></section>
<section class="cards">
 <a class="card" style="--c:#2ac3de" href="/explore.html"><div class="ic">◈</div><h3>3D Explorer</h3><p>Fly through components, zoom into a B+tree or a Raft log, swap design choices and see what changes.</p><span class="go">Explore →</span></a>
 <a class="card" style="--c:#9ece6a" href="/learn.html"><div class="ic">☰</div><h3>Learn</h3><p>An 18-chapter course with interactive demos, trade-off tables, quizzes and CMU references.</p><span class="go">Start course →</span></a>
 <a class="card" style="--c:#e0af68" href="/compare.html"><div class="ic">⇄</div><h3>Compare</h3><p>MySQL, Postgres, DuckDB, ClickHouse, Spark, Cassandra, FoundationDB and more, side by side.</p><span class="go">Compare →</span></a>
</section>
<section class="sec"><h2>The life of a query</h2><p>Seven components, seven narrow interfaces. Watch a point lookup travel through the engine.</p>
<div class="life"><svg viewBox="0 0 1140 150" role="img" aria-label="A query flowing through client, parser, binder, optimizer, executor, transaction and buffer pool, and storage">
 ${arrows}${boxes}
 <path id="route" d="${path}" fill="none"/>
 <circle class="pkt" r="7" fill="#fff" color="#7aa2f7"><animateMotion dur="9s" repeatCount="indefinite" calcMode="linear"><mpath href="#route"/></animateMotion></circle>
 <circle id="hl" cx="${xs[0]}" cy="82" r="0"/>
</svg><div class="cap" id="cap"></div></div></section>
<section class="sec"><h2>OLTP vs OLAP at a glance</h2><p>Same SQL, opposite physical needs. Nearly every design decision in the course follows from which side you optimise for.</p>
<div class="two">
 <div class="col"><div class="tag" style="color:#9ece6a">OLTP</div><h3>Many tiny transactions</h3>
 <svg viewBox="0 0 300 70"><g>${Array.from({ length: 6 }, (_, i) => `<rect x="${8 + i * 48}" y="10" width="40" height="50" rx="4" fill="#1d2540" stroke="#2a3350"/>`).join('')}<rect x="104" y="10" width="40" height="50" rx="4" fill="#9ece6a" opacity=".85"/></g></svg>
 <ul><li>Touch a few rows by key, latency in ms</li><li>Row store + B+tree/LSM, WAL, MVCC or 2PL</li><li>Tuple-at-a-time execution is fine</li><li>MySQL, PostgreSQL, TigerBeetle, FoundationDB</li></ul></div>
 <div class="col"><div class="tag" style="color:#7aa2f7">OLAP</div><h3>Few huge scans</h3>
 <svg viewBox="0 0 300 70"><g>${Array.from({ length: 6 }, (_, i) => `<rect x="${8 + i * 48}" y="10" width="40" height="50" rx="4" fill="${i === 2 ? '#7aa2f7' : '#1d2540'}" stroke="#2a3350" opacity="${i === 2 ? .9 : 1}"/>`).join('')}</g></svg>
 <ul><li>Scan billions of values of a few columns</li><li>Column store, compression, zone maps</li><li>Vectorized or compiled, morsel-parallel</li><li>DuckDB, ClickHouse, StarRocks, Spark SQL</li></ul></div>
</div></section>
<div class="stats"><div><b>7</b>layers</div><div><b>18</b>chapters</div><div><b>~70</b>components</div><div><b>15+</b>real systems</div></div>
<div class="foot">Everything runs locally in your browser. Start with <a href="/learn.html#ch=0">chapter 0</a>.</div></div>`;
// sync caption with the packet position (9s loop across 7 stages)
const cap = document.getElementById('cap');
const boxEls = [...app.querySelectorAll('.box rect')];
let last = -1;
const t0 = performance.now();
function tick() {
  const p = (((performance.now() - t0) / 9000) % 1) * (stages.length - 1);
  const i = Math.min(stages.length - 1, Math.round(p));
  if (i !== last) {
    last = i; cap.innerHTML = `<b>${i + 1}. ${stages[i][0]}</b>: ${stages[i][3]}`;
    boxEls.forEach((r, k) => r.style.fill = k === i ? stages[k][1] + '33' : '');
  }
  requestAnimationFrame(tick);
}
tick();
