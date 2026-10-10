import { h, slider, canvas, C } from '../kit.js';

// Demo: bytes read to answer an OLTP point lookup vs an OLAP aggregate under row vs column layout.
function mount(el) {
  const rows = slider({ label: 'rows', min: 4, max: 9, step: 0.5, value: 7, fmt: (v) => '10^' + v });
  const cols = slider({ label: 'columns in table', min: 4, max: 100, step: 1, value: 30 });
  const out = h('div', { class: 'out' });
  const { cv, ctx, w, h: H } = canvas(720, 150);
  const fmtB = (b) => b >= 1e12 ? (b / 1e12).toFixed(1) + ' TB' : b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b >= 1e3 ? (b / 1e3).toFixed(1) + ' KB' : b.toFixed(0) + ' B';
  function draw() {
    const N = Math.pow(10, rows.get()), K = cols.get(), W = 8; // 8-byte values
    // OLTP: SELECT * WHERE id=? : row store reads 1 page (8 KB); column store gathers K values from K column files (K pages)
    const oltpRow = 8192, oltpCol = K * 8192;
    // OLAP: SELECT sum(c) : row store reads every row (K*W bytes each); column store reads one column (compressed ~3x)
    const olapRow = N * K * W, olapCol = N * W / 3;
    const bars = [['OLTP lookup / row store', oltpRow, C.good], ['OLTP lookup / column store', oltpCol, C.bad], ['OLAP sum(c) / row store', olapRow, C.bad], ['OLAP sum(c) / column store', olapCol, C.good]];
    ctx.clearRect(0, 0, w, H); ctx.font = '12px ui-monospace,monospace';
    bars.forEach(([lab, b, col], i) => {
      const y = 12 + i * 34, lg = Math.log10(Math.max(b, 1)) / 14;
      ctx.fillStyle = C.dim; ctx.fillText(lab, 8, y + 11);
      ctx.fillStyle = col; ctx.fillRect(230, y, Math.max(2, lg * 360), 16);
      ctx.fillStyle = C.fg; ctx.fillText(fmtB(b), 230 + lg * 360 + 8, y + 12);
    });
    out.textContent = `Bar length is log-scale. With ${N.toExponential(0)} rows x ${K} cols, the analytic query reads ${(olapRow / olapCol).toFixed(0)}x less data from a column store, while a point lookup touches ${K}x more pages.`;
  }
  rows.el.addEventListener('input', draw); cols.el.addEventListener('input', draw);
  el.append(h('div', { class: 'row' }, rows.el, cols.el), cv, out); draw();
}

