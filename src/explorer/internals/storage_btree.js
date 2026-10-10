// btree view: B+tree (split/merge/redistribute/overflow/leaf links), COW B-tree (path copying), BwTree (mapping table + delta chains).
import * as THREE from 'three';
import { makeKit, C, rng } from './storage_kit.js';
import { makeLib, PAL, wrap } from './storage_tkit.js';

const M = 3; // max keys per page (tiny so splits are visible; real pages hold hundreds)
const MIN_LEAF = Math.ceil(M / 2), MIN_INT = Math.ceil((M + 1) / 2) - 1;

// ---------------------------------------------------------------- B+tree model
class BPT {
  constructor(cow) { this.cow = cow; this.nid = 1; this.pidc = 1; this.big = new Set(); this.stats = { splits: 0, merges: 0, borrows: 0, copies: 0 }; this.ev = []; this.touched = new Set(); this.spawn = new Map(); this.root = this.mk(true); }
  mk(leaf) { const n = { id: this.nid++, pid: this.pidc++, leaf, keys: [], ch: [], next: null }; this.touched.add(n); return n; }
  begin() { this.ev = []; this.touched = new Set(); this.spawn = new Map(); this.old = this.snap(); }
  touch(n) { if (this.cow && !this.touched.has(n)) { this.touched.add(n); n.pid = this.pidc++; this.stats.copies++; this.ev.push({ t: 'cow', id: n.id, text: `copy page -> new page #${n.pid} (old version untouched)` }); } }
  snap() { const m = new Map(); const rec = (n) => { m.set(n.pid, { pid: n.pid, leaf: n.leaf, keys: n.keys.slice(), big: n.keys.filter((k) => this.big.has(k)), ch: n.ch.map((c) => c.pid) }); n.ch.forEach(rec); }; rec(this.root); return { map: m, root: this.root.pid }; }
  path(key) { let n = this.root; const p = []; while (!n.leaf) { let i = 0; while (i < n.keys.length && key >= n.keys[i]) i++; p.push({ n, i }); n = n.ch[i]; } return { p, leaf: n }; }
  visit(p, leaf, key, touch) {
    for (const { n, i } of p) { if (touch) this.touch(n); this.ev.push({ t: 'visit', id: n.id, text: `root->leaf: ${key} vs [${n.keys.join(' ')}] => child ${i}` }); }
    if (touch) this.touch(leaf);
  }
  insert(key, big) {
    this.begin(); const { p, leaf } = this.path(key); this.visit(p, leaf, key, true);
    const at = leaf.keys.indexOf(key);
    this.ev.push({ t: 'visit', id: leaf.id, cell: at, text: `leaf [${leaf.keys.join(' ')}]` });
    if (at >= 0) { this.ev.push({ t: 'note', id: leaf.id, text: `key ${key} exists - updated in place (unique index)` }); if (big) this.big.add(key); return; }
    let i = 0; while (i < leaf.keys.length && leaf.keys[i] < key) i++;
    leaf.keys.splice(i, 0, key); if (big) { this.big.add(key); this.ev.push({ t: 'note', id: leaf.id, text: `value too large for the page -> stored in an overflow page chain, leaf keeps a pointer` }); }
    this.ev.push({ t: 'ins', id: leaf.id, cell: i, text: `insert ${key} at slot ${i}` });
    if (leaf.keys.length > M) this.splitLeaf(leaf, p);
  }
  splitLeaf(leaf, p) {
    const r = this.mk(true); const k = Math.ceil(leaf.keys.length / 2);
    r.keys = leaf.keys.splice(k); r.next = leaf.next; leaf.next = r; this.spawn.set(r.id, leaf.id); this.stats.splits++;
    this.ev.push({ t: 'split', ids: [leaf.id, r.id], text: `LEAF SPLIT: overflow (${M + 1} > ${M}). Right half [${r.keys.join(' ')}] -> new page; separator ${r.keys[0]} COPIED up; sibling links rewired` });
    this.up(p, leaf, r.keys[0], r);
  }
  up(p, left, sep, right) {
    if (!p.length) {
      const r = this.mk(false); r.keys = [sep]; r.ch = [left, right]; this.spawn.set(r.id, this.root.id); this.root = r;
      this.ev.push({ t: 'split', ids: [r.id], text: `ROOT SPLIT: new root created, tree height +1 (only way a B+tree grows)` }); return;
    }
    const { n, i } = p.pop(); n.keys.splice(i, 0, sep); n.ch.splice(i + 1, 0, right);
    this.ev.push({ t: 'note', id: n.id, text: `parent gets separator ${sep} + pointer` });
    if (n.keys.length > M) {
      const mid = Math.floor(n.keys.length / 2), upk = n.keys[mid]; const r = this.mk(false);
      r.keys = n.keys.splice(mid + 1); n.keys.pop(); r.ch = n.ch.splice(mid + 1); this.spawn.set(r.id, n.id); this.stats.splits++;
      this.ev.push({ t: 'split', ids: [n.id, r.id], text: `INTERNAL SPLIT: separator ${upk} MOVED up (not kept in either half)` });
      this.up(p, n, upk, r);
    }
  }
  delete(key) {
    this.begin(); const { p, leaf } = this.path(key); this.visit(p, leaf, key, true);
    const at = leaf.keys.indexOf(key);
    if (at < 0) { this.ev.push({ t: 'visit', id: leaf.id, text: `leaf [${leaf.keys.join(' ')}]` }); this.ev.push({ t: 'note', id: leaf.id, text: `key ${key} not in tree` }); return false; }
    leaf.keys.splice(at, 1); this.big.delete(key);
    this.ev.push({ t: 'del', id: leaf.id, text: `remove ${key} from leaf` });
    this.fix(leaf, p); return true;
  }
  fix(n, p) {
    if (!p.length) { if (!n.leaf && n.keys.length === 0) { this.root = n.ch[0]; this.ev.push({ t: 'note', id: this.root.id, text: `root had a single child left -> child becomes root, height -1` }); } return; }
    const min = n.leaf ? MIN_LEAF : MIN_INT; if (n.keys.length >= min) return;
    const { n: par, i } = p.pop(); const Lf = i > 0 ? par.ch[i - 1] : null, R = i < par.ch.length - 1 ? par.ch[i + 1] : null;
    this.ev.push({ t: 'note', id: n.id, text: `UNDERFLOW: ${n.keys.length} < min ${min} keys` });
    if (Lf && Lf.keys.length > min) {
      this.touch(Lf); this.stats.borrows++;
      if (n.leaf) { n.keys.unshift(Lf.keys.pop()); par.keys[i - 1] = n.keys[0]; } else { n.keys.unshift(par.keys[i - 1]); par.keys[i - 1] = Lf.keys.pop(); n.ch.unshift(Lf.ch.pop()); }
      this.ev.push({ t: 'ok', ids: [n.id, Lf.id], text: `REDISTRIBUTE: borrowed from left sibling, parent separator rotated to ${par.keys[i - 1]}` }); return;
    }
    if (R && R.keys.length > min) {
      this.touch(R); this.stats.borrows++;
      if (n.leaf) { n.keys.push(R.keys.shift()); par.keys[i] = R.keys[0]; } else { n.keys.push(par.keys[i]); par.keys[i] = R.keys.shift(); n.ch.push(R.ch.shift()); }
      this.ev.push({ t: 'ok', ids: [n.id, R.id], text: `REDISTRIBUTE: borrowed from right sibling, parent separator rotated to ${par.keys[i]}` }); return;
    }
    let a, b, si; if (Lf) { this.touch(Lf); a = Lf; b = n; si = i - 1; } else { this.touch(R); a = n; b = R; si = i; }
    if (a.leaf) { a.keys.push(...b.keys); a.next = b.next; } else { a.keys.push(par.keys[si], ...b.keys); a.ch.push(...b.ch); }
    par.keys.splice(si, 1); par.ch.splice(si + 1, 1); this.stats.merges++; this.spawn.set(b.id, a.id);
    this.ev.push({ t: 'ok', ids: [a.id], text: `MERGE: siblings combined into one page, separator removed from parent (may cascade up)` });
    this.fix(par, p);
  }
  lookup(key) {
    this.begin(); const { p, leaf } = this.path(key); this.visit(p, leaf, key, false);
    const at = leaf.keys.indexOf(key);
    this.ev.push({ t: 'visit', id: leaf.id, cell: at, text: `binary search in leaf [${leaf.keys.join(' ')}]` });
    this.ev.push({ t: at >= 0 ? 'found' : 'note', id: leaf.id, cell: at, text: at >= 0 ? `FOUND ${key}${this.big.has(key) ? ' (value on overflow pages)' : ''}` : `${key} not present` });
    return at >= 0;
  }
  scan(key, leaves = 3) {
    this.begin(); const { p, leaf } = this.path(key); this.visit(p, leaf, key, false);
    let l = leaf, c = 0; const out = [];
    while (l && c < leaves) { l.keys.forEach((k, i) => { if (k >= key) { out.push(k); this.ev.push({ t: 'found', id: l.id, cell: i, text: `scan emits ${k}` }); } }); this.ev.push({ t: 'visit', id: l.id, text: `follow leaf sibling pointer ->` }); l = l.next; c++; }
    return out;
  }
  height() { let h = 1, n = this.root; while (!n.leaf) { h++; n = n.ch[0]; } return h; }
  count() { let c = 0; const r = (n) => { c++; n.ch.forEach(r); }; r(this.root); return c; }
  keyCount() { let n = this.root; while (!n.leaf) n = n.ch[0]; let c = 0; for (; n; n = n.next) c += n.keys.length; return c; }
}

