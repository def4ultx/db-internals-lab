// replication view: primary + 4 replicas, sync / semi-sync / async / quorum, statement vs row vs physical log.
import { makeKit, C } from './_dist-kit.js';

let cur = null;
const NR = 5; // node 0 = initial primary, 1..4 replicas
const D = [0, 0.25, 0.5, 1.0, 30]; // one-way network ms: same rack, same AZ, other AZ, other region
const ZONE = ['', 'same rack', 'same AZ', 'other AZ', 'other region (30 ms)'];
const FSYNC_P = 0.5, FSYNC_R = 0.3;
const MODES = ['sync', 'semi-sync', 'async', 'quorum-raft'];
const need = (mode, nReplicas) => ({ sync: nReplicas, 'semi-sync': 1, async: 0, 'quorum-raft': Math.floor((nReplicas + 1) / 2) + 1 - 1 }[mode]);
const vis = (ms) => 0.3 + 0.4 * Math.log2(1 + ms * 2);

const FMT = {
  statement: {
    title: 'Statement-based (MySQL binlog_format=STATEMENT)', bytes: 62,
    entry: (t) => `QUERY  GTID ${t.gtid}\n  BEGIN; UPDATE acct SET bal=bal-10, ts=NOW() WHERE id=${t.id};`,
    note: 'Tiny log, but NON-DETERMINISTIC: NOW(), RAND(), UUID(), LIMIT-without-ORDER, triggers can make replicas diverge. Replica re-executes the SQL (SQL applier thread).',
    pipe: ['binlog dump thread', 'relay log', 'SQL applier thread'],
  },
  'row-binlog': {
    title: 'Row-based (MySQL binlog_format=ROW)', bytes: 118,
    entry: (t) => `GTID ${t.gtid}\n  TABLE_MAP acct; UPDATE_ROWS pk=${t.id}\n  before(bal=100, ts=T0) after(bal=90, ts=T1)`,
    note: 'Logs the row images (full or minimal binlog_row_image), so replay is deterministic regardless of functions. Larger for bulk updates; enables CDC (Debezium) and parallel appliers via writeset deps.',
    pipe: ['binlog dump thread', 'relay log', 'SQL applier thread'],
  },
  'physical-wal': {
    title: 'Physical WAL shipping (PostgreSQL streaming replication)', bytes: 142,
    entry: (t) => `LSN ${t.lsn}  XLOG heap/UPDATE\n  rel=16384 blk=${12 + t.id % 5} off=7 newtuple=24B (+FPI 8 KB after checkpoint)`,
    note: 'Byte-exact page-level redo: replica is a bit-for-bit copy replayed by the startup process (hot standby). Fast and deterministic, but same major version/arch only, and no selective/cross-version replication (use logical decoding for that).',
    pipe: ['walsender', 'walreceiver -> WAL file', 'startup (redo) process'],
  },
};

const MODE_INFO = {
  sync: 'Synchronous: commit waits for <b>every</b> replica to flush. RPO = 0 but latency = slowest node (here the cross-region replica, ~61 ms) and any replica failure stalls writes.',
  'semi-sync': 'Semi-sync (MySQL rpl_semi_sync_master_wait_for_slave_count=1, AFTER_SYNC): commit waits for <b>1</b> replica to have the event in its relay log. Falls back to async after rpl_semi_sync_master_timeout (10 s). Acked txns survive primary loss; unacked in-flight ones may not.',
  async: 'Asynchronous: primary commits after its own fsync (~0.5 ms) and ships later. Lowest latency, but every acked txn not yet on a replica is lost on failover (RPO > 0 = replication lag).',
  'quorum-raft': 'Quorum / Raft-style: commit when a <b>majority</b> (3 of 5 nodes incl. primary) hold the entry. Tolerates 2 failures with RPO = 0 and latency = the 3rd-fastest node, not the slowest.',
};

