// Execution & Scheduling internals (internals-B).
// Views: executor, operators, scheduler, parallelism, codegen, adaptive-execution, exchange-shuffle, columnar-processing.
// All animations are mechanism-driven (token timelines / small discrete-event simulations), not decoration.
// Numbers shown as throughput / instructions-per-tuple are ILLUSTRATIVE orders of magnitude
// (cf. MonetDB/X100 CIDR'05, HyPer VLDB'11 "Efficiently compiling...", Kersten VLDB'18 "Everything you always wanted to know about compiled and vectorized queries").
import * as THREE from 'three';

const C = {
  scan: 0x7aa2f7, filter: 0xe0af68, project: 0xbb9af7, join: 0xff9e64, agg: 0x9ece6a, sort: 0x2ac3de,
  exch: 0xf7768e, ctl: 0x7dcfff, data: 0x9ece6a, panel: 0x161b2e, panel2: 0x1f2640, good: 0x9ece6a, bad: 0xf7768e,
  warn: 0xe0af68, tuple: 0xe0af68, grey: 0x4a5072, white: 0xd7def5, bg: 0x0b0e17,
};
const HEX = n => '#' + n.toString(16).padStart(6, '0');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => k * k * (3 - 2 * k);
const DEF = {
  'exec-model': 'vectorized', 'data-direction': 'pull', 'code-execution': 'precompiled-primitives',
  scheduling: 'morsel-driven', parallelism: 'intra-query-exchange', 'page-layout': 'dsm-column', 'table-organization': 'columnar',
};
const getCfg = c => ({ ...DEF, ...(c || {}) });

function makeKit(ctx) {
  const group = new THREE.Group();
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const sphGeo = new THREE.SphereGeometry(0.5, 14, 10);
  const coneGeo = new THREE.ConeGeometry(0.5, 1, 12);
  const cache = new Map();
  const kit = {
    group, boxGeo, sphGeo,
    mat(color, o = {}) {
      return new THREE.MeshStandardMaterial({
        color, roughness: 0.55, metalness: 0.05, emissive: color, emissiveIntensity: o.em ?? 0.3,
        transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1, depthWrite: (o.opacity ?? 1) >= 1,
      });
    },
    cmat(color) { let m = cache.get(color); if (!m) { m = kit.mat(color); cache.set(color, m); } return m; },
    box(x, y, z, w, h, d, color, o = {}) {
      const m = new THREE.Mesh(boxGeo, o.mat || kit.mat(color, o)); m.position.set(x, y, z); m.scale.set(w, h, d);
      (o.parent || group).add(m); return m;
    },
    sphere(x, y, z, s, color, o = {}) {
      const m = new THREE.Mesh(sphGeo, o.mat || kit.mat(color, o)); m.position.set(x, y, z); m.scale.setScalar(s);
      (o.parent || group).add(m); return m;
    },
    panel(x, y, w, h, color = C.panel, o = {}) { return kit.box(x, y, o.z ?? -0.4, w, h, 0.1, color, { em: 0.15, ...o }); },
    lbl(text, x, y, z = 0.6, o = {}) {
      const s = ctx.makeLabel(text, { size: o.size ?? 0.5, color: o.color ?? '#c0caf5' }); s.position.set(x, y, z); (o.parent || group).add(s); return s;
    },
    dyn(x, y, z = 0.6, o = {}) {
      let cur = null, last = null;
      return {
        get sprite() { return cur; },
        set(text, color) {
          const key = text + '|' + color; if (key === last) return; last = key;
          if (cur) { (o.parent || group).remove(cur); cur.material.map && cur.material.map.dispose(); cur.material.dispose(); }
          cur = ctx.makeLabel(text, { size: o.size ?? 0.5, color: color || o.color || '#c0caf5' }); cur.position.set(x, y, z); (o.parent || group).add(cur);
        },
      };
    },
    // arrow from (ax,ay) to (bx,by) in XY plane
    arrow(ax, ay, bx, by, color, o = {}) {
      const g = new THREE.Group(); const len = Math.hypot(bx - ax, by - ay); const th = o.th ?? 0.07;
      const ang = Math.atan2(by - ay, bx - ax); const m = o.mat || kit.mat(color, { em: 0.5 });
      const shaft = new THREE.Mesh(boxGeo, m); shaft.scale.set(Math.max(0.01, len - 0.25), th, th); shaft.position.set((ax + bx) / 2 - Math.cos(ang) * 0.1, (ay + by) / 2 - Math.sin(ang) * 0.1, o.z ?? 0);
      shaft.rotation.z = ang; g.add(shaft);
      const head = new THREE.Mesh(coneGeo, m); head.scale.set(0.28, 0.32, 0.28); head.position.set(bx - Math.cos(ang) * 0.16, by - Math.sin(ang) * 0.16, o.z ?? 0); head.rotation.z = ang - Math.PI / 2; g.add(head);
      (o.parent || group).add(g); return g;
    },
    polyline(pts, color, o = {}) {
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
      const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: o.opacity ?? 1 }));
      (o.parent || group).add(l); return l;
    },
    dispose() {
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => { x.map && x.map.dispose(); x.dispose(); });
      });
      cache.clear();
    },
  };
  return kit;
}

// Stateless token timeline: every token is a pure function of time (cycle handled by caller).
function makeTL(kit) {
  const toks = [];
  return {
    add(o) {
      const m = new THREE.Mesh(o.sphere ? kit.sphGeo : kit.boxGeo, kit.cmat(o.color ?? C.tuple));
      const sz = o.size ?? 0.35; m.scale.setScalar(sz); m.visible = false; kit.group.add(m);
      const P = o.path.map(p => new THREE.Vector3(p[0], p[1], p[2] ?? 0.3)); const seg = []; let len = 0;
      for (let i = 1; i < P.length; i++) { const l = P[i].distanceTo(P[i - 1]); seg.push(l); len += l; }
      toks.push({ m, P, seg, len: len || 1, t0: o.t0, dur: o.dur, stay: !!o.stay, until: o.until ?? Infinity, shrink: !!o.shrink, size: sz, ease: o.ease !== false,
        swap: o.swap ? { at: o.swap.at, mat: kit.cmat(o.swap.color) } : null, mat0: kit.cmat(o.color ?? C.tuple), grow: o.grow });
      return m;
    },
    clear() { toks.forEach(k => k.m.parent && k.m.parent.remove(k.m)); toks.length = 0; },
    render(time) {
      for (const k of toks) {
        const m = k.m;
        if (time < k.t0 || time >= k.until || (!k.stay && time > k.t0 + k.dur)) { m.visible = false; continue; }
        m.visible = true; let u = clamp((time - k.t0) / k.dur, 0, 1); if (k.ease) u = ease(u);
        let d = u * k.len, i = 0; while (i < k.seg.length - 1 && d > k.seg[i]) { d -= k.seg[i]; i++; }
        const f = k.seg[i] > 0 ? clamp(d / k.seg[i], 0, 1) : 1; m.position.lerpVectors(k.P[i], k.P[i + 1] || k.P[i], f);
        m.scale.setScalar(k.shrink && u > 0.7 ? k.size * Math.max(0.01, 1 - (u - 0.7) / 0.3) : k.size);
        m.material = k.swap && time >= k.swap.at ? k.swap.mat : k.mat0;
      }
    },
  };
}

function stepper(ctx, title, text, fn) {
  return { title, text, run() { ctx.onInfo && ctx.onInfo(`<b>${title}</b><br>${text}`); fn && fn(); } };
}
function finish(kit, ctx, o) {
  return {
    group: kit.group, update: o.update || (() => {}), dispose() { o.onDispose && o.onDispose(); kit.dispose(); },
    onConfigChange: o.onConfigChange || (() => {}), steps: o.steps, setParam: o.setParam || (() => {}),
  };
}
const ctlFor = (id, label, type, extra) => ({ id, label, type, ...extra, onChange(v, api) { api && api.setParam && api.setParam(id, v); } });

/* ============================================================ EXECUTOR ============================================================ */
const OPX = [-4.8, -1.8, 1.2, 4.2];
const LY = [4.2, 1.4, -1.4, -4.2];
const OPN = ['Scan', 'Filter', 'Project', 'Agg'];
const OPC = [C.scan, C.filter, C.project, C.agg];
const MODELS = ['volcano', 'vectorized', 'materialization', 'compiled'];

function perf(model, B) {
  if (model === 'volcano') { const ipt = 220; return { ipt, mt: 3000 * 1.0 / ipt }; }
  if (model === 'vectorized') {
    const ipt = 20 + 4 * 180 / B; const bytes = B * 8 * 5; let ipc = 2.5;
    if (bytes > 32768) ipc /= 1 + 0.5 * Math.log2(bytes / 32768); // vectors spill out of L1 into L2/L3
    return { ipt, mt: 3000 * ipc / ipt, spill: bytes > 32768 };
  }
  if (model === 'materialization') return { ipt: 14, mt: 104 };
  return { ipt: 11, mt: 3000 * 2.2 / 11 };
}
function makeScript(push, drop) {
  const h = [];
  if (!push) h.push({ k: 'call', a: 3, b: 2 }, { k: 'call', a: 2, b: 1 }, { k: 'call', a: 1, b: 0 });
  if (drop) {
    h.push({ k: 'data', a: 0, b: 1, drop: true });
    if (push) return h;
    h.push({ k: 'call', a: 1, b: 0 }, { k: 'data', a: 0, b: 1 });
  } else h.push({ k: 'data', a: 0, b: 1 });
  h.push({ k: 'data', a: 1, b: 2 }, { k: 'data', a: 2, b: 3 });
  return h;
}