// ---------------------------------------------------------------- BwTree model
class Bw {
  constructor() { this.cap = 6; this.thr = 3; this.pidc = 1; this.addr = 0x1000; this.stats = { cas: 0, fail: 0, consol: 0, splits: 0 }; this.garbage = 0;
    this.inner = { keys: [40], pids: [1, 2] }; this.map = new Map();
    this.newPage([10, 20, 30]); this.newPage([40, 50, 60]); this.ev = []; }
  A() { const a = this.addr; this.addr += 0x40; return '0x' + a.toString(16); }
  newPage(keys) { const pid = this.pidc++; this.map.set(pid, { type: 'base', keys, addr: this.A() }); return pid; }
  route(key) { let i = 0; while (i < this.inner.keys.length && key >= this.inner.keys[i]) i++; return this.inner.pids[i]; }
  chain(pid) { const a = []; for (let r = this.map.get(pid); r; r = r.next) a.push(r); return a; }
  logical(pid) { const seen = new Map(); let base; for (const r of this.chain(pid)) { if (r.type === 'base') base = r; else if (!seen.has(r.key)) seen.set(r.key, r.type === 'ins'); } const s = new Set(base.keys); seen.forEach((v, k) => { v ? s.add(k) : s.delete(k); }); return [...s].sort((a, b) => a - b); }
  delta(type, key) {
    this.ev = []; const pid = this.route(key); const head = this.map.get(pid);
    this.ev.push({ t: 'route', pid, text: `inner page P0: key ${key} routes to logical page P${pid}` });
    this.ev.push({ t: 'map', pid, text: `mapping table: P${pid} -> ${head.addr}` });
    const d = { type, key, next: head, addr: this.A() };
    this.ev.push({ t: 'cas', pid, text: `CAS(map[P${pid}], ${head.addr} -> ${d.addr}) ok: ${type === 'ins' ? 'insert' : 'delete'}-delta ${key} prepended, no latch`, rec: d });
    this.map.set(pid, d); this.stats.cas++;
    if (this.chain(pid).length - 1 > this.thr) this.consolidate(pid);
    return pid;
  }
  consolidate(pid) {
    const keys = this.logical(pid); const n = this.chain(pid).length - 1; this.garbage += n + 1; this.stats.consol++;
    this.ev.push({ t: 'consol', pid, text: `chain length ${n} > ${this.thr}: CONSOLIDATE - replay deltas into a fresh sorted page, CAS mapping table to it; old chain goes to epoch GC` });
    if (keys.length > this.cap) {
      const k = Math.ceil(keys.length / 2), lk = keys.slice(0, k), rk = keys.slice(k); const rp = this.newPage(rk); this.stats.splits++;
      this.map.set(pid, { type: 'base', keys: lk, addr: this.A() });
      const i = this.inner.pids.indexOf(pid); this.inner.keys.splice(i, 0, rk[0]); this.inner.pids.splice(i + 1, 0, rp);
      this.ev.push({ t: 'split', pid: rp, text: `page overfull (${keys.length} > ${this.cap}): SPLIT. split-delta on P${pid} (sep ${rk[0]} -> P${rp}), then index-entry delta on parent P0; readers follow the side pointer` });
    } else this.map.set(pid, { type: 'base', keys, addr: this.A() });
  }
  lookup(key) {
    this.ev = []; const pid = this.route(key); this.ev.push({ t: 'route', pid, text: `inner page routes ${key} -> P${pid}` });
    let res = null; let i = 0;
    for (const r of this.chain(pid)) {
      if (r.type === 'base') { res = r.keys.includes(key); this.ev.push({ t: 'rec', pid, idx: i, text: `base page: binary search -> ${res ? 'FOUND' : 'not found'}`, hit: res }); break; }
      const m = r.key === key; this.ev.push({ t: 'rec', pid, idx: i, text: m ? `${r.type} delta for ${key} => ${r.type === 'ins' ? 'FOUND' : 'DELETED (not found)'}` : `delta (${r.type} ${r.key}) - not our key, follow next`, hit: m ? r.type === 'ins' : undefined });
      if (m) { res = r.type === 'ins'; break; } i++;
    }
    return res;
  }
  race(key) {
    this.ev = []; const pid = this.route(key); const head = this.map.get(pid);
    const dA = { type: 'ins', key, next: head, addr: this.A() }, dB = { type: 'ins', key: key + 1, next: head, addr: this.A() };
    this.ev.push({ t: 'map', pid, text: `Thread A and B both read mapping[P${pid}] = ${head.addr}` });
    this.map.set(pid, dA); this.stats.cas++;
    this.ev.push({ t: 'cas', pid, rec: dA, text: `Thread A: CAS(expected ${head.addr} -> ${dA.addr}) SUCCEEDS (insert ${key})` });
    this.stats.fail++;
    this.ev.push({ t: 'fail', pid, text: `Thread B: CAS(expected ${head.addr} -> ${dB.addr}) FAILS - head is now ${dA.addr}. Nobody blocked; B retries` });
    dB.next = dA; this.map.set(pid, dB); this.stats.cas++;
    this.ev.push({ t: 'cas', pid, rec: dB, text: `Thread B: re-read head ${dA.addr}, relink delta, CAS SUCCEEDS (insert ${key + 1}). Both inserts visible, lock-free` });
    if (this.chain(pid).length - 1 > this.thr) this.consolidate(pid);
  }
}

