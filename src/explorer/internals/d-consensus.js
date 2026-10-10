// consensus view: Raft (leader election, log replication, partitions) with Multi-Paxos and primary-backup contrasts.
import * as THREE from 'three';
import { makeKit, C } from './_dist-kit.js';

let cur = null;
const N = 5, CELLS = 12;
const TERM_COL = ['#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7', '#2ac3de', '#ff9e64', '#f7768e', '#c0caf5'];
const HB = 1.0, TMIN = 3.2, TMAX = 6.4, LAT = 0.55;

const NAMES = {
  raft: { rv: 'RequestVote', rvr: 'Vote', ae: 'AppendEntries', aer: 'AE-reply', leader: 'LEADER', cand: 'CANDIDATE' },
  'multi-paxos': { rv: 'Prepare(n)', rvr: 'Promise', ae: 'Accept(slot)', aer: 'Accepted', leader: 'DIST. PROPOSER', cand: 'PROPOSER p1' },
  'none-primary-backup': { rv: '-', rvr: '-', ae: 'replicate', aer: 'ack', leader: 'PRIMARY', cand: '-' },
};
const INFO = {
  raft: `<b>Raft</b> (etcd, Consul, CockroachDB, TiKV, YugabyteDB). Strong leader. A follower whose <i>randomized election timeout</i> (150-300 ms real; animation is ~20x slower) fires becomes a candidate, bumps <b>term</b>, votes for itself and sends <b>RequestVote</b>. Majority (3/5) wins. Voters only grant to a candidate whose log is at least as up-to-date (lastLogTerm, lastLogIndex) - that guarantees the leader has every committed entry.<br>
<b>AppendEntries</b> doubles as heartbeat. An entry is <b>committed</b> once stored on a majority <i>and</i> belongs to the leader's current term; followers learn <code>commitIndex</code> via later AppendEntries. A conflicting follower suffix is overwritten.`,
  'multi-paxos': `<b>Multi-Paxos</b> (Spanner, Chubby, Megastore): the same quorum idea, decomposed differently. <b>Phase 1 (Prepare/Promise)</b> with ballot n is run <i>once</i> to establish a distinguished proposer; then each log slot costs only <b>Phase 2 (Accept/Accepted)</b>: 1 RTT. Promises carry previously accepted values and the new proposer must re-propose the highest-ballot value per slot (the demo adopts the most advanced promise's log). Unlike Raft, voters grant Prepare regardless of log recency and logs may have gaps/commit out of order.`,
  'none-primary-backup': `<b>Primary-backup without consensus</b> (classic MySQL/Redis sentinel-less setups): a fixed primary ships its log to backups; there are <b>no terms or votes</b>. If the primary dies nothing happens until an operator or external monitor promotes a backup. If that monitor is wrong (partition!) there are <b>two primaries = split brain</b>, and both sides accept writes that cannot be merged. Press "Manual promote" during a partition to see it.`,
};

