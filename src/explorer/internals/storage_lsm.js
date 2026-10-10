// LSM-tree internals view (internals-C). Real algorithm state: WAL, skiplist-ordered memtable, immutable memtable,
// SSTables with per-table bloom filters, leveled vs size-tiered compaction, tombstone dropping, amplification counters.
import * as THREE from 'three';
import { makeKit, setColor, C, rng } from './storage_kit.js';

const NKEYS = 24, MEM_CAP = 4, FILE_CAP = 4, SLOTS = 7, NLEV = 3;
const kk = (n) => String(n).padStart(2, '0');
const hash1 = (k) => (Math.imul(k, 0x9e3779b1) >>> 0);
const hash2 = (k) => (Math.imul(k ^ 0x5bd1, 0x85ebca6b) >>> 0);
const towerH = (k) => { let x = hash1(k) >>> 7, l = 1; while (x & 1 && l < 4) { l++; x >>= 1; } return l; };

function bloomOf(entries) {
  const m = Math.min(32, Math.max(24, entries.length * 6));
  const bits = new Uint8Array(m);
  for (const e of entries) { bits[hash1(e.k) % m] = 1; bits[hash2(e.k) % m] = 1; }
  return bits;
}
const bloomHas = (bits, k) => bits[hash1(k) % bits.length] && bits[hash2(k) % bits.length];

const LEVEL_COL = [0x4b3f6b, 0x2b4b6b, 0x2b5f55];