const executorView = {
  build(ctx) {
    const kit = makeKit(ctx); let cfg = getCfg(ctx.config); let focus = -1; let B = 1024;
    const lanes = [];
    const titles = [['Volcano', 'iterator: next() per tuple'], ['Vectorized', 'next() per batch of B'], ['Materialization', 'operator-at-a-time'], ['Compiled (push)', 'fused pipeline loop']];
    MODELS.forEach((mdl, i) => {
      const y = LY[i], L = { mdl, y, g: new THREE.Group() }; kit.group.add(L.g);
      L.panel = kit.box(0, y, -0.5, 20, 2.65, 0.1, C.panel, { em: 0.12, parent: L.g });
      L.frame = kit.box(0, y, -0.6, 20.15, 2.8, 0.05, C.good, { em: 0.5, opacity: 0.0, parent: L.g });
      kit.lbl(titles[i][0], -8.0, y + 0.45, 0.5, { size: 0.42, color: HEX(OPC[i]), parent: L.g });
      kit.lbl(titles[i][1], -8.0, y - 0.3, 0.5, { size: 0.25, color: '#8a93b5', parent: L.g });
      if (mdl !== 'compiled') {
        L.ops = OPX.map((x, k) => { const b = kit.box(x, y, 0, 1.9, 1.0, 0.8, OPC[k], { parent: L.g }); kit.lbl(OPN[k], x, y + 0.02, 0.55, { size: 0.36, color: '#0b0e17', parent: L.g }); return b; });
      } else {
        L.fused = kit.box(0.2, y, -0.1, 12.0, 1.5, 0.5, C.good, { opacity: 0.18, em: 0.4, parent: L.g });
        L.ops = OPX.map((x, k) => { const b = kit.box(x, y, 0.1, 1.6, 0.8, 0.5, OPC[k], { parent: L.g }); kit.lbl(OPN[k], x, y + 0.02, 0.5, { size: 0.32, color: '#0b0e17', parent: L.g }); return b; });
        kit.lbl('for (t : scan) { if (p(t)) sum[g(t)] += f(t) }  // tuple stays in registers', -1.5, y - 0.95, 0.5, { size: 0.27, color: '#9ece6a', parent: L.g });
        L.reg = kit.box(5.65, y, 0.2, 0.5, 0.5, 0.5, C.warn, { parent: L.g });
      }
      // static arrows: data (green, in gaps) + control (cyan, above): pull = leftwards next(), push = rightwards consume()
      L.dataArr = []; L.pullArr = new THREE.Group(); L.pushArr = new THREE.Group(); L.g.add(L.pullArr, L.pushArr);
      if (mdl !== 'compiled') for (let k = 0; k < 3; k++) {
        const xa = OPX[k] + 1.0, xb = OPX[k + 1] - 1.0;
        L.dataArr.push(kit.arrow(xa, y - 0.2, xb, y - 0.2, C.data, { parent: L.g }));
        if (mdl !== 'materialization') {
          kit.arrow(xb, y + 0.62, xa, y + 0.62, C.ctl, { parent: L.pullArr, th: 0.05 });
          kit.arrow(xa, y + 0.62, xb, y + 0.62, C.ctl, { parent: L.pushArr, th: 0.05 });
        }
      }
      L.lblCtl = kit.dyn(-1.0, y + 1.1, 0.5, { size: 0.26, parent: L.g, color: '#7dcfff' });
      L.out = kit.dyn(8.1, y + 0.2, 0.5, { size: 0.25, parent: L.g }); L.bar = kit.box(8.1 - 1.4, y - 0.5, 0.1, 0.01, 0.2, 0.2, C.good, { parent: L.g });
      L.over = kit.box(0, y, 0.85, 20.0, 2.66, 0.05, C.bg, { opacity: 0.0, em: 0, parent: L.g });
      L.t = 0; L.n = 0; L.scanned = 0; L.vcalls = 0; L.script = null; L.stack = [0, 0, 0, 0]; L.flash = [0, 0, 0, 0]; L.hopIdx = -1;
      lanes.push(L);
    });
    // vtable markers (volcano / vectorized)
    [0, 1].forEach(i => { lanes[i].vt = OPX.map((x, k) => kit.box(x, lanes[i].y - 0.78, 0.2, 0.9, 0.18, 0.3, C.bad, { em: 0.1, parent: lanes[i].g })); kit.lbl('vtable ptr -> next()', OPX[0], lanes[i].y - 1.0, 0.4, { size: 0.2, color: '#f7768e', parent: lanes[i].g }); });
    // volcano tokens
    const V = lanes[0]; V.call = kit.sphere(0, 0, 0.5, 0.3, C.ctl, { parent: V.g }); V.tup = kit.box(0, 0, 0.5, 0.4, 0.4, 0.4, C.tuple, { parent: V.g });
    // vectorized batch of 8 cells (stands for 1024)
    const W = lanes[1]; W.call = kit.sphere(0, 0, 0.5, 0.3, C.ctl, { parent: W.g }); W.batch = new THREE.Group(); W.g.add(W.batch); W.cells = [];
    for (let c = 0; c < 8; c++) W.cells.push(kit.box((c - 3.5) * 0.19, 0, 0, 0.16, 0.45, 0.4, C.tuple, { parent: W.batch }));
    W.sel = kit.box(0, -0.45, 0, 1.0, 0.16, 0.3, C.ctl, { parent: W.batch }); W.selLbl = kit.lbl('sel[]=[0,3,4,7..]', 0, -0.72, 0.4, { size: 0.24, color: '#7dcfff', parent: W.batch });
    const selPat = [1, 0, 0, 1, 1, 0, 0, 1], dimMat = kit.mat(C.grey, { em: 0.1 }), hiMat = W.cells[0].material;
    // materialization blocks
    const M = lanes[2]; const bw = [3.0, 1.2, 1.0, 0.12], bl = ['1M rows 24MB', '400k rows 9.6MB', '400k x 1col 3.2MB', '1 row'];
    M.blocks = OPX.map((x, k) => { const b = kit.box(x - 1.5, M.y - 0.78, 0.1, 0.01, 0.28, 0.4, OPC[k], { parent: M.g }); b.userData.w = bw[k]; b.userData.x0 = x - 1.5; kit.lbl(bl[k], x, M.y - 1.1, 0.4, { size: 0.24, color: '#8a93b5', parent: M.g }); return b; });
    // compiled tokens
    const Cc = lanes[3]; const tl = makeTL({ ...kit, group: Cc.g, cmat: kit.cmat, boxGeo: kit.boxGeo, sphGeo: kit.sphGeo });
    for (let i = 0; i < 16; i++) tl.add({ path: [[-6.0, Cc.y], [5.4, Cc.y]], t0: i * 0.18, dur: 0.5, size: 0.28, shrink: i % 3 === 2, color: C.tuple, ease: false });

    const out = lanes.map(L => L.out);
    const applyDir = () => {
      const push = cfg['data-direction'] === 'push';
      lanes.forEach(L => {
        L.pullArr.visible = !push && L.mdl !== 'compiled' && L.mdl !== 'materialization';
        L.pushArr.visible = push && L.mdl !== 'compiled' && L.mdl !== 'materialization';
        L.lblCtl.set(L.mdl === 'compiled' ? 'control: push, produce()/consume() inlined' : L.mdl === 'materialization' ? 'control: driver runs each op to completion' : push ? 'control flow: consume(tuple) ->' : 'control flow: <- next()', '#7dcfff');
      });
      lanes[0].lblCtl.set(push ? 'control: scan loop calls consume(t) ->' : 'control: <- root calls next() down the tree', '#7dcfff');
      lanes[1].lblCtl.set(push ? 'control: scan pushes batch -> consume(batch)' : 'control: <- next() returns a batch (DuckDB pre-2021 / X100)', '#7dcfff');
    };
    const applyFocus = () => {
      const sel = focus >= 0 ? focus : MODELS.indexOf(cfg['exec-model']);
      lanes.forEach((L, i) => { L.over.material.opacity = i === sel ? 0 : 0.62; L.over.material.transparent = true; L.frame.material.opacity = i === sel ? 0.55 : 0; L.panel.material.emissiveIntensity = i === sel ? 0.4 : 0.12; });
    };
    applyDir(); applyFocus();

    function advanceLane(L, dt, isVec) {
      const push = cfg['data-direction'] === 'push';
      const cd = isVec ? 0.16 : 0.2, dd = isVec ? 0.6 : 0.3;
      if (!L.script) { L.drop = !isVec && (L.n % 3 === 2); L.script = makeScript(push, L.drop); L.total = L.script.reduce((s, h) => s + (h.k === 'call' ? cd : dd), 0) + 0.05; L.t = 0; L.hopIdx = -1; if (!push) { L.vcalls++; L.stack[3] = 1; } }
      L.t += dt; let acc = 0, idx = 0, within = 0;
      for (; idx < L.script.length; idx++) { const d = L.script[idx].k === 'call' ? cd : dd; if (L.t < acc + d) { within = (L.t - acc) / d; break; } acc += d; }
      if (idx >= L.script.length) { // finished
        L.script = null; L.n++; L.stack = [0, 0, 0, 0]; L.cur = null; return;
      }
      const h = L.script[idx];
      if (idx !== L.hopIdx) { // hop start
        if (L.hopIdx >= 0) { const p = L.script[L.hopIdx]; if (p.k === 'call') { L.stack[p.b] = 1; L.flash[p.b] = 0.25; } else { L.flash[p.b] = 0.25; } }
        L.hopIdx = idx;
        if (h.k === 'call') L.vcalls++; else { if (push) L.vcalls++; if (h.a === 0) L.scanned += isVec ? 1024 : 1; if (!push) L.stack[h.a] = 0; }
      }
      L.cur = { h, u: within };
    }
    function drawLane(L, isVec) {
      const c = L.cur; const tokCall = L.call, tok = isVec ? L.batch : L.tup; if (tokCall) tokCall.visible = false; tok.visible = false;
      L.ops.forEach((o, k) => { o.material.emissiveIntensity = 0.25 + (L.stack[k] ? 0.5 : 0) + L.flash[k] * 2; });
      if (L.vt) L.vt.forEach((v, k) => { v.material.emissiveIntensity = 0.1 + L.flash[k] * 5; });
      if (!c) return; const h = c.h, a = OPX[h.a], b = OPX[h.b], x = lerp(a, b, ease(c.u));
      if (h.k === 'call') { tokCall.visible = true; tokCall.position.set(x, L.y + 0.62, 0.6); }
      else {
        tok.visible = true; const base = isVec ? 1 : 0.4; tok.position.set(x, L.y, 0.5); tok.scale.setScalar(base);
        if (!isVec && h.drop && c.u > 0.6) { tok.position.y -= (c.u - 0.6) * 3; tok.scale.setScalar(base * Math.max(0.05, 1 - (c.u - 0.6) * 2.4)); }
        if (isVec) { const sel = h.a >= 1; L.sel.visible = sel; L.selLbl.visible = sel; L.cells.forEach((cl, i) => { cl.material = sel && !selPat[i] ? dimMat : hiMat; }); }
      }
      if (isVec) { L.sel.visible = c.h.k === 'data' && c.h.a >= 1; }
    }
    function readouts() {
      const sel = MODELS.indexOf(cfg['exec-model']);
      lanes.forEach((L, i) => {
        const p = perf(L.mdl, B); let s;
        if (L.mdl === 'volcano') { const r = L.scanned ? (L.vcalls / L.scanned).toFixed(1) : '4.0'; s = `~${p.ipt} instr/tuple\n${r} virtual calls/tuple\n~${p.mt.toFixed(0)} Mtuples/s/core`; }
        else if (L.mdl === 'vectorized') s = `~${p.ipt.toFixed(0)} instr/tuple (B=${B})\n${(4 / B).toFixed(3)} virtual calls/tuple\n~${p.mt.toFixed(0)} Mtuples/s/core${p.spill ? '\nvectors spill L1!' : ''}`;
        else if (L.mdl === 'materialization') s = `~${p.ipt} instr/tuple, DRAM-bound\n0 calls/tuple, 4 per query\n~${p.mt} Mtuples/s/core\npeak intermed. ~37 MB`;
        else s = `~${p.ipt} instr/tuple\n0 virtual calls (inlined)\n~${p.mt.toFixed(0)} Mtuples/s/core\n+ compile latency`;
        L.out.set(s, i === sel ? '#d7def5' : '#8a93b5');
        L.bar.scale.x = Math.max(0.02, 2.8 * Math.log10(Math.max(p.mt, 1)) / 2.9); L.bar.position.x = 8.1 - 1.4 + L.bar.scale.x / 2; L.bar.position.y = L.y - 1.12;
        L.bar.material.color.setHex(i === sel ? C.good : C.grey); L.bar.material.emissive.setHex(i === sel ? C.good : C.grey);
      });
    }
    let rt = 0; readouts();
    return finish(kit, ctx, {
      update(dt, t) {
        lanes.forEach(L => { for (let k = 0; k < 4; k++) L.flash[k] = Math.max(0, L.flash[k] - dt); });
        advanceLane(V, dt, false); drawLane(V, false);
        advanceLane(W, dt, true); drawLane(W, true);
        // materialization: one op at a time over 2.2 s each
        const mt = t % 9.6; M.blocks.forEach((b, k) => { const p = clamp((mt - k * 2.2) / 1.9, 0, 1); b.scale.x = Math.max(0.01, b.userData.w * p); b.position.x = b.userData.x0 + b.scale.x / 2; });
        M.ops.forEach((o, k) => { const act = mt >= k * 2.2 && mt < k * 2.2 + 1.9; o.material.emissiveIntensity = act ? 0.9 : 0.25; });
        tl.render(t % 3.4); Cc.ops.forEach(o => { o.material.emissiveIntensity = 0.5 + 0.3 * Math.sin(t * 12); }); Cc.reg.scale.setScalar(0.6 + 0.12 * Math.sin(t * 20));
        rt += dt; if (rt > 0.4) { rt = 0; readouts(); }
      },
      onConfigChange(c) { cfg = getCfg(c); focus = -1; applyDir(); applyFocus(); readouts(); },
      setParam(id, v) { if (id === 'batch') { B = Math.round(2 ** v); readouts(); } if (id === 'focus') { focus = v === 'config' ? -1 : MODELS.indexOf(v); applyFocus(); } },
      steps: [
        stepper(ctx, '1. Volcano / iterator', 'Every operator exposes <code>next()</code>. The root calls down the tree (virtual call through a vtable, new stack frame, indirect-branch mispredicts) and ONE tuple returns up. Per-tuple interpretation overhead (~100-200 instrs) dwarfs the actual work (filter = 1 compare). Filter that rejects a tuple calls child.next() again.', () => { focus = 0; applyFocus(); }),
        stepper(ctx, '2. Vectorized (X100 / DuckDB / ClickHouse)', 'Same interface but next() returns a <b>batch</b> of ~1024 values in columnar vectors. Interpretation cost is amortised 1000x; primitives are tight, SIMD-friendly loops. Filter does not copy: it emits a <b>selection vector</b> of qualifying positions that downstream operators honour. Drag the batch-size slider: small B = overhead, large B = vectors fall out of L1.', () => { focus = 1; applyFocus(); }),
        stepper(ctx, '3. Materialization (MonetDB BAT / operator-at-a-time)', 'Each operator consumes its WHOLE input and materialises its WHOLE output before the next starts: zero per-tuple calls and perfectly tight loops, but intermediates (here 24 MB -> 9.6 MB -> 3.2 MB) go to DRAM, so it is memory-bandwidth bound. Great for OLTP-like tiny results (VoltDB, stored procs) and for bulk column engines with small data.', () => { focus = 2; applyFocus(); }),
        stepper(ctx, '4. Compiled push (HyPer / Umbra / Hyper-style produce-consume)', 'The plan is cut into pipelines; each pipeline becomes ONE fused loop. The tuple lives in CPU registers from scan to the pipeline breaker (agg hash table), so there are no calls, no intermediate buffers. Cost: compile latency (see <i>codegen</i>) and harder debugging.', () => { focus = 3; applyFocus(); }),
        stepper(ctx, '5. Pull vs push (data-direction)', 'Pull: control flows DOWN (next()), data flows UP; easy LIMIT and early-out, but one virtual call per operator. Push: sources drive and call consume() on parents; allows pipelines to be fused, makes DAG plans/parallel sources natural (DuckDB moved to push in 2021), but LIMIT/early termination needs explicit signalling. Toggle the data-direction slot.', () => { focus = -1; applyFocus(); }),
      ],
    });
  },
  controls: [
    ctlFor('batch', 'batch size 2^n', 'range', { min: 0, max: 14, step: 1, value: 10 }),
    ctlFor('focus', 'focus lane', 'select', { options: ['config', 'volcano', 'vectorized', 'materialization', 'compiled'], value: 'config' }),
  ],
};

