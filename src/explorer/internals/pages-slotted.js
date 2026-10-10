// slotted-page: header | slot array -> ... free space ... <- tuples. Real 512-byte teaching page, real offsets.
import * as THREE from 'three';
import { C, panel, box, text, mono, line, arrow, para, hex, wr, rd, ascii, cellGrid, scaffold } from './_kitD.js';

const PS = 512, HDR = 16, SLOT = 4, OVF_LIMIT = 40, PAGE_ID = 7;
const NAMES = ['Ada', 'Grace', 'Linus', 'Margaret', 'Edsger', 'Barbara', 'Ken', 'Radia', 'Niklaus', 'Donald'];
const OWN = [C.blue, C.purple, C.yellow, C.green, C.orange, C.pink, C.cyan, '#c3e88d', '#ff757f', '#82aaff', '#ffc777', '#c099ff'];
const LOREM = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ';
const SEGC = { flags: C.red, natts: C.orange, nullmap: C.yellow, id: C.green, age: C.cyan, offs: C.purple, name: C.blue, bio: C.pink, ovf: '#ff757f' };

const S = { buf: new Uint8Array(PS), nextId: 1, sel: 0, log: [], flash: new Float32Array(PS), dirty: true, ui: { name: 'Ada', age: 30, bio: 20, auto: true }, ovf: new Map(), ovfNext: 12, owners: new Int16Array(PS) };
let inst = null;

const nslots = () => rd(S.buf, 4, 2), lower = () => rd(S.buf, 6, 2), upper = () => rd(S.buf, 8, 2), garbage = () => rd(S.buf, 10, 2);
const slotOff = (i) => rd(S.buf, HDR + SLOT * i, 2), slotLen = (i) => rd(S.buf, HDR + SLOT * i + 2, 2);
const live = (i) => slotLen(i) > 0;
function setSlot(i, off, len) { wr(S.buf, HDR + SLOT * i, 2, off); wr(S.buf, HDR + SLOT * i + 2, 2, len); }
function resetPage() {
  S.buf = new Uint8Array(PS); wr(S.buf, 0, 4, PAGE_ID); wr(S.buf, 4, 2, 0); wr(S.buf, 6, 2, HDR); wr(S.buf, 8, 2, PS); wr(S.buf, 10, 2, 0); wr(S.buf, 12, 2, 0x0001); wr(S.buf, 14, 2, 0);
  S.nextId = 1; S.sel = 0; S.log = ['empty page: lower=16, upper=512 (free = 496)']; S.ovf = new Map(); S.flash.fill(0); S.dirty = true;
}
function bioText(len, seed) { let s = ''; while (s.length < len) s += LOREM; return s.slice(0, len); }