export const views = {
  'lsm-tree': {
    build(ctx) {
      const K = makeKit(ctx);
      const group = K.group;
      const rand = rng(11);
      // ---------------- state ----------------
      let S;
      let mode = 'leveled', bloomOn = true;
      const queue = []; let timer = 0;
      const hl = new Map(); // key -> {color, until}
      const flashKey = (key, color, dur = 0.9) => hl.set(key, { color, until: K.now() + dur });
      const reset = () => {
        S = { seq: 0, lsn: 0, tid: 0, wal: [], walLive: 0, mem: new Map(), imm: null, levels: [[], [], []], truth: new Map(), ver: {},
          userOps: 0, walW: 0, flushW: 0, compR: 0, compW: 0, gets: 0, blocks: 0, bloomProbes: 0, bloomNeg: 0, fp: 0, tombDropped: 0, last: '' };
        queue.length = 0; timer = 0; hl.clear();
      };
      reset();
      const mkTable = (entries, lvl) => ({ id: ++S.tid, lvl, entries, bloom: bloomOf(entries), min: entries[0].k, max: entries[entries.length - 1].k, maxSeq: Math.max(...entries.map((e) => e.seq)) });
      const allTables = () => S.levels.flat();
      const say = (h) => { S.last = h; K.info(h); };

      // ---------------- scene ----------------
      const panel = (w, h, x, y, col = C.panel) => K.box(w, h, 0.2, col, x, y, -0.15);
      K.label('LSM-tree: log-structured merge', 0, 5.95, 0, { size: 0.55, color: '#7aa2f7', w: 700, px: 40 });
      const banner = K.label('', 0, 5.35, 0, { size: 0.36, color: '#e0af68', w: 900, px: 34 });
      const clientLbl = K.label('client put/get/delete', -8.6, 5.05, 0, { size: 0.4, color: '#c0caf5', w: 480, px: 36 });
      // WAL
      panel(3.5, 2.5, -8.6, 3.1, 0x2a1f2e); K.label('WAL (append-only, fsync)', -8.6, 4.55, 0.1, { size: 0.36, color: '#f7768e', w: 560, px: 36 });
      const walTxt = K.dyn('', { size: 1.7, w: 440, px: 30, lines: 6, align: 'left', color: '#f7768e' }); walTxt.position.set(-8.6, 3.0, 0.1); group.add(walTxt);
      // memtable + immutable
      const mkMemRow = (cx, title, col) => {
        panel(5.9, 2.5, cx, 3.1, 0x18213a); K.label(title, cx, 4.55, 0.1, { size: 0.36, color: col, w: 620, px: 36 });
        const cells = [];
        for (let i = 0; i < MEM_CAP; i++) {
          const x = cx + (i - 1.5) * 1.4;
          const box = K.box(1.25, 0.9, 0.3, 0x2a3358, x, 3.0, 0);
          const tw = K.box(0.12, 1, 0.12, C.purple, x, 3.5, 0); tw.visible = false;
          const t = K.dyn('', { size: 0.36, w: 230, px: 34, color: '#e6ebff' }); t.position.set(x, 3.0, 0.2); group.add(t);
          cells.push({ box, tw, t, x, cache: null });
        }
        return cells;
      };
      const memCells = mkMemRow(-3.1, 'memtable (skiplist, sorted)', '#bb9af7');
      const immCells = mkMemRow(3.2, 'immutable memtable (flushing)', '#9a8cc0');
      K.label('towers = skiplist level of each node', -3.1, 1.98, 0.1, { size: 0.26, color: '#7f8bb3', w: 640, px: 28 });
      // counters
      panel(3.6, 2.9, 8.5, 3.0, 0x1c2640);
      const cnt = K.dyn('', { size: 2.5, w: 430, px: 28, lines: 8, align: 'left', color: '#c0caf5' }); cnt.position.set(8.5, 3.0, 0.1); group.add(cnt);
      // arrows
      K.arrow([-10.0, 5.05, 0], [-10.0, 4.45, 0], C.red); // put -> WAL
      // levels
      const levelLbl = [];
      const rowY = [0.55, -1.75, -4.05];
      for (let l = 0; l < NLEV; l++) {
        K.box(20.8, 1.9, 0.1, 0x10172c, 0, rowY[l], -0.3);
        levelLbl.push(K.dyn('', { size: 0.8, w: 300, px: 32, lines: 2, color: '#2ac3de', align: 'center' }));
        levelLbl[l].position.set(-9.95, rowY[l], 0.1); group.add(levelLbl[l]);
      }
      K.arrow([3.2, 1.8, 0], [3.2, 1.55, 0], C.cyan);
      const slots = [];
      const bgeo = K.track(new THREE.BoxGeometry(1, 1, 1));
      const bmat = K.track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
      for (let l = 0; l < NLEV; l++) for (let s = 0; s < SLOTS; s++) {
        const x = -7.2 + s * 2.4, y = rowY[l];
        const box = K.box(2.25, 1.55, 0.3, LEVEL_COL[l], x, y, 0);
        const txt = K.dyn('', { size: 0.62, w: 380, px: 34, lines: 2, color: '#e6ebff' }); txt.position.set(x, y + 0.2, 0.2); group.add(txt);
        const im = new THREE.InstancedMesh(bgeo, bmat, 32); im.position.set(x, y - 0.55, 0.2); group.add(im);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < 32; i++) im.setColorAt(i, new THREE.Color(0x2a3050));
        box.visible = txt.visible = im.visible = false;
        slots.push({ l, s, box, txt, im, tid: null, cache: '', bloomCache: '' });
      }
      K.label('bloom filter bits per SSTable (green = 1); key range + bloom checked before reading a data block', 0, -5.35, 0, { size: 0.28, color: '#7f8bb3', w: 1100, px: 28 });
      const result = K.label('', 0, -5.95, 0, { size: 0.42, color: '#9ece6a', w: 1200, px: 36 });
      const packet = K.sphere(0.2, C.yellow, -8.6, 5.05, 0.3, { emissive: C.yellow, ei: 0.8 }); packet.visible = false;

      // ---------------- rendering from real state ----------------
      const dummy = new THREE.Object3D(); const tmpC = new THREE.Color();
      const hlCol = (key, base) => { const h = hl.get(key); if (h && h.until > K.now()) return h.color; return base; };
      const entryTxt = (e) => e.t ? `${kk(e.k)}†` : `${kk(e.k)}=${e.v}`;
      function render() {
        // memtable cells (sorted by key = skiplist bottom level order)
        const fillCells = (cells, map, keyPrefix) => {
          const arr = map ? [...map.values()].sort((a, b) => a.k - b.k) : [];
          cells.forEach((c, i) => {
            const e = arr[i];
            const txt = e ? entryTxt(e) : '';
            if (c.cache !== txt) { c.t.setText(txt || '·'); c.cache = txt; }
            c.tw.visible = !!e; if (e) { const h = towerH(e.k) * 0.22 + 0.1; c.tw.scale.y = h; c.tw.position.y = 3.45 + h / 2; }
            setColor(c.box, e ? hlCol(keyPrefix + e.k, e.t ? 0x5a2a3a : 0x3a4a80) : 0x222a48);
          });
        };
        fillCells(memCells, S.mem, 'm'); fillCells(immCells, S.imm ? new Map(S.imm.map((e) => [e.k, e])) : null, 'i');
        walTxt.setText(['LSN  record', ...S.wal.slice(Math.max(S.walLive, S.wal.length - 5)).map((r) => r)].join('\n') || 'empty', '#f7768e');
        // slots
        const tiered = mode === 'tiered';
        for (let l = 0; l < NLEV; l++) {
          const lt = tiered ? ['tier 0 (flushes)', 'tier 1', 'tier 2 (bottom)'][l] : ['L0 (flushed)', 'L1 (cap 2)', 'L2 (bottom)'][l];
          const lt2 = `${lt}`; if (levelLbl[l].userData.cache !== lt2) { levelLbl[l].setText(lt.replace(' (', '\n(')); levelLbl[l].userData.cache = lt2; }
          let tabs = S.levels[l].slice();
          if (!tiered && l > 0) tabs.sort((a, b) => a.min - b.min); else tabs.sort((a, b) => a.id - b.id);
          for (let s = 0; s < SLOTS; s++) {
            const sl = slots[l * SLOTS + s], t = tabs[s];
            const vis = !!t; sl.box.visible = sl.txt.visible = sl.im.visible = vis;
            if (!vis) { sl.tid = null; sl.cache = ''; sl.bloomCache = ''; continue; }
            sl.tid = t.id;
            const ntomb = t.entries.filter((e) => e.t).length;
            const ks = t.entries.length <= 5 ? t.entries.map((e) => kk(e.k) + (e.t ? '†' : '')).join(' ') : t.entries.slice(0, 4).map((e) => kk(e.k) + (e.t ? '†' : '')).join(' ') + ' …';
            const txt = `#${t.id} n=${t.entries.length}${ntomb ? ' †' + ntomb : ''}\n${ks}`;
            if (sl.cache !== txt) { sl.txt.setText(txt); sl.cache = txt; }
            setColor(sl.box, hlCol('t' + t.id, LEVEL_COL[l]));
            const bk = t.id + ':' + t.bloom.length;
            if (sl.bloomCache !== bk) {
              sl.bloomCache = bk; const m = t.bloom.length, cw = 2.0 / m;
              for (let i = 0; i < 32; i++) {
                if (i < m) { dummy.position.set((i - (m - 1) / 2) * cw, 0, 0); dummy.scale.set(cw * 0.8, 0.16, 0.05); tmpC.setHex(t.bloom[i] ? 0x9ece6a : 0x2a3050); }
                else { dummy.position.set(0, 0, 0); dummy.scale.set(0, 0, 0); }
                dummy.updateMatrix(); sl.im.setMatrixAt(i, dummy.matrix); sl.im.setColorAt(i, tmpC);
              }
              sl.im.instanceMatrix.needsUpdate = true; sl.im.instanceColor.needsUpdate = true;
            }
          }
        }
        // counters
        const totalEntries = allTables().reduce((a, t) => a + t.entries.length, 0);
        const live = S.truth.size;
        const wamp = S.userOps ? ((S.walW + S.flushW + S.compW) / S.userOps) : 0;
        const ramp = S.gets ? (S.blocks / S.gets) : 0;
        const samp = live ? (totalEntries + S.mem.size + (S.imm ? S.imm.length : 0)) / live : 0;
        cnt.setText([
          'amplification counters', `user writes   ${S.userOps}`, `wr W+F+C ${S.walW}+${S.flushW}+${S.compW}`,
          `write amp  ${wamp.toFixed(2)}x`, `read amp   ${ramp.toFixed(2)} blk/get`, `space amp  ${samp ? samp.toFixed(2) + 'x' : '-'}`,
          `bloom skips ${S.bloomNeg}/${S.bloomProbes} FP ${S.fp}`, `tombstones dropped ${S.tombDropped}`,
        ].join('\n'));
        const ik = ctx.config && ctx.config['index-structure'];
        const bt = ik && ik !== 'lsm' ? `index-structure = ${ik}: showing the LSM alternative for comparison` : `index-structure = lsm | compaction: ${tiered ? 'size-tiered (STCS)' : 'leveled (LCS)'} | bloom ${bloomOn ? 'on' : 'off'}`;
        if (banner.userData.cache !== bt) { banner.setText(bt); banner.userData.cache = bt; }
      }

      // ---------------- engine (each step is queued so the animation shows the order) ----------------
      const enq = (d, fn, front) => { const it = { d, fn }; front ? queue.unshift(it) : queue.push(it); };
      const enqFront = (items) => { for (let i = items.length - 1; i >= 0; i--) queue.unshift(items[i]); };
      const sortedMem = (m) => [...m.values()].sort((a, b) => a.k - b.k);

      function canDrop(outLvl, min, max, exclude) {
        for (let l = outLvl; l < NLEV; l++) for (const t of S.levels[l]) if (!exclude.includes(t) && t.min <= max && t.max >= min) return false;
        return true;
      }
      function mergeStep(inputs, outLvl) {
        for (let l = 0; l < NLEV; l++) S.levels[l] = S.levels[l].filter((t) => !inputs.includes(t));
        const best = new Map(); let nin = 0;
        for (const t of inputs) for (const e of t.entries) { nin++; const o = best.get(e.k); if (!o || e.seq > o.seq) best.set(e.k, e); }
        let out = [...best.values()].sort((a, b) => a.k - b.k);
        const lo = Math.min(...inputs.map((t) => t.min)), hi = Math.max(...inputs.map((t) => t.max));
        const drop = outLvl === NLEV - 1 || canDrop(outLvl, lo, hi, inputs);
        let dropped = 0;
        if (drop) { const before = out.length; out = out.filter((e) => !e.t); dropped = before - out.length; }
        S.tombDropped += dropped; S.compR += nin; S.compW += out.length;
        const tabs = [];
        if (mode === 'tiered') { if (out.length) tabs.push(mkTable(out, outLvl)); }
        else for (let i = 0; i < out.length; i += FILE_CAP) tabs.push(mkTable(out.slice(i, i + FILE_CAP), outLvl));
        S.levels[outLvl].push(...tabs);
        tabs.forEach((t) => flashKey('t' + t.id, C.green, 1.2));
        say(`<b>Compaction</b>: merged ${inputs.length} SSTable(s) (${nin} entries) into ${tabs.length} table(s) at ${mode === 'tiered' ? 'tier' : 'L'}${outLvl} (${out.length} entries). Newest version of each key wins (highest seq). ` +
          (dropped ? `<b>${dropped} tombstone(s) dropped</b> because nothing deeper can hold older versions of those keys.` : (out.some((e) => e.t) ? 'Tombstones are <b>kept</b>: older versions may still live in deeper levels.' : '')));
      }
      function planCompaction() {
        if (mode === 'leveled') {
          if (S.levels[0].length >= 3) {
            const l0 = S.levels[0]; const lo = Math.min(...l0.map((t) => t.min)), hi = Math.max(...l0.map((t) => t.max));
            const inputs = [...l0, ...S.levels[1].filter((t) => t.min <= hi && t.max >= lo)];
            return { inputs, out: 1 };
          }
          if (S.levels[1].length > 2) {
            const f = S.levels[1].slice().sort((a, b) => a.min - b.min)[0];
            return { inputs: [f, ...S.levels[2].filter((t) => t.min <= f.max && t.max >= f.min)], out: 2 };
          }
        } else {
          for (let l = 0; l < NLEV - 1; l++) if (S.levels[l].length >= 3) {
            const inputs = [...S.levels[l]]; if (l + 1 === NLEV - 1) inputs.push(...S.levels[l + 1]);
            return { inputs, out: l + 1 };
          }
        }
        return null;
      }
      function compactSteps() {
        return [{ d: 0.1, fn: () => {
          const p = planCompaction(); if (!p) return;
          p.inputs.forEach((t) => flashKey('t' + t.id, C.yellow, 1.3));
          say(`<b>Compaction picked</b>: ${mode === 'leveled' ? (p.out === 1 ? 'L0 has reached 3 files (overlapping key ranges, so every L0 read must probe them all); merge all of L0 with the overlapping L1 files' : 'L1 over its 2-file budget; push one file down with its overlapping L2 files') : 'a tier has 3 similar-sized SSTables; merge them into one bigger table in the next tier'}.`);
          enqFront([{ d: 0.9, fn: () => { mergeStep(p.inputs, p.out); enqFront(compactSteps()); } }]);
        } }];
      }
      function flushSteps() {
        return [{ d: 0.8, fn: () => {
          if (!S.imm) return;
          const t = mkTable(S.imm, 0); S.levels[0].push(t); S.flushW += S.imm.length; S.imm = null;
          S.walLive = S.wal.length; flashKey('t' + t.id, C.green, 1.2);
          say(`<b>Flush</b>: immutable memtable written sequentially as SSTable #${t.id} in L0 (sorted keys + bloom filter + index). Its WAL segment is now obsolete and can be deleted.`);
          enqFront(compactSteps());
        } }];
      }
      function freezeStep() {
        if (S.imm) { // write stall: flush must finish first
          const t = mkTable(S.imm, 0); S.levels[0].push(t); S.flushW += S.imm.length; S.imm = null; say('<b>Write stall</b>: previous immutable memtable was still flushing.');
        }
        S.imm = sortedMem(S.mem); S.mem = new Map();
        say('<b>Memtable full</b> (4 keys): it becomes read-only (immutable) and a fresh memtable + WAL segment takes new writes; a background thread flushes the immutable one.');
        enqFront(flushSteps());
      }
      function putOp(k, tomb) {
        const v = tomb ? 0 : (S.ver[k] = (S.ver[k] || 0) + 1);
        enq(0.55, () => {
          packet.visible = true; packet.position.set(-8.6, 5.05, 0.3); K.move(packet, -8.6, 3.0, 0.3, 0.5, () => { K.move(packet, -3.1, 3.0, 0.3, 0.5, () => { packet.visible = false; }); });
          S.lsn++; S.userOps++; S.walW++;
          S.wal.push(`${String(S.lsn).padStart(3)}  ${tomb ? 'DEL' : 'PUT'} ${kk(k)}${tomb ? '' : '=' + v}`);
          say(`<b>${tomb ? 'delete' : 'put'} ${kk(k)}</b>: 1) append ${tomb ? 'a tombstone record' : 'record'} to the WAL (sequential write, fsync) for durability.`);
        });
        enq(0.6, () => {
          const e = { k, v, t: tomb, seq: ++S.seq }; S.mem.set(k, e); flashKey('m' + k, C.green, 1);
          if (tomb) S.truth.delete(k); else S.truth.set(k, v);
          say(`<b>${tomb ? 'delete' : 'put'} ${kk(k)}</b>: 2) insert into the memtable skiplist (O(log n), in memory, keeps keys sorted)${tomb ? ' as a <b>tombstone</b>: deletes never remove data in place' : ''}. Memtable: ${S.mem.size}/${MEM_CAP}.`);
          if (S.mem.size >= MEM_CAP) enqFront([{ d: 0.7, fn: freezeStep }]);
        });
      }
      function getOp(k) {
        enq(0.3, () => {
          S.gets++; let blocks = 0, checked = 0;
          const sources = [];
          const finish = (msg, color = '#9ece6a') => { S.blocks += blocks; result.setText(msg, color); say(`<b>get ${kk(k)}</b>: ${msg} (${checked} SSTable(s) consulted, ${blocks} data-block read(s))`); };
          const tabs = [];
          for (let l = 0; l < NLEV; l++) tabs.push(...S.levels[l].slice().sort((a, b) => b.maxSeq - a.maxSeq));
          const step = (i) => {
            if (i === -2) { // memtable
              const e = S.mem.get(k); flashKey('m' + k, e ? C.green : C.grey, 0.9);
              if (e) return finish(e.t ? `${kk(k)} -> deleted (tombstone in memtable)` : `${kk(k)} = ${e.v}  (memtable hit, no disk I/O)`);
              return enq(0.45, () => step(-1), true);
            }
            if (i === -1) {
              if (S.imm) { const e = S.imm.find((x) => x.k === k); S.imm.forEach((x) => flashKey('i' + x.k, x.k === k ? C.green : C.grey, 0.7)); if (e) return finish(e.t ? `${kk(k)} -> deleted (tombstone in immutable memtable)` : `${kk(k)} = ${e.v}  (immutable memtable hit)`); }
              return enq(0.45, () => step(0), true);
            }
            if (i >= tabs.length) return finish(`${kk(k)} -> not found`, '#e0af68');
            const t = tabs[i];
            if (k < t.min || k > t.max) return step(i + 1); // key range check from footer: free
            checked++;
            if (bloomOn) {
              S.bloomProbes++;
              if (!bloomHas(t.bloom, k)) { S.bloomNeg++; flashKey('t' + t.id, C.grey, 0.8); say(`<b>get ${kk(k)}</b>: bloom filter of SSTable #${t.id} says <b>definitely absent</b>: block read skipped.`); return enq(0.5, () => step(i + 1), true); }
            }
            blocks++; const e = t.entries.find((x) => x.k === k);
            if (e) { flashKey('t' + t.id, C.green, 1.4); return finish(e.t ? `${kk(k)} -> deleted (tombstone in SSTable #${t.id}, hides older versions below)` : `${kk(k)} = ${e.v}  (found in SSTable #${t.id}, level ${t.lvl})`); }
            if (bloomOn) S.fp++;
            flashKey('t' + t.id, C.red, 0.9); say(`<b>get ${kk(k)}</b>: SSTable #${t.id} ${bloomOn ? 'bloom said "maybe" but the key is absent: a <b>false positive</b> cost one wasted block read' : 'has no bloom filter, so a block was read to find out the key is absent'}.`);
            enq(0.6, () => step(i + 1), true);
          };
          step(-2);
        });
      }
      const drain = () => { let n = 0; while (queue.length && n++ < 5000) queue.shift().fn(); };
      const putRandom = () => { const k = 1 + Math.floor(rand() * NKEYS); putOp(k, false); return k; };
      const loadWrites = (n) => { for (let i = 0; i < n; i++) putRandom(); };
      const existingKey = () => { const ks = [...S.truth.keys()]; return ks.length ? ks[Math.floor(rand() * ks.length)] : 1; };
      const seed = () => {
        loadWrites(14); putOp(existingKey(), true); loadWrites(5); putOp(existingKey(), true); loadWrites(3);
        drain(); hl.clear(); S.userOps = S.userOps; S.gets = 0; S.blocks = 0; S.bloomProbes = 0; S.bloomNeg = 0; S.fp = 0; S.last = ''; result.setText('');
      };
      seed();
      let selKey = 7;
      const lowestKey = () => { // a key living in the deepest level for the read-path demo
        for (let l = NLEV - 1; l >= 0; l--) for (const t of S.levels[l]) for (const e of t.entries) if (!e.t && S.truth.get(e.k) === e.v) return e.k;
        return 1;
      };

      const compactAll = () => enq(0.1, () => { const all = allTables(); if (all.length > 1) { all.forEach((t) => flashKey('t' + t.id, C.yellow, 1.2)); enqFront([{ d: 0.9, fn: () => mergeStep(all, NLEV - 1) }]); } });
      current = {
        setKey: (v) => { selKey = v; }, put: () => putOp(selKey, false), get: () => getOp(selKey), del: () => putOp(selKey, true),
        rand: (n) => loadWrites(n), compactAll,
        setMode: (v) => { mode = v; reset(); seed(); }, setBloom: (v) => { bloomOn = v; }, reset: () => { reset(); seed(); },
      };
      return {
        group,
        update(dt) {
          K.tick(dt);
          timer -= dt;
          while (queue.length && timer <= 0) { const it = queue.shift(); it.fn(); timer += it.d * (queue.length > 12 ? 0.15 : 1); }
          if (!queue.length && timer < 0) timer = 0;
          render();
        },
        dispose() { K.dispose(); current = null; },
        onConfigChange() {},
        steps: [
          { title: 'Write path: WAL then memtable', text: 'A put is first appended to the sequential WAL (durability), then inserted into the in-memory skiplist memtable. No random disk I/O: this is why LSMs have high write throughput.', run() { putOp(1 + Math.floor(rand() * NKEYS), false); } },
          { title: 'Memtable fills and freezes', text: 'After 4 keys the memtable becomes immutable; a fresh memtable and WAL segment accept new writes while the old one is flushed in the background.', run() { loadWrites(4); } },
          { title: 'Flush to an L0 SSTable', text: 'The immutable memtable is written out sequentially as a sorted SSTable with a bloom filter. L0 files may overlap each other in key range.', run() { loadWrites(4); } },
          { title: 'Compaction merges and rewrites', text: 'When L0 reaches 3 files (leveled) or a tier has 3 similar tables (size-tiered), tables are merge-sorted, the newest version of each key wins, and results move down. Watch write amplification rise.', run() { loadWrites(10); } },
          { title: 'Delete writes a tombstone', text: 'A delete is a write of a tombstone marker (dagger). It must survive until compaction reaches the bottom level (or no deeper overlapping data exists) so it keeps shadowing older versions.', run() { putOp(existingKey(), true); } },
          { title: 'Read path with bloom filters', text: 'A get checks memtable, immutable, then SSTables newest to oldest. Key range and the bloom filter let most tables be skipped without reading a block; false positives (red) cost one wasted read.', run() { getOp(lowestKey()); } },
          { title: 'Force compaction to reclaim space', text: 'Compacting everything drops tombstones at the bottom level and obsolete versions, lowering space amplification at the cost of extra writes.', run() { enq(0.1, () => { const all = allTables(); if (all.length > 1) { all.forEach((t) => flashKey('t' + t.id, C.yellow, 1.2)); enqFront([{ d: 0.9, fn: () => { mergeStep(all, NLEV - 1); } }]); } }); } },
        ],
      };
    },
    controls: [
      { id: 'key', label: 'key', type: 'range', min: 1, max: 24, value: 7, onChange: (v) => current && current.setKey(v) },
      { id: 'put', label: 'put key', type: 'button', onChange: () => current && current.put() },
      { id: 'get', label: 'get key', type: 'button', onChange: () => current && current.get() },
      { id: 'del', label: 'delete key', type: 'button', onChange: () => current && current.del() },
      { id: 'rand', label: 'put 4 random', type: 'button', onChange: () => current && current.rand(4) },
      { id: 'auto', label: 'auto-load 16 writes', type: 'button', onChange: () => current && current.rand(16) },
      { id: 'compact', label: 'compact everything', type: 'button', onChange: () => current && current.compactAll() },
      { id: 'compaction', label: 'compaction', type: 'select', options: [{ value: 'leveled', label: 'leveled (LCS)' }, { value: 'tiered', label: 'size-tiered (STCS)' }], value: 'leveled', onChange: (v) => current && current.setMode(v) },
      { id: 'bloom', label: 'bloom filters', type: 'toggle', value: true, onChange: (v) => current && current.setBloom(v) },
      { id: 'reset', label: 'reset', type: 'button', onChange: () => current && current.reset() },
    ],
  },
};
let current = null;