export const views = {
  replication: {
    build(ctx) {
      const kit = makeKit(ctx); const { group } = kit;
      let mode = ctx.config.replication || 'semi-sync';
      let fmt = ctx.config['replication-log'] || 'row-binlog';
      let lagMs = 50; // applier lag
      const nodes = [];
      const txns = []; // {id,gtid,lsn,primaryAt:node,has:Set,applied:Set,committed,acked,lost}
      let primary = 0, nextId = 1, epoch = 0; let lastCommit = null; let lostCount = 0; let failoverMsg = '';
      const pos = (i) => i === 0 ? [-6.5, 2, 0] : [3.5, 6.3 - (i - 1) * 3.4, 0];
      // can't keep primary at fixed place after promotion: nodes keep their own position
      const sentinel = kit.text('', { size: 0.42 }, [0, 9.2, 0]);
      const panel = kit.text('', { size: 0.3, align: 'left', color: C.text }, [-9.5, -3.8, 0]);
      const hudT = kit.text('', { size: 0.34, color: C.dim }, [0, -7, 0]);

      for (let i = 0; i < NR; i++) {
        const p = pos(i);
        const n = { id: i, alive: true, p, has: new Set(), applied: new Set() };
        n.box = kit.box(i === 0 ? 3.4 : 3, 1.5, 1.2, 0x3b5a96, p);
        n.title = kit.text('', { size: 0.36 }, [p[0], p[1] + 1.25, 0.3]);
        n.sub = kit.text('', { size: 0.26, color: C.dim }, [p[0], p[1] - 1.1, 0.3]);
        n.cells = []; for (let c = 0; c < 10; c++) n.cells.push(kit.box(0.26, 0.4, 0.3, 0x1b2033, [p[0] - 1.35 + c * 0.3, p[1] - 0.15, 0.7]));
        n.pipeT = kit.text('', { size: 0.25, color: C.cyan }, [p[0], p[1] + 0.35, 0.7]);
        nodes.push(n);
      }
      const client = kit.box(1.8, 0.9, 0.9, 0x6b4a8a, [-10.2, 6.8, 0]); kit.text('client', { size: 0.34 }, [-10.2, 7.7, 0]);
      const livePrimary = () => nodes[primary];
      const replicasOf = () => nodes.filter(n => n.id !== primary);
      const liveReplicas = () => replicasOf().filter(n => n.alive);
      const delay = (i) => D[i];
      const col = (i) => ['', '', '', '', ''][i];

      function ackMs(i) { return FSYNC_P + 2 * D[i] + FSYNC_R; }
      function modeTable() {
        const acks = liveReplicas().map(n => ackMs(n.id)).sort((a, b) => a - b); const R = replicasOf().length;
        const t = {}; for (const m of MODES) { const k = need(m, R); t[m] = k === 0 ? FSYNC_P : (acks.length >= k ? acks[k - 1] : Infinity); }
        return t;
      }
      const f1 = (x) => (x === Infinity ? 'STALLED' : x < 10 ? x.toFixed(1) : x.toFixed(0)) + (x === Infinity ? '' : ' ms');

      function write() {
        const P = livePrimary(); if (!P.alive) { sentinel.set('primary is down - promote a replica (Failover) before writing', C.red); return; }
        const id = nextId++;
        const t = { id, gtid: `3E11FA47-71CA:${id}`, lsn: '0/' + (0x16B3A18 + id * 0x90).toString(16).toUpperCase(), src: primary, has: new Set([primary]), applied: new Set([primary]), committed: false, acked: false, lost: false, sent: 0, acks: new Set(), stallTimer: null, epoch };
        txns.push(t); P.has.add(id); P.applied.add(id);
        kit.send([-10.2, 6.8, 0], [P.p[0], P.p[1], 0], { color: C.orange, dur: 0.5, label: 'COMMIT', size: 0.2 });
        kit.after(0.5, () => { // primary flushes its log
          showEntry(t);
          const reps = replicasOf(); const k = need(mode, reps.length);
          if (k === 0) commit(t, FSYNC_P);
          for (const r of reps) {
            if (!r.alive) continue;
            kit.send([P.p[0], P.p[1], 0.2], [r.p[0], r.p[1], 0.2], { color: C.red, dur: vis(D[r.id]), size: 0.2, arc: 0.5, label: mode === 'async' && false ? '' : (fmt === 'statement' ? 'SQL' : fmt === 'row-binlog' ? 'rows' : 'WAL'),
              onArrive: () => {
                if (!P.alive || epoch !== t.epoch) return; // host lost: bytes still on the wire never land
                r.has.add(t.id); // relay log / WAL file flushed
                kit.after(Math.min(0.3, FSYNC_R), () => {
                  if (t.epoch === epoch || true) kit.send([r.p[0], r.p[1], 0.2], [P.p[0], P.p[1], 0.2], { color: C.green, dur: vis(D[r.id]), size: 0.14, arc: 0.4,
                    onArrive: () => { t.acks.add(r.id); check(t); } });
                });
                kit.after(lagMs / 200 + 0.4, () => { if (r.alive) r.applied.add(t.id); });
              } });
          }
          if (k > 0) { t.stallTimer = kit.after(vis(30) * 2 + 3, () => { if (!t.committed && mode === 'semi-sync' && P.alive) { commit(t, 10000, true); } }); }
        });
      }
      function check(t) {
        if (t.committed || t.lost) return; const P = livePrimary();
        const reps = replicasOf(); const k = need(mode, reps.length);
        if (t.acks.size >= k) {
          const arr = [...t.acks].map(ackMs).sort((a, b) => a - b); commit(t, k === 0 ? FSYNC_P : arr[k - 1]);
        }
      }
      function commit(t, ms, fallback) {
        if (t.committed) return; t.committed = true; t.acked = true; lastCommit = { id: t.id, ms };
        kit.send([livePrimary().p[0], livePrimary().p[1], 0.2], [-10.2, 6.8, 0], { color: C.green, dur: 0.5, size: 0.18, label: 'OK' });
        sentinel.set(`txn ${t.id} COMMITTED in ${f1(ms)} (${mode})` + (fallback ? ' - semi-sync TIMEOUT -> degraded to async!' : ''), fallback ? C.red : C.green);
      }
      function showEntry(t) {
        const f = FMT[fmt];
        panel.set(`log entry shipped (${fmt}, ~${f.bytes} B/txn):\n${f.entry(t)}\n\npipeline: primary ${f.pipe[0]} -> replica ${f.pipe[1]} -> ${f.pipe[2]}`, C.text);
      }
      function failPrimary() {
        const P = livePrimary(); if (!P.alive) return; P.alive = false;
        const reps = liveReplicas(); const best = reps.sort((a, b) => b.has.size - a.has.size)[0];
        sentinel.set(`PRIMARY CRASHED - detecting failure (~2 s)...`, C.red);
        kit.after(2.2, () => {
          if (!best) { sentinel.set('no replica left', C.red); return; }
          const lost = txns.filter(t => t.acked && !t.lost && !best.has.has(t.id));
          const unacked = txns.filter(t => !t.acked && !t.lost && !best.has.has(t.id));
          lost.forEach(t => { t.lost = true; }); unacked.forEach(t => { t.lost = true; });
          lostCount += lost.length; epoch++; primary = best.id;
          failoverMsg = `failover -> node ${best.id} (most advanced, ${best.has.size} txns)\nLOST ${lost.length} ACKED + ${unacked.length} unacked txn(s)`;
          sentinel.set(failoverMsg, lost.length ? C.red : C.green);
          // replicas that lack stuff catch up from new primary
          liveReplicas().forEach(r => catchUp(r));
        });
      }
      function catchUp(r) {
        const P = livePrimary(); let k = 0;
        for (const t of txns) if (!t.lost && P.has.has(t.id) && !r.has.has(t.id)) {
          kit.after(0.15 * k++, () => kit.send([P.p[0], P.p[1], 0.2], [r.p[0], r.p[1], 0.2], { color: C.cyan, dur: vis(D[r.id]), size: 0.14, onArrive: () => { r.has.add(t.id); kit.after(0.3, () => r.applied.add(t.id)); } }));
        }
      }
      function toggleReplica(i) { const n = nodes[i]; if (i === primary) return; n.alive = !n.alive; if (n.alive) catchUp(n); sentinel.set(`replica ${i} ${n.alive ? 'back online - catching up from primary (GTID/LSN gap)' : 'DOWN'}`, n.alive ? C.green : C.red); }
      function resetAll() { kit.clearTimers(); txns.length = 0; nodes.forEach(n => { n.alive = true; n.has.clear(); n.applied.clear(); }); primary = 0; nextId = 1; epoch++; lostCount = 0; lastCommit = null; sentinel.set('reset', C.dim); panel.set(''); }

      function paint() {
        nodes.forEach((n, i) => {
          const isP = i === primary;
          kit.setColor(n.box, !n.alive ? 0x4a2a2a : isP ? 0x2f8f4a : 0x3b5a96);
          n.title.set(`${isP ? 'PRIMARY' : 'replica'} ${i}${n.alive ? '' : '  DOWN'}`, !n.alive ? C.red : isP ? C.green : C.text);
          const lag = Math.max(0, txns.filter(t => !t.lost && livePrimary().has.has(t.id)).length - n.applied.size);
          n.sub.set(isP ? `committed ${txns.filter(t => t.committed && !t.lost).length}, ${txns.filter(t => t.lost).length} lost` : `${ZONE[i] || ''}  recv ${n.has.size} / applied ${n.applied.size}  lag ${n.alive ? lag : '?'} txn`, C.dim);
          const f = FMT[fmt];
          n.pipeT.set(isP ? (fmt === 'physical-wal' ? 'WAL+walsender' : 'binlog+dump thr') : (fmt === 'physical-wal' ? 'walrecv->startup' : 'relay->SQL thr'), C.cyan);
          const vis10 = txns.slice(-10);
          n.cells.forEach((cell, c) => {
            const t = vis10[c]; if (!t) { kit.setColor(cell, 0x1b2033); return; }
            let color = 0x1b2033;
            if (t.lost && isP === false && !n.has.has(t.id)) color = 0x1b2033;
            if (n.has.has(t.id)) color = 0x4a7acf; if (n.applied.has(t.id)) color = 0x3fae5a;
            if (isP && !t.committed) color = 0xd0a030; if (t.lost && n.has.has(t.id)) color = 0xcc3040;
            kit.setColor(cell, color);
          });
        });
        const tb = modeTable();
        hudT.set(`commit latency right now (live replicas):  ${MODES.map(m => `${m}${m === mode ? '*' : ''} ${f1(tb[m])}`).join('   ')}\n` +
          `at-risk acked txns on primary only: ${txns.filter(t => t.acked && !t.lost && livePrimary().has.has(t.id) && replicasOf().every(r => !r.has.has(t.id))).length}   |   lost on failover so far: ${lostCount}   |   mode ${mode} / log ${fmt}`, C.dim);
      }
      sentinel.set('Press "Write" - mode: ' + mode, C.dim);
      const info = () => ctx.onInfo && ctx.onInfo(`<b>${mode}</b><br>${MODE_INFO[mode]}<hr style="border-color:#334"><b>${FMT[fmt].title}</b><br>${FMT[fmt].note}<hr style="border-color:#334">Replica lag: applier delay slider (${lagMs} ms). Reads from a lagging replica return stale data (read-your-writes violation) unless routed with GTID wait (WAIT_FOR_EXECUTED_GTID_SET) or LSN-based consistency.`);
      info();
      cur = { write, fail: failPrimary, toggle: toggleReplica, reset: resetAll, burst() { for (let i = 0; i < 4; i++) kit.after(i * 0.35, write); },
        setMode(m) { mode = m; info(); sentinel.set('mode -> ' + m, C.dim); }, setFmt(f) { fmt = f; info(); }, setLag(v) { lagMs = v; info(); } };
      return {
        group,
        update(dt) { kit.update(dt); paint(); },
        dispose() { if (cur && cur.write === write) cur = null; kit.dispose(); },
        onConfigChange(cfg) { if (cfg.replication && MODES.includes(cfg.replication) && cfg.replication !== mode) cur.setMode(cfg.replication); if (cfg['replication-log'] && FMT[cfg['replication-log']] && cfg['replication-log'] !== fmt) cur.setFmt(cfg['replication-log']); },
        steps: [
          { title: 'Primary ships its log', text: 'Every commit appends to the primary log (binlog with GTID or WAL with LSN) and streams it to replicas.', run() { cur.reset(); cur.write(); } },
          { title: 'Mode decides when to ack', text: 'Sync waits for all, semi-sync for 1, quorum for a majority, async for none. Compare the latency table.', run() { cur.reset(); cur.setMode('sync'); cur.write(); } },
          { title: 'Semi-sync', text: 'Commit returns when the nearest replica has the event in its relay log.', run() { cur.reset(); cur.setMode('semi-sync'); cur.write(); } },
          { title: 'Async + primary crash', text: 'Burst writes then kill the primary. Acked txns that did not reach a replica are lost.', run() { cur.reset(); cur.setMode('async'); cur.burst(); kit.after(0.9, () => cur.fail()); } },
          { title: 'Quorum survives', text: 'With a majority rule the promoted replica always has every acked txn.', run() { cur.reset(); cur.setMode('quorum-raft'); cur.burst(); kit.after(3.5, () => cur.fail()); } },
          { title: 'Replica lag', text: 'The applier (SQL thread / startup process) can trail the received log: stale reads.', run() { cur.reset(); cur.setLag(500); cur.setMode('async'); cur.burst(); } },
        ],
      };
    },
    controls: [
      { id: 'write', label: 'Write (commit txn)', type: 'button', onChange() { cur && cur.write(); } },
      { id: 'burst', label: 'Burst x4', type: 'button', onChange() { cur && cur.burst(); } },
      { id: 'mode', label: 'Mode', type: 'select', value: 'semi-sync', options: MODES.map(m => ({ value: m, label: m })), onChange(v) { cur && cur.setMode(v); } },
      { id: 'fmt', label: 'Log format', type: 'select', value: 'row-binlog', options: Object.keys(FMT).map(m => ({ value: m, label: m })), onChange(v) { cur && cur.setFmt(v); } },
      { id: 'lag', label: 'Applier lag (ms)', type: 'range', min: 0, max: 500, value: 50, onChange(v) { cur && cur.setLag(v); } },
      { id: 'fail-primary', label: 'Crash primary + failover', type: 'button', onChange() { cur && cur.fail(); } },
      { id: 'toggle-r4', label: 'Toggle replica 4 (far)', type: 'button', onChange() { cur && cur.toggle(4); } },
      { id: 'toggle-r1', label: 'Toggle replica 1', type: 'button', onChange() { cur && cur.toggle(1); } },
      { id: 'reset', label: 'Reset', type: 'button', onChange() { cur && cur.reset(); } },
    ],
  },
};
