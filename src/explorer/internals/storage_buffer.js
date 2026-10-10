// internals-C: buffer-pool + prefetcher views (real algorithm state).
import * as THREE from 'three';
import { makeKit, C, setColor, rng } from './storage_kit.js';

/* ====================================================================== */
/* Buffer pool model: LRU, Clock, LRU-K (K=2), ARC                          */
/* ====================================================================== */
const NF = 8; // frames
const POLICY_NAMES = { lru: 'LRU', clock: 'Clock (second chance)', 'lru-k': 'LRU-K (K=2)', 'arc-2q': 'ARC' };
const K_ = 2;

class Pool {
  constructor(policy) { this.n = NF; this.reset(policy); }
  reset(policy = this.policy) {
    this.policy = policy;
    this.frames = Array.from({ length: this.n }, (_, i) => ({ id: i, page: null, pin: 0, dirty: false, ref: 0, last: 0, born: 0, hist: [], list: null }));
    this.tick = 0; this.hand = 0; this.p = 0; // ARC target size for T1
    this.T1 = []; this.T2 = []; this.B1 = []; this.B2 = []; // ARC: T lists hold frames (LRU first); B lists hold page ids
    this.stats = { hits: 0, misses: 0, evictions: 0, flushes: 0, stalls: 0 };
    this.phase = { name: '-', hits: 0, reqs: 0 };
  }
  find(page) { return this.frames.find((f) => f.page === page) || null; }
  freeFrame() { return this.frames.find((f) => f.page === null) || null; }
  freeList() { return this.frames.filter((f) => f.page === null).map((f) => f.id); }
  setPolicy(p) {
    // Policy switch: keep resident pages, rebuild per-policy metadata from recency info.
    this.policy = p; this.p = 0; this.T1 = []; this.T2 = []; this.B1 = []; this.B2 = [];
    const res = this.frames.filter((f) => f.page !== null).sort((a, b) => a.last - b.last);
    for (const f of res) { f.list = null; if (p === 'arc-2q') { f.list = f.hist.length >= 2 ? 'T2' : 'T1'; (f.list === 'T2' ? this.T2 : this.T1).push(f); } }
  }
  _unpinned(arr) { return arr.filter((f) => f.pin === 0); }
  // Side-effect free: which frame would be chosen next (for highlighting)
  peekVictim() {
    const res = this.frames.filter((f) => f.page !== null && f.pin === 0);
    if (!res.length || this.freeFrame()) return null;
    if (this.policy === 'lru') return res.reduce((a, b) => (b.last < a.last ? b : a));
    if (this.policy === 'lru-k') return res.reduce((a, b) => (this._kkey(b) < this._kkey(a) || (this._kkey(b) === this._kkey(a) && b.hist[0] < a.hist[0]) ? b : a));
    if (this.policy === 'clock') {
      const refs = this.frames.map((f) => f.ref); let h = this.hand;
      for (let i = 0; i < 2 * this.n + 1; i++) { const f = this.frames[h]; if (f.pin === 0) { if (refs[h]) refs[h] = 0; else return f; } h = (h + 1) % this.n; }
      return null;
    }
    const pickT1 = this.T1.length > 0 && this.T1.length > this.p;
    return this._unpinned(pickT1 ? this.T1 : this.T2)[0] || this._unpinned(this.T1)[0] || this._unpinned(this.T2)[0] || null;
  }
  _kkey(f) { return f.hist.length >= K_ ? f.hist[f.hist.length - K_] : -Infinity; }
  // Returns {hit, frame, victim, sweep[], ghost, stall}
  access(page, write = false) {
    this.tick++; const out = { hit: false, frame: null, victim: null, victimPage: null, flushed: false, sweep: [], ghostHit: null, stall: false };
    let f = this.find(page);
    if (f) {
      out.hit = true; out.frame = f; this.stats.hits++;
      f.ref = 1; f.last = this.tick; f.hist.push(this.tick); if (f.hist.length > 4) f.hist.shift();
      if (this.policy === 'arc-2q') { this._rm(this.T1, f); this._rm(this.T2, f); f.list = 'T2'; this.T2.push(f); }
      if (write) f.dirty = true;
      return out;
    }
    this.stats.misses++;
    let victim = null; let loadList = 'T1';
    if (this.policy === 'arc-2q') {
      const c = this.n; const inB1 = this.B1.indexOf(page), inB2 = this.B2.indexOf(page);
      if (inB1 >= 0) {
        this.p = Math.min(c, this.p + Math.max(1, Math.floor(this.B2.length / this.B1.length)));
        victim = this._replace(false, out); this.B1.splice(inB1, 1); loadList = 'T2'; out.ghostHit = 'B1';
      } else if (inB2 >= 0) {
        this.p = Math.max(0, this.p - Math.max(1, Math.floor(this.B1.length / this.B2.length)));
        victim = this._replace(true, out); this.B2.splice(inB2, 1); loadList = 'T2'; out.ghostHit = 'B2';
      } else {
        const L1 = this.T1.length + this.B1.length;
        if (L1 >= c) {
          if (this.T1.length < c) { this.B1.shift(); victim = this._replace(false, out); }
          else { victim = this._unpinned(this.T1)[0] || null; if (victim) { this._rm(this.T1, victim); } }
        } else if (this.T1.length + this.T2.length + this.B1.length + this.B2.length >= c) {
          if (this.T1.length + this.T2.length + this.B1.length + this.B2.length >= 2 * c) this.B2.shift();
          if (!this.freeFrame()) victim = this._replace(false, out);
        }
      }
      if (!victim && !this.freeFrame()) { // all pinned in preferred list; fall back
        victim = this._unpinned([...this.T1, ...this.T2])[0] || null; if (victim) { this._rm(this.T1, victim); this._rm(this.T2, victim); }
      }
    } else if (!this.freeFrame()) {
      const cand = this._unpinned(this.frames);
      if (cand.length) {
        if (this.policy === 'lru') victim = cand.reduce((a, b) => (b.last < a.last ? b : a));
        else if (this.policy === 'lru-k') victim = cand.reduce((a, b) => (this._kkey(b) < this._kkey(a) || (this._kkey(b) === this._kkey(a) && b.hist[0] < a.hist[0]) ? b : a));
        else { // clock
          for (let i = 0; i < 2 * this.n + 1; i++) {
            const g = this.frames[this.hand]; out.sweep.push(this.hand);
            if (g.pin === 0) { if (g.ref) g.ref = 0; else { victim = g; this.hand = (this.hand + 1) % this.n; break; } }
            this.hand = (this.hand + 1) % this.n;
          }
        }
      }
    }
    if (!victim && !this.freeFrame()) { out.stall = true; this.stats.stalls++; this.stats.misses--; return out; }
    f = victim || this.freeFrame();
    if (victim) {
      out.victim = victim.id; out.victimPage = victim.page; this.stats.evictions++;
      if (victim.dirty) { out.flushed = true; this.stats.flushes++; }
    }
    f.page = page; f.dirty = !!write; f.ref = 1; f.last = this.tick; f.born = this.tick; f.hist = [this.tick]; f.pin = 0;
    if (this.policy === 'arc-2q') { f.list = loadList; (loadList === 'T2' ? this.T2 : this.T1).push(f); } else f.list = null;
    out.frame = f; return out;
  }
  _rm(arr, f) { const i = arr.indexOf(f); if (i >= 0) arr.splice(i, 1); }
  _replace(inB2, out) {
    const pickT1 = this.T1.length > 0 && (this.T1.length > this.p || (inB2 && this.T1.length === this.p));
    let v = this._unpinned(pickT1 ? this.T1 : this.T2)[0], from = pickT1 ? 'T1' : 'T2';
    if (!v) { v = this._unpinned(pickT1 ? this.T2 : this.T1)[0]; from = pickT1 ? 'T2' : 'T1'; }
    if (!v) return null;
    this._rm(from === 'T1' ? this.T1 : this.T2, v); (from === 'T1' ? this.B1 : this.B2).push(v.page);
    return v;
  }
  recencyRank(f) { // 1 = most recent
    return this.frames.filter((g) => g.page !== null && g.last > f.last).length + 1;
  }
}

