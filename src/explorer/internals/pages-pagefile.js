// page-file: how a database page is laid out as bytes (PostgreSQL PageHeaderData / InnoDB FIL header+trailer).
import * as THREE from 'three';
import { C, MONO, panel, box, text, mono, line, arrow, para, hex, bin, wr, rd, crc32c, ascii, cellGrid, scaffold, lights } from './_kitD.js';

const PG = {
  id: 'postgres', size: 8192, le: true, name: 'PostgreSQL heap/btree page (8 KB, little-endian)',
  fields: [
    ['pd_lsn', 0, 8, 'LSN of last WAL record that touched the page (xlogid:xrecoff). WAL rule: flush WAL up to this LSN before writing the page.'],
    ['pd_checksum', 8, 2, 'Page checksum (data_checksums=on). Real PG uses an FNV-1a variant mixed with the block number; this lab folds CRC32C to 16 bits.'],
    ['pd_flags', 10, 2, 'Hint bits: 0x1 has free line pointers, 0x2 page is full, 0x4 all tuples visible.'],
    ['pd_lower', 12, 2, 'Offset to start of free space = end of line-pointer array.'],
    ['pd_upper', 14, 2, 'Offset to end of free space = start of newest tuple (tuples grow downward).'],
    ['pd_special', 16, 2, 'Offset to special space (btree: BTPageOpaqueData with prev/next sibling).'],
    ['pd_pagesize_version', 18, 2, 'Page size | layout version (8192 | 4 = 0x2004).'],
    ['pd_prune_xid', 20, 4, 'Oldest unpruned XMAX hint, lets HOT pruning skip pages.'],
  ],
};
const INNO = {
  id: 'innodb', size: 16384, le: false, name: 'InnoDB INDEX page (16 KB, big-endian)',
  fields: [
    ['FIL_PAGE_SPACE_OR_CHKSUM', 0, 4, 'CRC32C checksum (innodb_checksum_algorithm=crc32): crc32c(4..26) XOR crc32c(38..size-8).'],
    ['FIL_PAGE_OFFSET', 4, 4, 'Page number within the tablespace = file offset / 16384.'],
    ['FIL_PAGE_PREV', 8, 4, 'Previous sibling page number (B+tree leaf level doubly linked list).'],
    ['FIL_PAGE_NEXT', 12, 4, 'Next sibling page number; 0xFFFFFFFF = none.'],
    ['FIL_PAGE_LSN', 16, 8, 'LSN of newest modification (redo log position).'],
    ['FIL_PAGE_TYPE', 24, 2, '0x45BF = FIL_PAGE_INDEX.'],
    ['FIL_PAGE_FILE_FLUSH_LSN', 26, 8, 'Only meaningful in page 0 of system tablespace.'],
    ['FIL_PAGE_SPACE_ID', 34, 4, 'Tablespace id.'],
    ['PAGE_N_DIR_SLOTS', 38, 2, 'Number of sparse directory slots (every ~4-8 records).'],
    ['PAGE_HEAP_TOP', 40, 2, 'Byte offset of first free byte in the record heap.'],
    ['PAGE_N_HEAP', 42, 2, 'Records in heap incl. infimum/supremum (bit 15 = compact format).'],
    ['PAGE_FREE', 44, 2, 'Head of the deleted-record free list.'],
    ['PAGE_GARBAGE', 46, 2, 'Bytes in deleted records.'],
    ['PAGE_LAST_INSERT', 48, 2, 'Offset of last inserted record.'],
    ['PAGE_N_RECS', 54, 2, 'User records on this page.'],
    ['PAGE_LEVEL', 64, 2, '0 = leaf.'],
    ['PAGE_INDEX_ID', 66, 8, 'Index id this page belongs to.'],
    ['FIL_PAGE_END_LSN (trailer)', 16376, 8, 'Trailer: old checksum (4) + low 32 bits of LSN (4). Mismatch with header = torn page.'],
  ],
};
const FCOL = [C.blue, C.purple, C.yellow, C.green, C.cyan, C.orange, C.pink, C.red];

const S = {
  L: PG, le: true, buf: null, sel: 0, flipByte: 0, flipBit: 0, pageId: 5, dw: true, copy: null, log: [], lsn: 0x1A2B3C40,
  chain: [], dirty: true, banner: '', pages: [],
};
let inst = null;