export const views = {
  consensus: {
    build(ctx) {
      const kit = makeKit(ctx); const { group } = kit;
      let mode = ctx.config.consensus || 'raft';
      const nodes = [];
      let part = null; // set of ids in minority group
      const events = [];
      let hud, status;
      const ev = (s) => { events.unshift(s); if (events.length > 7) events.pop(); ctx.onInfo && ctx.onInfo(INFO[mode] + '<hr style="border-color:#334"><div style="font:11px monospace">' + events.map(e => e).join('<br>') + '</div>'); };
      const rnd = () => TMIN + Math.random() * (TMAX - TMIN);
      const px = (i) => (i - 2) * 4.3;
      const nm = () => NAMES[mode] || NAMES.raft;
      const pbMode = () => mode === 'none-primary-backup';

      for (let i = 0; i < N; i++) {
        const x = px(i);
        const n = { id: i, x, alive: true, term: 0, voted: null, state: 'F', log: [], commit: 0, deadline: 0, votes: 0, best: null,
          next: Array(N).fill(1), match: Array(N).fill(0), nextHB: 0, timeoutDur: 0 };
        n.box = kit.box(3, 1.3, 1.3, 0x3b5a96, [x, 3, 0]);
        n.label = kit.text('', { size: 0.34 }, [x, 4.1, 0]);
        n.stateT = kit.text('', { size: 0.3, color: C.text }, [x, 3, 0.8]);
        n.plate = kit.box(4, 0.06, 2.6, 0x7a2030, [x, 0.1, 0]); n.plate.visible = false;
        n.bar = kit.box(2.6, 0.12, 0.12, C.yellow ? 0xe0af68 : 0, [x, 2.15, 0.5]);
        n.cells = []; for (let c = 0; c < CELLS; c++) n.cells.push(kit.box(0.27, 0.5, 0.3, 0x1b2033, [x - 1.65 + c * 0.3, 1.1, 0]));
        n.logT = kit.text('', { size: 0.26, color: C.dim }, [x, 0.5, 0.2]);
        nodes.push(n);
      }
      hud = kit.text('', { size: 0.46 }, [0, 8.6, 0]);
      status = kit.text('', { size: 0.34, color: C.dim }, [0, -1.6, 0]);
      kit.text('log cells coloured by term; dim = uncommitted, bright = committed (idx <= commitIndex)', { size: 0.3, color: C.dim }, [0, -0.8, 0]);
      TERM_COL.forEach((c, i) => { kit.box(0.3, 0.3, 0.3, c, [-5.6 + i * 1.4, -2.6, 0]); kit.text('T' + (i + 1 === 8 ? '8+' : i + 1), { size: 0.3, color: c }, [-5.6 + i * 1.4 + 0.55, -2.6, 0]); });

      const grp = (i) => (part && part.has(i) ? 1 : 0);
      const lastIdx = (n) => n.log.length;
      const lastTerm = (n) => (n.log.length ? n.log[n.log.length - 1] : 0);
      const leaders = () => nodes.filter(n => n.alive && n.state === 'L');
      const majority = Math.floor(N / 2) + 1;

      function net(from, to, type, payload, col, size = 0.2) {
        if (!nodes[from].alive) return;
        const cut = grp(from) !== grp(to);
        const d = Math.abs(from - to);
        kit.send([px(from), 3.7, 0.2], [px(to), 3.7, 0.2], { color: cut ? C.red : col, dur: LAT * (0.6 + d * 0.25), arc: 1.0 + d * 0.5, size, drop: cut ? 0.55 : undefined,
          onArrive: () => { if (nodes[to].alive) recv(to, from, type, payload); } });
      }
      const resetTimer = (n) => { n.timeoutDur = rnd(); n.deadline = kit.t + n.timeoutDur; };

      function becomeFollower(n, term) { if (term > n.term) { n.term = term; n.voted = null; } n.state = 'F'; }
      function startElection(n) {
        n.state = 'C'; n.term++; n.voted = n.id; n.votes = 1; n.best = null; resetTimer(n);
        ev(`t=${kit.t.toFixed(1)} S${n.id + 1} timeout -> ${nm().cand} term ${n.term}`);
        for (const o of nodes) if (o !== n) net(n.id, o.id, 'rv', { term: n.term, li: lastIdx(n), lt: lastTerm(n) }, C.yellow);
      }
      function becomeLeader(n) {
        n.state = 'L'; n.next.fill(lastIdx(n) + 1); n.match.fill(0); n.match[n.id] = lastIdx(n); n.nextHB = 0;
        if (mode === 'multi-paxos' && n.best) n.log = n.best.slice();
        ev(`<b>S${n.id + 1} becomes ${nm().leader} (term ${n.term})</b>` + (mode === 'multi-paxos' ? ' - phase 1 done once; now only Accept per slot' : ''));
        broadcast(n);
      }
      function sendAE(n, j) {
        const ni = n.next[j]; const prev = ni - 1;
        net(n.id, j, 'ae', { term: n.term, prev, prevTerm: prev > 0 ? n.log[prev - 1] || 0 : 0, entries: n.log.slice(ni - 1), commit: n.commit, from: n.id }, n.log.length >= ni ? C.blue : '#566',
          n.log.length >= ni ? 0.26 : 0.14);
      }
      function broadcast(n) { n.nextHB = kit.t + HB; for (const o of nodes) if (o !== n) sendAE(n, o.id); }

      function advanceCommit(n) {
        if (pbMode()) { // all reachable alive backups must ack
          let m = lastIdx(n); for (const o of nodes) if (o !== n && o.alive && grp(o.id) === grp(n.id)) m = Math.min(m, n.match[o.id]);
          if (m > n.commit) n.commit = m; return;
        }
        for (let idx = lastIdx(n); idx > n.commit; idx--) {
          let c = 0; for (let j = 0; j < N; j++) if (n.match[j] >= idx) c++;
          if (c >= majority && (n.log[idx - 1] === n.term || mode === 'multi-paxos')) { n.commit = idx; ev(`S${n.id + 1} COMMIT idx ${idx} (term ${n.log[idx - 1]}): on ${c}/${N} nodes`); break; }
        }
      }

      function recv(to, from, type, m) {
        const n = nodes[to];
        if (pbMode()) {
          if (type === 'ae') { if (n.state === 'L') { /* split brain: ignores */ return; }
            n.log = m.entries.length || m.prev === 0 ? n.log.slice(0, m.prev).concat(m.entries) : n.log; n.commit = Math.min(m.commit, n.log.length);
            net(to, from, 'aer', { ok: true, match: m.prev + m.entries.length, from: to }, C.green, 0.16);
          } else if (type === 'aer' && n.state === 'L') { n.match[m.from] = Math.max(n.match[m.from], m.match); n.next[m.from] = n.match[m.from] + 1; advanceCommit(n); }
          return;
        }
        if (m.term > n.term) { if (n.state === 'L') ev(`S${to + 1} sees term ${m.term} > ${n.term}: <b>steps down</b>`); becomeFollower(n, m.term); }
        if (type === 'rv') {
          const upToDate = mode === 'multi-paxos' || m.lt > lastTerm(n) || (m.lt === lastTerm(n) && m.li >= lastIdx(n));
          const grant = m.term === n.term && (n.voted === null || n.voted === from) && upToDate;
          if (grant) { n.voted = from; resetTimer(n); }
          net(to, from, 'rvr', { term: n.term, grant, log: mode === 'multi-paxos' ? n.log.slice() : null, from: to }, grant ? C.green : C.red, 0.16);
        } else if (type === 'rvr') {
          if (n.state !== 'C' || m.term !== n.term || !m.grant) return;
          n.votes++; if (m.log && (!n.best || m.log.length > n.best.length || (m.log.length === n.best.length && m.log[m.log.length - 1] > n.best[n.best.length - 1]))) n.best = m.log;
          if (mode === 'multi-paxos' && !n.best) n.best = n.log;
          if (n.votes >= majority) becomeLeader(n);
        } else if (type === 'ae') {
          if (m.term < n.term) { net(to, from, 'aer', { term: n.term, ok: false, from: to, match: 0 }, C.red, 0.16); return; }
          n.state = 'F'; resetTimer(n);
          if (m.prev > n.log.length || (m.prev > 0 && n.log[m.prev - 1] !== m.prevTerm)) { net(to, from, 'aer', { term: n.term, ok: false, from: to, match: 0 }, C.red, 0.16); return; }
          let k = 0;
          for (; k < m.entries.length; k++) { const i = m.prev + k; if (i < n.log.length && n.log[i] !== m.entries[k]) { n.log.length = i; ev(`S${to + 1} overwrites conflicting suffix from idx ${i + 1}`); } if (i >= n.log.length) break; }
          for (; k < m.entries.length; k++) n.log.push(m.entries[k]);
          const lastNew = m.prev + m.entries.length;
          if (m.commit > n.commit) n.commit = Math.min(m.commit, lastNew);
          net(to, from, 'aer', { term: n.term, ok: true, match: lastNew, from: to }, C.green, 0.16);
        } else if (type === 'aer') {
          if (n.state !== 'L' || m.term !== n.term) return;
          if (m.ok) { n.match[m.from] = Math.max(n.match[m.from], m.match); n.next[m.from] = n.match[m.from] + 1; advanceCommit(n); }
          else { n.next[m.from] = Math.max(1, n.next[m.from] - 1); sendAE(n, m.from); }
        }
      }

      function clientWrite(target) {
        let n = target === 'auto' ? leaders().sort((a, b) => b.term - a.term)[0] : nodes[+target];
        if (!n || !n.alive) { hud.set('client write FAILED: no reachable leader (election in progress or quorum lost)', C.red); return; }
        if (n.state !== 'L') { hud.set(`S${n.id + 1} is not leader -> client must redirect`, C.red); return; }
        n.log.push(n.term); n.match[n.id] = lastIdx(n);
        ev(`client write -> S${n.id + 1} (term ${n.term}) appended idx ${lastIdx(n)}` + (grp(n.id) !== (leaders()[0] ? 0 : 0) && part && part.has(n.id) ? ' <span style="color:#f7768e">[minority side: can never commit]</span>' : ''));
        kit.send([n.x, 6.2, 0], [n.x, 3.7, 0], { color: C.orange, dur: 0.5, label: 'write', size: 0.24 });
        broadcast(n);
      }
      function killNode(i) {
        const n = nodes[i]; if (!n.alive) return; n.alive = false; ev(`<span style="color:#f7768e">S${i + 1} (${n.state === 'L' ? 'LEADER' : 'follower'}) crashed</span>`);
      }
      function reviveNode(i) { const n = nodes[i]; if (n.alive) return; n.alive = true; n.state = 'F'; resetTimer(n); ev(`S${i + 1} restarted (log persisted, term ${n.term})`); }
      function targetKill() { const l = leaders().sort((a, b) => b.term - a.term)[0]; killNode(l ? l.id : 0); }
      function partitionToggle(on) {
        if (on === false || (on === undefined && part)) { part = null; ev('<b>partition healed</b>'); return; }
        const l = leaders()[0] || nodes[0]; const other = (l.id + 1) % N; part = new Set([l.id, other]);
        ev(`<b>PARTITION</b> {S${l.id + 1},S${other + 1}} | {rest}: minority holds ${l.state === 'L' ? 'the old leader' : 'S' + (l.id + 1)}`);
      }
      function manualPromote() {
        const t = nodes.find(n => n.alive && n.state !== 'L' && (!part || part.has(n.id) === false)) || nodes.find(n => n.alive && n.state !== 'L'); if (!t) return;
        t.state = 'L'; t.next.fill(lastIdx(t) + 1); t.match.fill(0); t.match[t.id] = lastIdx(t); ev(`operator/monitor promotes S${t.id + 1} to primary - old primary may still be alive: <span style="color:#f7768e">SPLIT BRAIN?</span>`);
      }
      function reset(newMode) {
        if (newMode) mode = newMode; part = null; events.length = 0;
        kit.clearTimers();
        nodes.forEach(n => { n.alive = true; n.term = pbMode() ? 1 : 0; n.voted = null; n.state = 'F'; n.log = []; n.commit = 0; n.next.fill(1); n.match.fill(0); resetTimer(n); n.nextHB = 0; });
        if (pbMode()) { nodes[0].state = 'L'; nodes[0].match.fill(0); nodes.forEach(n => n.deadline = 1e9); }
        ev('cluster (re)started: all followers, empty logs' + (pbMode() ? '; S1 is the configured primary' : ''));
      }
      reset();
      cur = { write: clientWrite, kill: killNode, killLeader: targetKill, revive: reviveNode, partition: partitionToggle, promote: manualPromote, reset, reviveAll: () => nodes.forEach(n => reviveNode(n.id)) };

      function paint() {
        const lead = leaders().sort((a, b) => b.term - a.term)[0];
        nodes.forEach((n, i) => {
          const col = !n.alive ? 0x2a2a30 : n.state === 'L' ? 0x2f8f4a : n.state === 'C' ? 0xb08a2a : 0x3b5a96;
          kit.setColor(n.box, col);
          n.label.set(`S${i + 1}${n.alive ? '' : '  DEAD'}`, n.alive ? C.text : C.red);
          n.stateT.set(n.alive ? `${n.state === 'L' ? nm().leader : n.state === 'C' ? nm().cand : 'follower'}${pbMode() ? '' : '  term ' + n.term}` : 'crashed', n.alive ? C.text : C.dim);
          n.plate.visible = !!(part && part.has(i));
          const start = Math.max(0, n.log.length - CELLS);
          n.cells.forEach((cell, c) => {
            const idx = start + c; const t = n.log[idx];
            if (t === undefined) { kit.setColor(cell, 0x1b2033); return; }
            cell.material.color.set(TERM_COL[(t - 1) % 8]); if (idx + 1 > n.commit) cell.material.color.multiplyScalar(0.38);
          });
          n.logT.set(`last=${n.log.length} commit=${n.commit}` + (start ? ' (older scrolled)' : ''), C.dim);
          const rem = n.alive && n.state !== 'L' && !pbMode() ? Math.max(0, Math.min(1, (n.deadline - kit.t) / n.timeoutDur)) : 0;
          n.bar.scale.set(Math.max(0.001, 2.6 * rem), 0.12, 0.12); n.bar.position.x = n.x - 1.3 + 1.3 * rem;
        });
        const aliveN = nodes.filter(n => n.alive).length;
        const ls = leaders();
        hud.set(ls.length > 1 ? `${ls.length} nodes think they lead (terms ${ls.map(l => l.term).join(',')})` : lead ? `leader: S${lead.id + 1}  term ${lead.term}  commitIndex ${lead.commit}` : pbMode() ? 'no primary - nobody promotes automatically' : 'no leader - election in progress',
          ls.length > 1 ? C.red : lead ? C.green : C.yellow);
        status.set(`${aliveN}/${N} nodes alive, quorum = ${majority}` + (aliveN < majority ? '  -> NO QUORUM, no writes can commit' : ''), aliveN < majority ? C.red : C.dim);
      }

      return {
        group,
        update(dt) {
          kit.update(dt);
          const now = kit.t;
          for (const n of nodes) {
            if (!n.alive) continue;
            if (n.state === 'L') { if (now >= n.nextHB) broadcast(n); }
            else if (!pbMode() && now >= n.deadline) startElection(n);
          }
          paint();
        },
        dispose() { if (cur && cur.write === clientWrite) cur = null; kit.dispose(); },
        onConfigChange(cfg) { const m = cfg.consensus; if (m && m !== mode && NAMES[m]) reset(m); },
        steps: [
          { title: 'Everyone is a follower', text: 'Each node has a randomized election timeout (the shrinking yellow bar). Heartbeats from a leader reset it.', run() { reset('raft'); } },
          { title: 'Election', text: 'The first timeout fires: candidate bumps term, votes for itself, sends RequestVote; a majority makes it leader.', run() { reset('raft'); cur.reviveAll(); } },
          { title: 'Replicate a write', text: 'Client write is appended to the leader log, sent via AppendEntries; commit index advances when 3/5 hold it.', run() { cur.write('auto'); kit.after(0.5, () => cur.write('auto')); } },
          { title: 'Crash the leader', text: 'Followers stop receiving heartbeats; a new election in a higher term. Committed entries survive because voters demand an up-to-date log.', run() { cur.killLeader(); } },
          { title: 'Partition', text: 'Isolate old leader + 1 node. The minority leader accepts writes but can never reach quorum; the majority elects a new leader.', run() { cur.reviveAll(); cur.partition(true); kit.after(0.6, () => cur.write('auto')); } },
          { title: 'Heal', text: 'The stale leader sees a higher term, steps down, and its uncommitted suffix is overwritten.', run() { cur.partition(false); } },
          { title: 'Compare: Multi-Paxos / primary-backup', text: 'Use the config consensus option (multi-paxos, none-primary-backup) to change protocol labels and rules.', run() { reset('multi-paxos'); } },
        ],
      };
    },
    controls: [
      { id: 'write', label: 'Client write (to leader)', type: 'button', onChange() { cur && cur.write('auto'); } },
      { id: 'write-stale', label: 'Write to S1 (maybe stale)', type: 'button', onChange() { cur && cur.write(0); } },
      { id: 'kill-leader', label: 'Kill leader', type: 'button', onChange() { cur && cur.killLeader(); } },
      { id: 'kill-node', label: 'Kill node', type: 'select', value: '', options: [{ value: '', label: 'Kill / revive node...' }, ...[1, 2, 3, 4, 5].map(i => ({ value: 'k' + (i - 1), label: 'Kill S' + i })), ...[1, 2, 3, 4, 5].map(i => ({ value: 'r' + (i - 1), label: 'Revive S' + i }))],
        onChange(v) { if (!cur || !v) return; (v[0] === 'k' ? cur.kill : cur.revive)(+v.slice(1)); } },
      { id: 'partition', label: 'Partition on/off', type: 'toggle', value: false, onChange(v) { cur && cur.partition(!!v); } },
      { id: 'promote', label: 'Manual promote (primary-backup)', type: 'button', onChange() { cur && cur.promote(); } },
      { id: 'reset', label: 'Reset cluster', type: 'button', onChange() { cur && cur.reset(); } },
    ],
  },
};
