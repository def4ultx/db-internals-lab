// disaggregated-storage view: shared-nothing vs shared-disk vs disaggregated (Aurora/Neon style)
import * as THREE from 'three';
import { makeKit, C } from './_dist-kit.js';

const ARCH = {
  'shared-nothing': {
    title: 'Shared-nothing', color: C.cyan,
    html: `<b>Shared-nothing</b> (Vitess/MySQL, Cassandra, CockroachDB, Greenplum): every node owns <i>compute + a local disk partition</i>. Reads are local NVMe (~100 &micro;s), writes fsync a local WAL (~0.2-1 ms) then replicate to a peer.<br>
<b>Cost:</b> compute and storage scale together; adding a node means <i>physically copying 1/N of the data</i> (1 TB at 1 GB/s &asymp; 17 min, in practice hours with throttling). A node failure = re-replicate its partitions.`,
  },
  'shared-disk': {
    title: 'Shared-disk', color: C.yellow,
    html: `<b>Shared-disk</b> (Oracle RAC, IBM Db2 pureScale, classic SAN clusters): all nodes see one storage volume. Compute scales without moving data, but every node has its own buffer cache so a <i>global lock manager + cache fusion</i> (block pings over interconnect, ~0.3-0.5 ms) is needed for coherence.<br>
<b>Cost:</b> the SAN/volume is a single bottleneck and failure domain; coherence traffic grows with write-sharing.`,
  },
  'disaggregated-object-store': {
    title: 'Disaggregated + object store', color: C.orange,
    html: `<b>Disaggregated</b> (Aurora, Neon, Snowflake, Socrates/Hyperscale): compute is <i>stateless</i> - only a cache. Durability = <b>WAL service</b> (Aurora: 6 copies / 3 AZ, 4/6 write quorum; Neon: 3 safekeepers, Paxos-like 2/3). <b>"The log is the database"</b>: compute ships only redo records; <b>page servers</b> replay WAL into page versions (GetPage@LSN) and upload immutable layer files to <b>S3</b> (11 nines, ~$0.023/GB-mo, GET first byte 20-50 ms; S3 Express ~5 ms).<br>
Read path: compute buffer pool (0.1 ms) &rarr; local SSD cache (~0.1-0.2 ms) &rarr; page server (~1-2 ms) &rarr; S3 (~30 ms).`,
  },
};
const ARCH_IDS = Object.keys(ARCH);
const PAGES = 16;
const CACHE_CAP = 8;
let cur = null;