/* ====================================================================== */
export const views = {};

views['buffer-pool'] = {
  build(ctx) {
    const K = makeKit(ctx); const cfg = () => ctx.config || {};
    let policy = cfg()['buffer-eviction'] || 'lru'; let cache = cfg()['page-cache'] || 'buffer-pool';
    const eff = () => (cache === 'mmap' ? 'clock' : policy); // kernel decides under mmap
    const pool = new Pool(eff());
    let queue = []; let acc = 0; let interval = 0.55; let selPage = 5; let lastTransient = null; let writeProb = 0;
    let note = '';
    const flashT = new Array(NF).fill(0), flashC = new Array(NF).fill(0);

    // ---- static scene
    const title = K.label('', -4.5, 6.6, 0, { size: 0.55, px: 40, w: 900, color: hex(C.cyan) }); title.scale.multiplyScalar(1.15);
    const statsL = K.label('', -3.5, 5.75, 0, { size: 0.75, px: 34, w: 1100, color: C.text });
    const fx = (i) => -9 + (i % 4) * 2.45, fy = (i) => 3.6 - Math.floor(i / 4) * 2.7;
    const FR = [];
    for (let i = 0; i < NF; i++) {
      const body = K.box(2.1, 2.2, 0.4, 0x10162a, fx(i), fy(i), 0);
      const bar = K.box(2.1, 0.18, 0.46, C.grey, fx(i), fy(i) + 1.05, 0.02);
      const pageT = K.dyn('', { size: 0.62, px: 54, w: 300, bold: true, color: '#e6ebff' }); pageT.position.set(fx(i), fy(i) + 0.3, 0.3); K.group.add(pageT);
      const stT = K.dyn('', { size: 0.34, px: 30, w: 360, color: C.dim }); stT.position.set(fx(i), fy(i) - 0.45, 0.3); K.group.add(stT);
      const tagT = K.dyn('', { size: 0.34, px: 30, w: 360, color: C.dim }); tagT.position.set(fx(i), fy(i) - 0.8, 0.3); K.group.add(tagT);
      const dirty = K.box(0.28, 0.28, 0.1, C.red, fx(i) - 0.8, fy(i) + 0.78, 0.28, { emissive: C.red }); dirty.visible = false;
      const ref = K.box(0.28, 0.28, 0.1, C.yellow, fx(i) + 0.8, fy(i) + 0.78, 0.28, { emissive: C.yellow }); ref.visible = false;
      const pin = K.box(0.28, 0.28, 0.1, C.blue, fx(i), fy(i) + 0.78, 0.28, { emissive: C.blue }); pin.visible = false;
      const idT = K.label('f' + i, fx(i) - 0.78, fy(i) - 1.28, 0.3, { size: 0.3, px: 30, w: 150, color: C.dim });
      FR.push({ body, bar, pageT, stT, tagT, dirty, ref, pin, idT });
    }
    K.label('BUFFER POOL FRAMES (8 x 8 KiB)', -5.2, 5.0, 0, { size: 0.36, px: 30, w: 700, color: C.dim });
    const freeL = K.label('', -5.2, -0.55, 0, { size: 0.42, px: 34, w: 1000, color: C.text });
    const hand = new THREE.Mesh(K.track(new THREE.ConeGeometry(0.22, 0.5, 4)), K.mat(C.orange, { emissive: C.orange })); hand.rotation.z = Math.PI; hand.visible = false; K.group.add(hand); hand.position.set(fx(0), fy(0) + 1.5, 0.3);
    // page table (hash)
    const NB = 5; K.label('PAGE TABLE  hash(page) = page mod 5', 5.8, 5.0, 0, { size: 0.36, px: 30, w: 800, color: C.dim });
    const ptRows = [];
    for (let b = 0; b < NB; b++) {
      K.box(8.3, 0.62, 0.2, 0x17203d, 5.8, 4.2 - b * 0.8, 0);
      K.box(0.55, 0.62, 0.24, C.purple, 1.9 + 0.0, 4.2 - b * 0.8, 0.02);
      K.label('[' + b + ']', 1.9, 4.2 - b * 0.8, 0.2, { size: 0.36, px: 34, w: 160, color: '#101530' });
      ptRows.push(K.label('', 6.1, 4.2 - b * 0.8, 0.2, { size: 0.4, px: 32, w: 900, color: C.text, align: 'left' }));
      ptRows[b].position.x = 2.3 + ptRows[b].scale.x / 2;
    }
    const ghostL = K.label('', 5.8, -0.4, 0, { size: 1.15, px: 30, w: 1000, lines: 3, color: C.dim });
    // cache band
    const band = K.box(19.6, 1.15, 0.2, 0x151b30, 0, -1.8, -0.3);
    const bandL = K.label('', 0, -1.55, -0.1, { size: 0.4, px: 32, w: 1500, color: C.text });
    const bandL2 = K.label('', 0, -2.05, -0.1, { size: 0.33, px: 28, w: 1500, color: C.dim });
    const ring = []; // io_uring SQ/CQ entries
    for (let i = 0; i < 8; i++) { ring.push(K.box(0.7, 0.4, 0.1, 0x222c52, -8.5 + i * 0.8, -1.55, -0.1)); ring.push(K.box(0.7, 0.4, 0.1, 0x222c52, 2.5 + i * 0.8, -1.55, -0.1)); }
    // disk
    const NP = 40; const disk = [];
    K.label('DISK  (data file pages)', -6.5, -3.0, 0, { size: 0.34, px: 30, w: 700, color: C.dim });
    for (let p = 0; p < NP; p++) {
      const x = -9.5 + (p % 20) * 1.0, y = -3.7 - Math.floor(p / 20) * 0.95;
      const m = K.box(0.82, 0.7, 0.2, 0x1a2244, x, y, 0); disk.push(m);
      K.label('' + p, x, y, 0.15, { size: 0.3, px: 34, w: 140, color: C.dim });
    }
    const orb = K.sphere(0.2, C.yellow, 0, 0, 0.5, { emissive: C.yellow }); orb.visible = false;
    const px = (p) => -9.5 + (p % 20) * 1.0, py = (p) => -3.7 - Math.floor(p / 20) * 0.95;

    function hex(n) { return '#' + new THREE.Color(n).getHexString(); }
    const modeText = () => ({
      'buffer-pool': ['DB-managed buffer pool over the OS page cache (double buffering: page may live in both)', 'DB controls eviction, pinning, dirty-page flush order (WAL rule). pread() goes through the kernel cache.'],
      mmap: ['mmap: the OS page cache IS the pool  -  kernel evicts (clock-like), DB cannot pin or order flushes', 'Page faults stall threads; TLB shootdowns on eviction; I/O errors become SIGBUS. (LMDB, MonetDB; abandoned by many)'],
      'direct-io-uring': ['O_DIRECT + io_uring: bypass OS cache; DB pool is the only cache', 'Submission Queue (SQ) -> kernel -> Completion Queue (CQ): many async reads in flight, no syscall per I/O.'],
    }[cache] || ['', '']);

    function refresh() {
      const eP = eff(); const victim = pool.peekVictim();
      title.setText(`${POLICY_NAMES[eP]}${cache === 'mmap' ? '  (chosen by kernel)' : ''}   |   page-cache: ${cache}`);
      const s = pool.stats; const tot = s.hits + s.misses;
      statsL.setText(`hits ${s.hits}  misses ${s.misses}  hit-rate ${tot ? Math.round(100 * s.hits / tot) : 0}%  evictions ${s.evictions}  dirty flushes ${s.flushes}   ${pool.phase.name !== '-' ? 'phase "' + pool.phase.name + '": ' + pool.phase.hits + '/' + pool.phase.reqs + ' hits' : ''}`);
      pool.frames.forEach((f, i) => {
        const v = FR[i];
        v.pageT.setText(f.page === null ? 'free' : 'P' + f.page, f.page === null ? C.dim : '#e6ebff');
        v.stT.setText(f.page === null ? '' : `pin=${f.pin}${f.dirty ? ' dirty' : ''}`, f.pin ? hex(C.blue) : f.dirty ? hex(C.red) : C.dim);
        v.dirty.visible = f.dirty; v.ref.visible = f.page !== null && eP === 'clock' && !!f.ref; v.pin.visible = f.pin > 0;
        let tag = '', col = C.dim;
        if (f.page !== null) {
          if (eP === 'lru') tag = `recency #${pool.recencyRank(f)}`;
          else if (eP === 'clock') tag = `ref=${f.ref}`;
          else if (eP === 'lru-k') { const k = pool._kkey(f); tag = k === -Infinity ? 'k2: -inf' : `k2: t${k}`; }
          else tag = f.list || '';
          if (victim === f) { tag += ' <victim'; col = hex(C.red); }
        }
        v.tagT.setText(tag, col);
        v.bar.material.color.setHex(f.page === null ? C.grey : eP === 'arc-2q' ? (f.list === 'T2' ? C.green : C.yellow) : f.dirty ? C.red : C.cyan);
        v.idT.setText('f' + i + (f.pin ? '  pinned' : ''), C.dim);
      });
      hand.visible = eP === 'clock' && cache !== 'direct-io-uring-x'; if (hand.visible) K.move(hand, fx(pool.hand), fy(pool.hand) + 1.5, 0.3, 0.3);
      // page table
      const rows = Array.from({ length: NB }, () => []);
      pool.frames.forEach((f) => { if (f.page !== null) rows[f.page % NB].push(`${f.page}->f${f.id}`); });
      rows.forEach((r, b) => { ptRows[b].setText(r.length ? r.join('  ') : '(empty)', r.length ? C.text : C.dim); });
      const fr = pool.freeList(); freeL.setText(`free list: ${fr.length ? fr.map((i) => 'f' + i).join(' ') : '(empty, eviction needed)'}`);
      if (eP === 'arc-2q') ghostL.setText(`ARC  p(target |T1|)=${pool.p}\nT1 recent-once: ${pool.T1.map((f) => f.page).join(' ') || '-'}   T2 frequent: ${pool.T2.map((f) => f.page).join(' ') || '-'}\nghosts B1: ${pool.B1.join(' ') || '-'}   B2: ${pool.B2.join(' ') || '-'}`);
      else if (eP === 'clock') ghostL.setText(`Clock hand at f${pool.hand}\nref bit=1: skip & clear (second chance)\nref bit=0: evict`);
      else if (eP === 'lru-k') ghostL.setText(`LRU-K (K=2): evict page with oldest\n2nd-most-recent access; pages seen once\nhave k-distance = +inf and go first`);
      else ghostL.setText(`LRU: evict least recently used.\nA single big scan touches every page\nonce and flushes the whole hot set.`);
      const mt = modeText(); bandL.setText(mt[0], cache === 'mmap' ? hex(C.orange) : cache === 'direct-io-uring' ? hex(C.green) : C.text); bandL2.setText(mt[1]);
      band.material.color.setHex(cache === 'mmap' ? 0x3a2a18 : cache === 'direct-io-uring' ? 0x16301f : 0x151b30);
      ring.forEach((r) => (r.visible = false)); // ring entries drawn only in direct mode (text is too wide otherwise)
    }

    function request(page, write = false, phase = null) {
      if (lastTransient) { lastTransient.pin = Math.max(0, lastTransient.pin - 1); lastTransient = null; }
      const r = pool.access(page, write);
      if (phase) { pool.phase.reqs++; if (r.hit) pool.phase.hits++; }
      if (r.stall) { note = `P${page}: every frame is pinned - request must wait (pool exhausted)`; K.info(note); refresh(); return r; }
      const f = r.frame; f.pin++; lastTransient = f;
      flashC[f.id] = r.hit ? C.green : C.yellow; flashT[f.id] = 0.55;
      orb.visible = true; const fi = f.id;
      if (r.hit) { orb.position.set(2.3, 4.2 - (page % NB) * 0.8, 0.5); K.move(orb, fx(fi), fy(fi), 0.5, 0.35, () => (orb.visible = false)); }
      else { orb.position.set(px(page), py(page), 0.5); disk[page].material.color.setHex(C.yellow); K.after(0.6, () => disk[page].material.color.setHex(0x1a2244));
        K.move(orb, fx(fi), fy(fi), 0.5, cache === 'direct-io-uring' ? 0.3 : 0.5, () => (orb.visible = false)); }
      if (r.victim != null) { K.after(0.0, () => {}); }
      note = `${r.hit ? 'HIT' : 'MISS'} P${page}${write ? ' (write)' : ''} -> f${f.id}.` + (r.victim != null ? ` Evicted P${r.victimPage} from f${r.victim}${r.flushed ? ' (dirty: flushed to disk first)' : ''}${pool.policy === 'clock' ? `; hand swept ${r.sweep.length} frame(s)` : ''}.` : r.hit ? '' : ' Took a free frame.') + (r.ghostHit ? ` Ghost hit in ${r.ghostHit}: ARC adapts p to ${pool.p}.` : '');
      K.info(note + (cache === 'mmap' ? '<br>mmap: this was a page fault handled by the kernel.' : cache === 'direct-io-uring' && !r.hit ? '<br>io_uring: SQE queued, CQE reaped when DMA completes.' : ''));
      refresh(); return r;
    }

    function enqueue(list) { queue.push(...list); }
    function floodDemo() {
      pool.reset(eff()); pool.phase = { name: 'warm', hits: 0, reqs: 0 }; queue = [];
      const hot = [0, 1, 2, 3]; const L = [];
      for (let r = 0; r < 3; r++) hot.forEach((p) => L.push({ page: p, phase: 'warm hot set', write: p === 2 && r === 0 }));
      for (let p = 10; p < 34; p++) L.push({ page: p, phase: 'sequential SCAN' });
      hot.forEach((p) => L.push({ page: p, phase: 'hot set re-read (after scan)' }));
      enqueue(L); refresh();
    }
    function randomHot() { const p = Math.floor(Math.random() * 4); enqueue([{ page: p, phase: null, write: Math.random() < writeProb }]); }
    function resetAll() { queue = []; lastTransient = null; pool.reset(eff()); note = ''; refresh(); K.info('Pool reset: all frames on the free list.'); }

    // ---- controls
    const selOpt = (id, l) => ({ value: id, label: l });
    const controls = [
      { id: 'policy', label: 'Eviction', type: 'select', options: Object.entries(POLICY_NAMES).map(([k, v]) => selOpt(k, v)), value: policy, onChange(v) { policy = v; ctx.config && (ctx.config['buffer-eviction'] = v); pool.setPolicy(eff()); refresh(); K.info(`Policy -> <b>${POLICY_NAMES[v]}</b>. Resident pages kept; metadata rebuilt.`); } },
      { id: 'cache', label: 'Page cache', type: 'select', options: [selOpt('buffer-pool', 'DB buffer pool'), selOpt('mmap', 'mmap (OS cache)'), selOpt('direct-io-uring', 'O_DIRECT + io_uring')], value: cache, onChange(v) { cache = v; pool.setPolicy(eff()); refresh(); } },
      { id: 'page', label: 'Page #', type: 'range', min: 0, max: 39, value: selPage, onChange(v) { selPage = v; } },
      { id: 'request', label: 'Request page (read)', type: 'button', onChange() { enqueue([{ page: selPage, phase: null }]); } },
      { id: 'write', label: 'Write page (dirty)', type: 'button', onChange() { enqueue([{ page: selPage, phase: null, write: true }]); } },
      { id: 'pinbtn', label: 'Pin/unpin selected page', type: 'button', onChange() { if (cache === 'mmap') { K.info('mmap cannot pin: the kernel may evict any page (mlock is a blunt tool).'); return; } const f = pool.find(selPage); if (!f) { K.info('Page not resident: request it first.'); return; } f.pin = f.pin > 0 ? 0 : 1; if (lastTransient === f) lastTransient = null; refresh(); K.info(f.pin ? `P${selPage} pinned: eviction skips frame f${f.id}.` : 'Unpinned.'); } },
      { id: 'hot', label: 'Random hot-set request (0-3)', type: 'button', onChange() { randomHot(); } },
      { id: 'scan', label: 'Sequential scan 10..33', type: 'button', onChange() { const L = []; for (let p = 10; p < 34; p++) L.push({ page: p, phase: null }); enqueue(L); } },
      { id: 'flood', label: 'Run flooding demo', type: 'button', onChange() { floodDemo(); } },
      { id: 'reset', label: 'Reset pool', type: 'button', onChange() { resetAll(); } },
      { id: 'speed', label: 'Speed', type: 'range', min: 1, max: 10, value: 5, onChange(v) { interval = 1.1 - v * 0.1; } },
    ];
    const steps = [
      { title: 'Miss: page table lookup fails', text: 'Request P5. The page table (hash map page-id -> frame) has no entry, so the pool takes a frame from the <b>free list</b>, reads the page from disk, pins it and inserts the mapping.', run() { resetAll(); enqueue([{ page: 5 }]); } },
      { title: 'Hit: no I/O', text: 'Request P5 again. Page-table hit, pin count++, ref bit/recency updated. Pin count > 0 means the frame cannot be evicted while a query is using it.', run() { enqueue([{ page: 5 }]); } },
      { title: 'Fill the pool', text: 'Touch P6..P12. After 8 distinct pages the free list is empty; the next miss must evict a victim chosen by the policy.', run() { const L = []; for (let p = 6; p <= 12; p++) L.push({ page: p }); enqueue(L); } },
      { title: 'Evict (dirty -> flush)', text: 'Write P5 then request P20, P21. Evicting a <b>dirty</b> page forces a disk write first (WAL must be flushed up to the page LSN before: write-ahead rule).', run() { enqueue([{ page: 5, write: true }, { page: 20 }, { page: 21 }, { page: 22 }]); } },
      { title: 'Pin protects a page', text: 'Pin the selected page with the Pin button, then request many new pages: the policy skips the pinned frame and picks another victim.', run() { const f = pool.find(5) || pool.frames.find((g) => g.page !== null); if (f) { f.pin = 1; selPage = f.page; refresh(); } enqueue([{ page: 30 }, { page: 31 }, { page: 32 }]); } },
      { title: 'Sequential flooding', text: 'Warm 4 hot pages, then one big scan (24 pages), then re-read the hot set. Watch the phase counter: LRU/Clock lose all 4; LRU-K and ARC keep them (scan pages only seen once).', run() { floodDemo(); } },
      { title: 'Swap the algorithm', text: 'Change <b>Eviction</b> and rerun the flooding demo. LRU: 0/4. Clock: ~0/4. LRU-K: 4/4 (scan pages have k-distance +inf). ARC: 4/4 (hot in T2, scan confined to T1).', run() { policy = policy === 'lru' ? 'arc-2q' : 'lru'; pool.setPolicy(eff()); floodDemo(); } },
    ];

    refresh(); K.info('Buffer pool: use Request / Run flooding demo, and switch the Eviction policy.');
    return {
      group: K.group, controls: undefined, steps,
      update(dt) {
        K.tick(dt);
        acc += dt;
        if (queue.length && acc >= interval) { acc = 0; const q = queue.shift(); if (q.phase !== undefined && q.phase !== null && pool.phase.name !== q.phase) pool.phase = { name: q.phase, hits: 0, reqs: 0 }; request(q.page, !!q.write, q.phase); }
        for (let i = 0; i < NF; i++) { if (flashT[i] > 0) { flashT[i] -= dt; FR[i].body.material.color.setHex(0x1c2547).lerp(new THREE.Color(flashC[i]), 0.35 * Math.min(1, flashT[i] / 0.3)); FR[i].body.material.emissive.setHex(0); } else FR[i].body.material.color.setHex(pool.frames[i].page === null ? 0x10162a : 0x1c2547); }
      },
      onConfigChange(c) {
        const np = c['buffer-eviction'] || 'lru'; const nc = c['page-cache'] || 'buffer-pool';
        if (np !== policy || nc !== cache) { policy = np; cache = nc; pool.setPolicy(eff()); refresh(); }
      },
      dispose() { K.dispose(); },
      _controls: controls,
    };
  },
  controls: null,
};

