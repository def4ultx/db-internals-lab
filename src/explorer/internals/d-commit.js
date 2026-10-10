// distributed-commit view: 2PC (+Spanner Paxos groups), 3PC, Percolator, Calvin, single-node. Simulated message state machines.
import * as THREE from 'three';
import { makeKit, C } from './_dist-kit.js';

const HOP = 0.7;            // sim seconds per one-way message
const TO = 4.5;             // timeout (sim seconds)
const STC = { INIT: '#d5d9ee', IDLE: '#d5d9ee', PREPARED: C.yellow, WAIT: C.yellow, PRECOMMIT: C.orange, COMMITTED: C.green, ABORTED: C.red, BLOCKED: C.red, CRASHED: '#565f89', END: C.green };
let cur = null;

function build(ctx) {
  const kit = makeKit(ctx);
  const root = new THREE.Group(); kit.group.add(root);
  const S = { spanner: false, crashCoord: false, crashPart: false, voteNo: false, drop: false, partition: false, percStage: 'after-primary-commit',
    msgs: 0, tDec: null, tEnd: null, t0: 0, outcome: 'idle', decision: null };
  let mode = (ctx.config && ctx.config['distributed-commit']) || 'two-phase-commit';
  let epoch = 0, H = {}, banner, M, partLine, nodes = [], pulse = [];
  const steps = [];
  const later = (d, fn) => { const ep = epoch; return kit.after(d, () => { if (ep === epoch) fn(); }); };
  const rtt = (t) => (t / (2 * HOP)).toFixed(1);
  const flash = (txt, pos, color = C.red, secs = 2) => {
    const h = kit.text(txt, { size: 0.42, color }, pos, root); const ep = epoch;
    kit.after(secs, () => { if (ep !== epoch) return; root.remove(h.sprite); h.sprite.material.map?.dispose(); h.sprite.material.dispose(); });
  };
  const wrap = (t, n = 62) => { const w = t.split(' '); const out = []; let l = ''; for (const x of w) { if ((l + ' ' + x).length > n && l) { out.push(l); l = x; } else l = l ? l + ' ' + x : x; } out.push(l); return out.join('\n'); };
  const say = (t, color = C.text) => banner && banner.set(wrap(t), color);

  function updM() {
    if (!M) return;
    const held = nodes.filter(n => n.locked || n.lock).length;
    const d = S.tDec != null ? rtt(S.tDec) + ' RTT' : '-', e = S.tEnd != null ? rtt(S.tEnd) + ' RTT' : '-';
    M.set(`messages: ${S.msgs}    decision durable: ${d}    fully done: ${e}\nlocks held: ${held}    outcome: ${S.outcome}`, S.outcome.startsWith('COMMIT') ? C.green : S.outcome.startsWith('ABORT') || S.outcome.startsWith('BLOCK') ? C.red : C.text);
  }
  function mkNode(name, x, y, w, h, color, withLock = false) {
    const n = { name, x, y, p: [x, y, 1.3], crashed: false, st: 'INIT', locked: false, log: [], base: new THREE.Color(color).multiplyScalar(0.6) };
    n.box = kit.box(w, h, 1.4, n.base, [x, y, 0], root);
    n.txt = kit.text(name + '\nINIT', { size: 0.42, color: C.dim }, [x, y, 0.78], root);
    if (withLock) { n.lockMesh = kit.box(0.5, 0.5, 0.5, C.red, [x + w / 2 - 0.05, y + h / 2 + 0.05, 0.4], root, { emissive: C.red, emissiveIntensity: 0.8 }); n.lockMesh.visible = false; pulse.push(n); n.lockTxt = null; }
    n.walT = kit.text('log: -', { size: 0.3, color: C.dim }, [x, y - h / 2 - 0.45, 0.4], root);
    nodes.push(n); return n;
  }
  function walAdd(n, rec) { n.log.push(rec); n.walT.set('log: ' + n.log.slice(-3).join(' > '), C.cyan); }
  function setSt(n, st) {
    n.st = st; n.txt.set(n.name + '\n' + st, STC[st] || C.text);
    kit.setColor(n.box, n.crashed ? 0x2a2e42 : n.base);
    if (st === 'BLOCKED') kit.glow(n.box, C.red, 0.18);
    if (n.lockMesh) n.lockMesh.visible = n.locked;
    updM();
  }
  function msg(a, b, label, color, fn, o = {}) {
    if (a.crashed) return; const ep = epoch; S.msgs++; updM();
    let drop;
    if (S.drop && !o.noDrop) { S.drop = false; drop = 0.55; flash('LOST', [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2 + 0.6, 1.5], C.red, 1.8); H.syncDrop && H.syncDrop(); }
    kit.send(a.p, b.p, { color, dur: o.dur ?? HOP, label, drop, size: 0.2, onArrive: () => { if (ep !== epoch || b.crashed) return; fn && fn(); } });
  }
  function replicate(n, cb) { // Paxos/Raft log write: leader -> replicas, majority ack
    if (!n.reps) { later(0.15, cb); return; }
    let done = false;
    n.reps.forEach(r => msg(n, r, 'log', C.cyan, () => { kit.glow(r.box, C.cyan, 0.7); msg(r, n, 'ack', C.cyan, () => { if (!done) { done = true; cb(); } }, { dur: HOP * 0.7, noDrop: true }); }, { dur: HOP * 0.7, noDrop: true }));
  }
  function addReps(n, offs, y) {
    n.reps = offs.map(dx => { const r = { p: [n.x + dx, y, 1.0] }; r.box = kit.box(1.5, 0.8, 0.8, C.cyan, [n.x + dx, y, 0], root, { transparent: true, opacity: 0.55 }); kit.text('replica', { size: 0.26, color: C.cyan }, [n.x + dx, y - 0.7, 0.3], root); return r; });
  }
  function frame(title, sub) {
    banner = kit.text('', { size: 0.46, color: C.text }, [0, 6.4, 0], root); say(title);
    M = kit.text('', { size: 0.36, color: C.text }, [0, -6.0, 0], root);
    if (sub) kit.text(sub, { size: 0.3, color: C.dim }, [0, 5.2, 0], root);
  }

  // ---------------------------------------------------------------- 2PC / 3PC
  function layout2pc(three) {
    frame(three ? '3PC: CAN-COMMIT -> PRE-COMMIT -> DO-COMMIT' : (S.spanner ? '2PC over Paxos groups (Spanner)' : '2PC: PREPARE -> VOTE -> COMMIT -> ACK'), null);
    const co = mkNode(S.spanner ? 'Coord (leader)' : 'Coordinator', 0, 3.4, 4.6, 1.9, C.purple);
    const parts = [0, 1, 2].map(i => mkNode('P' + (i + 1), [-7, 0, 7][i], -0.9, 4.2, 2.2, C.blue, true));
    parts.forEach(p => kit.segs([[co.x, co.y - 0.95, 0], [p.x, p.y + 1.1, 0]], C.line, {}, root));
    if (S.spanner && !three) { addReps(co, [-3.9, 3.9], 3.4); parts.forEach(p => addReps(p, [-1.3, 1.3], -4.3)); }
    partLine = kit.box(0.08, 9, 1.5, C.red, [-3.5, 0.5, 0], root, { transparent: true, opacity: 0.8, emissive: C.red, emissiveIntensity: 0.6 });
    partLine.visible = three && S.partition;
    let votes, decided, toTimer, acks;
    setSt(co, 'IDLE');

    function resetStates() {
      epoch++; kit.clearTimers(); S.msgs = 0; S.tDec = S.tEnd = null; S.outcome = 'idle'; S.decision = null;
      [co, ...parts].forEach(n => { n.crashed = false; n.locked = false; n.log = []; n.walT.set('log: -', C.dim); setSt(n, n === co ? 'IDLE' : 'INIT'); kit.glow(n.box, 0, 0); n.box.material.emissiveIntensity = 0; });
      if (S.crashPart) { parts[2].crashed = true; setSt(parts[2], 'CRASHED'); }
      decided = false; votes = {}; acks = 0; say(three ? '3PC: CAN-COMMIT -> PRE-COMMIT -> DO-COMMIT' : (S.spanner ? '2PC over Paxos groups (Spanner)' : '2PC: PREPARE -> VOTE -> COMMIT -> ACK'));
      updM();
    }
    H.reset = resetStates;
    H.run = () => {
      resetStates(); S.t0 = kit.t; S.outcome = 'running';
      const ep = epoch;
      setSt(co, three ? 'CAN-COMMIT?' : 'PREPARING'); walAdd(co, 'BEGIN');
      parts.forEach((p, i) => msg(co, p, three ? 'CAN-COMMIT?' : 'PREPARE', C.yellow, () => onPrepare(i)));
      toTimer = later(TO, () => { if (!decided) { flash('timeout: missing vote -> abort', [0, 1.6, 1.5], C.red, 2.5); decide(); } });
      updM();
    };
    function onPrepare(i) {
      const p = parts[i];
      if (S.voteNo && i === 1) { p.locked = false; setSt(p, 'ABORTED'); walAdd(p, 'ABORT'); msg(p, co, 'VOTE-NO', C.red, () => onVote(i, false)); return; }
      const go = () => { p.locked = true; setSt(p, three ? 'WAIT' : 'PREPARED'); walAdd(p, three ? 'CAN' : 'PREPARE'); msg(p, co, 'VOTE-YES', C.green, () => onVote(i, true)); };
      S.spanner ? replicate(p, go) : later(0.15, go);   // force-write prepare record (Spanner: replicate it to a Paxos majority)
    }
    function onVote(i, v) { votes[i] = v; if (Object.keys(votes).length === 3) { kit.cancel(toTimer); decide(); } }
    function decide() {
      if (decided) return; decided = true;
      const allYes = [0, 1, 2].every(i => votes[i] === true);
      if (!allYes) return doAbort();
      if (three) return precommit();
      setSt(co, 'DECIDED'); // log commit record: this is the commit point
      const logIt = () => {
        walAdd(co, 'COMMIT'); S.decision = 'commit'; S.tDec = kit.t - S.t0; S.outcome = 'COMMIT decided (logged)'; updM();
        if (S.crashCoord) { crashCoordinator(); return; }
        sendCommit();
      };
      S.spanner ? replicate(co, logIt) : later(0.15, logIt);
    }
    function sendCommit() {
      setSt(co, 'COMMITTING'); acks = 0;
      parts.forEach(p => msg(co, p, 'COMMIT', C.green, () => {
        const apply = () => { p.locked = false; setSt(p, 'COMMITTED'); walAdd(p, 'COMMIT'); msg(p, co, 'ACK', C.green, () => { if (++acks === parts.filter(q => !q.crashed).length) { setSt(co, 'END'); walAdd(co, 'END'); S.tEnd = kit.t - S.t0; S.outcome = 'COMMITTED'; say('COMMITTED: all participants applied + released locks', C.green); updM(); } }); };
        S.spanner ? replicate(p, apply) : later(0.1, apply);
      }));
    }
    function doAbort() {
      setSt(co, 'ABORTED'); walAdd(co, 'ABORT'); S.tDec = kit.t - S.t0; S.outcome = 'ABORTED';
      say('ABORT decided: ' + (Object.values(votes).includes(false) ? 'a participant voted NO' : 'vote missing (timeout)'), C.red);
      let n = 0; const live = parts.filter(p => !p.crashed && p.st !== 'ABORTED');
      if (!live.length) { S.tEnd = S.tDec; updM(); }
      live.forEach(p => msg(co, p, 'ABORT', C.red, () => { p.locked = false; setSt(p, 'ABORTED'); walAdd(p, 'ABORT'); msg(p, co, 'ACK', C.dim, () => { if (++n === live.length) { S.tEnd = kit.t - S.t0; setSt(co, 'END'); updM(); } }); }));
    }
    function crashCoordinator() {
      co.crashed = true; setSt(co, 'CRASHED'); flash('COORDINATOR CRASH', [0, 1.8, 1.5], C.red, 2.5);
      S.outcome = three ? 'coordinator down' : 'coordinator down (decision unknown to participants)'; updM();
      later(TO, three ? terminate3 : blockedCheck);
    }
    function blockedCheck() {
      const live = parts.filter(p => !p.crashed), prepared = live.filter(p => p.st === 'PREPARED');
      if (!prepared.length) return;
      if (live.some(p => p.st === 'ABORTED' || p.st === 'INIT')) {
        say('cooperative termination: a peer never prepared -> everyone aborts', C.yellow);
        prepared.forEach(p => { p.locked = false; setSt(p, 'ABORTED'); walAdd(p, 'ABORT'); }); S.outcome = 'ABORTED (termination)'; updM(); return;
      }
      prepared.forEach(p => setSt(p, 'BLOCKED'));
      S.outcome = 'BLOCKED';
      say('BLOCKED: every participant is PREPARED. Cannot abort (coordinator may have committed) nor commit. Locks held!', C.red); updM();
    }
    function precommit() {
      setSt(co, 'PRE-COMMIT'); walAdd(co, 'PRECOMMIT'); say('all voted YES -> PRE-COMMIT (everyone learns the outcome is commit)', C.orange);
      const targets = S.crashCoord ? [parts[0]] : parts; let a = 0;
      targets.forEach(p => msg(co, p, 'PRE-COMMIT', C.orange, () => {
        setSt(p, 'PRECOMMIT'); walAdd(p, 'PRECOMMIT');
        msg(p, co, 'ACK', C.orange, () => { if (++a === 3) { S.tDec = kit.t - S.t0; doCommit3(); } });
      }));
      if (S.crashCoord) later(HOP * 1.2, () => { crashCoordinator(); say('coordinator crashed after PRE-COMMIT reached only P1', C.red); });
    }
    function doCommit3() {
      setSt(co, 'DO-COMMIT'); let n = 0;
      parts.forEach(p => msg(co, p, 'DO-COMMIT', C.green, () => { p.locked = false; setSt(p, 'COMMITTED'); walAdd(p, 'COMMIT'); msg(p, co, 'HAVE-COMMITTED', C.green, () => { if (++n === 3) { setSt(co, 'END'); S.tEnd = kit.t - S.t0; S.outcome = 'COMMITTED'; say('COMMITTED after 3 round-trips (vs 2 for 2PC)', C.green); updM(); } }); }));
    }
    function terminate3() {
      const groups = S.partition ? [[0], [1, 2]] : [[0, 1, 2]]; const res = [];
      groups.forEach(g => {
        const live = g.map(i => parts[i]).filter(p => !p.crashed);
        const commit = live.some(p => p.st === 'PRECOMMIT' || p.st === 'COMMITTED');
        live.forEach(p => { p.locked = false; setSt(p, commit ? 'COMMITTED' : 'ABORTED'); walAdd(p, commit ? 'COMMIT' : 'ABORT'); });
        res.push(commit ? 'COMMIT' : 'ABORT');
      });
      if (res.length > 1 && res[0] !== res[1]) { S.outcome = 'ABORT/COMMIT SPLIT-BRAIN'; say('PARTITION: P1 (PRECOMMIT) commits, P2+P3 (uncertain) abort -> INCONSISTENT. 3PC is unsafe under partitions.', C.red); }
      else { S.outcome = res[0] === 'COMMIT' ? 'COMMITTED (termination)' : 'ABORTED (termination)'; say('timeout rule: any PRECOMMIT -> commit, else abort. Nobody blocks (no partitions assumed).', C.green); }
      updM();
    }
    H.crashNow = () => { if (co.crashed) return; if (S.outcome === 'idle') { flash('start a run first', [0, 1.6, 1.5], C.dim, 1.2); return; } decided = true; kit.cancel(toTimer); crashCoordinator(); };
    H.recover = () => {
      if (!co.crashed) return; co.crashed = false;
      if (three) { setSt(co, 'RECOVERED'); say('participants already terminated on their own (non-blocking)', C.green); return; }
      if (S.decision === 'commit') { say('coordinator recovered: log has COMMIT record -> re-sends COMMIT', C.green); setSt(co, 'RECOVERED'); S.crashCoord = false; sendCommit(); }
      else { setSt(co, 'RECOVERED'); say('no decision record -> presumed abort', C.yellow); doAbort(); }
    };
    H.flagChanged = () => { partLine.visible = three && S.partition; };
    resetStates();
  }

  // ---------------------------------------------------------------- Percolator
  function layoutPerc() {
    frame('Percolator: snapshot-isolation txns on a plain KV store (Bigtable)', 'columns per key: lock | write | data. Commit point = primary lock cleared + write record');
    const cl = mkNode('Client', -6.5, 3.6, 3.4, 1.4, C.purple); const tso = mkNode('TSO', 6.5, 3.6, 3.4, 1.4, C.yellow);
    setSt(cl, 'IDLE'); tso.txt.set('TSO\nnext ts: 7', C.yellow); tso.walT.set('', C.dim); cl.walT.set('', C.dim);
    let ctr = 7;
    const keys = ['A', 'B', 'C'].map((k, i) => {
      const x = [-7.2, 0, 7.2][i]; const n = { name: k, x, p: [x, -0.8, 1.7], crashed: false, lock: null, writes: [[3, 2]], data: [[2, 100]], prim: i === 0 };
      n.box = kit.box(5.6, 3.4, 1.2, i === 0 ? '#6b4a2a' : '#34406b', [x, -1.0, 0], root);
      n.txt = kit.text('', { size: 0.33, color: C.text }, [x, -1.0, 0.7], root); nodes.push(n); n.walT = { set() {} }; return n;
    });
    const render = (k) => {
      const w = k.writes.slice().sort((a, b) => b[0] - a[0]).slice(0, 2).map(x => `${x[0]}->@${x[1]}`).join(' | ');
      const d = k.data.slice().sort((a, b) => b[0] - a[0]).slice(0, 2).map(x => `${x[0]}:${x[1]}`).join(' | ');
      k.txt.set(`key ${k.name}${k.prim ? ' (PRIMARY)' : ''}\nlock : ${k.lock ? k.lock.ts + (k.lock.primary ? ' PRIMARY' : ' prim=A') : '-'}\nwrite: ${w}\ndata : ${d}`, k.lock ? C.yellow : C.text);
      k.box.material.emissiveIntensity = 0;
    };
    const P = { start: 0, commit: 0, crashedAt: null, dead: false };
    const getTs = (cb) => msg(cl, tso, 'get ts', C.yellow, () => { const t = ctr++; tso.txt.set('TSO\nnext ts: ' + ctr, C.yellow); msg(tso, cl, 'ts=' + t, C.yellow, () => cb(t)); });
    const crashClient = (why) => { cl.crashed = true; setSt(cl, 'CRASHED'); P.crashedAt = kit.t; flash('CLIENT CRASH (' + why + ')', [-6.5, 1.8, 1.5], C.red, 3); say('client died: ' + why + '. Locks stay behind; any reader must resolve them via the primary.', C.red); };
    H.reset = () => {
      epoch++; kit.clearTimers(); ctr = 7; S.msgs = 0; S.tDec = S.tEnd = null; S.outcome = 'idle'; P.crashedAt = null; cl.crashed = false;
      keys.forEach(k => { k.lock = null; k.writes = [[3, 2]]; k.data = [[2, 100]]; render(k); }); tso.txt.set('TSO\nnext ts: 7', C.yellow); setSt(cl, 'IDLE'); say('Percolator: snapshot-isolation txns on a plain KV store (Bigtable)'); updM();
    };
    const prewrite = (k, primary, cb) => msg(cl, k, 'prewrite', C.yellow, () => {
      if (k.lock || k.writes.some(w => w[0] > P.start)) { say(`write-write conflict on ${k.name}: ${k.lock ? 'locked by ts ' + k.lock.ts : 'newer write'} -> abort`, C.red); S.outcome = 'ABORTED'; updM(); kit.glow(k.box, C.red, 0.5); return; }
      k.data.push([P.start, ({ A: 90, B: 55, C: 55 })[k.name]]); k.lock = { ts: P.start, primary }; render(k); kit.glow(k.box, C.yellow, 0.2); updM(); cb();
    });
    const commitKey = (k, cb) => msg(cl, k, 'commit', C.green, () => { k.writes.push([P.commit, P.start]); k.lock = null; render(k); kit.glow(k.box, C.green, 0.2); updM(); cb && cb(); });
    H.run = () => {
      if (keys.some(k => k.lock)) { /* leftover locks from crashed txn are real conflicts */ }
      const hadLocks = keys.some(k => k.lock);
      S.msgs = 0; S.outcome = 'running'; cl.crashed = false; setSt(cl, 'RUNNING'); const ep = epoch; S.t0 = kit.t; S.tDec = S.tEnd = null; P.crashedAt = null;
      getTs((s) => {
        P.start = s; say(`start_ts=${s}: snapshot read point. Prewrite primary A first`, C.yellow);
        prewrite(keys[0], true, () => {
          say('primary locked; now secondaries B, C in parallel', C.yellow); let d = 0;
          [keys[1], keys[2]].forEach(k => prewrite(k, false, () => {
            if (++d < 2) return;
            if (S.crashCoord && S.percStage === 'after-prewrite') { crashClient('after prewrite, before commit'); S.outcome = 'txn UNDECIDED'; updM(); return; }
            getTs((c) => {
              P.commit = c; say(`commit_ts=${c}. COMMIT POINT: single-row atomic write on primary A`, C.green);
              commitKey(keys[0], () => {
                S.tDec = kit.t - S.t0; S.outcome = 'COMMITTED (primary)'; updM();
                if (S.crashCoord && S.percStage === 'after-primary-commit') { crashClient('after primary commit'); return; }
                setSt(cl, 'DONE'); say('user told COMMITTED; secondaries committed lazily', C.green);
                let e = 0; [keys[1], keys[2]].forEach(k2 => later(0.4, () => commitKey(k2, () => { if (++e === 2) { S.tEnd = kit.t - S.t0; S.outcome = 'COMMITTED'; updM(); } })));
              });
            });
          }));
        });
      });
      updM();
    };
    H.crashNow = () => { if (!cl.crashed) crashClient('manual'); };
    H.recover = () => { // a reader hits a leftover lock on B/C and resolves through the primary
      const stuck = keys.filter(k => !k.prim && k.lock); if (!stuck.length) { flash('no stray secondary locks', [0, 2, 1.5], C.dim, 1.5); return; }
      const rd = cl; rd.crashed = false; setSt(rd, 'READER');
      stuck.forEach(k => msg(rd, k, 'read', C.cyan, () => {
        say(`reader sees lock on ${k.name} (ts=${k.lock.ts}) -> checks primary A`, C.cyan);
        msg(k, keys[0], 'check primary', C.cyan, () => {
          const A = keys[0], w = A.writes.find(x => x[1] === k.lock.ts);
          if (w) { say(`primary A has write record @commit_ts=${w[0]} -> txn COMMITTED: roll FORWARD ${k.name}`, C.green); P.commit = w[0]; P.start = k.lock.ts; commitKey(k); S.outcome = 'COMMITTED (rolled forward)'; }
          else if (A.lock && A.lock.ts === k.lock.ts) {
            const age = P.crashedAt != null ? kit.t - P.crashedAt : 0;
            if (age < 3) { say(`primary still locked, owner may be alive (lock age ${age.toFixed(1)}s < TTL 3s): reader waits`, C.yellow); return; }
            say('primary locked & TTL expired -> txn never committed: roll BACK (erase locks+data)', C.red);
            [A, k].forEach(x => { x.lock = null; x.data = x.data.filter(d => d[0] !== w?.[1] && d[0] !== k.lock?.ts && d[0] !== P.start); render(x); }); S.outcome = 'ABORTED (rolled back)';
          }
          else { say('primary lock gone, no write -> already rolled back; clean up ' + k.name, C.red); k.lock = null; render(k); }
          updM();
        });
      }));
    };
    H.flagChanged = () => {}; keys.forEach(render); updM();
  }

  // ---------------------------------------------------------------- Calvin
  function layoutCalvin() {
    frame('Calvin: sequence first, then execute deterministically -- no 2PC', 'same input order on every replica => same state. Only remote-read data is exchanged.');
    const cli = mkNode('Clients', -9.2, 0, 2.6, 2.0, C.purple); setSt(cli, 'IDLE'); cli.walT.set('', C.dim);
    const seq = mkNode('Sequencer', -4.2, 0, 3.4, 3.4, C.yellow); seq.txt.set('Sequencer\nepoch 10ms\nbatch: -', C.yellow); seq.walT.set('replicated input log', C.dim);
    const reps = [0, 1].map(r => {
      const y = r === 0 ? 3.0 : -3.0; const R = { name: 'R' + (r + 1), y, crashed: false, applied: [], missed: [], queue: [], busy: false };
      R.panel = kit.box(10, 4.4, 0.3, '#1c2033', [4.8, y, -0.8], root);
      kit.text(`Replica R${r + 1}`, { size: 0.36, color: C.dim }, [8.4, y + 1.7, 0], root);
      R.sch = { p: [1.1, y, 1.3], x: 1.1, y, crashed: false }; R.sch.box = kit.box(2.4, 2.0, 1.2, '#a8652f', [1.1, y, 0], root);
      R.sch.t = kit.text('Scheduler\ndet. locks', { size: 0.34, color: C.text }, [1.1, y, 0.7], root);
      R.parts = [0, 1].map(j => { const o = { p: [5.0, y + (j ? -1.0 : 1.0), 1.2], crashed: false }; o.box = kit.cyl(0.9, 0.7, '#2d5f8f', [5.0, y + (j ? -1.0 : 1.0), 0], root); o.box.rotation.x = Math.PI / 2; kit.text('part ' + 'AB'[j], { size: 0.3, color: C.text }, [5.0, y + (j ? -1.0 : 1.0), 0.9], root); return o; });
      R.t = kit.text('applied: -', { size: 0.32, color: C.green }, [8.4, y, 0.4], root);
      R.sch.walT = { set() {} }; return R;
    });
    let n = 0, queue = [], log = [], epochT = null, execMsgs = 0, twoPcEq = 0, hashOf = (a) => { let h = 7; for (const c of a.join(',')) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return h.toString(16).padStart(4, '0'); };
    const showR = (R) => R.t.set(`applied:\n${R.applied.slice(-6).join(' ') || '-'}\nhash ${hashOf(R.applied)}${R.crashed ? '\nCRASHED' : ''}`, R.crashed ? C.red : C.green);
    const upd = () => { updM(); S.outcome = `txns ${n}   2PC would need ~${twoPcEq} msgs`; updM(); };
    function exec(R, id, multi) {
      kit.glow(R.sch.box, C.yellow, 0.6); R.queue.push(id);
      const go = () => {
        if (R.busy || !R.queue.length) return; R.busy = true; const t = R.queue.shift();
        const fin = () => { R.applied.push(t); R.parts.forEach(o => kit.glow(o.box, C.green, 0.5)); showR(R); R.busy = false; kit.glow(R.sch.box, 0, 0); R.sch.box.material.emissiveIntensity = 0; go(); };
        later(0.4, () => { // deterministic lock acquisition in log order
          const isMulti = multi[t];
          if (isMulti) { S.msgs += 2; msg(R.sch, R.parts[1], 'remote read', C.cyan, null, { dur: HOP * 0.6, noDrop: true }); msg(R.parts[1], R.parts[0], 'read set', C.cyan, () => later(0.2, fin), { dur: HOP * 0.8, noDrop: true }); }
          else later(0.3, fin);
        });
      };
      go(); R._go = go;
    }
    const multi = {};
    H.reset = () => { epoch++; kit.clearTimers(); n = 0; queue = []; log = []; execMsgs = 0; twoPcEq = 0; S.msgs = 0; reps.forEach(R => { R.crashed = false; R.applied = []; R.missed = []; R.queue = []; R.busy = false; showR(R); }); seq.txt.set('Sequencer\nepoch 10ms\nbatch: -', C.yellow); say('Calvin: sequence first, then execute deterministically -- no 2PC'); upd(); startEpochs(); };
    function startEpochs() {
      const tick = () => {
        if (queue.length) {
          const batch = queue.splice(0); seq.txt.set(`Sequencer\nepoch seal\n[${batch.join(' ')}]`, C.yellow); log.push(batch);
          say(`epoch sealed: batch [${batch.join(' ')}] gets a global order; replicated, then broadcast`, C.yellow);
          reps.forEach(R => { if (R.crashed) { R.missed.push(batch); return; } msg(seq, R.sch, 'batch ' + batch.join(','), C.orange, () => batch.forEach(id => exec(R, id, multi))); });
          later(1.2, () => seq.txt.set('Sequencer\nepoch 10ms\nbatch: -', C.yellow));
        }
        later(2.2, tick);
      }; later(1.2, tick);
    }
    H.run = () => { const id = 'T' + (++n); multi[id] = n % 2 === 0; if (multi[id]) twoPcEq += 8; queue.push(id); S.msgs++; msg(cli, seq, id + (multi[id] ? ' (A+B)' : ' (A)'), C.purple, null, { noDrop: true }); say(`${id} submitted (${multi[id] ? 'multi-partition: reads exchanged' : 'single-partition'}); waits for epoch seal`, C.text); upd(); };
    H.crashNow = () => { const R = reps[1]; R.crashed = true; R.sch.crashed = true; kit.setColor(R.sch.box, 0x2a2e42); showR(R); flash('R2 CRASH', [4.8, -3, 1.5], C.red, 2); say('R2 down. R1 keeps serving; no coordination needed to stay consistent.', C.red); };
    H.recover = () => {
      const R = reps[1]; if (!R.crashed) return; R.crashed = false; R.sch.crashed = false; kit.setColor(R.sch.box, '#a8652f');
      say('R2 recovers by REPLAYING the sequenced input log -> deterministic => identical state', C.green);
      R.missed.splice(0).forEach((b, bi) => later(bi * 0.5, () => msg(seq, R.sch, 'replay ' + b.join(','), C.green, () => b.forEach(id => exec(R, id, multi)))));
    };
    H.flagChanged = () => {}; H.reset();
  }

  // ---------------------------------------------------------------- single node
  function layoutSingle() {
    frame('Single node: one local commit, no distributed protocol', 'one WAL fsync is the commit point. Zero network messages, no blocking states.');
    const cl = mkNode('Client', -7, 0, 3, 1.6, C.purple); cl.walT.set('', C.dim); setSt(cl, 'IDLE');
    const db = mkNode('Database node', 1, 0, 6, 3, C.blue, true); setSt(db, 'IDLE');
    const wal = kit.cyl(1.2, 1.0, C.red, [5.8, -3.6, 0], root); kit.text('WAL', { size: 0.4, color: C.red }, [5.8, -3.6, 1], root);
    H.reset = () => { epoch++; kit.clearTimers(); S.msgs = 0; S.tDec = S.tEnd = null; S.outcome = 'idle'; db.locked = false; db.log = []; db.walT.set('log: -', C.dim); setSt(db, 'IDLE'); say('Single node: one local commit'); };
    H.run = () => {
      H.reset(); S.t0 = kit.t; S.outcome = 'running'; msg(cl, db, 'COMMIT', C.green, () => {
        db.locked = true; setSt(db, 'LOCKED'); say('row locks held; log record appended to WAL buffer', C.yellow);
        later(0.8, () => {
          if (S.voteNo) { setSt(db, 'ABORTED'); db.locked = false; walAdd(db, 'ROLLBACK'); S.outcome = 'ABORTED (constraint)'; updM(); return; }
          kit.glow(wal, C.red, 0.9); walAdd(db, 'COMMIT+fsync'); S.tDec = kit.t - S.t0; say('fsync done (~0.1ms SSD) = COMMIT POINT. Release locks.', C.green);
          later(0.4, () => { db.locked = false; setSt(db, 'COMMITTED'); S.tEnd = kit.t - S.t0; S.outcome = 'COMMITTED'; msg(db, cl, 'OK', C.green, null); updM(); });
        });
      });
    };
    H.crashNow = () => { db.crashed = true; setSt(db, 'CRASHED'); say('crash: on restart ARIES redo/undo from the WAL decides - no peers to ask', C.red); };
    H.recover = () => { db.crashed = false; setSt(db, 'RECOVERED'); };
    H.flagChanged = () => {}; H.reset();
  }

  // ---------------------------------------------------------------- scaffolding
  const INFO = {
    'two-phase-commit': () => `<b>Two-Phase Commit${S.spanner ? ' over Paxos groups (Spanner)' : ''}</b><br>Phase 1: coordinator forces BEGIN, sends PREPARE; each participant force-writes a PREPARE record, <i>keeps its locks</i>, votes YES/NO. Phase 2: if all YES the coordinator forces COMMIT (the commit point) and sends COMMIT; participants apply, release locks, ACK. Cost: 4 messages per participant, 2 round trips, 2+ forced log writes on the critical path.<br><b>Blocking:</b> a PREPARED participant cannot decide alone. Toggle "coordinator crashes" to see locks held until recovery.${S.spanner ? '<br><b>Spanner:</b> every participant and the coordinator is a Paxos group, so each forced log write = one more majority round trip (replicated 2PC state survives leader crash) - this removes the single-coordinator blocking hazard at +1 RTT per log force. Commit wait applies on top.' : ''}`,
    'three-phase-commit': () => '<b>Three-Phase Commit</b><br>Adds PRE-COMMIT between vote and commit so no participant is ever in a state where one peer may have committed while another can still abort. After coordinator timeout: if any survivor is PRECOMMIT -> commit, else abort: <b>non-blocking</b> with fail-stop crashes. Cost: 3 round trips. <b>Flaw:</b> a network partition splits the survivors (turn on "partition") and the termination rule yields COMMIT on one side and ABORT on the other. Rarely used; Paxos Commit / Spanner prefer replicated 2PC.',
    'percolator-timestamp': () => '<b>Percolator (Google, 2010; TiKV/TiDB, Cockroach-like)</b><br>No coordinator process: the <i>client</i> drives it. start_ts from the TSO gives the snapshot. Prewrite writes data@start_ts + lock (one key is PRIMARY, others point to it). commit_ts from TSO; committing the primary = atomically add write record, delete lock - a single-row Bigtable transaction, that is the commit point. Secondaries are committed lazily. If the client dies, any reader finds the orphan lock, looks at the primary: write record present -> roll forward; lock expired (TTL) -> roll back. Cost: 2 TSO RTTs + 2 prewrite/commit rounds, but no blocking coordinator state.',
    'calvin-deterministic': () => '<b>Calvin (Yale, 2012; FaunaDB)</b><br>Agree on the <i>order</i> before execution, not on the <i>outcome</i> after. Sequencers batch client txns every 10 ms epoch, replicate the batch (Paxos/async), and every replica\'s deterministic lock scheduler acquires locks in log order, so all replicas reach the same state without 2PC. Multi-partition txns only exchange read results. Requires txn read/write sets up front (OLLP for dependent reads). A crashed replica just replays the log.',
    'none-single-node': () => '<b>Single node</b><br>Commit = one WAL fsync (group commit amortises it). No prepare state, no coordinator, no network. Atomicity & durability come entirely from ARIES-style logging. Everything else on this page exists because data is split across nodes.',
  };
  function layout() {
    kit.clear(root); nodes = []; pulse = []; kit.clearTimers(); epoch++; H = {};
    if (mode === 'two-phase-commit') layout2pc(false);
    else if (mode === 'three-phase-commit') layout2pc(true);
    else if (mode === 'percolator-timestamp') layoutPerc();
    else if (mode === 'calvin-deterministic') layoutCalvin();
    else layoutSingle();
    ctx.onInfo && ctx.onInfo(INFO[mode] ? INFO[mode]() : '');
    buildSteps();
  }
  kit.animate((dt, t) => { pulse.forEach(n => { if (n.lockMesh && n.lockMesh.visible) { const s = 1 + 0.25 * Math.sin(t * 6) * (n.st === 'BLOCKED' ? 1.5 : 0.5); n.lockMesh.scale.setScalar(0.5 * s); } }); });

  function buildSteps() {
    const set = (flags) => { Object.assign(S, flags); H.flagChanged && H.flagChanged(); H.syncUI && H.syncUI(); };
    const base = [{ title: 'Roles', text: () => 'Identify the roles: ' + ({ 'two-phase-commit': 'a coordinator (purple) and three participants holding the data and its locks.', 'three-phase-commit': 'coordinator and three participants; note the extra PRE-COMMIT state.', 'percolator-timestamp': 'a client (the coordinator, stateless), the TSO, and three keys each with lock/write/data columns.', 'calvin-deterministic': 'clients, a sequencer, and two replicas each with a deterministic scheduler.', 'none-single-node': 'one node, one WAL.' })[mode], run() { H.reset && H.reset(); } }];
    const mid = {
      'two-phase-commit': [
        { title: 'Happy path', text: 'Run: PREPARE -> votes -> COMMIT -> ACK. Two round trips; participants hold locks from their vote until COMMIT arrives.', run() { set({ crashCoord: false, voteNo: false, crashPart: false }); H.run(); } },
        { title: 'A participant votes NO', text: 'P2 votes NO: coordinator aborts, sends ABORT to the others who release locks. Any single NO (or timeout) aborts.', run() { set({ voteNo: true, crashCoord: false }); H.run(); } },
        { title: 'Participant down', text: 'P3 is crashed: its vote never arrives, the coordinator times out and aborts (safe).', run() { set({ voteNo: false, crashPart: true }); H.run(); } },
        { title: 'Coordinator crashes after COMMIT record', text: 'All voted YES; coordinator forces COMMIT then dies before sending it. Participants are PREPARED and BLOCKED: they hold locks until the coordinator recovers.', run() { set({ voteNo: false, crashPart: false, crashCoord: true }); H.run(); } },
        { title: 'Coordinator recovers', text: 'Recovery reads COMMIT from its log and re-sends it: blocked participants finally commit and release locks.', run() { H.recover(); } },
        { title: 'Spanner: Paxos groups', text: 'Toggle makes each participant a Paxos group: log forces become replicated, so a leader crash no longer blocks (a follower takes over the 2PC state). Cost: extra RTT per log force.', run() { set({ spanner: true, crashCoord: false }); layout(); H.run(); } },
      ],
      'three-phase-commit': [
        { title: 'Happy path', text: 'CAN-COMMIT, PRE-COMMIT, DO-COMMIT: 3 round trips.', run() { set({ crashCoord: false, partition: false, crashPart: false }); H.run(); } },
        { title: 'Coordinator crash, no partition', text: 'PRE-COMMIT reached only P1 before the crash. Survivors compare states: P1 is PRECOMMIT so all commit. No blocking.', run() { set({ crashCoord: true, partition: false }); H.run(); } },
        { title: 'Same crash + partition', text: 'P1 is cut off from P2/P3. P1 commits (PRECOMMIT), P2/P3 abort (uncertain): split brain. 3PC is unsafe under partitions.', run() { set({ crashCoord: true, partition: true }); H.flagChanged(); H.run(); } },
      ],
      'percolator-timestamp': [
        { title: 'Happy path', text: 'start_ts -> prewrite primary -> prewrite secondaries -> commit_ts -> commit primary (commit point) -> secondaries lazily.', run() { set({ crashCoord: false }); H.run(); } },
        { title: 'Client dies after primary commit', text: 'The txn IS committed (primary has its write record) but B and C still hold locks.', run() { H.reset(); set({ crashCoord: true, percStage: 'after-primary-commit' }); H.run(); } },
        { title: 'Reader rolls forward', text: 'A reader hitting B\'s lock checks the primary, sees the write record and completes the commit for the dead client.', run() { H.recover(); } },
        { title: 'Client dies after prewrite', text: 'Nothing committed; locks everywhere. Reader must wait out the lock TTL (3s) then rolls back through the primary.', run() { H.reset(); set({ crashCoord: true, percStage: 'after-prewrite' }); H.run(); } },
      ],
      'calvin-deterministic': [
        { title: 'Submit transactions', text: 'Submit several txns; each epoch the sequencer seals a batch and assigns a global order.', run() { H.run(); H.run(); H.run(); } },
        { title: 'Both replicas agree', text: 'Both schedulers apply the same order and hash to the same value, with no inter-replica coordination.', run() { H.run(); } },
        { title: 'Crash R2 and keep going', text: 'Replica R2 dies; R1 continues and commits are not blocked.', run() { H.crashNow(); H.run(); H.run(); } },
        { title: 'R2 replays the log', text: 'Recovery = replay the input log; determinism guarantees the same final state (compare hashes).', run() { H.recover(); } },
      ],
      'none-single-node': [{ title: 'Local commit', text: 'Lock, append to WAL, fsync (commit point), release.', run() { set({ voteNo: false }); H.run(); } }, { title: 'Constraint violation', text: 'Abort is local too: undo and release.', run() { set({ voteNo: true }); H.run(); } }],
    }[mode];
    steps.length = 0;
    [...base, ...mid, { title: 'Compare protocols', text: '2PC: blocking, 2 RTT. 3PC: non-blocking only without partitions, 3 RTT. Percolator: no coordinator state, relies on TSO + KV atomic row writes. Calvin: no commit protocol, needs deterministic txns. Spanner: 2PC whose state is Paxos-replicated.', run() { ctx.onInfo(INFO[mode]()); } }]
      .forEach(s => steps.push({ title: s.title, get text() { return typeof s.text === 'function' ? s.text() : s.text; }, run() { s.run(); } }));
  }

  cur = { S, H: () => H, relayout: layout, setMode(m) { mode = m; layout(); }, getMode: () => mode };
  layout();
  return {
    group: kit.group, steps,
    update(dt, t) { kit.update(dt); },
    dispose() { kit.dispose(); if (cur && cur.S === S) cur = null; },
    onConfigChange(cfg) { const m = cfg && cfg['distributed-commit']; if (m && m !== mode) { mode = m; layout(); } },
  };
}

