// secondary-index: btree | hash | bitmap | zonemap-minmax | bloom | inverted over one small real table (28 rows, 4 heap pages x 7 slots).
import * as THREE from 'three';
import { C, panel, box, text, mono, line, arrow, para, hex, rng, cellGrid, scaffold, opt, ascii } from './_kitD.js';

const NR = 28, PER_PAGE = 7;
const CITY = ['BKK', 'SGN', 'JKT', 'KUL', 'MNL'], STAT = ['open', 'closed', 'pending'];
const WORDS = ['beach', 'spa', 'city', 'temple', 'pool', 'market', 'mountain', 'wifi', 'family', 'luxury'];
const OPTS = ['btree', 'hash', 'bitmap', 'zonemap-minmax', 'bloom', 'inverted'];
const ONAME = { btree: 'B+tree', hash: 'Hash index', bitmap: 'Bitmap index', 'zonemap-minmax': 'Zone map (min/max per block)', bloom: 'Bloom filter', inverted: 'Inverted index (posting lists)' };
const PAL = [C.blue, C.purple, C.yellow, C.green, C.orange, C.pink, C.cyan, '#c3e88d'];
const S = { opt: 'btree', probe: 40, width: 120, city: 'BKK', status: 'open', op: 'AND', t1: 'beach', t2: 'spa', bpk: 8, k: 0, cluster: false, rows: [], dirty: true, fp: null, seed: 5, bloomKey: 12 };
let inst = null;