function mkChain() {
  S.chain = [{ id: 4, keys: [10, 20, 30, 40], prev: -1, next: 5 }, { id: 5, keys: [50, 60, 70, 80], prev: 4, next: 6 }, { id: 6, keys: [90, 100, 110], prev: 5, next: -1 }];
  S.sep = [50, 90]; S.log = ['initial leaf chain 4 <-> 5 <-> 6'];
}
const pg = (id) => S.chain.find((p) => p.id === id);

function stamp(buf, L, le) { // writes checksum per layout
  if (L.id === 'postgres') { wr(buf, 8, 2, 0, le); const c = crc32c(buf, 0, L.size, [8, 10]) & 0xffff; wr(buf, 8, 2, c, le); }
  else {
    const c = (crc32c(buf, 4, 26) ^ crc32c(buf, 38, L.size - 8)) >>> 0;
    wr(buf, 0, 4, c, le); wr(buf, L.size - 8, 4, c, le);
  }
}
function computed(buf, L, le) {
  if (L.id === 'postgres') return crc32c(buf, 0, L.size, [8, 10]) & 0xffff;
  return (crc32c(buf, 4, 26) ^ crc32c(buf, 38, L.size - 8)) >>> 0;
}
function stored(buf, L, le) { return L.id === 'postgres' ? rd(buf, 8, 2, le) : rd(buf, 0, 4, le); }

function buildPage(id, lsn) {
  const L = S.L, le = S.le, size = L.size, b = new Uint8Array(size), p = pg(id);
  const keys = p ? p.keys : [];
  const prev = p ? p.prev : -1, next = p ? p.next : -1;
  if (L.id === 'postgres') {
    const n = Math.max(keys.length, 1), lower = 24 + 4 * n, tl = 32, upper = size - 16 - tl * n;
    wr(b, 0, 4, 0x0000001A, le); wr(b, 4, 4, lsn & 0xffffffff, le); // xlogid:xrecoff
    wr(b, 10, 2, 0x0004 | (n < 4 ? 1 : 0), le); wr(b, 12, 2, lower, le); wr(b, 14, 2, upper, le); wr(b, 16, 2, size - 16, le);
    wr(b, 18, 2, 0x2004, le); wr(b, 20, 4, 0, le);
    for (let i = 0; i < n; i++) { // line pointers: off:15 | flags:2 (1=NORMAL) | len:15
      const off = upper + tl * (n - 1 - i); wr(b, 24 + 4 * i, 4, (off & 0x7fff) | (1 << 15) | (tl << 17), le);
      const k = keys[i] ?? 0; const t = ascii(`K=${String(k).padEnd(4)}row-${id}.${i} payload..`).slice(0, tl); b.set(t, off);
    }
    wr(b, size - 16, 4, prev < 0 ? 0xffffffff : prev, le); wr(b, size - 12, 4, next < 0 ? 0xffffffff : next, le);
    wr(b, size - 8, 4, 0, le); wr(b, size - 4, 2, 0x0003 | (next < 0 ? 0x0 : 0) , le); wr(b, size - 2, 2, 0, le);
  } else {
    wr(b, 4, 4, id, le); wr(b, 8, 4, prev < 0 ? 0xffffffff : prev, le); wr(b, 12, 4, next < 0 ? 0xffffffff : next, le);
    wr(b, 16, 8, lsn, le); wr(b, 24, 2, 0x45BF, le); wr(b, 34, 4, 3, le);
    const n = keys.length; wr(b, 38, 2, 2 + Math.ceil(n / 4), le); wr(b, 40, 2, 120 + n * 24, le); wr(b, 42, 2, 0x8000 | (n + 2), le);
    wr(b, 44, 2, 0, le); wr(b, 46, 2, 0, le); wr(b, 48, 2, 120 + n * 24 - 24, le); wr(b, 54, 2, n, le); wr(b, 64, 2, 0, le); wr(b, 66, 8, 0x42, le);
    b.set(ascii('infimum\0'), 99); b.set(ascii('supremum'), 112);
    keys.forEach((k, i) => { const off = 126 + i * 24; b.set(ascii(`K=${String(k).padEnd(4)}row-${id}.${i} ..`).slice(0, 22), off); });
    wr(b, size - 4, 4, lsn & 0xffffffff, le);
  }
  stamp(b, L, le);
  return b;
}
function rebuild(keepLsn = true) {
  if (!pg(S.pageId)) S.pageId = S.chain[0].id;
  S.buf = buildPage(S.pageId, S.lsn); S.copy = null; S.dirty = true; S.banner = '';
  S.flipByte = clampField().off;
}
const clampField = () => { const f = S.L.fields; S.sel = Math.max(0, Math.min(f.length - 1, S.sel)); const [name, off, w, desc] = f[S.sel]; return { name, off, w, desc }; };