/* ============================================================ OPERATORS ============================================================ */
const KEYC = { 1: 0x7aa2f7, 2: 0xe0af68, 3: 0x9ece6a, 4: 0xbb9af7, 5: 0xf7768e };
const operatorsView = {
  build(ctx) {
    const kit = makeKit(ctx); let cfg = getCfg(ctx.config); const tl = makeTL(kit);
    const T = 21;
    const pos = { scanR: [-8.6, -3.6], build: [-2.6, -3.6], scanS: [-8.6, 3.6], filter: [-5.6, 3.6], probe: [-2.6, 3.6], aggB: [0.6, 3.6], aggS: [3.6, 0], sort: [7.4, 0], sortS: [3.6, -3.6], exch: [7.4, -3.6] };
    const regions = [
      { n: 'Pipeline 1: build side', x: -5.6, y: -3.6, w: 8.6, c: C.scan },
      { n: 'Pipeline 2: probe + partial agg', x: -4.0, y: 3.6, w: 11.8, c: C.join },
      { n: 'Pipeline 3: agg -> sort', x: 5.5, y: 0, w: 6.6, c: C.agg },
      { n: 'Pipeline 4: emit via exchange', x: 5.5, y: -3.6, w: 6.6, c: C.exch },
    ].map(r => { const p = kit.panel(r.x, r.y, r.w, 2.5, r.c, { em: 0.08, opacity: 0.35 }); kit.lbl(r.n, r.x - r.w / 2 + 0.2 + r.n.length * 0.1, r.y + 1.0, -0.2, { size: 0.3, color: HEX(r.c) }); return p; });
    const mk = (id, name, color, breaker, sub) => {
      const [x, y] = pos[id]; kit.box(x, y, 0, 2.1, 1.0, 0.8, color); kit.lbl(name, x, y + 0.08, 0.5, { size: 0.34, color: '#0b0e17' });
      if (sub) kit.lbl(sub, x, y - 0.75, 0.5, { size: 0.24, color: breaker ? '#f7768e' : '#9ece6a' });
      if (breaker) { kit.box(x + 1.15, y, 0, 0.14, 1.5, 0.9, C.bad, { em: 0.7 }); }
    };
    mk('scanR', 'Scan R', C.scan, false, 'streaming'); mk('build', 'HashJoin\nBUILD', C.join, true, 'BREAKER: HT');
    mk('scanS', 'Scan S', C.scan, false, 'streaming'); mk('filter', 'Filter\nv<50', C.filter, false, 'streaming'); mk('probe', 'HashJoin\nPROBE', C.join, false, 'streaming (needs HT)');
    mk('aggB', 'Agg\nbuild', C.agg, true, 'BREAKER: groups'); mk('aggS', 'Agg\nscan', C.agg, false, 'streaming'); mk('sort', 'Sort\nbuffer', C.sort, true, 'BREAKER: sort');
    mk('sortS', 'Sort\nscan', C.sort, false, 'streaming'); mk('exch', 'Exchange\nsend', C.exch, true, 'hash(key)%2');
    [['scanR', 'build'], ['scanS', 'filter'], ['filter', 'probe'], ['probe', 'aggB'], ['aggS', 'sort'], ['sortS', 'exch']].forEach(([a, b]) => kit.arrow(pos[a][0] + 1.1, pos[a][1], pos[b][0] - 1.15, pos[b][1], C.data, { z: 0 }));
    kit.arrow(pos.aggB[0] + 0.9, pos.aggB[1] - 0.6, pos.aggS[0] - 0.3, pos.aggS[1] + 0.6, C.warn, { z: 0 });
    kit.arrow(pos.sort[0] - 0.3, pos.sort[1] - 0.6, pos.sortS[0] + 0.3, pos.sortS[1] + 0.6, C.warn, { z: 0 });
    // hash-table buckets (build side) and probe dependency
    const bucketX = b => pos.build[0] + (b - 1.5) * 0.62; kit.panel(pos.build[0], -2.45, 2.6, 1.05, 0x2a2f45, { z: -0.1 });
    for (let b = 0; b < 4; b++) kit.lbl('b' + b, bucketX(b), -2.95, 0.4, { size: 0.22, color: '#8a93b5' });
    kit.lbl('hash table: bucket = key % 4', pos.build[0], -1.7, 0.4, { size: 0.24, color: '#ff9e64' });
    kit.polyline([[pos.probe[0], pos.probe[1] - 0.6, 0], [pos.probe[0], -1.9, 0]], C.warn, { opacity: 0.5 });
    kit.lbl('probe waits for HT\n(dependency)', pos.probe[0] + 1.35, 1.6, 0.4, { size: 0.24, color: '#e0af68' });
    const gx = g => pos.aggB[0] + (g - 2) * 0.62 - 0.0; kit.lbl('groups', pos.aggB[0], 5.3, 0.4, { size: 0.22, color: '#9ece6a' });
    kit.lbl('R(k) build: [1,2,3,2,4,3]    S(k,v) probe: k=[2,1,3,3,4,5,2,1,3,2] v=[10,20,20,45,90,30,15,60,35,5]', 0, 5.75, 0.4, { size: 0.26, color: '#8a93b5' });
    // materialization buffers (only exec-model=materialization)
    const matBufs = new THREE.Group(); kit.group.add(matBufs);
    [['scanS', 'filter'], ['filter', 'probe'], ['scanR', 'build'], ['aggS', 'sort']].forEach(([a, b]) => { const x = (pos[a][0] + pos[b][0]) / 2, y = pos[a][1] - 0.55; kit.box(x, y, 0.1, 0.8, 0.4, 0.5, C.grey, { parent: matBufs }); kit.lbl('full\nresult', x, y - 0.55, 0.4, { size: 0.2, color: '#8a93b5', parent: matBufs }); });
    // ----- token timelines
    const Rk = [1, 2, 3, 2, 4, 3], Sk = [2, 1, 3, 3, 4, 5, 2, 1, 3, 2], Sv = [10, 20, 20, 45, 90, 30, 15, 60, 35, 5];
    const lvl = {}; const B1 = 0.4, B2 = 5.2, EM = 11.8;
    const emitOrder = [2, 1, 3], sums = { 2: 30, 1: 20, 3: 100 }; const sortedOrder = [3, 2, 1];
    Rk.forEach((k, i) => { const b = k % 4; const l = (lvl['b' + b] = (lvl['b' + b] || 0) + 1) - 1;
      tl.add({ path: [[pos.scanR[0], pos.scanR[1]], [pos.build[0], pos.build[1]], [bucketX(b), -2.55 + l * 0.34]], t0: B1 + i * 0.55, dur: 1.3, stay: true, color: KEYC[k], size: 0.3 }); });
    const glv = {};
    Sk.forEach((k, i) => {
      const t0 = B2 + i * 0.55; const pass = Sv[i] < 50; const match = k !== 5; const [sx, sy] = pos.scanS;
      if (!pass) { tl.add({ path: [[sx, sy], [pos.filter[0], sy], [pos.filter[0], 2.3]], t0, dur: 1.5, color: KEYC[k], size: 0.3, shrink: true, ease: false }); return; }
      if (!match) { tl.add({ path: [[sx, sy], [pos.filter[0], sy], [pos.probe[0], sy], [pos.probe[0], 2.3]], t0, dur: 2.4, color: KEYC[k], size: 0.3, shrink: true, ease: false }); return; }
      const l = (glv[k] = (glv[k] || 0) + 1) - 1; const emitAt = EM + emitOrder.indexOf(k) * 0.7;
      tl.add({ path: [[sx, sy], [pos.filter[0], sy], [pos.probe[0], sy], [pos.aggB[0], sy], [gx(k), 4.55 + l * 0.34]], t0, dur: 3.0, stay: true, until: emitAt, color: KEYC[k], size: 0.3, ease: false });
      // lookup spark into the bucket
      tl.add({ sphere: true, path: [[pos.probe[0], sy - 0.5], [bucketX(k % 4), -2.3], [pos.probe[0], sy - 0.5]], t0: t0 + 1.6, dur: 1.0, color: C.ctl, size: 0.22, ease: false });
    });
    emitOrder.forEach((k, i) => {
      const t0 = EM + i * 0.7; const ux = 6.5 + i * 0.9, sx2 = 6.5 + sortedOrder.indexOf(k) * 0.9; const sz = 0.3 + sums[k] / 100 * 0.35;
      const t1 = 15.6 + sortedOrder.indexOf(k) * 0.7;
      tl.add({ path: [[gx(k), 4.55], [pos.aggS[0], 0.3], [pos.sort[0], 0.3], [ux, 1.2], [sx2, 1.2]], t0, dur: 3.2, stay: true, until: t1, color: KEYC[k], size: sz });
      const dest = k % 2 === 0 ? [9.5, -2.7] : [9.5, -4.6];
      tl.add({ path: [[sx2, 1.2], [pos.sortS[0], pos.sortS[1]], [pos.exch[0], pos.exch[1]], dest], t0: t1, dur: 2.6, stay: true, color: KEYC[k], size: sz });
    });
    kit.lbl('node0', 9.6, -2.1, 0.4, { size: 0.24, color: '#f7768e' }); kit.lbl('node1', 9.6, -5.2, 0.4, { size: 0.24, color: '#f7768e' });
    kit.lbl('sorted by SUM desc: 3(100) 2(30) 1(20)', 7.4, 2.0, 0.4, { size: 0.24, color: '#2ac3de' });
    const phase = kit.dyn(0, -5.75, 0.4, { size: 0.3, color: '#d7def5' }); const cap = kit.dyn(0, -5.35, 0.4, { size: 0.26, color: '#8a93b5' });
    const phases = [[0, 4.8, 0, 'P1: scanning R into the hash table. Probe CANNOT start: the join build is a pipeline breaker.'], [4.8, 11.4, 1, 'P2: S tuples stream through filter -> probe -> group (no materialization, one pass); key 5 finds no match.'],
      [11.4, 15.3, 2, 'P3: agg is a breaker, so groups are emitted only now, then sorted (blocking).'], [15.3, 19, 3, 'P4: sorted output streams to Exchange: hash(key) % 2 chooses the destination node.'], [19, 21, -1, 'pipeline DAG done, restarting']];
    const capTxt = () => ({ volcano: 'volcano: breakers = operators whose open() drains a child (HT build, agg, sort); the rest are next() pass-throughs', vectorized: 'vectorized: each pipeline streams batches of 1024; breakers consume whole input into a shared structure', materialization: 'materialization: EVERY edge is a breaker: each operator writes its full result buffer (grey boxes)', compiled: 'compiled: each pipeline = one fused loop (tuple in registers); only breakers touch memory' })[cfg['exec-model']];
    const applyCfg = () => { matBufs.visible = cfg['exec-model'] === 'materialization'; cap.set(capTxt()); };
    applyCfg();
    return finish(kit, ctx, {
      update(dt, t) {
        const tt = t % T; tl.render(tt); const ph = phases.find(p => tt >= p[0] && tt < p[1]) || phases[4];
        phase.set(ph[3], '#d7def5'); regions.forEach((r, i) => { r.material.opacity = i === ph[2] ? 0.7 : 0.3; r.material.transparent = true; });
      },
      onConfigChange(c) { cfg = getCfg(c); applyCfg(); },
      steps: [
        stepper(ctx, 'Pipelines and breakers', 'A <b>pipeline</b> is a maximal chain of operators a tuple can flow through without being stored. A <b>pipeline breaker</b> (red) must consume ALL its input before emitting anything: hash-join build, aggregation, sort. The plan splits into 4 pipelines (the <code>pipeline-dag</code> component schedules them with dependencies).'),
        stepper(ctx, 'Hash join: build then probe', 'R is scanned into a hash table (bucket = key % 4). Only after pipeline 1 finishes can S stream through filter -> probe. Each probe tuple does one bucket lookup (cyan spark); a miss (k=5) discards the tuple.'),
        stepper(ctx, 'Aggregation: sink then source', 'Hash agg is two operators: a sink in pipeline 2 (updates group sums as tuples arrive) and a source in pipeline 3 that scans the finished table. Groups 1,2,3 have sums 20,30,100.'),
        stepper(ctx, 'Sort + exchange', 'Sort is also a breaker; its output is only valid once all input is seen. The sorted stream feeds an <b>exchange</b> (hash partition on key) that sends tuples to the node that owns each key range, which is where parallel/distributed plans split into fragments.'),
        stepper(ctx, 'Effect of exec-model', 'Volcano: breakers are operators whose open() drains a child. Vectorized: same, in batches. Materialization: every edge behaves like a breaker. Compiled: each pipeline is generated as ONE loop; breakers are the only places data touches memory.'),
      ],
    });
  },
};

/* ============================================================ SCHEDULER ============================================================ */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const sub = (kit, g) => ({ ...kit, group: g });
const SCHED_TXT = {
  'morsel-driven': 'Morsel-driven (HyPer, Leis SIGMOD14): ~100k-row morsels pulled from a lock-free dispatcher; NUMA-local first, steal remote only when starved; pool resizes at morsel boundaries.',
  'thread-per-core': 'Thread-per-core shared-nothing (Seastar/ScyllaDB): 1 pinned thread per core owns its shard + memory; no locks, cross-core work travels as SPSC messages; skew cannot be stolen.',
  'thread-pool': 'Thread pool: shared FIFO task queue behind a mutex; coarse tasks (whole sub-plans), NUMA-oblivious; the dequeue lock serialises and big tasks cause a long tail.',
  'thread-per-connection': 'Thread-per-connection (classic MySQL/Postgres-process): one OS thread per client, 12 threads on 8 cores, time-sliced by the OS: context switches, 1 MB stacks, no intra-query balance.',
};

