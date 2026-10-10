// compression: live encoders over an editable 32-value column; sizes in real bytes; operate-on-compressed demo.
import * as THREE from 'three';
import { C, panel, box, text, mono, line, para, hex, rng, cellGrid, scaffold, opt, ascii } from './_kitD.js';

const N = 32, CTRY = ['TH', 'SG', 'JP', 'VN', 'ID', 'MY', 'PH', 'KR'];
const SCHEMES = ['none', 'dictionary', 'for-bitpack', 'delta', 'rle', 'lz4-zstd'];
const SNAME = { none: 'none (plain)', dictionary: 'dictionary', 'for-bitpack': 'FOR + bit-packing', delta: 'delta (zigzag + pack)', rle: 'run-length (RLE)', 'lz4-zstd': 'LZ4 / zstd (block)' };
const PAL = [C.blue, C.purple, C.yellow, C.green, C.orange, C.pink, C.cyan, '#c3e88d'];
const S = { preset: 'country', p: 4, seed: 3, vals: [], scheme: 'dictionary', pred: 40, dirty: true, outlier: false };
let inst = null;
const bitsW = (m) => (m <= 0 ? 0 : 32 - Math.clz32(m));       // bits needed to represent m
const pack = (arr, w) => { const bits = []; for (const x of arr) for (let k = w - 1; k >= 0; k--) bits.push((x >>> k) & 1); return bits; };
const zz = (d) => ((d << 1) ^ (d >> 31)) >>> 0;
const isStr = () => typeof S.vals[0] === 'string';
const vsz = () => (isStr() ? 2 : 4);

function gen() {
  const r = rng(S.seed * 7919 + 1), v = [];
  if (S.preset === 'country') { const d = Math.max(2, Math.min(8, S.p)); for (let i = 0; i < N; i++) v.push(CTRY[Math.floor(Math.pow(r(), 1.6) * d)]); }
  else if (S.preset === 'timestamps') { let t = 1700000000; for (let i = 0; i < N; i++) { t += 1 + Math.floor(r() * S.p * 3); v.push(t); } }
  else if (S.preset === 'sensor') { for (let i = 0; i < N; i++) v.push(1000 + Math.floor(r() * S.p * 12)); }
  else if (S.preset === 'status') { let cur = 0, left = 0; for (let i = 0; i < N; i++) { if (left <= 0) { cur = Math.floor(r() * 3); left = 1 + Math.floor(r() * S.p * 2); } v.push(cur); left--; } }
  else for (let i = 0; i < N; i++) v.push((Math.floor(r() * 0x7fffffff)) >>> 0);
  S.vals = v;
}
const toBytes = () => { const o = []; for (const x of S.vals) { if (typeof x === 'string') o.push(...ascii(x)); else o.push(x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255); } return o; };

function lz4(bytes) {
  const seqs = [], tbl = new Map(); let i = 0, lit = [];
  while (i < bytes.length) {
    let best = 0, off = 0;
    if (i + 4 <= bytes.length) { const key = bytes.slice(i, i + 4).join(','); const c = tbl.get(key); if (c !== undefined && i - c <= 65535) { let l = 0; while (i + l < bytes.length && bytes[c + l] === bytes[i + l]) l++; if (l >= 4) { best = l; off = i - c; } } tbl.set(key, i); }
    if (best >= 4) { seqs.push({ lit, off, len: best }); lit = []; i += best; } else { lit.push(bytes[i]); i++; }
  }
  seqs.push({ lit, off: 0, len: 0 });
  let size = 0; for (const s of seqs) { size += 1 + s.lit.length; if (s.lit.length >= 15) size += Math.ceil((s.lit.length - 14) / 255); if (s.len) { size += 2; if (s.len - 4 >= 15) size += Math.ceil((s.len - 18) / 255); } }
  return { seqs, size };
}