const flag = (id, label, key, relayout) => ({ id, label, type: 'toggle', value: false, onChange(v) { if (!cur) return; cur.S[key] = v; if (relayout) cur.relayout(); else cur.H().flagChanged && cur.H().flagChanged(); } });

export const commitView = {
  build,
  controls: [
    { id: 'run', label: 'Run transaction', type: 'button', onChange() { cur && cur.H().run && cur.H().run(); } },
    { id: 'reset', label: 'Reset', type: 'button', onChange() { cur && cur.H().reset && cur.H().reset(); } },
    flag('crashCoord', 'Crash coordinator/client mid-protocol (at start of run)', 'crashCoord'),
    { id: 'percStage', label: 'Percolator client crash point', type: 'select', options: [{ value: 'after-primary-commit', label: 'after primary commit' }, { value: 'after-prewrite', label: 'after prewrite' }], value: 'after-primary-commit', onChange(v) { cur && (cur.S.percStage = v); } },
    { id: 'crashNow', label: 'Crash coordinator NOW (Calvin: replica R2)', type: 'button', onChange() { cur && cur.H().crashNow && cur.H().crashNow(); } },
    { id: 'recover', label: 'Recover (coordinator / reader resolves locks / R2 replays)', type: 'button', onChange() { cur && cur.H().recover && cur.H().recover(); } },
    flag('crashPart', 'Participant P3 is down', 'crashPart'),
    flag('voteNo', 'P2 votes NO / local constraint fails', 'voteNo'),
    flag('drop', 'Drop the next message', 'drop'),
    flag('partition', '3PC: partition P1 from P2,P3', 'partition'),
    flag('spanner', '2PC: Spanner mode (participants = Paxos groups)', 'spanner', true),
  ],
};