const schedulerView = {
  build(ctx) {
    const kit = makeKit(ctx); let cfg = getCfg(ctx.config); let skew = 0.5, nw = 8, pause = 0, focusStep = -1;
    const NC = 8, SW = [-7, -3.6, 3.6, 7]; const cores = [];
    for (let s = 0; s < 2; s++) {
      const cx = s ? 5.3 : -5.3; kit.panel(cx, 1.4, 8.0, 4.8, s ? 0xff9e64 : 0x7aa2f7, { opacity: 0.18, em: 0.1 });
      kit.lbl(`NUMA node ${s}`, cx, 4.0, 0, { size: 0.32, color: s ? '#ff9e64' : '#7aa2f7' });
      kit.box(cx, -1.3, 0, 7.2, 0.5, 0.5, s ? 0xff9e64 : 0x7aa2f7, { opacity: 0.5, em: 0.2 }); kit.lbl(`DRAM ${s}  (morsels homed here: ${s ? 'orange' : 'blue'})`, cx, -1.3, 0.5, { size: 0.26, color: '#0b0e17' });
    }
    kit.box(0, 1.25, 0, 1.4, 0.18, 0.2, C.grey, { em: 0.2 }); kit.lbl('UPI/QPI\nremote = ~1.6x slower', 0, 1.9, 0.3, { size: 0.24, color: '#8a93b5' });
    for (let i = 0; i < NC; i++) {
      const s = i < 4 ? 0 : 1, k = i % 4, x = (s ? 5.3 : -5.3) + (k % 2 ? 1.8 : -1.8), y = k < 2 ? 2.4 : -0.1;
      const body = kit.box(x, y, 0, 2.7, 1.5, 0.5, C.grey, { em: 0.2 }); const prog = kit.box(x - 1.2, y - 0.52, 0.45, 0.01, 0.13, 0.1, C.warn, { em: 0.8 });
      kit.lbl('core ' + i, x, y + 0.5, 0.35, { size: 0.24, color: '#d7def5' });
      const rem = kit.arrow(x, y - 0.75, (s ? -5.3 : 5.3), -1.3, C.bad, { z: 0.3 }); rem.visible = false;
      const bar = kit.box(-7 + i * 2, -5.2, 0, 1.1, 0.01, 0.4, C.good, { em: 0.3 }); kit.lbl('c' + i, -7 + i * 2, -5.65, 0.3, { size: 0.24, color: '#8a93b5' });
      cores.push({ x, y, s, body, prog, rem, bar });
    }
    kit.lbl('core utilisation (busy / elapsed)', 0, -3.5, 0.3, { size: 0.28, color: '#8a93b5' });
    kit.box(0, -5.2, -0.1, 16.5, 0.02, 0.05, C.grey, { opacity: 0.5 });
    kit.box(0, -3.6, -0.1, 16.5, 0.02, 0.05, C.grey, { opacity: 0.3 }); kit.lbl('100%', 8.9, -3.6, 0.3, { size: 0.22, color: '#8a93b5' });
    const qPanel = kit.panel(0, 4.9, 9.0, 1.0, 0x2a2f45, { z: -0.2 }); const qLbl = kit.dyn(-4.2, 5.55, 0.3, { size: 0.26, color: '#8a93b5' });
    const caption = kit.dyn(0, 5.75, 0.3, { size: 0.0 }); // placeholder keeps API symmetrical
    const lockBox = kit.box(0, 3.9, 0, 0.5, 0.35, 0.3, C.warn, { em: 0.2 }); const lockLbl = kit.dyn(0, 3.5, 0.3, { size: 0.24, color: '#e0af68' });
    const stats = kit.dyn(0, -2.6, 0.4, { size: 0.26, color: '#d7def5' });
    const tasks = []; for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(kit.boxGeo, kit.mat(C.scan)); m.visible = false; kit.group.add(m); tasks.push(m); }
    const msgs = []; for (let i = 0; i < 5; i++) { const m = kit.sphere(0, 0, 0.6, 0.25, C.ctl); m.visible = false; msgs.push(m); }
    let sim = null; const matA = [kit.mat(C.scan), kit.mat(0xff9e64)];

    function newSim() {
      const mode = cfg.scheduling; const rng = mulberry32(11); const heavy = new Set(); for (let j = 0; j < Math.round(skew * 8); j++) heavy.add(3 + 5 * j);
      const m = []; for (let i = 0; i < 48; i++) m.push({ id: i, cost: heavy.has(i) ? 3.2 : 0.75 + rng() * 0.5, home: i % 2, heavy: heavy.has(i), state: 'queued', owner: heavy.has(i) ? 3 : i % 8 });
      let ts = m;
      if (mode === 'thread-pool' || mode === 'thread-per-connection') {
        ts = []; for (let g = 0; g < 12; g++) { const part = m.slice(4 * g, 4 * g + 4); ts.push({ id: g, cost: part.reduce((a, b) => a + b.cost, 0), home: g % 2, heavy: part.some(p => p.heavy), state: 'queued', owner: g % 8 }); }
      }
      ts.forEach(t => { t.rem = t.cost; });
      sim = { mode, tasks: ts, queue: mode === 'thread-per-core' ? [] : ts.slice(), inbox: Array.from({ length: NC }, () => []), lock: { by: -1, rem: 0 }, time: 0, done: 0, finished: false, remoteN: 0, starts: 0, makespan: 0, msgs: [], rng,
        cores: cores.map(() => ({ state: 'idle', task: null, rem: 0, rate: 1, busy: 0, slice: 0, cs: 0, remote: false })), switches: 0 };
      if (mode === 'thread-per-core') ts.forEach(t => sim.inbox[t.owner].push(t));
      tasks.forEach((mm, i) => { mm.visible = i < ts.length; if (i < ts.length) { const t = ts[i]; mm.material = matA[t.home]; const sz = clamp(0.18 + 0.1 * t.cost, 0.25, 0.7); mm.scale.setScalar(sz * (mode === 'thread-pool' || mode === 'thread-per-connection' ? 0.9 : 1)); mm.position.set(0, 7, 0.3); } });
      pause = 0;
    }
    function start(sc, c, t, remote) { sc.task = t; t.state = 'run'; sc.rem = t.rem; sc.rate = remote ? 0.62 : 1; sc.remote = remote; sc.state = 'run'; sc.slice = 0.7; sim.starts++; if (remote) sim.remoteN++; }
    function step(dt) {
      const S = sim; if (S.finished) return; S.time += dt;
      if (S.lock.by >= 0) { S.lock.rem -= dt; if (S.lock.rem <= 0) { const sc = S.cores[S.lock.by], t = S.queue.shift(); S.lock.by = -1; if (t) start(sc, cores[0], t, t.home !== cores[S.cores.indexOf(sc)].s); else sc.state = 'idle'; } }
      S.cores.forEach((sc, i) => {
        const c = cores[i], active = i < nw;
        if (sc.state === 'parked' || sc.state === 'idle' || sc.state === 'lockwait') {
          if (!active) { sc.state = 'parked'; return; } sc.state = 'idle';
          if (S.mode === 'morsel-driven') { if (S.queue.length) { let idx = S.queue.findIndex(t => t.home === c.s), remote = false; if (idx < 0) { idx = 0; remote = true; } const t = S.queue.splice(idx, 1)[0]; start(sc, c, t, remote); } }
          else if (S.mode === 'thread-per-core') { if (S.inbox[i].length) start(sc, c, S.inbox[i].shift(), false); }
          else if (S.mode === 'thread-pool') { if (S.queue.length) { if (S.lock.by < 0) { S.lock.by = i; S.lock.rem = 0.22; sc.state = 'locked'; } else sc.state = 'lockwait'; } }
          else if (S.mode === 'thread-per-connection') { if (S.queue.length) { const t = S.queue.shift(); sc.task = t; t.state = 'run'; sc.state = 'cs'; sc.cs = 0.15; sc.rem = t.rem; S.switches++; } }
        } else if (sc.state === 'cs') { sc.cs -= dt; if (sc.cs <= 0) { sc.state = 'run'; sc.slice = 0.7; sc.rate = 1; } }
        else if (sc.state === 'run') {
          sc.busy += dt; sc.rem -= dt * sc.rate; sc.slice -= dt; sc.task.rem = sc.rem;
          if (sc.rem <= 0) { sc.task.state = 'done'; S.done++; if (S.mode === 'thread-per-core' && S.rng() < 0.35) { let to = Math.floor(S.rng() * NC); if (to === i) to = (to + 1) % NC; S.msgs.push({ from: i, to, t: 0 }); if (S.cores[to].state === 'run') S.cores[to].rem += 0.06; } sc.task = null; sc.state = 'idle'; }
          else if (S.mode === 'thread-per-connection' && sc.slice <= 0 && S.queue.length) { sc.task.state = 'queued'; S.queue.push(sc.task); sc.task = null; sc.state = 'idle'; }
        }
      });
      S.msgs.forEach(m => { m.t += dt / 0.6; }); S.msgs = S.msgs.filter(m => m.t < 1);
      if (S.done === S.tasks.length) { S.finished = true; S.makespan = S.time; }
    }
    function layout() {
      const S = sim; let qi = 0;
      const inboxIdx = Array(NC).fill(0);
      S.tasks.forEach((t, idx) => {
        const m = tasks[idx]; let tx, ty, tz = 0.3;
        if (t.state === 'run') { const ci = S.cores.findIndex(c => c.task === t); const c = cores[ci]; tx = c.x - 0.7; ty = c.y + 0.0; tz = 0.6; }
        else if (t.state === 'done') { tx = m.position.x; ty = m.position.y; m.scale.multiplyScalar(0.9); if (m.scale.x < 0.02) m.visible = false; return; }
        else if (S.mode === 'thread-per-core') { const c = cores[t.owner]; const j = inboxIdx[t.owner]++; tx = c.x - 1.1 + (j % 8) * 0.31; ty = c.y + 0.95 + Math.floor(j / 8) * 0.0; if (j >= 8) m.visible = false; else m.visible = true; }
        else { const j = S.queue.indexOf(t); const big = S.mode === 'thread-pool' || S.mode === 'thread-per-connection'; tx = big ? -4.0 + j * 0.7 : -4.1 + (j % 24) * 0.34; ty = big ? 4.9 : 5.15 - Math.floor(j / 24) * 0.4; qi++; }
        m.position.x += (tx - m.position.x) * 0.25; m.position.y += (ty - m.position.y) * 0.25; m.position.z = tz;
      });
      S.cores.forEach((sc, i) => {
        const c = cores[i]; const col = sc.state === 'run' ? (sc.remote ? C.bad : C.good) : sc.state === 'cs' ? 0xbb9af7 : sc.state === 'lockwait' ? C.warn : sc.state === 'locked' ? 0xff9e64 : sc.state === 'parked' ? 0x22263a : C.grey;
        c.body.material.color.setHex(col); c.body.material.emissive.setHex(col);
        c.prog.scale.x = sc.state === 'run' && sc.task ? Math.max(0.01, 2.4 * (1 - sc.rem / sc.task.cost)) : 0.01; c.prog.position.x = c.x - 1.2 + c.prog.scale.x / 2;
        c.rem.visible = sc.state === 'run' && sc.remote;
        const u = S.time > 0 ? sc.busy / S.time : 0; c.bar.scale.y = Math.max(0.01, u * 1.6); c.bar.position.y = -5.2 + c.bar.scale.y / 2 - 0.0; const bc = u > 0.8 ? C.good : u > 0.5 ? C.warn : C.bad; c.bar.material.color.setHex(bc); c.bar.material.emissive.setHex(bc);
      });
      msgs.forEach((m, i) => { const g = S.msgs[i]; if (!g) { m.visible = false; return; } m.visible = true; const a = cores[g.from], b = cores[g.to]; m.position.set(lerp(a.x, b.x, g.t), lerp(a.y, b.y, g.t) + 0.2 + Math.sin(g.t * Math.PI) * 0.8, 0.7); });
      qPanel.visible = S.mode !== 'thread-per-core'; lockBox.visible = lockLbl && S.mode === 'thread-pool'; lockBox.material.color.setHex(S.lock.by >= 0 ? C.bad : C.good); lockBox.material.emissive.setHex(S.lock.by >= 0 ? C.bad : C.good);
      lockLbl.set(S.mode === 'thread-pool' ? (S.lock.by >= 0 ? 'queue mutex HELD by core ' + S.lock.by : 'queue mutex free') : '', '#e0af68');
      const busy = S.cores.reduce((a, c) => a + c.busy, 0), act = Math.max(1, Math.min(nw, NC)); const avg = S.time > 0 ? busy / (act * S.time) : 0;
      stats.set(`${S.finished ? 'DONE' : 't'} = ${S.time.toFixed(1)}s   tasks ${S.done}/${S.tasks.length}\navg utilisation ${(avg * 100).toFixed(0)}% of ${act} workers\n` + (S.mode === 'morsel-driven' ? `remote (stolen) morsels ${S.starts ? (100 * S.remoteN / S.starts).toFixed(0) : 0}%` : S.mode === 'thread-per-core' ? 'cross-core messages in flight: ' + S.msgs.length : S.mode === 'thread-pool' ? `NUMA-oblivious remote starts ${S.starts ? (100 * S.remoteN / S.starts).toFixed(0) : 0}%` : `context switches ${S.switches}`), '#d7def5');
      qLbl.set(S.mode === 'thread-per-core' ? 'per-core inbox (SPSC queues) above each core' : S.mode === 'morsel-driven' ? 'dispatcher: global morsel queue (blue/orange = NUMA home)' : S.mode === 'thread-pool' ? 'shared task queue (coarse tasks = 4 morsels)' : 'runnable thread queue (12 connections / 8 cores)', '#8a93b5');
    }
    const cap = kit.dyn(0, 6.0, 0.3, { size: 0.24, color: '#9ece6a' });
    const upd = () => cap.set(SCHED_TXT[cfg.scheduling].slice(0, 128) + (SCHED_TXT[cfg.scheduling].length > 128 ? '..' : ''), '#9ece6a');
    newSim(); upd();
    return finish(kit, ctx, {
      update(dt) {
        dt = Math.max(0, dt);
        if (sim.finished) { pause += dt; if (pause > 3) newSim(); } else step(dt);
        layout();
      },
      onConfigChange(c) { cfg = getCfg(c); newSim(); upd(); },
      setParam(id, v) { if (id === 'skew') { skew = +v; newSim(); } if (id === 'workers') { nw = +v; } if (id === 'restart') newSim(); },
      steps: [
        stepper(ctx, 'Why scheduling matters', 'The scheduler decides WHICH core runs WHICH piece of work. Goals: keep all cores busy (load balance), keep data NUMA-local, avoid lock contention on the work queue, and adapt to skew. Watch the utilisation bars at the bottom.', () => { }),
        stepper(ctx, 'Morsel-driven (HyPer / Umbra / DuckDB-like)', SCHED_TXT['morsel-driven'] + ' Work is cut into small morsels so a slow morsel can never strand a core; each worker prefers morsels whose data sits in its own NUMA node (red = remote access, ~1.6x slower). Set <b>skew</b> up: utilisation stays high. Drop <b>workers</b> mid-query: cores park only at morsel boundaries (elastic).', () => { }),
        stepper(ctx, 'Thread-per-core shared-nothing', SCHED_TXT['thread-per-core'] + ' Raise skew: the hot shard (core 3) is a straggler while others idle; cyan packets are cross-core messages.', () => { }),
        stepper(ctx, 'Thread pool', SCHED_TXT['thread-pool'] + ' Yellow cores wait for the queue mutex; coarse tasks leave a long tail.', () => { }),
        stepper(ctx, 'Thread-per-connection', SCHED_TXT['thread-per-connection'] + ' Purple = context switch overhead.', () => { }),
      ],
    });
  },
  controls: [
    ctlFor('skew', 'skew (heavy morsels)', 'range', { min: 0, max: 1, step: 0.25, value: 0.5 }),
    ctlFor('workers', 'active workers', 'range', { min: 2, max: 8, step: 1, value: 8 }),
    ctlFor('restart', 'Restart', 'button', {}),
  ],
};

/* ============================================================ PARALLELISM ============================================================ */
const KEYS16 = [1, 2, 2, 3, 2, 4, 2, 1, 3, 2, 4, 2, 3, 1, 2, 4];
const parallelismView = {
  build(ctx) {
    const kit = makeKit(ctx); let cfg = getCfg(ctx.config); let part = 'hash';
    const gA = new THREE.Group(), gB = new THREE.Group(), gC = new THREE.Group(); kit.group.add(gA, gB, gC);
    const tlA = makeTL(sub(kit, gA)), tlB = makeTL(sub(kit, gB)), tlC = makeTL(sub(kit, gC));
    // ---------- A: inter-query
    const qs = [['Q1  point lookup', 3.6, 5.5, C.scan], ['Q2  big aggregate', 0.4, 9.0, C.agg], ['Q3  join report', -2.8, 7.0, C.join]];
    const barsA = qs.map(([n, y, d, c], i) => {
      kit.box(-8.3, y, 0, 1.8, 1.2, 0.6, C.grey, { parent: gA }); kit.lbl('Core ' + i, -8.3, y, 0.4, { size: 0.3, parent: gA });
      kit.lbl(n, -3.5, y + 1.15, 0.3, { size: 0.28, color: HEX(c), parent: gA });
      ['Scan', 'Join', 'Agg'].forEach((o, k) => { kit.box(-5.2 + k * 3.6, y, 0, 2.2, 0.9, 0.6, [C.scan, C.join, C.agg][k], { parent: gA }); kit.lbl(o, -5.2 + k * 3.6, y, 0.4, { size: 0.3, color: '#0b0e17', parent: gA }); });
      for (let k = 0; k < Math.floor(d / 0.7); k++) tlA.add({ path: [[-6.3, y], [-3.6, y], [0, y], [3.6, y]], t0: k * 0.7, dur: 2.0, color: c, size: 0.28, ease: false });
      kit.box(1.5, y - 0.85, 0, 13, 0.14, 0.1, C.grey, { em: 0.1, parent: gA }); const b = kit.box(-5, y - 0.85, 0.1, 0.01, 0.14, 0.12, c, { parent: gA }); b.userData = { d }; return b;
    });
    kit.lbl('3 independent queries on 3 cores: throughput x3, but each query\'s latency is unchanged and they contend for buffer pool / locks / memory bandwidth.', 0, 5.3, 0.3, { size: 0.28, color: '#9ece6a', parent: gA });
    const aLat = kit.dyn(0, -5.3, 0.3, { size: 0.3, parent: gA });
    // ---------- B: intra-operator (parallel aggregate over 4 morsel ranges)
    const ys = [3.6, 1.2, -1.2, -3.6];
    ys.forEach((y, i) => {
      kit.box(-8.2, y, 0, 2.0, 1.0, 0.6, C.scan, { parent: gB }); kit.lbl('rows ' + (i * 25) + '-' + (i * 25 + 24) + '%', -8.2, y, 0.4, { size: 0.24, color: '#0b0e17', parent: gB });
      kit.box(-4.6, y, 0, 2.4, 1.0, 0.6, C.agg, { parent: gB }); kit.lbl('worker ' + i + '\nscan+local agg', -4.6, y, 0.4, { size: 0.22, color: '#0b0e17', parent: gB });
      kit.panel(-0.4, y, 2.6, 1.0, 0x2a2f45, { parent: gB, z: -0.1 }); kit.lbl('thread-local HT', -0.4, y - 0.75, 0.3, { size: 0.2, color: '#8a93b5', parent: gB });
      kit.arrow(-7.1, y, -5.9, y, C.data, { parent: gB }); kit.arrow(-3.35, y, -1.8, y, C.data, { parent: gB });
      const keys = [0, 1, 2, 3, 4].map(j => ((i + j * 2) % 3) + 1); const cnt = {};
      keys.forEach((k, j) => { const l = (cnt[k] = (cnt[k] || 0) + 1) - 1; tlB.add({ path: [[-8.2, y], [-4.6, y], [-0.4 + (k - 2) * 0.7, y - 0.15 + l * 0.3]], t0: 0.3 + j * 0.45 + i * 0.12, dur: 1.5, stay: true, until: 6.8 + i * 0.1, color: KEYC[k], size: 0.25 }); });
      [1, 2, 3].forEach((k, gi) => { if (!keys.includes(k)) return; const n = keys.filter(x => x === k).length; tlB.add({ path: [[-0.4 + (k - 2) * 0.7, y], [3.0, 0.5 + (k - 2) * 1.3 + 0 * y], [4.5, (k - 2) * 1.3]], t0: 6.8 + i * 0.1, dur: 1.6, stay: false, until: 99, color: KEYC[k], size: 0.2 + 0.05 * n }); });
    });
    kit.box(4.5, 0, 0, 2.2, 5.2, 0.6, C.sort, { opacity: 0.35, parent: gB }); kit.lbl('merge partial aggs\n(global HT)', 4.5, 3.3, 0.4, { size: 0.26, parent: gB });
    [1, 2, 3].forEach(k => { const t0 = 8.5; tlB.add({ path: [[5.0, (k - 2) * 1.3], [4.5, (k - 2) * 1.3], [8.2, (k - 2) * 1.0]], t0, dur: 2.0, stay: true, color: KEYC[k], size: 0.55 }); });
    kit.box(8.2, 0, -0.1, 1.8, 3.6, 0.4, C.good, { opacity: 0.3, parent: gB }); kit.lbl('result\n1,2,3', 8.2, 2.3, 0.4, { size: 0.26, parent: gB });
    kit.lbl('ONE operator, split by data range; each worker aggregates locally (no sharing), partials merged: latency ~ T/4 + merge', 0, 5.5, 0.3, { size: 0.26, color: '#9ece6a', parent: gB });
    const bLat = kit.dyn(0, -5.3, 0.3, { size: 0.3, parent: gB });
    // ---------- C: intra-query exchange
    const cy = [4.2, 1.4, -1.4, -4.2]; let destCnt = [0, 0, 0, 0], netN = 0, total = 0;
    cy.forEach((y, i) => {
      kit.box(-8.3, y, 0, 2.2, 1.1, 0.6, C.scan, { parent: gC }); kit.lbl('scan frag ' + i, -8.3, y, 0.4, { size: 0.24, color: '#0b0e17', parent: gC });
      kit.box(3.6, y, -0.1, 3.3, 1.1, 0.6, C.join, { opacity: 0.5, parent: gC }); kit.lbl('join/agg frag ' + i, 3.6, y + 0.78, 0.4, { size: 0.22, parent: gC });
      cy.forEach(y2 => kit.polyline([[-7.1, y, 0], [-1.0, y, 0], [1.0, y2, 0], [1.9, y2, 0]], 0x3b4261, { parent: gC, opacity: 0.6 }));
    });
    kit.panel(0, 0, 1.0, 10.6, C.exch, { opacity: 0.3, parent: gC, z: -0.2 }); kit.lbl('EXCHANGE', 0, 5.8, 0.3, { size: 0.28, color: '#f7768e', parent: gC });
    kit.box(8.8, 0, 0, 1.8, 3.0, 0.5, C.good, { opacity: 0.4, parent: gC }); kit.lbl('gather\nfinal result', 8.8, 2.0, 0.4, { size: 0.26, parent: gC });
    const cLbl = kit.dyn(0, -5.75, 0.4, { size: 0.28, color: '#d7def5' }); const destLbl = cy.map(y => kit.dyn(5.8, y - 0.0, 0.4, { size: 0.24, parent: gC }));
    const partNote = { hash: 'hash(key)%4: co-locates equal keys (needed for join/agg) but hot key 2 overloads one fragment', range: 'range: keeps order and co-locates keys, but needs boundaries (a hot key still lands in one fragment)', 'round-robin': 'round-robin: perfectly even, but equal keys scatter: fine for stateless ops, WRONG for join/agg', broadcast: 'broadcast: every tuple copied to ALL fragments (small build side): P-1 extra copies of network traffic' };
    function rebuildC() {
      tlC.clear(); destCnt = [0, 0, 0, 0]; netN = 0; total = 0;
      KEYS16.forEach((k, i) => {
        const src = i % 4; const dests = part === 'broadcast' ? [0, 1, 2, 3] : [part === 'hash' ? k % 4 : part === 'range' ? (k <= 1 ? 0 : k === 2 ? 1 + (i % 2) : k === 3 ? 3 : 3) : i % 4];
        dests.forEach(d => { const l = destCnt[d]++; total++; if (d !== src) netN++; tlC.add({ path: [[-8.3, cy[src]], [-4.5, cy[src]], [-0.5, cy[src]], [1.0, cy[d]], [2.2 + (l % 8) * 0.32, cy[d] - 0.15 + Math.floor(l / 8) * 0.3]], t0: 0.3 + i * 0.28, dur: 2.2, stay: true, color: KEYC[k], size: 0.24, ease: false }); });
      });
      cy.forEach((y, d) => { tlC.add({ path: [[3.6, y], [8.8, (y - 0) * 0.3]], t0: 7.5, dur: 1.8, stay: true, color: C.good, size: 0.2 + 0.05 * destCnt[d] }); });
      const mx = Math.max(...destCnt), avg = total / 4;
      destLbl.forEach((l, d) => l.set(`n=${destCnt[d]}`, destCnt[d] === mx && mx > avg * 1.3 ? '#f7768e' : '#9ece6a'));
      cLbl.set(`${part}: tuples over network ${netN}/${total}   fragment load max/avg = ${(mx / avg).toFixed(2)}  -> slowest fragment sets query latency\n${partNote[part]}`, '#d7def5');
    }
    rebuildC();
    const show = () => { gA.visible = cfg.parallelism === 'inter-query'; gB.visible = cfg.parallelism === 'intra-operator'; gC.visible = cfg.parallelism === 'intra-query-exchange'; cLbl.sprite && (cLbl.sprite.visible = gC.visible); destLbl.forEach(l => l.sprite && (l.sprite.visible = gC.visible)); };
    show();
    return finish(kit, ctx, {
      update(dt, t) {
        show(); const ta = t % 12, tb = t % 12.5, tc = t % 11;
        if (gA.visible) { tlA.render(ta); barsA.forEach(b => { const p = clamp(ta / b.userData.d, 0, 1); b.scale.x = Math.max(0.01, 12.5 * p); b.position.x = -5 + b.scale.x / 2; }); aLat.set(ta < 9.1 ? 'running ...' : 'Q1 5.5s, Q2 9.0s, Q3 7.0s: each as long as if alone; 3 queries done in 9.0s instead of 21.5s serial', '#d7def5'); }
        if (gB.visible) { tlB.render(tb); bLat.set('scan+agg time ~ T/4 (4 workers); merge adds a serial tail; speedup < 4x (Amdahl)', '#d7def5'); }
        if (gC.visible) tlC.render(tc);
      },
      onConfigChange(c) { cfg = getCfg(c); show(); },
      setParam(id, v) { if (id === 'partitioning') { part = v; rebuildC(); show(); } },
      steps: [
        stepper(ctx, 'Inter-query parallelism', 'Different queries run concurrently on different cores. Raises throughput for OLTP (thousands of small queries) but does nothing for the latency of one big analytical query.', () => { }),
        stepper(ctx, 'Intra-operator parallelism', 'One operator (scan, aggregate, sort, join build) is split across workers by data range / morsels. Workers build thread-local partial states and then merge them (partial -> final aggregation). Needs a merge step; speedup bounded by the serial part.', () => { }),
        stepper(ctx, 'Intra-query with Exchange', 'The plan is cut into fragments connected by an <b>exchange</b> operator that repartitions tuples (hash / range / round-robin / broadcast). Each fragment runs P copies on different cores/nodes. Pick a partitioning scheme to see network traffic and load imbalance.', () => { }),
        stepper(ctx, 'Partitioning matters', 'Hash partitioning on the join/group key guarantees matching tuples meet, but a hot key (2 here) overloads one fragment: the slowest fragment bounds the whole query. Broadcast avoids repartitioning the big side at the price of P-1 copies of the small one.', () => { }),
      ],
    });
  },
  controls: [ctlFor('partitioning', 'exchange partitioning', 'select', { options: ['hash', 'range', 'round-robin', 'broadcast'], value: 'hash' })],
};