// ---- cell encoding: [flags][natts][nullmap][id i32][age i16?][varlen end-offsets u16 *][varlen bytes] ; overflow = 8B pointer
function encodeRow(r) {
  const nul = (r.age == null ? 2 : 0) | (r.bio == null ? 8 : 0);
  let flags = 0x02 | (nul ? 0x01 : 0), segs = [], out = [];
  const push = (name, bytes) => { segs.push({ name, start: out.length, len: bytes.length }); out.push(...bytes); };
  const idb = new Uint8Array(4); wr(idb, 0, 4, r.id);
  const nameB = ascii(r.name); let bioB = null, ovf = null;
  if (r.bio != null) { if (r.bio.length > OVF_LIMIT) { ovf = new Uint8Array(8); const pid = S.ovfNext; wr(ovf, 0, 4, pid); wr(ovf, 4, 4, r.bio.length); bioB = Array.from(ovf); flags |= 0x04; } else bioB = ascii(r.bio); }
  const ends = []; let acc = nameB.length; ends.push(acc); if (bioB) { acc += bioB.length; ends.push(acc); }
  out.length = 0; segs = [];
  push('flags', [flags]); push('natts', [4]); push('nullmap', [nul]); push('id', Array.from(idb));
  if (r.age != null) { const a = new Uint8Array(2); wr(a, 0, 2, r.age); push('age', Array.from(a)); }
  const ob = []; ends.forEach((e) => { const t = new Uint8Array(2); wr(t, 0, 2, e); ob.push(...t); }); push('offs', ob);
  push('name', nameB); if (bioB) push(ovf ? 'ovf' : 'bio', bioB);
  return { bytes: Uint8Array.from(out), segs, overflow: ovf ? { pid: S.ovfNext, text: r.bio } : null };
}
function decodeRow(b, off, len) {  // from real page bytes
  const flags = S.buf[off], nul = S.buf[off + 2]; let p = off + 3;
  const id = rd(S.buf, p, 4); p += 4; let age = null; if (!(nul & 2)) { age = rd(S.buf, p, 2); p += 2; }
  const nv = (nul & 8) ? 1 : 2, ends = []; for (let i = 0; i < nv; i++) { ends.push(rd(S.buf, p, 2)); p += 2; }
  const data = p; const name = String.fromCharCode(...S.buf.slice(data, data + ends[0]));
  let bio = null, ovfp = null; if (nv === 2) { const bb = S.buf.slice(data + ends[0], data + ends[1]); if (flags & 4) ovfp = { pid: rd(bb, 0, 4), len: rd(bb, 4, 4) }; else bio = String.fromCharCode(...bb); }
  return { flags, id, age, name, bio, ovfp, nul };
}
function segsFor(off, len) { // recompute segments by decoding layout
  const row = decodeRow(null, off, len), segs = []; let p = 0; const add = (n, l) => { segs.push({ name: n, start: p, len: l }); p += l; };
  add('flags', 1); add('natts', 1); add('nullmap', 1); add('id', 4); if (row.age != null) add('age', 2);
  const nv = (row.nul & 8) ? 1 : 2; add('offs', 2 * nv); add('name', row.name.length); if (nv === 2) add(row.ovfp ? 'ovf' : 'bio', row.ovfp ? 8 : row.bio.length);
  return { segs, row };
}

