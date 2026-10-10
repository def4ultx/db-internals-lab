// skiplist + adaptive-radix-tree views (real data structures, step-by-step animated).
import * as THREE from 'three';
import { makeKit, C, rng } from './storage_kit.js';
import { makeLib, PAL, wrap } from './storage_tkit.js';

const hx = (b) => '0x' + b.toString(16).padStart(2, '0');
const chr = (b) => (b === 0 ? '∅' : b >= 33 && b < 127 ? String.fromCharCode(b) : hx(b));

// ======================================================================= SKIPLIST
const SL_MAX = 5;
class SkipList {
  constructor() { this.rand = rng(7); this.head = { key: -Infinity, h: SL_MAX, fw: [] }; this.n = 0; this.ev = []; this.fresh = null; }
  find(key) {
    const steps = [], update = []; let x = this.head;
    for (let l = SL_MAX - 1; l >= 0; l--) {
      while (x.fw[l] && x.fw[l].key < key) { x = x.fw[l]; steps.push({ n: x, l, text: `L${l}: ${x.key} < ${key} -> move right` }); }
      update[l] = x;
      const nx = x.fw[l]; steps.push({ n: x, l, down: true, text: `L${l}: next is ${nx ? nx.key : 'NIL'} ${nx && nx.key === key ? '= ' : '>= '}${key} -> ${l ? 'drop down a level' : 'stop at level 0'}` });
    }
    return { steps, update };
  }
  search(key) {
    this.ev = []; const { steps, update } = this.find(key); this.ev.push(...steps);
    const t = update[0].fw[0]; const ok = !!t && t.key === key;
    this.ev.push({ n: ok ? t : update[0], l: 0, res: ok, text: ok ? `FOUND ${key} (tower height ${t.h})` : `${key} not found: predecessor ${update[0].key === -Infinity ? 'HEAD' : update[0].key}` });
    return ok;
  }
  insert(key, lockfree) {
    this.ev = []; this.fresh = null; const { steps, update } = this.find(key); this.ev.push(...steps);
    const ex = update[0].fw[0]; if (ex && ex.key === key) { this.ev.push({ n: ex, l: 0, res: true, text: `${key} already present - skip` }); return; }
    if (this.n >= 16) { this.ev.push({ n: update[0], l: 0, text: 'demo capped at 16 keys - delete some' }); return; }
    let h = 1; const flips = ['H']; flips.length = 0;
    while (h < SL_MAX && this.rand() < 0.5) { h++; flips.push('H'); } if (h < SL_MAX) flips.push('T');
    const node = { key, h, fw: [] }; this.fresh = node;
    this.ev.push({ n: update[0], l: 0, text: `coin flips ${flips.join(' ')} -> tower height ${h} (p=1/2 per level)` });
    for (let l = 0; l < h; l++) {
      const pr = update[l], sc = pr.fw[l]; node.fw[l] = sc; pr.fw[l] = node;
      this.ev.push({ n: pr, l, link: node, text: lockfree ? `L${l}: CAS(pred ${pr.key === -Infinity ? 'HEAD' : pr.key}.next[${l}], ${sc ? sc.key : 'NIL'} -> ${key})${l === 0 ? ' - LINEARIZATION POINT: key now visible' : ' (index level, best effort)'}` : `L${l}: splice ${pr.key === -Infinity ? 'HEAD' : pr.key} -> ${key} -> ${sc ? sc.key : 'NIL'}` });
    }
    this.n++;
  }
  remove(key, lockfree) {
    this.ev = []; this.fresh = null; const { steps, update } = this.find(key); this.ev.push(...steps);
    const t = update[0].fw[0]; if (!t || t.key !== key) { this.ev.push({ n: update[0], l: 0, text: `${key} not present` }); return; }
    if (lockfree) this.ev.push({ n: t, l: 0, res: false, text: `mark ${key}'s next pointers (logical delete: low bit tagged), then unlink - readers still passing through can finish` });
    for (let l = t.h - 1; l >= 0; l--) { const pr = update[l]; if (pr.fw[l] === t) { pr.fw[l] = t.fw[l]; this.ev.push({ n: pr, l, text: `L${l}: ${pr.key === -Infinity ? 'HEAD' : pr.key} -> ${t.fw[l] ? t.fw[l].key : 'NIL'} (unlink ${key})` }); } }
    this.n--;
  }
  list() { const a = []; for (let x = this.head.fw[0]; x; x = x.fw[0]) a.push(x); return a; }
}

