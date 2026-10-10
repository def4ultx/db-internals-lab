// column-store: row group -> column chunk -> page, PAX minipages, zone maps, bitmaps, footer, NSM/DSM/PAX amplification.
import * as THREE from 'three';
import { C, panel, box, text, mono, line, arrow, para, hex, wr, cellGrid, scaffold, rng, opt } from './_kitD.js';

const COLS = ['order_id', 'ts', 'price', 'qty', 'country', 'status', 'user_id', 'sku', 'discount', 'tax', 'shipping', 'currency', 'channel', 'device', 'ip', 'lat', 'lon', 'notes', 'created', 'updated'];
const NRG = 8, RGROWS = 64, N = 100000, PAGE = 8192, ROWB = 160, CL = 64;
const CTRY = ['TH', 'SG', 'JP', 'VN', 'ID', 'MY', 'PH', 'KR'];
const S = { layout: 'pax', gran: 'page', order: 'clustered', thr: 520, sel: 3, colA: 2, colB: 4, reveal: 8, revT: 0, dirty: true, rgs: [], valid: [], price: [], ctry: [] };
let inst = null, curConfig = {};

function gen() {
  const r = rng(11); S.price = []; S.valid = []; S.ctry = [];
  for (let k = 0; k < NRG; k++) for (let i = 0; i < RGROWS; i++) {
    let v;
    if (S.order === 'random') v = Math.floor(r() * 1000);
    else v = Math.floor(Math.min(999, Math.max(0, k * 120 + r() * 200 - 20)));
    S.price.push(v); S.valid.push(r() > 0.07 ? 1 : 0); S.ctry.push(CTRY[Math.floor(r() * 8)]);
  }
  if (S.order === 'sorted') { const idx = S.price.map((p, i) => i).sort((a, b) => S.price[a] - S.price[b]); const p2 = idx.map((i) => S.price[i]); S.price = p2; }
  S.rgs = [];
  for (let k = 0; k < NRG; k++) {
    let mn = 1e9, mx = -1, nn = 0; for (let i = 0; i < RGROWS; i++) { const j = k * RGROWS + i; if (!S.valid[j]) { nn++; continue; } mn = Math.min(mn, S.price[j]); mx = Math.max(mx, S.price[j]); }
    S.rgs.push({ k, mn, mx, nulls: nn, off: 4 + k * COLS.length * 520 });
  }
}
const prune = (rg) => rg.mx <= S.thr;     // predicate: price > thr ; max <= thr => skip
function sim() {
  const a = S.colA, b = S.colB; const useful = N * 16;
  const nsmRows = Math.floor((PAGE - 24) / (ROWB + 4)), nsmPages = Math.ceil(N / nsmRows);
  const lines = new Set(); for (let r = 0; r < nsmRows; r++) { const base = 24 + r * ROWB; lines.add(Math.floor((base + a * 8) / CL)); lines.add(Math.floor((base + b * 8 + 7) / CL)); lines.add(Math.floor((base + b * 8) / CL)); lines.add(Math.floor((base + a * 8 + 7) / CL)); }
  const nsm = { io: nsmPages * PAGE, pages: nsmPages, lines: lines.size * nsmPages };
  const vpp = Math.floor((PAGE - 24) / 8), dsmPages = 2 * Math.ceil(N / vpp);
  const dsm = { io: dsmPages * PAGE, pages: dsmPages, lines: 2 * Math.ceil((N * 8) / CL) };
  const n = Math.floor((PAGE - 24 - 20 * 2) / (20 * 8 + 20 / 8)), mpSize = Math.ceil(n / 8) + n * 8, pl = new Set();
  for (const c of [a, b]) { const s = 64 + c * mpSize + Math.ceil(n / 8), e = s + n * 8 - 1; for (let x = Math.floor(s / CL); x <= Math.floor(e / CL); x++) pl.add(x + c * 1000); }
  const paxPages = Math.ceil(N / n), pax = { io: paxPages * PAGE, pages: paxPages, lines: pl.size * paxPages, n, mpSize };
  const paxRG = { io: dsm.io, pages: dsm.pages, lines: pax.lines, n, mpSize };
  return { useful, nsm, dsm, pax, paxRG, nsmRows };
}
const fmtB = (b) => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : (b / 1e3).toFixed(0) + ' KB';
const layoutKey = () => S.layout === 'nsm-row' ? 'nsm' : S.layout === 'dsm-column' ? 'dsm' : (S.gran === 'rowgroup' ? 'paxRG' : 'pax');

