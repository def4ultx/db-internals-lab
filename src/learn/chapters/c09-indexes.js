import { h, btn, slider, canvas, C } from '../kit.js';

function mountTree(el) {
  let order = 4; // max keys per node
  let root = { leaf: true, keys: [], kids: null }; let last = null; let msg = '';
  function insert(k) {
    const split = (n) => {
      const mid = Math.ceil(n.keys.length / 2);
      if (n.leaf) { const r = { leaf: true, keys: n.keys.splice(mid), kids: null }; return [r.keys[0], r]; }
      const up = n.keys[mid]; const r = { leaf: false, keys: n.keys.splice(mid + 1), kids: n.kids.splice(mid + 1) }; n.keys.pop(); return [up, r];
    };
    const rec = (n) => {
      if (n.leaf) { if (n.keys.includes(k)) return null; n.keys.push(k); n.keys.sort((a, b) => a - b); } else {
        let i = 0; while (i < n.keys.length && k >= n.keys[i]) i++; const s = rec(n.kids[i]); if (!s) { return null; } n.keys.splice(i, 0, s[0]); n.kids.splice(i + 1, 0, s[1]);
      }
      if (n.keys.length > order) { splits++; return split(n); } return undefined;
    };
    splits = 0; const s = rec(root);
    if (s) { root = { leaf: false, keys: [s[0]], kids: [root, s[1]] }; }
    last = k; msg = `inserted ${k}: ${splits} node split(s)` + (s ? ' (root split, tree grew by one level)' : '');
  }
  let splits = 0;
  const { cv, ctx, w, h: H } = canvas(720, 240); const out = h('div', { class: 'out' });
  const inp = h('input', { type: 'number', value: 10, style: { width: '70px', background: '#0b0e17', color: '#fff', border: '1px solid #2a3350', borderRadius: '6px', padding: '4px' } });
  const oS = slider({ label: 'max keys/node', min: 3, max: 7, value: 4, onInput: (v) => { order = v; reset(); } });
  function reset() { root = { leaf: true, keys: [], kids: null }; msg = 'reset'; draw(); }
  function depth(n) { return n.leaf ? 1 : 1 + depth(n.kids[0]); }
  function draw() {
    ctx.clearRect(0, 0, w, H); ctx.font = '11px monospace'; const D = depth(root); const levels = [];
    (function walk(n, d) { (levels[d] = levels[d] || []).push(n); if (!n.leaf) n.kids.forEach((k) => walk(k, d + 1)); })(root, 0);
    const pos = new Map(); const leafW = (n) => n.keys.length * 20 + 12; let x = 10;
    levels[D - 1].forEach((n) => { pos.set(n, x + leafW(n) / 2); x += leafW(n) + 8; });
    for (let d = D - 2; d >= 0; d--) levels[d].forEach((n) => pos.set(n, (pos.get(n.kids[0]) + pos.get(n.kids[n.kids.length - 1])) / 2));
    const sc = Math.min(1, 700 / Math.max(x, 1));
    levels.forEach((lv, d) => lv.forEach((n) => {
      const cx = pos.get(n) * sc, y = 14 + d * 62, bw = leafW(n) * sc;
      if (!n.leaf) n.kids.forEach((k) => { ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(cx, y + 24); ctx.lineTo(pos.get(k) * sc, y + 62); ctx.stroke(); });
      ctx.fillStyle = n.leaf ? '#16301f' : '#1d2a52'; ctx.strokeStyle = n.leaf ? C.good : C.accent; ctx.fillRect(cx - bw / 2, y, bw, 24); ctx.strokeRect(cx - bw / 2, y, bw, 24);
      ctx.fillStyle = C.fg; n.keys.forEach((k, i) => { ctx.fillStyle = k === last ? C.warn : C.fg; ctx.fillText(k, cx - bw / 2 + 6 * sc + i * 20 * sc, y + 16); });
    }));
    const fan = order + 1; const cap = Math.pow(fan, 3) * order;
    out.textContent = `${msg}\nheight=${D}. With fan-out ${fan} a 3-level tree holds ~${cap.toLocaleString()} keys; a real 16 KB InnoDB page with 8-byte keys + 6-byte pointers has fan-out ~1,200, so 3 levels index ~1.7 billion rows (root cached, so ~2 I/Os).`;
  }
  const add = () => { insert(+inp.value || 0); inp.value = (+inp.value || 0) + 1; draw(); };
  el.append(h('div', { class: 'row' }, oS.el, inp, btn('Insert key', add), btn('Insert 8 random', () => { for (let i = 0; i < 8; i++) insert(Math.floor(Math.random() * 99)); draw(); }), btn('Reset', reset)), cv, out); draw();
}

