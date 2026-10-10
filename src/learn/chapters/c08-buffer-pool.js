import { h, slider, btn, canvas, C } from '../kit.js';

function sim(policy, cap, trace) {
  let hits = 0; const frames = []; // {p, ref, last, hist:[]}
  let hand = 0, t = 0;
  const find = (p) => frames.findIndex((f) => f.p === p);
  for (const p of trace) {
    t++; const i = find(p);
    if (i >= 0) { hits++; const f = frames[i]; f.ref = 1; f.last = t; f.hist = [t, ...f.hist].slice(0, 2); continue; }
    const nf = { p, ref: 1, last: t, hist: [t] };
    if (frames.length < cap) { frames.push(nf); continue; }
    let v = 0;
    if (policy === 'lru') { v = frames.reduce((b, f, k) => f.last < frames[b].last ? k : b, 0); }
    else if (policy === 'clock') { while (frames[hand].ref) { frames[hand].ref = 0; hand = (hand + 1) % cap; } v = hand; hand = (hand + 1) % cap; }
    else { // LRU-2: evict the frame whose 2nd most recent access is oldest (infinite if only 1 access -> evict first, tie by oldest)
      const k2 = (f) => f.hist.length < 2 ? -1 : f.hist[1]; v = frames.reduce((b, f, k) => (k2(f) < k2(frames[b]) || (k2(f) === k2(frames[b]) && f.last < frames[b].last)) ? k : b, 0); }
    frames[v] = nf;
  }
  return { hits, frames, hand };
}
function mount(el) {
  const capS = slider({ label: 'frames', min: 4, max: 40, value: 12, onInput: draw });
  const scanS = slider({ label: 'scan length (pages)', min: 0, max: 200, value: 60, onInput: draw });
  let seed = 5; const { cv, ctx, w, h: H } = canvas(720, 190); const out = h('div', { class: 'out' });
  function trace() {
    let s = seed; const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; const t = []; const HOT = 8, scan = scanS.get();
    for (let round = 0; round < 6; round++) { for (let i = 0; i < 40; i++) t.push(Math.floor(r() * HOT)); for (let i = 0; i < scan; i++) t.push(1000 + round * 1000 + i); }
    for (let i = 0; i < 60; i++) t.push(Math.floor(r() * HOT)); return t;
  }
  function draw() {
    const tr = trace(); const cap = capS.get(); const res = ['lru', 'clock', 'lru-k'].map((p) => [p, sim(p, cap, tr)]);
    ctx.clearRect(0, 0, w, H); ctx.font = '12px monospace';
    res.forEach(([p, r], i) => { const y = 14 + i * 30, rate = r.hits / tr.length; ctx.fillStyle = C.dim; ctx.fillText(p === 'lru-k' ? 'LRU-2' : p.toUpperCase(), 8, y + 12); ctx.fillStyle = [C.bad, C.warn, C.good][i]; ctx.fillRect(70, y, rate * 560, 18); ctx.fillStyle = C.fg; ctx.fillText((rate * 100).toFixed(1) + '%', 70 + rate * 560 + 8, y + 13); });
    const c = res[1][1]; ctx.fillStyle = C.dim; ctx.fillText('Clock frames at end (ref bit shown, hand = triangle):', 8, 118);
    c.frames.forEach((f, i) => { const x = 8 + i * 17; ctx.fillStyle = f.ref ? C.warn : '#34406a'; ctx.fillRect(x, 128, 15, 22); if (i === c.hand) { ctx.fillStyle = C.fg; ctx.fillText('▲', x + 2, 164); } });
    ctx.fillStyle = C.dim; ctx.fillText('trace: hot set of 8 pages hit repeatedly, interleaved with 6 one-off sequential scans.', 8, 184);
    out.textContent = `references: ${tr.length}. A long scan flushes plain LRU (every scanned page looks "recent"); Clock behaves similarly; LRU-K needs two references so one-touch scan pages are evicted first.`;
  }
  el.append(h('div', { class: 'row' }, capS.el, scanS.el, btn('Different trace', () => { seed += 7; draw(); })), cv, out); draw();
}