function draw() {
  const P = inst.P, g = P.g, st = sim(); P.clear();
  const ln = { nsm: 'NSM (row store, slotted pages)', dsm: 'DSM (one file/page-run per column)', pax: 'PAX (minipage per column inside each page)', paxRG: 'PAX at row-group scale (Parquet/ORC)' };
  text(g, 'Column store · SELECT sum(price) FROM orders WHERE price > ' + S.thr + ' AND country=…', 30, 36, { size: 34, weight: '700' });
  // ---- file strip
  const SX = 30, SY = 90; text(g, 'Parquet-like file: PAR1 · row groups · footer', SX, SY, { size: 26, color: C.cyan, weight: '700' });
  box(g, SX, SY + 20, 60, 90, '#33405f', C.line, 6); text(g, 'PAR1', SX + 30, SY + 65, { size: 22, align: 'center' });
  let scanned = 0, skipped = 0;
  S.rgs.forEach((rg, k) => {
    const x = SX + 70 + k * 128, shown = k < S.reveal, sk = prune(rg), sel = k === S.sel;
    const col = !shown ? '#242c47' : sk ? '#3a2f3f' : '#25503a';
    box(g, x, SY + 20, 120, 90, col, sel ? '#fff' : (!shown ? C.line : sk ? C.red : C.green), 6, sel ? 4 : 2);
    text(g, 'RG' + k, x + 60, SY + 42, { size: 24, align: 'center', weight: '700' });
    mono(g, rg.mn > 1e8 ? '—' : `${rg.mn}‥${rg.mx}`, x + 60, SY + 72, { size: 22, align: 'center' });
    text(g, !shown ? '…' : sk ? 'SKIP' : 'SCAN', x + 60, SY + 98, { size: 22, align: 'center', color: sk ? C.red : C.green, weight: '700' });
    if (k < S.reveal) { if (sk) skipped++; else scanned++; }
  });
  box(g, SX + 70 + NRG * 128, SY + 20, 190, 90, '#4a3a5a', C.purple, 6); text(g, 'footer', SX + 70 + NRG * 128 + 95, SY + 50, { size: 24, align: 'center', weight: '700' }); mono(g, 'len u32 PAR1', SX + 70 + NRG * 128 + 95, SY + 84, { size: 20, align: 'center' });
  text(g, `zone map (min‥max of price per row group) says: scanned ${scanned}  ·  skipped ${skipped}  ·  ${S.order} data order`, SX, SY + 138, { size: 26, color: skipped ? C.green : C.yellow });
  if (S.order === 'random') text(g, 'random order → every RG spans ~0‥999 → zone maps cannot prune', SX, SY + 170, { size: 24, color: C.yellow });
  // ---- chunk detail for selected RG
  const rg = S.rgs[S.sel], DY = 290; box(g, 20, DY, 1290, 250, 'rgba(18,24,41,0.88)', C.line, 10);
  text(g, `footer entry · RG${rg.k} · ${RGROWS} rows · data starts at byte ${rg.off}`, 40, DY + 30, { size: 28, weight: '700' });
  const cw = 60; COLS.forEach((c, i) => { const t = i === S.colA || i === S.colB, x = 40 + i * (cw + 1.5); box(g, x, DY + 56, cw, 56, t ? (i === S.colA ? 'rgba(122,162,247,0.6)' : 'rgba(158,206,106,0.6)') : '#1e2745', t ? '#fff' : C.line, 4, t ? 3 : 1); text(g, 'c' + i, x + cw / 2, DY + 84, { size: 20, align: 'center', color: t ? '#fff' : C.dim }); });
  text(g, 'column chunks (each a run of pages: data page = rep/def levels + encoded values); only 2 of 20 chunks are read', 40, DY + 134, { size: 22, color: C.dim });
  mono(g, `chunk ${COLS[S.colA]}: file_offset=${rg.off + S.colA * 520}  total_size=520 B  encoding=PLAIN  num_values=${RGROWS}`, 40, DY + 170, { size: 23 });
  mono(g, `   statistics: min=${rg.mn}  max=${rg.mx}  null_count=${rg.nulls}   → predicate price>${S.thr} ${prune(rg) ? 'cannot match: SKIP chunk' : 'may match: read'}`, 40, DY + 204, { size: 23, color: prune(rg) ? C.red : C.green });
  mono(g, `footer_length=${(NRG * COLS.length * 61).toString()} B = 0x${hex(NRG * COLS.length * 61, 8).match(/../g).reverse().join(' ')} (u32 LE) then magic 'PAR1'`, 40, DY + 238, { size: 21, color: C.purple });
  // ---- bitmaps
  const BY = 560; box(g, 20, BY, 1290, 385, 'rgba(18,24,41,0.88)', C.line, 10);
  text(g, `bitmaps for RG${rg.k} (64 rows): validity · predicate · selection`, 40, BY + 28, { size: 28, weight: '700' });
  const rows = [['validity (null bitmap, 1=non-null)', (i) => S.valid[rg.k * 64 + i], C.cyan], ['price > ' + S.thr, (i) => (S.price[rg.k * 64 + i] > S.thr ? 1 : 0), C.yellow], ['selection = validity AND predicate', (i) => (S.valid[rg.k * 64 + i] && S.price[rg.k * 64 + i] > S.thr ? 1 : 0), C.green]];
  let pop = 0;
  rows.forEach(([nm, f, col], ri) => {
    const y = BY + 62 + ri * 92; text(g, nm, 40, y, { size: 22, color: col });
    for (let i = 0; i < 64; i++) { const bit = f(i), x = 40 + (i % 32) * 38 + ((i % 32) >> 3) * 6, yy = y + 18 + ((i / 32) | 0) * 26; if (ri === 2) pop += bit;
      box(g, x, yy, 34, 24, bit ? col + '99' : '#171e36', bit ? col : C.line, 3, 1); mono(g, bit, x + 17, yy + 12, { size: 18, color: bit ? '#fff' : C.dim, align: 'center' }); }
  });
  const gather = []; for (let i = 0; i < 64 && gather.length < 10; i++) if (S.valid[rg.k * 64 + i] && S.price[rg.k * 64 + i] > S.thr) gather.push(S.ctry[rg.k * 64 + i]);
  mono(g, `popcount=${pop}  ·  gather ${COLS[S.colB]} at set bits → ${gather.join(' ') || '(none)'}${pop > 10 ? ' …' : ''}`, 40, BY + 350, { size: 24, color: C.green });
  // ---- PAX anatomy
  const AY = 957; box(g, 20, AY, 1290, 238, 'rgba(18,24,41,0.88)', C.line, 10);
  text(g, `PAX page anatomy (${PAGE} B page, 20 cols × 8 B): ${st.pax.n} rows/page, minipage = null-bitmap ${Math.ceil(st.pax.n / 8)} B + ${st.pax.n}×8 B = ${st.pax.mpSize} B`, 40, AY + 28, { size: 24, weight: '700' });
  const total = 64 + 20 * st.pax.mpSize, sc = 1230 / total;
  box(g, 40, AY + 56, 24 * sc, 58, '#55618a', null, 3); box(g, 40 + 24 * sc, AY + 56, 40 * sc, 58, '#7a6a9a', null, 3);
  for (let i = 0; i < 20; i++) { const x = 40 + (64 + i * st.pax.mpSize) * sc, t = i === S.colA || i === S.colB; box(g, x + 1, AY + 56, st.pax.mpSize * sc - 2, 58, t ? (i === S.colA ? C.blue : C.green) : '#27324f', null, 3); if (t) text(g, 'c' + i, x + st.pax.mpSize * sc / 2, AY + 85, { size: 22, align: 'center', color: '#06101a', weight: '700' }); }
  text(g, 'hdr', 40 + 12 * sc, AY + 130, { size: 20, align: 'center', color: C.dim }); text(g, 'mp dir', 40 + 44 * sc, AY + 150, { size: 20, align: 'center', color: C.dim });
  mono(g, `mp offsets: c0=64  c${S.colA}=${64 + S.colA * st.pax.mpSize}  c${S.colB}=${64 + S.colB * st.pax.mpSize}  (u16 in directory)`, 40, AY + 180, { size: 22 });
  text(g, 'same rows as NSM, but each column’s values are contiguous → cache/SIMD friendly', 40, AY + 212, { size: 21, color: C.dim });
  // ---- right: layout counters
  const RX = 1350, RY = 90; box(g, RX - 20, RY, 660, 610, null, C.line, 10);
  text(g, ln[layoutKey()], RX, RY + 28, { size: 25, weight: '700', color: C.yellow });
  text(g, `3D: ${20} cols × 16 rows, 1 cell = 8 B, address order = ${S.layout === 'nsm-row' ? 'row-major' : 'column-major'}`, RX, RY + 62, { size: 20, color: C.dim });
  text(g, 'green needed · red wasted in fetched 64 B line', RX, RY + 558, { size: 20, color: C.dim });
  text(g, `touched: ${COLS[S.colA]} + ${COLS[S.colB]}`, RX, RY + 585, { size: 22, color: C.green });
  // counters
  const CY = 710; box(g, RX - 20, CY, 660, 480, 'rgba(18,24,41,0.88)', C.line, 10);
  text(g, `query touches 2 of 20 cols over ${N.toLocaleString()} rows (useful = ${fmtB(st.useful)})`, RX, CY + 28, { size: 22, weight: '700' });
  [['NSM', 'nsm'], ['DSM', 'dsm'], ['PAX page', 'pax'], ['PAX row-group', 'paxRG']].forEach(([nm, k], i) => {
    const y = CY + 66 + i * 90, cur = k === layoutKey(), d = st[k];
    if (cur) box(g, RX - 10, y - 6, 640, 84, 'rgba(255,255,255,0.08)', C.yellow, 6, 2);
    text(g, nm, RX, y + 12, { size: 24, weight: '700', color: cur ? C.yellow : C.fg });
    mono(g, `I/O ${d.pages.toLocaleString()} pages = ${fmtB(d.io)}  (${(d.io / st.useful).toFixed(1)}× read amp)`, RX, y + 42, { size: 21 });
    mono(g, `cache lines ${d.lines.toLocaleString()} = ${fmtB(d.lines * CL)}  (${(d.lines * CL / st.useful).toFixed(1)}×)`, RX, y + 66, { size: 21, color: C.cyan });
  });
  P.done();
  // 3D grid
  const G = inst.G, addr = (r, c) => (S.layout === 'nsm-row' ? r * 20 + c : c * 16 + r), touched = (c) => c === S.colA || c === S.colB;
  const fetched = new Set(); for (let r = 0; r < 16; r++) for (const c of [S.colA, S.colB]) fetched.add(addr(r, c) >> 3);
  for (let r = 0; r < 16; r++) for (let c = 0; c < 20; c++) { const i = r * 20 + c, f = fetched.has(addr(r, c) >> 3); G.set(i, touched(c) ? (c === S.colA ? C.green : '#b9f27c') : f ? C.red : '#243056', touched(c) ? 2.2 : f ? 1.3 : 0.4); }
  G.commit();
}
function setReplay() { S.reveal = 0; S.revT = 0; }
export const views = {
  'column-store': {
    build(ctx) {
      S.layout = opt(ctx.config, 'page-layout', 'pax'); gen(); S.reveal = 0; S.dirty = true; curConfig = ctx.config;
      const sc = scaffold(), P = panel(20, 12, 100, { depthWrite: false }); P.mesh.position.z = 0.9; sc.group.add(P.mesh);
      const G = cellGrid(20, 16, 0.3, 0.3, 0.2); G.mesh.position.set(-10 + 13.5, 6 - 1.5, 0); sc.group.add(G.mesh);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(20.2, 12.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x0e1424 })); slab.position.z = -0.2; sc.group.add(slab);
      inst = { P, G };
      const steps = [
        { title: 'File → row group → column chunk → page', text: 'A row group (≈64 rows here; 128 MB–1 GB in real Parquet/ORC) stores each column as a contiguous chunk; chunks are split into pages. The footer (read first, from the end of the file) lists every chunk’s offset, size and statistics.', run() { S.sel = 3; S.dirty = true; } },
        { title: 'Zone maps prune row groups', text: 'min/max per chunk live in the footer. A predicate price > X skips any row group whose max ≤ X without reading its data. Drag the predicate slider.', run() { setReplay(); S.thr = 700; S.dirty = true; } },
        { title: 'Pruning needs clustering', text: 'Switch data order to random: every row group spans nearly the whole domain, so nothing can be skipped.', run() { S.order = 'random'; gen(); setReplay(); S.dirty = true; } },
        { title: 'Null + selection bitmaps', text: 'validity bitmap AND predicate bitmap = selection bitmap; other columns are gathered at the set bits. Nulls never satisfy the predicate.', run() { S.order = 'clustered'; gen(); S.sel = 5; S.thr = 520; S.dirty = true; } },
        { title: 'NSM vs DSM vs PAX', text: 'NSM drags 20 columns through cache for 2; DSM reads only the needed columns (but rebuilding rows costs joins); PAX keeps rows in one page yet groups values by column.', run() { S.layout = 'nsm-row'; S.dirty = true; } },
        { title: 'PAX', text: 'Same I/O as NSM per page, but only 2 minipages enter the CPU cache. At row-group scale (Parquet) even the I/O shrinks.', run() { S.layout = 'pax'; S.dirty = true; } },
      ];
      return {
        group: sc.group, steps,
        update(dt) { if (S.reveal < NRG) { S.revT += dt; const r = Math.min(NRG, Math.floor(S.revT / 0.25)); if (r !== S.reveal) { S.reveal = r; S.dirty = true; } } if (S.dirty) { S.dirty = false; draw(); } },
        onConfigChange(cfg) { S.layout = opt(cfg, 'page-layout', 'pax'); S.dirty = true; },
        dispose() { sc.dispose(); P.dispose(); G.dispose(); slab.geometry.dispose(); slab.material.dispose(); inst = null; },
      };
    },
    controls: [
      { id: 'layout', label: 'page layout (also set by page-layout slot)', type: 'select', options: ['nsm-row', 'dsm-column', 'pax'], value: 'pax', onChange: (v) => { S.layout = v; S.dirty = true; } },
      { id: 'gran', label: 'PAX granularity', type: 'select', options: [{ value: 'page', label: 'inside 8 KB page' }, { value: 'rowgroup', label: 'row group (Parquet)' }], value: 'page', onChange: (v) => { S.gran = v; S.dirty = true; } },
      { id: 'thr', label: 'predicate: price > X', type: 'range', min: 0, max: 999, value: 520, onChange: (v) => { S.thr = v; setReplay(); S.dirty = true; } },
      { id: 'order', label: 'data clustering', type: 'select', options: ['clustered', 'sorted', 'random'], value: 'clustered', onChange: (v) => { S.order = v; gen(); setReplay(); S.dirty = true; } },
      { id: 'rg', label: 'inspect row group', type: 'range', min: 0, max: 7, value: 3, onChange: (v) => { S.sel = v; S.dirty = true; } },
      { id: 'colA', label: 'column A (0-19)', type: 'range', min: 0, max: 19, value: 2, onChange: (v) => { S.colA = v; S.dirty = true; } },
      { id: 'colB', label: 'column B (0-19)', type: 'range', min: 0, max: 19, value: 4, onChange: (v) => { S.colB = v; S.dirty = true; } },
      { id: 'replay', label: 'Replay pruning scan', type: 'button', onChange: () => { setReplay(); S.dirty = true; } },
    ],
  },
};