// ======================================================================= ART
const CAP = { 4: 4, 16: 16, 48: 48, 256: 256 };
class ART {
  constructor() { this.root = null; this.id = 1; this.ev = []; this.fresh = new Set(); this.stats = { grows: 0, shrinks: 0 }; }
  leaf(k, s) { const n = { id: this.id++, leaf: true, key: k, s }; this.fresh.add(n.id); return n; }
  inner() { const n = { id: this.id++, type: 4, prefix: [], kids: [] }; this.fresh.add(n.id); return n; }
  static find(n, b) { return n.kids.find((c) => c.b === b); }
  static add(n, b, c) { n.kids.push({ b, n: c }); n.kids.sort((x, y) => x.b - y.b); }
  pfx(p) { return p.length ? `"${p.map(chr).join('')}"` : '(none)'; }
  insert(s) { this.ev = []; this.fresh = new Set(); const k = [...s].map((c) => c.charCodeAt(0)).concat(0); this.root = this.ins(this.root, k, 0, s); }
  ins(node, k, d, s) {
    if (!node) { this.ev.push({ t: 'note', text: `tree empty: root is a single leaf (lazy expansion: no inner nodes)` }); return this.leaf(k, s); }
    if (node.leaf) {
      if (node.key.length === k.length && node.key.every((v, i) => v === k[i])) { this.ev.push({ t: 'leaf', id: node.id, text: `leaf "${s}" matches full key - value updated` }); return node; }
      let p = 0; while (node.key[d + p] === k[d + p]) p++;
      const n4 = this.inner(); n4.prefix = k.slice(d, d + p); ART.add(n4, node.key[d + p], node); ART.add(n4, k[d + p], this.leaf(k, s));
      this.ev.push({ t: 'leaf', id: node.id, text: `hit leaf "${node.s}": it was stored lazily (tail bytes not expanded)` });
      this.ev.push({ t: 'new', id: n4.id, text: `diverge at byte ${chr(node.key[d + p])} vs ${chr(k[d + p])}: new Node4, path-compressed prefix ${this.pfx(n4.prefix)} (no nodes for shared bytes)` });
      return n4;
    }
    let p = 0; while (p < node.prefix.length && node.prefix[p] === k[d + p]) p++;
    if (p < node.prefix.length) {
      const n4 = this.inner(); n4.prefix = node.prefix.slice(0, p); const b = node.prefix[p]; node.prefix = node.prefix.slice(p + 1);
      ART.add(n4, b, node); ART.add(n4, k[d + p], this.leaf(k, s));
      this.ev.push({ t: 'visit', id: node.id, text: `Node${node.type} prefix mismatch at byte ${chr(k[d + p])} vs ${chr(b)}: SPLIT the compressed prefix` });
      this.ev.push({ t: 'new', id: n4.id, text: `new Node4 holds the shared part ${this.pfx(n4.prefix)}; old node keeps remainder ${this.pfx(node.prefix)}` });
      return n4;
    }
    d += node.prefix.length; const b = k[d]; const c = ART.find(node, b);
    this.ev.push({ t: 'visit', id: node.id, b, text: `Node${node.type}: prefix ${this.pfx(node.prefix)} matches, next byte ${chr(b)} (${hx(b)})` + (c ? ' -> child exists, descend' : ' -> no child') });
    if (c) { c.n = this.ins(c.n, k, d + 1, s); return node; }
    if (node.kids.length >= CAP[node.type]) { const nt = node.type === 4 ? 16 : node.type === 16 ? 48 : 256; this.ev.push({ t: 'grow', id: node.id, text: `Node${node.type} is full (${node.kids.length}/${CAP[node.type]}) -> GROW to Node${nt} (copy ${node.kids.length} children${nt === 48 ? ', build 256-byte index' : nt === 256 ? ', direct array' : ''})` }); node.type = nt; this.stats.grows++; this.fresh.add(node.id); }
    ART.add(node, b, this.leaf(k, s)); this.ev.push({ t: 'add', id: node.id, b, text: `insert child under byte ${chr(b)} (${node.kids.length}/${CAP[node.type]})` });
    return node;
  }
  lookup(s) {
    this.ev = []; const k = [...s].map((c) => c.charCodeAt(0)).concat(0); let n = this.root, d = 0;
    while (n) {
      if (n.leaf) { const ok = n.key.length === k.length && n.key.every((v, i) => v === k[i]); this.ev.push({ t: ok ? 'found' : 'miss', id: n.id, text: ok ? `leaf: full key compare "${n.s}" == "${s}" -> FOUND` : `leaf holds "${n.s}" != "${s}" -> MISS (lazy expansion requires comparing the whole key)` }); return ok; }
      let p = 0; while (p < n.prefix.length && n.prefix[p] === k[d + p]) p++;
      if (p < n.prefix.length) { this.ev.push({ t: 'miss', id: n.id, text: `prefix ${this.pfx(n.prefix)} mismatch -> MISS` }); return false; }
      d += n.prefix.length; const b = k[d]; const c = ART.find(n, b);
      this.ev.push({ t: 'visit', id: n.id, b, text: `Node${n.type}: skip prefix ${this.pfx(n.prefix)}, byte ${chr(b)} (${hx(b)}) -> ${n.type === 4 ? 'linear scan of 4 keys' : n.type === 16 ? 'SIMD compare of 16 keys' : n.type === 48 ? 'child_index[byte] -> slot' : 'direct array[byte]'}` });
      if (!c) { this.ev.push({ t: 'miss', id: n.id, text: `no child for ${chr(b)} -> MISS` }); return false; }
      n = c.n; d++;
    }
    this.ev.push({ t: 'miss', text: 'empty tree' }); return false;
  }
  remove(s) {
    this.ev = []; this.fresh = new Set(); const k = [...s].map((c) => c.charCodeAt(0)).concat(0);
    const r = this.del(this.root, k, 0); if (r.found) this.root = r.node; else this.ev.push({ t: 'miss', text: `"${s}" not present` }); return r.found;
  }
  del(node, k, d) {
    if (!node) return { node, found: false };
    if (node.leaf) { const eq = node.key.length === k.length && node.key.every((v, i) => v === k[i]); if (eq) this.ev.push({ t: 'del', id: node.id, text: `leaf "${node.s}" removed` }); return { node: eq ? null : node, found: eq }; }
    let p = 0; while (p < node.prefix.length && node.prefix[p] === k[d + p]) p++; if (p < node.prefix.length) return { node, found: false };
    d += node.prefix.length; const b = k[d]; const c = ART.find(node, b); if (!c) return { node, found: false };
    this.ev.push({ t: 'visit', id: node.id, b, text: `Node${node.type}: byte ${chr(b)} -> descend` });
    const r = this.del(c.n, k, d + 1); if (!r.found) return { node, found: false };
    if (r.node === null) node.kids = node.kids.filter((x) => x !== c); else c.n = r.node;
    const cnt = node.kids.length;
    if (cnt === 1 && node.type === 4) {
      const o = node.kids[0]; this.stats.shrinks++;
      if (o.n.leaf) { this.ev.push({ t: 'shrink', id: node.id, text: `Node4 left with 1 child (a leaf): node removed, parent points straight at the leaf (lazy expansion)` }); return { node: o.n, found: true }; }
      o.n.prefix = [...node.prefix, o.b, ...o.n.prefix]; this.fresh.add(o.n.id);
      this.ev.push({ t: 'shrink', id: o.n.id, text: `Node4 with 1 child: MERGE into child, prefix becomes ${this.pfx(o.n.prefix)} (path compression restored)` }); return { node: o.n, found: true };
    }
    const nt = node.type === 256 && cnt <= 37 ? 48 : node.type === 48 && cnt <= 12 ? 16 : node.type === 16 && cnt <= 3 ? 4 : 0;
    if (nt) { this.ev.push({ t: 'shrink', id: node.id, text: `Node${node.type} down to ${cnt} children -> SHRINK to Node${nt} (hysteresis: thresholds lower than grow points)` }); node.type = nt; this.stats.shrinks++; this.fresh.add(node.id); }
    return { node, found: true };
  }
  count() { let a = { n4: 0, n16: 0, n48: 0, n256: 0, leaf: 0 }; const r = (n) => { if (!n) return; if (n.leaf) a.leaf++; else { a['n' + n.type]++; n.kids.forEach((c) => r(c.n)); } }; r(this.root); return a; }
}

