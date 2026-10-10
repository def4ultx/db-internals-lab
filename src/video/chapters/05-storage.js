import { W, C, L, p, pOut, ease, win, hexA, hash, lerp, text, box, arrow, packet, pill, callout, rrect, clamp, cells, bar } from '../helpers.js';
export const title = 'The storage engine';
export const subtitle = 'Pages · buffer pool · B+tree · LSM tree';
export const color = '#2ac3de';
export const duration = 75;
export const focus = ['storage'];
export const narration = [
  { at: 0.6, text: 'Everything ends up in files made of fixed-size pages, usually eight or sixteen kilobytes. A page is the unit of I/O, caching and locking.' },
  { at: 10.8, text: 'Inside a page, a slotted layout keeps a header and a slot array growing from the front, tuples growing from the back, and free space between. A tuple id is page number plus slot.' },
  { at: 25.2, text: 'The buffer pool caches pages in memory frames. On a miss it evicts a victim, here with the clock algorithm sweeping reference bits, writing it back first if dirty.' },
  { at: 37, text: 'To find rows by key, the classic index is the B plus tree: three or four page reads reach billions of rows, and a full leaf splits, pushing a key upward.' },
  { at: 49.2, text: 'The alternative is the log-structured merge tree. Writes go to a log and a memtable, flush as immutable sorted files, and background compaction merges them.' },
  { at: 59.2, text: 'Reads may check many files, so bloom filters skip the ones that cannot hold the key, and deletes leave tombstones until compaction drops them.' },
  { at: 68.6, text: 'B-trees favour reads; LSM trees favour writes, and pay with read and space amplification.' },
];
const hdr = (ctx, s) => text(ctx, s, 80, 135, { size: 28, color: L.storage, weight: 700 });
export function draw(ctx, t, h) {
  pagesAndSlots(ctx, t); bufferPool(ctx, t); btree(ctx, t); lsm(ctx, t); compare(ctx, t);
}
// ---------------------------------------------------------------- A+B
function pagesAndSlots(ctx, t) {
  const s = win(t, 2.8, 24.8, .5); if (s <= 0) return;
  ctx.save(); ctx.globalAlpha *= s; hdr(ctx, t < 10.6 ? 'FILES AND PAGES' : 'INSIDE A PAGE  —  the slotted page');
  // file strip (fades out as page zooms)
  const fa = 1 - p(t, 8, 10.4);
  if (fa > 0) { ctx.save(); ctx.globalAlpha *= fa; text(ctx, 'orders.ibd  (table file on disk)', 100, 215, { size: 26, color: C.dim, alpha: p(t, 3, 3.6) });
    for (let i = 0; i < 12; i++) { const a = p(t, 3.2 + i * .12, 3.7 + i * .12, ease.back); const sel = i === 3 && t > 5.5; box(ctx, { x: 100 + i * 145, y: 270, w: 130, h: 150, label: 'page ' + i, sub: '8 KB', color: sel ? C.warn : L.storage, alpha: clamp(a), size: 22, glow: sel ? .9 : 0 }); text(ctx, String(i * 8192), 165 + i * 145, 445, { size: 16, mono: true, color: C.dim, align: 'center', alpha: a }); }
    text(ctx, 'byte offset = page_no × 8192', 100, 520, { size: 24, color: C.fg, mono: true, alpha: p(t, 5, 5.8) });
    text(ctx, 'read(fd, buf, 8192, offset = 3 × 8192 = 24576)', 100, 565, { size: 24, color: C.warn, mono: true, alpha: p(t, 6, 6.8) });
    text(ctx, 'PostgreSQL 8 KB · InnoDB 16 KB · SQL Server 8 KB · DuckDB 256 KB blocks', 100, 625, { size: 22, color: C.dim, alpha: p(t, 7, 7.8) });
    ctx.restore(); }
  // slotted page
  const pa = p(t, 9.6, 10.8);
  if (pa > 0) { ctx.save(); ctx.globalAlpha *= pa; const X0 = 100, X1 = 1820, Y = 270, Hh = 150;
    rrect(ctx, X0, Y, X1 - X0, Hh, 12); ctx.fillStyle = 'rgba(255,255,255,.03)'; ctx.fill(); ctx.strokeStyle = hexA(L.storage, .8); ctx.lineWidth = 2.5; ctx.stroke();
    text(ctx, 'one 8 KB page (schematic, not to scale)', X0, Y - 14, { size: 20, color: C.dim });
    // header
    box(ctx, { x: X0 + 6, y: Y + 6, w: 150, h: Hh - 12, label: 'header', sub: '24 B', color: C.purple, size: 22, subSize: 16 });
    const tuples = [['t0', 120, 12], ['t1', 200, 14.4], ['t2', 90, 16.8], ['t3', 150, 19]]; let off = 8192; const info = [];
    tuples.forEach(([n, len, ts], i) => { off -= len; info.push({ n, len, off, ts, i }); });
    const del = p(t, 21, 21.8), compact = p(t, 22, 23.4, ease.inOut);
    // slots from front
    let sx = X0 + 6 + 150 + 8; info.forEach((q, i) => { const a = p(t, q.ts, q.ts + .5, ease.back); box(ctx, { x: sx + i * 74, y: Y + 6, w: 66, h: 60, label: 's' + i, color: C.cyan, alpha: clamp(a), size: 20, r: 8, glow: t > q.ts && t < q.ts + .7 ? .9 : 0 }); });
    // tuples from back
    let tx = X1 - 6; const tw = q => q.len * 1.55; const vis = []; info.forEach((q, i) => { const a = p(t, q.ts + .2, q.ts + .8, ease.out); let x = tx - tw(q); tx = x; vis.push({ q, x, a }); });
    vis.forEach(({ q, x, a }, i) => { let xx = x, ww = tw(q); const dead = i === 1; if (dead) { xx = x; }
      // compaction: tuples before the hole (t0 is rightmost, i=0) stay; later ones slide right by hole width
      if (i > 1) xx = x + tw(info[1]) * compact;
      const col = dead ? lerp(0, 1, 0) && C.bad : C.good; const al = dead ? 1 - del * .85 * (1 - compact * 1) : 1;
      if (dead && compact >= 1) return; box(ctx, { x: xx, y: Y + 6, w: ww, h: Hh - 12, label: q.n, sub: q.len + ' B', color: dead && del > 0 ? C.bad : C.good, alpha: clamp(a) * (dead ? (1 - compact) : 1), size: 20, subSize: 15, r: 8 }); });
    // slot -> tuple arrows
    info.forEach((q, i) => { const v = vis[i]; if (i === 1 && compact > .5) return; const xx = i > 1 ? v.x + tw(info[1]) * compact : v.x; const ly = Y + Hh + 12 + i * 7; arrow(ctx, [[sx + i * 74 + 33, Y + 66], [sx + i * 74 + 33, ly], [xx + tw(q) / 2, ly], [xx + tw(q) / 2, Y + Hh - 8]], { color: hexA(C.cyan, .75), width: 2, progress: p(t, q.ts + .4, q.ts + 1.1), alpha: 1 }); });
    text(ctx, 'free space', 760, Y + Hh / 2 + 4, { size: 24, color: C.dim, align: 'center', base: 'middle', alpha: .8 });
    text(ctx, '← slot array grows →', sx + 130, Y + Hh + 62, { size: 20, color: C.cyan, align: 'center', alpha: p(t, 12, 12.8) }); text(ctx, '← tuple data grows from the end', X1 - 280, Y + Hh + 62, { size: 20, color: C.good, align: 'center', alpha: p(t, 12, 12.8) });
    // table of slots
    const rows = info.map(q => ['slot ' + q.i, q.off + (q.i === 1 && compact > .5 ? 0 : 0), q.len]);
    const tbl = [['slot', 'offset', 'length'], ...info.map((q, i) => ['s' + q.i, (i > 1 && compact > .5 ? q.off + info[1].len : q.off), (i === 1 && compact > .5) ? '— (free)' : q.len])];
    tbl.forEach((r, i) => { const a = i === 0 ? p(t, 12, 12.8) : p(t, info[i - 1].ts + .3, info[i - 1].ts + .9); r.forEach((v, j) => text(ctx, String(v), 140 + j * 150, 560 + i * 40, { size: 22, mono: true, color: i === 0 ? C.cyan : (i === 2 && del > 0 ? C.bad : C.fg), alpha: a, weight: i ? 500 : 700 })); });
    text(ctx, 'Tuple id (TID/RID) = (page 3, slot 1)  —  indexes store this; slot indirection lets tuples move within the page', 140, 770, { size: 24, color: C.warn, alpha: p(t, 19.6, 20.6) });
    callout(ctx, 'DELETE s1 → mark slot dead', 760, 400, { color: C.bad, alpha: p(t, 20.8, 21.5) * (1 - compact), align: 'center' });
    callout(ctx, 'compaction slides tuples, reclaims the hole', 760, 400, { color: C.good, alpha: p(t, 22.2, 22.9), align: 'center' });
    text(ctx, 'Variable-length rows · NULL bitmap · overflow pages for big values (TOAST / off-page BLOB)', 140, 815, { size: 22, color: C.dim, alpha: p(t, 23, 24) });
    ctx.restore(); }
  ctx.restore();
}
// ---------------------------------------------------------------- C buffer pool
function bufferPool(ctx, t) {
  const s = win(t, 25.2, 36.8, .5); if (s <= 0) return;
  ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'BUFFER POOL  —  clock eviction');
  const cx = 600, cy = 500, R = 260; const ids = [12, 40, 7, 91, 33, 58, 21, 64, 5, 18, 77 - 70, 49]; const ref0 = [1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1], dirty = [0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0];
  const hand = t < 27 ? 2 : t < 27.6 ? 2 : t < 28.2 ? 3 : t < 28.8 ? 4 : 5; const handAng = (a) => (-90 + a * 30) * Math.PI / 180;
  const cleared = i => (i === 2 && t > 27.1) || (i === 3 && t > 27.7) || (i === 4 && false) ;
  const victim = t > 29; const wb = p(t, 29.3, 30.9), rd = p(t, 31, 32.8), loaded = t > 32.8;
  text(ctx, 'buffer pool (RAM)', cx, cy - 8, { size: 28, color: L.storage, align: 'center', weight: 700 }); text(ctx, '12 frames · page table: page_id → frame', cx, cy + 28, { size: 18, color: C.dim, align: 'center' });
  for (let i = 0; i < 12; i++) { const a = handAng(i), x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * (R * .85); const isV = i === 5; const refv = isV ? (loaded ? 1 : 0) : (cleared(i) ? 0 : ref0[i]); const d = isV ? (loaded ? 0 : (t > 29.3 && wb >= 1 ? 0 : 1)) : dirty[i];
    const pid = isV && loaded ? 77 : ids[i] * 1 + (i === 10 ? 70 : 0);
    box(ctx, { x: x - 62, y: y - 34, w: 124, h: 68, label: 'pg ' + pid, sub: `ref=${refv}  ${d ? 'dirty' : 'clean'}`, color: isV && victim && !loaded ? C.bad : d ? C.warn : (isV && loaded) ? C.good : L.storage, size: 21, subSize: 16, alpha: p(t, 25.5 + i * .06, 26 + i * .06), glow: (hand === i && t > 27 && t < 29.2) ? .9 : (isV && loaded && t < 34 ? .8 : 0), r: 10 }); }
  if (t > 26.6 && t < 30) { const ha = handAng(hand + (t < 27 ? 0 : 0)); arrow(ctx, [[cx + Math.cos(ha) * 100, cy + 60 + Math.sin(ha) * 70], [cx + Math.cos(ha) * (R - 90), cy + Math.sin(ha) * (R * .85 - 70)]], { color: C.accent, width: 5, progress: 1, alpha: p(t, 26.6, 27) }); }
  // request
  const req = p(t, 25.8, 26.8); box(ctx, { x: 1000, y: 230, w: 300, h: 70, label: 'get_page(77)', sub: 'miss: not in page table', color: C.accent, size: 24, subSize: 18, alpha: p(t, 25.8, 26.4), mono: true });
  box(ctx, { x: 1400, y: 560, w: 380, h: 200, label: 'DISK', sub: 'data file', color: C.dim, size: 28, alpha: p(t, 26, 26.8) });
  // writeback and read
  packet(ctx, [[722, 640], [1400, 640]], wb, { color: C.warn, size: 11, label: wb > 0 && wb < 1 ? 'flush dirty pg 58' : '', alpha: wb > 0 && wb < 1 ? 1 : 0 });
  packet(ctx, [[1400, 690], [722, 640]], rd, { color: C.good, size: 11, label: rd > 0 && rd < 1 ? 'read pg 77' : '', alpha: rd > 0 && rd < 1 ? 1 : 0 });
  const notes = [['1. hand sweeps: ref=1 → clear and move on (second chance)', 27, C.fg], ['2. ref=0 and unpinned → victim', 28.6, C.bad], ['3. dirty? WAL first, then write the page out', 29.4, C.warn], ['4. read requested page into the freed frame', 31, C.good]];
  notes.forEach(([n, ts, c], i) => text(ctx, n, 1000, 360 + i * 38, { size: 21, color: c, alpha: p(t, ts, ts + .6) }));
  text(ctx, 'pin count > 0 → never evicted · hit ~100 ns vs miss ~100 µs–10 ms', 1000, 530, { size: 20, color: C.dim, alpha: p(t, 33.5, 34.5) });
  text(ctx, 'LRU-K / 2Q / ARC resist sequential-scan flooding', 1000, 850 - 40, { size: 20, color: C.dim, alpha: p(t, 34.5, 35.5) });
  ctx.restore();
}
// ---------------------------------------------------------------- D B+tree
function btree(ctx, t) {
  const s = win(t, 37, 48.8, .5); if (s <= 0) return;
  ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'B+TREE  —  lookup and leaf split');
  const sp = p(t, 43.2, 45.2, ease.inOut), key = (arr, x, y, w, col, glow, al = 1, hl = -1) => { box(ctx, { x: x - w / 2, y, w, h: 70, color: col, alpha: al, glow, r: 10 }); const n = arr.length; arr.forEach((k, i) => text(ctx, String(k), x - w / 2 + (i + .5) * (w / Math.max(n, 1)), y + 35, { size: 24, mono: true, align: 'center', base: 'middle', alpha: al, color: i === hl ? C.good : C.fg, weight: 700 })); };
  const rootKeys = sp > .5 ? [40, 65, 80] : [40, 80]; const rx = 960, ry = 250;
  const lookup = p(t, 39, 42), look = t > 39 && t < 43.2;
  key(rootKeys, rx, ry, 150 + (sp > .5 ? 60 : 0), L.storage, look && lookup > .05 && lookup < .5 ? .8 : (sp > .3 && sp < .9 ? .9 : 0), p(t, 37.4, 38));
  const lv = [[[10, 20, 30], 330, 0], [[40, 50, 60, 70], 960, 1], [[80, 90, 100], 1590, 2]]; const ly = 520; text(ctx, 'internal node (keys + child page ids)', 1130, 255, { size: 18, color: C.dim, alpha: p(t, 38, 38.8) }); text(ctx, 'leaves: sorted keys + tuples, doubly linked', 1100, 610 + 70, { size: 18, color: C.dim, alpha: p(t, 38.4, 39) });
  const posX = [[330, 330], [960, 700], [1590, 1590]]; // L1, L2 (split -> 700 & 1090)
  // leaves
  const a = p(t, 37.8, 38.5, ease.back);
  key([10, 20, 30], 330 - sp * 40, ly, 300, L.storage, 0, a); key([80, 90, 100], 1590 + sp * 40, ly, 260, L.storage, 0, a);
  if (sp < .5) key([40, 50, 60, 70], 960, ly, 340, L.storage, look && lookup > .5 ? .9 : 0, a, look && lookup > .8 ? 2 : -1);
  else { key([40, 50, 60], lerp(960, 760, sp), ly, 260, L.storage, 0, 1); key([65, 70], lerp(960, 1160, sp), ly, 200, C.good, .6, 1); }
  // pointers
  const ptrs = sp < .5 ? [[rx - 40, ry + 70, 330 - sp * 40, ly], [rx, ry + 70, 960, ly], [rx + 40, ry + 70, 1590 + sp * 40, ly]] : [[rx - 55, ry + 70, 330 - sp * 40, ly], [rx - 18, ry + 70, lerp(960, 760, sp), ly], [rx + 18, ry + 70, lerp(960, 1160, sp), ly], [rx + 55, ry + 70, 1590 + sp * 40, ly]];
  ptrs.forEach(([x1, y1, x2, y2]) => arrow(ctx, [[x1, y1], [x2, y2]], { color: hexA(C.dim, .8), width: 2.5, head: true, progress: p(t, 38, 38.8) }));
  // lookup packet
  if (look) { const path = [[rx, 175], [rx, ry + 35], [960, ly + 35]]; packet(ctx, path, lookup, { color: C.warn, size: 11, label: lookup < .3 ? 'key = 60' : '' }); text(ctx, 'read root (cached) → read leaf: 2 page reads', 120, 400, { size: 22, color: C.warn, alpha: p(t, 40, 40.6) }); }
  // leaf links
  const lk = p(t, 38.6, 39.2); if (sp < .5) { arrow(ctx, [[480 - sp * 40, ly + 35], [790, ly + 35]], { color: hexA(L.storage, .6), width: 2, progress: lk, head: true }); arrow(ctx, [[1130, ly + 35], [1450 + sp * 40, ly + 35]], { color: hexA(L.storage, .6), width: 2, progress: lk }); }
  // insert
  if (t > 42 && t < 46.5) { callout(ctx, 'INSERT 65  →  leaf is full (4 keys max)', 480, 400, { color: C.bad, alpha: p(t, 42, 42.6) * (1 - sp), align: 'center' }); callout(ctx, 'split leaf, copy middle key up to the parent', 480, 400, { color: C.good, alpha: sp > .3 ? p(t, 44, 44.6) : 0, align: 'center' }); packet(ctx, [[960, ly], [rx + 20, ry + 70]], p(t, 44, 45), { color: C.good, size: 9, label: '65' }); }
  text(ctx, 'fanout ~500 keys per 8 KB page:  500³ ≈ 125 million rows in 3 levels · 500⁴ ≈ 62 billion in 4', 120, 780, { size: 24, color: C.fg, alpha: p(t, 45.6, 46.6) });
  text(ctx, 'root and upper levels stay cached → ~1 disk read per lookup', 120, 825, { size: 22, color: C.dim, alpha: p(t, 46.6, 47.4) });
  ctx.restore();
}
// ---------------------------------------------------------------- E+F LSM
function lsm(ctx, t) {
  const s = win(t, 49.2, 68.4, .5); if (s <= 0) return;
  ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'LSM TREE  —  write path, compaction, read path');
  const fl = p(t, 52.2, 53.2), cp = p(t, 56, 58, ease.inOut);
  // client + memtable + WAL
  box(ctx, { x: 100, y: 190, w: 200, h: 70, label: 'put(k, v)', color: L.client, size: 24, alpha: p(t, 49.6, 50.2), mono: true });
  box(ctx, { x: 420, y: 190, w: 540, h: 100, color: L.storage, alpha: p(t, 49.8, 50.4), r: 12 }); text(ctx, 'MEMTABLE (sorted, in RAM)', 440, 218, { size: 20, color: L.storage, weight: 700, alpha: p(t, 50, 50.6) });
  box(ctx, { x: 1020, y: 190, w: 380, h: 100, label: 'WAL', sub: 'sequential append + fsync', color: L.txn, size: 26, alpha: p(t, 49.8, 50.4) });
  const ins = [['c', 50.4], ['a', 50.9], ['e', 51.3], ['b', 51.7]]; const sorted = ['a', 'b', 'c', 'e'];
  const mem = (t < 52.2 ? ins.filter(q => t > q[1]).map(q => q[0]).sort() : []); mem.forEach((k, i) => box(ctx, { x: 440 + i * 100, y: 232, w: 86, h: 44, label: k, color: C.good, size: 22, r: 8, glow: 0 }));
  ins.forEach(([k, ts]) => { packet(ctx, [[300, 225], [420, 240]], p(t, ts - .35, ts), { color: C.good, size: 7 }); packet(ctx, [[300, 225], [1020, 225]], p(t, ts - .1, ts + .3), { color: C.bad, size: 6, trail: .06, alpha: .8 }); });
  // levels
  const lvl = [['L0  (overlapping files)', 400], ['L1  (sorted, non-overlapping)', 560], ['L2', 700]]; lvl.forEach(([n, y], i) => { text(ctx, n, 100, y - 12, { size: 20, color: C.dim, alpha: p(t, 50.5, 51.3) }); ctx.save(); ctx.globalAlpha *= p(t, 50.5, 51.3) * .5; ctx.strokeStyle = 'rgba(138,147,181,.35)'; ctx.setLineDash([6, 8]); ctx.strokeRect(95, y, 1300, 108); ctx.restore(); });
  const file = (x, y, w, ks, col, al, extra = {}) => { box(ctx, { x, y, w, h: 84, color: col, alpha: al, r: 10, glow: extra.glow || 0 }); ks.forEach((k, i) => text(ctx, k, x + 24 + i * Math.min(54, (w - 40) / ks.length), y + 42, { size: 22, mono: true, base: 'middle', color: /†/.test(k) ? C.bad : C.fg, alpha: al, weight: 700 })); };
  // flush: memtable -> F1 in L0
  packet(ctx, [[690, 290], [250, 440]], p(t, 52, 53), { color: C.good, size: 10, label: 'flush' });
  const f1 = p(t, 53, 53.6, ease.back), f2 = p(t, 53.8, 54.4, ease.back), f3 = p(t, 54.5, 55.1, ease.back);
  const keep = 1 - cp;
  file(110, 412, 240, ['a', 'b', 'c', 'e'], L.storage, f1 * keep); file(370, 412, 240, ['b′', 'd', 'f'], L.storage, f2 * keep); file(630, 412, 240, ['a′', 'g', 'f†'], L.storage, f3 * keep);
  text(ctx, 'immutable SSTables', 900, 455, { size: 20, color: C.dim, alpha: p(t, 55, 55.8) * keep });
  // compaction: merge into L1
  if (t > 55.6) { [[230, 500], [490, 500], [750, 500]].forEach(([x, y], i) => arrow(ctx, [[x, 496], [560, 590]], { color: hexA(C.warn, .8), width: 2.5, progress: p(t, 55.8, 56.8), alpha: keep })); text(ctx, 'compaction: merge-sort, newest wins, tombstone dropped', 900, 530, { size: 22, color: C.warn, alpha: p(t, 56, 56.8) * (1 - p(t, 58.4, 59)) }); }
  file(110, 572, 560, ['a′', 'b′', 'c', 'd', 'e', 'f†', 'g'], L.storage, cp * (t < 62 ? 1 : 1)); file(700, 572, 300, ['h', 'i', 'j', 'k'], L.storage, p(t, 50.8, 51.4) * .8);
  file(110, 712, 900, ['m', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u'], L.storage, p(t, 51, 51.6) * .6);
  // ---- reads (59.2 ..)
  const rd = t > 59.2;
  if (rd) { const ra = p(t, 59.2, 60); callout(ctx, 'get(g)', 1100, 440, { color: C.accent, alpha: ra, align: 'center' });
    // new L0 file f4 appears
    const f4 = p(t, 59.6, 60.2, ease.back); file(110, 412, 240, ['d″'], C.dim, f4, { glow: 0 });
    // bloom filters
    const bl = [[110, 412, 'no ✕ skip', C.dim, 60.8], [110, 572, 'maybe ✓', C.good, 61.6]]; bl.forEach(([x, y, s2, c, ts]) => { const a = p(t, ts, ts + .5); pill(ctx, 'bloom: ' + s2, y > 500 ? x + 480 : x + 400, y > 500 ? y - 20 : y + 42, { color: c, size: 19, alpha: a }); });
    packet(ctx, [[1100, 460], [380, 454], [380, 572 + 40]], p(t, 60.4, 62.4), { color: C.accent, size: 8 });
    text(ctx, 'memtable: miss → L0 bloom says no (skip) → L1 bloom says maybe → 1 read', 420, 345, { size: 20, color: C.dim, alpha: p(t, 60.4, 61.2) });
    // tombstone
    const ta = p(t, 63.5, 64.3); if (ta > 0) { box(ctx, { x: 420, y: 232, w: 100, h: 44, label: 'f†', color: C.bad, size: 22, r: 8, alpha: ta, glow: .7 });
      callout(ctx, 'delete(e) writes a tombstone \u2020', 1630, 470, { color: C.bad, alpha: ta, align: 'center' });
      ['get(e) hits the tombstone first', '\u2192 \u201cnot found\u201d, even though the old', 'e still sits in L1.', 'Space comes back only when', 'compaction merges them.'].forEach((l, i) => text(ctx, l, 1450, 530 + i * 30, { size: 20, color: i < 3 ? C.fg : C.dim, alpha: p(t, 64.8 + i * .5, 65.4 + i * .5) }));
    } }
  ctx.restore();
}
// ---------------------------------------------------------------- G compare
function compare(ctx, t) {
  const s = win(t, 68.6, 74.6, .5); if (s <= 0) return; ctx.save(); ctx.globalAlpha *= s; hdr(ctx, 'THE TRADE-OFF');
  const rows = [['write amplification', 'B+tree: page rewrite + WAL', .55, 'LSM: ~10–30× from compaction', .45], ['read amplification', 'B+tree: 1 path, ~3–4 pages', .15, 'LSM: many files (bloom helps)', .6], ['space amplification', 'B+tree: ~1.3× (fragmentation)', .3, 'LSM: ~1.1× leveled / 2× tiered', .25]];
  rows.forEach(([n, a, av, b, bv], i) => { const y = 230 + i * 190, al = p(t, 69 + i * .8, 69.6 + i * .8); text(ctx, n, 120, y, { size: 30, weight: 800, alpha: al });
    text(ctx, a, 120, y + 50, { size: 22, color: C.accent, alpha: al }); bar(ctx, 700, y + 32, 900 * av * p(t, 69.4 + i * .8, 70.4 + i * .8), 26, 1, C.accent);
    text(ctx, b, 120, y + 100, { size: 22, color: C.warn, alpha: al }); bar(ctx, 700, y + 82, 900 * bv * p(t, 69.4 + i * .8, 70.4 + i * .8), 26, 1, C.warn); });
  ctx.restore();
}
