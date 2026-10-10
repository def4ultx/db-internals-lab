import { h, slider, canvas, C, btn } from '../kit.js';

function mountEnc(el) {
  const ta = h('input', { type: 'text', value: '100,100,100,100,101,101,102,102,102,102,100,100', style: { width: '100%', padding: '8px', background: '#0b0e17', color: '#fff', border: '1px solid #2a3350', borderRadius: '8px', font: '13px var(--mono)' } });
  const out = h('div', { class: 'out' });
  const bitsFor = (x) => Math.max(1, Math.ceil(Math.log2(x + 1)));
  function run() {
    const v = ta.value.split(',').map((s) => +s.trim()).filter((x) => Number.isFinite(x)); if (!v.length) { out.textContent = 'enter integers'; return; }
    const raw = v.length * 4;
    const dict = [...new Set(v)].sort((a, b) => a - b); const dbits = bitsFor(dict.length - 1); const dictSize = dict.length * 4 + Math.ceil(v.length * dbits / 8);
    const runs = []; v.forEach((x) => { const l = runs[runs.length - 1]; if (l && l[0] === x) l[1]++; else runs.push([x, 1]); }); const rleSize = runs.length * 8;
    const mn = Math.min(...v), mx = Math.max(...v); const forBits = bitsFor(mx - mn); const forSize = 4 + 1 + Math.ceil(v.length * forBits / 8);
    const deltas = v.slice(1).map((x, i) => x - v[i]); const dm = Math.max(...deltas.map((d) => Math.abs(d)), 0); const dBits = bitsFor(dm) + 1; const deltaSize = 4 + Math.ceil(deltas.length * dBits / 8);
    const rows = [['raw int32', raw, ''], ['dictionary', dictSize, `${dict.length} distinct, ${dbits} bit codes`], ['RLE', rleSize, `${runs.length} runs (value, count)`], ['frame of reference + bitpack', forSize, `min=${mn}, ${forBits} bits/value`], ['delta + bitpack', deltaSize, `max |delta|=${dm}, ${dBits} bits`]];
    const best = Math.min(...rows.map((r) => r[1]));
    out.innerHTML = rows.map(([n, s, d]) => `${n.padEnd(30)} ${String(s).padStart(5)} B  ${(s / raw * 100).toFixed(0).padStart(3)}%  ${'█'.repeat(Math.max(1, Math.round(s / raw * 30)))} <span class="dim">${d}</span>${s === best ? ' <b class="good">best</b>' : ''}`).join('\n');
  }
  ta.addEventListener('input', run);
  const ex = h('div', { class: 'row' }, [['sorted ids', '1000,1001,1002,1003,1004,1005,1006,1007'], ['low-cardinality', '3,1,3,3,2,1,3,1,2,2,3,1'], ['long runs', '7,7,7,7,7,7,7,7,9,9,9,9,9,9,9,9'], ['wide spread', '5,90000,12,70000,3,81000']].map(([l, s]) => h('button', { class: 'dbtn', onclick: () => { ta.value = s; run(); } }, l)));
  el.append(ta, ex, out); run();
}