const flashRange = (a, b) => { for (let i = a; i < b && i < PS; i++) S.flash[i] = 1; };
const free = () => upper() - lower();
function compact(why) {
  const items = []; for (let i = 0; i < nslots(); i++) if (live(i)) items.push({ i, off: slotOff(i), len: slotLen(i) });
  items.sort((a, b) => b.off - a.off); let end = PS; const moves = [], copy = S.buf.slice();
  S.buf.fill(0, upper(), PS);
  for (const it of items) { end -= it.len; S.buf.set(copy.subarray(it.off, it.off + it.len), end); if (end !== it.off) moves.push(`s${it.i}:${it.off}→${end}`); setSlot(it.i, end, it.len); }
  wr(S.buf, 8, 2, end); wr(S.buf, 10, 2, 0); flashRange(end, PS);
  S.log.push(`COMPACT${why ? ' (' + why + ')' : ''}: moved ${moves.length} tuple(s) ${moves.join(' ')}; upper=${end}, garbage=0. Slot numbers (RIDs) unchanged.`);
}
function place(cell, slot) { // slot: existing index or -1 to allocate
  let need = cell.length + (slot < 0 ? SLOT : 0);
  if (free() < need) { if (free() + garbage() >= need && S.ui.auto) compact('not enough contiguous free space'); }
  if (free() < need) return false;
  const off = upper() - cell.length; S.buf.set(cell, off); wr(S.buf, 8, 2, off);
  if (slot < 0) { slot = nslots(); wr(S.buf, 4, 2, slot + 1); wr(S.buf, 6, 2, lower() + SLOT); }
  setSlot(slot, off, cell.length); flashRange(off, off + cell.length); flashRange(HDR + SLOT * slot, HDR + SLOT * slot + SLOT);
  return slot;
}
function curRow(id) { return { id, age: S.ui.age === 0 ? null : S.ui.age, name: S.ui.name, bio: S.ui.bio === 0 ? null : bioText(S.ui.bio) }; }
function doInsert() {
  const row = curRow(S.nextId), enc = encodeRow(row);
  let dead = -1; for (let i = 0; i < nslots(); i++) if (!live(i)) { dead = i; break; }
  const s = place(enc.bytes, dead);
  if (s === false) { S.log.push(`INSERT id=${row.id} FAILED: need ${enc.bytes.length}+${dead < 0 ? 4 : 0} B, free ${free()} B, reclaimable garbage ${garbage()} B → page full (heap would pick another page; FSM / free-space map)`); S.dirty = true; return; }
  if (enc.overflow) { S.ovf.set(enc.overflow.pid, enc.overflow.text); S.ovfNext++; }
  S.nextId++; S.sel = s;
  S.log.push(`INSERT id=${row.id}: ${enc.bytes.length}-byte cell at offset ${slotOff(s)} (upper ${upper() + enc.bytes.length}→${upper()}), ${dead >= 0 ? 'reused tombstoned' : 'new'} slot ${s} → RID (${PAGE_ID},${s})${enc.overflow ? `; bio ${row.bio.length} B > ${OVF_LIMIT} → stored on overflow page ${enc.overflow.pid}, 8-byte pointer inline` : ''}`);
  S.dirty = true;
}
function doDelete() {
  const i = S.sel; if (i >= nslots() || !live(i)) { S.log.push('slot ' + i + ' is not live'); S.dirty = true; return; }
  const off = slotOff(i), len = slotLen(i); setSlot(i, 0, 0); wr(S.buf, 10, 2, garbage() + len);
  S.log.push(`DELETE slot ${i}: slot zeroed (tombstone: offset 0, len 0); ${len} B at ${off} become garbage (not reclaimed until compaction). Other RIDs unaffected.`); flashRange(HDR + SLOT * i, HDR + SLOT * i + SLOT); S.dirty = true;
}
function doUpdate() {
  const i = S.sel; if (i >= nslots() || !live(i)) { S.log.push('slot ' + i + ' is not live'); S.dirty = true; return; }
  const off = slotOff(i), len = slotLen(i), old = decodeRow(null, off, len), row = curRow(old.id), enc = encodeRow(row);
  if (enc.bytes.length <= len) { S.buf.set(enc.bytes, off); setSlot(i, off, enc.bytes.length); wr(S.buf, 10, 2, garbage() + len - enc.bytes.length); flashRange(off, off + len); S.log.push(`UPDATE slot ${i}: ${enc.bytes.length} B ≤ ${len} B → overwritten in place at ${off}; ${len - enc.bytes.length} B tail becomes garbage`); }
  else {
    setSlot(i, 0, 0); wr(S.buf, 10, 2, garbage() + len); // free the old copy first (as if reclaiming), then place; restore on failure
    const before = S.buf.slice(); const s = place(enc.bytes, i);
    if (s === false) { S.buf = before; setSlot(i, off, len); wr(S.buf, 10, 2, garbage() - len); S.log.push(`UPDATE slot ${i} FAILED: new version ${enc.bytes.length} B does not fit even after compaction → engine migrates row to another page and leaves a forwarding pointer (PG: t_ctid chain / HOT; InnoDB: split)`); }
    else { S.log.push(`UPDATE slot ${i}: grew ${len}→${enc.bytes.length} B, relocated ${off}→${slotOff(i)}; slot ${i} now points there so RID (${PAGE_ID},${i}) is unchanged`); }
  }
  if (enc.overflow) { S.ovf.set(enc.overflow.pid, enc.overflow.text); S.ovfNext++; }
  S.dirty = true;
}