let curSL = null, curART = null;
const mkCtl = (defs, get) => defs.map((d) => ({ ...d, onChange: (v, api) => { const c = get(); c && c[d.id] && c[d.id](v, api); } }));

const SL_DEFS = [
  { id: 'key', label: 'key', type: 'range', min: 1, max: 99, value: 22 },
  { id: 'insert', label: 'Insert key', type: 'button' }, { id: 'search', label: 'Search key', type: 'button' }, { id: 'delete', label: 'Delete key', type: 'button' },
  { id: 'lockfree', label: 'show lock-free (CAS) protocol', type: 'toggle', value: false },
  { id: 'random', label: 'Insert random', type: 'button' }, { id: 'reset', label: 'Reset', type: 'button' },
];
const WORDS = ['romane', 'romanus', 'romulus', 'rubens', 'ruber', 'rubicon', 'rubicundus', 'rome', 'ban', 'band', 'bandana', 'banana', 'xylem'];
const ART_DEFS = [
  { id: 'word', label: 'key', type: 'select', options: WORDS, value: 'rome' },
  { id: 'insert', label: 'Insert key', type: 'button' }, { id: 'lookup', label: 'Lookup key', type: 'button' }, { id: 'delete', label: 'Delete key', type: 'button' },
  { id: 'fan', label: 'Add child under x-node (+1)', type: 'button' }, { id: 'fan8', label: 'Add 8 children under x-node', type: 'button' },
  { id: 'unfan', label: 'Remove 8 from x-node (shrink)', type: 'button' }, { id: 'reset', label: 'Reset', type: 'button' },
];
const FAN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@';