function mountZone(el) {
  const loS = slider({ label: 'WHERE price >=', min: 0, max: 100, value: 70, onInput: draw }); const hiS = slider({ label: 'and <=', min: 0, max: 100, value: 85, onInput: draw });
  const sortS = slider({ label: 'sortedness', min: 0, max: 100, value: 80, fmt: (v) => v + '%', onInput: build });
  const { cv, ctx, w, h: H } = canvas(720, 130); const out = h('div', { class: 'out' }); let blocks = [];
  function build() {
    let s = 3; const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; const N = 40, B = 100; const vals = Array.from({ length: N * B }, (_, i) => i / (N * B) * 100);
    const so = sortS.get() / 100; for (let i = 0; i < vals.length; i++) if (r() > so) { const j = Math.floor(r() * vals.length); [vals[i], vals[j]] = [vals[j], vals[i]]; }
    blocks = Array.from({ length: N }, (_, b) => { const sl = vals.slice(b * B, b * B + B); return { mn: Math.min(...sl), mx: Math.max(...sl) }; }); draw();
  }
  function draw() {
    const a = Math.min(loS.get(), hiS.get()), b = Math.max(loS.get(), hiS.get()); let skip = 0; ctx.clearRect(0, 0, w, H);
    blocks.forEach((k, i) => { const skipIt = k.mx < a || k.mn > b; if (skipIt) skip++; const x = 10 + i * 17.5; ctx.fillStyle = skipIt ? '#2a3350' : C.warn; ctx.fillRect(x, 10, 15, 60); ctx.fillStyle = C.accent; ctx.fillRect(x, 70 - k.mx * 0.6, 15, (k.mx - k.mn) * 0.6); });
    ctx.fillStyle = C.dim; ctx.font = '11px monospace'; ctx.fillText('each column = one block; blue = [min,max] zone; grey = skipped, yellow = must be read', 10, 90);
    out.innerHTML = `blocks skipped: <b class="good">${skip}/${blocks.length}</b> (${(skip / blocks.length * 100).toFixed(0)}% of I/O avoided). Min/max metadata is only useful when data is clustered or sorted on the column; at 0% sortedness every block spans the whole range and nothing is skipped.`;
  }
  el.append(h('div', { class: 'row' }, loS.el, hiS.el, sortS.el), cv, out); build();
}

