// heap-file vs index-organized-table (table-organization slot). Real mechanics: slots, TIDs, HOT chains, vacuum; clustered leaves, PK double lookup.
import * as THREE from 'three';
import { makeKit, C, rng } from './storage_kit.js';

const NAMES = ['ann', 'bob', 'cat', 'dan', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jon', 'kim', 'lee', 'max', 'noa'];
const CAP = 4;
const tidStr = (t) => `(${t[0]},${t[1] + 1})`;

function makeHeap() {
  const H = { pages: [], idx: [], nid: 1, nn: 0, hot: 0, cold: 0, idxWrites: 0, log: '' };
  H.pages.push(new Array(CAP).fill(null)); H.pages.push(new Array(CAP).fill(null));
  H.get = (t) => H.pages[t[0]][t[1]];
  H.free = () => { for (let p = 0; p < H.pages.length; p++) { const s = H.pages[p].indexOf(null); if (s >= 0) return [p, s]; } if (H.pages.length >= 6) return null; H.pages.push(new Array(CAP).fill(null)); return [H.pages.length - 1, 0]; };
  H.addIdx = (name, tid) => { H.idx.push({ name, tid }); H.idx.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0); H.idxWrites++; };
  H.insert = (name) => {
    const tid = H.free(); if (!tid) return 'heap full (demo capped at 6 pages) - run VACUUM';
    H.pages[tid[0]][tid[1]] = { id: H.nid++, name, val: Math.floor(Math.random() * 90) + 10, xmax: false, next: null, hot: false, lp: 'normal' };
    H.addIdx(name, tid); return `INSERT -> tuple at ctid ${tidStr(tid)}; index entry (${name} -> ${tidStr(tid)}) added`;
  };
  H.follow = (tid) => { const out = []; let t = H.get(tid), cur = tid; let guard = 0; while (t && guard++ < 20) { if (t.lp === 'redirect') { cur = t.to; t = H.get(cur); out.push({ redirect: true }); continue; } out.push({ t, tid: cur }); if (t.next && H.get(t.next) && H.get(t.next).hot) { cur = t.next; t = H.get(cur); } else break; } return out; };
  H.liveTids = () => { const r = []; H.pages.forEach((pg, p) => pg.forEach((t, s) => { if (t && t.lp === 'normal' && !t.xmax) r.push([p, s]); })); return r; };
  H.update = (tid, newName) => {
    const old = H.get(tid), indexedChanged = newName && newName !== old.name;
    const same = H.pages[tid[0]].indexOf(null); // free slot on the SAME page?
    const nv = { id: old.id, name: newName || old.name, val: newName ? old.val : (old.val + 1) % 100, xmax: false, next: null, hot: false, lp: 'normal' };
    if (!indexedChanged && same >= 0) {
      nv.hot = true; H.pages[tid[0]][same] = nv; old.xmax = true; old.next = [tid[0], same]; H.hot++;
      return { msg: `HOT update: indexed column unchanged and page ${tid[0]} has room -> new version at ${tidStr([tid[0], same])} (heap-only), old.ctid chains to it. NO index write.`, tids: [[tid[0], same]] };
    }
    const nt = H.free(); if (!nt) return { msg: 'heap full - run VACUUM first', tids: [] };
    H.pages[nt[0]][nt[1]] = nv; old.xmax = true; old.next = nt; H.cold++;
    H.addIdx(nv.name, nt);
    return { msg: `Non-HOT update (${indexedChanged ? 'indexed column changed' : 'page full'}): new version at ${tidStr(nt)} + NEW index entry (${nv.name}). Old index entry stays until VACUUM.`, tids: [nt] };
  };
  H.del = (tid) => { H.get(tid).xmax = true; return `DELETE ${tidStr(tid)}: xmax set (tuple stays as dead until VACUUM)`; };
  H.vacuum = () => {
    let freed = 0, redirects = 0;
    const roots = []; H.pages.forEach((pg, p) => pg.forEach((t, s) => { if (t && (t.lp === 'redirect' || (t.lp === 'normal' && !t.hot))) roots.push([p, s]); }));
    for (const r of roots) {
      const rt = H.get(r); if (!rt) continue; const ch = H.follow(r).filter((x) => !x.redirect);
      const end = ch[ch.length - 1];
      if (!end) continue;
      if (!end.t.xmax) {
        for (const c of ch) if (c.t !== end.t && !(c.tid[0] === r[0] && c.tid[1] === r[1])) { H.pages[c.tid[0]][c.tid[1]] = null; freed++; }
        if (!(end.tid[0] === r[0] && end.tid[1] === r[1])) { H.pages[r[0]][r[1]] = { lp: 'redirect', to: end.tid }; redirects++; if (ch.length > 0 && ch[0].tid[0] === r[0] && ch[0].tid[1] === r[1]) freed++; }
      } else {
        for (const c of ch) { H.pages[c.tid[0]][c.tid[1]] = null; freed++; }
        H.pages[r[0]][r[1]] = null;
      }
    }
    const before = H.idx.length; H.idx = H.idx.filter((e) => H.get(e.tid)); const dropped = before - H.idx.length;
    return `VACUUM: reclaimed ${freed} dead tuples, ${redirects} line pointers -> REDIRECT, removed ${dropped} dead index entries`;
  };
  return H;
}