// ---- ownership map for byte colouring
function computeOwners() {
  const o = S.owners; o.fill(-1); // -1 free, -2 header, -3 slot array, -4 garbage
  for (let i = 0; i < HDR; i++) o[i] = -2; for (let i = HDR; i < lower(); i++) o[i] = -3;
  for (let i = upper(); i < PS; i++) o[i] = -4;
  for (let i = 0; i < nslots(); i++) if (live(i)) for (let k = slotOff(i); k < slotOff(i) + slotLen(i); k++) o[k] = i;
}
const GX = 90, GY = 112, CELL = 19;
function draw() {
  const P = inst.P, g = P.g; P.clear(); computeOwners();
  text(g, `Slotted page · ${PS}-byte teaching page (real engines: 8 KB / 16 KB)`, 30, 36, { size: 38, weight: '700' });
  for (let r = 0; r < 8; r++) mono(g, hex(r * 64, 4), GX - 8, GY + r * CELL + CELL / 2, { size: 16, color: C.dim, align: 'right' });
  // legend
  const leg = [['header', C.dim], ['slot array →', C.cyan], ['free gap', '#2a3350'], ['← tuples', C.blue], ['garbage', C.red]];
  let lx = GX; leg.forEach(([n, c]) => { box(g, lx, GY + 8 * CELL + 14, 22, 22, c, null, 4); text(g, n, lx + 30, GY + 8 * CELL + 26, { size: 24 }); lx += 40 + n.length * 14; });
  // markers for lower/upper
  const mk = (off, label, col, row2) => { const r = (off / 64) | 0, c = off % 64, x = GX + c * CELL, y = GY + r * CELL; line(g, x, y - 6, x, y + CELL + 6, col, 3); text(g, label, x, y - (row2 ? 28 : 16), { size: 22, color: col, align: 'center', weight: '700' }); };
  if (lower() < PS) mk(lower(), `lower=${lower()}`, C.cyan, false); if (upper() < PS) mk(upper(), `upper=${upper()}`, C.orange, true);
  // slot table
  const TY = 340; text(g, 'slot array (4 B each: offset u16, length u16)  ·  RID = (page, slot)', 30, TY, { size: 26, weight: '700', color: C.cyan });
  const n = nslots(), shown = Math.min(n, 10), rowH = 38, y0 = TY + 30;
  ['slot', 'raw bytes', 'offset', 'len', 'RID', 'decoded row'].forEach((h, i) => text(g, h, [30, 120, 330, 430, 520, 680][i], y0 + 12, { size: 22, color: C.dim }));
  for (let i = 0; i < shown; i++) {
    const y = y0 + 34 + i * rowH, sel = i === S.sel, lv = live(i);
    if (sel) box(g, 20, y - 2, 1290, rowH - 2, 'rgba(255,255,255,0.08)', '#fff', 5, 2);
    mono(g, i, 44, y + 16, { size: 26, color: lv ? OWN[i % OWN.length] : C.red, weight: '700' });
    mono(g, [0, 1, 2, 3].map((k) => hex(S.buf[HDR + SLOT * i + k])).join(' '), 120, y + 16, { size: 26, color: C.fg });
    mono(g, lv ? slotOff(i) : '—', 330, y + 16, { size: 26 }); mono(g, lv ? slotLen(i) : '0', 430, y + 16, { size: 26 });
    mono(g, `(${PAGE_ID},${i})`, 520, y + 16, { size: 26, color: C.yellow });
    if (lv) { const r = decodeRow(null, slotOff(i), slotLen(i)); mono(g, `id=${r.id} ${r.name} age=${r.age ?? 'NULL'} bio=${r.bio == null ? (r.ovfp ? `OVERFLOW→pg${r.ovfp.pid}(${r.ovfp.len}B)` : 'NULL') : r.bio.length + 'B'}`, 680, y + 16, { size: 24, color: C.fg }); }
    else mono(g, 'TOMBSTONE (dead slot, reusable)', 680, y + 16, { size: 24, color: C.red });
  }
  if (n > shown) text(g, `… ${n - shown} more slots`, 44, y0 + 34 + shown * rowH + 14, { size: 22, color: C.dim });
  // tuple decode
  const DY = 850; box(g, 20, DY - 10, 1290, 340, 'rgba(18,24,41,0.88)', C.line, 10);
  if (S.sel < n && live(S.sel)) {
    const off = slotOff(S.sel), len = slotLen(S.sel), { segs, row } = segsFor(off, len);
    text(g, `cell of slot ${S.sel}: ${len} bytes at page offset ${off} (0x${hex(off, 4)})`, 40, DY + 22, { size: 28, weight: '700' });
    const per = 32, bw = 38, pad = 40; const segAt = (k) => segs.find((s) => k >= s.start && k < s.start + s.len);
    for (let k = 0; k < len; k++) {
      const r = (k / per) | 0, c = k % per, x = pad + c * (bw + 3), y = DY + 54 + r * 100, sg = segAt(k), col = SEGC[sg.name];
      box(g, x, y, bw, 38, 'rgba(10,14,28,0.7)', col, 4, 1.5); mono(g, hex(S.buf[off + k]), x + bw / 2, y + 19, { size: 22, align: 'center' });
      if (k === sg.start) text(g, sg.name, x, y + 52 + (segs.indexOf(sg) % 2) * 24, { size: 22, color: col, weight: '700' });
    }
    const rows = Math.ceil(len / per), ty = DY + 54 + rows * 100 - 10;
    para(g, `null bitmap 0b${row.nul.toString(2).padStart(4, '0')} (bit i set = column i NULL: age ${row.nul & 2 ? 'NULL, 2 bytes omitted' : 'present'}, bio ${row.nul & 8 ? 'NULL' : 'present'}) · varlen end-offsets let you find name/bio without scanning · flags 0x${hex(row.flags)}${row.flags & 4 ? ' = overflow pointer' : ''}`, 40, ty, 1230, { size: 22, lh: 28, color: C.dim });
    if (row.ovfp) para(g, `overflow page ${row.ovfp.pid} holds the ${row.ovfp.len}-byte bio; inline cell keeps only (page id u32, length u32). PG TOAST / InnoDB off-page BLOB do the same so a page never has a huge cell.`, 40, ty + 62, 1230, { size: 22, lh: 28, color: C.pink });
  } else text(g, `slot ${S.sel} is ${S.sel < n ? 'a tombstone' : 'not allocated'} — select a live slot (slider) to see its bytes`, 40, DY + 40, { size: 28, color: C.dim });
  // right column
  const RX = 1350; box(g, RX - 20, 100, 660, 370, 'rgba(18,24,41,0.88)', C.line, 10);
  text(g, 'page header (16 B)', RX, 130, { size: 28, weight: '700' });
  const hl = [['page_id', `${rd(S.buf, 0, 4)}`], ['n_slots', n], ['lower', `${lower()}  (end of slot array)`], ['upper', `${upper()}  (start of newest cell)`], ['garbage', `${garbage()} B reclaimable`], ['flags', '0x' + hex(rd(S.buf, 12, 2), 4)]];
  hl.forEach(([k, v], i) => { mono(g, k, RX, 170 + i * 36, { size: 24, color: C.dim }); mono(g, v, RX + 170, 170 + i * 36, { size: 24 }); });
  const fr = free(); mono(g, `free = upper − lower = ${fr} B`, RX, 400, { size: 26, color: C.green });
  mono(g, `usable after compaction = ${fr + garbage()} B`, RX, 436, { size: 24, color: C.yellow });
  box(g, RX - 20, 490, 660, 700, 'rgba(18,24,41,0.88)', C.line, 10);
  text(g, 'what just happened', RX, 520, { size: 28, weight: '700' });
  let ly = 550; S.log.slice(-4).reverse().forEach((s, i) => { ly = para(g, (i === 0 ? '▶ ' : '· ') + s, RX, ly, 630, { size: 23, lh: 29, color: i === 0 ? C.fg : C.dim }) + 8; });
  const kn = live(S.sel) ? slotOff(S.sel) : 0;
  box(g, RX, 1060, 620, 110, 'rgba(10,14,28,0.7)', C.yellow, 8);
  mono(g, `index leaf: id → RID (${PAGE_ID},${S.sel})`, RX + 14, 1086, { size: 24, color: C.yellow });
  mono(g, `RID → slot[${S.sel}] → byte ${kn || '—'}`, RX + 14, 1124, { size: 24 });
  P.done();
}
function paintCells(dt) {
  const G = inst.G; let any = false;
  for (let i = 0; i < PS; i++) {
    const o = S.owners[i], f = S.flash[i]; if (f > 0) { S.flash[i] = Math.max(0, f - dt * 0.8); any = true; }
    const col = o === -2 ? '#55618a' : o === -3 ? C.cyan : o === -4 ? '#7a2e3d' : o === -1 ? '#1a2238' : OWN[o % OWN.length];
    G.set(i, col, (o === -1 ? 0.25 : o === -4 ? 0.5 : 1) + f * 2);
  }
  G.commit(); return any;
}
export const views = {
  'slotted-page': {
    build(ctx) {
      resetPage(); const sc = scaffold(), P = panel(20, 12, 100, { depthWrite: false }); P.mesh.position.z = 0.9; sc.group.add(P.mesh);
      const G = cellGrid(64, 8, CELL / 100, CELL / 100, 0.18); G.mesh.position.set(-10 + GX / 100, 6 - GY / 100, 0); sc.group.add(G.mesh);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(20.2, 12.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x0e1424 })); slab.position.z = -0.2; sc.group.add(slab);
      inst = { P, G }; for (const [nm, a, b] of [['Ada', 31, 20], ['Grace', 45, 0], ['Linus', 0, 90], ['Margaret', 52, 25], ['Edsger', 70, 12]]) { S.ui = { ...S.ui, name: nm, age: a, bio: b }; doInsert(); }
      S.ui = { name: 'Ada', age: 30, bio: 20, auto: true }; S.sel = 0; S.log = ['5 rows inserted: slots grow right →, cells grow left ←']; S.dirty = true; computeOwners();
      const steps = [
        { title: 'Two ends grow toward each other', text: 'Slot array (cyan) grows forward from byte 16; cells (colours) grow backward from byte 512. free = upper − lower.', run() { S.log.push('free gap is the dark region between the cyan slots and the first cell'); S.dirty = true; } },
        { title: 'Insert a row', text: 'The row is serialised (flags, null bitmap, fixed fields, varlen offsets, data), placed at upper−len, and a 4-byte slot (offset,len) is appended.', run() { doInsert(); } },
        { title: 'Overflow pointer', text: `A bio longer than ${OVF_LIMIT} B is moved to an overflow page; the cell keeps an 8-byte pointer (TOAST / off-page BLOB).`, run() { S.ui.bio = 120; doInsert(); S.ui.bio = 20; } },
        { title: 'Delete → tombstone', text: 'Deleting zeroes the slot but leaves cell bytes as garbage (red). Other slot numbers do not shift, so RIDs held by indexes stay valid.', run() { S.sel = 1; doDelete(); } },
        { title: 'Update that grows', text: 'A larger version cannot overwrite in place: it is placed in free space, and the SLOT now points at the new offset, so the RID is the same.', run() { S.sel = 0; S.ui.bio = 38; doUpdate(); } },
        { title: 'Compaction', text: 'Live cells are repacked against the page end, slot offsets rewritten. Slot numbers (RIDs) never change.', run() { compact('manual'); S.dirty = true; } },
      ];
      return {
        group: sc.group, steps,
        update(dt) { if (S.dirty) { S.dirty = false; draw(); } paintCells(dt); },
        onConfigChange() {}, dispose() { sc.dispose(); P.dispose(); G.dispose(); slab.geometry.dispose(); slab.material.dispose(); inst = null; },
      };
    },
    controls: [
      { id: 'name', label: 'name', type: 'select', options: NAMES, value: 'Ada', onChange: (v) => { S.ui.name = v; } },
      { id: 'age', label: 'age (0 = NULL)', type: 'range', min: 0, max: 90, value: 30, onChange: (v) => { S.ui.age = v; } },
      { id: 'bio', label: 'bio length bytes (0 = NULL, >40 = overflow)', type: 'range', min: 0, max: 200, value: 20, onChange: (v) => { S.ui.bio = v; } },
      { id: 'insert', label: 'Insert row', type: 'button', onChange: () => doInsert() },
      { id: 'slot', label: 'Selected slot', type: 'range', min: 0, max: 15, value: 0, onChange: (v) => { S.sel = v; S.dirty = true; } },
      { id: 'update', label: 'Update selected slot with current fields', type: 'button', onChange: () => doUpdate() },
      { id: 'delete', label: 'Delete selected slot', type: 'button', onChange: () => doDelete() },
      { id: 'compact', label: 'Compact page', type: 'button', onChange: () => { compact('manual'); S.dirty = true; } },
      { id: 'auto', label: 'Auto-compact when fragmented', type: 'toggle', value: true, onChange: (v) => { S.ui.auto = v; } },
      { id: 'fill', label: 'Fill page', type: 'button', onChange: () => { let g = 0; while (g++ < 40) { const b = S.log.length, id = S.nextId; S.ui.bio = 10 + ((g * 37) % 60); S.ui.name = NAMES[g % 10]; doInsert(); if (S.nextId === id) break; } S.ui.bio = 20; } },
      { id: 'reset', label: 'Reset page', type: 'button', onChange: () => resetPage() },
    ],
  },
};