/* ============================================================ CODEGEN ============================================================ */
const CG = { rp: 2.4, rb: 1.2, rj: 3.6, c: 60, NM: 30, CP: 0xe0af68, CJ: 0xf7768e, CH: 0x9ece6a, CB: 0x7aa2f7 }; // rates: aggregate Mtuples/ms over 8 workers; c: LLVM compile ms
function cgSchedule(W) {
  const N = CG.NM, Wm = W / N, out = {};
  const mk = (rateAt, t0) => { const s = [], e = [], tier = []; let t = t0; for (let k = 0; k < N; k++) { const r = rateAt(t); s.push(t); t += Wm / r.v; e.push(t); tier.push(r.tier); } return { s, e, tier }; };
  out.prim = mk(() => ({ v: CG.rp, tier: 'prim' }), 0);
  out.jit = mk(() => ({ v: CG.rj, tier: 'jit' }), CG.c);
  const compile = (W / CG.rb) > CG.c + Math.max(0, W - CG.rb * CG.c) / CG.rj;   // adaptive decision: only compile when it pays off
  out.compile = compile;
  out.hybrid = mk(t => (compile && t >= CG.c ? { v: CG.rj, tier: 'jit' } : { v: CG.rb, tier: 'bc' }), 1);
  out.swapT = compile ? (out.hybrid.s[out.hybrid.tier.indexOf('jit')] ?? Infinity) : Infinity;
  return out;
}
const progressAt = (sch, t, W) => { let p = 0; for (let k = 0; k < CG.NM; k++) { if (t >= sch.e[k]) p += W / CG.NM; else if (t > sch.s[k]) { p += (t - sch.s[k]) / (sch.e[k] - sch.s[k]) * W / CG.NM; break; } else break; } return p; };