// ---------- drawing  (canvas px; 100 px = 1 world unit; on screen text is ~0.45x so keep fonts >= 26)
const GX = 110, GY = 120, CW = 62, CH = 56, COLS = 16;
function fieldAt(o) { const f = S.L.fields; for (let i = 0; i < f.length; i++) if (o >= f[i][1] && o < f[i][1] + f[i][2]) return i; return -1; }
function byteColor(o) {
  const L = S.L, f = fieldAt(o);
  if (f >= 0) return FCOL[f % FCOL.length];
  if (L.id === 'postgres') {
    const lower = rd(S.buf, 12, 2, S.le);
    if (o >= 24 && o < lower) return '#5a6a98';
    if (o >= L.size - 16) return C.yellow;
  } else { if (o >= 38 && o < 74) return '#5a6a98'; if (o >= L.size - 8) return C.red; }
  return '#2c3556';
}
function draw() {
  const P = inst.P, g = P.g, L = S.L, b = S.buf, le = S.le;
  P.clear();
  const fsel = clampField(), f = L.fields;
  text(g, L.name, 30, 34, { size: 38, weight: '700', color: C.fg });
  text(g, `page ${S.pageId} at file offset ${(S.pageId * L.size).toLocaleString()}  ·  64 of ${L.size.toLocaleString()} bytes shown`, 30, 80, { size: 26, color: C.dim });
  const drawRow = (r, start) => {
    const y = GY + r * CH;
    mono(g, hex(start, 4), GX - 10, y + CH / 2, { size: 22, color: C.dim, align: 'right' });
    for (let c = 0; c < COLS; c++) {
      const o = start + c, x = GX + c * CW, col = byteColor(o), sel = o >= fsel.off && o < fsel.off + fsel.w;
      box(g, x + 2, y + 2, CW - 4, CH - 4, 'rgba(10,14,28,0.5)', sel ? '#ffffff' : col, 5, sel ? 4 : 1.5);
      mono(g, hex(b[o]), x + CW / 2, y + CH / 2, { size: 30, weight: sel ? '700' : '', color: sel ? '#fff' : col, align: 'center' });
    }
  };
  for (let r = 0; r < 4; r++) drawRow(r, r * 16);
  mono(g, '⋮  (' + (L.size - 80).toLocaleString() + ' more bytes)', GX + 8 * CW, GY + 4 * CH + 24, { size: 24, color: C.dim, align: 'center' });
  drawRow(5, L.size - 16);
  text(g, L.id === 'postgres' ? 'last 16 B = special space (btree prev | next | level | flags)' : 'last 8 B = trailer: checksum + low LSN', GX, GY + 6 * CH + 20, { size: 26, color: C.yellow });
  text(g, 'colour = field · white outline = selected field (slider)', GX, GY + 6 * CH + 60, { size: 24, color: C.dim });
  // ---- field zoom
  const RX = 1150, RW = 830;
  box(g, RX - 20, 100, RW + 20, 500, 'rgba(18,24,41,0.88)', C.line, 10);
  text(g, `${S.sel + 1}/${f.length}  ${fsel.name}`, RX, 132, { size: 32, weight: '700', color: FCOL[S.sel % FCOL.length] });
  mono(g, `offset ${fsel.off} = 0x${hex(fsel.off, 4)}   width ${fsel.w} B`, RX, 172, { size: 26 });
  para(g, fsel.desc, RX, 198, RW - 20, { size: 22, lh: 28 });
  const bytes = Array.from(b.slice(fsel.off, fsel.off + fsel.w)), bw = Math.min(96, (RW - 10) / bytes.length - 6);
  bytes.forEach((v, i) => {
    const x = RX + i * (bw + 6), foc = (fsel.off + i) === S.flipByte;
    box(g, x, 296, bw, 44, '#0d1220', foc ? '#fff' : FCOL[S.sel % FCOL.length], 6, foc ? 4 : 2);
    mono(g, hex(v), x + bw / 2, 318, { size: 28, align: 'center' });
  });
  text(g, 'stored low→high address', RX + (bytes.length * (bw + 6)) + 6 > RX + 560 ? RX : RX + bytes.length * (bw + 6) + 6, 318, { size: 22, color: C.dim });
  // bits of focus byte
  const fb = (S.flipByte >= fsel.off && S.flipByte < fsel.off + fsel.w) ? S.flipByte : fsel.off, fv = b[fb];
  text(g, `bits of byte @${fb}:`, RX, 372, { size: 24, color: C.dim });
  for (let k = 0; k < 8; k++) {
    const bit = (fv >> (7 - k)) & 1, x = RX + 250 + k * 70, isF = (7 - k) === S.flipBit;
    box(g, x, 350, 62, 46, bit ? 'rgba(158,206,106,0.35)' : '#171e36', isF ? C.red : (bit ? C.green : C.line), 6, isF ? 4 : 2);
    mono(g, bit, x + 31, 373, { size: 32, color: bit ? C.green : C.dim, align: 'center', weight: '700' });
    mono(g, 7 - k, x + 31, 412, { size: 20, color: isF ? C.red : C.dim, align: 'center' });
  }
  const lev = rd(b, fsel.off, fsel.w, true), bev = rd(b, fsel.off, fsel.w, false);
  mono(g, `little-endian → ${lev.toLocaleString()}${le ? '  ◀ used' : ''}`, RX, 460, { size: 26, color: le ? C.green : C.dim });
  mono(g, `big-endian    → ${bev.toLocaleString()}${!le ? '  ◀ used' : ''}`, RX, 500, { size: 26, color: !le ? C.green : C.dim });
  para(g, le ? 'Low byte first (x86 host order). Page files are not portable across CPU types.' : 'High byte first: memcmp order == numeric order, files portable.', RX, 530, RW - 20, { size: 22, lh: 28 });
  // ---- checksum panel
  const cs = stored(b, L, le), cc = computed(b, L, le), ok = cs === cc, CY = 640, w = L.id === 'postgres' ? 4 : 8;
  box(g, 20, CY, 1090, 540, 'rgba(18,24,41,0.88)', ok ? C.line : C.red, 10, ok ? 1.5 : 4);
  text(g, 'CRC32C checksum (Castagnoli)', 40, CY + 32, { size: 32, weight: '700' });
  mono(g, `stored   0x${hex(cs, w)}`, 40, CY + 78, { size: 30 });
  mono(g, `computed 0x${hex(cc, w)}`, 40, CY + 118, { size: 30, color: ok ? C.green : C.red });
  box(g, 560, CY + 56, 530, 76, ok ? 'rgba(158,206,106,0.15)' : 'rgba(247,118,142,0.22)', ok ? C.green : C.red, 8);
  text(g, ok ? 'VERIFY OK' : 'CORRUPT: mismatch', 825, CY + 94, { size: 32, weight: '700', color: ok ? C.green : C.red, align: 'center' });
  para(g, S.banner || (L.id === 'postgres' ? 'Hash over all 8192 B with the checksum field zeroed (real PG: FNV-1a, 16-bit).' : 'crc32c(bytes 4..26) XOR crc32c(38..16376); copy kept in trailer.'), 40, CY + 148, 1040, { size: 24, lh: 30, color: S.banner ? C.yellow : C.dim });
  text(g, 'Torn page: disks write 4 KB sectors, not whole pages', 40, CY + 262, { size: 28, weight: '700', color: C.yellow });
  const nsec = L.size / 4096;
  for (let i = 0; i < nsec; i++) { const x = 40 + i * (1050 / nsec), ww = 1050 / nsec - 6, isNew = !S.torn || i < nsec / 2;
    box(g, x, CY + 288, ww, 50, isNew ? '#2b4a7a' : '#6a3a3a', isNew ? C.blue : C.red, 5);
    text(g, S.torn ? (isNew ? 'sector: NEW' : 'sector: OLD') : 'sector ' + i + ': new', x + ww / 2, CY + 313, { size: 22, align: 'center' }); }
  text(g, S.dw ? (L.id === 'postgres' ? 'full_page_writes ON: WAL holds a full image → recoverable' : 'doublewrite buffer ON: second copy → recoverable') : 'protection OFF: a torn page is lost', 40, CY + 370, { size: 26, color: S.dw ? C.green : C.red });
  para(g, S.torn ? 'Header LSN is new but the tail is old, so the checksum fails. Press Recover.' : 'Press “Tear the write” to cut a page write in half.', 40, CY + 405, 1040, { size: 24, lh: 30, color: S.torn ? C.red : C.dim });
  para(g, L.id === 'postgres' ? 'Recovery replays the WAL full-page image over the torn page.' : 'Recovery copies the intact page from the doublewrite area.', 40, CY + 470, 1040, { size: 22, lh: 28 });
  // ---- sibling chain
  const BX = 1150, BY = 640;
  box(g, BX - 20, BY, 850, 540, 'rgba(18,24,41,0.88)', C.line, 10);
  text(g, 'Leaf chain: sibling links in page headers', BX, BY + 32, { size: 30, weight: '700' });
  const n = S.chain.length, gap = 40, pw = Math.min(190, (RW - (n - 1) * gap) / n);
  S.chain.forEach((p, i) => {
    const x = BX + i * (pw + gap), sel = p.id === S.pageId;
    box(g, x, BY + 62, pw, 170, sel ? 'rgba(122,162,247,0.2)' : 'rgba(10,14,28,0.6)', sel ? C.blue : C.line, 8, sel ? 4 : 1.5);
    mono(g, `page ${p.id}`, x + pw / 2, BY + 86, { size: 26, align: 'center', weight: '700' });
    mono(g, `prev ${p.prev < 0 ? '-' : p.prev}`, x + 10, BY + 120, { size: 22, color: C.cyan });
    mono(g, `next ${p.next < 0 ? '-' : p.next}`, x + 10, BY + 150, { size: 22, color: C.orange });
    mono(g, p.keys.join(' '), x + pw / 2, BY + 190, { size: 22, color: C.green, align: 'center' });
    mono(g, `${p.keys.length}/4`, x + pw / 2, BY + 218, { size: 20, color: C.dim, align: 'center' });
    if (i < n - 1) { arrow(g, x + pw + 2, BY + 128, x + pw + gap - 2, BY + 128, C.orange, 3); arrow(g, x + pw + gap - 2, BY + 158, x + pw + 2, BY + 158, C.cyan, 3); }
  });
  mono(g, 'parent seps: ' + S.sep.join(' | '), BX, BY + 262, { size: 24, color: C.purple });
  let ly = BY + 296;
  const logs = S.log.slice(-3).reverse();
  logs.forEach((s, i) => { ly = para(g, (i === 0 ? '▶ ' : '· ') + s, BX, ly, RW - 20, { size: 22, lh: 27, color: i === 0 ? C.fg : C.dim }) + 6; });
  P.done();
  const G = inst.G;
  for (let o = 0; o < 64; o++) G.set(o, byteColor(o), o >= fsel.off && o < fsel.off + fsel.w ? 3 : (fieldAt(o) >= 0 ? 1.4 : 0.6));
  for (let o = 0; o < 16; o++) G.set(80 + o, byteColor(L.size - 16 + o), 1);
  G.commit();
}