export default {
  n: 10, title: 'Columnar, PAX, compression, zone maps', minutes: 16, cmu: 'CMU 15-721 L2-L3 (Storage models, compression)',
  components: ['column-store', 'compression', 'columnar-processing'],
  goals: ['Compare NSM, DSM and PAX layouts and say which workloads favour each.', 'Apply dictionary, RLE, delta, FOR and bit-packing and compute encoded sizes.', 'Explain zone maps, late materialization and why compression helps CPU as well as I/O.'],
  body: `
<h2>Three layouts</h2>
<table><tr><th>Layout</th><th>Idea</th><th>Strength</th><th>Weakness</th></tr>
<tr><td>NSM (row store)</td><td>all attributes of a tuple contiguous in a page</td><td>point reads, inserts, updates</td><td>scans read unused columns</td></tr>
<tr><td>DSM (column store)</td><td>each column stored separately</td><td>reads only referenced columns, compresses well, SIMD</td><td>tuple reconstruction, slow inserts and updates</td></tr>
<tr><td>PAX (hybrid)</td><td>a page holds a group of tuples but is split into per-column minipages</td><td>one I/O per row group, columnar CPU cache behaviour</td><td>needs larger pages / row groups for compression</td></tr></table>
<p>Parquet and ORC are PAX at file level: a file has <b>row groups</b> (e.g. 128 MB or 1M rows), each containing a <b>column chunk</b> per column, split into pages (~1 MB) with encoding and min/max stats; the footer holds the schema and offsets. DuckDB's row groups hold 122,880 rows; ClickHouse's MergeTree parts store each column in its own file(s) sorted by the primary key with a sparse index every 8,192 rows (a "granule").</p>
<h2>Compression schemes</h2>
<ul><li><b>Dictionary</b>: map distinct values to small integer codes; strings become 1-2 byte codes and equality can run on codes. Order-preserving dictionaries even allow range predicates on codes.</li>
<li><b>Run-length encoding (RLE)</b>: (value, count) pairs; superb on sorted or low-cardinality columns (a sorted <code>country</code> column of 100M rows becomes ~200 runs).</li>
<li><b>Delta</b>: store differences from the previous value (timestamps, ids); then bit-pack the small deltas.</li>
<li><b>Frame of reference (FOR)</b>: subtract a block minimum, bit-pack the residuals: values 1000-1007 need 3 bits instead of 32.</li>
<li><b>Bit-packing / SIMD-BP128</b>: fixed-width small integers, decoded 128+ per instruction batch; <b>FSST</b> for strings; <b>Gorilla/XOR</b> for floats in time series; general-purpose LZ4/ZSTD on top (LZ4 ~3 GB/s decode, ZSTD better ratio).</li></ul>
<div data-demo="0"></div>
<h2>Zone maps and late materialization</h2>
<p>Each block stores min and max (and sometimes null count and a bloom filter). A scan with <code>price BETWEEN 70 AND 85</code> skips blocks whose range does not intersect. It costs almost nothing to maintain and is the main reason sorted/clustered ingestion matters (Snowflake micro-partitions, Redshift sort keys, ClickHouse ORDER BY).</p>
<div data-demo="1"></div>
<p><b>Late materialization</b>: evaluate predicates on the filter columns first, producing a selection vector or bitmap of positions, then fetch only the other columns for surviving rows. Early materialization stitches tuples first (simple, bad when selective).</p>
<div class="callout tip"><div class="t">Compression is a CPU optimization too</div><p>Reading 3x fewer bytes means 3x less memory bandwidth, and many operators run directly on compressed data (dictionary codes, RLE runs). The break-even is decode speed vs I/O: with NVMe at 3 GB/s, heavy codecs like ZSTD level 19 can become the bottleneck; with S3 at 100 MB/s per connection they pay off.</p></div>
<h2>Updates in a column store</h2>
<p>Immutable, compressed files do not like in-place updates. Strategies: write-optimised delta store merged periodically (C-Store's WOS/ROS, Vertica), LSM-style parts with background merges (ClickHouse, StarRocks), delete bitmaps with rewrite (Parquet + Iceberg/Delta merge-on-read).</p>`,
  demos: [{ title: 'Live column encoder', caption: 'Type integers; compare encoded size under different schemes (sizes computed from actual bit widths).', mount: mountEnc }, { title: 'Zone-map skipping', caption: 'Range predicate over 40 blocks of 100 rows. Reduce sortedness and watch skipping disappear.', mount: mountZone }],
  tradeoffs: { head: ['Scheme', 'Best data', 'Ratio', 'Query on compressed?'], rows: [['Dictionary', 'low/medium cardinality strings', '2-10x', 'Yes (equality, group by codes)'], ['RLE', 'sorted / repeated values', 'up to 1000x', 'Yes (aggregate per run)'], ['Delta + bitpack', 'timestamps, ids', '4-8x', 'Needs prefix sum, partial'], ['FOR + bitpack', 'bounded ints', '2-8x', 'Yes with SIMD unpack'], ['LZ4 / ZSTD', 'anything', '2-5x', 'No: decompress first']] },
  ripples: [{ to: 'Execution', text: 'columnar data suits vectorized/compiled execution and SIMD; row pages force a transposition.' }, { to: 'Transactions', text: 'immutable column chunks mean MVCC is done with delete vectors or version metadata, not in-place version chains.' }, { to: 'Optimizer', text: 'stats from zone maps and dictionaries are nearly free and improve selectivity estimates; sort order is a physical property.' }, { to: 'Distributed', text: 'Parquet-on-object-store makes the file format the storage interface between engines.' }],
  quiz: [{ q: 'A sorted column with 3 distinct values over 1M rows is best compressed by…', options: ['Dictionary only', 'RLE', 'LZ4'], answer: 1, why: 'Only 3 runs remain, so 3 (value,count) pairs describe the column.' }, { q: 'Zone maps help most when data is…', options: ['randomly ordered', 'clustered/sorted on the filtered column', 'encrypted'], answer: 1, why: 'Blocks then have narrow, non-overlapping [min,max] ranges.' }, { q: 'Why is PAX attractive?', options: ['It avoids compression', 'Whole tuples are co-located per page but values are columnar inside', 'It removes the need for pages'], answer: 1, why: 'One I/O fetches a row group yet CPU sees column-contiguous values.' }],
  refs: [{ title: 'Ailamaki et al., Weaving Relations for Cache Performance (PAX, VLDB 2001)', url: 'https://research.cs.wisc.edu/multifacet/papers/vldb01_pax.pdf' }, { title: 'Stonebraker et al., C-Store (VLDB 2005)', url: 'https://people.csail.mit.edu/tdanford/6830papers/stonebraker-cstore.pdf' }, { title: 'Apache Parquet file format', url: 'https://parquet.apache.org/docs/file-format/' }, { title: 'CMU 15-721 schedule', url: 'https://15721.courses.cs.cmu.edu/spring2024/schedule.html' }],
};
