import { h, btn, canvas, C } from '../kit.js';

function crc32(bytes) { let c, crc = 0xffffffff; for (let i = 0; i < bytes.length; i++) { c = (crc ^ bytes[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }

function mount(el) {
  const SIZE = 256, HDR = 8, SLOT = 4; // toy page: 256 bytes
  let slots = [], nextId = 1, upper = SIZE; // slots: {off,len,id,live}
  const page = new Uint8Array(SIZE);
  const { cv, ctx, w, h: H } = canvas(720, 190); const out = h('div', { class: 'out' });
  const lenIn = h('input', { type: 'number', value: 30, min: 4, max: 200, style: { width: '70px', background: '#0b0e17', color: '#fff', border: '1px solid #2a3350', borderRadius: '6px', padding: '4px' } });
  let stored = null, flipped = '';
  const free = () => upper - (HDR + slots.length * SLOT);
  function writePage() {
    page.fill(0); page[0] = slots.length; page[2] = upper >> 8; page[3] = upper & 255;
    slots.forEach((s, i) => { const p = HDR + i * SLOT; page[p] = s.off >> 8; page[p + 1] = s.off & 255; page[p + 2] = s.live ? s.len : 0; page[p + 3] = s.live ? 1 : 0; if (s.live) for (let j = 0; j < s.len; j++) page[s.off + j] = 65 + (s.id % 26); });
    const c = crc32(page.subarray(8)); page[4] = c >>> 24; page[5] = c >>> 16 & 255; page[6] = c >>> 8 & 255; page[7] = c & 255; stored = c;
  }
  function insert() { const L = +lenIn.value; const need = L + SLOT; if (need > free()) { flipped = 'no room: need ' + need + ' bytes (tuple + 4-byte slot), only ' + free() + ' free.'; return draw(); } upper -= L; slots.push({ off: upper, len: L, id: nextId++, live: true }); flipped = ''; writePage(); draw(); }
  function del() { const live = slots.filter((s) => s.live); if (!live.length) return; live[Math.floor(Math.random() * live.length)].live = false; flipped = 'slot tombstoned; space is NOT yet reusable until compaction.'; writePage(); draw(); }
  function compact() { let top = SIZE; slots.filter((s) => s.live).forEach((s) => { top -= s.len; s.off = top; }); upper = top; flipped = 'compacted: live tuples slid to the end; slot numbers (tuple ids) unchanged.'; writePage(); draw(); }
  function flip() { const i = 8 + Math.floor(Math.random() * (SIZE - 8)); page[i] ^= 1 << Math.floor(Math.random() * 8); const c = crc32(page.subarray(8)); flipped = `bit flipped at byte ${i}. stored CRC32 ${stored.toString(16)} vs computed ${c.toString(16)} -> ` + (c === stored ? 'collision (unlikely)' : 'CORRUPTION DETECTED on read'); draw(true); }
  function draw(keep) {
    ctx.clearRect(0, 0, w, H); const bw = 700, x0 = 10, y0 = 30, sc = bw / SIZE;
    ctx.fillStyle = '#34406a'; ctx.fillRect(x0, y0, HDR * sc, 40); ctx.fillStyle = C.fg; ctx.font = '10px monospace'; ctx.fillText('hdr', x0 + 4, y0 + 24);
    slots.forEach((s, i) => { ctx.fillStyle = s.live ? C.accent : '#555'; ctx.fillRect(x0 + (HDR + i * SLOT) * sc, y0, SLOT * sc - 1, 40); ctx.fillStyle = '#0b0e17'; ctx.fillText('s' + i, x0 + (HDR + i * SLOT) * sc + 1, y0 + 24); });
    const fs = HDR + slots.length * SLOT; ctx.fillStyle = '#10152a'; ctx.fillRect(x0 + fs * sc, y0, (upper - fs) * sc, 40); ctx.strokeStyle = C.line; ctx.strokeRect(x0 + fs * sc, y0, (upper - fs) * sc, 40);
    ctx.fillStyle = C.dim; ctx.fillText('free ' + free() + ' B', x0 + fs * sc + 6, y0 + 24);
    slots.forEach((s) => { ctx.fillStyle = s.live ? C.good : '#3a2330'; ctx.fillRect(x0 + s.off * sc, y0, s.len * sc - 1, 40); ctx.fillStyle = '#0b0e17'; if (s.len * sc > 24) ctx.fillText('t' + s.id, x0 + s.off * sc + 3, y0 + 24); });
    ctx.fillStyle = C.dim; ctx.fillText('offset 0', x0, y0 - 6); ctx.fillText('256', x0 + bw - 20, y0 - 6);
    ctx.fillStyle = C.fg; ctx.font = '12px monospace';
    slots.slice(-6).forEach((s, i) => ctx.fillText(`slot ${slots.indexOf(s)} -> offset ${s.off}, len ${s.len}${s.live ? '' : ' (deleted)'}`, 10, 100 + i * 14));
    ctx.fillStyle = C.dim; ctx.fillText('slot array grows right from the header; tuples grow left from the end', 10, 186);
    if (!keep) { }
    out.textContent = `header 8 B: nslots=${slots.length}, upper(free-space end)=${upper}, crc32=0x${(stored ?? 0).toString(16)}\nfree space = upper - (header + slots*4) = ${free()} B\n` + flipped;
  }
  writePage(); const bar = h('div', { class: 'row' }, h('span', { class: 'dim' }, 'tuple bytes'), lenIn, btn('Insert tuple', insert), btn('Delete random', del), btn('Compact', compact), btn('Flip a random bit', flip), btn('Reset', () => { slots = []; upper = SIZE; flipped = ''; writePage(); draw(); }));
  el.append(bar, cv, out); draw();
}

export default {
  n: 7, title: 'Storage: pages, slotted pages, heap vs index-organized', minutes: 16, cmu: 'CMU 15-445 L3-L4 (Storage)',
  components: ['slotted-page', 'page-file', 'heap-file', 'index-organized-table', 'file-manager'],
  goals: ['Describe how a slotted page stores variable-length tuples and how a tuple is addressed.', 'Contrast heap files with index-organized tables (InnoDB clustered index, SQLite rowid B-tree).', 'Explain checksums, torn pages and why page size matters.'],
  body: `
<h2>Why pages</h2>
<p>Disks and SSDs transfer blocks, not bytes. A DBMS organises everything into fixed-size <b>pages</b>: 8 KB in PostgreSQL, 16 KB in InnoDB, 4 KB default in SQLite (1 KB-64 KB configurable), 256 KB+ blocks in column stores. Pages are the unit of I/O, of caching (buffer pool frames), of locking/latching, and usually of checksumming and logging. Larger pages favour scans and compression and reduce B+tree height; smaller pages reduce write amplification and cache waste for random point access. The OS page (4 KB) matters too: a 16 KB InnoDB page written as four 4 KB sectors can be <b>torn</b> by a crash, which is why InnoDB has a doublewrite buffer and PostgreSQL writes full-page images to the WAL after each checkpoint (<code>full_page_writes</code>).</p>
<h2>The slotted page</h2>
<p>Variable-length tuples (VARCHAR) need indirection. A slotted page has a header, an array of <b>slots</b> growing forward, and tuple bytes growing backward from the end; free space sits between them. Each slot stores (offset, length). A tuple is addressed by a <b>record id (page_id, slot_no)</b>; indexes store this. Deleting marks the slot as dead; compaction slides tuples and updates offsets but keeps slot numbers, so index entries stay valid. PostgreSQL's page header is 24 bytes (pd_lsn, checksum, flags, pd_lower, pd_upper, pd_special) with 4-byte line pointers (ItemIdData: 15-bit offset, 2-bit flags, 15-bit length) and a 23-byte tuple header (xmin, xmax, cid, ctid, infomask).</p>
<div data-demo="0"></div>
<h2>Heap files vs index-organized tables</h2>
<table><tr><th></th><th>Heap file</th><th>Index-organized (clustered)</th></tr>
<tr><td>Layout</td><td>Tuples in any page with space; unordered</td><td>Tuples live in the leaves of a B+tree on the primary key</td></tr>
<tr><td>Systems</td><td>PostgreSQL, Oracle (default), SQL Server heaps</td><td>InnoDB, SQLite (rowid tables), SQL Server clustered, Oracle IOT</td></tr>
<tr><td>Primary key lookup</td><td>index probe + heap fetch (2 steps)</td><td>one B+tree descent</td></tr>
<tr><td>Secondary index entry</td><td>points to physical (page, slot)</td><td>stores the primary key, then second descent</td></tr>
<tr><td>Range scan on PK</td><td>random heap I/O unless clustered</td><td>sequential leaf scan</td></tr>
<tr><td>Insert</td><td>append, cheap</td><td>may split pages if keys are random (UUIDs hurt)</td></tr>
<tr><td>Update moving a row</td><td>new version elsewhere, update all indexes (HOT mitigates)</td><td>in place; secondary indexes unaffected unless PK changes</td></tr></table>
<h2>Byte-level examples</h2>
<p>An InnoDB 16 KB page: 38-byte FIL header (checksum 4 B, page number 4 B, prev/next page 4+4 B, LSN 8 B, type 2 B, space id 4 B), 56-byte page header, infimum/supremum records, user records chained by next-record offsets, a page directory (sparse slots every 4-8 records for binary search), and an 8-byte FIL trailer repeating the checksum and low LSN bits. Integers are stored big-endian in InnoDB, little-endian in PostgreSQL.</p>
<h2>Checksums</h2>
<p>A checksum (CRC32C, xxHash, Fletcher) over page contents detects bit rot and torn writes at read time. PostgreSQL's <code>data_checksums</code> is a 16-bit FNV variant; InnoDB uses CRC32C; SQLite offers an optional checksum VFS. A failed checksum cannot repair data by itself; replication or backups are needed.</p>
<div class="callout ripple"><div class="t">Variable-length overflow</div><p>A row larger than a page spills: PostgreSQL TOASTs values over ~2 KB into a side table with compression; InnoDB keeps a 768-byte prefix (REDUNDANT/COMPACT) or only a 20-byte pointer (DYNAMIC) with the rest in overflow pages.</p></div>`,
  demos: [{ title: 'A 256-byte slotted page', caption: 'Insert, delete, compact and corrupt a toy page; real CRC-32 over the page bytes.', mount }],
  tradeoffs: { head: ['Choice', 'Benefit', 'Cost'], rows: [['Larger pages (16-64 KB)', 'Fewer I/Os for scans, shallower trees, better compression', 'More write amplification, more torn-page risk, cache waste'], ['Smaller pages (4-8 KB)', 'Aligned with OS/SSD, cheap random writes', 'Deeper B+trees, more metadata per byte'], ['Heap + secondary pointers', 'Cheap inserts, indexes point to physical location', 'Updates that move a row touch every index'], ['Clustered / IOT', 'Fast PK lookup and range scan', 'Secondary index lookups need two descents; random PK causes splits'], ['Checksums', 'Detect corruption', 'CPU cost, cannot repair alone']] },
  ripples: [{ to: 'Indexes', text: 'record id format (physical vs primary key) decides secondary-index size and update cost.' }, { to: 'Buffer pool', text: 'page size sets the frame size; a torn-page defence adds doublewrite or full-page WAL images.' }, { to: 'MVCC', text: 'where old versions live (in the heap page, or an undo segment) is a page-layout decision.' }, { to: 'Compression', text: 'compressing a page changes its size on disk, so page-aligned storage needs sparse-file holes or variable block sizes.' }],
  quiz: [{ q: 'In a slotted page, what does an index store to find a tuple?', options: ['Byte offset in the file', '(page id, slot number)', 'The tuple contents'], answer: 1, why: 'The slot indirection lets the tuple move within the page without changing its id.' }, { q: 'Why can UUID primary keys hurt InnoDB inserts?', options: ['They are too small', 'Random keys cause splits across the whole clustered B+tree', 'InnoDB forbids them'], answer: 1, why: 'Inserts land on random leaves, causing cache misses and page splits.' }, { q: 'What problem does InnoDB\'s doublewrite buffer solve?', options: ['Slow reads', 'Torn page writes after a crash', 'Deadlocks'], answer: 1, why: 'A partially written 16 KB page cannot be fixed by redo logs alone; a clean copy is kept.' }],
  refs: [{ title: 'CMU 15-445 schedule (Fall 2024)', url: 'https://15445.courses.cs.cmu.edu/fall2024/schedule.html' }, { title: 'PostgreSQL: Database Page Layout', url: 'https://www.postgresql.org/docs/current/storage-page-layout.html' }, { title: 'Jeremy Cole, InnoDB page structure', url: 'https://blog.jcole.us/innodb/' }, { title: 'SQLite file format', url: 'https://www.sqlite.org/fileformat2.html' }],
};