function makeIOT() {
  const I = { leaves: [[]], idx: [], nid: 1, splits: 0, idxWrites: 0 };
  I.addIdx = (name, pk) => { I.idx.push({ name, pk }); I.idx.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.pk - b.pk); I.idxWrites++; };
  I.leafOf = (pk) => { for (let i = 0; i < I.leaves.length; i++) { const l = I.leaves[i]; if (!l.length || pk <= l[l.length - 1].id || i === I.leaves.length - 1) return i; } return 0; };
  I.insert = (id, name) => {
    const li = I.leafOf(id), l = I.leaves[li]; const row = { id, name, val: Math.floor(Math.random() * 90) + 10 };
    l.push(row); l.sort((a, b) => a.id - b.id); let msg = `INSERT pk=${id}: descend root -> leaf ${li}, insert in key order`;
    if (l.length > CAP) { const h = Math.ceil(l.length / 2); const right = l.splice(h); I.leaves.splice(li + 1, 0, right); I.splits++; msg += `; leaf overflow -> SPLIT (rows move to new leaf, parent separator ${right[0].id})`; }
    I.addIdx(name, id); return { msg, leaf: li };
  };
  I.find = (pk) => { for (let i = 0; i < I.leaves.length; i++) { const j = I.leaves[i].findIndex((r) => r.id === pk); if (j >= 0) return [i, j]; } return null; };
  return I;
}