// ---------- chain ops
const CAP = 4;
function writeLog(s) { S.log.push(s); if (S.log.length > 12) S.log.shift(); }
function insertKey(k) {
  let i = S.chain.findIndex((p, j) => j === S.chain.length - 1 || k < S.sep[j]);
  const p = S.chain[i];
  if (p.keys.includes(k)) { writeLog(`key ${k} exists`); return; }
  p.keys.push(k); p.keys.sort((a, b) => a - b); S.lsn += 0x58;
  if (p.keys.length <= CAP) { writeLog(`insert ${k} → page ${p.id}: fits (rewrite n_recs, heap_top, LSN, checksum)`); }
  else {
    const nid = Math.max(...S.chain.map((x) => x.id)) + 1, mid = Math.ceil(p.keys.length / 2);
    const right = { id: nid, keys: p.keys.splice(mid), prev: p.id, next: p.next };
    const nxt = pg(p.next); p.next = nid; if (nxt) nxt.prev = nid;
    S.chain.splice(i + 1, 0, right); S.sep.splice(i, 0, right.keys[0]);
    writeLog(`SPLIT ${p.id}: new page ${nid} takes ${right.keys.join(',')}. Rewrites ${p.id}.next=${nid}, ${nid}.prev=${p.id}, ${nid}.next=${right.next < 0 ? '-' : right.next}${nxt ? `, ${nxt.id}.prev=${nid}` : ''}`);
  }
  S.sep = S.chain.slice(1).map((x) => x.keys[0]);
  rebuild();
}
function deleteKey(k) {
  const i = S.chain.findIndex((p) => p.keys.includes(k)); if (i < 0) { writeLog(`key ${k} not found`); return; }
  const p = S.chain[i]; p.keys.splice(p.keys.indexOf(k), 1); S.lsn += 0x58;
  if (p.keys.length >= 2) writeLog(`delete ${k} from page ${p.id}: mark record deleted, PAGE_N_RECS--`);
  else {
    const L = S.chain[i - 1], R = S.chain[i + 1];
    const sib = (L && L.keys.length > 2) ? L : (R && R.keys.length > 2) ? R : null;
    if (sib) { const kk = sib === L ? sib.keys.pop() : sib.keys.shift(); p.keys.push(kk); p.keys.sort((a, b) => a - b); writeLog(`REBALANCE: page ${p.id} borrowed ${kk} from ${sib.id}; parent separator changes, links unchanged`); }
    else {
      const left = L || p, right = L ? p : R;
      if (!right) { writeLog('only one page'); return; }
      left.keys.push(...right.keys); left.next = right.next; const n2 = pg(right.next); if (n2) n2.prev = left.id;
      S.chain.splice(S.chain.indexOf(right), 1);
      writeLog(`MERGE ${right.id} into ${left.id}: ${left.id}.next=${left.next < 0 ? '-' : left.next}${n2 ? `, ${n2.id}.prev=${left.id}` : ''}; page ${right.id} freed`);
    }
  }
  S.sep = S.chain.slice(1).map((x) => x.keys[0]);
  rebuild();
}
let insKey = 65;