export default {
  n: 0, title: 'Big picture & OLTP vs OLAP', minutes: 14, cmu: 'CMU 15-445 L1 / 15-721 L1',
  components: ['client', 'executor', 'buffer-pool'],
  goals: ['Name the stages a SQL statement passes through and what each hands to the next.', 'Explain why OLTP and OLAP pull the same system in opposite directions.', 'Predict which design choices (row vs column, 2PL vs MVCC, pull vs push) follow from the workload.'],
  body: `
<h2>The life of a query</h2>
<p>A database management system (DBMS) is a pipeline of components with narrow interfaces between them. A statement like <code>SELECT name FROM users WHERE id = 42</code> travels roughly like this:</p>
<ol>
<li><b>Client &amp; wire protocol</b>: bytes arrive over TCP (MySQL protocol, PostgreSQL frontend/backend protocol). A connection pool or per-connection thread picks it up.</li>
<li><b>Parser</b>: the lexer produces tokens, the parser produces an abstract syntax tree (AST). Pure syntax, no knowledge of your tables.</li>
<li><b>Binder + catalog</b>: names are resolved against the catalog (<code>users</code> is table 16384, <code>id</code> is column 1, type INT). Errors like "unknown column" appear here.</li>
<li><b>Optimizer</b>: turns the logical plan (what to compute) into a physical plan (how), using statistics and a cost model to choose among index scan, seq scan, hash join, and so on.</li>
<li><b>Executor</b>: runs the physical plan: operators pull or push tuples/vectors through each other.</li>
<li><b>Access methods &amp; buffer pool</b>: operators ask for pages; the buffer pool serves them from memory or reads 4-16 KB from disk.</li>
<li><b>Transaction layer</b>: concurrency control decides which row versions you may see; the WAL records changes so a crash cannot lose a committed one.</li>
</ol>
<div class="callout"><div class="t">Why interfaces matter</div><p>Each arrow above is a contract. If the storage layer is columnar, the executor must be able to consume batches of values rather than one tuple at a time, or you throw the benefit away. Most of this course is about those couplings.</p></div>

<h2>OLTP vs OLAP</h2>
<table>
<tr><th></th><th>OLTP (transactions)</th><th>OLAP (analytics)</th></tr>
<tr><td>Typical query</td><td>Read or write a handful of rows by key</td><td>Scan billions of rows, group, join, aggregate</td></tr>
<tr><td>Latency goal</td><td>sub-millisecond to ~10 ms</td><td>seconds; throughput of bytes scanned</td></tr>
<tr><td>Concurrency</td><td>thousands of small concurrent transactions</td><td>few large queries, each parallelised</td></tr>
<tr><td>Storage layout</td><td>row store (NSM), B+tree or LSM</td><td>column store (DSM/PAX), compressed</td></tr>
<tr><td>Execution</td><td>tuple-at-a-time is fine</td><td>vectorized or compiled, SIMD</td></tr>
<tr><td>Consistency</td><td>strict: ACID, short locks or MVCC</td><td>often snapshot reads over immutable files</td></tr>
<tr><td>Examples</td><td>MySQL/InnoDB, PostgreSQL, TigerBeetle</td><td>DuckDB, ClickHouse, StarRocks, Spark SQL</td></tr>
</table>
<p>HTAP systems (TiDB, SingleStore, Umbra) try to serve both, usually by keeping two representations (row for writes, column for scans) and paying to keep them in sync.</p>
<div data-demo="0"></div>
<h2>A mental model of cost</h2>
<p>Everything reduces to moving bytes. A DRAM access is about 100 ns; an NVMe random 4 KB read about 80-100 us (roughly 1000x slower); a cloud object-store GET about 20-50 ms. Databases exist largely to avoid the slower tiers: caching, indexes, and compression all trade CPU or space to touch less of the slow tier. The same idea explains why a 100-column table with a 1-column query is brutal on a row store: you drag 99 unwanted columns through memory.</p>
<h2>How to use this course</h2>
<p>Each chapter ends with a table of alternatives and a list of knock-on effects on other components. The 3D explorer lets you swap a design choice (say B+tree for LSM) and see what changes elsewhere; the compare page maps real systems onto those same choices.</p>`,
  demos: [{ title: 'Why layout follows workload', caption: 'Drag the sliders: a point lookup wants a row store, an aggregate wants a column store.', mount }],
  tradeoffs: { head: ['Choice', 'Wins for', 'Costs'], rows: [['Row store (NSM)', 'OLTP point reads/writes: one page holds the whole tuple', 'Scans read unneeded columns; poor compression'], ['Column store (DSM)', 'OLAP scans; compression 3-10x; SIMD', 'Point lookup and insert touch many files/pages'], ['Hybrid (PAX / HTAP)', 'Both, within a page or via dual copies', 'Complexity; sync lag or write amplification']] },
  ripples: [{ to: 'Executor', text: 'a column store wants vectorized or compiled execution; tuple-at-a-time wastes its layout.' }, { to: 'Concurrency control', text: 'long OLAP scans make MVCC (snapshot reads that never block writers) almost mandatory in mixed workloads.' }, { to: 'Storage', text: 'OLTP needs in-place updates and a WAL; OLAP prefers immutable, sorted, compressed files.' }],
  quiz: [
    { q: 'SELECT sum(price) over 1 billion rows of a 40-column table. Which layout reads the least data?', options: ['Row store', 'Column store', 'Same either way'], answer: 1, why: 'Only the price column is read, and columns compress well.' },
    { q: 'Which component resolves the name "users" to a table id and column types?', options: ['Parser', 'Binder with the catalog', 'Buffer pool'], answer: 1, why: 'The parser only checks syntax; the binder consults the catalog.' },
    { q: 'Why is MVCC attractive for mixed workloads?', options: ['It removes the need for a WAL', 'Readers use a snapshot and do not block writers', 'It makes scans faster'], answer: 1, why: 'Versioned rows let long readers see a consistent snapshot while writers proceed.' },
  ],
  refs: [{ title: 'CMU 15-445 Fall 2024: Lecture 1 (Relational model)', url: 'https://15445.courses.cs.cmu.edu/fall2024/schedule.html' }, { title: 'CMU 15-721 Spring 2024 schedule', url: 'https://15721.courses.cs.cmu.edu/spring2024/schedule.html' }, { title: 'Hellerstein, Stonebraker, Hamilton: Architecture of a Database System', url: 'https://dsf.berkeley.edu/papers/fntdb07-architecture.pdf' }],
};
