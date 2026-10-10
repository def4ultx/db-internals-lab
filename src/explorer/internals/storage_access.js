// access-method (scan/seek/next, seq vs index vs bitmap heap scan + cost crossover) and file-manager (files/extents/pages/blocks, fsync, O_DIRECT).
import * as THREE from 'three';
import { makeKit, C, rng } from './storage_kit.js';

/* ============================ access-method ============================ */
const T = 8, RPP = 6, NR = T * RPP;
const BIG = { T: 1000, N: 100000, seq: 1.0, rnd: 4.0, tup: 0.01, idxTup: 0.015 };
function costs(sel, corr) {
  const M = Math.max(1, sel * BIG.N), { T: TT, N, seq, rnd } = BIG;
  const pf = Math.min((2 * TT * M) / (2 * TT + M), TT);
  const seqC = TT * seq + N * BIG.tup;
  let io; if (corr) { const pg = Math.max(1, Math.ceil(sel * TT)); io = rnd + (pg - 1) * seq; } else io = pf * rnd;
  const idxC = io + M * (BIG.idxTup + BIG.tup);
  const cpp = rnd - (rnd - seq) * Math.sqrt(pf / TT);
  const bmC = pf * cpp + M * (BIG.idxTup + BIG.tup * 2);
  return { seq: seqC, index: idxC, bitmap: bmC };
}
let AM = null;
const amView = {
  build(ctx) {
    const M = makeKit(ctx), group = new THREE.Group(); group.add(M.group);
    let R = null;
    const st = { plan: 'auto', selPos: 25, corr: false, run: null, log: 'Pick a plan and press Run.', call: -1, iot: false };
    const rand = rng(11);
    const perm = [...Array(NR).keys()]; for (let i = NR - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const sel = () => Math.pow(10, -3 + 3 * st.selPos / 100);
    const corr = () => st.corr || st.iot;
    const keyAt = (r) => corr() ? r : perm[r];                  // key stored at physical row r
    const rowOfKey = (k) => corr() ? k : perm.indexOf(k);
    const thr = () => Math.max(1, Math.round(sel() * NR));
    const best = () => { const c = costs(sel(), corr()); return Object.keys(c).reduce((a, b) => (c[a] <= c[b] ? a : b)); };
    st.iot = (ctx.config && ctx.config['table-organization']) === 'index-organized';
    const IFACE = ['open(predicate: k < X)', 'seek(key) -> position cursor at first match', 'next() -> TID | row | EOF', 'insert(row) -> TID  (+ index entries)', 'delete(TID)', 'close()'];

    function render() {
      if (R) { group.remove(R.group); R.dispose(); } R = makeKit(ctx); group.add(R.group);
      const run = st.run; const th = thr();
      R.label('ACCESS METHOD: one interface, several physical paths', -2, 6.2, 0, { size: 0.5, w: 1000, px: 40, bold: true, color: '#2ac3de' });
      // heap pages 4x2
      R.label(st.iot ? 'clustered leaf pages (table IS the index)' : 'heap pages (6 rows each)', -5.4, 5.2, 0, { size: 0.36, w: 700, px: 38, color: '#7f8bb3' });
      for (let p = 0; p < T; p++) {
        const px = -8.2 + (p % 4) * 2.45, py = 3.7 - Math.floor(p / 4) * 2.3;
        const pst = run && run.pageState[p]; const col = pst === 'seq' ? 0x2d5aa0 : pst === 'rand' ? 0xa5642a : pst === 'hit' ? 0x555b70 : pst === 'bm' ? 0x6a4b9a : 0x1b2342;
        R.box(2.2, 2.0, 0.2, col, px, py, -0.2);
        R.label(`pg ${p}`, px, py + 0.85, 0.1, { size: 0.26, w: 200, px: 30, color: '#c0caf5' });
        for (let s = 0; s < RPP; s++) {
          const r = p * RPP + s, k = keyAt(r), m = k < th, shown = run && run.rowSeen.has(r);
          const cx = px - 0.62 + (s % 3) * 0.62, cy = py + 0.3 - Math.floor(s / 3) * 0.7;
          R.box(0.55, 0.55, 0.25, shown ? (m ? C.green : 0x8a4a5a) : (m ? 0x2f6b46 : 0x2a3358), cx, cy, 0.05);
          R.label(String(k), cx, cy, 0.25, { size: 0.26, w: 160, px: 40, color: '#e6ebff' });
        }
      }
      // index strip (sorted keys)
      R.label(`B+tree index on k (leaf order)  predicate: k < ${th}`, 4.9, 5.2, 0, { size: 0.34, w: 800, px: 36, color: '#bb9af7' });
      for (let k = 0; k < NR; k++) {
        const x = 0.8 + (k % 16) * 0.5, y = 4.5 - Math.floor(k / 16) * 0.5; const on = k < th; const cur = run && run.cursor === k;
        R.box(0.44, 0.4, 0.2, cur ? C.yellow : (on ? 0x5b4aa8 : 0x2a3358), x, y, 0, cur ? { emissive: C.yellow } : {});
      }
      // bitmap row
      if (run && run.bitmap) { R.label('bitmap (1 bit / heap page):', 2.2, 2.7, 0, { size: 0.3, w: 600, px: 34, color: '#bb9af7' }); for (let p = 0; p < T; p++) R.box(0.4, 0.4, 0.2, run.bitmap[p] ? C.purple : 0x2a3358, 4.2 + p * 0.5, 2.7, 0); }
      // chart
      const cx0 = 1.0, cy0 = -4.6, cw = 8.0, ch = 5.2; const cs = ['seq', 'index', 'bitmap']; const cc = { seq: C.blue, index: C.orange, bitmap: C.purple };
      R.box(cw + 0.3, ch + 0.3, 0.1, 0x10162b, cx0 + cw / 2, cy0 + ch / 2, -0.3);
      R.label(`cost vs selectivity (T=${BIG.T} pages, N=${BIG.N / 1000}k rows, random_page_cost=4, ${corr() ? 'correlated' : 'uncorrelated'})`, cx0 + cw / 2, cy0 + ch + 0.5, 0, { size: 0.3, w: 1100, px: 34, color: '#7f8bb3' });
      const ymax = 6000, pts = {}; cs.forEach((c) => (pts[c] = []));
      const NPT = 40; for (let i = 0; i <= NPT; i++) { const sv = Math.pow(10, -3 + 3 * i / NPT), c = costs(sv, corr()); cs.forEach((k) => pts[k].push([cx0 + cw * i / NPT, cy0 + ch * Math.min(c[k], ymax) / ymax, 0])); }
      cs.forEach((k, ci) => { const seg = []; for (let i = 0; i < NPT; i++) seg.push(pts[k][i], pts[k][i + 1]); R.lines(seg, cc[k]); R.label(k, cx0 + cw - 0.9, cy0 + ch - 0.3 - ci * 0.35, 0.1, { size: 0.3, w: 300, px: 36, color: '#' + new THREE.Color(cc[k]).getHexString() }); });
      const mx = cx0 + cw * st.selPos / 100; R.lines([[mx, cy0, 0.1], [mx, cy0 + ch, 0.1]], C.yellow);
      R.label('0.1%', cx0, cy0 - 0.3, 0, { size: 0.28, w: 200, px: 36, color: '#7f8bb3' }); R.label('1%', cx0 + cw / 3, cy0 - 0.3, 0, { size: 0.28, w: 200, px: 36, color: '#7f8bb3' }); R.label('10%', cx0 + 2 * cw / 3, cy0 - 0.3, 0, { size: 0.28, w: 200, px: 36, color: '#7f8bb3' }); R.label('100%', cx0 + cw, cy0 - 0.3, 0, { size: 0.28, w: 200, px: 36, color: '#7f8bb3' });
      const cur = costs(sel(), corr()); const b = best();
      R.label(`selectivity ${(sel() * 100).toFixed(sel() < 0.01 ? 2 : 1)}%  est: seq ${cur.seq.toFixed(0)} | index ${cur.index.toFixed(0)} | bitmap ${cur.bitmap.toFixed(0)}  -> optimizer picks ${b.toUpperCase()}`, cx0 + cw / 2, cy0 - 0.8, 0, { size: 0.32, w: 1400, px: 34, color: '#e0af68' });
      // interface panel
      IFACE.forEach((l, i) => { R.box(7.4, 0.42, 0.1, st.call === i ? 0x7a5d1f : 0x1b2342, -5.0, -1.2 - i * 0.5, 0); R.label(l, -5.0, -1.2 - i * 0.5, 0.1, { size: 0.3, w: 760, px: 34, color: st.call === i ? '#ffffff' : '#9aa5ce', align: 'left' }); });
      R.label('interface every access path implements', -5.0, -0.5, 0, { size: 0.3, w: 760, px: 34, color: '#7f8bb3' });
      const rs = run ? run : { seqIO: 0, rndIO: 0, hit: 0, rows: 0 };
      R.label(`plan: ${run ? run.plan.toUpperCase() : st.plan.toUpperCase()}   pages read ${rs.seqIO + rs.rndIO} (seq ${rs.seqIO} / random ${rs.rndIO} / buffer-hit ${rs.hit})   rows returned ${rs.rows}   IO cost ${(rs.seqIO * 1 + rs.rndIO * 4).toFixed(0)}`, -4.6, -4.5, 0, { size: 0.3, w: 1500, px: 30, color: '#9ece6a' });
      R.label(st.log, -0.5, -6.4, 0, { size: 0.3, w: 1900, px: 32, color: '#c0caf5' });
    }
    function start(plan) {
      M.clearAnim(); const real = plan === 'auto' ? best() : plan; const th = thr();
      const run = { plan: real, pageState: {}, rowSeen: new Set(), cursor: -1, bitmap: null, seqIO: 0, rndIO: 0, hit: 0, rows: 0 }; st.run = run;
      const ev = []; let last = -9;
      if (real === 'seq') { for (let p = 0; p < T; p++) ev.push({ f() { run.pageState[p] = 'seq'; run.seqIO++; st.call = 2; for (let s = 0; s < RPP; s++) { const r = p * RPP + s; run.rowSeen.add(r); if (keyAt(r) < th) run.rows++; } } }); st.log = 'Seq scan: read every page in physical order (prefetch-friendly), filter each row. Cost independent of selectivity.'; }
      else if (real === 'index') { for (let k = 0; k < th; k++) { const r = rowOfKey(k), p = Math.floor(r / RPP); ev.push({ f() { run.cursor = k; st.call = 2; if (p === last) { run.hit++; } else { run.pageState[p] = corr() ? 'seq' : 'rand'; corr() ? run.seqIO++ : run.rndIO++; } last = p; run.rowSeen.add(r); run.rows++; } }); } st.log = corr() ? 'Index scan on a CORRELATED (clustered) column: heap pages visited in order, nearly sequential.' : 'Index scan: each match is a TID -> random heap page read; pages revisited (buffer hit) only if adjacent. Many matches => random IO explosion.'; }
      else {
        run.bitmap = new Array(T).fill(0); const pgs = new Set();
        for (let k = 0; k < th; k++) { const p = Math.floor(rowOfKey(k) / RPP); ev.push({ f() { run.cursor = k; st.call = 2; run.bitmap[p] = 1; } }); pgs.add(p); }
        const sorted = [...pgs].sort((a, b) => a - b); let prev = -9;
        sorted.forEach((p) => ev.push({ f() { run.cursor = -1; run.pageState[p] = 'bm'; (p === prev + 1) ? run.seqIO++ : run.rndIO++; prev = p; for (let s = 0; s < RPP; s++) { const r = p * RPP + s; if (keyAt(r) < th) { run.rowSeen.add(r); run.rows++; } } } }));
        st.log = `Bitmap heap scan: phase 1 walks index and sets a bit per heap page (${pgs.size} pages), phase 2 reads those pages ONCE in physical order, rechecking the predicate.`;
      }
      let i = 0; const stepT = real === 'seq' ? 0.25 : 0.12;
      const tick = () => { if (i < ev.length) { ev[i++].f(); render(); M.after(stepT, tick); } else { st.call = 5; st.log += ` Done: ${run.rows} rows.`; render(); } };
      st.call = 0; render(); M.after(0.4, () => { st.call = (real === 'seq') ? 2 : 1; render(); M.after(0.4, tick); });
    }
    AM = {
      start, render,
      set(k, v) { st[k] = v; if (k !== 'plan') { st.run = null; M.clearAnim(); } render(); },
      insert() { st.call = 3; st.log = 'insert(row): heap page with space chosen via FSM -> TID; every index gets an entry (index maintenance = write amplification).'; render(); M.after(1.5, () => { st.call = -1; render(); }); },
      del() { st.call = 4; st.log = 'delete(TID): tuple marked dead; index entries removed lazily by vacuum.'; render(); M.after(1.5, () => { st.call = -1; render(); }); },
      cfg(c) { st.iot = c['table-organization'] === 'index-organized'; st.run = null; render(); },
    };
    render();
    return {
      group, update(dt) { M.tick(dt); }, onConfigChange(c) { AM.cfg(c); }, dispose() { if (R) R.dispose(); M.dispose(); },
      steps: [
        { title: 'One interface', text: 'Executor operators only call open/seek/next/insert/delete/close. Heap, B+tree, LSM, columnar all hide behind it; the optimizer chooses the physical path.', run() { AM.set('selPos', 25); AM.start('seq'); } },
        { title: 'Sequential scan', text: 'Reads every page in order; cost is flat in selectivity and benefits from read-ahead.', run() { AM.set('selPos', 70); AM.start('seq'); } },
        { title: 'Index scan (selective)', text: 'Few matches: descend the index, jump to each TID. Cheap when selectivity is tiny.', run() { AM.set('selPos', 5); AM.start('index'); } },
        { title: 'Index scan (unselective)', text: 'Many matches over scattered pages: random page reads dominate and exceed a seq scan.', run() { AM.set('selPos', 60); AM.start('index'); } },
        { title: 'Bitmap heap scan', text: 'Middle ground: collect matching pages into a bitmap, read each page once in physical order.', run() { AM.set('selPos', 45); AM.start('bitmap'); } },
        { title: 'Correlation changes everything', text: 'If the table is physically ordered by the key (clustered / IOT), index scans touch pages sequentially and win much longer.', run() { AM.set('corr', true); AM.start('index'); } },
      ],
    };
  },
  controls: [
    { id: 'plan', label: 'plan', type: 'select', options: [{ value: 'auto', label: 'auto (cheapest)' }, { value: 'seq', label: 'seq scan' }, { value: 'index', label: 'index scan' }, { value: 'bitmap', label: 'bitmap heap scan' }], value: 'auto', onChange(v) { AM && AM.set('plan', v); } },
    { id: 'sel', label: 'selectivity (log)', type: 'range', min: 0, max: 100, value: 25, onChange(v) { AM && AM.set('selPos', v); } },
    { id: 'corr', label: 'physically clustered on key', type: 'toggle', value: false, onChange(v) { AM && AM.set('corr', !!v); } },
    { id: 'run', label: 'Run scan', type: 'button', onChange() { if (AM) AM.start(document.getElementById('ctl-plan') ? document.getElementById('ctl-plan').value : 'auto'); } },
    { id: 'insert', label: 'insert(row)', type: 'button', onChange() { AM && AM.insert(); } },
    { id: 'delete', label: 'delete(TID)', type: 'button', onChange() { AM && AM.del(); } },
  ],
};

/* ============================ file-manager ============================ */
const NB = 64; // device blocks (4 KB each)
let FM = null;
const fmView = {
  build(ctx) {
    const M = makeKit(ctx), group = new THREE.Group(); group.add(M.group);
    let R = null;
    const st = { direct: false, prealloc: false, mmap: false, dev: null, files: null, cache: new Set(), fsyncs: 0, jumps: 0, writes: 0, ms: 0, lastEnd: -1, log: 'Append WAL records, dirty data pages, then fsync.', torn: -1, bufDirty: [], walRec: 0, hl: new Set() };
    const FC = { wal: C.red, data: C.cyan, idx: C.yellow };
    const reset = () => { st.dev = Array.from({ length: NB }, () => ({ f: null, durable: true, page: -1 })); st.files = { wal: { ext: [], blocks: [] }, data: { ext: [], blocks: [] }, idx: { ext: [], blocks: [] } }; st.cache.clear(); st.fsyncs = st.jumps = st.writes = 0; st.ms = 0; st.lastEnd = -1; st.torn = -1; st.bufDirty = []; st.walRec = 0; };
    const alloc = (f, n) => { // returns array of block numbers; contiguous if prealloc (fallocate), else first-free blocks one-by-one
      const F = st.files[f];
      const take = (b) => { st.dev[b].f = f; st.dev[b].durable = false; F.blocks.push(b); const e = F.ext[F.ext.length - 1]; if (e && e[0] + e[1] === b) e[1]++; else F.ext.push([b, 1]); };
      if (st.prealloc) { const want = Math.max(n, 8); let s = -1; for (let i = 0; i + want <= NB; i++) { let ok = true; for (let j = 0; j < want; j++) if (st.dev[i + j].f) { ok = false; break; } if (ok) { s = i; break; } } if (s >= 0) { for (let j = 0; j < want; j++) take(s + j); F.reserved = (F.reserved || 0) + want; return; } }
      for (let b = 0; b < NB && n > 0; b++) if (!st.dev[b].f) { take(b); n--; }
    };
    const ensure = (f, nblocks) => { const F = st.files[f]; F.used = F.used || 0; while (F.blocks.length < nblocks) { const before = F.blocks.length; alloc(f, st.prealloc ? 8 : 1); if (F.blocks.length === before) break; } };
    const devWrite = (b) => { st.writes++; if (b !== st.lastEnd) { st.jumps++; st.ms += 0.12; } st.ms += 0.03; st.lastEnd = b + 1; st.dev[b].durable = true; };
    const flush = (blocks) => { blocks.sort((a, b) => a - b).forEach(devWrite); };
    const mark = (blocks) => { st.hl = new Set(blocks); render(); M.after(1.4, () => { st.hl.clear(); render(); }); };
    const ext = (f) => st.files[f].ext.map((e) => `[${e[0]}..${e[0] + e[1] - 1}]`).join(' ') || '-';

    function render() {
      if (R) { group.remove(R.group); R.dispose(); } R = makeKit(ctx); group.add(R.group);
      R.label('FILE MANAGER: files -> extents -> pages -> OS blocks -> device', -0.5, 6.2, 0, { size: 0.5, w: 1200, px: 40, bold: true, color: '#2ac3de' });
      // DB layer
      const mm = st.mmap;
      R.label(mm ? 'DB layer: NO buffer pool - file is mmap()ed, OS page cache IS the cache (no control over write-back order)' : 'DB layer: buffer pool frames (8 KB pages)', -0.5, 5.3, 0, { size: 0.32, w: 1500, px: 34, color: '#7f8bb3' });
      if (!mm) for (let i = 0; i < 6; i++) { const x = -7.5 + i * 3, d = st.bufDirty.includes(i); R.box(2.6, 0.8, 0.2, d ? 0x6e5a2a : 0x1b2342, x, 4.6, 0); R.label(`frame ${i}${d ? ' dirty pg ' + (i + 10) : ''}`, x, 4.6, 0.15, { size: 0.3, w: 360, px: 34 }); }
      // OS page cache
      R.label(st.direct ? 'OS page cache: BYPASSED by O_DIRECT (aligned 4 KB/512 B IO, DMA straight to device)' : 'OS page cache (4 KB blocks, dirty until write-back / fsync)', -0.5, 3.6, 0, { size: 0.32, w: 1500, px: 34, color: st.direct ? '#f7768e' : '#7f8bb3' });
      const cb = [...st.cache].sort((a, b) => a - b);
      for (let i = 0; i < 24; i++) { const b = cb[i]; const x = -7.0 + i * 0.6; R.box(0.5, 0.5, 0.2, b != null ? FC[st.dev[b].f] : 0x1b2342, x, 3.0, 0, b != null ? { emissive: FC[st.dev[b].f], ei: 0.3 } : {}); if (b != null) R.label(String(b), x, 3.0, 0.15, { size: 0.22, w: 120, px: 40, color: '#0b1020' }); }
      // device
      R.label(`block device: ${NB} x 4 KB blocks (filled = durable, dim = written but not yet durable/only in cache)`, -0.5, 2.0, 0, { size: 0.32, w: 1500, px: 34, color: '#7f8bb3' });
      for (let b = 0; b < NB; b++) {
        const x = -7.9 + (b % 32) * 0.5, y = 1.2 - Math.floor(b / 32) * 0.75; const d = st.dev[b]; const hl = st.hl.has(b); const torn = d.page === st.torn && st.torn >= 0;
        const base = d.f ? FC[d.f] : 0x1f2845; const inCache = st.cache.has(b);
        R.box(0.44, 0.6, 0.2, torn ? 0xff0000 : hl ? 0xffffff : base, x, y, 0, { opacity: d.f ? (inCache ? 0.45 : 1) : 1, emissive: hl ? 0xffffff : 0x000000 });
        if (b % 8 === 0) R.label(String(b), x, y - 0.5, 0.1, { size: 0.2, w: 120, px: 36, color: '#56607f' });
      }
      // page boundaries note
      R.label('1 DB page (8 KB) = 2 blocks = 16 x 512B sectors; extent = contiguous run of blocks described by one (start,len) in the inode', -0.5, -0.5, 0, { size: 0.3, w: 1800, px: 32, color: '#9aa5ce' });
      // files table
      [['wal', 'WAL (append-only, sequential, fsync per commit)'], ['data', 'data file base/16384 (random 8 KB pages, written at checkpoint)'], ['idx', 'index file (random)']].forEach(([f, d], i) => {
        const y = -1.3 - i * 0.7; R.box(0.3, 0.3, 0.2, FC[f], -9.0, y, 0);
        R.label(`${f}: ${st.files[f].blocks.length} blk, ${st.files[f].ext.length} extent(s) ${ext(f)}`, -4.1, y, 0, { size: 0.3, w: 1200, px: 32, align: 'left', color: '#c0caf5' });
        R.label(d, 5.5, y, 0, { size: 0.28, w: 1400, px: 28, color: '#7f8bb3' });
      });
      const nExt = Object.values(st.files).reduce((a, F) => a + F.ext.length, 0);
      R.label(`write() calls ${st.writes}   non-contiguous jumps ${st.jumps}   fsync() ${st.fsyncs}   est. device time ${st.ms.toFixed(2)} ms   extents ${nExt}   mode: ${st.mmap ? 'mmap' : st.direct ? 'O_DIRECT' : 'buffered'}${st.prealloc ? ' + fallocate' : ''}`, -0.5, -3.8, 0, { size: 0.32, w: 1800, px: 34, color: '#e0af68' });
      R.label(st.log, -0.5, -4.6, 0, { size: 0.32, w: 1900, px: 34, color: '#9ece6a' });
      R.label('fsync = write dirty blocks + flush device volatile cache + (for new files) journal the directory/inode. Without it a crash loses "written" data.', -0.5, -5.3, 0, { size: 0.28, w: 1900, px: 30, color: '#7f8bb3' });
    }
    reset(); render();
    const walBlocks = () => st.files.wal.blocks;
    FM = {
      reset() { reset(); st.log = 'Reset.'; render(); },
      set(k, v) { st[k] = v; if (k === 'direct' && v) st.mmap = false; if (k === 'mmap' && v) st.direct = false; render(); },
      walAppend() {
        st.walRec++; const need = Math.ceil(st.walRec / 4); const F = st.files.wal; ensure('wal', need); const b = F.blocks[need - 1]; if (b == null) { st.log = 'device full'; render(); return; }
        if (st.direct) { devWrite(b); st.log = `WAL record ${st.walRec} appended: O_DIRECT|O_DSYNC write straight to block ${b} (durable immediately, no page cache)`; } else { st.cache.add(b); st.dev[b].durable = false; st.log = `WAL record ${st.walRec} appended to block ${b}: only in OS page cache (dirty) - NOT durable until fsync`; }
        mark([b]);
      },
      fsyncWal() {
        const dirty = [...st.cache].filter((b) => st.dev[b].f === 'wal'); st.fsyncs++; st.ms += 0.4; flush(dirty); dirty.forEach((b) => st.cache.delete(b));
        st.log = dirty.length ? `fsync(wal): ${dirty.length} dirty block(s) written SEQUENTIALLY + device cache flush -> COMMIT durable. Group commit batches many txns per fsync.` : 'fsync(wal): nothing dirty (O_DIRECT already wrote or no records) - still pays flush cost'; mark(dirty);
      },
      dirtyPage() {
        const pg = Math.floor(Math.random() * 6); ensure('data', 12); const bl = st.files.data.blocks; const b0 = Math.floor(Math.random() * Math.floor(bl.length / 2)) * 2; const pair = [bl[b0], bl[b0 + 1]].filter((x) => x != null);
        if (!st.bufDirty.includes(pg)) st.bufDirty.push(pg);
        if (st.direct) { pair.forEach(devWrite); st.log = `page write via O_DIRECT: 8 KB = 2 blocks ${pair.join(',')}; random location -> seek/jump`; }
        else { pair.forEach((b) => { st.cache.add(b); st.dev[b].durable = false; st.dev[b].page = b0; }); st.log = `buffer pool frame ${pg} dirtied; a later write() puts blocks ${pair.join(',')} in page cache (checkpointer decides when)`; }
        mark(pair);
      },
      checkpoint() {
        const dirty = [...st.cache].filter((b) => st.dev[b].f !== 'wal'); st.fsyncs++; st.ms += 0.4; flush(dirty); dirty.forEach((b) => st.cache.delete(b)); st.bufDirty = [];
        st.log = `checkpoint: ${dirty.length} dirty data blocks written in sorted order, then fsync(data). WAL before this point can be recycled.`; mark(dirty);
      },
      grow() { // interleaved growth to show fragmentation / prealloc effect
        ['wal', 'data', 'idx', 'wal', 'data', 'idx'].forEach((f) => { const F = st.files[f]; ensure(f, F.blocks.length + 1); });
        st.log = st.prealloc ? 'fallocate(): each file reserves a contiguous 8-block chunk up front -> few extents, sequential layout, no ENOSPC surprise at write time.' : 'Files grow one block at a time and interleave on disk -> many tiny extents (fragmentation); each extension also updates the inode/extent tree.'; render();
      },
      tear() {
        const bl = st.files.data.blocks; if (bl.length < 2) { ensure('data', 12); } const b0 = st.files.data.blocks[0]; if (b0 == null) return; devWrite(b0); st.dev[b0].page = 900; st.torn = 900; st.dev[b0 + 1] && (st.dev[b0 + 1].durable = false);
        st.log = 'POWER LOSS mid 8 KB write: only first 4 KB block reached disk -> TORN PAGE (checksum fails). Fix: full_page_writes (PG) / doublewrite buffer (InnoDB) restore it from a good copy before WAL redo.'; mark([b0]);
      },
    };
    const cfg = ctx.config || {}; if (cfg['page-cache'] === 'mmap') st.mmap = true; if (cfg['page-cache'] === 'direct-io-uring') st.direct = true; render();
    return {
      group, update(dt) { M.tick(dt); },
      onConfigChange(c) { st.mmap = c['page-cache'] === 'mmap'; st.direct = c['page-cache'] === 'direct-io-uring'; render(); },
      dispose() { if (R) R.dispose(); M.dispose(); },
      steps: [
        { title: 'Files, extents, blocks', text: 'The DB sees files of 8 KB pages; the filesystem maps them to extents of 4 KB blocks; the device exposes sectors.', run() { FM.reset(); FM.grow(); } },
        { title: 'WAL = sequential append', text: 'Log records fill one block after another; the commit path only needs this one file made durable.', run() { for (let i = 0; i < 6; i++) FM.walAppend(); } },
        { title: 'fsync makes it durable', text: 'write() only reaches the page cache. fsync pushes dirty blocks to the device and flushes its volatile cache.', run() { FM.fsyncWal(); } },
        { title: 'Data pages are lazy and random', text: 'Dirty buffer pool pages are written later by the checkpointer in scattered locations - that is why WAL exists.', run() { for (let i = 0; i < 4; i++) FM.dirtyPage(); FM.checkpoint(); } },
        { title: 'Preallocation', text: 'fallocate reserves contiguous extents; without it concurrent growth interleaves files and fragments them.', run() { FM.reset(); FM.set('prealloc', true); FM.grow(); } },
        { title: 'O_DIRECT', text: 'Bypasses the OS page cache: DB controls caching & ordering, avoids double buffering, but IO must be aligned and every miss goes to the device.', run() { FM.set('direct', true); FM.walAppend(); FM.dirtyPage(); } },
        { title: 'Torn page', text: 'A crash during an 8 KB write over 4 KB atomicity can leave half a page - why checksums + full-page writes / doublewrite exist.', run() { FM.set('direct', false); FM.tear(); } },
      ],
    };
  },
  controls: [
    { id: 'wal', label: 'Append WAL record', type: 'button', onChange() { FM && FM.walAppend(); } },
    { id: 'fsync', label: 'COMMIT: fsync(WAL)', type: 'button', onChange() { FM && FM.fsyncWal(); } },
    { id: 'page', label: 'Dirty a data page', type: 'button', onChange() { FM && FM.dirtyPage(); } },
    { id: 'ckpt', label: 'Checkpoint', type: 'button', onChange() { FM && FM.checkpoint(); } },
    { id: 'grow', label: 'Grow files (interleaved)', type: 'button', onChange() { FM && FM.grow(); } },
    { id: 'tear', label: 'Crash mid page write', type: 'button', onChange() { FM && FM.tear(); } },
    { id: 'direct', label: 'O_DIRECT', type: 'toggle', value: false, onChange(v) { FM && FM.set('direct', !!v); } },
    { id: 'prealloc', label: 'preallocate (fallocate)', type: 'toggle', value: false, onChange(v) { FM && FM.set('prealloc', !!v); } },
    { id: 'mmap', label: 'mmap instead of buffer pool', type: 'toggle', value: false, onChange(v) { FM && FM.set('mmap', !!v); } },
    { id: 'reset', label: 'Reset', type: 'button', onChange() { FM && FM.reset(); } },
  ],
};

export const views = { 'access-method': amView, 'file-manager': fmView };