function setLayout(v) { S.L = v === 'innodb' ? INNO : PG; S.le = S.L.le; S.sel = 0; S.torn = false; rebuild(); }

export const views = {
  'page-file': {
    build(ctx) {
      mkChain(); S.L = PG; S.le = true; S.sel = 0; S.torn = false; S.lsn = 0x1A2B3C40;
      const sc = scaffold(), P = panel(20, 12, 100, { depthWrite: false }); P.mesh.position.set(0, 0, 0.5); sc.group.add(P.mesh);
      const G = cellGrid(16, 6, CW / 100, CH / 100, 0.2);
      const rowsFix = G; G.mesh.position.set(-10 + GX / 100, 6 - GY / 100, 0);
      sc.group.add(G.mesh);
      // base slab representing the page
      const slab = new THREE.Mesh(new THREE.BoxGeometry(20.2, 12.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x0e1424 })); slab.position.z = -0.2; sc.group.add(slab);
      inst = { P, G }; rebuild();
      const steps = [
        { title: 'Page = fixed-size byte array', text: 'The unit of I/O and caching is a page (PG 8 KB, InnoDB 16 KB). Every structure is just offsets into this array. Highlighted bytes are one header field; cycle fields with the “field” slider.', run() { S.sel = 0; draw(); } },
        { title: 'Header fields at fixed offsets', text: 'LSN, checksum, flags, free-space bounds (lower/upper), special-space offset. Fixed offsets mean no parsing: pd_lower is always at bytes 12-13.', run() { S.sel = 3; draw(); } },
        { title: 'Byte order', text: 'The same 2 bytes 0x00 0x20 mean 8192 or 32 depending on endianness. Press “byte order” to rewrite the whole header in the other order and see the interpretation lines swap.', run() { S.sel = 6; draw(); } },
        { title: 'Flip a bit → checksum fails', text: 'Press “Flip bit” (it flips the chosen byte/bit without restamping). CRC32C is recomputed live; stored ≠ computed and the buffer manager reports a corrupt page.', run() { flip(); } },
        { title: 'Torn page', text: 'A write that dies half way leaves a Frankenstein page. Press “Tear the write”, then toggle doublewrite/full_page_writes and “Recover”.', run() { tear(); } },
        { title: 'Sibling links & split', text: 'Insert key 65 into the full page 5: split allocates page 7, and four header fields are rewritten (PREV/NEXT on three pages) - watch the chain and log.', run() { insKey = 65; insertKey(65); } },
      ];
      return {
        group: sc.group, steps,
        update() { if (S.dirty) { S.dirty = false; draw(); } },
        onConfigChange() {}, dispose() { sc.dispose(); P.dispose(); G.dispose(); slab.geometry.dispose(); slab.material.dispose(); inst = null; },
      };
    },
    controls: [
      { id: 'layout', label: 'Page format', type: 'select', options: [{ value: 'postgres', label: 'PostgreSQL 8KB (LE)' }, { value: 'innodb', label: 'InnoDB 16KB (BE)' }], value: 'postgres', onChange: (v) => setLayout(v) },
      { id: 'field', label: 'Header field to zoom into', type: 'range', min: 0, max: 17, value: 0, onChange: (v) => { S.sel = v; S.flipByte = clampField().off; S.dirty = true; } },
      { id: 'endian', label: 'Byte order (re-serialise page)', type: 'select', options: [{ value: 'le', label: 'little-endian' }, { value: 'be', label: 'big-endian' }], value: 'le', onChange: (v) => { S.le = v === 'le'; rebuild(); } },
      { id: 'flipbyte', label: 'Flip: byte offset', type: 'range', min: 0, max: 16383, value: 0, onChange: (v) => { S.flipByte = v; S.dirty = true; } },
      { id: 'flipbit', label: 'Flip: bit (0=LSB)', type: 'range', min: 0, max: 7, value: 0, onChange: (v) => { S.flipBit = v; S.dirty = true; } },
      { id: 'flip', label: 'Flip bit (corrupt, no restamp)', type: 'button', onChange: () => flip() },
      { id: 'bump', label: 'Increment selected field (no restamp)', type: 'button', onChange: () => { const f = clampField(); wr(S.buf, f.off, f.w, rd(S.buf, f.off, f.w, S.le) + 1, S.le); S.banner = 'field changed without re-stamping checksum'; S.dirty = true; } },
      { id: 'stamp', label: 'Write page (new LSN + stamp checksum)', type: 'button', onChange: () => { S.lsn += 0x30; S.buf = buildPage(S.pageId, S.lsn); S.torn = false; S.dirty = true; } },
      { id: 'tear', label: 'Tear the write (power loss mid-page)', type: 'button', onChange: () => tear() },
      { id: 'dw', label: 'doublewrite / full_page_writes', type: 'toggle', value: true, onChange: (v) => { S.dw = v; S.dirty = true; } },
      { id: 'recover', label: 'Recover from copy', type: 'button', onChange: () => { if (S.torn && S.dw && S.copy) { S.buf = S.copy; S.torn = false; S.banner = ''; } else if (S.torn) S.banner = 'NO COPY: page unrecoverable (restore from backup)'; S.dirty = true; } },
      { id: 'page', label: 'Inspect page id', type: 'range', min: 4, max: 12, value: 5, onChange: (v) => { S.pageId = v; rebuild(); } },
      { id: 'inskey', label: 'Key to insert/delete', type: 'range', min: 1, max: 120, value: 65, onChange: (v) => { insKey = v; } },
      { id: 'ins', label: 'Insert key (splits when >4 keys)', type: 'button', onChange: () => insertKey(insKey) },
      { id: 'del', label: 'Delete key (rebalance / merge)', type: 'button', onChange: () => deleteKey(insKey) },
    ],
  },
};
function flip() {
  const o = Math.min(S.flipByte, S.L.size - 1); S.buf[o] ^= 1 << S.flipBit; S.banner = `bit ${S.flipBit} of byte ${o} flipped → checksum mismatch`; S.dirty = true;
}
function tear() {
  const old = S.buf.slice(); const half = S.L.size / 2; S.lsn += 0x30;
  const nw = buildPage(S.pageId, S.lsn);
  // new version also changes content in the second half so the tear is visible
  for (let i = half; i < S.L.size - 20; i += 97) nw[i] ^= 0x5A; stamp(nw, S.L, S.le);
  S.copy = S.dw ? nw.slice() : null; const t = nw.slice(); t.set(old.subarray(half), half); S.buf = t; S.torn = true; S.banner = 'TORN PAGE: header says new, tail is old'; S.dirty = true;
}