const codegenView = {
  build(ctx) {
    const kit = makeKit(ctx); let cfg = getCfg(ctx.config); let W = 600;
    const gP = new THREE.Group(), gJ = new THREE.Group(), gH = new THREE.Group(), gCh = new THREE.Group(); kit.group.add(gP, gJ, gH, gCh);
    const tlP = makeTL(sub(kit, gP)), tlJ = makeTL(sub(kit, gJ));
    // ---- primitives
    const pn = ['sel_lt_i32_col_val', 'map_mul_i32_col_val', 'aggr_sum_i64_col'];
    kit.box(-7.2, 3.9, 0, 1.6, 0.9, 0.5, C.scan, { parent: gP }); kit.lbl('column\nvector[1024]', -7.2, 3.9, 0.4, { size: 0.22, color: '#0b0e17', parent: gP });
    pn.forEach((n, i) => { const x = -3.8 + i * 3.8; kit.box(x, 3.9, 0, 2.4, 1.0, 0.5, CG.CP, { parent: gP }); kit.lbl(n.replace('_col', '\n_col'), x, 3.9, 0.4, { size: 0.2, color: '#0b0e17', parent: gP }); if (i < 2) { kit.box(x + 1.9, 3.9, 0, 0.7, 0.5, 0.3, C.grey, { parent: gP }); kit.lbl('vec\nin L1', x + 1.9, 3.3, 0.4, { size: 0.18, color: '#8a93b5', parent: gP }); } });
    kit.lbl('libprimitives: 1000s of type-specialised, pre-compiled loops (built with the DBMS)  |  plan interpreter just calls function pointers per vector: no compile latency, intermediates materialised', 0, 5.1, 0.3, { size: 0.24, color: '#e0af68', parent: gP });
    for (let k = 0; k < 4; k++) tlP.add({ path: [[-7.2, 3.9], [-3.8, 3.9], [-0.0, 3.9], [3.8, 3.9], [7.0, 3.9]], t0: k * 0.8, dur: 3.2, size: 0.35, color: CG.CP, ease: false });
    // ---- JIT
    const jst = [['SQL plan', C.scan], ['codegen\n-> LLVM IR', C.filter], ['LLVM optimise\n+ emit x86', C.exch], ['machine code\nfused loop', C.good]];
    const jbox = jst.map(([n, c], i) => { const b = kit.box(-6.8 + i * 4.6, 4.1, 0, 3.0, 1.1, 0.5, c, { parent: gJ }); kit.lbl(n, -6.8 + i * 4.6, 4.1, 0.4, { size: 0.24, color: '#0b0e17', parent: gJ }); if (i < 3) kit.arrow(-6.8 + i * 4.6 + 1.6, 4.1, -6.8 + i * 4.6 + 3.0, 4.1, C.ctl, { parent: gJ }); return b; });
    kit.lbl('compile = latency tax paid before the first tuple (HyPer/LLVM: 10s-100s ms, superlinear in plan size); then a fused loop runs at full speed', 0, 5.3, 0.3, { size: 0.24, color: '#f7768e', parent: gJ });
    for (let k = 0; k < 6; k++) tlJ.add({ path: [[-6.8, 4.1], [-2.2, 4.1], [2.4, 4.1], [7.0, 4.1]], t0: k * 8, dur: CG.c * 0.8, size: 0.3, color: C.filter, ease: false });
    const jbar = kit.box(-8, 2.9, 0, 0.01, 0.2, 0.2, CG.CJ, { parent: gJ }); kit.box(0, 2.9, -0.05, 16, 0.2, 0.1, C.grey, { em: 0.1, parent: gJ }); const jTxt = kit.dyn(0, 2.35, 0.3, { size: 0.26, parent: gJ });
    // ---- Hybrid (Umbra / Kohn et al. ICDE'18)
    kit.box(-7.0, 4.2, 0, 2.4, 1.0, 0.5, C.scan, { parent: gH }); kit.lbl('plan -> bytecode\n(ready ~1 ms)', -7.0, 4.2, 0.4, { size: 0.22, color: '#0b0e17', parent: gH });
    const bcBox = kit.box(0.5, 4.5, 0, 3.2, 1.0, 0.5, CG.CB, { parent: gH }); kit.lbl('bytecode interpreter\n(1.2 Mt/ms)', 0.5, 4.5, 0.4, { size: 0.22, color: '#0b0e17', parent: gH });
    const jtBox = kit.box(0.5, 2.7, 0, 3.2, 1.0, 0.5, CG.CH, { parent: gH, em: 0.1 }); kit.lbl('machine code\n(3.6 Mt/ms)', 0.5, 2.7, 0.4, { size: 0.22, color: '#0b0e17', parent: gH });
    kit.box(-3.3, 2.7, 0, 3.0, 1.0, 0.5, CG.CJ, { parent: gH }); kit.lbl('background LLVM\ncompile thread', -3.3, 2.7, 0.4, { size: 0.22, color: '#0b0e17', parent: gH });
    const hbar = kit.box(-4.8, 2.05, 0, 0.01, 0.15, 0.2, CG.CJ, { parent: gH }); kit.box(-3.3, 2.05, -0.05, 3.0, 0.15, 0.1, C.grey, { em: 0.1, parent: gH });
    kit.arrow(-3.3 + 1.6, 2.7, 0.5 - 1.7, 2.7, CG.CJ, { parent: gH });
    const dispatch = kit.box(5.4, 3.6, 0, 2.4, 1.0, 0.5, C.warn, { parent: gH }); kit.lbl('morsel dispatch\nfn ptr (atomic)', 5.4, 3.6, 0.4, { size: 0.2, color: '#0b0e17', parent: gH });
    const aBc = kit.arrow(4.2, 3.8, 2.2, 4.4, CG.CB, { parent: gH }), aJt = kit.arrow(4.2, 3.4, 2.2, 2.8, CG.CH, { parent: gH });
    kit.lbl('start in the interpreter, swap to compiled code at a MORSEL BOUNDARY', 0, 5.4, 0.3, { size: 0.24, color: '#9ece6a', parent: gH });
    const hTxt = kit.dyn(0, 1.5, 0.3, { size: 0.26, parent: gH });
    // ---- chart (always shown)
    const CX0 = -8, CXW = 11.5, CY0 = -5.0, CYH = 3.6; const chartG = new THREE.Group(); gCh.add(chartG);
    kit.box(CX0 + CXW / 2, CY0, 0, CXW, 0.03, 0.03, C.white, { parent: gCh }); kit.box(CX0, CY0 + CYH / 2, 0, 0.03, CYH, 0.03, C.white, { parent: gCh });
    kit.lbl('time (ms)  ->', CX0 + CXW / 2, CY0 - 0.5, 0.2, { size: 0.26, color: '#8a93b5', parent: gCh }); kit.lbl('work done\n(Mtuples)', CX0 - 0.1, CY0 + CYH + 0.45, 0.2, { size: 0.24, color: '#8a93b5', parent: gCh });
    const cursor = kit.box(CX0, CY0 + CYH / 2, 0.1, 0.03, CYH, 0.03, C.white, { opacity: 0.5, parent: gCh }); const dots = [CG.CP, CG.CJ, CG.CH].map(c => kit.sphere(CX0, CY0, 0.3, 0.2, c, { parent: gCh }));
    const strip = []; for (let k = 0; k < CG.NM; k++) strip.push(kit.box(-7.75 + k * (15.5 / CG.NM) + 0.0, 0.35, 0, 15.5 / CG.NM * 0.85, 0.5, 0.3, C.grey, { parent: gCh })); kit.lbl('morsels (' + CG.NM + ' per query)', 0, -0.2, 0.3, { size: 0.22, color: '#8a93b5', parent: gCh });
    const legend = ['precompiled primitives', 'LLVM JIT (blocking)', 'hybrid (Umbra)'].map((n, i) => { kit.box(4.45, -1.4 - i * 0.55, 0, 0.3, 0.3, 0.2, [CG.CP, CG.CJ, CG.CH][i], { parent: gCh }); return kit.dyn(7.3, -1.4 - i * 0.55, 0.3, { size: 0.22, parent: gCh, color: '#c0caf5' }); });
    const done = kit.dyn(7.0, -3.9, 0.3, { size: 0.24, parent: gCh });
    let sch = null, Tmax = 1, markSwap = null;
    function rebuildChart() {
      for (const o of [...chartG.children]) { chartG.remove(o); o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }
      sch = cgSchedule(W); const fin = [sch.prim.e[CG.NM - 1], sch.jit.e[CG.NM - 1], sch.hybrid.e[CG.NM - 1]]; Tmax = Math.max(...fin) * 1.08;
      const X = t => CX0 + t / Tmax * CXW, Y = p => CY0 + p / W * CYH; const sel = ['precompiled-primitives', 'codegen-jit', 'hybrid-adaptive'].indexOf(cfg['code-execution']);
      [[sch.prim, CG.CP], [sch.jit, CG.CJ], [sch.hybrid, CG.CH]].forEach(([s, c], i) => {
        const pts = [[X(0), Y(0), 0.1]]; for (let k = 0; k < CG.NM; k++) { pts.push([X(s.s[k]), Y(k * W / CG.NM), 0.1], [X(s.e[k]), Y((k + 1) * W / CG.NM), 0.1]); }
        [0, 0.03, -0.03].forEach(dy => kit.polyline(pts.map(p => [p[0], p[1] + dy, p[2]]), c, { parent: chartG, opacity: i === sel ? 1 : 0.35 }));
      });
      if (markSwap) { gCh.remove(markSwap); }
      markSwap = new THREE.Group(); gCh.add(markSwap);
      if (isFinite(sch.swapT)) { const p = progressAt(sch.hybrid, sch.swapT, W); kit.sphere(X(sch.swapT), Y(p), 0.4, 0.34, 0xffffff, { parent: markSwap, em: 0.8 }); kit.lbl('swap\n@' + sch.swapT.toFixed(0) + 'ms', X(sch.swapT) + 0.9, Y(p) + 0.55, 0.4, { size: 0.22, color: '#9ece6a', parent: markSwap }); }
      kit.lbl('0', X(0), CY0 - 0.25, 0.2, { size: 0.2, color: '#8a93b5', parent: markSwap }); kit.lbl(Tmax.toFixed(0), CX0 + CXW, CY0 - 0.25, 0.2, { size: 0.2, color: '#8a93b5', parent: markSwap }); kit.lbl(W + '', CX0 - 0.5, CY0 + CYH, 0.2, { size: 0.2, color: '#8a93b5', parent: markSwap });
      legend[0].set(`primitives: 0 ms compile, 2.4 Mt/ms`, '#e0af68'); legend[1].set(`JIT: ${CG.c} ms compile, 3.6 Mt/ms`, '#f7768e'); legend[2].set(sch.compile ? `hybrid: bytecode 1.2 then swap` : `hybrid: stays in bytecode (not worth compiling)`, '#9ece6a');
      done.set(`finish: prim ${fin[0].toFixed(0)} | JIT ${fin[1].toFixed(0)} | hybrid ${fin[2].toFixed(0)} ms`, '#d7def5');
    }
    const showMode = () => { gP.visible = cfg['code-execution'] === 'precompiled-primitives'; gJ.visible = cfg['code-execution'] === 'codegen-jit'; gH.visible = cfg['code-execution'] === 'hybrid-adaptive'; rebuildChart(); };
    showMode();
    let simMs = 0;
    return finish(kit, ctx, {
      update(dt, t) {
        simMs = clamp((t % 12) / 9, 0, 1) * Tmax; const X = tt => CX0 + tt / Tmax * CXW, Y = p => CY0 + p / W * CYH;
        cursor.position.x = X(simMs);
        [sch.prim, sch.jit, sch.hybrid].forEach((s, i) => { dots[i].position.set(X(simMs), Y(progressAt(s, simMs, W)), 0.3); });
        const mode = cfg['code-execution']; const s = mode === 'precompiled-primitives' ? sch.prim : mode === 'codegen-jit' ? sch.jit : sch.hybrid;
        strip.forEach((b, k) => { let col = C.grey, em = 0.1; if (simMs >= s.e[k]) { col = s.tier[k] === 'bc' ? CG.CB : s.tier[k] === 'jit' ? CG.CH : CG.CP; em = 0.35; } else if (simMs > s.s[k]) { col = 0xffffff; em = 0.7; } b.material.color.setHex(col); b.material.emissive.setHex(col); b.material.emissiveIntensity = em; });
        if (gP.visible) tlP.render((t % 3.2));
        if (gJ.visible) {
          const pc = clamp(simMs / CG.c, 0, 1); jbar.scale.x = Math.max(0.01, 16 * pc); jbar.position.x = -8 + jbar.scale.x / 2; tlJ.render(simMs); jbox[3].material.emissiveIntensity = simMs >= CG.c ? 0.9 : 0.1; jbox[2].material.emissiveIntensity = simMs < CG.c ? 0.6 + 0.4 * Math.sin(t * 10) : 0.2;
          jTxt.set(simMs < CG.c ? `compiling... ${simMs.toFixed(0)} / ${CG.c} ms   CPU idle: no tuple processed yet` : `compiled: running at ${CG.rj} Mt/ms`, simMs < CG.c ? '#f7768e' : '#9ece6a');
        }
        if (gH.visible) {
          const swapped = simMs >= sch.swapT; const pc = sch.compile ? clamp(simMs / CG.c, 0, 1) : 0; hbar.scale.x = Math.max(0.01, 3.0 * pc); hbar.position.x = -4.8 + hbar.scale.x / 2;
          aBc.visible = !swapped; aJt.visible = swapped; bcBox.material.emissiveIntensity = swapped ? 0.05 : 0.7; jtBox.material.emissiveIntensity = swapped ? 0.9 : 0.05; dispatch.scale.y = 1 + (swapped && simMs - sch.swapT < 3 ? 0.4 * Math.sin((simMs - sch.swapT) * 4) : 0);
          hTxt.set(!sch.compile ? 'query too small: compile cost > savings, finishes in bytecode' : !swapped ? (simMs < CG.c ? `t=${simMs.toFixed(0)}ms: interpreting bytecode while LLVM compiles in background` : 'compile done: waiting for current morsel to finish, then swap') : `t=${simMs.toFixed(0)}ms: dispatch pointer swapped at morsel boundary, running machine code`, swapped ? '#9ece6a' : '#7aa2f7');
        }
      },
      onConfigChange(c) { cfg = getCfg(c); showMode(); },
      setParam(id, v) { if (id === 'work') { W = Math.round(+v); rebuildChart(); } },
      steps: [
        stepper(ctx, 'Precompiled primitives (X100 / DuckDB / ClickHouse)', 'No code generation at query time: a library of type-specialised tight loops (<code>sel_lt_i32_col_val</code> ...) is compiled with the DBMS. The interpreter just calls function pointers on 1024-value vectors. Zero compile latency, but one primitive per operator step means intermediates are materialised in cache and there is no cross-operator fusion.', () => { }),
        stepper(ctx, 'JIT codegen (HyPer LLVM, Spark WholeStageCodegen/Janino)', 'The plan is translated to LLVM IR (or Java source) and compiled to machine code. The fused loop is the fastest, but nothing runs until compilation ends: on a small query the latency tax (tens-hundreds of ms, superlinear in plan size) can exceed the entire run time. Slide the table size down: JIT loses to primitives.', () => { }),
        stepper(ctx, 'Hybrid adaptive (Umbra, Kohn et al. ICDE 2018)', 'Umbra compiles to a compact bytecode in ~1 ms and starts executing immediately in an interpreter, while a background thread compiles real machine code. At the next morsel boundary the dispatch pointer is atomically swapped: the query benefits from the best of both worlds. If the remaining work is small, it never compiles.', () => { }),
        stepper(ctx, 'Read the chart', 'Slope = throughput, x-offset = compile latency. The hybrid curve rises immediately like an interpreter then bends up to the JIT slope; it dominates JIT-only everywhere and beats primitives once the table is large enough to amortise compilation.', () => { }),
      ],
    });
  },
  controls: [ctlFor('work', 'table size (Mtuples)', 'range', { min: 30, max: 1000, step: 10, value: 600 })],
};

/* ============================================================ ADAPTIVE EXECUTION (Spark AQE) ============================================================ */
const AQE_SIZES = [18, 25, 9, 31, 12, 22, 8, 15, 40, 11, 14, 20, 7, 10, 28, 17, 6, 13, 24, 9, 19, 8, 16, 12];
const AQE_ACTS = ['coalesce', 'join', 'skew'];
function greedy(durs, slots) { const free = Array(slots).fill(0), out = []; durs.forEach(d => { let l = 0; for (let i = 1; i < slots; i++) if (free[i] < free[l]) l = i; out.push({ lane: l, start: free[l], dur: d.dur, id: d.id, skew: d.skew }); free[l] += d.dur; }); return { tasks: out, makespan: Math.max(...free) }; }