function tableView(defMode) {
  let S = null;
  const view = {
    build(ctx) {
      const M = makeKit(ctx); const group = new THREE.Group(); group.add(M.group);
      let R = null, rg = null;
      const rand = rng(7);
      const st = { mode: defMode, heap: null, iot: null, hl: new Map(), log: '', trace: '', stats: '', cfgMode: null };
      const reset = () => {
        st.heap = makeHeap(); st.iot = makeIOT();
        for (let i = 0; i < 5; i++) { st.heap.insert(NAMES[i]); st.iot.insert(st.iot.nid++, NAMES[i]); }
        st.hl.clear(); st.log = 'Seeded 5 rows.'; st.trace = '';
      };
      const modeFromConfig = (cfg) => { const o = cfg && cfg['table-organization']; return o === 'heap' ? 'heap' : o === 'index-organized' ? 'iot' : null; };
      st.mode = modeFromConfig(ctx.config) || defMode;
      reset();
      const hlc = (k) => st.hl.get(k);
      const flashKeys = (keys, color, dur = 1.6) => { keys.forEach((k) => st.hl.set(k, color)); render(); M.after(dur, () => { keys.forEach((k) => st.hl.delete(k)); render(); }); };
      const trail = (list, color, step = 0.45) => { list.forEach((keys, i) => M.after(i * step, () => { (Array.isArray(keys) ? keys : [keys]).forEach((k) => st.hl.set(k, color)); render(); })); M.after(list.length * step + 1.2, () => { st.hl.clear(); render(); }); };

      function render() {
        if (R) { group.remove(R.group); R.dispose(); }
        R = makeKit(ctx); group.add(R.group);
        const iot = st.mode === 'iot';
        R.label(iot ? 'INDEX-ORGANIZED TABLE (clustered B+tree: leaf = the row)' : 'HEAP FILE (unordered pages, rows addressed by TID / ctid)', -0.8, 5.9, 0, { size: 0.5, w: 900, px: 40, color: iot ? '#e0af68' : '#2ac3de', bold: true });
        const pageX = -3.2, pageW = 8.2;
        if (!iot) {
          const H = st.heap;
          H.pages.forEach((pg, p) => {
            const y = 4.6 - p * 1.65;
            R.box(pageW, 1.45, 0.2, 0x1b2342, pageX, y, -0.2);
            R.label(`heap page ${p}`, pageX - pageW / 2 - 1.5, y + 0.3, 0.1, { size: 0.36, w: 300, px: 36, color: '#7f8bb3' });
            R.label('line ptrs ->', pageX - pageW / 2 - 1.5, y - 0.2, 0.1, { size: 0.3, w: 300, px: 30, color: '#56607f' });
            pg.forEach((t, s) => {
              const x = pageX - pageW / 2 + 1.05 + s * 2.05;
              let col = 0x24305c, txt = `(${p},${s + 1}) free`, tc = '#56607f';
              if (t) {
                if (t.lp === 'redirect') { col = 0x4b3a6e; txt = `redirect->${tidStr(t.to)}`; tc = '#bb9af7'; }
                else { col = t.xmax ? 0x6e2f3d : (t.hot ? 0x6e5a2a : 0x1f6f80); txt = `${t.id} ${t.name} v${t.val}${t.hot ? ' H' : ''}`; tc = '#e6ebff'; }
              }
              const k = `h${p}_${s}`; const h = hlc(k);
              const b = R.box(1.9, 1.0, 0.3, h ?? col, x, y, 0.05, h ? { emissive: h } : {});
              R.label(txt, x, y + (t && t.lp === 'normal' ? 0.12 : 0), 0.25, { size: 0.36, w: 340, px: 40, color: tc });
              if (t && t.lp === 'normal') R.label(`${t.xmax ? 'xmax set(dead)' : 'live'}${t.next ? ' ctid->' + tidStr(t.next) : ''}`, x, y - 0.3, 0.25, { size: 0.22, w: 480, px: 30, color: t.xmax ? '#f7768e' : '#9ece6a' });
              b.userData.pos = [x, y];
            });
          });
          // ctid chain arrows
          H.pages.forEach((pg, p) => pg.forEach((t, s) => { if (t && t.next) { const x1 = pageX - pageW / 2 + 1.05 + s * 2.05, y1 = 4.6 - p * 1.65; const x2 = pageX - pageW / 2 + 1.05 + t.next[1] * 2.05, y2 = 4.6 - t.next[0] * 1.65; R.lines([[x1 + 0.7, y1 + 0.55, 0.4], [x2 - 0.7, y2 + 0.55, 0.4]], t.hot ? C.yellow : C.red); } }));
          // secondary index
          const ix = 6.5;
          R.label('secondary index idx_name (B+tree leaf)', ix, 5.4, 0, { size: 0.36, w: 700, px: 38, color: '#bb9af7' });
          H.idx.forEach((e, i) => {
            const y = 4.7 - i * 0.62; if (y < -5.2) return; const k = `i${e.name}${e.tid}`; const h = hlc(k);
            const dead = H.get(e.tid) && H.get(e.tid).xmax && H.get(e.tid).lp === 'normal' && !H.get(e.tid).next;
            R.box(2.9, 0.5, 0.2, h ?? (dead ? 0x6e2f3d : 0x3b3170), ix, y, 0, h ? { emissive: h } : {});
            R.label(`${e.name} -> ${tidStr(e.tid)}`, ix, y, 0.15, { size: 0.32, w: 340, px: 40 });
            const x2 = pageX - pageW / 2 + 1.05 + e.tid[1] * 2.05 + 0.95, y2 = 4.6 - e.tid[0] * 1.65;
            R.lines([[ix - 1.45, y, 0.1], [x2, y2, 0.25]], h ? C.yellow : 0x48508a, { opacity: 0.55 });
          });
        } else {
          const I = st.iot;
          R.label('root: [' + I.leaves.slice(1).map((l) => l[0] ? l[0].id : '-').join(' | ') + ']', pageX, 5.2, 0, { size: 0.36, w: 600, px: 40, color: '#e0af68' });
          I.leaves.forEach((l, i) => {
            const y = 4.2 - i * 1.4; if (y < -5.2) return;
            R.box(pageW, 1.2, 0.2, 0x2b2a16, pageX, y, -0.2);
            R.label(`leaf ${i}  (PK order)`, pageX - pageW / 2 - 1.5, y + 0.15, 0.1, { size: 0.36, w: 300, px: 36, color: '#e0af68' });
            for (let s = 0; s < CAP; s++) {
              const r = l[s]; const x = pageX - pageW / 2 + 1.05 + s * 2.05; const k = `l${i}_${s}`; const h = hlc(k);
              R.box(1.9, 0.9, 0.3, h ?? (r ? 0x7a5d1f : 0x24305c), x, y, 0.05, h ? { emissive: h } : {});
              R.label(r ? `${r.id} ${r.name} v${r.val}` : 'free', x, y, 0.25, { size: 0.36, w: 340, px: 40, color: r ? '#e6ebff' : '#56607f' });
            }
            if (i < I.leaves.length - 1) R.lines([[pageX + pageW / 2, y, 0.2], [pageX + pageW / 2 + 0.3, y, 0.2], [pageX + pageW / 2 + 0.3, y - 1.4, 0.2], [pageX + pageW / 2, y - 1.4, 0.2]], C.yellow);
          });
          const ix = 6.5;
          R.label('secondary index idx_name -> stores PK', ix, 5.4, 0, { size: 0.36, w: 700, px: 38, color: '#bb9af7' });
          I.idx.forEach((e, i) => {
            const y = 4.7 - i * 0.62; if (y < -5.2) return; const h = hlc(`i${e.name}${e.pk}`);
            R.box(2.9, 0.5, 0.2, h ?? 0x3b3170, ix, y, 0, h ? { emissive: h } : {});
            R.label(`${e.name} -> pk ${e.pk}`, ix, y, 0.15, { size: 0.32, w: 340, px: 40 });
          });
        }
        R.label(st.log, -0.8, -5.9, 0.3, { size: 0.34, w: 1800, px: 34, color: '#c0caf5' });
        R.label(st.trace, -0.8, -6.45, 0.3, { size: 0.3, w: 1800, px: 30, color: '#9ece6a' });
        const H = st.heap, I = st.iot;
        R.label(iot ? `splits ${I.splits} | secondary-index writes ${I.idxWrites} | leaves ${I.leaves.length}` : `HOT updates ${H.hot} | cold updates ${H.cold} | index writes ${H.idxWrites} | pages ${H.pages.length}`, 6.0, -6.9, 0.3, { size: 0.3, w: 900, px: 32, color: '#e0af68' });
      }
      render();

      // ---- operations
      S = {
        st, render, reset,
        insert() {
          if (st.mode === 'iot') { const id = rand() < 0.5 ? st.iot.nid++ : 1 + Math.floor(rand() * 40); if (st.iot.find(id)) { st.log = 'dup pk'; render(); return; } const r = st.iot.insert(id, NAMES[st.iot.nn = ((st.iot.nn || 0) + 1) % NAMES.length]); st.log = r.msg; st.trace = 'random PK lands mid-tree -> splits/fragmentation; auto-increment PK appends at right edge'; const l = st.iot.find(id); render(); if (l) flashKeys([`l${l[0]}_${l[1]}`], C.green); }
          else { const nm = NAMES[(st.heap.nn = (st.heap.nn + 5) % NAMES.length)]; st.log = st.heap.insert(nm); st.trace = 'heap insert: any page with free space (FSM) - no ordering, append-friendly'; render(); const e = st.heap.idx.find((x) => x.name === nm && st.heap.get(x.tid) && st.heap.get(x.tid).name === nm); if (e) flashKeys([`h${e.tid[0]}_${e.tid[1]}`, `i${e.name}${e.tid}`], C.green); }
        },
        update(indexed) {
          if (st.mode === 'iot') {
            const all = []; st.iot.leaves.forEach((l, i) => l.forEach((r, j) => all.push([i, j]))); if (!all.length) return; const [i, j] = all[Math.floor(rand() * all.length)]; const r = st.iot.leaves[i][j];
            if (indexed) { const old = r.name; const nn = NAMES[(NAMES.indexOf(old) + 3) % NAMES.length]; st.iot.idx = st.iot.idx.filter((e) => !(e.name === old && e.pk === r.id)); r.name = nn; st.iot.addIdx(nn, r.id); st.log = `UPDATE name ${old}->${nn}: row rewritten in leaf ${i} + secondary index delete+insert`; }
            else { r.val = (r.val + 1) % 100; st.log = `UPDATE val: in-place in clustered leaf ${i} - secondary index untouched (it stores PK, not location)`; }
            st.trace = 'rows never change address on update (PK is the pointer) - but a PK change = delete + insert'; render(); flashKeys([`l${i}_${j}`], C.yellow);
          } else {
            const lt = st.heap.liveTids(); if (!lt.length) return; const tid = lt[Math.floor(rand() * lt.length)]; const o = st.heap.get(tid);
            const res = st.heap.update(tid, indexed ? NAMES[(NAMES.indexOf(o.name) + 3) % NAMES.length] : null); st.log = res.msg; st.trace = indexed ? 'every index on a changed column needs a new entry; all other indexes also get new TIDs unless HOT' : 'HOT = Heap-Only Tuple: new version chained within page, indexes keep pointing at the chain root'; render();
            flashKeys([`h${tid[0]}_${tid[1]}`, ...res.tids.map((t) => `h${t[0]}_${t[1]}`)], C.yellow);
          }
        },
        del() {
          if (st.mode === 'iot') { const all = []; st.iot.leaves.forEach((l, i) => l.forEach((r, j) => all.push([i, j]))); if (!all.length) return; const [i, j] = all[Math.floor(rand() * all.length)]; const r = st.iot.leaves[i].splice(j, 1)[0]; st.iot.idx = st.iot.idx.filter((e) => !(e.pk === r.id && e.name === r.name)); st.log = `DELETE pk=${r.id}: row removed from leaf ${i}, sec. index entry removed (merge if underfull)`; if (!st.iot.leaves[i].length && st.iot.leaves.length > 1) st.iot.leaves.splice(i, 1); render(); }
          else { const lt = st.heap.liveTids(); if (!lt.length) return; const tid = lt[Math.floor(rand() * lt.length)]; st.log = st.heap.del(tid); st.trace = 'space not reusable until VACUUM; index entries still point at the dead tuple'; render(); flashKeys([`h${tid[0]}_${tid[1]}`], C.red); }
        },
        vacuum() { if (st.mode === 'iot') { st.log = 'IOT: no heap to vacuum; old versions live in undo log (InnoDB purge), pages merge on underflow'; render(); return; } st.log = st.heap.vacuum(); st.trace = 'dead tuples freed, HOT chains collapsed into REDIRECT line pointers, dead index entries removed'; render(); },
        lookup(name, byId) {
          if (st.mode === 'iot') {
            const I = st.iot;
            if (byId) { const pk = I.leaves.flat().map((r) => r.id)[1]; const f = pk != null && I.find(pk); if (!f) return; st.log = `SELECT * WHERE id=${pk}: root -> leaf ${f[0]} : row is IN the leaf. 2 node visits`; st.trace = 'PK lookup = one tree descent'; trail([[`l${f[0]}_${f[1]}`]], C.green); return; }
            const e = I.idx.find((x) => x.name === name); if (!e) { st.log = `no row named ${name}`; render(); return; } const f = I.find(e.pk);
            st.log = `SELECT * WHERE name='${name}': secondary idx -> pk ${e.pk} -> DESCEND clustered tree (root -> leaf ${f[0]}). ~3 node visits`; st.trace = 'DOUBLE LOOKUP: secondary index returns PK, not a physical address'; trail([`i${e.name}${e.pk}`, `l${f[0]}_${f[1]}`], C.green, 0.7);
          } else {
            const H = st.heap; const es = H.idx.filter((x) => x.name === name); if (!es.length) { st.log = `no index entry for ${name}`; render(); return; }
            const seq = []; let hops = 0, pages = new Set();
            es.forEach((e) => { seq.push(`i${e.name}${e.tid}`); H.follow(e.tid).forEach((c) => { if (c.redirect) { hops++; return; } seq.push(`h${c.tid[0]}_${c.tid[1]}`); pages.add(c.tid[0]); hops++; }); });
            st.log = `SELECT * WHERE name='${name}': idx_name -> ${es.length} TID(s) -> heap fetch (${pages.size} heap page(s), ${hops} chain hops incl. HOT)`; st.trace = 'index entry -> TID is a physical (page,slot) pointer: 1 random heap read'; trail(seq, C.green, 0.6);
          }
        },
        setMode(m) { st.mode = m; st.hl.clear(); render(); },
      };
      reset(); render();
      const modeName = () => st.mode === 'iot' ? 'index-organized' : 'heap';
      return {
        group, S,
        update(dt) { M.tick(dt); },
        onConfigChange(cfg) { const m = modeFromConfig(cfg); if (m && m !== st.mode) { st.mode = m; render(); if (S.sync) S.sync(); } },
        dispose() { if (R) R.dispose(); M.dispose(); },
        steps: [
          { title: 'Where does a row live?', text: 'Heap: rows go wherever the free-space map finds room; each row is addressed by a TID (page, slot). IOT: the row IS a leaf entry of the clustered primary-key B+tree.', run() { S.setMode('heap'); } },
          { title: 'Index -> heap fetch', text: 'A secondary index entry stores the TID. A lookup = index descent + one random heap page read.', run() { S.setMode('heap'); S.lookup('bob'); } },
          { title: 'HOT update (non-indexed column)', text: 'If no indexed column changes and the same page has room, the new tuple version is chained inside the page and NO index entry is written.', run() { S.setMode('heap'); S.update(false); } },
          { title: 'Indexed-column update', text: 'The new version needs a fresh index entry (and every other index too if not HOT) - write amplification. The old entry stays until VACUUM.', run() { S.setMode('heap'); S.update(true); } },
          { title: 'VACUUM', text: 'Dead tuples are reclaimed, chains collapse to REDIRECT line pointers, dead index entries are removed.', run() { S.setMode('heap'); S.vacuum(); } },
          { title: 'Switch to index-organized', text: 'Rows are physically in primary-key order inside the leaves. PK lookup = one tree descent; no heap.', run() { S.setMode('iot'); S.lookup(null, true); } },
          { title: 'Secondary index double lookup', text: 'In an IOT (InnoDB, SQLite WITHOUT ROWID) secondary indexes store the PK, so a lookup walks the secondary tree then the clustered tree.', run() { S.setMode('iot'); S.lookup('cat'); } },
          { title: 'Random-PK inserts split leaves', text: 'Inserting out of key order splits leaves (half-empty pages). An auto-increment PK appends on the right edge.', run() { S.setMode('iot'); for (let i = 0; i < 4; i++) S.insert(); } },
        ],
      };
    },
    controls: [
      { id: 'mode', label: 'organization', type: 'select', options: [{ value: 'heap', label: 'heap file' }, { value: 'iot', label: 'index-organized' }], value: defMode, onChange(v) { S && S.setMode(v); } },
      { id: 'insert', label: 'INSERT row', type: 'button', onChange() { S && S.insert(); } },
      { id: 'upd-val', label: 'UPDATE non-indexed col', type: 'button', onChange() { S && S.update(false); } },
      { id: 'upd-idx', label: 'UPDATE indexed col', type: 'button', onChange() { S && S.update(true); } },
      { id: 'delete', label: 'DELETE row', type: 'button', onChange() { S && S.del(); } },
      { id: 'vacuum', label: 'VACUUM', type: 'button', onChange() { S && S.vacuum(); } },
      { id: 'lookup', label: 'Lookup by name (secondary)', type: 'button', onChange() { S && S.lookup(['bob', 'cat', 'ann', 'dan'][Math.floor(Math.random() * 4)]); } },
      { id: 'lookup-pk', label: 'Lookup by PK', type: 'button', onChange() { S && S.lookup(null, true); } },
      { id: 'reset', label: 'Reset', type: 'button', onChange() { if (S) { S.reset(); S.render(); } } },
    ],
  };
  return view;
}

export const views = { 'heap-file': tableView('heap'), 'index-organized-table': tableView('iot') };
