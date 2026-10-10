// logical-clocks view: interactive 3-process space-time diagram. All clock kinds are maintained simultaneously; the `clock` slot picks which is displayed.
import * as THREE from 'three';
import { makeKit, C } from './_dist-kit.js';

const NC = 13, X = (c) => -7.2 + c * 1.3, LY = [3.6, 0.0, -3.6], TSOY = 6.9;
const PCOL = [C.blue, C.green, C.orange];
const SKEW = [0, 30, -20];            // physical clock offsets (ms) for HLC
const ERR = [0.9, -0.9, 0.1];         // clock error as fraction of eps (TrueTime), always < 1
const PT = (p, c) => 1000 + c * 10 + SKEW[p];
let cur = null;

function build(ctx) {
  const kit = makeKit(ctx);
  const G = kit.group;
  const S = { eps: 4, nowait: false, cmpA: 1, cmpB: 2, src: 0, dst: 1 };
  let mode = (ctx.config && ctx.config.clock) || 'lamport';
  let L, V, H, laneNext, gcol, events, msgs, epoch = 0;
  const dyn = new THREE.Group(); G.add(dyn);
  const steps = [];
  const halos = [kit.sphere(0.5, '#00e5ff', [0, 0, 0], G, { transparent: true, opacity: 0.35, emissive: '#00e5ff', emissiveIntensity: 0.8 }), kit.sphere(0.5, '#ff4fd8', [0, 0, 0], G, { transparent: true, opacity: 0.35, emissive: '#ff4fd8', emissiveIntensity: 0.8 })];
  halos.forEach(h => h.visible = false);

  // static frame: lanes
  const laneLbl = [0, 1, 2].map(p => {
    kit.line([[-8.6, LY[p], 0], [9.4, LY[p], 0]], PCOL[p], { opacity: 0.55 });
    kit.cyl(0.12, 0.3, PCOL[p], [9.6, LY[p], 0], G).rotation.z = -Math.PI / 2;
    return kit.text('P' + (p + 1), { size: 0.4, color: PCOL[p] }, [-10.0, LY[p], 0]);
  });
  kit.text('real time ->', { size: 0.3, color: C.dim }, [8.2, -5.2, 0]);
  const tsoLane = kit.line([[-8.6, TSOY, 0], [9.4, TSOY, 0]], C.yellow, { opacity: 0.6 });
  const tsoLbl = kit.text('TSO', { size: 0.4, color: C.yellow }, [-10.0, TSOY, 0]);
  kit.text('local event = sphere    send = cube    receive = disc', { size: 0.3, color: C.dim }, [0, -6.0, 0]);
  const status = kit.text('', { size: 0.34, color: C.text }, [0, -6.8, 0]);

  function resetState() {
    epoch++; kit.clearTimers(); kit.clear(dyn);
    L = [0, 0, 0]; V = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; H = [{ l: 0, c: 0 }, { l: 0, c: 0 }, { l: 0, c: 0 }];
    laneNext = [0, 0, 0]; gcol = 0; events = []; msgs = []; halos.forEach(h => h.visible = false); refresh();
  }
  const later = (d, fn) => { const ep = epoch; return kit.after(d, () => { if (ep === epoch) fn(); }); };
  const flash = (t, color = C.red) => status.set(t, color);

  // ------------------------------------------------------------ event creation
  function mkEvent(p, col, kind, src) {
    const ev = { n: events.length + 1, p, col, kind, src, vis: true, idxLane: events.filter(e => e.p === p).length };
    if (kind === 'recv') {
      const m = src; // src = send event
      L[p] = Math.max(L[p], m.L) + 1; for (let i = 0; i < 3; i++) V[p][i] = Math.max(V[p][i], m.V[i]); V[p][p]++;
      const pt = PT(p, col), h = H[p], mh = m.hl; const lp = Math.max(h.l, mh.l, pt);
      let c; if (lp === h.l && lp === mh.l) c = Math.max(h.c, mh.c) + 1; else if (lp === h.l) c = h.c + 1; else if (lp === mh.l) c = mh.c + 1; else c = 0;
      H[p] = { l: lp, c };
    } else {
      L[p]++; V[p][p]++;
      const pt = PT(p, col), h = H[p], lp = Math.max(h.l, pt); H[p] = { l: lp, c: lp === h.l ? h.c + 1 : 0 };
    }
    ev.L = L[p]; ev.V = V[p].slice(); ev.hl = { ...H[p] };
    const x = X(col), y = LY[p];
    const shape = kind === 'send' ? kit.box(0.42, 0.42, 0.42, PCOL[p], [x, y, 0], dyn) : kind === 'recv' ? (() => { const d = kit.cyl(0.3, 0.14, PCOL[p], [x, y, 0], dyn); d.rotation.x = Math.PI / 2; return d; })() : kit.sphere(0.26, PCOL[p], [x, y, 0], dyn);
    ev.mesh = shape;
    const up = ev.idxLane % 2 === 0;
    ev.up = up;
    ev.lab = kit.text('', { size: 0.34, color: C.text }, [x, y + (up ? 0.95 : -0.95), 0.2], dyn);
    ev.tag = kit.text('#' + ev.n, { size: 0.24, color: C.dim }, [x, y + (up ? -0.55 : 0.55), 0.1], dyn);
    ev.bar = kit.box(1, 0.2, 0.2, C.yellow, [x, y, 0], dyn, { transparent: true, opacity: 0.55 });
    ev.bar.position.z = -0.1;
    ev.tsoLink = kit.line([[x, y, 0], [x, TSOY, 0]], C.yellow, { opacity: 0.35 }, dyn);
    ev.tsoDot = kit.sphere(0.13, C.yellow, [x, TSOY, 0], dyn);
    events.push(ev); return ev;
  }
  const full = () => gcol >= NC - 1;
  function local(p) {
    if (full()) { resetState(); flash('diagram full: reset', C.dim); }
    const col = Math.max(gcol, laneNext[p]); if (col > NC - 1) { resetState(); return local(p); }
    laneNext[p] = col + 1; gcol = col + 1;
    const ev = mkEvent(p, col, 'local'); tsoPing(ev); refresh(); report(ev); return ev;
  }
  function send(p, q) {
    if (p === q) { flash('pick two different processes', C.dim); return; }
    if (gcol >= NC - 3) { resetState(); flash('diagram full: reset', C.dim); }
    const col = Math.max(gcol, laneNext[p]); laneNext[p] = col + 1; gcol = col + 1;
    const se = mkEvent(p, col, 'send'); tsoPing(se);
    const rcol = Math.max(col + 1, laneNext[q]); laneNext[q] = rcol + 1;
    const re = mkEvent(q, rcol, 'recv', se); se.msgTo = re; re.vis = false; tsoPing(re, 1.1);
    const a = [X(col), LY[p], 0.1], b = [X(rcol), LY[q], 0.1];
    kit.line([a, b], PCOL[p], { opacity: 0.8 }, dyn);
    // arrowhead at destination
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], 0).normalize();
    const cone = kit.mat(PCOL[p]); const ar = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 8), cone); kit.track(ar.geometry);
    ar.position.set(b[0] - dir.x * 0.45, b[1] - dir.y * 0.45, 0.1); ar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); dyn.add(ar);
    msgs.push({ se, re });
    refresh(); report(se);
    kit.send(a, b, { dur: 1.0, color: PCOL[p], size: 0.16, label: labelFor(se).text.split('\n')[0], labelColor: C.text, onArrive: () => { re.vis = true; refresh(); report(re); } });
    return se;
  }
  function tsoPing(ev, delay = 0) { // visual round trip to the oracle
    if (mode !== 'timestamp-oracle') return;
    const ep = epoch;
    kit.after(delay, () => { if (ep !== epoch) return; kit.send([X(ev.col), LY[ev.p], 0.2], [X(ev.col), TSOY, 0.2], { dur: 0.4, color: C.yellow, size: 0.12, onArrive: () => { if (ep === epoch) kit.send([X(ev.col), TSOY, 0.2], [X(ev.col), LY[ev.p], 0.2], { dur: 0.4, color: C.yellow, size: 0.12 }); } }); });
  }

  // ------------------------------------------------------------ labels
  function tt(ev) {
    const eps = S.eps; let T = 1000 + ev.col * 10;
    if (ev.kind === 'recv' && !S.nowait) T = Math.max(T, 1000 + ev.src.col * 10 + 2 * eps + 2);
    const r = T + ERR[ev.p] * eps; return { T, e: Math.round(r - eps), l: Math.round(r + eps) };
  }
  function tsoMap() {
    const m = new Map(), cnt = {}; events.slice().sort((a, b) => a.col - b.col || a.n - b.n).forEach(e => { const ph = 1000 + e.col * 10; cnt[ph] = (cnt[ph] ?? -1) + 1; m.set(e, { ph, lg: cnt[ph] }); }); return m;
  }
  function labelFor(ev, tm) {
    switch (mode) {
      case 'vector-clock': return { text: `[${ev.V.join(',')}]`, color: C.text };
      case 'hlc': return { text: `${ev.hl.l}:${ev.hl.c}`, color: C.text };
      case 'truetime': {
        const t = tt(ev);
        if (ev.kind === 'recv') { const ok = t.l > tt(ev.src).l; return { text: `[${t.e},${t.l}]\n${ok ? 'ts > s ok' : 'ts <= s INVERSION'}`, color: ok ? C.text : C.red }; }
        return { text: `[${t.e},${t.l}]\ns=${t.l}`, color: C.text };
      }
      case 'timestamp-oracle': { const t = (tm || tsoMap()).get(ev); return { text: `(${t.ph},${t.lg})`, color: C.yellow }; }
      default: return { text: `${ev.L}`, color: C.text };
    }
  }
  function stateStr(p) {
    const last = events.filter(e => e.p === p && e.vis).pop();
    switch (mode) {
      case 'lamport': return 'L=' + L[p];
      case 'vector-clock': return '[' + V[p].join(',') + ']';
      case 'hlc': { const h = last ? last.hl : H[p]; return `pt ${SKEW[p] >= 0 ? '+' : ''}${SKEW[p]}ms\n${h.l}:${h.c}`; }
      case 'truetime': return `eps ${S.eps}ms\nerr ${(ERR[p] * S.eps).toFixed(1)}`;
      default: return 'client';
    }
  }
  function refresh() {
    const tm = mode === 'timestamp-oracle' ? tsoMap() : null;
    tsoLane.visible = tsoLbl.sprite.visible = mode === 'timestamp-oracle'; tsoLbl.sprite.visible = tsoLane.visible;
    events.forEach(ev => {
      const l = labelFor(ev, tm); ev.lab.set(l.text, l.color);
      const lines = l.text.split('\n').length; ev.lab.pos(X(ev.col), LY[ev.p] + (ev.up ? 0.6 + lines * 0.27 : -0.6 - lines * 0.27), 0.2);
      ev.mesh.visible = ev.lab.sprite.visible = ev.tag.sprite.visible = ev.vis;
      const showBar = mode === 'truetime' && ev.kind !== 'recv' && !S.nowait && ev.vis;
      ev.bar.visible = showBar; const len = (2 * S.eps / 10) * 1.3; ev.bar.scale.x = len; ev.bar.position.x = X(ev.col) + len / 2;
      ev.tsoLink.visible = ev.tsoDot.visible = mode === 'timestamp-oracle' && ev.vis;
      ev.mesh.scale.setScalar(ev.mesh.scale.x); // noop; keep refs stable
    });
    [0, 1, 2].forEach(p => laneLbl[p].set('P' + (p + 1) + '\n' + stateStr(p), PCOL[p]));
    placeHalos();
  }
  function placeHalos() {
    [S.cmpA, S.cmpB].forEach((n, i) => { const ev = events[n - 1]; const h = halos[i]; h.visible = !!(ev && ev.vis); if (ev) h.position.set(X(ev.col), LY[ev.p], -0.2); });
  }

  // ------------------------------------------------------------ info / compare
  const DESC = {
    'lamport': () => 'Lamport clock (1978): one integer per process. Local/send: L = L+1. Receive: L = max(L, m.L) + 1. Guarantees a -> b implies L(a) < L(b), but NOT the converse: concurrent events get arbitrary-looking order. Cost: 8 bytes/message.',
    'vector-clock': () => 'Vector clock: one counter per process (n entries; Dynamo/Riak use version vectors per replica). Local: V[i]++. Send: V[i]++ then attach V. Receive: V = max(V, m.V) then V[i]++. a -> b iff V(a) <= V(b) and V(a) != V(b); if neither dominates, the events are CONCURRENT (that is how Dynamo detects write conflicts). Cost: O(n) per message.',
    'hlc': () => `Hybrid Logical Clock (CockroachDB, YugabyteDB, MongoDB): (l, c) = (max physical time seen, counter). Local/send: l\' = max(l, pt); c = (l\'==l) ? c+1 : 0. Receive: l\' = max(l, m.l, pt) and c rules on ties. Stays within bounded drift of wall-clock (here P2 pt is +30ms, P3 -20ms) while still respecting causality; fits in 64 bits. Receivers behind in time catch up to the fast clock, so l - pt stays bounded.`,
    'truetime': () => `Spanner TrueTime: TT.now() returns an interval [earliest, latest] guaranteed to contain true time; uncertainty eps = ${S.eps}ms here (GPS + atomic clocks give ~1-7ms). A txn picks s = TT.now().latest then performs <b>commit wait</b>: delays until TT.after(s), about 2*eps = ${2 * S.eps}ms, before releasing locks / acknowledging. Any later txn anywhere then gets a larger timestamp: external consistency. Toggle "skip commit-wait" to see inversions.`,
    'timestamp-oracle': () => 'Timestamp oracle (Percolator, TiDB PD, Omid): a single service hands out strictly increasing (physical ms, logical counter) pairs, 46+18 bits in TiDB. Every event costs a round trip (~0.2-1ms in a DC, clients batch requests) and the oracle is a bottleneck/SPOF, mitigated by persisting a time window ahead (~3s) to Raft so a new leader never goes backwards. Gives a total order and trivial snapshot reads.',
  };
  const hb = (a, b) => a !== b && a.V.every((x, i) => x <= b.V[i]);
  function compare() {
    const a = events[S.cmpA - 1], b = events[S.cmpB - 1];
    if (!a || !b) return '<i>Choose two existing events (#n) with the compare sliders.</i>';
    if (a === b) return `<i>#${a.n} compared with itself.</i>`;
    const truth = hb(a, b) ? `#${a.n} happened-before #${b.n}` : hb(b, a) ? `#${b.n} happened-before #${a.n}` : `#${a.n} and #${b.n} are CONCURRENT`;
    const conc = !hb(a, b) && !hb(b, a);
    let s = `<b>Compare #${a.n} (P${a.p + 1}) vs #${b.n} (P${b.p + 1})</b><br>Ground truth (message graph): <b>${truth}</b><br>`;
    if (mode === 'lamport') s += `L=${a.L} vs L=${b.L}: clock says ${a.L === b.L ? 'tie' : a.L < b.L ? '#' + a.n + ' first' : '#' + b.n + ' first'}. ${conc ? '<span style="color:#f7768e">But they are concurrent: Lamport cannot tell concurrent from causal.</span>' : 'Consistent with causality.'}`;
    else if (mode === 'vector-clock') { const le = (x, y) => x.V.every((v, i) => v <= y.V[i]); s += `[${a.V}] vs [${b.V}]: ${le(a, b) ? '[a] <= [b] so a -> b' : le(b, a) ? '[b] <= [a] so b -> a' : 'neither vector dominates: <b style="color:#ff9e64">CONCURRENT</b> (a conflict a version vector would flag)'}.`; }
    else if (mode === 'hlc') s += `(${a.hl.l}:${a.hl.c}) vs (${b.hl.l}:${b.hl.c}): lexicographic order says ${a.hl.l === b.hl.l && a.hl.c === b.hl.c ? 'tie' : (a.hl.l < b.hl.l || (a.hl.l === b.hl.l && a.hl.c < b.hl.c)) ? '#' + a.n + ' first' : '#' + b.n + ' first'}. ${conc ? 'Concurrent events are ordered by wall-clock-ish time, not flagged.' : 'Consistent with causality.'}`;
    else if (mode === 'truetime') { const x = tt(a), y = tt(b); s += `[${x.e},${x.l}] vs [${y.e},${y.l}]: ${x.l < y.e ? 'a definitely before b' : y.l < x.e ? 'b definitely before a' : '<b style="color:#e0af68">intervals overlap: order uncertain</b> (would need commit-wait)'}.`; }
    else { const m = tsoMap(), x = m.get(a), y = m.get(b); s += `(${x.ph},${x.lg}) vs (${y.ph},${y.lg}): total order, ${(x.ph < y.ph || (x.ph === y.ph && x.lg < y.lg)) ? '#' + a.n : '#' + b.n} first. Always comparable, at the price of a round trip each.`; }
    return s;
  }
  function report(ev) {
    const tail = ev ? `<br><br>Last event #${ev.n} on P${ev.p + 1} (${ev.kind}): L=${ev.L}, V=[${ev.V}], HLC=${ev.hl.l}:${ev.hl.c}` : '';
    ctx.onInfo && ctx.onInfo(`<b>${mode}</b><br>${DESC[mode]()}<br><br>${compare()}${tail}`);
    status.set(`events: ${events.length}   columns used: ${gcol}/${NC}   ${mode === 'timestamp-oracle' ? 'each event waits ~1 RTT to TSO' : mode === 'truetime' ? 'commit-wait = ' + 2 * S.eps + ' ms' : 'no coordination needed'}`, C.dim);
  }

  // ------------------------------------------------------------ demo + steps
  function demo() {
    resetState(); const seq = [() => local(0), () => send(0, 1), () => local(2), () => send(1, 2), () => local(0), () => send(2, 0), () => local(1)];
    seq.forEach((f, i) => later(i * 0.35, f)); later(seq.length * 0.35 + 1.5, () => { S.cmpA = 1; S.cmpB = 3; placeHalos(); report(); });
  }
  function setCmp(a, b) { S.cmpA = a; S.cmpB = b; placeHalos(); report(); }
  steps.push(
    { title: 'Three processes, no shared clock', text: 'P1..P3 only communicate by messages. Real time flows left to right but no process can read it perfectly, so we need a logical notion of "before".', run() { resetState(); report(); } },
    { title: 'Local events', text: 'Each local event ticks the process\'s own clock. Events on the same process are totally ordered.', run() { resetState(); local(0); later(0.3, () => local(1)); later(0.6, () => local(2)); later(0.9, () => local(0)); } },
    { title: 'Send a message', text: 'P1 -> P2: the send event carries the clock; the receive merges it (max, then +1 / HLC rule / vector merge). This creates a happened-before edge.', run() { resetState(); local(0); later(0.3, () => send(0, 1)); } },
    { title: 'A chain of messages', text: 'P2 -> P3 then P3 -> P1: causality is transitive, and every clock type must reflect it.', run() { resetState(); local(0); later(0.3, () => send(0, 1)); later(0.7, () => send(1, 2)); later(1.1, () => send(2, 0)); } },
    { title: 'Concurrent events', text: 'Run the demo and compare #1 with #3 (P1 local vs P3 local with no message path). Only vector clocks can say "concurrent"; Lamport/HLC/TSO give an order anyway.', run() { demo(); } },
    { title: 'Switch the clock', text: 'Change the design slot (Lamport / vector / HLC / TrueTime / TSO): same history, different timestamps. TrueTime adds commit-wait bars, TSO adds a round trip per event.', run() { report(); } },
  );

  kit.animate((dt, t) => { halos.forEach((h, i) => { if (h.visible) h.scale.setScalar(0.5 + 0.06 * Math.sin(t * 5 + i)); }); });

  cur = {
    S, local, send, demo, reset: () => { resetState(); report(); }, setCmp, refresh, report,
    setEps(v) { S.eps = v; refresh(); report(); }, setNoWait(v) { S.nowait = v; refresh(); report(); },
  };
  resetState(); report();
  return {
    group: G, steps,
    update(dt) { kit.update(dt); },
    dispose() { kit.dispose(); if (cur && cur.S === S) cur = null; },
    onConfigChange(cfg) { const m = cfg && cfg.clock; if (m && m !== mode) { mode = m; refresh(); report(); } },
  };
}