function encodeAll() {
  const v = S.vals, str = isStr(), e = {}, raw = N * vsz();
  e.none = { size: raw };
  const dist = [...new Set(v)].sort((a, b) => (str ? (a < b ? -1 : 1) : a - b)); const w = Math.max(1, bitsW(dist.length - 1)), codes = v.map((x) => dist.indexOf(x));
  e.dictionary = { dist, w, codes, bits: pack(codes, w), size: dist.length * vsz() + Math.ceil(N * w / 8) };
  if (!str) {
    const mn = Math.min(...v), mx = Math.max(...v), offs = v.map((x) => x - mn), wf = Math.max(1, bitsW(mx - mn));
    const sorted = offs.slice().sort((a, b) => a - b), w95 = Math.max(1, bitsW(sorted[Math.floor(N * 0.9) - 1])), exc = offs.filter((o) => bitsW(o) > w95).length;
    const patched = 4 + 1 + Math.ceil(N * w95 / 8) + exc * 5, plain = 4 + 1 + Math.ceil(N * wf / 8);
    e['for-bitpack'] = { mn, offs, w: wf, w95, exc, bits: pack(offs, wf), size: Math.min(plain, patched), plain, patched };
    const d = v.map((x, i) => (i ? x - v[i - 1] : 0)), z = d.map((x, i) => (i ? zz(x) : 0)), wd = Math.max(1, bitsW(Math.max(...z)));
    e.delta = { first: v[0], d, z, w: wd, bits: pack(z.slice(1), wd), size: 4 + 1 + Math.ceil((N - 1) * wd / 8) };
  } else { e['for-bitpack'] = null; e.delta = null; }
  const runs = []; for (const x of v) { const l = runs[runs.length - 1]; if (l && l.v === x) l.n++; else runs.push({ v: x, n: 1 }); }
  e.rle = { runs, size: runs.length * (vsz() + 1) };
  const L = lz4(toBytes()); e['lz4-zstd'] = { seqs: L.seqs, size: Math.min(L.size, raw + Math.ceil(raw / 255) + 16) };
  return e;
}

function drawBits(g, bits, x, y, w, group, cell = 24, maxLines = 5) {
  const per = Math.floor(1130 / cell / group) * group || 32; let ln = 0;
  for (let i = 0; i < bits.length; i++) {
    const c = i % per; ln = Math.floor(i / per); if (ln >= maxLines) { text(g, `… ${bits.length - i} more bits`, x, y + maxLines * (cell + 6), { size: 20, color: C.dim }); return; }
    const gi = Math.floor(i / group), bx = x + c * cell + Math.floor(c / group) * 4, by = y + ln * (cell + 6), col = PAL[gi % PAL.length];
    box(g, bx, by, cell - 1, cell, bits[i] ? col + 'cc' : '#171e36', col, 2, 1); mono(g, bits[i], bx + cell / 2, by + cell / 2, { size: 15, color: bits[i] ? '#06101a' : C.dim, align: 'center' });
  }
}
const fmt = (x) => (typeof x === 'string' ? x : String(x));