export const views = {
  'disaggregated-storage': {
    build(ctx) {
      const kit = makeKit(ctx);
      const { group } = kit;
      const S = {
        arch: ctx.config['storage-architecture'] || 'disaggregated-object-store',
        n: 3, nodes: [], lsn: 0, last: '-', lat: [], psCache: new Set([0, 1, 2, 3, 4, 5]),
        rebal: null, sk: [], ps: [], lsnText: null,
      };
      let arch = new THREE.Group(); group.add(arch);
      const pageCol = (p) => new THREE.Color().setHSL((p / PAGES) * 0.85, 0.55, 0.55);
      const nx = (i) => (i - (S.n - 1) / 2) * 4.4;
      let hud, hud2, statText;
      let busy = 0;

      const hotPage = () => (Math.random() < 0.7 ? Math.floor(Math.random() * 4) : Math.floor(Math.random() * PAGES));
      const record = (ms, what) => {
        S.lat.push(ms); if (S.lat.length > 12) S.lat.shift();
        const avg = S.lat.reduce((a, b) => a + b, 0) / S.lat.length;
        S.last = `${what}: ${ms < 1 ? (ms * 1000).toFixed(0) + ' us' : ms.toFixed(1) + ' ms'}`;
        hud.set(`last: ${S.last}\navg(last ${S.lat.length}): ${avg < 1 ? avg.toFixed(2) : avg.toFixed(1)} ms`, ms > 10 ? C.red : ms > 0.9 ? C.yellow : C.green);
      };

      function rebuild() {
        kit.clear(arch); group.remove(arch); arch = new THREE.Group(); group.add(arch);
        kit.clearTimers();
        const A = ARCH[S.arch];
        S.nodes = []; S.sk = []; S.ps = [];
        // nodes
        for (let i = 0; i < S.n; i++) {
          const x = nx(i);
          const nd = { i, x, alive: true, cache: new Map(), cells: [], body: null };
          nd.body = kit.box(3, 1.1, 1.3, S.arch === 'disaggregated-object-store' ? 0x3b6ea8 : 0x4a5d9a, [x, 5, 0], arch);
          kit.text(`compute ${i + 1}${S.arch === 'disaggregated-object-store' ? '\n(stateless)' : ''}`, { size: 0.42 }, [x, 6.2, 0], arch);
          const top = S.arch === 'disaggregated-object-store' ? 'buffer pool + SSD cache' : 'buffer pool';
          kit.text(top, { size: 0.28, color: C.dim }, [x, 3.55, 0], arch);
          for (let c = 0; c < CACHE_CAP; c++) {
            const cell = kit.box(0.5, 0.5, 0.5, 0x242a40, [x - 0.9 + (c % 4) * 0.6, 3.05 - Math.floor(c / 4) * 0.6, 0], arch);
            nd.cells.push(cell);
          }
          S.nodes.push(nd);
        }
        if (S.arch === 'shared-nothing') {
          for (const nd of S.nodes) {
            const d = kit.cyl(1.35, 1.2, 0x2d3a5c, [nd.x, 0.4, 0], arch);
            kit.text('local NVMe + WAL', { size: 0.3, color: C.cyan }, [nd.x, 1.35, 0], arch);
            nd.disk = d; nd.parts = [];
            for (let p = 0; p < PAGES; p++) if (p % S.n === nd.i) nd.parts.push(p);
            kit.text('partitions ' + nd.parts.slice(0, 5).map(p => 'p' + p).join(' ') + (nd.parts.length > 5 ? '..' : ''), { size: 0.26, color: C.dim }, [nd.x, -0.5, 0], arch);
            kit.line([[nd.x, 4.4, 0], [nd.x, 1.0, 0]], C.line, {}, arch);
          }
          for (let i = 0; i < S.n - 1; i++) kit.line([[nd0(i).x + 1.4, 0.4, 0.3], [nd0(i + 1).x - 1.4, 0.4, 0.3]], C.cyan, { opacity: 0.4 }, arch);
          kit.text('replication / rebalance network', { size: 0.28, color: C.cyan }, [0, -1.3, 0], arch);
          kit.text('Add node => move 1/N of data. Capacity and compute are coupled.', { size: 0.4, color: C.cyan }, [0, -4, 0], arch);
          S.rebalBar = kit.box(0.01, 0.35, 0.3, C.cyan, [-6, -5.2, 0], arch);
          kit.box(12, 0.08, 0.08, C.line, [0, -5.2, 0], arch);
        } else if (S.arch === 'shared-disk') {
          kit.cyl(7, 1.8, 0x5d4a2a, [0, -1.2, 0], arch);
          kit.text('shared SAN / network volume\n(one copy, one bottleneck)', { size: 0.42, color: C.yellow }, [0, -1.2, 1.5], arch);
          const glm = kit.box(3.4, 0.9, 1, 0x7a5f20, [0, 0.9, 0], arch);
          kit.text('global lock mgr + cache fusion', { size: 0.34, color: C.yellow }, [0, 1.65, 0], arch);
          S.glm = glm;
          for (const nd of S.nodes) { kit.line([[nd.x, 4.4, 0], [0, 1.4, 0]], C.line, { opacity: 0.4 }, arch); kit.line([[nd.x, 4.4, 0], [nd.x * 0.8, -0.3, 0]], C.yellow, { opacity: 0.35 }, arch); }
          kit.text('Add node => instant attach, but coherence traffic grows.', { size: 0.4, color: C.yellow }, [0, -4, 0], arch);
        } else {
          // WAL service
          for (let k = 0; k < 3; k++) {
            const x = -8 + k * 2.4; const b = kit.box(1.9, 1, 1, 0x7a3b4a, [x, 0.6, 0], arch);
            kit.text(`safekeeper ${k + 1}`, { size: 0.3, color: C.red }, [x, 1.4, 0], arch); S.sk.push({ x, b, lsn: 0 });
          }
          kit.text('WAL service (quorum 2/3; Aurora 4/6)', { size: 0.34, color: C.red }, [-5.6, -0.3, 0], arch);
          for (let k = 0; k < 2; k++) {
            const x = 3 + k * 4; const b = kit.box(2.6, 1.2, 1, 0x3b7a5a, [x, 0.6, 0], arch);
            kit.text(`page server ${k + 1}`, { size: 0.32, color: C.green }, [x, 1.5, 0], arch); S.ps.push({ x, b });
          }
          kit.text('replay WAL -> pages (GetPage@LSN)', { size: 0.32, color: C.green }, [5, -0.4, 0], arch);
          const s3 = kit.box(19, 1.1, 1.8, 0x6b4a2a, [0, -4.4, 0], arch);
          kit.text('S3 / object store: immutable image + delta layers, 11 9s, GET ~30 ms, $0.023/GB-mo', { size: 0.38, color: C.orange }, [0, -4.4, 1.1], arch);
          S.s3 = s3;
          kit.line([[-2.8, 0.6, 0], [1.6, 0.6, 0]], C.red, { opacity: 0.5 }, arch);
          S.lsnText = kit.text('LSN 0/0', { size: 0.36, color: C.red }, [-0.6, 1.2, 0], arch);
          kit.line([[3, 0, 0], [3, -3.8, 0]], C.line, {}, arch); kit.line([[7, 0, 0], [7, -3.8, 0]], C.line, {}, arch);
          for (const nd of S.nodes) { kit.line([[nd.x, 4.4, 0], [nd.x, 2.4, 0]], C.line, {}, arch); }
          kit.text('Compute holds NO durable state: kill it, scale it to 0, start another in ~1 s.', { size: 0.4, color: C.orange }, [0, 7.6, 0], arch);
        }
        paintCache();
        const t = ctx.onInfo; t && t(A.html);
      }
      const nd0 = (i) => S.nodes[i];
      function paintCache() {
        for (const nd of S.nodes) {
          nd.cells.forEach((cell, c) => {
            const keys = [...nd.cache.keys()]; const p = keys[c];
            if (p === undefined) kit.setColor(cell, nd.alive ? 0x242a40 : 0x14161f); else kit.setColor(cell, pageCol(p));
          });
          kit.setColor(nd.body, nd.alive ? (S.arch === 'disaggregated-object-store' ? 0x3b6ea8 : 0x4a5d9a) : 0x4a2a2a);
        }
      }
      function cacheAdd(nd, p) { if (nd.cache.size >= CACHE_CAP) nd.cache.delete(nd.cache.keys().next().value); nd.cache.set(p, 1); paintCache(); }
      function pickNode() { const a = S.nodes.filter(n => n.alive); return a[Math.floor(Math.random() * a.length)]; }

      function readQuery() {
        const nd = pickNode(); if (!nd) { hud.set('no live compute nodes', C.red); return; }
        const p = hotPage(); const src = [nd.x, 4.4, 0];
        const flash = (col) => { kit.glow(nd.body, col, 0.8); kit.after(0.35, () => nd.body.material.emissive.set(0)); };
        if (nd.cache.has(p)) { flash(0x2a8a3a); record(0.1, `page ${p} cache HIT`); nd.cache.delete(p); nd.cache.set(p, 1); return; }
        if (S.arch === 'shared-nothing') {
          kit.send(src, [nd.x, 1, 0], { color: C.cyan, dur: 0.5, onArrive: () => { cacheAdd(nd, p); record(0.12, `p${p} miss -> local NVMe`); } });
        } else if (S.arch === 'shared-disk') {
          kit.send(src, [0, 0.9, 0], { color: C.yellow, dur: 0.5, onArrive: () => {
            const other = S.nodes.find(o => o !== nd && o.alive && o.cache.has(p));
            if (other) { kit.send([0, 0.9, 0], [other.x, 4.4, 0], { color: C.yellow, dur: 0.4, onArrive: () => { cacheAdd(nd, p); record(0.4, `p${p} cache-fusion block transfer from node ${other.i + 1}`); } }); }
            else kit.send([0, 0.9, 0], [0, -0.6, 0], { color: C.yellow, dur: 0.5, onArrive: () => { cacheAdd(nd, p); record(1.0, `p${p} miss -> SAN read (+lock)`); } });
          } });
        } else {
          const ps = S.ps[p % 2];
          kit.send(src, [ps.x, 1.1, 0], { color: C.green, dur: 0.7, label: `GetPage(${p})@LSN`, onArrive: () => {
            if (S.psCache.has(p)) {
              kit.send([ps.x, 1.1, 0], src, { color: C.green, dur: 0.6, onArrive: () => { cacheAdd(nd, p); record(1.5, `p${p} miss -> page server (warm)`); } });
            } else {
              kit.glow(ps.b, 0xaa6020, 0.8);
              kit.send([ps.x, 0.1, 0], [ps.x, -3.9, 0], { color: C.orange, dur: 0.8, label: 'S3 GET', onArrive: () => {
                kit.send([ps.x, -3.9, 0], [ps.x, 0.1, 0], { color: C.orange, dur: 0.8, onArrive: () => {
                  ps.b.material.emissive.set(0); S.psCache.add(p);
                  kit.send([ps.x, 1.1, 0], src, { color: C.green, dur: 0.6, onArrive: () => { cacheAdd(nd, p); record(35, `p${p} COLD -> page server -> S3`); } });
                } });
              } });
            }
          } });
        }
      }
      function writeQuery() {
        const nd = pickNode(); if (!nd) return; const src = [nd.x, 4.4, 0];
        if (S.arch === 'shared-nothing') {
          const peer = S.nodes[(nd.i + 1) % S.n];
          kit.send(src, [nd.x, 1, 0], { color: C.red, dur: 0.5, label: 'WAL', onArrive: () => {
            kit.send([nd.x, 0.4, 0.3], [peer.x, 0.4, 0.3], { color: C.red, dur: 0.6, onArrive: () => record(1.2, 'commit: local fsync + peer replica ack') });
          } });
        } else if (S.arch === 'shared-disk') {
          kit.send(src, [0, 0.9, 0], { color: C.red, dur: 0.5, label: 'lock X', onArrive: () => {
            kit.send([0, 0.9, 0], [0, -0.6, 0], { color: C.red, dur: 0.5, label: 'write', onArrive: () => {
              S.nodes.forEach(o => { if (o !== nd) o.cache.delete([...o.cache.keys()][0]); }); paintCache(); record(1.8, 'commit: GLM lock + SAN write, invalidate peers');
            } });
          } });
        } else {
          let acks = 0; S.lsn += 1 + Math.floor(Math.random() * 3); const lsn = S.lsn; let done = false;
          S.sk.forEach((sk, k) => kit.send(src, [sk.x, 1.1, 0], { color: C.red, dur: 0.7 + k * 0.12, label: `redo@${lsn}`, onArrive: () => {
            sk.lsn = lsn; kit.glow(sk.b, 0xaa3040, 0.9); kit.after(0.3, () => sk.b.material.emissive.set(0));
            kit.send([sk.x, 1.1, 0], src, { color: C.green, dur: 0.5, size: 0.14, onArrive: () => {
              acks++; if (acks === 2 && !done) { done = true; record(1.5, `commit LSN ${lsn}: quorum 2/3 durable (no data page written!)`);
                S.lsnText.set(`LSN 0/${lsn.toString(16).toUpperCase().padStart(2, '0')}  committed`, C.green);
                S.ps.forEach((ps) => kit.after(0.6, () => kit.send([S.sk[0].x, 1.1, 0], [ps.x, 1.1, 0], { color: C.red, dur: 1.2, label: 'WAL stream', onArrive: () => { kit.glow(ps.b, 0x30a060, 0.8); kit.after(0.3, () => ps.b.material.emissive.set(0)); S.psCache.add(lsn % PAGES); } })));
                if (lsn % 5 < 3) kit.after(1.8, () => S.ps.forEach(ps => kit.send([ps.x, 0.1, 0], [ps.x, -3.9, 0], { color: C.orange, dur: 1.0, label: 'layer file PUT' })));
              }
            } });
          } }));
        }
      }
      function setN(n) {
        const old = S.n; S.n = n; const keepCaches = S.nodes.map(x => x.cache);
        rebuild(); keepCaches.forEach((c, i) => { if (S.nodes[i]) S.nodes[i].cache = c; }); paintCache();
        if (n > old) {
          const nd = S.nodes[n - 1]; nd.cache = new Map(); nd.body.scale.setScalar(0.1);
          kit.animate((dt) => { if (nd.body.scale.x < 3) nd.body.scale.set(Math.min(3, nd.body.scale.x + dt * 6), Math.min(1.1, nd.body.scale.y + dt * 2.2), Math.min(1.3, nd.body.scale.z + dt * 2.6)); });
          if (S.arch === 'shared-nothing') startRebalance(nd);
          else hud2.set(S.arch === 'shared-disk' ? 'node added: online in seconds; cache cold; GLM remastered' : 'node added in ~1 s: attach to WAL/page servers; cache COLD -> first reads 1-35 ms', C.green);
        }
        if (S.arch !== 'shared-nothing') hud2.set(hud2.text, undefined);
      }
      function startRebalance(nd) {
        S.rebal = { p: 0, nd };
        hud2.set('rebalance: copying partitions to new node (1 TB @ 1 GB/s = ~17 min; sim x100)', C.yellow);
      }
      function coldStart() {
        const nd = pickNode(); if (!nd) return; nd.cache = new Map(); paintCache();
        hud2.set('compute restarted with EMPTY cache: next reads are cache misses (watch latency jump from 0.1 ms to 1.5-35 ms)', C.yellow);
        for (let i = 0; i < 5; i++) kit.after(0.8 + i * 0.9, readQuery);
      }
      function kill() {
        const alive = S.nodes.filter(n => n.alive); if (alive.length < 1) return;
        const nd = alive[alive.length - 1]; nd.alive = false; nd.cache = new Map(); paintCache();
        hud2.set(S.arch === 'disaggregated-object-store' ? `compute ${nd.i + 1} killed: NOTHING lost (WAL service + S3 hold all state); LB routes elsewhere` :
          S.arch === 'shared-nothing' ? `node ${nd.i + 1} killed: its partitions must be re-replicated from peers (hours); until then, reduced redundancy` :
          `node ${nd.i + 1} killed: survivors replay its redo thread from shared log, locks remastered`, C.red);
      }
      function revive() { S.nodes.forEach(n => { n.alive = true; }); paintCache(); }

      hud = kit.text('last: -', { size: 0.4 }, [0, 8.9, 0]);
      hud2 = kit.text('', { size: 0.38, color: C.yellow }, [0, -6.3, 0]);
      statText = kit.text('', { size: 0.3 }, [0, 9.4, 0]);
      let ar = 0;
      rebuild();
      hud2.set('Try: Read query / Write (commit) / drag Compute nodes up (scale-out) / Cold-start', C.dim);

      const setArch = (a) => { S.arch = a; S.lat = []; rebuild(); hud.set('last: -', C.text); };
      const doit = (k, v) => ({ read: readQuery, write: writeQuery, cold: coldStart, kill, revive }[k] || (() => k === 'n' && setN(v)))();
      cur = { do: doit, setArch };
      return {
        group,
        update(dt) {
          kit.update(dt);
          ar += dt;
          if (S.rebal) {
            S.rebal.p += dt * 0.08; // sim progress
            S.rebalBar && S.rebalBar.scale.set(Math.max(0.01, 12 * Math.min(1, S.rebal.p)), 0.35, 0.3);
            S.rebalBar && S.rebalBar.position.set(-6 + 6 * Math.min(1, S.rebal.p), -5.2, 0);
            if (Math.floor(ar * 4) !== Math.floor((ar - dt) * 4)) { const from = S.nodes[Math.floor(Math.random() * (S.n - 1))]; if (from) kit.send([from.x, 0.4, 0], [S.rebal.nd.x, 0.4, 0], { color: C.yellow, dur: 0.9, size: 0.18, arc: 0.6 }); }
            if (S.rebal.p >= 1) { S.rebal = null; hud2.set('rebalance finished - only now does the new node carry load', C.green); }
          }
        },
        dispose() { if (cur && cur.setArch === setArch) cur = null; kit.dispose(); },
        onConfigChange(cfg) { const a = cfg['storage-architecture']; if (a && a !== S.arch && ARCH[a]) setArch(a); },
        steps: [
          { title: 'Shared-nothing', text: 'Each node = CPU + local disk partition. Data and compute are coupled: replication goes node to node.', run() { setArch('shared-nothing'); } },
          { title: 'Shared-disk', text: 'All nodes mount one volume. No data movement to scale, but a global lock manager keeps caches coherent.', run() { setArch('shared-disk'); readQuery(); kit.after(1.5, readQuery); } },
          { title: 'Disaggregated', text: 'Stateless compute + WAL service + page servers + S3. The log is the database.', run() { setArch('disaggregated-object-store'); } },
          { title: 'Write = ship log only', text: 'Commit waits for a 2/3 quorum of safekeepers; no page flush/checkpoint on compute. Page servers replay asynchronously.', run() { setArch('disaggregated-object-store'); writeQuery(); kit.after(0.5, writeQuery); } },
          { title: 'Read path & cache miss', text: 'Local hit 0.1 ms; miss -> page server 1.5 ms; page server miss -> S3 ~35 ms.', run() { setArch('disaggregated-object-store'); S.psCache.clear(); for (let i = 0; i < 4; i++) kit.after(i * 1.0, readQuery); } },
          { title: 'Elastic scale-out', text: 'Add compute in ~1 s with zero data copy. Compare with shared-nothing rebalance.', run() { setArch('disaggregated-object-store'); S.n = 2; rebuild(); kit.after(0.3, () => setN(4)); } },
          { title: 'Cold start', text: 'A fresh node has an empty cache: first queries pay the miss latency until it warms.', run() { setArch('disaggregated-object-store'); coldStart(); } },
        ],
      };
    },
    controls: [
      { id: 'arch', label: 'Architecture', type: 'select', value: 'disaggregated-object-store', options: ARCH_IDS.map(a => ({ value: a, label: ARCH[a].title })), onChange(v, api) { cur && cur.setArch(v); } },
      { id: 'read', label: 'Read query', type: 'button', onChange(v, api) { cur && cur.do('read'); } },
      { id: 'write', label: 'Write (commit)', type: 'button', onChange(v, api) { cur && cur.do('write'); } },
      { id: 'nodes', label: 'Compute nodes', type: 'range', min: 1, max: 5, value: 3, onChange(v, api) { cur && cur.do('n', v); } },
      { id: 'cold', label: 'Cold-start node', type: 'button', onChange(v, api) { cur && cur.do('cold'); } },
      { id: 'kill', label: 'Kill compute', type: 'button', onChange(v, api) { cur && cur.do('kill'); } },
      { id: 'revive', label: 'Revive all', type: 'button', onChange(v, api) { cur && cur.do('revive'); } },
    ],
  },
};