const btn = (id, label, fn) => ({ id, label, type: 'button', onChange() { cur && fn(); } });
const procs = [{ value: '0', label: 'P1' }, { value: '1', label: 'P2' }, { value: '2', label: 'P3' }];
export const clockView = {
  build,
  controls: [
    btn('ev1', 'Local event on P1', () => cur.local(0)),
    btn('ev2', 'Local event on P2', () => cur.local(1)),
    btn('ev3', 'Local event on P3', () => cur.local(2)),
    { id: 'src', label: 'Message from', type: 'select', options: procs, value: '0', onChange(v) { cur && (cur.S.src = +v); } },
    { id: 'dst', label: 'to', type: 'select', options: procs, value: '1', onChange(v) { cur && (cur.S.dst = +v); } },
    btn('send', 'Send message', () => cur.send(cur.S.src, cur.S.dst)),
    btn('demo', 'Run demo history', () => cur.demo()),
    btn('reset', 'Reset diagram', () => cur.reset()),
    { id: 'cmpA', label: 'Compare event #', type: 'range', min: 1, max: 14, step: 1, value: 1, onChange(v) { cur && cur.setCmp(+v, cur.S.cmpB); } },
    { id: 'cmpB', label: 'with event #', type: 'range', min: 1, max: 14, step: 1, value: 2, onChange(v) { cur && cur.setCmp(cur.S.cmpA, +v); } },
    { id: 'eps', label: 'TrueTime eps (ms)', type: 'range', min: 1, max: 7, step: 1, value: 4, onChange(v) { cur && cur.setEps(+v); } },
    { id: 'nowait', label: 'TrueTime: skip commit-wait', type: 'toggle', value: false, onChange(v) { cur && cur.setNoWait(!!v); } },
  ],
};