export const views = {
  // ------------------------------------------------------------------- skiplist
  skiplist: {
    build(ctx) {
      const K = makeKit(ctx), L = makeLib(), g = K.group; const content = new THREE.Group(); g.add(content);
      const caption = K.dyn('', { size: 1.0, lines: 2, w: 1536, px: 34, color: C.text, bg: 'rgba(16,22,42,0.85)' }); caption.position.set(0, 5.6, 0.5); g.add(caption);
      const stat = K.dyn('', { size: 0.5, w: 1536, px: 36, color: C.dim }); stat.position.set(0, -4.9, 0.5); g.add(stat);
      let S = null, cubes = new Map(), keyVal = 22, lockfree = false, rnd = rng(3);
      const TITLE = 'Skip list: sorted linked list + probabilistic express lanes (RocksDB/LevelDB memtable, Redis ZSET)';
      const sx = (i) => i * 1.2, sy = (l) => l * 1.0 - 1.6;
      function render(fresh) {
        L.clear(content); cubes = new Map();
        const nodes = [S.head, ...S.list()]; const W = (nodes.length + 1) * 1.2;
        const xOf = new Map(nodes.map((n, i) => [n, sx(i)]));
        nodes.forEach((n, i) => {
          const x = sx(i), grp = new THREE.Group(); grp.position.set(x, 0, 0); content.add(grp);
          for (let l = 0; l < n.h; l++) { const c = L.mesh(grp, 0.8, 0.8, 0.5, n === S.head ? 0x394568 : l === 0 ? PAL.leafCell : PAL.innerCell, 0, sy(l), 0, 0.3); c.userData.base = c.material; cubes.set(`${i}:${l}`, c); }
          L.lab(grp, n === S.head ? 'HEAD' : n.key, n === S.head ? '#7f8bb3' : '#e6ebff', 0.6, 0, sy(0) - 0.95, 0.3);
          if (fresh && n === fresh) { grp.scale.set(0.01, 0.01, 0.01); K.tween(grp.scale, { x: 1, y: 1, z: 1 }, 0.5); }
          for (let l = 0; l < n.h; l++) { const nx = n.fw[l]; const x2 = nx ? xOf.get(nx) : sx(nodes.length); L.arrow(content, [x + 0.42, sy(l), 0.3], [x2 - 0.45, sy(l), 0.3], nx ? 0x7dcfff : 0x56607f, 0.05); }
        });
        L.mesh(content, 0.5, SL_MAX * 1.0 + 0.2, 0.3, 0x2a3250, sx(nodes.length), sy(0) + (SL_MAX - 1) / 2, 0, 0.2); L.lab(content, 'NIL', '#7f8bb3', 0.45, sx(nodes.length), sy(SL_MAX - 1) + 0.75, 0.3);
        for (let l = 0; l < SL_MAX; l++) L.lab(content, `L${l}`, '#7f8bb3', 0.45, -1.1, sy(l), 0);
        const s = Math.min(1.5, 19 / (W + 1.5)); content.scale.setScalar(s); content.position.set(-(W - 1.2) / 2 * s + 0.4, 0, 0);
        const ks = S.list(); stat.setText(`${S.n} keys   avg tower height ${ks.length ? (ks.reduce((a, n) => a + n.h, 0) / ks.length).toFixed(2) : '-'} (expected 2)   search = O(log n) expected, no rebalancing`);
        idx = new Map(nodes.map((n, i) => [n, i]));
      }
      let idx = new Map();
      function play(ev, info) {
        ev.forEach((e, i) => K.after(0.15 + i * 0.55, () => {
          caption.setText(wrap(e.text)); const c = cubes.get(`${idx.get(e.n)}:${e.l}`);
          if (c) c.material = L.mat(e.link ? PAL.ok : e.res === true ? PAL.ok : e.res === false ? PAL.bad : e.down ? 0xff9e64 : PAL.hi, 0.9);
        }));
        K.after(0.15 + ev.length * 0.55 + 1.5, () => { cubes.forEach((c) => { c.material = c.userData.base; }); caption.setText(wrap(TITLE)); });
        K.info(info);
      }
      function reset() { K.clearAnim(); S = new SkipList(); for (const k of [3, 7, 12, 19, 26, 31, 42]) S.insert(k); S.ev = []; render(null); caption.setText(wrap(TITLE)); K.info(intro); }
      const intro = '<b>Skip list</b>: level 0 is a plain sorted linked list; each node is promoted to the next level with probability 1/2, giving express lanes. Search starts at the top-left, moves right while next &lt; key, else drops a level. Insert = search + splice at each level of the new tower. No rebalancing or rotations, which is why concurrent variants are simple.';
      const doIns = (k) => { K.clearAnim(); S.insert(k, lockfree); render(S.fresh); play(S.ev, `<b>insert(${k})</b>: search path records the predecessor at every level (<i>update[]</i>), then the tower height is drawn by coin flips and spliced in.` + (lockfree ? ' <b>Lock-free:</b> link level 0 with a CAS first (linearization point), then upper levels bottom-up; failed CAS = re-run search from the pred and retry.' : '')); };
      const doSearch = (k) => { K.clearAnim(); S.search(k); render(null); play(S.ev, `<b>search(${k})</b>: ~log2(n) steps expected: orange = drop down, yellow = move right.`); };
      const doDel = (k) => { K.clearAnim(); S.remove(k, lockfree); render(null); play(S.ev, `<b>delete(${k})</b>: unlink the tower at each level it appears.` + (lockfree ? ' Lock-free: first MARK the pointers (logical delete), then unlink with CAS; helpers physically remove marked nodes they encounter.' : '')); };
      const ops = {
        key(v) { keyVal = +v; }, insert() { doIns(keyVal); }, search() { doSearch(keyVal); }, delete() { doDel(keyVal); },
        lockfree(v) { lockfree = !!v; }, random() { doIns(1 + Math.floor(rnd() * 99)); }, reset() { reset(); },
      };
      curSL = ops;
      reset();
      return {
        group: g, update(dt) { K.tick(dt); }, dispose() { L.clear(content); L.dispose(); K.dispose(); if (curSL === ops) curSL = null; },
        onConfigChange() {},
        steps: [
          { title: 'Search with express lanes', text: 'Start at HEAD on the top level; go right while next < key, otherwise drop one level.', run() { doSearch(31); } },
          { title: 'Insert: pick a height', text: 'Coin flips decide the tower height; the search path supplies the predecessors to splice after.', run() { doIns(22); } },
          { title: 'Insert another', text: 'Heights are independent of key order, so sorted inserts do not degrade it.', run() { doIns(28); } },
          { title: 'Lock-free insert (CAS)', text: 'Level 0 CAS is the linearization point; higher levels are only hints and may lag.', run() { lockfree = true; doIns(35); } },
          { title: 'Delete', text: 'Unlink the tower at every level (lock-free: mark, then unlink).', run() { doDel(19); } },
        ],
      };
    },
    controls: mkCtl(SL_DEFS, () => curSL),
  },

  // ------------------------------------------------------------------- adaptive-radix-tree
  'adaptive-radix-tree': {
    build(ctx) {
      const K = makeKit(ctx), L = makeLib(), g = K.group; const content = new THREE.Group(); g.add(content);
      const caption = K.dyn('', { size: 1.0, lines: 2, w: 1536, px: 34, color: C.text, bg: 'rgba(16,22,42,0.85)' }); caption.position.set(0, 6.0, 0.5); g.add(caption);
      const stat = K.dyn('', { size: 0.5, w: 1536, px: 36, color: C.dim }); stat.position.set(0, -6.4, 0.5); g.add(stat);
      const TITLE = 'Adaptive Radix Tree: 1 byte per level, node size adapts to fan-out (HyPer, DuckDB indexes)';
      let T = null, refs = new Map(), word = 'rome', fanN = 0;
      const gap = 0.35, DYGAP = 1.5;
      const dims = (n) => n.leaf ? { w: n.tiny ? 0.3 : Math.max(1.5, 0.27 * n.s.length + 0.8), h: n.tiny ? 0.4 : 0.8 } : n.type === 4 ? { w: 3.2, h: 1.9 } : n.type === 16 ? { w: 4.6, h: 2.5 } : n.type === 48 ? { w: 4.7, h: 3.7 } : { w: 3.6, h: 3.7 };
      function lay(n, tiny) {
        if (n.leaf) { n.tiny = tiny; const d = dims(n); n._w = d.w; n._h = d.h; return; }
        const t = n.kids.length > 8; n.kids.forEach((c) => lay(c.n, t)); const d = dims(n); n._h = d.h;
        n._block = t && n.kids.every((c) => c.n.leaf);
        if (n._block) { const cols = Math.min(n.kids.length, 12); n._span = cols * 0.34; n._brows = Math.ceil(n.kids.length / 12); }
        else n._span = n.kids.reduce((a, c) => a + c.n._w, 0) + gap * (n.kids.length - 1);
        n._w = Math.max(d.w, n._span);
      }
      function place(n, left, dep, rows) {
        n._x = left + n._w / 2; n._d = dep; rows[dep] = Math.max(rows[dep] || 0, n._h);
        if (n.leaf) return;
        if (n._block) { const x0 = left + (n._w - n._span) / 2; n.kids.forEach((c, i) => { c.n._x = x0 + (i % 12) * 0.34 + 0.17; c.n._d = dep + 1; c.n._yoff = Math.floor(i / 12) * 0.46; }); rows[dep + 1] = Math.max(rows[dep + 1] || 0, n._brows * 0.46); return; }
        let cx = left + (n._w - n._span) / 2; n.kids.forEach((c) => { place(c.n, cx, dep + 1, rows); cx += c.n._w + gap; });
      }
      function drawInner(n, grp) {
        const d = dims(n), cnt = n.kids.length; const ph = n.fresh ? 0 : 0;
        const plate = L.mesh(grp, d.w, d.h, 0.3, n.type === 4 ? 0x3b2a63 : n.type === 16 ? 0x2c4a7a : n.type === 48 ? 0x2c6b57 : 0x7a4a2c, 0, 0, 0, 0.25); plate.userData.base = plate.material;
        L.lab(grp, `Node${n.type}  ${cnt}/${n.type}  pfx ${n.prefix.length ? '"' + n.prefix.map(chr).join('') + '"' : '-'}`, '#ffffff', 0.4, 0, d.h / 2 - 0.33, 0.2, true);
        const r = { plate, cells: new Map(), n };
        if (n.type === 4 || n.type === 16) {
          const per = n.type === 4 ? 4 : 8, cwid = n.type === 4 ? 0.7 : 0.52; const rows = n.type === 4 ? 1 : 2;
          for (let i = 0; i < n.type; i++) {
            const row = Math.floor(i / per), col = i % per; const x = (col - (per - 1) / 2) * cwid, y = (n.type === 4 ? -0.15 : 0.15) - row * 0.9;
            const f = i < cnt; const cm = L.mesh(grp, cwid - 0.08, 0.6, 0.12, f ? PAL.innerCell : PAL.empty, x, y, 0.2, 0.3); cm.userData.base = cm.material;
            if (f) { L.lab(grp, chr(n.kids[i].b), '#0b1020', 0.45, x, y, 0.3); r.cells.set(n.kids[i].b, cm); }
            L.mesh(grp, cwid - 0.14, 0.14, 0.1, f ? PAL.ok : PAL.empty, x, y - 0.42, 0.2, 0.3);
          }
          L.lab(grp, n.type === 4 ? 'keys[4] + ptrs[4]' : 'keys[16] SIMD + ptrs[16]', '#9aa5ce', 0.3, 0, -d.h / 2 + 0.2, 0.2, true);
        } else {
          const cs = 0.17, x0 = (n.type === 48 ? -1.55 : 0) - 7.5 * cs, y0 = 0.9; const im = L.inst(grp, 256, 0xffffff); const dm = new THREE.Object3D(); const col = new THREE.Color();
          const used = new Set(n.kids.map((k) => k.b));
          for (let b = 0; b < 256; b++) { dm.position.set(x0 + (b & 15) * cs, y0 - (b >> 4) * cs, 0.2); dm.scale.set(cs * 0.85, cs * 0.85, 0.1); dm.updateMatrix(); im.setMatrixAt(b, dm.matrix); im.setColorAt(b, col.setHex(used.has(b) ? 0xbb9af7 : 0x151b30)); }
          im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; r.inst = im; r.cellsB = used; r.dm = { x0, y0, cs };
          L.lab(grp, n.type === 48 ? 'child_index[256] (1 byte each)' : 'children[256] direct by byte', '#9aa5ce', 0.3, n.type === 48 ? -1.55 : 0, -d.h / 2 + 0.22, 0.2, true);
          if (n.type === 48) { const sl = L.inst(grp, 48, 0xffffff); for (let i = 0; i < 48; i++) { dm.position.set(1.3 + (i % 6) * 0.3 - 0.0, 0.9 - Math.floor(i / 6) * 0.3, 0.2); dm.scale.set(0.24, 0.24, 0.1); dm.updateMatrix(); sl.setMatrixAt(i, dm.matrix); sl.setColorAt(i, col.setHex(i < cnt ? 0x9ece6a : 0x151b30)); } sl.instanceMatrix.needsUpdate = true; sl.instanceColor.needsUpdate = true; L.lab(grp, 'ptr slots[48]', '#9aa5ce', 0.3, 2.05, -d.h / 2 + 0.22, 0.2, true); }
        }
        return r;
      }
      function render(anim) {
        L.clear(content); refs = new Map(); stat.setText('');
        if (!T.root) { L.lab(content, '(empty tree)', '#7f8bb3', 0.7, 0, 0, 0); return; }
        lay(T.root, false); const rows = []; place(T.root, 0, 0, rows);
        const ys = []; let acc = 0; rows.forEach((h, i) => { ys[i] = -(acc + h / 2); acc += h + DYGAP; }); const totalH = acc - DYGAP;
        const W = T.root._w, X = (x) => x - W / 2, Y = (y) => y + totalH / 2;
        (function walk(n) {
          const yc = (m) => (m._yoff != null ? Y(ys[m._d] + rows[m._d] / 2 - 0.2 - m._yoff) : Y(ys[m._d])); const x = X(n._x), y = yc(n); const grp = new THREE.Group(); grp.position.set(x, y, 0); content.add(grp);
          if (n.leaf) {
            if (n.tiny) L.mesh(grp, 0.26, 0.4, 0.2, 0x3d7d2a, 0, 0, 0, 0.3);
            else { const p = L.mesh(grp, n._w, 0.8, 0.3, 0x2f6f3a, 0, 0, 0, 0.3); p.userData.base = p.material; L.lab(grp, n.s, '#ffffff', 0.5, 0, 0.1, 0.25); L.lab(grp, 'leaf: full key + value', '#c8e6c0', 0.24, 0, -0.28, 0.25, true); refs.set(n.id, { plate: p, cells: new Map(), n }); }
          } else {
            refs.set(n.id, drawInner(n, grp));
            n.kids.forEach((c) => {
              const cx = X(c.n._x), cy = yc(c.n); const top = c.n.leaf ? cy + (c.n.tiny ? 0.2 : 0.4) : cy + c.n._h / 2;
              L.seg(content, [x, y - n._h / 2, -0.1], [cx, top, -0.1], 0x7f8bb3, 0.04, 0.4);
              if (!c.n.tiny) L.lab(content, `${chr(c.b)} ${hx(c.b)}`, '#ffd68a', 0.4, x + (cx - x) * 0.7, (y - n._h / 2) + (top - (y - n._h / 2)) * 0.7 + 0.2, 0.1);
            });
            n.kids.forEach((c) => walk(c.n));
          }
          if (anim && T.fresh.has(n.id)) { grp.scale.set(0.01, 0.01, 0.01); K.tween(grp.scale, { x: 1, y: 1, z: 1 }, 0.55); }
        })(T.root);
        const s = Math.min(1.5, 19 / W, 11.5 / totalH); content.scale.setScalar(s); content.position.set(0, -0.2, 0);
        const c = T.count(); stat.setText(`Node4 x${c.n4}   Node16 x${c.n16}   Node48 x${c.n48}   Node256 x${c.n256}   leaves ${c.leaf}   grows ${T.stats.grows}   shrinks ${T.stats.shrinks}`);
      }
      function paint(id, b, color) {
        const r = refs.get(id); if (!r) return;
        if (b != null && r.cells.has(b)) r.cells.get(b).material = L.mat(color, 0.9);
        else if (b != null && r.inst) { const i = b; const c = new THREE.Color(color); r.inst.setColorAt(i, c); r.inst.instanceColor.needsUpdate = true; }
        else r.plate.material = L.mat(color, 0.8);
      }
      function play(ev, info) {
        K.clearAnim(); const t0 = 0.7;
        ev.forEach((e, i) => K.after(t0 + i * 0.7, () => { caption.setText(wrap(e.text)); if (e.id != null) paint(e.id, e.b, e.t === 'miss' || e.t === 'del' ? PAL.bad : e.t === 'visit' ? PAL.hi : PAL.ok); }));
        K.after(t0 + ev.length * 0.7 + 1.6, () => { render(false); caption.setText(wrap(TITLE)); });
        K.info(info);
      }
      const seed = () => { for (const w of ['romane', 'romanus', 'romulus', 'rubens', 'ruber', 'rubicon']) T.insert(w); T.ev = []; T.fresh = new Set(); T.stats = { grows: 0, shrinks: 0 }; };
      function reset() { T = new ART(); fanN = 0; seed(); render(false); caption.setText(wrap(TITLE)); K.info(intro); }
      const intro = '<b>ART</b>: a radix tree that spends one <i>byte</i> per level (fan-out 256) but picks the node layout by population: Node4 / Node16 (sorted keys, SIMD search) / Node48 (256-byte index to 48 pointers) / Node256 (direct array). <b>Path compression</b> stores shared prefix bytes in the node; <b>lazy expansion</b> stores a lone key as a leaf without building the chain of nodes for its tail. Ordered iteration works (unlike a hash).';
      const doIns = (w) => { T.insert(w); render(true); play(T.ev, `<b>insert("${w}")</b>: bytes ${[...w].map((c) => c.charCodeAt(0).toString(16)).join(' ')} 00 (terminator makes keys prefix-free).`); };
      const doLook = (w) => { const r = T.lookup(w); render(false); play(T.ev, `<b>lookup("${w}")</b> -> ${r ? 'found' : 'miss'}. Depth is bounded by key length, not by number of keys; no comparisons of whole keys until the leaf.`); };
      const doDel = (w) => { T.remove(w); render(true); play(T.ev, `<b>delete("${w}")</b>: remove the leaf, then shrink the node if it fell under the lower threshold, or merge a 1-child Node4 into its child.`); };
      const fanKey = (i) => 'x' + FAN[i % FAN.length];
      const ops = {
        word(v) { word = v; }, insert() { doIns(word); }, lookup() { doLook(word); }, delete() { doDel(word); },
        fan() { if (fanN >= 64) return; doIns(fanKey(fanN++)); },
        fan8() { for (let i = 0; i < 7 && fanN < 63; i++) T.insert(fanKey(fanN++)); ops.fan(); },
        unfan() { for (let i = 0; i < 7 && fanN > 1; i++) T.remove(fanKey(--fanN)); if (fanN > 0) doDel(fanKey(--fanN)); else K.info('nothing to remove'); },
        reset() { reset(); },
      };
      curART = ops; reset();
      return {
        group: g, update(dt) { K.tick(dt); }, dispose() { L.clear(content); L.dispose(); K.dispose(); if (curART === ops) curART = null; },
        onConfigChange() {},
        steps: [
          { title: 'Lookup by byte', text: 'Each node consumes its compressed prefix, then indexes the next key byte.', run() { doLook('ruber'); } },
          { title: 'Prefix split on insert', text: '"rome" diverges inside a compressed prefix: a new Node4 takes the shared part.', run() { doIns('rome'); } },
          { title: 'Lazy expansion', text: 'A lone key hangs off a node as a leaf; inserting a sibling expands it on demand.', run() { doIns('banana'); K.after(0.01, () => {}); doIns('band'); } },
          { title: 'Node4 -> Node16', text: 'The 5th child under one byte overflows Node4 and upgrades it in place.', run() { for (let i = 0; i < 4; i++) T.insert(fanKey(fanN++)); ops.fan(); } },
          { title: 'Node16 -> 48 -> 256', text: 'Keep adding children: Node48 holds a 256-entry byte index, Node256 is a direct array.', run() { for (let i = 0; i < 40; i++) T.insert(fanKey(fanN++)); ops.fan(); } },
          { title: 'Shrink on delete', text: 'Deleting children shrinks the node again, at lower thresholds than growth to avoid thrashing.', run() { ops.unfan(); ops.unfan(); } },
        ],
      };
    },
    controls: mkCtl(ART_DEFS, () => curART),
  },
};