function mountBloom(el) {
  const mS = slider({ label: 'bits (m)', min: 64, max: 4096, step: 64, value: 512, onInput: draw });
  const nS = slider({ label: 'keys (n)', min: 10, max: 600, value: 100, onInput: draw });
  const kS = slider({ label: 'hashes (k)', min: 1, max: 12, value: 4, onInput: draw });
  const { cv, ctx, w, h: H } = canvas(720, 120); const out = h('div', { class: 'out' });
  const hash = (x, s) => { let a = (x * 2654435761 + s * 40503) >>> 0; a ^= a >>> 15; a = Math.imul(a, 2246822519) >>> 0; a ^= a >>> 13; a = Math.imul(a, 3266489917) >>> 0; return (a ^ (a >>> 16)) >>> 0; };
  function draw() {
    const m = mS.get(), n = nS.get(), k = kS.get(); const bits = new Uint8Array(m);
    for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) bits[hash(i, j) % m] = 1;
    let fp = 0; const T = 4000; for (let t = 0; t < T; t++) { let all = true; for (let j = 0; j < k; j++) if (!bits[hash(1e6 + t, j) % m]) { all = false; break; } if (all) fp++; }
    const th = Math.pow(1 - Math.exp(-k * n / m), k), kopt = (m / n) * Math.LN2, ones = bits.reduce((a, b) => a + b, 0);
    ctx.clearRect(0, 0, w, H); const cols = Math.ceil(Math.sqrt(m * 6)), cw = 700 / cols; for (let i = 0; i < m; i++) { ctx.fillStyle = bits[i] ? C.accent : '#161c30'; ctx.fillRect(10 + (i % cols) * cw, 6 + Math.floor(i / cols) * cw, Math.max(1, cw - 1), Math.max(1, cw - 1)); }
    out.innerHTML = `bits set: ${ones}/${m} (${(ones / m * 100).toFixed(0)}%)   theoretical FPR (1-e^(-kn/m))^k = <b>${(th * 100).toFixed(2)}%</b>   measured over ${T} absent keys = <b class="${Math.abs(fp / T - th) < 0.03 ? 'good' : 'warn'}">${(fp / T * 100).toFixed(2)}%</b>\nbits per key = ${(m / n).toFixed(1)};  optimal k = (m/n) ln2 = ${kopt.toFixed(1)}.  Rule: 10 bits/key and k=7 gives ~1% FPR; each extra 4.8 bits/key divides FPR by 10.`;
  }
  el.append(h('div', { class: 'row' }, mS.el, nS.el, kS.el), cv, out); draw();
}