/* ====================================================================== */
/* Prefetcher                                                              */
/* ====================================================================== */
const NB2 = 48, LAT = 0.5, CPU = 0.12;
function buildSeq(pattern) {
  if (pattern === 'sequential') return Array.from({ length: 40 }, (_, i) => i);
  if (pattern === 'stride') return Array.from({ length: 16 }, (_, i) => i * 3);
  const r = rng(pattern === 'index' ? 7 : 99); const a = Array.from({ length: NB2 }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, 20);
}

views['prefetcher'] = {
  build(ctx) {
    const K = makeKit(ctx);
    let pattern = 'sequential', engine = (ctx.config || {})['page-cache'] === 'direct-io-uring' ? 'uring' : 'blocking';
    let qd = 8, maxWin = 8, prefetchOn = true, speed = 1;
    const hex = (n) => '#' + new THREE.Color(n).getHexString();
    // visual blocks
    const bx = (b) => -9.2 + (b % 24) * 0.8, by = (b) => 2.6 - Math.floor(b / 24) * 1.5;
    const blocks = []; const caps = [];
    K.label('FILE (48 pages)  -  yellow = I/O in flight   cyan = in page cache   green = consumed   grey = on disk', 0, 4.9, 0, { size: 0.36, px: 30, w: 1800, color: C.dim });
    for (let b = 0; b < NB2; b++) {
      blocks.push(K.box(0.7, 0.9, 0.3, 0x1a2244, bx(b), by(b), 0));
      K.label('' + b, bx(b), by(b) - 0.62, 0.1, { size: 0.28, px: 30, w: 120, color: C.dim });
      const cap = K.box(0.7, 0.12, 0.34, C.orange, bx(b), by(b) + 0.55, 0.02, { emissive: C.orange }); cap.visible = false; caps.push(cap);
    }
    const cursor = K.cone ? null : new THREE.Mesh(K.track(new THREE.ConeGeometry(0.25, 0.6, 4)), K.mat(C.red, { emissive: C.red })); cursor.rotation.z = Math.PI; K.group.add(cursor);
    const flag = K.box(0.12, 0.7, 0.12, C.purple, 0, 0, 0.3, { emissive: C.purple }); flag.visible = false;
    const flagL = K.label('async marker', 0, 0, 0.3, { size: 0.28, px: 28, w: 300, color: hex(C.purple) });
    const title = K.label('', 0, 6.0, 0, { size: 0.55, px: 40, w: 1600, color: hex(C.cyan) });
    const stats = K.label('', 0, 5.4, 0, { size: 0.4, px: 30, w: 1700, color: C.text });
    // device
    K.label('DEVICE QUEUE', -7.5, -0.2, 0, { size: 0.36, px: 32, w: 500, color: C.dim });
    const slots = [], slotBar = [], slotL = [];
    for (let i = 0; i < 16; i++) {
      const x = -9 + i * 1.15; slots.push(K.box(1.0, 0.7, 0.2, 0x151b30, x, -1.2, 0));
      const bar = K.box(1.0, 0.7, 0.24, C.yellow, x - 0.5, -1.2, 0.02, { emissive: C.yellow }); bar.visible = false; slotBar.push(bar);
      slotL.push(K.label('', x, -1.2, 0.2, { size: 0.3, px: 30, w: 160, color: '#e6ebff' }));
    }
    const pendL = K.label('', 0, -2.1, 0, { size: 0.38, px: 30, w: 1600, color: C.text });
    const explL = K.label('', 0, -3.2, 0, { size: 1.1, px: 28, w: 1900, lines: 3, color: C.dim });
    const algL = K.label('', 0, -4.7, 0, { size: 0.74, px: 28, w: 1900, lines: 2, color: C.dim });

    // ---- sim
    let S, st, cpuUntil, active, pending, tm, stall, ios, win, frontier, marker, idx, done, doneAt, maxActive, hits;
    function restart() {
      S = buildSeq(pattern); st = new Array(NB2).fill(0); // 0 cold, 1 queued/inflight, 2 cached, 3 consumed
      active = []; pending = []; tm = 0; stall = 0; ios = 0; win = 4; frontier = -1; marker = -1; idx = 0; done = false; doneAt = 0; maxActive = 0; cpuUntil = 0; hits = 0;
      lastIdxProgress = 0;
      if (prefetchOn && pattern === 'index') issueTo(Math.min(S.length - 1, maxWin)); // index scan knows the future
    }
    let lastIdxProgress = 0;
    const eQd = () => (engine === 'blocking' ? 1 : qd);
    function submit(b, front = false) { if (st[b] !== 0) return; st[b] = 1; ios++; const io = { b, rem: LAT }; front ? pending.unshift(io) : pending.push(io); }
    function issueTo(t) { for (let k = frontier + 1; k <= Math.min(t, S.length - 1); k++) submit(S[k]); frontier = Math.max(frontier, Math.min(t, S.length - 1)); }
    function onAccess(i) { // called when app starts to need S[i]
      if (!prefetchOn) return;
      if (pattern === 'sequential' || pattern === 'stride') {
        if (i >= 1) { // pattern detected after 2 accesses
          if (frontier < 0 || frontier - i <= Math.floor(win / 2)) { if (frontier >= 0) win = Math.min(maxWin, win * 2); marker = null; }
          if (frontier < i + win) { issueTo(i + win); marker = frontier - Math.floor(win / 2); }
        }
      } else if (pattern === 'index') { issueTo(i + maxWin); }
    }
    let lastAccessSeen = -1;
    function step(dt) {
      if (done) { if (tm - doneAt > 2.8) restart(); tm += dt; return; }
      tm += dt;
      while (active.length < eQd() && pending.length) active.push(pending.shift());
      maxActive = Math.max(maxActive, active.length);
      for (const io of active) io.rem -= dt;
      for (let i = active.length - 1; i >= 0; i--) if (active[i].rem <= 0) { st[active[i].b] = 2; active.splice(i, 1); }
      if (tm >= cpuUntil && idx < S.length) {
        if (lastAccessSeen !== idx) { lastAccessSeen = idx; onAccess(idx); }
        const b = S[idx];
        if (st[b] === 2) { st[b] = 3; cpuUntil = tm + CPU; idx++; hits++; }
        else { if (st[b] === 0) submit(b, true); stall += dt; }
      }
      if (idx >= S.length && tm >= cpuUntil && !done) { done = true; doneAt = tm; }
    }
    function draw() {
      for (let b = 0; b < NB2; b++) {
        const s = st[b]; const inS = S.includes(b);
        const col = s === 1 ? C.yellow : s === 2 ? C.cyan : s === 3 ? 0x3e6b3e : inS ? 0x39426b : 0x1a2244;
        blocks[b].material.color.setHex(col); blocks[b].material.emissive.setHex(s === 1 ? C.yellow : s === 2 ? C.cyan : 0).multiplyScalar(0.3);
        blocks[b].scale.y = s === 1 ? 1.0 + 0.1 * Math.sin(tm * 12) : 1; caps[b].visible = false;
      }
      if (!done) for (let k = idx + 1; k <= frontier && k < S.length; k++) caps[S[k]].visible = true;
      const cb = S[Math.min(idx, S.length - 1)]; cursor.position.set(bx(cb), by(cb) + 1.15, 0.3);
      if (marker != null && marker >= 0 && marker < S.length && marker > idx) { flag.visible = true; flag.position.set(bx(S[marker]), by(S[marker]) + 1.0, 0.3); flagL.visible = true; flagL.position.set(bx(S[marker]), by(S[marker]) + 1.55, 0.3); } else { flag.visible = false; flagL.visible = false; }
      for (let i = 0; i < 16; i++) {
        const live = i < eQd(); slots[i].visible = live; const io = active[i];
        slotBar[i].visible = !!io && live; slotL[i].visible = live;
        if (io && live) { const f = 1 - io.rem / LAT; slotBar[i].scale.x = Math.max(0.02, f); slotBar[i].position.x = -9 + i * 1.15 - 0.5 + 0.5 * f; slotL[i].setText('pg' + io.b); } else if (live) slotL[i].setText('');
      }
      const base = S.length * (LAT + CPU);
      title.setText(`pattern: ${pattern}   engine: ${engine === 'blocking' ? 'blocking pread() (queue depth 1)' : 'io_uring async (queue depth ' + qd + ')'}   prefetch ${prefetchOn ? 'ON' : 'OFF'}`);
      stats.setText(`t=${tm.toFixed(1)}s  app stalled ${stall.toFixed(1)}s  I/Os issued ${ios}  max in flight ${maxActive}  window=${pattern === 'index' ? maxWin + ' (fixed lookahead)' : win}  ${done ? 'DONE in ' + doneAt.toFixed(1) + 's vs ' + base.toFixed(1) + 's with no overlap' : ''}`);
      pendL.setText(`waiting in submission queue: ${pending.length}   |   device parallelism used: ${active.length}/${eQd()}   (each read = ${LAT}s, CPU per page = ${CPU}s)`);
      explL.setText({
        sequential: 'Sequential: after 2 contiguous reads the kernel opens a readahead window (4 pages) and doubles it\neach time the app hits the async marker page (PG_readahead), up to read_ahead_kb (e.g. 128 KiB = 32 pages).\nThe next window is fetched while the app still consumes the previous one.',
        stride: 'Stride: the kernel heuristics miss this; the DB (or posix_fadvise) must detect fixed-stride access\n(e.g. every 3rd page of a clustered scan) and prefetch the next addresses in the stride.',
        index: 'Index-driven: an index/bitmap scan already knows the next heap page ids (PostgreSQL effective_io_concurrency,\nInnoDB linear read-ahead). Distance = fixed lookahead; random addresses but fully predictable.',
        random: 'Random with no hint: the next page is unknown, readahead is disabled by the kernel heuristic.\nOnly deeper queue depth from concurrent requests (many queries / io_uring) hides latency.',
      }[pattern]);
      algL.setText(engine === 'blocking' ? 'Blocking pread(): one request at a time per thread, an SSD with 32-128 parallel channels sits idle. Prefetch cannot overlap beyond depth 1.' : 'io_uring: app fills the SQ ring with N reads and continues; kernel completes them in parallel into the CQ ring. Throughput ~ queue_depth / latency.');
    }

    const so = (v, l) => ({ value: v, label: l });
    const rs = () => { restart(); };
    const controls = [
      { id: 'pattern', label: 'Access pattern', type: 'select', options: [so('sequential', 'Sequential scan'), so('stride', 'Stride (every 3rd page)'), so('index', 'Index-driven (random known)'), so('random', 'Random (unknown)')], value: pattern, onChange(v) { pattern = v; rs(); } },
      { id: 'engine', label: 'I/O engine', type: 'select', options: [so('blocking', 'Blocking pread (QD1)'), so('uring', 'io_uring async')], value: engine, onChange(v) { engine = v; rs(); } },
      { id: 'qd', label: 'Queue depth', type: 'range', min: 1, max: 16, value: qd, onChange(v) { qd = v; } },
      { id: 'win', label: 'Max readahead window', type: 'range', min: 2, max: 16, value: maxWin, onChange(v) { maxWin = v; rs(); } },
      { id: 'prefetch', label: 'Prefetch enabled', type: 'toggle', value: true, onChange(v) { prefetchOn = v; rs(); } },
      { id: 'restart', label: 'Restart run', type: 'button', onChange() { rs(); } },
      { id: 'speed', label: 'Sim speed', type: 'range', min: 1, max: 4, value: 1, onChange(v) { speed = v; } },
    ];
    const steps = [
      { title: 'No prefetch baseline', text: 'Prefetch OFF, blocking reads: every page costs a full 0.5s device latency, then CPU. Total = N x (latency + cpu).', run() { engine = 'blocking'; prefetchOn = false; pattern = 'sequential'; rs(); } },
      { title: 'Sequential readahead ramp', text: 'Prefetch ON, sequential. Window starts at 4 after the pattern is detected, doubles at each async marker up to max. With QD1 reads are still serial.', run() { prefetchOn = true; pattern = 'sequential'; engine = 'blocking'; rs(); } },
      { title: 'io_uring queue depth', text: 'Switch to io_uring with QD 8: the window pages are submitted together and complete in parallel, so the app almost never stalls.', run() { engine = 'uring'; qd = 8; prefetchOn = true; pattern = 'sequential'; rs(); } },
      { title: 'Stride detection', text: 'Every 3rd page. Kernel sequential heuristics do not fire; a DB-level stride detector prefetches the arithmetic progression.', run() { pattern = 'stride'; engine = 'uring'; prefetchOn = true; rs(); } },
      { title: 'Index-driven prefetch', text: 'Random heap pages known from an index scan: prefetch distance is fixed (effective_io_concurrency) and I/Os overlap even though addresses are random.', run() { pattern = 'index'; engine = 'uring'; prefetchOn = true; rs(); } },
      { title: 'Random, no hint', text: 'Nothing to prefetch. Each page is a demand miss; latency is fully exposed unless many concurrent requests share the device.', run() { pattern = 'random'; rs(); } },
    ];
    restart(); draw(); K.info('Prefetcher: pick an access pattern and I/O engine; the run loops automatically.');
    return {
      group: K.group, steps,
      update(dt) { K.tick(dt); let r = dt * speed; while (r > 0) { const s = Math.min(r, 0.02); step(s); r -= s; } draw(); },
      onConfigChange(c) { const e = c['page-cache'] === 'direct-io-uring' ? 'uring' : 'blocking'; if (e !== engine) { engine = e; rs(); } },
      dispose() { K.dispose(); },
      _controls: controls,
    };
  },
  controls: null,
};