function gen() {
  const r = rng(S.seed * 31 + 7); let rows = [];
  for (let i = 0; i < NR; i++) {
    const tags = new Set(); const nt = 2 + Math.floor(r() * 3); while (tags.size < nt) tags.add(WORDS[Math.floor(Math.pow(r(), 1.3) * 10)]);
    rows.push({ id: i + 1, city: CITY[Math.floor(r() * 5)], status: STAT[Math.floor(Math.pow(r(), 1.4) * 3)], price: 50 + Math.floor(r() * 900), tags: [...tags].sort() });
  }
  if (S.cluster) rows.sort((a, b) => a.price - b.price);
  rows.forEach((x, i) => { x.rid = [Math.floor(i / PER_PAGE) + 1, i % PER_PAGE]; x.i = i; });
  S.rows = rows;
}
const fnv = (s, seed = 2166136261) => { let h = seed >>> 0; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const h2f = (s) => { let h = 0x9747b28c; for (const c of s) { h = Math.imul(h ^ c.charCodeAt(0), 0x5bd1e995) >>> 0; h ^= h >>> 13; } return (h | 1) >>> 0; };
const bloomPos = (key, m, k) => { const a = fnv(key), b = h2f(key), out = []; for (let i = 0; i < k; i++) out.push(((a + Math.imul(i, b)) >>> 0) % m); return out; };
const ridS = (r) => `(${r.rid[0]},${r.rid[1]})`;
const pagesOf = (rs) => new Set(rs.map((r) => r.rid[0])).size;
const lo = () => 50 + Math.round(S.probe / 100 * 900), hi = () => lo() + S.width;

function drawTable(g, hl, fetched, showTags) {
  box(g, 20, 80, 700, 1110, 'rgba(18,24,41,0.88)', C.line, 10);
  text(g, 'heap table (4 pages × 7 slots)', 40, 108, { size: 26, weight: '700', color: C.cyan });
  (showTags ? ['RID', 'id', 'tags'] : ['RID', 'id', 'city', 'status', 'price']).forEach((h, i) => text(g, h, [40, 150, 230, 330, 470][i], 148, { size: 20, color: C.dim }));
  S.rows.forEach((r, i) => {
    const y = 168 + i * 34, on = hl.has(r.i);
    if (r.rid[1] === 0 && i) line(g, 30, y - 2, 710, y - 2, C.line, 1.5);
    if (on) box(g, 28, y, 684, 32, fetched ? 'rgba(158,206,106,0.28)' : 'rgba(224,175,104,0.25)', fetched ? C.green : C.yellow, 4, 2);
    mono(g, ridS(r), 40, y + 17, { size: 22, color: C.yellow }); mono(g, r.id, 150, y + 17, { size: 22 }); if (!showTags) { mono(g, r.city, 230, y + 17, { size: 22 }); mono(g, r.status, 330, y + 17, { size: 22 }); }
    mono(g, showTags ? r.tags.join(' ') : r.price, showTags ? 230 : 470, y + 17, { size: showTags ? 20 : 22, color: C.fg });
  });
}
const SX = 740, SW = 1240;
function stats(g, o) {
  const y0 = 850; box(g, SX, y0, SW, 340, 'rgba(18,24,41,0.88)', C.line, 10);
  text(g, 'cost & properties', SX + 20, y0 + 30, { size: 26, weight: '700', color: C.yellow });
  let yy = y0 + 56; o.lines.forEach((s) => { const col = s[0] === '+' ? C.green : s[0] === '-' ? C.red : C.fg; yy = para(g, s, SX + 20, yy, SW - 40, { size: 25, lh: 31, color: col }) + 10; });
}

function drawBtree(g) {
  const asc = S.rows.slice().sort((a, b) => a.price - b.price), per = 5, leaves = []; for (let i = 0; i < asc.length; i += per) leaves.push(asc.slice(i, i + per));
  const L = lo(), H = S.width ? hi() : lo(); const point = S.width === 0;
  const match = asc.filter((r) => (point ? r.price >= L : r.price >= L && r.price <= H)); const m1 = point ? match.slice(0, 1) : match;
  const startLeaf = leaves.findIndex((lf) => lf[lf.length - 1].price >= L);
  text(g, `B+tree on price: ${point ? `point/first ≥ ${L}` : `range ${L}‥${H}`}`, SX + 20, 108, { size: 28, weight: '700' });
  const rootX = SX + SW / 2 - 330, rootY = 150; box(g, rootX, rootY, 660, 62, '#1d2745', C.blue, 6, 3);
  text(g, 'root', rootX - 6, rootY + 31, { size: 20, color: C.dim, align: 'right' });
  leaves.forEach((lf, i) => { if (i) mono(g, lf[0].price, rootX + (i - 0.5) * (660 / leaves.length), rootY + 31, { size: 21, color: C.blue, align: 'center' }); });
  const lw = 190, gap = 8, lh = 40 + per * 36; let hlSet = new Set();
  const used = new Set(); leaves.forEach((lf, i) => { const x = SX + 20 + (i % 6) * (lw + gap), y = 300 + Math.floor(i / 6) * 300;
    const scanned = i >= startLeaf && lf[0].price <= (point ? 1e9 : H) && (point ? i === startLeaf : true), isStart = i === startLeaf;
    const cx = rootX + (i + 0.5) * (660 / leaves.length); arrow(g, cx, rootY + 62, x + lw / 2, y, isStart ? C.green : C.line, isStart ? 3.5 : 1.5);
    box(g, x, y, lw, lh, 'rgba(10,14,28,0.7)', scanned ? C.green : C.line, 6, scanned ? 3 : 1.5);
    lf.forEach((r, j) => { const yy = y + 8 + j * 36, isM = m1.includes(r); if (isM) { hlSet.add(r.i); box(g, x + 4, yy, lw - 8, 32, 'rgba(158,206,106,0.35)', null, 4); }
      mono(g, `${r.price}→${ridS(r)}`, x + lw / 2, yy + 17, { size: 22, align: 'center', color: isM ? '#fff' : C.fg }); });
    if (i < leaves.length - 1 && (i % 6) < 5) arrow(g, x + lw, y + lh / 2, x + lw + gap, y + lh / 2, C.orange, 2);
  });
  text(g, 'leaf entries: (key → RID); leaves doubly linked for range scans', SX + 20, 520 + 60 + 20, { size: 22, color: C.dim });
  const heapPages = pagesOf(m1);
  mono(g, `root → leaf ${startLeaf + 1}: 2 node reads, +${Math.max(0, leaves.filter((lf, i) => i > startLeaf && lf[0].price <= H && !point).length)} leaf hop(s)`, SX + 20, 690, { size: 24, color: C.green });
  mono(g, `${m1.length} match(es) → ${m1.length} random heap reads on ${heapPages} page(s)`, SX + 20, 726, { size: 24, color: C.yellow });
  stats(g, { lines: ['+ point, range, prefix, ORDER BY, MIN/MAX; ~O(log_f n) = 2-3 page reads', '- every INSERT/UPDATE/DELETE also modifies the index (random write, splits); entry cost ≈ key + 6-8 B RID; InnoDB secondary leaves hold the PRIMARY KEY, not a RID, so a lookup walks a second tree', '- unclustered: each match is a random heap read (m matches ≈ m I/Os) so high-selectivity only; an index-only/covering scan avoids the heap'] });
  return hlSet;
}
function drawHash(g) {
  const NB = 8, tgt = S.rows[Math.min(NR - 1, Math.round(S.probe / 100 * (NR - 1)))], key = String(tgt.id), b = fnv(key) % NB;
  text(g, `Hash index on id: lookup id = ${key}`, SX + 20, 108, { size: 28, weight: '700' });
  mono(g, `FNV-1a("${key}") = 0x${hex(fnv(key), 8)}  → mod ${NB} = bucket ${b}`, SX + 20, 150, { size: 24, color: C.yellow });
  const buckets = Array.from({ length: NB }, () => []); S.rows.forEach((r) => buckets[fnv(String(r.id)) % NB].push(r)); const cmp = [];
  buckets.forEach((bk, i) => { const y = 190 + i * 70, hitB = i === b; box(g, SX + 20, y, 120, 56, hitB ? '#2b4a7a' : '#1d2745', hitB ? '#fff' : C.line, 6, hitB ? 4 : 1.5); mono(g, `[${i}]`, SX + 80, y + 28, { size: 26, align: 'center' });
    bk.slice(0, 7).forEach((r, j) => { const x = SX + 160 + j * 150, isT = r === tgt; if (hitB && j <= bk.indexOf(tgt)) cmp.push(r); arrow(g, x - 20, y + 28, x, y + 28, C.dim, 2); box(g, x, y, 130, 56, isT ? 'rgba(158,206,106,0.4)' : 'rgba(10,14,28,0.7)', isT ? C.green : C.line, 6, isT ? 3 : 1.5); mono(g, `${r.id}→${ridS(r)}`, x + 65, y + 28, { size: 21, align: 'center' }); });
    if (bk.length === 0) text(g, 'empty', SX + 170, y + 28, { size: 20, color: C.dim }); });
  const max = Math.max(...buckets.map((x) => x.length)), cols = buckets.filter((x) => x.length > 1).length;
  mono(g, `${NR} keys/${NB} buckets · longest chain ${max} · probe compared ${cmp.length} key(s)`, SX + 20, 770, { size: 24, color: C.green });
  if (S.width > 0) { box(g, SX + 700, 120, 520, 56, 'rgba(247,118,142,0.2)', C.red, 6); text(g, `range price ${lo()}‥${hi()}: NOT SUPPORTED`, SX + 960, 148, { size: 22, color: C.red, align: 'center', weight: '700' }); }
  stats(g, { lines: ['+ point lookup in O(1): 1 bucket read + 1 heap read; tiny CPU cost', '- no range, no ORDER BY, no prefix: hash destroys key order; table growth needs rehash (extendible / linear hashing, e.g. PostgreSQL hash index, MySQL MEMORY, adaptive hash index in InnoDB)', '- chains/overflow pages degrade as load factor rises; skewed keys pile into few buckets'] });
  return new Set([tgt.i]);
}
function drawBitmap(g) {
  const sel = (dim, v) => S.rows.map((r) => (r[dim] === v ? 1 : 0));
  const a = sel('city', S.city), b = sel('status', S.status), res = a.map((x, i) => (S.op === 'AND' ? x & b[i] : x | b[i]));
  text(g, `Bitmap index: city ${S.op === 'AND' ? '=' : '='} '${S.city}' ${S.op} status = '${S.status}'`, SX + 20, 108, { size: 28, weight: '700' });
  const cw = 36, x0 = SX + 190; const all = [...CITY.map((c) => ['city', c]), ...STAT.map((c) => ['status', c])];
  text(g, 'bit i = row i (heap order)', x0, 146, { size: 20, color: C.dim });
  all.forEach(([d, v], ri) => { const y = 160 + ri * 38, bits = sel(d, v), isSel = (d === 'city' ? v === S.city : v === S.status);
    mono(g, `${v}`, x0 - 12, y + 16, { size: 22, align: 'right', color: isSel ? C.yellow : C.fg, weight: isSel ? '700' : '' });
    mono(g, `${bits.reduce((p, q) => p + q, 0)}`, x0 + NR * cw + 6, y + 16, { size: 20, color: C.dim });
    for (let i = 0; i < NR; i++) { const x = x0 + i * cw; box(g, x + 1, y, cw - 2, 32, bits[i] ? PAL[ri % 8] + '88' : '#141b32', isSel && bits[i] ? '#fff' : C.line, 3, isSel && bits[i] ? 2.5 : 1); mono(g, bits[i], x + cw / 2, y + 16, { size: 19, align: 'center', color: bits[i] ? '#fff' : C.dim }); } });
  const ry = 160 + 8 * 38; line(g, x0, ry - 3, x0 + NR * cw, ry - 3, C.yellow, 3);
  mono(g, `${S.op}`, x0 - 100, ry - 8, { size: 24, align: 'right', color: C.yellow, weight: '700' });
  mono(g, 'result', x0 - 12, ry + 16, { size: 22, align: 'right', color: C.green, weight: '700' });
  for (let i = 0; i < NR; i++) { const x = x0 + i * cw; box(g, x + 1, ry, cw - 2, 32, res[i] ? C.green + 'aa' : '#141b32', res[i] ? C.green : C.line, 3, 1.5); mono(g, res[i], x + cw / 2, ry + 16, { size: 19, align: 'center', color: res[i] ? '#fff' : C.dim }); }
  const pc = res.reduce((p, q) => p + q, 0), hl = new Set(res.map((x, i) => (x ? i : -1)).filter((i) => i >= 0));
  mono(g, `popcount = ${pc} matches; bitwise ${S.op} of ${Math.ceil(NR / 64)} machine word(s): ${NR} rows evaluated in 1 instruction`, SX + 20, ry + 60, { size: 21, color: C.green });
  mono(g, `index size: ${all.length} bitmaps × ${NR} bits = ${Math.ceil(all.length * NR / 8)} B  (cardinality × rows / 8; WAH/Roaring compress runs)`, SX + 20, ry + 92, { size: 21, color: C.dim });
  stats(g, { lines: ['+ low-cardinality columns; multi-column AND/OR/NOT in a few CPU words; COUNT(*) without touching the heap; great for OLAP/warehouse (Oracle, Pilosa, Lucene filters as Roaring)', '- size grows with cardinality (1 bitmap per distinct value) and a single row update locks/rewrites whole bitmap pages: bad for OLTP; PostgreSQL builds them on the fly (Bitmap Heap Scan from btrees)'] });
  return hl;
}
function drawZone(g) {
  const B = 4, blocks = []; for (let i = 0; i < NR; i += B) blocks.push(S.rows.slice(i, i + B));
  const L = lo(), H = hi();
  text(g, `Zone map: min/max per ${B}-row block · predicate price ${L}‥${H}${S.width === 0 ? '' : ''}`, SX + 20, 108, { size: 28, weight: '700' });
  text(g, S.cluster ? 'table clustered by price (sorted)' : 'table in arrival order (random prices)', SX + 20, 146, { size: 24, color: S.cluster ? C.green : C.yellow });
  const sc = 1000 / 1000; let scanned = 0; const hl = new Set(); const axX = SX + 120, axW = 1060;
  line(g, axX, 235, axX + axW, 235, C.dim, 2); [0, 250, 500, 750, 1000].forEach((v) => mono(g, v, axX + v / 1000 * axW, 255, { size: 18, align: 'center', color: C.dim }));
  box(g, axX + L / 1000 * axW, 190, Math.max(4, (H - L) / 1000 * axW), 45, 'rgba(224,175,104,0.35)', C.yellow, 4, 2); text(g, 'predicate', axX + (L + H) / 2 / 1000 * axW, 175, { size: 20, color: C.yellow, align: 'center' });
  blocks.forEach((bl, i) => { const mn = Math.min(...bl.map((r) => r.price)), mx = Math.max(...bl.map((r) => r.price)), skip = mx < L || mn > H, y = 290 + i * 62;
    if (!skip) { scanned++; bl.forEach((r) => { if (r.price >= L && r.price <= H) hl.add(r.i); }); }
    mono(g, `blk${i}`, SX + 70, y + 24, { size: 22, align: 'right' });
    box(g, axX + mn / 1000 * axW, y + 4, Math.max(6, (mx - mn) / 1000 * axW), 40, skip ? 'rgba(247,118,142,0.3)' : 'rgba(158,206,106,0.4)', skip ? C.red : C.green, 5, 2.5);
    mono(g, `${mn}‥${mx}  ${skip ? 'SKIP' : 'SCAN'}`, Math.min(axX + (mx / 1000) * axW + 14, SX + SW - 230), y + 26, { size: 22, color: skip ? C.red : C.green });
    if (S.cluster === false) { } });
  mono(g, `blocks scanned ${scanned}/${blocks.length}  → rows read ${scanned * B}/${NR}  ·  matches ${hl.size}`, SX + 20, 740, { size: 24, color: scanned < blocks.length ? C.green : C.yellow });
  stats(g, { lines: ['+ tiny (2 numbers/block), free to maintain at load, no per-row index entries; the basis of Parquet/ORC/ClickHouse sparse indexes, Snowflake micro-partitions, BRIN', '- only works if data is physically clustered by the column: toggle “cluster by price” off and every block spans ~50‥950 so nothing is skipped; useless for point lookups in unsorted data'] });
  return hl;
}
function drawBloom(g) {
  const n = NR, m = n * S.bpk, kopt = Math.max(1, Math.round(S.bpk * Math.LN2)), k = S.k || kopt;
  const bits = new Uint8Array(m); S.rows.forEach((r) => bloomPos('id:' + r.id, m, k).forEach((p) => (bits[p] = 1)));
  const key = 'id:' + S.bloomKey, pos = bloomPos(key, m, k), present = S.bloomKey <= NR, allSet = pos.every((p) => bits[p]);
  text(g, `Bloom filter: ${n} keys, m = ${m} bits (${S.bpk} bits/key), k = ${k} hash functions${k === kopt ? ' (optimal)' : ` (optimal ${kopt})`}`, SX + 20, 108, { size: 26, weight: '700' });
  const per = 32, cell = 36, gx = SX + 20, gy = 190, RP = 38; // drawn over the 3D grid
  const ones = bits.reduce((p, q) => p + q, 0);
  const rowsN = Math.ceil(m / per);
  for (let r = 0; r < Math.min(rowsN, 14); r++) mono(g, r * per, gx - 6, gy + r * RP + 14, { size: 14, align: 'right', color: C.dim });
  pos.forEach((p, i) => { const r = Math.floor(p / per), c = p % per; if (r < 14) box(g, gx + c * cell - 1, gy + r * RP - 1, cell + 2, RP, null, i % 2 ? C.orange : C.red, 4, 3.5); });
  mono(g, `probe "${key}" (${present ? 'inserted' : 'never inserted'}): bits ${pos.slice(0, 8).join(', ')}${pos.length > 8 ? '…' : ''}`, SX + 20, 150, { size: 22, color: C.yellow });
  const vy = gy + Math.min(rowsN, 14) * RP + 18;
  box(g, SX + 20, vy, 700, 54, allSet ? (present ? 'rgba(158,206,106,0.25)' : 'rgba(247,118,142,0.25)') : 'rgba(122,162,247,0.2)', allSet ? (present ? C.green : C.red) : C.blue, 8);
  text(g, allSet ? (present ? 'all k bits set → "maybe" (true positive)' : 'all k bits set → "maybe" = FALSE POSITIVE') : 'a bit is 0 → "definitely not present"', SX + 370, vy + 27, { size: 24, align: 'center', weight: '700' });
  const th = Math.pow(1 - Math.exp(-k * n / m), k);
  if (!S.fp || S.fp.m !== m || S.fp.k !== k) { let fp = 0; const T = 5000; for (let i = 0; i < T; i++) { const q = 'x:' + (i * 2654435761 % 1000003) + ':' + i; if (bloomPos(q, m, k).every((p) => bits[p])) fp++; } S.fp = { m, k, rate: fp / T, T }; }
  mono(g, `bits set: ${ones}/${m} = ${(100 * ones / m).toFixed(0)}%   measured FPR over ${S.fp.T} absent keys: ${(100 * S.fp.rate).toFixed(2)}%`, SX + 20, vy + 90, { size: 23, color: C.green });
  mono(g, `theory (1−e^(−kn/m))^k = ${(100 * th).toFixed(2)}%    optimal k = (m/n)·ln2 = ${(S.bpk * Math.LN2).toFixed(1)}`, SX + 20, vy + 124, { size: 23, color: C.cyan });
  // fpr bar
  box(g, SX + 740, vy, 440, 54, '#141b32', C.line, 6); box(g, SX + 740, vy, Math.max(3, Math.min(1, S.fp.rate * 4) * 440), 54, C.orange + 'aa', null, 6); mono(g, `FPR ${(100 * S.fp.rate).toFixed(1)}%`, SX + 960, vy + 27, { size: 24, align: 'center' });
  stats(g, { lines: ['+ ~10 bits/key gives ≈1% false positives, k≈7; no false negatives; O(k) probes, all in memory; cannot delete (use counting/cuckoo filters)', '- answers only “maybe in set?”: no range, no key→RID mapping. Used to skip SSTables in LSM trees (RocksDB: 10 bits/key, one filter per SST/block), to skip Parquet row groups, and in hash-join semi-join pushdown'] });
  return new Set(S.rows.filter((r) => 'id:' + r.id === key).map((r) => r.i));
}
function drawInv(g) {
  const idx = {}; S.rows.forEach((r) => r.tags.forEach((w) => (idx[w] = idx[w] || []).push(r.id)));
  const terms = Object.keys(idx).sort(), A = idx[S.t1] || [], B = idx[S.t2] || [];
  text(g, `Inverted index on tags: "${S.t1}" ${S.op} "${S.t2}"`, SX + 20, 108, { size: 28, weight: '700' });
  text(g, 'term dictionary (sorted)  →  posting list (doc ids, stored as delta gaps)', SX + 20, 146, { size: 22, color: C.dim });
  terms.forEach((t, i) => { const y = 168 + i * 40, sel = t === S.t1 || t === S.t2; const pl = idx[t]; mono(g, t, SX + 150, y + 18, { size: 24, align: 'right', color: sel ? (t === S.t1 ? C.yellow : C.cyan) : C.fg, weight: sel ? '700' : '' });
    mono(g, `df=${pl.length}`, SX + 168, y + 18, { size: 18, color: C.dim });
    pl.forEach((d, j) => { const x = SX + 250 + j * 52; if (x > SX + SW - 40) return; box(g, x, y + 2, 48, 32, sel ? (t === S.t1 ? C.yellow + '55' : C.cyan + '55') : '#141b32', C.line, 4, 1); mono(g, d, x + 24, y + 18, { size: 20, align: 'center' }); });
    mono(g, 'gaps ' + pl.map((d, j) => (j ? d - pl[j - 1] : d)).slice(0, 12).join(','), SX + 250 + 52 * Math.min(pl.length, 12) + 6, y + 18, { size: 16, color: C.dim }); });
  const merged = []; let i = 0, j = 0, cmp = 0;
  if (S.op === 'AND') { while (i < A.length && j < B.length) { cmp++; if (A[i] === B[j]) { merged.push(A[i]); i++; j++; } else if (A[i] < B[j]) i++; else j++; } }
  else { merged.push(...new Set([...A, ...B])); merged.sort((x, y) => x - y); cmp = A.length + B.length; }
  const my = 168 + terms.length * 40 + 20;
  mono(g, `${S.op === 'AND' ? 'merge-intersect' : 'merge-union'}: ${cmp} comparison(s) on lists of ${A.length} and ${B.length}  →  ${merged.length} doc(s): ${merged.join(' ')}`, SX + 20, my, { size: 21, color: C.green });
  stats(g, { lines: ['+ text / array / JSON containment (@>, LIKE \'%x%\' via trigrams), multi-term AND/OR by sorted-list merge in O(|A|+|B|) (skip pointers/galloping make it sublinear), gap+varint or Roaring compression, scoring (TF-IDF / BM25) from df and positions', '- write-amplifying: one document adds an entry to every term (Postgres GIN uses a pending list; Lucene uses immutable segments + merge); no ordering by column value'] });
  return new Set(merged.map((d) => S.rows.findIndex((r) => r.id === d)));
}

function draw() {
  const P = inst.P, g = P.g; P.clear();
  text(g, `Secondary index · ${ONAME[S.opt]}`, 30, 36, { size: 36, weight: '700' });
  const B = inst.B; B.mesh.visible = S.opt === 'bloom'; inst.M.mesh.visible = S.opt === 'bitmap';
  const fn = { btree: drawBtree, hash: drawHash, bitmap: drawBitmap, 'zonemap-minmax': drawZone, bloom: drawBloom, inverted: drawInv }[S.opt];
  box(g, SX - 10, 80, SW + 20, 760, S.opt === 'bloom' || S.opt === 'bitmap' ? null : 'rgba(18,24,41,0.88)', C.line, 10);
  const tmp = []; const hl = fn(g);
  drawTable(g, hl, S.opt !== 'zonemap-minmax' && S.opt !== 'bloom' || true, S.opt === 'inverted');
  paint3D();
  P.done();
}
function paint3D() {
  if (S.opt === 'bloom') {
    const n = NR, m = n * S.bpk, kopt = Math.max(1, Math.round(S.bpk * Math.LN2)), k = S.k || kopt, bits = new Uint8Array(m);
    S.rows.forEach((r) => bloomPos('id:' + r.id, m, k).forEach((p) => (bits[p] = 1)));
    const pos = new Set(bloomPos('id:' + S.bloomKey, m, k));
    for (let i = 0; i < 32 * 14; i++) { if (i >= m) inst.B.set(i, '#0e1424', 0.05); else inst.B.set(i, pos.has(i) ? (bits[i] ? C.red : C.blue) : bits[i] ? C.green : '#1e2848', bits[i] ? 1.6 : 0.3); }
    inst.B.commit();
  } else if (S.opt === 'bitmap') {
    const all = [...CITY.map((c) => ['city', c]), ...STAT.map((c) => ['status', c])];
    for (let r = 0; r < 9; r++) for (let c = 0; c < NR; c++) { const i = r * NR + c; let bit; if (r < 8) bit = S.rows[c][all[r][0]] === all[r][1]; else { const a = S.rows[c].city === S.city, b = S.rows[c].status === S.status; bit = S.op === 'AND' ? a && b : a || b; }
      inst.M.set(i, bit ? PAL[r % 8] : '#1a2238', bit ? 1.5 : 0.2); }
    inst.M.commit();
  }
}
export const views = {
  'secondary-index': {
    build(ctx) {
      S.opt = opt(ctx.config, 'secondary-index', 'btree'); gen(); S.fp = null;
      const sc = scaffold(), P = panel(20, 12, 100, { depthWrite: false }); P.mesh.position.z = 1.0; sc.group.add(P.mesh);
      const B = cellGrid(32, 14, 0.36, 0.38, 0.2); B.mesh.position.set(-10 + (SX + 20) / 100, 6 - 1.9, 0); sc.group.add(B.mesh);
      const M = cellGrid(NR, 9, 0.36, 0.38, 0.2); M.mesh.position.set(-10 + (SX + 190) / 100, 6 - 1.6, -0.3); M.mesh.visible = false; sc.group.add(M.mesh);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(20.2, 12.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x0e1424 })); slab.position.z = -0.4; sc.group.add(slab);
      inst = { P, B, M };
      const go = (o) => { S.opt = o; S.dirty = true; };
      const steps = [
        { title: 'B+tree', text: 'Ordered (key → RID) entries; point and range; each match costs a random heap read.', run() { go('btree'); } },
        { title: 'Hash', text: 'Bucket = hash(key) mod N: one probe for equality, but no ranges.', run() { go('hash'); } },
        { title: 'Bitmap AND/OR', text: 'One bit-vector per distinct value; predicates combine with bitwise ops.', run() { go('bitmap'); } },
        { title: 'Zone map', text: 'Min/max per block; prunes blocks only if the data is clustered.', run() { go('zonemap-minmax'); } },
        { title: 'Zone map needs clustering', text: 'Cluster the table by price and the same predicate skips most blocks.', run() { S.cluster = true; gen(); go('zonemap-minmax'); S.width = 60; } },
        { title: 'Bloom filter', text: 'k bits per key; “definitely not” or “maybe”. Slide bits/key and k to see the false-positive rate move.', run() { go('bloom'); } },
        { title: 'Inverted index', text: 'term → sorted posting list; AND = list intersection.', run() { go('inverted'); } },
      ];
      return {
        group: sc.group, steps,
        update() { if (S.dirty) { S.dirty = false; draw(); } },
        onConfigChange(cfg) { S.opt = opt(cfg, 'secondary-index', 'btree'); S.dirty = true; },
        dispose() { sc.dispose(); P.dispose(); B.dispose(); M.dispose(); slab.geometry.dispose(); slab.material.dispose(); inst = null; },
      };
    },
    controls: [
      { id: 'opt', label: 'index type (also the secondary-index slot)', type: 'select', options: OPTS, value: 'btree', onChange: (v) => { S.opt = v; S.dirty = true; } },
      { id: 'probe', label: 'probe key position (btree/hash/zonemap price, hash id)', type: 'range', min: 0, max: 100, value: 40, onChange: (v) => { S.probe = v; S.dirty = true; } },
      { id: 'width', label: 'range width in price (0 = point lookup)', type: 'range', min: 0, max: 400, step: 10, value: 120, onChange: (v) => { S.width = v; S.dirty = true; } },
      { id: 'cluster', label: 'cluster table by price (zone map)', type: 'toggle', value: false, onChange: (v) => { S.cluster = v; gen(); S.dirty = true; } },
      { id: 'city', label: 'bitmap: city', type: 'select', options: CITY, value: 'BKK', onChange: (v) => { S.city = v; S.dirty = true; } },
      { id: 'status', label: 'bitmap: status', type: 'select', options: STAT, value: 'open', onChange: (v) => { S.status = v; S.dirty = true; } },
      { id: 'op', label: 'combine: AND / OR', type: 'select', options: ['AND', 'OR'], value: 'AND', onChange: (v) => { S.op = v; S.dirty = true; } },
      { id: 'bpk', label: 'bloom: bits per key (m = n × bpk)', type: 'range', min: 2, max: 16, value: 8, onChange: (v) => { S.bpk = v; S.fp = null; S.dirty = true; } },
      { id: 'k', label: 'bloom: hash functions k (0 = optimal)', type: 'range', min: 0, max: 12, value: 0, onChange: (v) => { S.k = v; S.fp = null; S.dirty = true; } },
      { id: 'bkey', label: 'bloom: probe id (1-28 present, >28 absent)', type: 'range', min: 1, max: 60, value: 12, onChange: (v) => { S.bloomKey = v; S.dirty = true; } },
      { id: 't1', label: 'inverted: term 1', type: 'select', options: WORDS, value: 'beach', onChange: (v) => { S.t1 = v; S.dirty = true; } },
      { id: 't2', label: 'inverted: term 2', type: 'select', options: WORDS, value: 'spa', onChange: (v) => { S.t2 = v; S.dirty = true; } },
    ],
  },
};