export default {
  n: 9, title: 'Index structures', minutes: 22, cmu: 'CMU 15-445 L7-L9, 15-721 L10',
  components: ['btree', 'lsm-tree', 'skiplist', 'adaptive-radix-tree', 'secondary-index'],
  goals: ['Work through B+tree search/insert/split and compute fan-out and height.', 'Explain the write-optimised alternatives: copy-on-write B-trees, Bw-tree, LSM-trees, with read/write/space amplification.', 'Choose between B+tree, LSM, hash, skiplist, ART, bitmap and bloom filters for a workload.'],
  body: `
<h2>B+tree</h2>
<p>The default index. Internal nodes hold separator keys and child pointers; all values (or record ids) live in leaves, which are linked left-to-right for range scans. Nodes are page-sized and kept at least half full (except the root). Lookup costs O(log<sub>F</sub> N) page reads where F is the fan-out; with F≈500-1200 three levels reach billions of rows, and the top levels stay in the buffer pool, so a point read is ~1-2 I/Os. Insert goes to the target leaf; if it overflows, split in two and push the middle key up, possibly splitting parents up to the root (the only way a B+tree grows taller). Delete may borrow from or merge with a sibling; many systems skip merging and rebalance lazily.</p>
<div data-demo="0"></div>
<h3>Concurrency: latch crabbing</h3>
<p>Descend holding the parent latch until the child is known to be "safe" (will not split/merge), then release the parent. Optimistic variants take only read latches on the way down and retry with write latches if a split is needed. Lehman-Yao B-link trees add right-sibling links so a reader can recover from a concurrent split (PostgreSQL's nbtree).</p>
<h2>Write-optimised structures</h2>
<ul><li><b>Copy-on-write B-tree</b> (LMDB, BoltDB, Btrfs): never modify a page in place; write a new leaf and new copies of every ancestor, then flip the root pointer atomically. No WAL needed and snapshot readers are free, but every update rewrites O(height) pages (write amplification) and the file needs a free-page reclaim scheme.</li>
<li><b>Bw-tree</b> (Hekaton, Microsoft): pages are located through a mapping table; updates prepend small <b>delta records</b> via compare-and-swap on the mapping-table slot (latch-free), consolidating chains when long. Great multi-core scaling; garbage collection via epochs; chain traversal hurts reads.</li>
<li><b>LSM-tree</b> (O'Neil 1996; LevelDB, RocksDB, Cassandra, ScyllaDB, HBase, Bigtable): writes go to a WAL and an in-memory sorted <b>memtable</b>; when full it is flushed as an immutable sorted <b>SSTable</b> (L0). Background <b>compaction</b> merges SSTables into larger sorted levels. Reads check the memtable then each level; a <b>bloom filter</b> per SSTable skips files that cannot contain the key. Deletes write a <b>tombstone</b> that is dropped only at the bottom level. Leveled compaction: write amplification ~10-30x, read amp low, space amp ~1.1x. Tiered/size-tiered: write amp ~ log(N), but read and space amp (up to 2x) are higher.</li>
<li><b>Skiplist</b>: a probabilistically balanced linked structure; easy lock-free implementation, used for LSM memtables (RocksDB, LevelDB), Redis sorted sets, MemSQL. Poor cache locality.</li>
<li><b>Adaptive Radix Tree (ART)</b>: byte-wise trie with node sizes 4/16/48/256 adapting to density, path compression; excels for in-memory point lookups and ordered scans (HyPer, DuckDB uses ART for constraints). Keys must be made byte-comparable.</li></ul>
<h2>Other index types</h2>
<ul><li><b>Hash index</b>: O(1) point lookups, no ranges. Extendible hashing doubles a directory on overflow; linear hashing splits buckets round-robin. PostgreSQL and InnoDB's adaptive hash index exist but are rarely the main index.</li>
<li><b>Bitmap index</b>: one bit-vector per distinct value; AND/OR of predicates become bitwise ops. Ideal for low-cardinality columns in OLAP (compressed with RoaringBitmaps); terrible for high write concurrency.</li>
<li><b>Bloom filter</b>: a bit array and k hash functions; "maybe present" or "definitely absent". False-positive rate <code>(1 - e<sup>-kn/m</sup>)<sup>k</sup></code>. Used in LSM reads, join runtime filters (build side bloom pushed into the probe scan), and Parquet.</li>
<li><b>Zone maps / min-max</b>, <b>inverted indexes</b> (text), and <b>learned indexes</b> (a model predicts position, bounded search).</li></ul>
<div data-demo="1"></div>
<div class="callout"><div class="t">Amplification triangle</div><p>Read amplification, write amplification, and space amplification: you can minimise two, rarely all three (the RUM conjecture). B+tree: read-optimal, write amp = page size / record size per update (e.g. 8,192 B written for a 100 B change before WAL). LSM trades read amp for write throughput.</p></div>`,
  demos: [{ title: 'B+tree insertion with splits', caption: 'Insert keys; yellow marks the last key. Lower the node capacity to watch splits and growth.', mount: mountTree }, { title: 'Bloom filter false positive calculator', caption: 'Build a real filter, query 4,000 absent keys, compare with the formula.', mount: mountBloom }],
  tradeoffs: { head: ['Structure', 'Point read', 'Range scan', 'Write', 'Space', 'Used by'], rows: [['B+tree', 'Excellent', 'Excellent', 'Moderate (random page writes)', '~70% page fill', 'InnoDB, PostgreSQL, SQLite'], ['COW B-tree', 'Excellent', 'Excellent', 'High write amp, no WAL', 'Needs reclaim', 'LMDB, BoltDB'], ['Bw-tree', 'Good', 'Good', 'Latch-free, good scaling', 'Delta chains', 'Hekaton, Azure Cosmos DB'], ['LSM', 'Good with bloom filters', 'Merge iterators', 'Excellent (sequential)', 'Compaction slack', 'RocksDB, Cassandra, HBase'], ['Hash', 'O(1)', 'None', 'Good', 'Directory', 'Memory hash tables, Bitcask'], ['ART', 'Excellent (memory)', 'Good', 'Good', 'Compact', 'HyPer, DuckDB'], ['Skiplist', 'O(log n)', 'Good', 'Easy lock-free', 'Pointer heavy', 'memtables, Redis']] },
  ripples: [{ to: 'Buffer pool', text: 'B+tree top levels are the hottest pages; LSM replaces the pool with block cache + memtable.' }, { to: 'WAL / recovery', text: 'in-place B+tree updates need a WAL and torn-page protection; COW and LSM get atomicity from structure (plus a WAL for the memtable).' }, { to: 'MVCC', text: 'LSM naturally stores multiple versions (sequence numbers in keys); B+tree engines need undo logs or version chains.' }, { to: 'Optimizer', text: 'index type determines which access paths exist (ordered scan, range, only equality) and the cost constants used.' }, { to: 'Compaction threads', text: 'an LSM adds background CPU and I/O that compete with foreground queries (write stalls).' }],
  quiz: [{ q: 'Fan-out 500, how many keys does a 3-level B+tree index?', options: ['~1.5 million', '~125 million', '~500 thousand'], answer: 1, why: '500^3 = 125 million (roughly, ignoring fill factor).' }, { q: 'Why does an LSM-tree keep a bloom filter per SSTable?', options: ['To compress data', 'To skip SSTables that cannot contain the key, cutting read amplification', 'To order keys'], answer: 1, why: 'A negative answer is exact, saving a disk read per file.' }, { q: 'With m=1000 bits and n=100 keys, the optimal k is about…', options: ['1', '7', '70'], answer: 1, why: 'k = (m/n) ln 2 = 10 x 0.693 ≈ 7.' }],
  refs: [{ title: "O'Neil et al., The Log-Structured Merge-Tree (1996)", url: 'https://www.cs.umb.edu/~poneil/lsmtree.pdf' }, { title: 'Leis et al., The Adaptive Radix Tree (ICDE 2013)', url: 'https://db.in.tum.de/~leis/papers/ART.pdf' }, { title: 'Levandoski et al., The Bw-Tree (ICDE 2013)', url: 'https://www.microsoft.com/en-us/research/publication/the-bw-tree-a-b-tree-for-new-hardware/' }, { title: 'Lehman & Yao, Efficient Locking for Concurrent Operations on B-Trees', url: 'https://dl.acm.org/doi/10.1145/319628.319663' }, { title: 'CMU 15-445 schedule (Fall 2024)', url: 'https://15445.courses.cs.cmu.edu/fall2024/schedule.html' }, { title: 'RocksDB: Compaction', url: 'https://github.com/facebook/rocksdb/wiki/Compaction' }],
};