function draw() {
  const P = inst.P, g = P.g, e = S.__e = encodeAll(), v = S.vals, str = isStr(), sch = S.scheme, raw = N * vsz();
  P.clear();
  text(g, `Compression · slot scheme: ${SNAME[sch]}`, 30, 34, { size: 36, weight: '700' });
  // raw
  text(g, `raw column (${N} values × ${vsz()} B = ${raw} B)  preset: ${S.preset}`, 30, 80, { size: 24, color: C.cyan, weight: '700' });
  const cellW = 66;
  v.forEach((x, i) => { const cx = 30 + (i % 16) * (cellW + 4), cy = 100 + Math.floor(i / 16) * 46; box(g, cx, cy, cellW, 40, '#171e36', C.line, 4, 1); mono(g, str ? x : (x > 99999 ? String(x).slice(-5) + '' : x), cx + cellW / 2, cy + 20, { size: x > 99999 ? 18 : 21, align: 'center' }); });
  if (!str && Math.max(...v) > 99999) text(g, '(showing last 5 digits)', 30, 202, { size: 18, color: C.dim });
  // summary
  const cur = e[sch], size = cur ? cur.size : null, ratio = size ? raw / size : null;
  box(g, 1180, 70, 800, 160, 'rgba(18,24,41,0.88)', C.line, 10);
  if (size) { mono(g, `${raw} B  →  ${size} B`, 1200, 108, { size: 40, weight: '700', color: size < raw ? C.green : C.yellow }); mono(g, `ratio ${ratio.toFixed(2)}×  ·  ${(size * 8 / N).toFixed(1)} bits/value`, 1200, 160, { size: 28 }); }
  else text(g, 'not applicable to string data (needs integers)', 1200, 120, { size: 28, color: C.red });
  text(g, sch === 'none' ? 'plain: fixed width, random access, no CPU decode' : sch === 'lz4-zstd' ? 'general-purpose: must decompress the whole block' : 'lightweight: decode in-register, often SIMD', 1200, 200, { size: 22, color: C.dim });
  // body
  const BY = 250; box(g, 20, BY, 1150, 540, 'rgba(18,24,41,0.88)', C.line, 10);
  const X0 = 40; let y = BY + 34;
  if (sch === 'none') { text(g, 'No encoding: each value stored at fixed width.', X0, y, { size: 28, weight: '700' }); mono(g, `value i is at byte i × ${vsz()}  → O(1) random access, no CPU decode`, X0, y + 50, { size: 24 }); mono(g, 'bytes: ' + toBytes().slice(0, 24).map((b) => hex(b)).join(' ') + ' …', X0, y + 100, { size: 24, color: C.dim }); para(g, 'Everything else on this screen trades CPU for fewer bytes read from disk / memory-bandwidth. Compare in the bar chart.', X0, y + 150, 1080, { size: 24, color: C.dim }); }
  else if (sch === 'dictionary') {
    const c = e.dictionary; text(g, `Dictionary: ${c.dist.length} distinct → code width w = ceil(log2 ${c.dist.length}) = ${c.w} bit${c.w > 1 ? 's' : ''}`, X0, y, { size: 28, weight: '700' });
    c.dist.slice(0, 8).forEach((d, i) => { const x = X0 + (i % 8) * 134; box(g, x, y + 28, 128, 46, '#171e36', PAL[i % PAL.length], 5, 2); mono(g, `${i.toString(2).padStart(c.w, '0')}→${str ? d : String(d).slice(-6)}`, x + 64, y + 51, { size: 22, align: 'center' }); });
    if (c.dist.length > 8) text(g, `… ${c.dist.length - 8} more dictionary entries`, X0 + 8 * 134 - 160, y + 100, { size: 20, color: C.dim });
    text(g, 'codes (stored instead of values):', X0, y + 112, { size: 24, color: C.dim });
    c.codes.forEach((k, i) => { const x = X0 + (i % 16) * 70, yy = y + 134 + Math.floor(i / 16) * 36; box(g, x, yy, 64, 32, PAL[k % PAL.length] + '55', PAL[k % PAL.length], 4, 1.5); mono(g, k.toString(2).padStart(c.w, '0'), x + 32, yy + 16, { size: 20, align: 'center' }); });
    text(g, `bit-packed stream: ${N} × ${c.w} = ${N * c.w} bits = ${Math.ceil(N * c.w / 8)} B`, X0, y + 232, { size: 24, color: C.dim });
    drawBits(g, c.bits, X0, y + 256, c.w, 16 < 1 ? 1 : c.w, 24, 4);
    mono(g, `size = dict ${c.dist.length}×${vsz()} B + codes ${Math.ceil(N * c.w / 8)} B = ${c.size} B`, X0, y + 420, { size: 25, color: C.green });
    para(g, 'Dictionary is per column chunk; codes can be compared/hashed/grouped without touching the strings. Order-preserving (sorted) dictionary even allows range predicates on codes.', X0, y + 450, 1080, { size: 22, lh: 28, color: C.dim });
  } else if (sch === 'for-bitpack') {
    const c = e['for-bitpack']; if (!c) { text(g, 'FOR needs integers; strings are dictionary-encoded first.', X0, y, { size: 28, color: C.red }); }
    else {
      text(g, `Frame of reference: ref = min = ${c.mn}; store v − ref in ${c.w} bits`, X0, y, { size: 28, weight: '700' });
      mono(g, `max offset = ${Math.max(...c.offs)}  → w = ceil(log2(${Math.max(...c.offs)}+1)) = ${c.w} bits (vs 32)`, X0, y + 40, { size: 24, color: C.yellow });
      c.offs.forEach((k, i) => { const x = X0 + (i % 16) * 70, yy = y + 70 + Math.floor(i / 16) * 36; box(g, x, yy, 64, 32, '#171e36', C.line, 4, 1); mono(g, k > 9999 ? '…' + String(k).slice(-4) : k, x + 32, yy + 16, { size: 20, align: 'center' }); });
      text(g, `packed: ${N}×${c.w} = ${N * c.w} bits`, X0, y + 164, { size: 24, color: C.dim });
      drawBits(g, c.bits, X0, y + 188, c.w, c.w, c.w > 12 ? 14 : 24, 4);
      mono(g, `size = ref 4 B + width 1 B + ${Math.ceil(N * c.w / 8)} B = ${c.plain} B`, X0, y + 372, { size: 25, color: C.green });
      mono(g, `PFOR: w=${c.w95} + ${c.exc} exception(s)×5 B → ${c.patched} B ${c.patched < c.plain ? '(chosen)' : '(not worth it)'}`, X0, y + 410, { size: 23, color: c.patched < c.plain ? C.orange : C.dim });
      para(g, 'Use “append outlier”: one huge value raises w for the whole block, which is why Parquet/Lucene/Velox use per-block widths (128–1024 values) or PFOR exceptions.', X0, y + 440, 1080, { size: 22, lh: 28, color: C.dim });
    }
  } else if (sch === 'delta') {
    const c = e.delta; if (!c) text(g, 'Delta needs integers.', X0, y, { size: 28, color: C.red });
    else {
      text(g, `Delta: first = ${c.first}; then v[i] − v[i−1], zigzag, bit-pack`, X0, y, { size: 28, weight: '700' });
      c.d.forEach((k, i) => { if (!i) return; const x = X0 + ((i - 1) % 16) * 70, yy = y + 34 + Math.floor((i - 1) / 16) * 36; box(g, x, yy, 64, 32, '#171e36', k < 0 ? C.red : C.line, 4, 1); mono(g, (k < 0 ? '' : '+') + (Math.abs(k) > 9999 ? '…' : k), x + 32, yy + 16, { size: 20, align: 'center' }); });
      mono(g, `zigzag: −1,+1,−2 → 1,2,3 keeps negatives small. max=${Math.max(...c.z)} → w=${c.w} bits`, X0, y + 128, { size: 22, color: C.yellow });
      drawBits(g, c.bits, X0, y + 166, c.w, c.w, c.w > 12 ? 14 : 24, 4);
      mono(g, `size = first 4 B + width 1 B + ${N - 1}×${c.w} bits (${Math.ceil((N - 1) * c.w / 8)} B) = ${c.size} B`, X0, y + 372, { size: 24, color: C.green });
      para(g, 'Great for sorted/monotonic data (timestamps, ids). Cost: decoding value i needs a prefix sum of all earlier deltas, so blocks restart every ~128 values.', X0, y + 410, 1080, { size: 22, lh: 28, color: C.dim });
    }
  } else if (sch === 'rle') {
    const c = e.rle; text(g, `RLE: ${c.runs.length} runs from ${N} values  ·  each run = (value ${vsz()} B, length 1 B)`, X0, y, { size: 28, weight: '700' });
    let px = X0; const unit = 1060 / N;
    c.runs.forEach((r, i) => { const wdt = r.n * unit; box(g, px, y + 34, wdt - 3, 56, PAL[i % PAL.length] + '77', PAL[i % PAL.length], 4, 2); if (wdt > 40) mono(g, `${fmt(r.v).slice(-5)}×${r.n}`, px + wdt / 2, y + 62, { size: Math.min(22, wdt / 3.2), align: 'center' }); px += wdt; });
    c.runs.slice(0, 14).forEach((r, i) => mono(g, `(${fmt(r.v)}, ${r.n})`, X0 + (i % 7) * 156, y + 130 + Math.floor(i / 7) * 36, { size: 22, color: PAL[i % PAL.length] }));
    mono(g, `size = ${c.runs.length} runs × ${vsz() + 1} B = ${c.size} B`, X0, y + 250, { size: 26, color: C.green });
    para(g, 'Wins only when data has long runs: sorted/clustered low-cardinality columns. Try “sort data” on the country preset: runs collapse from ~28 to ≤8. Random order can make RLE larger than raw.', X0, y + 292, 1080, { size: 23, lh: 29, color: C.dim });
  } else {
    const c = e['lz4-zstd']; text(g, `LZ4 block format: sequences of (literals, match offset, length)`, X0, y, { size: 28, weight: '700' });
    c.seqs.slice(0, 7).forEach((s, i) => { const yy = y + 38 + i * 42; mono(g, `#${i} token lit=${s.lit.length}`, X0, yy + 14, { size: 22, color: C.yellow }); mono(g, s.lit.slice(0, 8).map((b) => hex(b)).join(' ') + (s.lit.length > 8 ? '…' : ''), X0 + 270, yy + 14, { size: 22 }); mono(g, s.len ? `match off=${s.off} len=${s.len}` : '(end of block)', X0 + 700, yy + 14, { size: 22, color: s.len ? C.green : C.dim }); });
    mono(g, `${c.seqs.length} sequences → ${c.size} B (raw ${raw} B)`, X0, y + 340, { size: 26, color: C.green });
    para(g, 'LZ4: byte-level LZ77, 4-byte min match, no entropy stage: ~500 MB/s–GB/s decode. zstd = LZ77 + Huffman (literals) + FSE (sequences), +30-50% better ratio, ~2-4× slower to decode. Both are block compressors: a point read or predicate needs the block decompressed first. Typically layered on top of dictionary/FOR in Parquet/ORC/ClickHouse.', X0, y + 372, 1080, { size: 22, lh: 28, color: C.dim });
  }
  // bar chart
  box(g, 1180, 250, 800, 540, 'rgba(18,24,41,0.88)', C.line, 10);
  text(g, 'compressed size on this data (bytes)', 1200, 284, { size: 26, weight: '700' });
  SCHEMES.forEach((s, i) => { const y2 = 320 + i * 72, d = e[s], cur2 = s === sch;
    text(g, SNAME[s], 1200, y2 + 10, { size: 22, color: cur2 ? C.yellow : C.fg, weight: cur2 ? '700' : '' });
    if (!d) { text(g, 'n/a for strings', 1200, y2 + 40, { size: 20, color: C.dim }); return; }
    const w2 = Math.max(4, (d.size / Math.max(raw, d.size)) * 560); box(g, 1200, y2 + 24, w2, 28, cur2 ? C.yellow : C.blue, null, 4); mono(g, `${d.size} B  ${(raw / d.size).toFixed(1)}×`, 1200 + w2 + 10, y2 + 38, { size: 22 });
  });
  // operate on compressed
  const OY = 810; box(g, 20, OY, 1960, 380, 'rgba(18,24,41,0.88)', C.line, 10);
  const dst = e.dictionary.dist, pk = str ? dst[Math.floor(S.pred / 100 * (dst.length - 1) + 0.01)] : null;
  let T = null; if (!str) { const mn = Math.min(...v), mx = Math.max(...v); T = Math.round(mn + (mx - mn) * S.pred / 100); }
  const match = v.map((x) => (str ? x === pk : x >= T)), cnt = match.filter(Boolean).length;
  text(g, `Operate on compressed data: WHERE ${str ? `country = '${pk}'` : `v >= ${T}`}  →  COUNT = ${cnt}`, 40, OY + 32, { size: 30, weight: '700', color: C.cyan });
  let lines = [], touched = N, decoded = 0;
  if (sch === 'dictionary') { const code = dst.indexOf(str ? pk : dst.find((d) => d >= T)); lines = [str ? `1. look up '${pk}' in dictionary once → code ${code.toString(2).padStart(e.dictionary.w, '0')}` : `1. v >= ${T} becomes code >= first dict entry >= ${T} (sorted dictionary)`, `2. compare ${N} ${e.dictionary.w}-bit codes (SIMD: ${Math.floor(512 / e.dictionary.w)} per AVX-512 op)`, '3. no string is ever materialised']; touched = N; decoded = 0; }
  else if (sch === 'for-bitpack' && e['for-bitpack']) { const c = e['for-bitpack']; lines = [`1. rewrite constant: v >= ${T}  ⇒  offset >= ${T - c.mn}  (ref folded into the constant)`, T - c.mn <= 0 ? '2. constant ≤ 0 → every row matches, no data read' : T - c.mn > (2 ** c.w - 1) ? `2. constant > 2^${c.w}−1 → no row can match, block skipped` : `2. compare ${N} ${c.w}-bit offsets directly, no add of ref per row`, '3. values never reconstructed']; decoded = 0; }
  else if (sch === 'delta' && e.delta) { lines = ['1. must prefix-sum the zigzag deltas to know each value', `2. ${N} sequential adds (dependency chain, hard to SIMD)`, '3. block min/max header lets a whole block be skipped without decoding']; decoded = N; }
  else if (sch === 'rle') { const runs = e.rle.runs; const mr = runs.filter((r) => (str ? r.v === pk : r.v >= T)); lines = [`1. test predicate on ${runs.length} run values (not ${N} rows)`, `2. matching runs: ${mr.length}, COUNT += run length = ${mr.reduce((a, r) => a + r.n, 0)}`, `3. SUM would be Σ value × length: ${runs.length} multiplies`]; touched = runs.length; decoded = 0; }
  else if (sch === 'lz4-zstd') { lines = [`1. decompress whole block first: ${raw} B → buffers`, `2. then evaluate predicate on ${N} raw values`, '3. cannot skip inside the block']; decoded = N; }
  else { lines = [`1. scan ${N} raw values`]; decoded = 0; }
  lines.forEach((l, i) => text(g, l, 40, OY + 80 + i * 40, { size: 26 }));
  mono(g, `items examined: ${touched}   values decoded to plain: ${decoded}   bytes read: ${size ?? raw} of ${raw}`, 40, OY + 220, { size: 26, color: decoded ? C.yellow : C.green });
  text(g, 'result bitmap (1 = row matches):', 40, OY + 268, { size: 24, color: C.dim });
  match.forEach((m, i) => { const x = 40 + i * 58; box(g, x, OY + 290, 54, 40, m ? C.green + '88' : '#171e36', m ? C.green : C.line, 4, 1.5); mono(g, m ? 1 : 0, x + 27, OY + 310, { size: 22, align: 'center', color: m ? '#fff' : C.dim }); });
  text(g, 'Late materialisation: decode only the rows that survive.', 40, OY + 352, { size: 22, color: C.dim });
  P.done();
  const G = inst.G; for (let i = 0; i < N; i++) { const bpv = (size || raw) * 8 / N; G.set(i, PAL[i % 8], 0.15 + Math.min(1, bpv / (vsz() * 8)) * 3); } G.commit();
}
function regen() { gen(); S.dirty = true; }
export const views = {
  compression: {
    build(ctx) {
      S.scheme = opt(ctx.config, 'compression', 'dictionary'); regen();
      const sc = scaffold(), P = panel(20, 12, 100, { depthWrite: false }); P.mesh.position.z = 0.9; sc.group.add(P.mesh);
      const G = cellGrid(32, 1, 0.09, 0.5, 0.2); G.mesh.position.set(-10 + 17.0, 6 - 1.3, 0); sc.group.add(G.mesh); // tiny 3D bar strip: height ~ bytes per value
      G.mesh.visible = true;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(20.2, 12.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x0e1424 })); slab.position.z = -0.2; sc.group.add(slab);
      inst = { P, G };
      const steps = [
        { title: 'Raw column', text: 'Fixed-width values: random access, but 32 bits each even when the data needs far fewer.', run() { S.scheme = 'none'; S.dirty = true; } },
        { title: 'Dictionary', text: 'Replace values by small codes; width = ceil(log2 distinct). Best for low cardinality.', run() { S.preset = 'country'; S.p = 4; regen(); S.scheme = 'dictionary'; } },
        { title: 'FOR + bit-packing', text: 'Subtract the block minimum; store residuals in just enough bits.', run() { S.preset = 'sensor'; S.p = 4; regen(); S.scheme = 'for-bitpack'; } },
        { title: 'Delta', text: 'Sorted timestamps become tiny gaps.', run() { S.preset = 'timestamps'; S.p = 4; regen(); S.scheme = 'delta'; } },
        { title: 'RLE', text: 'Runs of repeated values collapse to (value, length).', run() { S.preset = 'status'; S.p = 4; regen(); S.scheme = 'rle'; } },
        { title: 'Compute on compressed data', text: 'Predicates run on codes, packed offsets or run lengths without decoding: bottom panel shows values touched vs decoded.', run() { S.preset = 'country'; regen(); S.scheme = 'dictionary'; S.pred = 30; } },
      ];
      return {
        group: sc.group, steps,
        update() { if (S.dirty) { S.dirty = false; draw(); } },
        onConfigChange(cfg) { S.scheme = opt(cfg, 'compression', 'dictionary'); S.dirty = true; },
        dispose() { sc.dispose(); P.dispose(); G.dispose(); slab.geometry.dispose(); slab.material.dispose(); inst = null; },
      };
    },
    controls: [
      { id: 'scheme', label: 'scheme (also the compression slot)', type: 'select', options: SCHEMES, value: 'dictionary', onChange: (v) => { S.scheme = v; S.dirty = true; } },
      { id: 'preset', label: 'dataset', type: 'select', options: [{ value: 'country', label: 'country codes (strings)' }, { value: 'timestamps', label: 'sorted timestamps' }, { value: 'sensor', label: 'sensor readings' }, { value: 'status', label: 'status with runs' }, { value: 'entropy', label: 'high-entropy ints' }], value: 'country', onChange: (v) => { S.preset = v; regen(); } },
      { id: 'p', label: 'cardinality / spread / run length', type: 'range', min: 1, max: 16, value: 4, onChange: (v) => { S.p = v; regen(); } },
      { id: 'rand', label: 'Randomize data', type: 'button', onChange: () => { S.seed++; regen(); } },
      { id: 'sort', label: 'Sort data', type: 'button', onChange: () => { S.vals = S.vals.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); S.dirty = true; } },
      { id: 'outlier', label: 'Append outlier (replace last value)', type: 'button', onChange: () => { if (isStr()) S.vals[N - 1] = 'ZZ'; else S.vals[N - 1] = Math.max(...S.vals) * 3 + 100000; S.dirty = true; } },
      { id: 'pred', label: 'predicate position', type: 'range', min: 0, max: 100, value: 40, onChange: (v) => { S.pred = v; S.dirty = true; } },
    ],
  },
};