const adaptiveView = {
  build(ctx) {
    const kit = makeKit(ctx); let cfg = getCfg(ctx.config); let rule = 'auto';
    const gA = new THREE.Group(), gB = new THREE.Group(), gC = new THREE.Group(); kit.group.add(gA, gB, gC);
    const tlB = makeTL(sub(kit, gB)); const title = kit.dyn(0, 5.7, 0.3, { size: 0.3, color: '#d7def5' }); const sub1 = kit.dyn(0, 5.15, 0.3, { size: 0.24, color: '#8a93b5' });
    // ---- A: coalesce
    const y0 = -1.2, hs = s => s / 64 * 2.2; const groups = []; { let acc = 0, g = 0; AQE_SIZES.forEach((s, i) => { if (acc + s > 64 && acc > 0) { g++; acc = 0; } acc += s; groups.push(g); }); }
    const ng = Math.max(...groups) + 1, gcx = g => -7.5 + g * (15 / (ng - 1 || 1)); const stackY = Array(ng).fill(0);
    const cells = AQE_SIZES.map((s, i) => {
      const bx = -8.3 + i * 0.72, g = groups[i], h = hs(s); const ax = gcx(g), ay = y0 + stackY[g] + h / 2; stackY[g] += h;
      const m = kit.box(bx, y0 + h / 2, 0, 0.6, h, 0.5, [C.scan, C.project][g % 2] , { parent: gA }); m.userData = { bx, by: y0 + h / 2, ax, ay, h, bw: 0.6, aw: 1.5 }; return m;
    });
    kit.box(0, y0 + hs(64), -0.1, 18, 0.03, 0.05, C.warn, { parent: gA }); kit.lbl('advisoryPartitionSize = 64 MB', 6.5, y0 + hs(64) + 0.3, 0.3, { size: 0.24, color: '#e0af68', parent: gA });
    kit.box(0, y0 - 0.03, -0.1, 18, 0.03, 0.05, C.grey, { parent: gA }); kit.lbl('shuffle partitions (map output sizes, MB) -- 24 of spark.sql.shuffle.partitions shown', 0, y0 - 0.5, 0.3, { size: 0.24, color: '#8a93b5', parent: gA });
    const aTxt = kit.dyn(0, -3.6, 0.3, { size: 0.28, parent: gA }); const aTxt2 = kit.dyn(0, -4.3, 0.3, { size: 0.24, color: '#8a93b5', parent: gA });
    // ---- B: join strategy switch
    const nodes = {}; const nd = (id, x, y, w, c, txt) => { nodes[id] = { b: kit.box(x, y, 0, w, 0.9, 0.5, c, { parent: gB }), l: kit.dyn(x, y, 0.4, { size: 0.22, color: '#0b0e17', parent: gB }), x, y }; nodes[id].l.set(txt, '#0b0e17'); };
    nd('join', -5, 3.3, 3.6, C.join, 'SortMergeJoin'); nd('exL', -7.4, 1.2, 2.6, C.exch, 'Exchange hash(k)'); nd('exR', -2.6, 1.2, 2.6, C.exch, 'Exchange hash(k)'); nd('scL', -7.4, -1.0, 2.6, C.scan, 'Scan orders\n200 GB'); nd('scR', -2.6, -1.0, 2.6, C.scan, 'Scan dim + filter');
    const exLine = []; [['join', 'exL'], ['join', 'exR'], ['exL', 'scL'], ['exR', 'scR']].forEach(([a, b], qi) => { const l = kit.polyline([[nodes[a].x, nodes[a].y - 0.45, 0], [nodes[b].x, nodes[b].y + 0.45, 0]], 0x8a93b5, { parent: gB }); if (qi === 0 || qi === 2) exLine.push(l); });
    const bStat = kit.dyn(-5, -2.6, 0.4, { size: 0.26, parent: gB }); const bThr = kit.dyn(-5, -3.3, 0.4, { size: 0.22, color: '#8a93b5', parent: gB }); const bNet = kit.dyn(4.5, -3.8, 0.4, { size: 0.26, parent: gB });
    const ex = [2.2, 5.0, 7.8].map((x, i) => { kit.box(x, 1.0, -0.1, 2.4, 3.6, 0.4, C.grey, { opacity: 0.4, parent: gB }); kit.lbl('executor ' + i, x, 3.1, 0.3, { size: 0.24, parent: gB }); return x; });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { // big-side shuffle tokens
      const k = i * 3 + j; tlB.add({ path: [[ex[i], 1.9], [ex[j] - 0.5 + i * 0.5, 1.9]], t0: 0.3 + k * 0.25, dur: 1.4, stay: true, until: 4.6, color: C.scan, size: 0.28 });
      tlB.add({ path: [[ex[i], 0.7], [ex[j] - 0.5 + i * 0.5, 0.7]], t0: 0.3 + k * 0.25, dur: 1.4, stay: true, until: 4.6, color: 0xff9e64, size: 0.2 });
      if (i !== j) { /* network hop emphasised by diagonal path */ }
    }
    for (let i = 0; i < 3; i++) { tlB.add({ path: [[ex[i], 1.9], [ex[i], 1.9]], t0: 4.8, dur: 0.1, stay: true, color: C.scan, size: 0.28 }); for (let j = 0; j < 3; j++) tlB.add({ path: [[ex[i], 0.7], [ex[j] - 0.7 + i * 0.7, 0.7]], t0: 5.5 + i * 0.2, dur: 1.2, stay: true, color: 0xff9e64, size: 0.2 }); }
    kit.lbl('blue = big table partitions, orange = small table', 5.0, -0.8, 0.3, { size: 0.22, color: '#8a93b5', parent: gB });
    // ---- C: skew join
    const SK = [25, 30, 22, 300, 28, 20, 35, 26, 24, 31, 27, 29]; const RATE = 20;
    const before = greedy(SK.map((s, i) => ({ dur: s / RATE, id: i, skew: s > 250 })), 4);
    const aft = []; SK.forEach((s, i) => { if (s > 250) for (let j = 0; j < 5; j++) aft.push({ dur: s / 5 / RATE + 0.3, id: i, skew: true }); else aft.push({ dur: s / RATE, id: i }); }); const after = greedy(aft, 4);
    const GX = -8, GS = 0.8; const gantt = [];
    [[before, 3.9, 'without AQE: one 300 MB partition = one straggler task'], [after, 0.5, 'with AQE skew-join: partition split into 5 sub-tasks (other side replicated)']].forEach(([sc, yTop, name], pi) => {
      kit.lbl(name, 0, yTop + 0.75, 0.3, { size: 0.24, color: pi ? '#9ece6a' : '#f7768e', parent: gC });
      for (let l = 0; l < 4; l++) { kit.box(GX + 8.5, yTop - l * 0.6, -0.1, 17, 0.5, 0.05, C.panel2, { em: 0.1, parent: gC }); kit.lbl('slot' + l, -9.4, yTop - l * 0.6, 0.3, { size: 0.2, color: '#8a93b5', parent: gC }); }
      sc.tasks.forEach(t => { const c = t.skew ? (pi ? 0xff9e64 : C.bad) : [C.scan, C.project][t.id % 2]; const m = kit.box(GX + t.start * GS, yTop - t.lane * 0.6, 0, 0.01, 0.42, 0.3, c, { parent: gC }); m.userData = { t, yTop, c }; gantt.push(m); });
      kit.lbl('makespan ' + sc.makespan.toFixed(1) + ' s', GX + sc.makespan * GS + 1.0, yTop - 3 * 0.6 - 0.45, 0.3, { size: 0.24, color: pi ? '#9ece6a' : '#f7768e', parent: gC });
      gantt.push({ sc, yTop });
    });
    const pbars = SK.map((s, i) => kit.box(-8 + i * 1.0, -3.4 + s / 300 * 1.0, 0, 0.7, Math.max(0.05, s / 300 * 2.0), 0.3, s > 250 ? C.bad : C.scan, { parent: gC })); kit.lbl('reduce-side partition sizes (MB): median 27 -> skew if > 5x median AND > 256 MB', 0, -5.0, 0.3, { size: 0.24, color: '#8a93b5', parent: gC });
    kit.box(0, -3.4 + 135 / 300 * 2.0, -0.1, 12, 0.03, 0.05, C.warn, { parent: gC }); kit.lbl('5 x median = 135 MB', 7.5, -3.4 + 135 / 300 * 2.0 + 0.2, 0.3, { size: 0.2, color: '#e0af68', parent: gC });
    const cur = kit.box(0, 0, 0.5, 0.03, 5.5, 0.05, C.white, { opacity: 0.5, parent: gC }); const cTxt = kit.dyn(0, -4.4, 0.3, { size: 0.26, parent: gC });
    let manualT = 0;
    return finish(kit, ctx, {
      update(dt, t) {
        const act = rule === 'auto' ? AQE_ACTS[Math.floor(t / 10) % 3] : rule; const ta = t % 10;
        gA.visible = act === 'coalesce'; gB.visible = act === 'join'; gC.visible = act === 'skew';
        title.set(act === 'coalesce' ? 'Rule 1: coalesce shuffle partitions' : act === 'join' ? 'Rule 2: SortMergeJoin -> BroadcastHashJoin at runtime' : 'Rule 3: skew join splitting', '#d7def5');
        if (act === 'coalesce') {
          const u = ease(clamp((ta - 3.5) / 2, 0, 1)); cells.forEach(c => { const d = c.userData; c.position.x = lerp(d.bx, d.ax, u); c.position.y = lerp(d.by, d.ay, u); c.scale.x = lerp(d.bw, d.aw, u); });
          sub1.set('re-optimisation happens at a QUERY STAGE boundary: the shuffle map stage has materialised, so exact MapOutputStatistics replace estimates', '#8a93b5');
          aTxt.set(ta < 1.5 ? 'map stage running ...' : ta < 3.5 ? `stats collected: ${AQE_SIZES.length} reduce tasks, median ${[...AQE_SIZES].sort((a, b) => a - b)[12]} MB: scheduling overhead dominates tiny tasks` : `coalesced into ${ng} reduce tasks of ~64 MB (contiguous partitions merged, no data movement)`, ta < 3.5 ? '#e0af68' : '#9ece6a');
          aTxt2.set('Spark: spark.sql.adaptive.coalescePartitions.enabled; initialPartitionNum, advisoryPartitionSizeInBytes', '#8a93b5');
        } else if (act === 'join') {
          const pre = ta < 4.2, flash = ta > 3 && ta < 4.2; tlB.render(ta);
          nodes.join.l.set(pre ? 'SortMergeJoin' : 'BroadcastHashJoin', '#0b0e17'); [nodes.join.b.material].forEach(m => { const c = pre ? C.join : C.good; m.color.setHex(c); m.emissive.setHex(c); });
          nodes.exL.b.visible = pre; exLine.forEach(l => { l.visible = pre; }); nodes.exL.l.sprite.visible = pre; nodes.exR.l.set(pre ? 'Exchange hash(k)' : 'BroadcastExchange', '#0b0e17'); nodes.exR.b.material.color.setHex(pre ? C.exch : C.good); nodes.exR.b.material.emissive.setHex(pre ? C.exch : C.good);
          nodes.scR.b.material.emissiveIntensity = flash ? 0.9 : 0.3;
          bStat.set(ta < 3 ? 'plan-time estimate of dim side: 120 MB (stale stats) > 10 MB -> shuffle both sides' : ta < 4.2 ? 'RUNTIME stat from finished map stage: dim side = 8 MB' : '8 MB < autoBroadcastJoinThreshold -> re-planned: broadcast dim side, big side not shuffled (local reads)', ta < 3 ? '#e0af68' : '#9ece6a');
          bThr.set('spark.sql.adaptive.autoBroadcastJoinThreshold=10MB (default: spark.sql.autoBroadcastJoinThreshold)', '#8a93b5');
          bNet.set(pre ? 'network: ~200 GB x 2/3 shuffled' : 'network: 8 MB x 3 executors', pre ? '#f7768e' : '#9ece6a'); sub1.set('big side is NOT sorted/shuffled any more: SMJ needs both sides hash-partitioned and sorted', '#8a93b5');
        } else {
          const cs = ta * 2.2; cur.position.x = GX + cs * GS; cur.position.y = 0.0; cur.scale.y = 11;
          gantt.forEach(m => { if (m.userData && m.userData.t) { const tt = m.userData.t; const w = clamp(cs - tt.start, 0, tt.dur); m.scale.x = Math.max(0.01, w * GS); m.position.x = GX + tt.start * GS + m.scale.x / 2; } });
          sub1.set('skewedPartitionFactor=5, skewedPartitionThresholdInBytes=256MB: a skewed partition is split by map-output ranges into sub-partitions of ~advisory size', '#8a93b5');
          cTxt.set(`job time without AQE ${before.makespan.toFixed(1)} s   ->   with AQE ${after.makespan.toFixed(1)} s   (${(before.makespan / after.makespan).toFixed(1)}x faster)`, '#9ece6a');
          pbars.forEach((b, i) => { b.visible = true; });
        }
        gA.visible && (aTxt.sprite && (aTxt.sprite.visible = true)); [aTxt, aTxt2].forEach(l => l.sprite && (l.sprite.visible = act === 'coalesce')); [bStat, bThr, bNet].forEach(l => l.sprite && (l.sprite.visible = act === 'join')); cTxt.sprite && (cTxt.sprite.visible = act === 'skew');
      },
      onConfigChange(c) { cfg = getCfg(c); },
      setParam(id, v) { if (id === 'rule') rule = v; },
      steps: [
        stepper(ctx, 'Why adaptive?', 'Optimizer estimates (cardinality, selectivity, sizes) are often wrong, especially after filters and joins. A shuffle stage is a natural <b>materialisation point</b>: once map outputs exist, exact sizes are known, so the remaining plan can be re-optimised mid-query.', () => { rule = 'auto'; }),
        stepper(ctx, 'Coalesce partitions', 'Static shuffle.partitions (default 200) is wrong for most queries. With runtime sizes AQE merges adjacent small partitions up to the advisory 64 MB: fewer, fuller reduce tasks, less scheduling and small-file overhead.', () => { rule = 'coalesce'; }),
        stepper(ctx, 'Switch join strategy', 'A SortMergeJoin was planned because the dim side was estimated at 120 MB. The map stage reveals only 8 MB, under the broadcast threshold, so AQE rewrites the join to BroadcastHashJoin and skips shuffling and sorting the huge table.', () => { rule = 'join'; }),
        stepper(ctx, 'Optimise skew join', 'One partition is 300 MB (> 5x median and > 256 MB): its reduce task is a straggler. AQE splits it into 5 sub-partitions, each joined with a replicated copy of the other side\'s matching partition: the Gantt chart collapses.', () => { rule = 'skew'; }),
      ],
    });
  },
  controls: [ctlFor('rule', 'AQE rule', 'select', { options: ['auto', 'coalesce', 'join', 'skew'], value: 'auto' })],
};

/* ============================================================ EXCHANGE / SHUFFLE ============================================================ */
const SH_Y = [3.4, 0.6, -2.2];
const SH_KEYS = [[1, 2, 3, 4, 5, 6], [2, 5, 3, 1, 6, 4], [3, 3, 6, 2, 1, 5]];
const exchangeView = {
  build(ctx) {
    const kit = makeKit(ctx); let cfg = getCfg(ctx.config); let mode = 'shuffle', smallMB = 8;
    const gS = new THREE.Group(), gBc = new THREE.Group(); kit.group.add(gS, gBc);
    const tlS = makeTL(sub(kit, gS)), tlB = makeTL(sub(kit, gBc));
    const PC = [C.scan, C.project, C.agg];
    // ----- shuffle join
    SH_Y.forEach((y, i) => {
      kit.box(-8.2, y, 0, 2.2, 1.3, 0.6, C.scan, { parent: gS }); kit.lbl('map task ' + i + '\nhash(k) % 3', -8.2, y, 0.4, { size: 0.24, color: '#0b0e17', parent: gS });
      kit.panel(-3.7, y, 3.9, 1.3, 0x2a2f45, { parent: gS, z: -0.1 }); kit.lbl('shuffle file ' + i + ' (data + index)', -3.7, y + 0.85, 0.3, { size: 0.2, color: '#8a93b5', parent: gS });
      for (let p = 0; p < 3; p++) { kit.box(-5.0 + p * 1.3, y, 0, 1.2, 0.9, 0.3, PC[p], { opacity: 0.35, parent: gS }); kit.lbl('part ' + p, -5.0 + p * 1.3, y - 0.45, 0.3, { size: 0.18, color: '#8a93b5', parent: gS }); }
      kit.box(3.9, y, 0, 2.8, 1.3, 0.6, PC[i], { opacity: 0.55, parent: gS }); kit.lbl('reduce task ' + i + '\nfetch part ' + i + ' of ALL files\nmerge / hash join', 3.9, y + 0.9, 0.4, { size: 0.2, parent: gS });
      kit.box(8.4, y, 0, 1.4, 0.9, 0.4, C.good, { opacity: 0.45, parent: gS }); kit.arrow(5.4, y, 7.6, y, C.data, { parent: gS });
      for (let p = 0; p < 3; p++) kit.polyline([[-4.4 + p * 1.3, y - 0.65, 0], [-2.0, SH_Y[p] - 0.0, 0], [2.4, SH_Y[p], 0]], 0x3b4261, { parent: gS, opacity: 0.35 });
    });
    const cnt = {}; // slot stacking
    SH_KEYS.forEach((keys, i) => keys.forEach((k, j) => {
      const p = k % 3; const l = (cnt[i + ',' + p] = (cnt[i + ',' + p] || 0) + 1) - 1; const y = SH_Y[i];
      const slot = [-5.0 + p * 1.3 - 0.35 + (l % 2) * 0.35, y + 0.15 - Math.floor(l / 2) * 0.25];
      tlS.add({ path: [[-8.2, y], [-6.0, y], slot], t0: 0.3 + j * 0.6 + i * 0.15, dur: 1.4, stay: true, until: 7.6 + p * 0.5 + i * 0.15, color: KEYC[k > 5 ? 1 : k] , size: 0.2 });
      const rl = (cnt['r' + p] = (cnt['r' + p] || 0) + 1) - 1;
      tlS.add({ path: [slot, [-2.0, y - 0.1], [2.4, SH_Y[p]], [3.0 + (rl % 6) * 0.38, SH_Y[p] - 0.25 + Math.floor(rl / 6) * 0.3]], t0: 7.6 + p * 0.5 + i * 0.15, dur: 2.4, stay: true, color: KEYC[k > 5 ? 1 : k], size: 0.2 });
    }));
    kit.lbl('map side: partition rows by hash(key) into one shuffle file per map task (sort-based shuffle) -> reducers pull their partition over the network', 0, 5.4, 0.3, { size: 0.24, color: '#9ece6a', parent: gS });
    const shPhase = kit.dyn(0, -4.15, 0.3, { size: 0.26, color: '#d7def5', parent: gS });
    // ----- broadcast join
    SH_Y.forEach((y, i) => {
      kit.box(3.2, y, 0, 4.6, 1.3, 0.6, C.grey, { opacity: 0.4, parent: gBc }); kit.lbl('executor ' + i, 3.2, y + 0.85, 0.3, { size: 0.22, parent: gBc });
      kit.box(1.8, y - 0.1, 0.1, 1.5, 0.7, 0.3, C.scan, { parent: gBc }); kit.lbl('big partition\n(stays here)', 1.8, y - 0.1, 0.4, { size: 0.18, color: '#0b0e17', parent: gBc });
      kit.box(4.3, y - 0.1, 0.1, 1.5, 0.7, 0.3, C.join, { opacity: 0.35, parent: gBc }); kit.lbl('copy of small\nhash table', 4.3, y - 0.1, 0.4, { size: 0.16, parent: gBc });
      const keys = SH_KEYS[i];
      for (let j = 0; j < 3; j++) tlB.add({ path: [[-7.2, 0.6], [-4.5, 0.6], [-1.0, y], [3.8 + j * 0.35, y - 0.1 + (j % 2) * 0.15]], t0: 1.0 + i * 0.25 + j * 0.35, dur: 2.4, stay: true, color: C.join, size: 0.22 });
    });
    kit.box(-7.2, 0.6, 0, 2.6, 1.3, 0.6, C.join, { parent: gBc }); kit.lbl('small table\n(collected at driver)', -7.2, 0.6, 0.4, { size: 0.2, color: '#0b0e17', parent: gBc });
    kit.lbl('broadcast: small side is copied to EVERY executor; the big side is never moved, so join is local (build HT from the copy, probe with local rows)', 0, 5.4, 0.3, { size: 0.24, color: '#ff9e64', parent: gBc });
    
    // ----- cost bars (always)
    const barS = kit.box(-8, -4.9, 0, 0.01, 0.35, 0.3, C.exch), barB = kit.box(-8, -5.5, 0, 0.01, 0.35, 0.3, C.join);
    const lblS = kit.dyn(-8, -4.9, 0.4, { size: 0.24 }), lblB = kit.dyn(-8, -5.5, 0.4, { size: 0.24 });
    const verdict = kit.dyn(0, -3.3, 0.3, { size: 0.28 });
    const Lmb = 10000, N = 10;
    function costs() {
      const sh = (Lmb + smallMB) * (N - 1) / N, bc = smallMB * (N - 1); const mx = Math.max(sh, bc, 1), W = 11;
      barS.scale.x = Math.max(0.02, W * sh / mx); barS.position.x = -8 + barS.scale.x / 2; barB.scale.x = Math.max(0.02, W * bc / mx); barB.position.x = -8 + barB.scale.x / 2;
      lblS.set(`shuffle join: ${sh.toFixed(0)} MB over network`, '#f7768e'); lblS.sprite.position.x = -8 + Math.max(2.6, barS.scale.x + 3.2) ;
      lblB.set(`broadcast join: ${bc.toFixed(0)} MB`, '#ff9e64'); lblB.sprite.position.x = -8 + Math.max(2.4, barB.scale.x + 2.6);
      verdict.set(`big side 10 GB, small side ${smallMB} MB, 10 nodes  ->  ${bc < sh ? 'BROADCAST wins' : 'SHUFFLE wins'}\n(broadcast also needs the small side to fit in every executor: autoBroadcastJoinThreshold)`, bc < sh ? '#ff9e64' : '#f7768e');
    }
    const show = () => { gS.visible = mode === 'shuffle'; gBc.visible = mode === 'broadcast'; };
    costs(); show();
    return finish(kit, ctx, {
      update(dt, t) {
        if (gS.visible) { const tt = t % 14; tlS.render(tt); shPhase.set(tt < 5.5 ? 'MAP: scan + partition into the shuffle file (spill to local disk)' : tt < 7.6 ? 'map stage done: files are the stage boundary (this is where AQE gets its statistics)' : tt < 10.2 ? 'SHUFFLE READ: each reducer fetches ITS byte range from every map output (M x R requests)' : 'REDUCE: tuples of equal key are co-located -> join / aggregate locally', '#d7def5'); }
        if (gBc.visible) tlB.render(t % 8);
      },
      onConfigChange(c) { cfg = getCfg(c); },
      setParam(id, v) { if (id === 'join') { mode = v; show(); } if (id === 'small') { smallMB = Math.round(10 ** (+v)); costs(); } },
      steps: [
        stepper(ctx, 'Exchange = repartitioning', 'An exchange/shuffle redistributes rows across tasks so that rows that must be processed together (same join/group key) end up on the same node. It is the ONLY place a parallel plan needs the network, and it is a pipeline breaker.', () => { mode = 'shuffle'; show(); }),
        stepper(ctx, 'Map side: hash partition', 'Each map task hashes the key (<code>hash(k) % R</code>) and appends the row to partition R of its output. Spark\'s sort-based shuffle writes ONE data file + an index per map task (not M x R files); the partition ranges are looked up through the index.', () => { mode = 'shuffle'; show(); }),
        stepper(ctx, 'Reduce side: fetch', 'Reducer p fetches partition p from all M map outputs (M x R block fetches), merges them and joins/aggregates. Skewed keys make one reducer huge (see adaptive-execution).', () => { mode = 'shuffle'; show(); }),
        stepper(ctx, 'Broadcast vs shuffle join', 'If one side is small, copy it to every node and join locally: network = small x (nodes-1) instead of moving BOTH tables. Slide the small-side size to find the crossover: broadcast loses when small x (N-1) exceeds (big+small) x (N-1)/N.', () => { mode = 'broadcast'; show(); }),
      ],
    });
  },
  controls: [
    ctlFor('join', 'join strategy', 'select', { options: ['shuffle', 'broadcast'], value: 'shuffle' }),
    ctlFor('small', 'log10(small side MB)', 'range', { min: 0, max: 4, step: 0.1, value: 0.9 }),
  ],
};

