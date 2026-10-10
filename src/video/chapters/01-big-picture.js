import { W, C, L, p, ease, win, hash, hexA, text, box, arrow, packet, pathPoint, pill, cells, code, kinetic, rrect, clamp, lerp, callout, measure } from '../helpers.js';
export const title = 'The big picture';
export const subtitle = 'Life of a query, and two kinds of workload';
export const duration = 60;
export const focus = t => (t < 9 ? ['client'] : t < 17 ? ['client'] : t < 25 ? ['frontend', 'planning'] : t < 34 ? ['planning', 'execution'] : t < 41 ? ['execution', 'storage'] : ['client', 'frontend', 'planning', 'execution', 'txn', 'storage', 'distributed']);
export const narration = [
  { at: 0.6, text: 'Every database, from SQLite to Spanner, is a pipeline that turns a line of text into bytes on disk, and back again.' },
  { at: 9.5, text: 'Here is one query. A client sends it over a wire protocol, through a connection pool, to a server process.' },
  { at: 17.5, text: 'The parser checks the grammar, the binder resolves names against the catalog, and the optimizer picks a plan using statistics.' },
  { at: 25.5, text: 'The executor runs that plan, asking the storage engine for pages. The buffer pool serves them from memory, or reads the disk.' },
  { at: 34.5, text: 'Rows flow back up the same path. Seven layers, and every layer’s design affects all the others.' },
  { at: 41.5, text: 'Workloads change everything. OLTP is millions of tiny point lookups, where latency rules. OLAP is a few huge scans, where throughput rules.' },
  { at: 50.5, text: 'Keep that in mind: every design choice we meet is a bet on one of these two worlds.' },
];
const STAGES = [
  ['Client', 'client', 'client'], ['Wire protocol', 'client', 'wire'], ['Conn pool', 'client', 'pool'], ['Parser', 'frontend', 'parse'],
  ['Binder', 'frontend', 'bind'], ['Optimizer', 'planning', 'opt'], ['Executor', 'execution', 'exec'], ['Storage', 'storage', 'store'],
];
const SUBS = ['app / driver', 'framing & auth', '50 conns shared', 'text \u2192 AST', 'names \u2192 ids', 'picks best plan', 'runs the plan', 'pages & indexes'];
const BW = 180, GAP = (1800 - 8 * BW) / 7, BY = 250, BH = 110;
const bx = i => 60 + i * (BW + GAP);
const cx = i => bx(i) + BW / 2;
const STOPS = [3.2, 10.5, 12.5, 18, 20, 22.5, 27, 31.5];
const LBL = ['SQL text', 'bytes', 'session', 'tokens', 'bound AST', 'physical plan', 'next() / page ids', 'page 17'];
export function draw(ctx, t, h) {
  const sceneA = 1 - p(t, 40.5, 41.5);
  if (sceneA > 0.01) {
    ctx.save(); ctx.globalAlpha *= sceneA;
    // boxes
    STAGES.forEach(([name, layer], i) => {
      const a = p(t, 2.6 + i * .12, 3.2 + i * .12, ease.out);
      const near = Math.max(0, 1 - Math.min(...STOPS.map(s => Math.abs(t - s))) * 0); // placeholder
      let uu = 0; for (let k = 0; k < 7; k++) if (t >= STOPS[k]) uu = k + p(t, STOPS[k] + .6, STOPS[k + 1], ease.inOut);
      const active = (Math.round(uu) === i && t >= STOPS[0] - 1 && t < 35) ? 1 : 0;
      box(ctx, { x: bx(i), y: BY, w: BW, h: BH, label: name, size: 24, sub: SUBS[i], color: L[layer], alpha: a, glow: active * (.6 + .4 * Math.sin(t * 6)) , scale: .9 + .1 * a });
    });
    // path packets
    const pts = STAGES.map((_, i) => [cx(i), BY + BH / 2]);
    for (let i = 0; i < 7; i++) { const u = p(t, STOPS[i] - .3, STOPS[i + 1] - .3, ease.inOut); const seg = [[cx(i) + BW / 2 - 6, BY + BH / 2], [cx(i + 1) - BW / 2 + 6, BY + BH / 2]]; arrow(ctx, seg, { color: hexA(L[STAGES[i + 1][1]], .8), progress: p(t, 3.2 + i * .15, 3.8 + i * .15), width: 3 }); }
    // moving packet
    if (t > 2.8 && t < 34.5) {
      let u = 0; for (let i = 0; i < 7; i++) if (t >= STOPS[i]) u = i + p(t, STOPS[i] + .6, STOPS[i + 1], ease.inOut);
      if (t < STOPS[0]) u = 0;
      const seg = Math.min(6, Math.floor(u)), f = u - seg; const x = lerp(cx(seg), cx(Math.min(7, seg + 1)), f);
      const idx = Math.round(u - .25); const lbl = LBL[clamp(Math.round(u + (f > .5 ? 0 : 0)), 0, 7)];
      packet(ctx, [[x - .01, BY + BH + 38], [x, BY + BH + 38]], 1, { color: C.good, size: 13, label: lbl });
      ctx.save(); ctx.strokeStyle = 'rgba(158,206,106,.35)'; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(x, BY + BH); ctx.lineTo(x, BY + BH + 30); ctx.stroke(); ctx.restore();
    }
    // return path
    if (t > 33 && t < 41) {
      const back = [[cx(7), BY - 40], [cx(0), BY - 40]];
      arrow(ctx, [[cx(7), BY], [cx(7), BY - 40], [cx(0), BY - 40], [cx(0), BY]], { color: C.accent, progress: p(t, 33, 36), label: 'result rows', labelAt: .5, width: 3 });
      for (let k = 0; k < 3; k++) packet(ctx, [[cx(7), BY], [cx(7), BY - 40], [cx(0), BY - 40], [cx(0), BY]], p(t, 33.5 + k * .5, 38.5 + k * .5), { color: C.accent, size: 9 });
    }
    // query banner
    const qa = p(t, 3, 4);
    code(ctx, "SELECT name FROM users WHERE id = 42;", 60, 150, { size: 34, alpha: qa });
    // seven-layer band
    // detail panels
    const py = 470;
    // wire (9.5-17)
    const wa = win(t, 10, 17.2);
    if (wa > 0) {
      ctx.save(); ctx.globalAlpha *= wa;
      text(ctx, 'PostgreSQL simple-query message  (MySQL: COM_QUERY, 0x03 + text)', 80, py + 10, { size: 26, color: L.client });
      const q = 'SELECT name FROM users WHERE id = 42';
      const fields = [['\'Q\'', 'msg type', 1], ['0x00000029', 'length = 4 + 36 + 1', 4], [q, 'SQL text', 36], ['\\0', 'NUL', 1]];
      let x = 80; fields.forEach(([v, d, n], i) => { const w = i === 2 ? 760 : i === 1 ? 250 : 120; const a = p(t, 11 + i * .6, 11.6 + i * .6, ease.out);
        box(ctx, { x, y: py + 50, w, h: 90, label: v, sub: d, color: [C.accent, C.warn, C.good, C.dim][i], alpha: a, mono: true, size: i === 2 ? 22 : 26, scale: .9 + .1 * a }); x += w + 20; });
      const pk = [[80, py + 230], [1100, py + 230]];
      text(ctx, 'Connection pool: 5,000 app threads share ~50 server connections', 80, py + 220, { size: 24, color: C.dim, alpha: p(t, 13, 14) });
      for (let i = 0; i < 10; i++) { const a = p(t, 13.5 + i * .1, 14 + i * .1); const col = i < 5 ? C.accent : C.dim; box(ctx, { x: 80 + i * 78, y: py + 250, w: 62, h: 50, label: i < 5 ? 'app' : 'idle', color: col, alpha: a, size: 16, r: 8 }); }
      arrow(ctx, [[720, py + 275], [900, py + 275]], { color: L.client, progress: p(t, 14.5, 15.3), label: 'multiplexed', width: 3 });
      for (let i = 0; i < 3; i++) box(ctx, { x: 920 + i * 90, y: py + 250, w: 74, h: 50, label: 'conn ' + (i + 1), color: L.client, alpha: p(t, 15, 15.6), size: 16, r: 8, glow: (Math.floor(t * 2) % 3 === i) * .8 });
      ctx.restore();
    }
    // frontend (17.5-25.5)
    const fa = win(t, 17.6, 25.4);
    if (fa > 0) {
      ctx.save(); ctx.globalAlpha *= fa;
      const toks = [['SELECT', 'kw'], ['name', 'id'], ['FROM', 'kw'], ['users', 'id'], ['WHERE', 'kw'], ['id', 'id'], ['=', 'op'], ['42', 'num']];
      let x = 80; toks.forEach(([s, k], i) => { const w = measure(ctx, s, 26, true) + 36; const a = p(t, 18 + i * .25, 18.4 + i * .25, ease.back); pill(ctx, s, x + w / 2, py + 40, { color: k === 'kw' ? C.purple : k === 'num' ? C.orange : k === 'op' ? C.dim : C.accent, size: 26, mono: true, alpha: a }); x += w + 14; });
      text(ctx, 'parser: tokens → AST   |   binder: users → table#17, id → col 0 (INT, PK)   |   optimizer: index lookup, ~1 row', 80, py + 110, { size: 22, color: C.dim, alpha: p(t, 20, 21) });
      // mini tree
      const ta = p(t, 20.5, 22);
      const nodes = [[400, py + 200, 'Project name', L.planning], [400, py + 300, 'Filter id = 42', L.frontend], [400, py + 400, 'Scan users', L.storage]];
      nodes.forEach(([x2, y2, l, c], i) => { box(ctx, { x: x2 - 130, y: y2 - 35, w: 260, h: 60, label: l, color: c, alpha: p(t, 20.5 + i * .5, 21.2 + i * .5), size: 22, scale: 1 }); if (i) arrow(ctx, [[x2, y2 - 35 + 0], [x2, y2 - 55 + 0]].map(q => q), { color: C.dim, progress: p(t, 21 + i * .5, 21.5 + i * .5), width: 2 }); });
      // catalog
      box(ctx, { x: 1000, y: py + 160, w: 420, h: 150, label: 'Catalog', sub: 'users(id INT PK, name TEXT, email TEXT)', color: L.frontend, alpha: p(t, 22, 23) });
      box(ctx, { x: 1000, y: py + 330, w: 420, h: 120, label: 'Statistics', sub: 'rows=10M  ndv(id)=10M  → sel=1e-7', color: L.planning, alpha: p(t, 23, 24) });
      arrow(ctx, [[1000, py + 230], [790, py + 330]], { color: L.frontend, progress: p(t, 22.3, 23), width: 2, dashed: true });
      ctx.restore();
    }
    // execution (25.5 -34.5)
    const ea = win(t, 25.7, 34.4);
    if (ea > 0) {
      ctx.save(); ctx.globalAlpha *= ea;
      // buffer pool frames
      text(ctx, 'Buffer pool (RAM)', 120, py + 40, { size: 26, color: L.storage });
      for (let i = 0; i < 8; i++) { const hit = i === 3; const g = hit ? (.5 + .5 * Math.sin(t * 6)) * p(t, 29, 29.5) : 0; box(ctx, { x: 120 + (i % 4) * 150, y: py + 70 + Math.floor(i / 4) * 100, w: 130, h: 80, label: 'frame ' + i, sub: hit ? 'page 17' : 'page ' + (40 + i * 7), color: hit ? C.good : L.storage, alpha: p(t, 26 + i * .1, 26.6 + i * .1), size: 20, subSize: 16, glow: g }); }
      text(ctx, 'Disk', 1200, py + 40, { size: 26, color: L.storage });
      for (let i = 0; i < 6; i++) box(ctx, { x: 1200 + (i % 3) * 150, y: py + 70 + Math.floor(i / 3) * 100, w: 130, h: 80, label: 'pg ' + i * 9, color: C.dim, alpha: p(t, 26.5 + i * .1, 27 + i * .1), size: 18 });
      arrow(ctx, [[1200, py + 120], [740, py + 120]], { color: C.warn, progress: p(t, 30, 31.5), label: 'miss → read 8 KB', width: 3, dashed: true });
      const pk = [[1200, py + 120], [740, py + 120]]; packet(ctx, pk, p(t, 30, 31.5), { color: C.warn, size: 10 });
      callout(ctx, 'hit: ~100 ns', 300, py + 290, { color: C.good, alpha: p(t, 28, 29) });
      callout(ctx, 'miss: ~100 µs (NVMe) – 10 ms (HDD)', 1000, py + 290, { color: C.warn, alpha: p(t, 31, 32) });
      text(ctx, 'tuple (id=42, name=“Ada”)  → Executor → client', 120, py + 360, { size: 28, color: C.fg, mono: true, alpha: p(t, 32, 33) });
      ctx.restore();
    }
    // layer legend
    if (t > 34.5) { ctx.save(); ctx.globalAlpha *= p(t, 34.5, 36); const names = ['Client', 'Frontend', 'Planning', 'Execution', 'Txn/Recovery', 'Storage', 'Distributed']; const ids = ['client', 'frontend', 'planning', 'execution', 'txn', 'storage', 'distributed'];
      ids.forEach((id, i) => { const y = py + 20 + i * 50, a = p(t, 35 + i * .2, 35.6 + i * .2); box(ctx, { x: 120 + (i % 2) * 520, y: py + 20 + Math.floor(i / 2) * 85, w: 480, h: 62, label: names[i], color: L[id], alpha: a, size: 26 }); });
      ctx.restore(); }
    ctx.restore();
  }
  // OLTP vs OLAP
  const oa = p(t, 41, 42);
  if (oa > 0) {
    ctx.save(); ctx.globalAlpha *= oa;
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(W / 2 - 1, 140, 2, 700);
    text(ctx, 'OLTP', 480, 170, { size: 64, weight: 800, color: C.accent, align: 'center', alpha: p(t, 41.4, 42) });
    text(ctx, 'OLAP', 1440, 170, { size: 64, weight: 800, color: C.warn, align: 'center', alpha: p(t, 41.4, 42) });
    text(ctx, 'many tiny point reads/writes · latency (ms) · concurrency', 480, 215, { size: 24, color: C.dim, align: 'center' });
    text(ctx, 'few huge scans & joins · throughput (GB/s) · parallelism', 1440, 215, { size: 24, color: C.dim, align: 'center' });
    // OLTP: many dots hitting a small table
    for (let i = 0; i < 90; i++) { const per = 1.2 + hash(i) * 1.4, ph = (t * (1 / per) + hash(i + 50)) % 1; const x0 = 90 + hash(i + 3) * 780, y0 = 270 + hash(i + 9) * 100; const tx = 480 + (hash(i + 20) - .5) * 360, ty = 560 + (hash(i + 30) - .5) * 160; const u = ease.out(ph);
      ctx.fillStyle = hexA(C.accent, .9 * (1 - ph)); ctx.shadowColor = C.accent; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(lerp(x0, tx, u), lerp(y0, ty, u), 5, 0, 7); ctx.fill(); }
    ctx.shadowBlur = 0;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) { const k = r * 6 + c; const hit = Math.floor(t * 9 + k * 3.7) % 11 === 0; box(ctx, { x: 270 + c * 70, y: 500 + r * 44, w: 62, h: 36, color: hit ? C.good : C.accent, glow: hit ? 1 : 0, r: 5, lw: 1.2 }); }
    text(ctx, `${(1000000 + Math.floor(t * 9731) % 90000).toLocaleString()} queries / s`, 480, 800, { size: 38, color: C.accent, align: 'center', mono: true, glow: 10 });
    text(ctx, 'B+tree · row store · row locks · WAL fsync', 480, 845, { size: 24, color: C.dim, align: 'center', alpha: p(t, 45, 46) });
    // OLAP: giant wave sweeping columns
    const sweep = (t * .22) % 1;
    for (let c = 0; c < 8; c++) for (let r = 0; r < 16; r++) { const x = 1000 + c * 100, y = 270 + r * 32; const on = ((r / 16) < sweep) ; const wv = clamp(1 - Math.abs(r / 16 - sweep) * 6);
      ctx.fillStyle = on ? hexA(C.warn, .25 + .6 * wv) : 'rgba(255,255,255,.07)'; if (wv > .2) { ctx.shadowColor = C.warn; ctx.shadowBlur = 16 * wv; } rrect(ctx, x, y, 88, 24, 5); ctx.fill(); ctx.shadowBlur = 0; }
    text(ctx, `${(8 + sweep * 92).toFixed(1)} GB scanned`, 1440, 800, { size: 38, color: C.warn, align: 'center', mono: true, glow: 10 });
    text(ctx, 'columnar · vectorized · compression · MPP', 1440, 845, { size: 24, color: C.dim, align: 'center', alpha: p(t, 45, 46) });
    ctx.restore();
  }
}