export default {
  n: 8, title: 'Buffer pool, eviction, prefetch', minutes: 14, cmu: 'CMU 15-445 L5-L6 (Buffer pools)',
  components: ['buffer-pool', 'prefetcher', 'access-method'],
  goals: ['Describe the page table, frames, pin counts and dirty flags.', 'Compare LRU, Clock, LRU-K and 2Q/ARC and explain sequential flooding.', 'Contrast buffer pool, mmap, and direct I/O with io_uring.'],
  body: `
<h2>What the buffer pool is</h2>
<p>The buffer pool is the DBMS's own page cache: a big array of <b>frames</b> (each one page) plus a <b>page table</b> (hash map page_id to frame). Callers <b>pin</b> a page (a pin count prevents eviction), latch it for reading or writing, and unpin it. A <b>dirty</b> flag says the frame differs from disk. Eviction needs a victim with pin count 0; if dirty, the WAL must be flushed up to the page's LSN before the page is written (the write-ahead rule, see logging). PostgreSQL's <code>shared_buffers</code> is typically 25% of RAM (leaving the rest to the OS cache); InnoDB's <code>innodb_buffer_pool_size</code> is commonly 60-80% of RAM with O_DIRECT.</p>
<h2>Eviction policies</h2>
<ul><li><b>LRU</b>: evict least recently used. Needs a list update on every access (a hot lock) and suffers <b>sequential flooding</b>: a one-time scan of a big table pushes out the hot working set.</li>
<li><b>Clock</b>: an approximation. Frames sit on a circular list with a reference bit set on access; the hand clears bits and evicts the first frame whose bit is already 0. Cheap, no list reordering. PostgreSQL uses a clock sweep with a small usage counter (0-5). </li>
<li><b>LRU-K / 2Q / ARC</b>: take frequency into account. LRU-K evicts the page whose K-th most recent access is oldest, so one-touch pages go first. InnoDB splits its LRU into young/old sublists (a new page enters at the 3/8 point and is promoted only after being re-touched after a delay), a 2Q-style scan-resistance trick. ARC adaptively balances recency and frequency lists.</li>
<li><b>Ring buffers</b>: PostgreSQL gives big sequential scans a small private ring (256 KB) so they cannot flush the main pool.</li></ul>
<div data-demo="0"></div>
<h2>Prefetching</h2>
<p>Sequential scans are easy: issue reads for the next N pages ahead of the cursor (read-ahead; InnoDB linear read-ahead triggers after 56 sequential pages of an extent). Index scans use the pointer list: collect heap TIDs from the index, sort by page, and fetch in order (bitmap heap scan), or ask the OS/io_uring for many reads at once. Prefetch hides latency but wastes bandwidth if the guess is wrong.</p>
<h2>Buffer pool vs mmap vs direct I/O</h2>
<table><tr><th>Approach</th><th>Pros</th><th>Cons</th></tr>
<tr><td>Own buffer pool</td><td>Control of eviction, write order (WAL), prefetch, no double caching with O_DIRECT</td><td>Lots of code, tuning</td></tr>
<tr><td>mmap</td><td>Easy: pointer to file bytes (LMDB, MonetDB, old MongoDB)</td><td>OS can write dirty pages in any order (breaks WAL), page faults stall threads invisibly, TLB shootdowns, no I/O error handling (Crotty et al., CIDR 2022: "Are You Sure You Want to Use MMAP in Your DBMS?")</td></tr>
<tr><td>Direct I/O + io_uring</td><td>NVMe-saturating async queues, no page-cache copy</td><td>Alignment rules, must build your own cache</td></tr></table>
<div class="callout"><div class="t">Numbers</div><p>A hit costs ~100 ns (hash lookup, latch, pin). A miss on NVMe costs ~80-100 us; on cloud EBS 0.5-2 ms; on S3 20-50 ms. A 99% hit rate still leaves misses dominating average latency (1% x 100 us = 1 us versus 99% x 0.1 us = 0.1 us).</p></div>`,
  demos: [{ title: 'LRU vs Clock vs LRU-2 under scan flooding', caption: 'Hot working set plus periodic big scans. Increase scan length to see LRU collapse.', mount }],
  tradeoffs: { head: ['Policy', 'Hit rate under scan', 'Bookkeeping per access', 'Notes'], rows: [['LRU', 'Poor', 'List move under a latch', 'Simple baseline'], ['Clock', 'Poor-fair', 'Set a bit', 'Scales, used widely'], ['LRU-K / 2Q', 'Good', 'History per page', 'History must outlive eviction (ghost list)'], ['ARC', 'Good, adaptive', 'Four lists', 'Patent history; used in ZFS'], ['Scan ring buffer', 'Protects pool', 'None', 'Needs to know a scan is sequential']] },
  ripples: [{ to: 'WAL / recovery', text: 'steal policy (evict dirty pages of uncommitted txns) forces undo logging; no-steal keeps the pool pinned.' }, { to: 'Latches', text: 'page table and per-frame latches are the first scalability bottleneck; partitioned page tables and optimistic latching (LeanStore) fix it.' }, { to: 'Executor', text: 'operators pin pages for their lifetime; vectorized scans prefer reading whole extents.' }, { to: 'Disaggregated storage', text: 'with S3, the buffer pool becomes a multi-tier cache (memory, local NVMe, object store).' }],
  quiz: [{ q: 'What is sequential flooding?', options: ['Too many connections', 'A big one-time scan evicts the hot pages from an LRU cache', 'A WAL flush storm'], answer: 1, why: 'Every scanned page looks most recently used, displacing the working set.' }, { q: 'Why is mmap risky for a transactional DBMS?', options: ['It is slower than reads always', 'The OS may flush dirty pages in arbitrary order, violating write-ahead logging', 'It cannot read files'], answer: 1, why: 'The DBMS loses control of when pages hit disk.' }, { q: 'What does a pin count > 0 mean?', options: ['The page is dirty', 'The page cannot be evicted', 'The page is compressed'], answer: 1, why: 'Someone is using the frame.' }],
  refs: [{ title: "O'Neil et al., The LRU-K Page Replacement Algorithm (SIGMOD 1993)", url: 'https://dl.acm.org/doi/10.1145/170035.170081' }, { title: 'Megiddo & Modha, ARC (FAST 2003)', url: 'https://www.usenix.org/legacy/events/fast03/tech/full_papers/megiddo/megiddo.pdf' }, { title: 'Crotty et al., Are You Sure You Want to Use MMAP in Your DBMS? (CIDR 2022)', url: 'https://www.cidrdb.org/cidr2022/papers/p13-crotty.pdf' }, { title: 'CMU 15-445 schedule (Fall 2024)', url: 'https://15445.courses.cs.cmu.edu/fall2024/schedule.html' }, { title: 'MySQL: InnoDB buffer pool', url: 'https://dev.mysql.com/doc/refman/8.0/en/innodb-buffer-pool.html' }],
};