/* ============================================================ COLUMNAR PROCESSING ============================================================ */
const COLV = [12, 77, 45, 91, 3, 64, 58, 20, 83, 39, 70, 5, 99, 51, 26, 88];
const columnarView = {
  build(ctx) {
    const kit = makeKit(ctx); let cfg = getCfg(ctx.config); let sel = 0.25;
    // ---------- panel 1: SIMD
    const px = -6.8; const cw = 0.36, x0 = px - 15 * cw / 2;
    kit.lbl('1  SIMD lanes:  WHERE x > 50', px, 5.4, 0.3, { size: 0.32, color: '#7aa2f7' });
    const vals = COLV.map((v, i) => { const c = kit.box(x0 + i * cw, 4.2, 0, cw * 0.9, 0.5, 0.3, v > 50 ? C.filter : C.scan, { em: 0.1 }); return c; });
    COLV.forEach((v, i) => kit.lbl(String(v), x0 + i * cw, 4.2, 0.3, { size: 0.15, color: '#0b0e17' }));
    kit.lbl('int32 column chunk (contiguous in memory)', px, 4.75, 0.3, { size: 0.2, color: '#8a93b5' });
    const scalarPtr = kit.box(x0, 3.6, 0.1, cw * 0.9, 0.12, 0.2, C.bad, { em: 0.8 }); kit.lbl('scalar: 1 value / iteration\ncmp + branch + store', px, 3.1, 0.3, { size: 0.2, color: '#f7768e' });
    const smask = vals.map((_, i) => kit.box(x0 + i * cw, 2.55, 0, cw * 0.9, 0.22, 0.2, C.grey, { em: 0.1 }));
    const simdBox = kit.box(x0 + 3.5 * cw, 1.6, 0.0, cw * 8, 0.55, 0.3, C.good, { opacity: 0.35, em: 0.5 }); kit.lbl('SIMD (AVX2): 8 x int32 lanes\nvpcmpgtd ymm0, ymm1, thresh  -> 1 instr', px, 0.95, 0.3, { size: 0.2, color: '#9ece6a' });
    const vmask = vals.map((_, i) => kit.box(x0 + i * cw, 0.2, 0, cw * 0.9, 0.22, 0.2, C.grey, { em: 0.1 }));
    kit.lbl('result mask (0xFFFFFFFF per passing lane)', px, -0.15, 0.3, { size: 0.18, color: '#8a93b5' });
    const c1 = kit.dyn(0, -1.4, 0.3, { size: 0.22 }), c1b = kit.dyn(0, -1.85, 0.3, { size: 0.19, color: '#8a93b5' });
    // ---------- panel 2: selection vector vs bitmap
    const qx = 0.2; kit.lbl('2  Selection vector vs bitmap', qx, 5.4, 0.3, { size: 0.32, color: '#e0af68' });
    const bcell = []; for (let i = 0; i < 32; i++) { bcell.push(kit.box(qx - 3.0 + (i % 16) * 0.38, 4.35 - Math.floor(i / 16) * 0.42, 0, 0.33, 0.36, 0.3, C.grey, { em: 0.1 })); }
    kit.lbl('batch of 1024 rows (32 shown), selectivity s', qx, 4.95, 0.3, { size: 0.2, color: '#8a93b5' });
    const selList = []; for (let i = 0; i < 12; i++) selList.push(kit.box(qx - 3.0 + i * 0.5, 2.9, 0, 0.45, 0.4, 0.3, C.ctl, { em: 0.3 })); const selTxt = []; for (let i = 0; i < 12; i++) selTxt.push(kit.dyn(qx - 3.0 + i * 0.5, 2.9, 0.3, { size: 0.16, color: '#0b0e17' }));
    kit.lbl('selection vector: uint16 positions (2 B x k)', qx, 3.4, 0.3, { size: 0.2, color: '#7dcfff' });
    const bm = []; for (let i = 0; i < 32; i++) bm.push(kit.box(qx - 3.0 + (i % 16) * 0.38, 1.75 - Math.floor(i / 16) * 0.3, 0, 0.33, 0.24, 0.3, C.grey, { em: 0.1 })); kit.lbl('bitmap: 1 bit / row (1024 b = 128 B always)', qx, 2.25, 0.3, { size: 0.2, color: '#bb9af7' });
    const b1 = kit.box(qx - 3.0, 0.55, 0, 0.01, 0.3, 0.3, C.ctl), b2 = kit.box(qx - 3.0, 0.1, 0, 0.01, 0.3, 0.3, 0xbb9af7);
    const c2 = kit.dyn(0, -2.5, 0.3, { size: 0.22 }), c2b = kit.dyn(0, -2.95, 0.3, { size: 0.19, color: '#8a93b5' }), c2c = kit.dyn(0, -3.35, 0.3, { size: 0.19, color: '#8a93b5' }); kit.lbl('sel-vec', qx + 3.7, 0.55, 0.3, { size: 0.2, color: '#7dcfff' }); kit.lbl('bitmap', qx + 3.7, 0.1, 0.3, { size: 0.2, color: '#bb9af7' });
    // ---------- panel 3: late materialization
    const rx = 6.9; kit.lbl('3  Late materialization', rx, 5.4, 0.3, { size: 0.32, color: '#bb9af7' });
    const NR = 12, colx = [rx - 1.9, rx, rx + 1.9], rows = []; const cols = [[C.filter, 'A (filter col)'], [C.scan, 'B'], [C.agg, 'C']];
    const cellsL = cols.map(([c, n], ci) => { kit.lbl(n, colx[ci], 4.85, 0.3, { size: 0.2, color: HEX(c) }); return Array.from({ length: NR }, (_, r) => kit.box(colx[ci], 4.3 - r * 0.32, 0, 1.0, 0.27, 0.3, c, { em: 0.1 })); });
    const posTxt = kit.dyn(rx, 0.2, 0.3, { size: 0.2, color: '#7dcfff' }); const c3 = kit.dyn(0, -4.1, 0.3, { size: 0.22 }), c3b = kit.dyn(0, -4.55, 0.3, { size: 0.19, color: '#8a93b5' }), c3c = kit.dyn(0, -4.95, 0.3, { size: 0.19, color: '#8a93b5' });
    const mat = kit.mat(0xffffff, { em: 0.9 }); const dimM = kit.mat(C.grey, { em: 0.05 });
    function passSet(frac, n, seed) { const a = Array.from({ length: n }, (_, i) => ((i * 7919 + seed * 104729) % 1000) / 1000); const order = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const k = Math.round(frac * n); const s = new Set(order.slice(0, k).map(o => o[1])); return s; }
    function refresh() {
      // panel 2
      const k1024 = Math.round(sel * 1024), svB = 2 * k1024, bmB = 128; const p32 = passSet(sel, 32, 3);
      bcell.forEach((c, i) => { const on = p32.has(i); c.material.color.setHex(on ? C.good : C.grey); c.material.emissive.setHex(on ? C.good : C.grey); });
      const idx = [...p32].sort((a, b) => a - b);
      selList.forEach((b, i) => { b.visible = i < idx.length; }); selTxt.forEach((l, i) => { if (i < idx.length) { l.set(String(idx[i]), '#0b0e17'); l.sprite.visible = true; } else if (l.sprite) l.sprite.visible = false; });
      bm.forEach((c, i) => { const on = p32.has(i); c.material.color.setHex(on ? 0xbb9af7 : C.grey); c.material.emissive.setHex(on ? 0xbb9af7 : C.grey); });
      const mx = Math.max(svB, bmB, 1); b1.scale.x = Math.max(0.02, 6.0 * svB / Math.max(mx, 128) * (svB > 0 ? 1 : 0)); b1.position.x = qx - 3.0 + b1.scale.x / 2; const m2 = Math.max(svB, bmB); b1.scale.x = Math.max(0.02, 6 * svB / m2); b2.scale.x = Math.max(0.02, 6 * bmB / m2); b1.position.x = qx - 3.0 + b1.scale.x / 2; b2.position.x = qx - 3.0 + b2.scale.x / 2;
      c2.set(`[2] s = ${(sel * 100).toFixed(0)}%  k = ${k1024}:  sel-vec ${svB} B   bitmap ${bmB} B   -> ${svB < bmB ? 'sel-vec smaller' : 'bitmap smaller'}`, '#d7def5');
      c2b.set('crossover at k = 64 (6%): sparse results -> sel-vec; dense -> bitmap (AND/OR of predicates = 1 SIMD op)', '#8a93b5'); c2c.set('sel-vec: branch-free gather, cheap to iterate; bitmap: needs tzcnt loop to enumerate', '#8a93b5');
      // panel 3
      const k = Math.round(sel * NR), pr = passSet(sel, NR, 5); const early = 3 * NR, late = NR + 2 * k;
      cellsL.forEach((col, ci) => col.forEach((c, r) => { if (!c.userData.base) c.userData.base = c.material; c.material = (ci === 0 || pr.has(r)) ? c.userData.base : dimM; }));
      posTxt.set('positions from A: [' + [...pr].sort((a, b) => a - b).join(',') + ']', '#7dcfff');
      c3.set(`[3] cells read: early ${early}  vs  late ${late}`, '#d7def5'); c3b.set(`late = scan A (${NR}) + fetch B,C at ${k} positions (2x${k})`, '#8a93b5'); c3c.set('also: join/agg run on positions only; tuples are stitched at the very end', '#8a93b5');
    }
    refresh();
    const layout = () => (cfg['page-layout'] === 'nsm-row' || cfg['table-organization'] === 'heap' || cfg['table-organization'] === 'index-organized');
    return finish(kit, ctx, {
      update(dt, t) {
        const tt = t % 8; const row = layout();
        const sc = Math.min(15, Math.floor(tt / 0.4)); scalarPtr.position.x = x0 + sc * cw; vals.forEach((c, i) => { smask[i].material.color.setHex(i <= sc ? (COLV[i] > 50 ? C.good : C.bad) : C.grey); smask[i].material.emissive.copy(smask[i].material.color); });
        const step = tt < 3 ? 0 : tt < 6 ? 1 : 2; // 2 SIMD steps of 8 lanes (AVX2)
        const simdStep = Math.floor(clamp((tt - 0.5) / 2.8, 0, 1.99)); simdBox.position.x = x0 + (simdStep * 8 + 3.5) * cw; simdBox.visible = !row;
        vmask.forEach((c, i) => { const done = i < (simdStep + (tt > 3.4 ? 1 : 0)) * 8 && !row; const col = done ? (COLV[i] > 50 ? C.good : C.bad) : C.grey; c.material.color.setHex(col); c.material.emissive.setHex(col); });
        c1.set('[1] ' + (row ? 'ROW layout (NSM): x values are strided across tuples -> gather, no clean SIMD' : `scalar ${Math.min(16, sc + 1)}/16 iterations   |   SIMD ${Math.min(2, simdStep + (tt > 3.4 ? 1 : 0))}/2 vector instrs`), row ? '#f7768e' : '#d7def5');
        c1b.set('    ' + (row ? 'columnar (DSM/PAX) layout keeps a column contiguous: 8 x int32 per 256-bit register (16 with AVX-512)' : 'branch-free: compare + movemask; auto-vectorised by the compiler or hand-written intrinsics'), '#8a93b5');
      },
      onConfigChange(c) { cfg = getCfg(c); },
      setParam(id, v) { if (id === 'selectivity') { sel = +v; refresh(); } },
      steps: [
        stepper(ctx, 'SIMD over columns', 'A column chunk is a plain contiguous array, so one 256-bit instruction (AVX2) evaluates the predicate on 8 int32 values (16 with AVX-512, 4 with NEON-128 on ARM). The scalar loop pays a compare, a branch (mispredicts at ~50% selectivity!) and a store per value. Needs columnar/PAX layout; row layout forces gathers.', () => { }),
        stepper(ctx, 'Selection vector vs bitmap', 'The filter output must be represented somehow: a <b>selection vector</b> (list of qualifying positions, 2 B each for a 1024-batch) or a <b>bitmap</b> (1 bit per row, fixed 128 B). Sparse results favour the vector; dense results and conjunctions of predicates favour bitmaps (AND/OR in one instruction). Drag the selectivity slider.', () => { }),
        stepper(ctx, 'Late materialization', 'Do not stitch (A,B,C) tuples at scan time. Filter on column A, carry only POSITIONS, and fetch B and C only for qualifying rows (or defer until after joins). Fewer bytes touched, less memory traffic; the cost is random access into B and C and a final stitch (C-Store, Abadi et al.).', () => { }),
      ],
    });
  },
  controls: [ctlFor('selectivity', 'selectivity', 'range', { min: 0, max: 1, step: 0.05, value: 0.25 })],
};

export const views = {
  executor: executorView,
  operators: operatorsView,
  scheduler: schedulerView,
  parallelism: parallelismView,
  codegen: codegenView,
  'adaptive-execution': adaptiveView,
  'exchange-shuffle': exchangeView,
  'columnar-processing': columnarView,
};