// ---------------------------------------------------------------- view
let cur = null;
const CTL_DEFS = [
  { id: 'key', label: 'key', type: 'range', min: 1, max: 99, value: 35 },
  { id: 'insert', label: 'Insert key', type: 'button' }, { id: 'delete', label: 'Delete key', type: 'button' },
  { id: 'lookup', label: 'Lookup key', type: 'button' }, { id: 'scan', label: 'Range scan from key', type: 'button' },
  { id: 'random', label: 'Insert 5 random', type: 'button' },
  { id: 'big', label: 'large value (overflow page)', type: 'toggle', value: false },
  { id: 'race', label: 'Bw-tree: race 2 threads (CAS)', type: 'button' }, { id: 'reset', label: 'Reset tree', type: 'button' },
];
export const views = {
  btree: {
    build(ctx) {
      const K = makeKit(ctx), L = makeLib(); const g = K.group;
      const content = new THREE.Group(); g.add(content);
      const caption = K.dyn('', { size: 1.0, lines: 2, w: 1536, px: 34, color: C.text, bg: 'rgba(16,22,42,0.85)' }); caption.position.set(0, 6.0, 0.5); g.add(caption);
      const stat = K.dyn('', { size: 0.5, w: 1536, px: 36, color: C.dim }); stat.position.set(0, -6.4, 0.5); g.add(stat);
      let mode = 'bplustree', T = null, W = null, refs = new Map(), prevPos = new Map(), rnd = rng(11), keyVal = 35, bigFlag = false;
      const modeOf = (cfg) => { const v = cfg && cfg['index-structure']; return v === 'cow-btree' ? 'cow-btree' : v === 'bwtree' ? 'bwtree' : 'bplustree'; };
      const title = { bplustree: 'B+tree (in-place update, leaf sibling links)', 'cow-btree': 'Copy-on-write B-tree (LMDB / Btrfs path copying, no leaf links)', bwtree: 'Bw-tree (mapping table + delta chains, latch-free CAS)' };

      function reset(open) {
        K.clearAnim(); prevPos = new Map();
        if (mode === 'bwtree') { W = new Bw(); T = null; } else { T = new BPT(mode === 'cow-btree'); W = null; for (const k of [10, 20, 30, 40, 50, 60, 70, 80]) T.insert(k); T.ev = []; T.stats = { splits: 0, merges: 0, borrows: 0, copies: 0 }; T.old = T.snap(); T.touched = new Set(); }
        mode === 'bwtree' ? renderBw() : render(false); caption.setText(wrap(title[mode])); K.info(open || intro());
      }
      function intro() {
        return mode === 'bplustree' ? `<b>B+tree</b>: keys only guide the search in internal pages; every (key,value) lives in a leaf; leaves form a doubly linked list for range scans. Page capacity shown is ${M} keys (real 8-16KB pages hold hundreds). Use insert / delete / lookup.`
          : mode === 'cow-btree' ? `<b>COW B-tree</b>: pages are never modified in place. Every write copies the root-to-leaf path to new pages and atomically flips the meta-page root pointer (LMDB: 2 meta pages; Btrfs: superblock). Readers keep a consistent snapshot of the old root for free; old pages (red ghosts) are reclaimed once no reader needs them. Cost: write amplification of tree-height pages per update, and no leaf sibling links (they would need copying too).`
            : `<b>Bw-tree</b> (Hekaton / Microsoft): logical page ids go through a <i>mapping table</i>; an update prepends a delta record to the page chain with one CAS on the table entry. Long chains are consolidated into a new base page. No latches, and flash/log-structured friendly because pages are never overwritten.`;
      }
      const nodeW = M * 0.72 + 0.3, cw = 0.72, DY = 2.7;

      // -------- B+ / COW rendering
      function vnodeOf(n) { return { id: n.id, pid: n.pid, leaf: n.leaf, keys: n.keys, big: n.leaf ? n.keys.filter((k) => T.big.has(k)) : [], ch: n.ch.map(vnodeOf) }; }
      function vSnap(sn, pid) { const s = sn.map.get(pid); return { id: 'g' + pid, pid, leaf: s.leaf, keys: s.keys, big: s.big, ch: s.ch.map((c) => vSnap(sn, c)) }; }
      function layout(root) {
        let cur = 0; const pos = new Map(); let maxD = 0;
        (function rec(n, d) { maxD = Math.max(maxD, d); if (n.leaf) { pos.set(n.id, { x: cur + nodeW / 2, d }); cur += nodeW + 0.55; } else { n.ch.forEach((c) => rec(c, d + 1)); pos.set(n.id, { x: (pos.get(n.ch[0].id).x + pos.get(n.ch[n.ch.length - 1].id).x) / 2, d }); } })(root, 0);
        return { pos, width: cur - 0.55, depth: maxD };
      }
      function drawNode(vn, x, y, z, ghost) {
        const grp = new THREE.Group(); grp.position.set(x, y, z); content.add(grp);
        const op = ghost ? 0.4 : 1;
        const plate = L.mesh(grp, nodeW, 0.95, 0.3, ghost ? PAL.ghost : vn.leaf ? PAL.leaf : PAL.inner, 0, 0, 0, 0.25, op);
        const cells = [], labels = [];
        for (let i = 0; i < M; i++) {
          const f = i < vn.keys.length, isBig = f && vn.big.includes(vn.keys[i]);
          const base = !f ? PAL.empty : isBig ? PAL.ovf : vn.leaf ? PAL.leafCell : PAL.innerCell;
          const cx = -nodeW / 2 + 0.15 + cw * (i + 0.5);
          const c = L.mesh(grp, cw - 0.08, 0.62, 0.12, base, cx, 0, 0.2, ghost ? 0.1 : 0.3, op); c.userData.base = c.material; cells.push(c);
          if (f) labels.push(L.lab(grp, vn.keys[i], ghost ? '#ffb3c0' : '#0b1020', 0.5, cx, 0, 0.3));
        }
        plate.userData.base = plate.material;
        if (T.cow) L.lab(grp, ghost ? `old #${vn.pid}` : `#${vn.pid}`, ghost ? '#f7768e' : '#7f8bb3', 0.36, -nodeW / 2 + 0.5, 0.68, 0.2);
        return { grp, plate, cells };
      }
      function render(animate) {
        L.clear(content); refs = new Map();
        const root = vnodeOf(T.root), lay = layout(root), yTop = lay.depth * DY / 2;
        const X = (x) => x - lay.width / 2, Y = (d) => yTop - d * DY;
        const edgeG = new THREE.Group(); content.add(edgeG);
        const posOf = new Map(), byPid = new Map(); const newPids = new Set();
        (function walk(n) { newPids.add(n.pid); byPid.set(n.pid, n); n.ch.forEach(walk); })(root);
        (function walk(n) {
          const p = lay.pos.get(n.id), x = X(p.x), y = Y(p.d); posOf.set(n.id, { x, y });
          const r = drawNode(n, x, y, 0, false); refs.set(n.id, r);
          if (animate) { const st = prevPos.get(n.id) || prevPos.get(T.spawn.get(n.id)); if (st) { r.grp.position.set(st.x, st.y, 0); K.move(r.grp, x, y, 0, 0.7); } }
          n.ch.forEach(walk);
        })(root);
        // edges + leaf links + overflow pages (added after motion finishes)
        const drawEdges = () => {
          (function walk(n) {
            const p = posOf.get(n.id);
            if (!n.leaf) n.ch.forEach((c, i) => { const q = posOf.get(c.id); L.seg(edgeG, [p.x - nodeW / 2 + 0.15 + cw * i, p.y - 0.48, -0.1], [q.x, q.y + 0.48, -0.1], 0x7f8bb3, 0.05, 0.4); walk(c); });
            else if (n.big.length) { L.mesh(edgeG, 1.5, 0.55, 0.2, PAL.ovf, p.x, p.y - 1.25, 0, 0.3); L.lab(edgeG, 'overflow pg', '#1a1000', 0.38, p.x, p.y - 1.25, 0.15); L.seg(edgeG, [p.x, p.y - 0.48, 0], [p.x, p.y - 0.95, 0], PAL.ovf, 0.05); }
          })(root);
          if (!T.cow) { const leaves = []; (function w(n) { n.leaf ? leaves.push(n) : n.ch.forEach(w); })(root); for (let i = 0; i + 1 < leaves.length; i++) { const a = posOf.get(leaves[i].id), b = posOf.get(leaves[i + 1].id); L.arrow(edgeG, [a.x + nodeW / 2, a.y + 0.12, 0.1], [b.x - nodeW / 2, b.y + 0.12, 0.1], PAL.link, 0.05); } }
          if (T.cow) { // meta page + ghosts of the previous version
            const rp = posOf.get(root.id); const mp = new THREE.Group(); mp.position.set(rp.x + nodeW / 2 + 2.2, rp.y, 0); edgeG.add(mp);
            L.mesh(mp, 2.6, 0.8, 0.25, 0x6b4f12, 0, 0, 0, 0.3); L.lab(mp, `meta: root=#${root.pid}`, '#ffe9b0', 0.4, 0, 0, 0.2, true);
            L.arrow(edgeG, [rp.x + nodeW / 2 + 0.9, rp.y, 0], [rp.x + nodeW / 2 + 0.02, rp.y, 0], PAL.hi, 0.06);
            const osn = T.old; if (osn && osn.map.size) {
              const ov = vSnap(osn, osn.root), ol = layout(ov); const gp = new Map();
              const OX = (x) => x - ol.width / 2 + 1.0, OY = (d) => yTop - d * DY + 1.0;
              (function w(n) { const p = ol.pos.get(n.id); gp.set(n.pid, { x: OX(p.x), y: OY(p.d) }); n.ch.forEach(w); })(ov);
              (function w(n) {
                if (!newPids.has(n.pid)) {
                  const q = gp.get(n.pid); drawNode(n, q.x, q.y, -2.4, true);
                  edgeG.add(content.children[content.children.length - 1]);
                  n.ch.forEach((c) => { const tgt = newPids.has(c.pid) ? posOf.get(byPid.get(c.pid).id) : gp.get(c.pid); const tz = newPids.has(c.pid) ? 0 : -2.4; L.seg(edgeG, [q.x, q.y - 0.4, -2.4], [tgt.x, tgt.y + 0.4, tz], newPids.has(c.pid) ? 0x9ece6a : 0xf7768e, 0.04, 0.4, 0.55); });
                }
                n.ch.forEach(w);
              })(ov);
              L.lab(edgeG, 'red = old version, green links = shared pages', '#f7768e', 0.45, 0, -yTop - 2.2, 0, true);
            }
          }
        };
        if (animate && T.spawn.size) { edgeG.visible = false; K.after(0.75, () => { edgeG.visible = true; }); }
        drawEdges();
        prevPos = posOf; fit(lay.width + (T.cow ? 5 : 0), (lay.depth + 1) * DY + 3.5);
        statLine();
      }
      function fit(w, h) { const s = Math.min(1.5, 19 / w, 11.5 / h); content.scale.setScalar(s); content.position.set(T && T.cow ? -1.3 * s : 0, -0.2, 0); }
      function statLine() {
        if (W) stat.setText(`mapping table entries ${W.map.size}   CAS ok ${W.stats.cas}   CAS failed ${W.stats.fail}   consolidations ${W.stats.consol}   splits ${W.stats.splits}   retired records awaiting epoch GC ${W.garbage}`);
        else stat.setText(`height ${T.height()}   pages ${T.count()}   keys ${T.keyCount()}   splits ${T.stats.splits}   merges ${T.stats.merges}   redistributions ${T.stats.borrows}` + (T.cow ? `   pages copied ${T.stats.copies}` : ''));
      }
      function paint(id, color, cell) {
        const r = refs.get(id); if (!r) return; const hi = (m) => { m.material = L.mat(color, 0.7); };
        if (cell != null && cell >= 0 && r.cells[cell]) hi(r.cells[cell]); else hi(r.plate);
      }
      function restore() { refs.forEach((r) => { r.plate.material = r.plate.userData.base; r.cells.forEach((c) => { c.material = c.userData.base; }); }); }
      function play(evs, summary) {
        const t0 = 0.1 + (T && T.spawn.size ? 0.8 : 0);
        evs.forEach((e, i) => {
          const col = e.t === 'visit' ? PAL.hi : e.t === 'del' ? PAL.bad : PAL.ok;
          K.after(t0 + i * 0.62, () => {
            caption.setText(wrap(e.text));
            if (e.t === 'split' || e.t === 'ok') (e.ids || []).forEach((id) => paint(id, PAL.ok)); else if (e.id != null) paint(e.id, col, e.t === 'cow' ? null : e.cell);
          });
        });
        K.after(t0 + evs.length * 0.62 + 1.6, () => { restore(); caption.setText(wrap(title[mode])); });
        K.info(summary);
      }
      // -------- Bw render
      function renderBw() {
        L.clear(content); refs = new Map();
        const pids = [...W.map.keys()]; const rowY = (i) => 3.6 - i * 1.65;
        L.lab(content, 'Mapping Table (PID -> chain head)', '#7aa2f7', 0.5, -6.2, 5.5, 0, true);
        L.mesh(content, 6.2, 0.9, 0.25, PAL.inner, 3.5, 5.5, 0, 0.25);
        L.lab(content, `P0 inner: ${W.inner.pids.map((p, i) => (i < W.inner.keys.length ? `P${p} <${W.inner.keys[i]}` : `P${p}`)).join(' | ')}`, '#e6ebff', 0.4, 3.5, 5.5, 0.2, true);
        pids.forEach((pid, i) => {
          const y = rowY(i), ch = W.chain(pid); const row = { pid, recs: [] };
          L.mesh(content, 2.8, 0.95, 0.25, 0x30406b, -8.2, y, 0, 0.3); L.lab(content, `P${pid} ${ch[0].addr}`, '#c0caf5', 0.42, -8.2, y, 0.2, true);
          let x = -5.7; let prevEnd = -6.65;
          ch.forEach((r, k) => {
            const isBase = r.type === 'base'; const w = isBase ? 0.62 * Math.max(r.keys.length, 3) + 0.5 : 2.0;
            const col = isBase ? PAL.leaf : r.type === 'ins' ? 0x3d7d2a : 0x9a2f45;
            const cx = x + w / 2; const m = L.mesh(content, w, 0.95, 0.3, col, cx, y, 0, 0.3); m.userData.base = m.material; row.recs.push(m);
            L.lab(content, isBase ? r.keys.join(' ') : `${r.type === 'ins' ? 'ins' : 'del'} ${r.key}`, '#ffffff', 0.45, cx, y, 0.25, true);
            L.arrow(content, [prevEnd, y, 0.1], [x - 0.02, y, 0.1], PAL.link, 0.05);
            prevEnd = x + w; x += w + 0.45;
          });
          refs.set('r' + pid, row);
        });
        L.lab(content, 'green = insert delta, red = delete delta, blue = sorted base page; newest at the left (head)', '#7f8bb3', 0.36, 0, -5.4, 0, true);
        content.scale.setScalar(Math.min(1, 19 / 17)); content.position.set(1.5, 0, 0);
        statLine();
      }
      function playBw(evs, summary) {
        K.clearAnim(); renderBw(); let d = 0.1; const row = (e) => refs.get('r' + e.pid);
        evs.forEach((e) => {
          K.after(d, () => {
            caption.setText(wrap(e.text)); const r = row(e);
            if (r) { if (e.t === 'rec' && r.recs[e.idx]) r.recs[e.idx].material = L.mat(e.hit === true ? PAL.ok : e.hit === false ? PAL.bad : PAL.hi, 0.8); else if (e.t === 'cas' && r.recs[0]) r.recs[0].material = L.mat(PAL.ok, 0.9); else if (e.t === 'fail' && r.recs[0]) r.recs[0].material = L.mat(PAL.bad, 0.9); else if (e.t === 'split' || e.t === 'consol') r.recs.forEach((m) => { m.material = L.mat(PAL.hi, 0.8); }); }
          }); d += 0.9;
        });
        K.after(d + 1.5, () => { renderBw(); caption.setText(wrap(title[mode])); });
        K.info(summary);
      }
      // -------- operations
      function doInsert(key, big) {
        if (mode === 'bwtree') { W.delta('ins', key); renderBw(); return playBw(W.ev, `<b>Insert ${key}</b> as a delta record: one CAS on the mapping table. Chains longer than ${W.thr} get consolidated; pages over ${W.cap} keys split.`); }
        K.clearAnim(); T.insert(key, big); render(true); play(T.ev, `<b>insert(${key})</b>${big ? ' with a large value (overflow)' : ''}: descend root->leaf, insert into the sorted leaf; if it overflows, split and push a separator into the parent (recursively).` + (T.cow ? ' In COW mode every page on the path - including pages that did not split - is copied to a new page id, and the meta root pointer is swapped.' : ''));
      }
      function doDelete(key) {
        if (mode === 'bwtree') { const ex = W.logical(W.route(key)).includes(key); if (!ex) { K.info(`${key} is not in the tree.`); return; } W.delta('del', key); renderBw(); return playBw(W.ev, `<b>Delete ${key}</b>: a delete delta shadows the key; the base page is untouched until consolidation.`); }
        K.clearAnim(); T.delete(key); render(true); play(T.ev, `<b>delete(${key})</b>: remove from leaf; if the leaf drops under ${MIN_LEAF} keys (half full), first try to REDISTRIBUTE from a sibling, otherwise MERGE with it and delete the separator from the parent - this can cascade to the root.`);
      }
      function doLookup(key) {
        if (mode === 'bwtree') { const r = W.lookup(key); renderBw(); return playBw(W.ev, `<b>lookup(${key})</b> -> ${r ? 'found' : 'not found'}. Readers walk the delta chain newest-to-oldest; the first record mentioning the key wins, else search the base page.`); }
        K.clearAnim(); const r = T.lookup(key); render(false); play(T.ev, `<b>lookup(${key})</b> -> ${r ? 'found' : 'not found'}. ${T.height()} page reads (height); upper levels are almost always cached in the buffer pool.`);
      }
      function doScan(key) {
        if (mode !== 'bplustree') { K.info('Range scans via sibling pointers are a B+tree feature. ' + (mode === 'cow-btree' ? 'COW B-trees (LMDB) have no leaf links because every split would force copying the neighbour; they re-descend from the parent (cursor stack) instead.' : 'The Bw-tree keeps a side-link to the right sibling in each base page.')); return; }
        K.clearAnim(); const out = T.scan(key); render(false); play(T.ev, `<b>range scan from ${key}</b>: one descent, then follow leaf next-pointers: emitted [${out.join(', ')}] with no further root visits.`);
      }
      const randKey = () => 1 + Math.floor(rnd() * 99);
      const inst = {
        group: g,
        update(dt) { K.tick(dt); },
        dispose() { L.clear(content); L.dispose(); K.dispose(); },
        onConfigChange(cfg) { const m = modeOf(cfg); if (m !== mode) { mode = m; reset(); } },
        steps: [
          { title: 'Lookup: root to leaf', text: 'Binary-search each page to pick one child; cost = tree height page reads.', run() { doLookup(mode === 'bwtree' ? 50 : 50); } },
          { title: 'Insert into a leaf', text: 'Sorted insert into the target leaf; no structural change while there is room.', run() { doInsert(mode === 'bwtree' ? 25 : 35); } },
          { title: 'Overflow causes a split', text: 'A full page splits; the separator goes up (copied for leaves, moved for internals). Height only grows by splitting the root.', run() { if (mode === 'bwtree') { [22, 23, 24].forEach((k) => W.delta('ins', k)); doInsert(26); } else { doInsert(36); doInsert(37); } } },
          { title: mode === 'cow-btree' ? 'Path copying' : mode === 'bwtree' ? 'CAS race' : 'Overflow page', text: mode === 'cow-btree' ? 'Look at the red ghost pages: the old version stays valid for concurrent readers; only the path changed.' : mode === 'bwtree' ? 'Two writers hit the same page: one CAS fails and retries - no latch is ever held.' : 'Large values live on overflow pages; the leaf stores a pointer.', run() { if (mode === 'bwtree') { W.race(50); renderBw(); playBw(W.ev, '<b>Two threads race on P2.</b> CAS = compare-and-swap on the mapping-table slot.'); } else if (mode === 'cow-btree') doInsert(45); else doInsert(65, true); } },
          { title: 'Delete: redistribute / merge', text: 'Underfull pages borrow from a sibling or merge with it; merges can shrink the tree.', run() { doDelete(mode === 'bwtree' ? 10 : 80); } },
          { title: 'Range scan', text: 'B+tree leaves are chained, so a scan reads sequentially after one descent.', run() { doScan(30); } },
        ],
      };
      const ctls = [
        { id: 'key', label: 'key', type: 'range', min: 1, max: 99, value: keyVal, onChange(v) { keyVal = +v; } },
        { id: 'insert', label: 'Insert key', type: 'button', onChange() { doInsert(keyVal, bigFlag); } },
        { id: 'delete', label: 'Delete key', type: 'button', onChange() { doDelete(keyVal); } },
        { id: 'lookup', label: 'Lookup key', type: 'button', onChange() { doLookup(keyVal); } },
        { id: 'scan', label: 'Range scan from key', type: 'button', onChange() { doScan(keyVal); } },
        { id: 'random', label: 'Insert 5 random', type: 'button', onChange() { for (let i = 0; i < 4; i++) { const k = randKey(); mode === 'bwtree' ? W.delta('ins', k) : T.insert(k); } doInsert(randKey()); } },
        { id: 'big', label: 'large value (overflow page)', type: 'toggle', value: false, onChange(v) { bigFlag = !!v; } },
        { id: 'race', label: 'Bw-tree: race 2 threads (CAS)', type: 'button', onChange() { if (mode !== 'bwtree') { K.info('Switch index-structure to bwtree to see the CAS race.'); return; } W.race(keyVal); playBw(W.ev, '<b>Two threads race on one mapping-table slot.</b>'); } },
        { id: 'reset', label: 'Reset tree', type: 'button', onChange() { reset(); } },
      ];
      mode = modeOf(ctx.config); cur = Object.fromEntries(ctls.map((c) => [c.id, c.onChange]));
      reset();
      return inst;
    },
    controls: CTL_DEFS.map((d) => ({ ...d, onChange: (v, api) => cur && cur[d.id] && cur[d.id](v, api) })),
  },
};