// Static controls: defined at module load, delegating to the live instance set in build().
const current = {};
const so_ = (v, l) => ({ value: v, label: l });
const META = {
  'buffer-pool': [
    { id: 'policy', label: 'Eviction', type: 'select', options: Object.entries(POLICY_NAMES).map(([k, v]) => so_(k, v)), value: 'lru' },
    { id: 'cache', label: 'Page cache', type: 'select', options: [so_('buffer-pool', 'DB buffer pool'), so_('mmap', 'mmap (OS cache)'), so_('direct-io-uring', 'O_DIRECT + io_uring')], value: 'buffer-pool' },
    { id: 'page', label: 'Page #', type: 'range', min: 0, max: 39, value: 5 },
    { id: 'request', label: 'Request page (read)', type: 'button' },
    { id: 'write', label: 'Write page (dirty)', type: 'button' },
    { id: 'pinbtn', label: 'Pin/unpin selected page', type: 'button' },
    { id: 'hot', label: 'Random hot-set request (0-3)', type: 'button' },
    { id: 'scan', label: 'Sequential scan 10..33', type: 'button' },
    { id: 'flood', label: 'Run flooding demo', type: 'button' },
    { id: 'reset', label: 'Reset pool', type: 'button' },
    { id: 'speed', label: 'Speed', type: 'range', min: 1, max: 10, value: 5 },
  ],
  prefetcher: [
    { id: 'pattern', label: 'Access pattern', type: 'select', options: [so_('sequential', 'Sequential scan'), so_('stride', 'Stride (every 3rd page)'), so_('index', 'Index-driven (random known)'), so_('random', 'Random (unknown)')], value: 'sequential' },
    { id: 'engine', label: 'I/O engine', type: 'select', options: [so_('blocking', 'Blocking pread (QD1)'), so_('uring', 'io_uring async')], value: 'blocking' },
    { id: 'qd', label: 'Queue depth', type: 'range', min: 1, max: 16, value: 8 },
    { id: 'win', label: 'Max readahead window', type: 'range', min: 2, max: 16, value: 8 },
    { id: 'prefetch', label: 'Prefetch enabled', type: 'toggle', value: true },
    { id: 'restart', label: 'Restart run', type: 'button' },
    { id: 'speed', label: 'Sim speed', type: 'range', min: 1, max: 4, value: 1 },
  ],
};
for (const id of Object.keys(META)) {
  const v = views[id]; const origBuild = v.build;
  v.controls = META[id].map((m) => ({ ...m, onChange(val, api) { const c = current[id] && current[id]._controls.find((x) => x.id === m.id); if (c) c.onChange(val, api); } }));
  v.build = function (ctx) { const inst = origBuild.call(this, ctx); current[id] = inst; return inst; };
}
