// internals-A: planning layer views (statistics, cardinality, cost model, plans, optimizer, plan cache, pipelines)
import * as THREE from 'three';

const C = { text: '#e6e9f5', dim: '#7f8aa8', blue: '#7aa2f7', purple: '#bb9af7', amber: '#e0af68', green: '#9ece6a', red: '#f7768e', cyan: '#2ac3de', orange: '#ff9e64', grey: '#3b4261', panel: '#151a2a', panel2: '#1e2540', white: '#ffffff' };
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const cfgOf = (ctx) => (ctx && ctx.config) || {};

// ---------------------------------------------------------------- drawing kit
function makeKit(ctx) {
  const root = new THREE.Group();
  const plane = new THREE.PlaneGeometry(1, 1);
  const circle = new THREE.CircleGeometry(0.5, 24);
  const mats = new Map();
  const mat = (c, o = 1) => {
    const k = c + '|' + o; let m = mats.get(k);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: c, transparent: o < 1, opacity: o, depthWrite: o >= 1, side: THREE.DoubleSide }); m.userData.cached = true; mats.set(k, m); }
    return m;
  };
  const lmats = new Map();
  const lmat = (c, o = 1) => {
    const k = c + '|' + o; let m = lmats.get(k);
    if (!m) { m = new THREE.LineBasicMaterial({ color: c, transparent: o < 1, opacity: o }); m.userData.cached = true; lmats.set(k, m); }
    return m;
  };
  const killObj = (o) => {
    o.traverse((x) => {
      if (x.geometry && x.geometry !== plane && x.geometry !== circle) x.geometry.dispose();
      const m = x.material;
      if (m && !m.userData.cached) { if (m.map) m.map.dispose(); m.dispose(); }
    });
  };
  const K = { root, mat, C };
  K.group = (p, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); (p || root).add(g); return g; };
  K.rect = (p, x, y, w, h, c, o = 1, z = 0) => { const m = new THREE.Mesh(plane, mat(c, o)); m.position.set(x, y, z); m.scale.set(w, h, 1); (p || root).add(m); return m; };
  K.dot = (p, x, y, r, c, o = 1, z = 0) => { const m = new THREE.Mesh(circle, mat(c, o)); m.position.set(x, y, z); m.scale.set(r * 2, r * 2, 1); (p || root).add(m); return m; };
  K.text = (p, s, x, y, o = {}) => {
    const l = ctx.makeLabel(String(s), { size: o.size ?? 0.4, color: o.color ?? C.text, align: o.align });
    l.position.set(x, y, o.z ?? 0.3); (p || root).add(l); return l;
  };
  // frame (outline) of a rectangle
  K.frame = (p, x, y, w, h, c, o = 1, z = 0.02) => { const l = K.line(p, [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2], [x - w / 2, y - h / 2]], c, o, z); l.material = l.material.clone(); l.material.userData = { cached: false }; return l; };
  K.line = (p, pts, c, o = 1, z = 0.01) => {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map((q) => new THREE.Vector3(q[0], q[1], q[2] ?? z)));
    const l = new THREE.Line(g, lmat(c, o)); (p || root).add(l); return l;
  };
  K.segs = (p, pairs, c, o = 1, z = 0.01) => {
    const v = []; pairs.forEach(([a, b]) => { v.push(new THREE.Vector3(a[0], a[1], z), new THREE.Vector3(b[0], b[1], z)); });
    const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(v), lmat(c, o)); (p || root).add(l); return l;
  };
  K.free = (o) => { o.removeFromParent(); killObj(o); };
  K.clear = (g) => { for (const ch of [...g.children]) K.free(ch); };
  // dynamic label: rebuilt only when text/colour change
  K.dyn = (p, x, y, s, o = {}) => {
    const h = { s: null, c: null, o, obj: null };
    h.set = (t, c) => {
      t = String(t); c = c ?? o.color ?? C.text;
      if (t === h.s && c === h.c) return; h.s = t; h.c = c;
      if (h.obj) K.free(h.obj);
      h.obj = K.text(p, t, x, y, { ...o, color: c });
    };
    h.set(s, o.color); return h;
  };
  K.dispose = () => { killObj(root); mats.forEach((m) => m.dispose()); lmats.forEach((m) => m.dispose()); plane.dispose(); circle.dispose(); };

  // generic tree. node: {t, sub, color, kids, note}. returns {group,nodes,tick(time)}
  K.tree = (p, rootNode, o = {}) => {
    const g = K.group(p, o.x ?? 0, o.y ?? 0);
    const gap = o.gap ?? 2.6, dy = o.dy ?? 1.7, bh = o.h ?? 0.95, fs = o.size ?? 0.36;
    let leaf = 0; const all = [];
    const lay = (n, d) => {
      n.d = d; all.push(n);
      if (!n.kids || !n.kids.length) { n.x = leaf++ * gap; return; }
      n.kids.forEach((k) => lay(k, d + 1));
      n.x = (n.kids[0].x + n.kids[n.kids.length - 1].x) / 2;
    };
    lay(rootNode, 0);
    const wTot = Math.max(0, leaf - 1) * gap; let sc = 1; if (o.maxW && wTot > o.maxW) sc = o.maxW / wTot;
    all.forEach((n) => { n.px = (n.x - wTot / 2) * sc; n.py = -n.d * dy; });
    const edges = [];
    all.forEach((n) => (n.kids || []).forEach((k) => { K.line(g, [[k.px, k.py + bh / 2], [n.px, n.py - bh / 2]], C.dim, 0.8, 0); edges.push([k, n]); }));
    all.forEach((n, i) => {
      const w = Math.max(1.3, Math.max((n.t || '').length * fs * 0.62, (n.sub || '').length * fs * 0.5 * 0.72) + 0.5);
      n.w = w;
      const ng = K.group(g, n.px, n.py); n.g = ng;
      K.rect(ng, 0, 0, w, bh, n.color || C.panel2, 1, 0.05);
      K.frame(ng, 0, 0, w, bh, n.border || C.white, 0.35, 0.06);
      K.text(ng, n.t, 0, n.sub ? 0.16 : 0, { size: fs, color: n.fg || '#0b0d14', z: 0.1 });
      if (n.sub) K.text(ng, n.sub, 0, -0.2, { size: fs * 0.72, color: n.fg || '#0b0d14', z: 0.1 });
      if (n.note) K.text(ng, n.note, w / 2 + 0.12 + n.note.length * fs * 0.7 * 0.3, 0, { size: fs * 0.7, color: C.amber, z: 0.1, align: 'left' });
      n.delay = i * 0.1;
    });
    const dots = edges.map(([k]) => K.dot(g, 0, 0, 0.09, k.color || C.amber, 1, 0.2));
    const tv = {
      group: g, nodes: all, root: rootNode, t0: null,
      tick(t) {
        if (tv.t0 === null) tv.t0 = t;
        const dt = t - tv.t0;
        all.forEach((n) => { const s = ease((dt - n.delay) / 0.35); n.g.scale.setScalar(Math.max(0.001, s)); });
        edges.forEach(([k, n], i) => {
          const ph = ((t * 0.5 + i * 0.37) % 1);
          dots[i].position.set(k.px + (n.px - k.px) * ph, k.py + bh / 2 + (n.py - bh / 2 - k.py - bh / 2) * ph, 0.2);
          dots[i].visible = dt > 1.2 && !o.noFlow;
        });
      },
    };
    return tv;
  };
  return K;
}
const finish = (K, group) => K;

// ================================================================ STATISTICS
const DOM = 200;
const STAT_KEYS = { 'equi-width-histogram': 'ew', 'equi-depth-histogram': 'ed', 'ddsketch-quantile': 'dds', 'hyperloglog-ndv': 'hll', sampling: 'smp' };
const STAT_NAMES = { ew: 'Equi-width histogram', ed: 'Equi-depth histogram', dds: 'DDSketch (log buckets)', hll: 'HyperLogLog (NDV)', smp: 'Sampling (5%)' };
const STAT_COL = { ew: C.amber, ed: C.purple, dds: C.cyan, hll: C.green, smp: C.red };
const hash32 = (x) => { x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };

function zipfData() {
  const cnt = new Array(DOM + 1).fill(0); let H = 0; for (let v = 1; v <= DOM; v++) H += 1 / v;
  let N = 0; for (let v = 1; v <= DOM; v++) { cnt[v] = Math.round(10000 / H / v); N += cnt[v]; }
  return { cnt, N };
}
function buildStats(alpha, p) {
  const { cnt, N } = zipfData();
  const pre = new Array(DOM + 1).fill(0); for (let v = 1; v <= DOM; v++) pre[v] = pre[v - 1] + cnt[v];
  const trueCount = (lo, hi) => pre[hi] - pre[lo - 1];
  // equi-width: 10 buckets x 20 values
  const ew = []; for (let b = 0; b < 10; b++) { const lo = b * 20 + 1, hi = lo + 19; ew.push({ lo, hi, n: trueCount(lo, hi) }); }
  // equi-depth: close a bucket when it reaches N/10 rows (heavy hitters get their own bucket)
  const ed = []; { const depth = N / 10; let lo = 1, acc = 0; for (let v = 1; v <= DOM; v++) { acc += cnt[v]; if (acc >= depth || v === DOM) { ed.push({ lo, hi: v, n: acc }); lo = v + 1; acc = 0; } } }
  const histEst = (bs, lo, hi) => { let e = 0; bs.forEach((b) => { const a = Math.max(lo, b.lo), z = Math.min(hi, b.hi); if (z >= a) e += b.n * (z - a + 1) / (b.hi - b.lo + 1); }); return e; };
  // DDSketch: bucket i holds values in (gamma^(i-1), gamma^i]
  const gamma = (1 + alpha) / (1 - alpha), lg = Math.log(gamma);
  const bidx = (v) => Math.ceil(Math.log(v) / lg - 1e-9);
  const dmap = new Map(); for (let v = 1; v <= DOM; v++) { const i = bidx(v); dmap.set(i, (dmap.get(i) || 0) + cnt[v]); }
  const dds = [...dmap.entries()].sort((a, b) => a[0] - b[0]).map(([i, n]) => ({ i, n, loV: Math.pow(gamma, i - 1), hiV: Math.pow(gamma, i) }));
  const rank = (x) => { if (x < 1) return 0; const i = bidx(x); let s = 0; dds.forEach((b) => { if (b.i <= i) s += b.n; }); return s; };
  const ddsEst = (lo, hi) => rank(hi) - rank(lo - 1);
  const ddsQ = (q) => { const t = q * N; let s = 0; for (const b of dds) { s += b.n; if (s >= t) return (2 * Math.pow(gamma, b.i)) / (gamma + 1); } return DOM; };
  const trueQ = (q) => { const t = q * N; let s = 0; for (let v = 1; v <= DOM; v++) { s += cnt[v]; if (s >= t) return v; } return DOM; };
  const totalBuckets = Math.ceil(Math.log(DOM) / lg);
  // HyperLogLog
  const m = 1 << p, regAt = [], rankAt = [];
  for (let v = 1; v <= DOM; v++) { const h = hash32(v * 2654435761 >>> 0); const idx = h >>> (32 - p); const w = (h << p) >>> 0; const r = w === 0 ? 32 - p + 1 : Math.clz32(w) + 1; regAt.push(idx); rankAt.push(r); }
  const hllCalc = (k) => {
    const M = new Array(m).fill(0); for (let j = 0; j < k; j++) M[regAt[j]] = Math.max(M[regAt[j]], rankAt[j]);
    const al = m === 16 ? 0.673 : m === 32 ? 0.697 : m === 64 ? 0.709 : 0.7213 / (1 + 1.079 / m);
    let s = 0, z = 0; M.forEach((r) => { s += Math.pow(2, -r); if (r === 0) z++; });
    let E = al * m * m / s, lin = false; if (E <= 2.5 * m && z > 0) { E = m * Math.log(m / z); lin = true; }
    return { M, E, lin };
  };
  const hllFull = hllCalc(DOM);
  const hllEst = (lo, hi) => N * (hi - lo + 1) / hllFull.E;
  // sampling 5%
  let seed = 12345; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const smp = new Array(DOM + 1).fill(0); let smpN = 0; for (let v = 1; v <= DOM; v++) for (let j = 0; j < cnt[v]; j++) if (rnd() < 0.05) { smp[v]++; smpN++; }
  const smpEst = (lo, hi) => { let s = 0; for (let v = lo; v <= hi; v++) s += smp[v]; return s * 20; };
  return { cnt, N, trueCount, ew, ed, dds, gamma, alpha, bidx, ddsQ, trueQ, totalBuckets, hllFull, hllCalc, m, p, regAt, rankAt, smp, smpN,
    est: { ew: (l, h) => histEst(ew, l, h), ed: (l, h) => histEst(ed, l, h), dds: ddsEst, hll: hllEst, smp: smpEst } };
}

let statCur = null;
const statView = {
  controls: [
    { id: 'method', label: 'structure', type: 'select', options: Object.entries(STAT_NAMES).map(([value, label]) => ({ value, label })), value: 'ew', onChange: (v) => statCur && statCur.setMethod(v) },
    { id: 'lo', label: 'predicate: v >= lo', type: 'range', min: 1, max: 200, value: 2, onChange: (v) => statCur && statCur.setPred(+v, null) },
    { id: 'hi', label: 'predicate: v <= hi', type: 'range', min: 1, max: 200, value: 30, onChange: (v) => statCur && statCur.setPred(null, +v) },
    { id: 'alpha', label: 'DDSketch relative error', type: 'select', options: [{ value: '0.01', label: 'alpha = 1%' }, { value: '0.05', label: 'alpha = 5%' }], value: '0.01', onChange: (v) => statCur && statCur.setAlpha(+v) },
    { id: 'hllp', label: 'HLL precision p', type: 'select', options: [{ value: '4', label: 'p=4 (16 regs)' }, { value: '5', label: 'p=5 (32 regs)' }, { value: '6', label: 'p=6 (64 regs)' }], value: '5', onChange: (v) => statCur && statCur.setP(+v) },
  ],
  build(ctx) {
    const K = makeKit(ctx), root = K.root;
    let method = STAT_KEYS[cfgOf(ctx).statistics] || 'ew', lo = 2, hi = 30, alpha = 0.01, p = 5;
    let S = buildStats(alpha, p);
    let dirty = true, hllK = 0, hllShown = -1, t0 = null, regDyn = [];
    const X = (v) => -9 + ((v - 0.5) / DOM) * 18, Y0 = 0.9, YH = 4.6;
    const maxC = Math.sqrt(S.cnt[1]); const Yv = (d) => Y0 + (Math.sqrt(Math.max(d, 0)) / maxC) * YH;
    K.text(root, 'Column v (zipf-skewed, 10,000 rows, 200 distinct)   y-axis = sqrt(rows per value)', 0, 6.2, { size: 0.36, color: C.dim });
    K.rect(root, 0, Y0 + YH / 2 + 0.05, 18.4, YH + 0.3, C.panel, 1, -0.2);
    const bars = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#8d99c4' }), DOM);
    root.add(bars); bars.position.z = 0;
    const dm = new THREE.Object3D();
    const overlay = K.group(root), sidebar = K.group(root), cmp = K.group(root);
    const regs = K.group(root, -9, -1.9);
    const pred = K.rect(root, 0, Y0 + YH / 2, 1, YH + 0.2, C.white, 0.14, 0.15);
    const l1 = K.dyn(root, 0, -0.1, '', { size: 0.42 }), l2 = K.dyn(root, 0, -0.55, '', { size: 0.42 }), l3 = K.dyn(root, 0, -1.0, '', { size: 0.34, color: C.dim });
    const hllTxt = K.dyn(root, -5, -5.3, '', { size: 0.36, color: C.green });
    K.text(root, 'HyperLogLog registers  M[j] = max rank (leading zeros + 1)', -5, -1.55, { size: 0.34, color: C.dim });
    K.text(root, 'Error of each structure for this predicate', 5, -1.55, { size: 0.34, color: C.dim });
    const buildRegs = () => {
      K.clear(regs); regDyn = []; const cols = Math.min(16, S.m), rows = S.m / cols, cw = 0.5;
      for (let j = 0; j < S.m; j++) { const x = (j % cols) * cw + 0.25, y = -Math.floor(j / cols) * 0.62 - 0.3; K.rect(regs, x, y, cw * 0.92, 0.55, C.panel2, 1, 0); regDyn.push(K.dyn(regs, x, y, '0', { size: 0.36, color: C.dim })); }
      hllShown = -1;
    };
    const drawOverlay = () => {
      K.clear(overlay);
      const col = STAT_COL[method];
      const block = (a, b, d, c, o = 0.35) => { const x0 = X(a - 0.5), x1 = X(b + 0.5), y = Yv(d); K.rect(overlay, (x0 + x1) / 2, (Y0 + y) / 2, x1 - x0 - 0.02, y - Y0, c, o, 0.1); K.line(overlay, [[x0, Y0], [x0, y], [x1, y], [x1, Y0]], c, 1, 0.12); };
      if (method === 'ew') S.ew.forEach((b) => { block(b.lo, b.hi, b.n / 20, col); K.text(overlay, fmt(b.n), X((b.lo + b.hi) / 2), Y0 - 0.28, { size: 0.3, color: col }); });
      if (method === 'ed') S.ed.forEach((b) => { block(b.lo, b.hi, b.n / (b.hi - b.lo + 1), col); if (b.hi - b.lo > 3 || b.lo === 1) K.text(overlay, fmt(b.n), X((b.lo + b.hi) / 2), Y0 - 0.28, { size: 0.3, color: col }); });
      if (method === 'dds') {
        const ticks = []; for (let i = 0; i <= S.totalBuckets; i++) { const v = Math.pow(S.gamma, i); if (v >= 1 && v <= DOM) ticks.push([[X(v + 0.5 - 0.5), Y0 - 0.05], [X(v), Y0 - 0.3]]); }
        K.segs(overlay, ticks, col, 1, 0.12);
        S.dds.forEach((b, k) => { const a = Math.max(1, Math.floor(b.loV) + (b.loV % 1 === 0 ? 1 : 1)), z = Math.min(DOM, Math.floor(b.hiV + 1e-9)); if (z < a) { /* sub-integer bucket holds the single integer below */ } const aa = Math.min(a, z), w = Math.max(1, z - aa + 1); const x0 = X(aa - 0.5), x1 = X(aa + w - 0.5), y = Yv(b.n / w); K.rect(overlay, (x0 + x1) / 2, (Y0 + y) / 2, x1 - x0 - 0.01, y - Y0, col, k % 2 ? 0.3 : 0.5, 0.1); });
        K.text(overlay, `${S.dds.length} non-empty buckets of ${S.totalBuckets} possible; bucket i = (gamma^(i-1), gamma^i], gamma=${S.gamma.toFixed(4)}`, 0, Y0 - 0.6, { size: 0.32, color: col });
      }
      if (method === 'hll') {
        const d = S.N / S.hllFull.E; K.line(overlay, [[-9, Yv(d)], [9, Yv(d)]], col, 1, 0.12);
        K.text(overlay, `uniform assumption: N / NDV_hat = ${d.toFixed(0)} rows per value (HLL cannot see skew)`, 3, Yv(d) + 0.25, { size: 0.32, color: col });
      }
      if (method === 'smp') for (let v = 1; v <= DOM; v++) if (S.smp[v]) { const y = Yv(S.smp[v] * 20); K.rect(overlay, X(v), (Y0 + y) / 2, 0.075, y - Y0, col, 0.55, 0.1); }
      const a = lo, b = hi; pred.position.x = (X(a - 0.5) + X(b + 0.5)) / 2; pred.scale.x = Math.max(0.05, X(b + 0.5) - X(a - 0.5));
    };
    const drawCmp = () => {
      K.clear(cmp); const tr = S.trueCount(lo, hi);
      Object.keys(STAT_NAMES).forEach((k, i) => {
        const e = S.est[k](lo, hi), err = Math.abs(e - tr) / Math.max(1, tr) * 100, y = -2.3 - i * 0.78, sel = k === method;
        if (sel) K.rect(cmp, 5, y, 8.6, 0.7, C.panel2, 1, -0.1);
        K.text(cmp, STAT_NAMES[k].replace(' histogram', '').replace(' (log buckets)', '').replace(' (NDV)', ''), 1.1, y, { size: 0.34, color: STAT_COL[k] });
        K.rect(cmp, 2.9 + clamp(err, 0.4, 100) / 100 * 2.4, y, clamp(err, 0.4, 100) / 100 * 4.8, 0.3, STAT_COL[k], 1, 0.1);
        K.text(cmp, `est ${fmt(e)}  err ${err < 10 ? err.toFixed(1) : err.toFixed(0)}%`, 7.9, y, { size: 0.32 });
      });
      const e = S.est[method](lo, hi), err = Math.abs(e - tr) / Math.max(1, tr) * 100;
      l1.set(`WHERE v BETWEEN ${lo} AND ${hi}     true rows = ${tr}`, C.text);
      l2.set(`${STAT_NAMES[method]} estimates ${Math.round(e)} rows  (error ${err.toFixed(1)}%)`, STAT_COL[method]);
      const d = { ew: '10 buckets x 20 values; rows inside a bucket assumed uniform (breaks on the heavy hitters at v=1,2,3)', ed: 'each bucket holds ~N/10 rows, so skew gets narrow buckets; single-value buckets are exact', dds: `p50 true ${S.trueQ(0.5)} / est ${S.ddsQ(0.5).toFixed(1)}   p99 true ${S.trueQ(0.99)} / est ${S.ddsQ(0.99).toFixed(1)}  (rel. error <= ${(S.alpha * 100).toFixed(0)}%)`, hll: 'counts DISTINCT values (NDV), not frequencies: range rows = N x width / NDV_hat', smp: `${S.smpN} sampled rows x 20; unbiased but variance explodes for rare ranges` }[method];
      l3.set(d, C.dim);
    };
    const refresh = () => { drawOverlay(); drawCmp(); dirty = false; };
    buildRegs();
    const api = {
      setMethod(v) { method = v; dirty = true; },
      setPred(a, b) { if (a !== null) lo = a; if (b !== null) hi = b; if (lo > hi) { if (a !== null) hi = lo; else lo = hi; } dirty = true; },
      setAlpha(a) { alpha = a; S = buildStats(alpha, p); dirty = true; },
      setP(v) { p = v; S = buildStats(alpha, p); buildRegs(); hllK = 0; dirty = true; },
    };
    statCur = api;
    const inst = {
      group: root,
      update(dt, t) {
        if (t0 === null) t0 = t;
        const g = ease((t - t0) / 1.5);
        for (let v = 1; v <= DOM; v++) { const h = Math.max(0.001, (Yv(S.cnt[v]) - Y0) * g); dm.position.set(X(v), Y0 + h / 2, 0.05); dm.scale.set(0.082, h, 1); dm.updateMatrix(); bars.setMatrixAt(v - 1, dm.matrix); }
        bars.instanceMatrix.needsUpdate = true;
        if (hllK < DOM) hllK = Math.min(DOM, hllK + dt * 40); else if (hllShown === DOM) { /* done */ }
        const k = Math.floor(hllK);
        if (k !== hllShown) {
          hllShown = k; const r = S.hllCalc(k);
          r.M.forEach((x, j) => regDyn[j].set(String(x), x ? (x >= 4 ? C.green : C.text) : C.dim));
          hllTxt.set(`inserted ${k}/200 distinct values: NDV_hat = ${r.E.toFixed(0)} ${r.lin ? '(linear counting)' : '(harmonic mean)'}   true 200   std err ~ ${(104 / Math.sqrt(S.m)).toFixed(0)}%`, C.green);
        }
        if (dirty) refresh();
      },
      dispose() { statCur = null; bars.geometry.dispose(); bars.material.dispose(); K.dispose(); },
      onConfigChange(c) { const m = STAT_KEYS[c.statistics]; if (m) { method = m; dirty = true; } },
      steps: [
        { title: 'A skewed column', text: 'Same column for every structure: zipf-distributed, value 1 has ~1700 rows, value 200 has ~9. The optimizer must turn this into selectivities without scanning.', run() { api.setMethod(method); api.setPred(2, 30); ctx.onInfo && ctx.onInfo('<b>Skew</b>: uniform assumptions fail here. Predicate v BETWEEN 2 AND 30 is highlighted.'); } },
        { title: 'Equi-width histogram', text: '10 fixed-width buckets. Cheap to build, but one bucket mixes the heavy hitters with the tail; rows assumed uniform inside a bucket.', run() { api.setMethod('ew'); api.setPred(2, 30); } },
        { title: 'Equi-depth histogram', text: 'Buckets hold ~equal row counts, so dense (skewed) regions get fine resolution; PostgreSQL pg_statistic histogram_bounds works this way (plus MCV list).', run() { api.setMethod('ed'); api.setPred(2, 30); } },
        { title: 'DDSketch', text: 'Log-spaced buckets with gamma=(1+a)/(1-a): every quantile has relative error <= a. Mergeable, constant size; used for latency percentiles and increasingly in engines.', run() { api.setMethod('dds'); api.setPred(2, 30); } },
        { title: 'HyperLogLog', text: 'Hash each value, top p bits choose register, store max leading-zero rank. Estimate = alpha*m^2 / sum 2^-M[j]. Gives NDV (for join / group-by sizing), not range selectivity.', run() { api.setMethod('hll'); hllK = 0; } },
        { title: 'Sampling and comparison', text: 'A 5% sample is unbiased but noisy for narrow ranges. Drag lo/hi: watch each structure\'s error change; the bottom-right bars compare all five.', run() { api.setMethod('smp'); api.setPred(100, 110); } },
      ],
    };
    refresh();
    return inst;
  },
};

// ================================================================ OPTIMIZER (join-order search on a 4-table query)
const REL = [{ n: 'C', full: 'customer', card: 1000, col: C.blue }, { n: 'O', full: 'orders', card: 10000, col: C.purple }, { n: 'L', full: 'lineitem', card: 40000, col: C.cyan }, { n: 'P', full: 'product*', card: 50, col: C.green }];
const JEDGES = [[0, 1, 1 / 1000], [1, 2, 1 / 10000], [2, 3, 1 / 500]];
const FULL = 15;
const pc = (S) => { let c = 0; for (; S; S &= S - 1) c++; return c; };
const nmOf = (S) => REL.filter((_, i) => S & (1 << i)).map((r) => r.n).join('');
const cardOf = (S) => { let c = 1; REL.forEach((r, i) => { if (S & (1 << i)) c *= r.card; }); JEDGES.forEach(([a, b, s]) => { if ((S & (1 << a)) && (S & (1 << b))) c *= s; }); return Math.round(c); };
const hasEdge = (A, B) => JEDGES.some(([a, b]) => ((A >> a) & 1 && (B >> b) & 1) || ((A >> b) & 1 && (B >> a) & 1));
const connectedS = (S) => { if (!S) return false; let seen = S & -S, ch = true; while (ch) { ch = false; JEDGES.forEach(([a, b]) => { const A = 1 << a, B = 1 << b; if ((S & A) && (S & B) && ((seen & A) ? !(seen & B) : (seen & B) && !(seen & A))) { seen |= A | B; ch = true; } }); } return seen === S; };
const splitsOf = (S) => { const out = []; for (let A = (S - 1) & S; A > 0; A = (A - 1) & S) { const B = S ^ A; if (!(A & (S & -S))) continue; if (connectedS(A) && connectedS(B) && hasEdge(A, B)) out.push([A, B]); } out.sort((x, y) => (Math.max(pc(y[0]), pc(y[1])) - Math.max(pc(x[0]), pc(x[1]))) || (y[0] - x[0])); return out; };
const SUBSETS = []; for (let S = 1; S <= FULL; S++) if (connectedS(S)) SUBSETS.push(S);
// exact DP (for reference, C_out cost model: cost = sum of intermediate result sizes)
const BEST = {}; SUBSETS.slice().sort((a, b) => pc(a) - pc(b)).forEach((S) => { if (pc(S) === 1) { BEST[S] = { cost: 0, split: null }; return; } let b = null; splitsOf(S).forEach(([A, B]) => { const c = BEST[A].cost + BEST[B].cost + cardOf(S); if (!b || c < b.cost) b = { cost: c, split: [A, B] }; }); BEST[S] = b; });
const planSpec = (S, best = BEST) => { if (pc(S) === 1) { const r = REL[Math.log2(S)]; return { t: r.n, sub: r.full, color: r.col, border: r.col }; } const [A, B] = best[S].split; return { t: 'JOIN', sub: `|${nmOf(S)}|=${fmt(cardOf(S))}`, color: C.amber, kids: [planSpec(A, best), planSpec(B, best)] }; };
const treeCost = (t) => (t.kids ? t.kids.reduce((s, k) => s + treeCost(k), 0) + t.card : 0);
const leftDeep = (order) => order.slice(1).reduce((acc, i) => ({ S: acc.S | (1 << i), card: cardOf(acc.S | (1 << i)), kids: [acc, { S: 1 << i }] }), { S: 1 << order[0] });

let optCur = null;
const OPT_ALGOS = [['bottom-up-dp', 'Bottom-up DP (System R / DPsize)'], ['top-down-cascades', 'Top-down Cascades (memo + branch&bound)'], ['hypergraph-dphyp', 'DPhyp / DPccp (graph enumeration)'], ['heuristic-rules', 'Heuristic rule rewrite'], ['learned', 'Learned (model proposes, optimizer verifies)']];

function optimizerAlgo(id, K, parent, ctx) {
  const g = K.group(parent), ev = []; const R = [];  // ev: {text, fn}; R: reset fns
  const add = (text, fn) => ev.push({ text, fn });
  const PL = { 'bottom-up-dp': [7.2, 2.4, 1.6], 'top-down-cascades': [7.4, -2.1, 1.1], 'hypergraph-dphyp': [7.2, -2.5, 1.1], learned: [7.0, -2.5, 1.1] }[id] || [7.2, 2, 1.4];
  const bestTreeBox = K.group(g, PL[0], PL[1]);
  let planTv = null;
  const showPlan = (spec, title) => { K.clear(bestTreeBox); K.text(bestTreeBox, title, 0, 0.9, { size: 0.36, color: C.amber }); planTv = K.tree(bestTreeBox, spec, { y: 0, gap: 1.9, dy: PL[2], h: 0.8, size: 0.34, maxW: 5.2, noFlow: true }); planTv.t0 = null; };
  const hidePlan = () => { K.clear(bestTreeBox); planTv = null; };
  R.push(hidePlan);
  const tickPlan = (t) => planTv && planTv.tick(t);
  const total = { sizeTxt: '' };

  if (id === 'bottom-up-dp') {
    const cols = [1, 2, 3, 4], cx = (s) => -8.4 + (s - 1) * 3.25, cells = {};
    cols.forEach((s) => K.text(g, `size ${s}`, cx(s), 4.9, { size: 0.38, color: C.dim }));
    cols.forEach((s) => SUBSETS.filter((S) => pc(S) === s).forEach((S, i) => {
      const x = cx(s), y = 3.7 - i * 1.7, bx = K.group(g, x, y);
      K.rect(bx, 0, 0, 3.0, 1.5, C.panel, 1, 0); const fr = K.frame(bx, 0, 0, 3.0, 1.5, C.grey, 1);
      const t1 = K.dyn(bx, 0, 0.42, `{${nmOf(S)}}`, { size: 0.44, color: C.dim }), t2 = K.dyn(bx, 0, -0.05, '', { size: 0.34 }), t3 = K.dyn(bx, 0, -0.45, '', { size: 0.34 });
      cells[S] = { bx, fr, t1, t2, t3, x, y };
      R.push(() => { t1.set(`{${nmOf(S)}}`, C.dim); t2.set(''); t3.set(''); fr.material = K.mat ? fr.material : fr.material; fr.visible = true; });
    }));
    const note = K.dyn(g, -3.2, -3.5, `skipped (cross products): ${SUBSETS.length ? [5, 9, 10, 11, 13].map(nmOf).join(' ') : ''}`, { size: 0.34, color: C.dim });
    const read = K.dyn(g, -3.2, -4.4, '', { size: 0.38, color: C.amber }), read2 = K.dyn(g, -3.2, -5.0, '', { size: 0.34, color: C.dim });
    R.push(() => { read.set(''); read2.set(''); });
    const done = {};
    cols.forEach((s) => SUBSETS.filter((S) => pc(S) === s).forEach((S) => {
      const c = cells[S];
      if (s === 1) { add(`size 1: base relation ${REL[Math.log2(S)].n}, cost 0, |${nmOf(S)}| = ${fmt(cardOf(S))}`, () => { c.t1.set(`{${nmOf(S)}}`, C.text); c.t2.set(`card ${fmt(cardOf(S))}`, C.text); c.t3.set('cost 0', C.green); c.fr.material.color.set(C.blue); read.set('base relations: cost 0', C.amber); read2.set(''); }); return; }
      const sp = splitsOf(S);
      const cands = sp.map(([A, B]) => ({ A, B, cost: BEST[A].cost + BEST[B].cost + cardOf(S) }));
      add(`{${nmOf(S)}}: try ${cands.map((x) => `${nmOf(x.A)}|${nmOf(x.B)}=${fmt(x.cost)}`).join('  ')}`, () => { c.t1.set(`{${nmOf(S)}}`, C.amber); c.fr.material.color.set(C.amber); read.set(`{${nmOf(S)}}: ` + cands.map((x) => `${nmOf(x.A)}|${nmOf(x.B)} = ${fmt(x.cost)}`).join('   '), C.amber); read2.set(`cost(S) = cost(A) + cost(B) + |A join B|;  only connected A,B with a join edge`, C.dim); c.t2.set(`card ${fmt(cardOf(S))}`, C.text); });
      add(`{${nmOf(S)}}: best = ${nmOf(BEST[S].split[0])} join ${nmOf(BEST[S].split[1])}, cost ${fmt(BEST[S].cost)}`, () => { c.t1.set(`{${nmOf(S)}}`, C.text); c.t3.set(`${nmOf(BEST[S].split[0])}|${nmOf(BEST[S].split[1])}  ${fmt(BEST[S].cost)}`, C.green); c.fr.material.color.set(C.green); });
    }));
    add(`optimal plan cost ${fmt(BEST[FULL].cost)}: 10 table entries, 25 candidate splits across the lattice (cross products pruned)`, () => { cells[FULL].fr.material.color.set(C.white); read.set(`optimum = ${fmt(BEST[FULL].cost)} (rows flowing through joins)`, C.green); read2.set('exhaustive over bushy trees; time/space O(3^n) for n relations', C.dim); showPlan(planSpec(FULL), 'chosen plan'); });
  }

  if (id === 'top-down-cascades') {
    const pos = { 15: [-4.1, 4.0, 5.8, 2.1], 7: [-7.0, 1.2, 5.2, 1.7], 14: [-1.3, 1.2, 5.2, 1.7], 3: [-8.3, -1.3, 3.5, 1.2], 6: [-4.1, -1.3, 3.5, 1.2], 12: [0.0, -1.3, 3.5, 1.2], 1: [-8.4, -3.5, 1.3, 0.8], 2: [-5.6, -3.5, 1.3, 0.8], 4: [-2.8, -3.5, 1.3, 0.8], 8: [0, -3.5, 1.3, 0.8] };
    const gidx = {}; Object.keys(pos).map(Number).sort((a, b) => pc(b) - pc(a)).forEach((S, i) => (gidx[S] = i + 1));
    const grp = {};
    Object.entries(pos).forEach(([k, [x, y, w, h]]) => {
      const S = +k, bx = K.group(g, x, y); K.rect(bx, 0, 0, w, h, C.panel, 1, 0); const fr = K.frame(bx, 0, 0, w, h, C.grey, 1);
      const sp = pc(S) > 1 ? splitsOf(S) : [];
      const hd = K.dyn(bx, 0, h / 2 - 0.27, pc(S) > 1 ? `Group ${gidx[S]}  {${nmOf(S)}}  |${fmt(cardOf(S))}|` : `G${gidx[S]} scan ${nmOf(S)}`, { size: 0.34, color: C.dim });
      const lines = sp.map(([A, B], i) => K.dyn(bx, 0, h / 2 - 0.72 - i * 0.42, `${nmOf(A)} JOIN ${nmOf(B)}`, { size: 0.32, color: C.dim }));
      grp[S] = { bx, fr, hd, lines, sp, base: pc(S) > 1 ? `Group ${gidx[S]}  {${nmOf(S)}}  |${fmt(cardOf(S))}|` : `G${gidx[S]} scan ${nmOf(S)}` };
      R.push(() => { fr.material.color.set(C.grey); hd.set(grp[S].base, C.dim); lines.forEach((l, i) => l.set(`${nmOf(sp[i][0])} JOIN ${nmOf(sp[i][1])}`, C.dim)); });
    });
    const segs = []; Object.values(grp).forEach(() => 0);
    Object.keys(pos).forEach((k) => { const S = +k; if (pc(S) < 2) return; const m = new Set(); splitsOf(S).forEach(([A, B]) => { m.add(A); m.add(B); }); m.forEach((c) => { if (pos[c]) segs.push([[pos[k][0], pos[k][1] - pos[k][3] / 2], [pos[c][0], pos[c][1] + pos[c][3] / 2]]); }); });
    K.segs(g, segs, C.grey, 0.5, -0.05);
    const read = K.dyn(g, -3.5, -5.2, '', { size: 0.36, color: C.amber }); R.push(() => read.set(''));
    const logG = K.group(g, 7.4, 0); const logLines = []; for (let i = 0; i < 9; i++) logLines.push(K.dyn(logG, 0, 4.7 - i * 0.62, '', { size: 0.31, color: C.dim }));
    K.text(g, 'optimizer trace (recursion events)', 7.4, 5.4, { size: 0.34, color: C.dim });
    const logBuf = []; R.push(() => { logBuf.length = 0; logLines.forEach((l) => l.set('')); });
    const pushLog = (s, col) => { logBuf.push([s, col]); while (logBuf.length > 9) logBuf.shift(); logLines.forEach((l, i) => { const e = logBuf[i]; if (e) l.set(e[0], e[1]); else l.set(''); }); };
    const stats = { prune: 0, hit: 0, costed: 0 }; const sTxt = K.dyn(g, 7.4, -5.6, '', { size: 0.34, color: C.green });
    R.push(() => { stats.prune = stats.hit = stats.costed = 0; sTxt.set(''); });
    const upd = () => sTxt.set(`costed ${stats.costed} exprs   pruned ${stats.prune} (branch&bound)   memo hits ${stats.hit}`, C.green);
    const memo = {}, failLim = {};
    const ind = (d) => '  '.repeat(d);
    const run = (S, limit, d) => {
      const lim = limit === Infinity ? 'inf' : fmt(limit);
      if (pc(S) === 1) return 0;
      if (memo[S]) { const c = memo[S].cost; add(`memo hit: G${gidx[S]} {${nmOf(S)}} best=${fmt(c)}`, () => { stats.hit++; grp[S].fr.material.color.set(C.cyan); pushLog(`${ind(d)}memo hit {${nmOf(S)}} = ${fmt(c)}`, C.cyan); upd(); }); return c < limit ? c : null; }
      if (failLim[S] !== undefined && failLim[S] >= limit) { add(`known: {${nmOf(S)}} cannot beat ${lim}`, () => { stats.hit++; pushLog(`${ind(d)}memo: {${nmOf(S)}} > ${lim}`, C.red); upd(); }); return null; }
      add(`optimizeGroup({${nmOf(S)}}, limit=${lim})`, () => { grp[S].fr.material.color.set(C.amber); grp[S].hd.set(`${grp[S].base}   limit ${lim}`, C.amber); pushLog(`${ind(d)}optimizeGroup {${nmOf(S)}} limit=${lim}`, C.amber); read.set(`explore group {${nmOf(S)}} with upper bound ${lim}`, C.amber); });
      let bound = limit, best = null; const card = cardOf(S);
      grp[S].sp.forEach(([A, B], i) => {
        const nm = `${nmOf(A)} JOIN ${nmOf(B)}`;
        if (card >= bound) { add(`prune ${nm}: output ${fmt(card)} >= bound`, () => { stats.prune++; grp[S].lines[i].set(`x ${nm}  PRUNED (lb ${fmt(card)} >= ${fmt(bound)})`, C.red); pushLog(`${ind(d + 1)}prune ${nm}: lb ${fmt(card)} >= ${fmt(bound)}`, C.red); upd(); }); return; }
        add(`cost ${nm}`, () => { grp[S].lines[i].set(`> ${nm}  costing...`, C.amber); });
        const ca = run(A, bound - card, d + 1);
        let cb = null; if (ca !== null) cb = run(B, bound - card - ca, d + 1);
        if (ca === null || cb === null) { add(`${nm}: child exceeds budget`, () => { stats.prune++; grp[S].lines[i].set(`x ${nm}  child over budget`, C.red); pushLog(`${ind(d + 1)} ${nm}: child over budget`, C.red); upd(); }); return; }
        const tot = card + ca + cb;
        if (tot < bound) { bound = tot; best = { cost: tot, split: [A, B], i }; add(`${nm} cost ${fmt(tot)}: new best`, () => { stats.costed++; grp[S].lines.forEach((l, j) => { if (j === i) l.set(`* ${nm}  cost ${fmt(tot)}  BEST`, C.green); }); pushLog(`${ind(d + 1)}${nm} = ${fmt(tot)} new best`, C.green); upd(); }); }
        else add(`${nm} cost ${fmt(tot)}: not better`, () => { stats.costed++; grp[S].lines[i].set(`  ${nm}  cost ${fmt(tot)}`, C.dim); upd(); });
      });
      if (best) { memo[S] = best; add(`G${gidx[S]} {${nmOf(S)}} winner ${fmt(best.cost)}`, () => { grp[S].fr.material.color.set(C.green); grp[S].hd.set(`${grp[S].base}  best ${fmt(best.cost)}`, C.green); pushLog(`${ind(d)}=> {${nmOf(S)}} best ${fmt(best.cost)}`, C.green); }); return best.cost; }
      failLim[S] = Math.max(failLim[S] ?? 0, limit);
      add(`G${gidx[S]} {${nmOf(S)}}: nothing under ${lim}`, () => { grp[S].fr.material.color.set(C.red); grp[S].hd.set(`${grp[S].base}  > ${lim}`, C.red); pushLog(`${ind(d)}=> {${nmOf(S)}} none under ${lim}`, C.red); });
      return null;
    };
    const fin = run(FULL, Infinity, 0);
    const cb = {}; Object.keys(memo).forEach((k) => (cb[k] = memo[k]));
    add(`root best cost ${fmt(fin)} (matches exhaustive DP ${fmt(BEST[FULL].cost)})`, () => { grp[FULL].fr.material.color.set(C.white); read.set(`winner = ${fmt(fin)}; subtrees pruned never costed fully`, C.green); showPlan(planSpec(FULL, Object.assign({}, BEST, cb)), 'extracted plan'); });
  }

  if (id === 'hypergraph-dphyp') {
    const np = [[-8.2, 2.2], [-5.7, 2.2], [-3.2, 2.2], [-0.7, 2.2]], nodes = [];
    JEDGES.forEach(([a, b]) => K.line(g, [[np[a][0], np[a][1], 0], [np[b][0], np[b][1], 0]], C.dim, 1, 0));
    JEDGES.forEach(([a, b, s]) => K.text(g, `sel 1/${Math.round(1 / s)}`, (np[a][0] + np[b][0]) / 2, np[a][1] + 0.55, { size: 0.28, color: C.dim }));
    REL.forEach((r, i) => { const d = K.dot(g, np[i][0], np[i][1], 0.5, C.grey, 1, 0.1); K.text(g, r.n, np[i][0], np[i][1], { size: 0.5, color: C.text, z: 0.2 }); K.text(g, `${r.full} ${fmt(r.card)}`, np[i][0], np[i][1] - 0.85, { size: 0.28, color: C.dim }); nodes.push(d); });
    K.text(g, 'join (hyper)graph: nodes = relations, edges = join predicates', -4.5, 3.8, { size: 0.34, color: C.dim });
    K.text(g, 'a complex predicate like C.a+P.b=L.c is a hyperedge ({C,P},{L}) which DPhyp handles natively', -4.5, 0.6, { size: 0.28, color: C.dim });
    const setNodes = (A, B) => nodes.forEach((d, i) => d.material = d.material, 0);
    const colorNodes = (A, B) => nodes.forEach((d, i) => { const c = A & (1 << i) ? C.blue : B & (1 << i) ? C.orange : C.grey; d.material = K.mat(c); });
    R.push(() => colorNodes(0, 0));
    // DPccp enumeration
    const adj = REL.map((_, i) => { let m = 0; JEDGES.forEach(([a, b]) => { if (a === i) m |= 1 << b; if (b === i) m |= 1 << a; }); return m; });
    const nbr = (S, X) => { let r = 0; for (let i = 0; i < 4; i++) if (S & (1 << i)) r |= adj[i]; return r & ~S & ~X; };
    const low = (S) => 31 - Math.clz32(S & -S);
    const Bm = (i) => (1 << (i + 1)) - 1;
    const subs = (N) => { const o = []; for (let s = N; s; s = (s - 1) & N) o.push(s); return o.sort((a, b) => a - b); };
    const pairs = [];
    const emitCsg = (S1) => { const X = S1 | Bm(low(S1)); const N = nbr(S1, X); [0, 1, 2, 3].reverse().forEach((i) => { if (N & (1 << i)) { pairs.push([S1, 1 << i]); cmpRec(S1, 1 << i, X); } }); };
    const cmpRec = (S1, S2, X) => { const N = nbr(S2, X); subs(N).forEach((n) => { if (hasEdge(S1, S2 | n)) pairs.push([S1, S2 | n]); }); const X2 = X | N; subs(N).forEach((n) => cmpRec(S1, S2 | n, X2)); };
    const csgRec = (S1, X) => { const N = nbr(S1, X); subs(N).forEach((n) => emitCsg(S1 | n)); const X2 = X | N; subs(N).forEach((n) => csgRec(S1 | n, X2)); };
    for (let i = 3; i >= 0; i--) { emitCsg(1 << i); csgRec(1 << i, Bm(i)); }
    const rows = K.group(g, 3.9, 0); K.text(g, 'csg-cmp pairs in emission order', 3.9, 4.95, { size: 0.36, color: C.dim });
    const best = { }; REL.forEach((_, i) => (best[1 << i] = 0));
    const rowL = pairs.map((_, i) => K.dyn(rows, 0, 4.3 - i * 0.62, '', { size: 0.34, color: C.dim }));
    const readA = K.dyn(g, -4.5, -1.3, '', { size: 0.4, color: C.amber }), readB = K.dyn(g, -4.5, -2.0, '', { size: 0.34, color: C.dim }), readC = K.dyn(g, -4.5, -2.9, '', { size: 0.34, color: C.dim });
    R.push(() => { rowL.forEach((r) => r.set('')); readA.set(''); readB.set(''); readC.set(''); });
    const bm = {}; const bspl = {};
    let nnew = 0;
    pairs.forEach(([A, B], i) => {
      const S = A | B, cost = (bm[A] ?? 0) + (bm[B] ?? 0) + cardOf(S); const improve = bm[S] === undefined || cost < bm[S]; if (improve) { bm[S] = cost; bspl[S] = { cost, split: [A, B] }; }
      const txt = `${String(i + 1).padStart(2)}  {${nmOf(A)}} x {${nmOf(B)}} -> ${nmOf(S)}  ${fmt(cost)} ${improve ? '[new best]' : '[no gain]'}`;
      add(`pair ${i + 1}: csg {${nmOf(A)}} + cmp {${nmOf(B)}}`, () => { colorNodes(A, B); rowL[i].set(txt, improve ? C.green : C.dim); readA.set(`emit csg-cmp pair ${i + 1}/${pairs.length}: {${nmOf(A)}} (blue) x {${nmOf(B)}} (orange)`, C.amber); readB.set(`both connected, disjoint, joined by an edge -> cost ${fmt(cost)} for ${nmOf(S)}`, C.dim); readC.set(`naive subset DP tests 25 splits incl. cross products; DPhyp emits exactly ${pairs.length}`, C.dim); });
    });
    add(`done: ${pairs.length} pairs, best ${fmt(bm[FULL])}`, () => { colorNodes(0, 0); readA.set(`done: ${pairs.length} csg-cmp pairs, optimum ${fmt(bm[FULL])} (same as DP, no wasted work)`, C.green); showPlan(planSpec(FULL, Object.assign({}, BEST, bspl)), 'chosen plan'); });
  }

  if (id === 'heuristic-rules') {
    const t = (s, sub, col, kids, extra) => ({ t: s, sub, color: col, kids, ...extra });
    const rel = (i, sub) => t(REL[i].n, sub || REL[i].full, REL[i].col);
    const X = (a, b, sub) => t('X', sub || 'cross', C.red, [a, b]);
    const J = (a, b, sub) => t('JOIN', sub, C.amber, [a, b]);
    const sel = (s, c) => t('SELECT', s, c || C.purple, null);
    const stages = [
      { rule: 'start: parser output', txt: 'SELECT * FROM c,o,l,p WHERE c.id=o.cid AND o.id=l.oid AND l.pid=p.id AND p.cat=\'x\'', tree: () => ({ ...sel('all 4 predicates', C.purple), kids: [X(X(X(rel(0), rel(1)), rel(2)), rel(3))] }), cost: 'cross products: 1000 x 10k x 40k x 50 = 2e13 rows' },
      { rule: 'R1 split conjunction', txt: 'break AND into independent filters so each can move on its own', tree: () => ({ ...sel('p.cat=x', C.purple), kids: [{ ...sel('l.pid=p.id'), kids: [{ ...sel('o.id=l.oid'), kids: [{ ...sel('c.id=o.cid'), kids: [X(X(X(rel(0), rel(1)), rel(2)), rel(3))] }] }] }] }), cost: 'still 2e13 rows' },
      { rule: 'R2 push selection to scan', txt: 'sigma(p.cat=x) only needs P: move it below the cross product (P: 1000 -> 50 rows)', tree: () => ({ ...sel('l.pid=p.id'), kids: [{ ...sel('o.id=l.oid'), kids: [{ ...sel('c.id=o.cid'), kids: [X(X(X(rel(0), rel(1)), rel(2)), { ...sel('p.cat=x'), kids: [rel(3, 'product')] })] }] }] }), cost: 'cross product shrinks by 20x' },
      { rule: 'R3 sigma over X => JOIN', txt: 'equality predicate over a cross product of its two inputs becomes an equi-join', tree: () => J(J(J(rel(0), rel(1), 'c.id=o.cid'), rel(2), 'o.id=l.oid'), { ...sel('p.cat=x'), kids: [rel(3, 'product')] }, 'l.pid=p.id'), cost: `syntactic order: CO ${fmt(cardOf(3))} + COL ${fmt(cardOf(7))} + COLP ${fmt(cardOf(15))} = ${fmt(cardOf(3) + cardOf(7) + cardOf(15))}` },
      { rule: 'R4 greedy join order', txt: 'start from the smallest input (P=50) and always add the connected relation with the smallest result', tree: () => J(J(J(rel(3, 'product (50)'), rel(2), 'l.pid=p.id'), rel(1), 'o.id=l.oid'), rel(0), 'c.id=o.cid'), cost: `P-L ${fmt(cardOf(12))} + PLO ${fmt(cardOf(14))} + all ${fmt(cardOf(15))} = ${fmt(cardOf(12) + cardOf(14) + cardOf(15))}` },
      { rule: 'R5 projection pushdown', txt: 'keep only needed columns per input, cutting bytes through the joins', tree: () => ({ ...sel('PROJECT cols', C.green), kids: [J(J(J(rel(3, 'pi(id)'), rel(2, 'pi(pid,oid)'), 'l.pid=p.id'), rel(1, 'pi(id,cid)'), 'o.id=l.oid'), rel(0, 'pi(id,name)'), 'c.id=o.cid')] }), cost: 'same rows, fewer bytes per row' },
    ];
    const tg = K.group(g, -2.6, 0.5), rl = K.group(g, 7.7, 0); K.text(g, 'rules fire in fixed priority order; no cost search', 7.7, 5.4, { size: 0.34, color: C.dim });
    const ruleT = stages.map((s, i) => K.dyn(rl, 0, 4.7 - i * 0.78, s.rule, { size: 0.34, color: C.dim }));
    const readA = K.dyn(g, 0, -5.0, '', { size: 0.36, color: C.amber }), readB = K.dyn(g, 0, -5.55, '', { size: 0.34, color: C.green });
    let tv = null; const show = (i) => { K.clear(tg); tv = K.tree(tg, stages[i].tree(), { y: 4.5, gap: 2.35, dy: 1.7, h: 0.85, size: 0.3, maxW: 9, noFlow: true }); ruleT.forEach((r, j) => r.set((j === i ? '> ' : '  ') + stages[j].rule, j === i ? C.amber : j < i ? C.green : C.dim)); readA.set(stages[i].txt.length > 95 ? stages[i].txt.slice(0, 95) + '...' : stages[i].txt, C.amber); readB.set('cost: ' + stages[i].cost, C.green); };
    R.push(() => { show(0); });
    stages.slice(1).forEach((s, i) => add(`${s.rule}`, () => show(i + 1)));
    g.userData.tick = (t) => { if (tv) tv.tick(t); };
  }

  if (id === 'learned') {
    const layers = [6, 5, 4, 3], lx = [-9, -7.2, -5.4, -3.6], nodes = [];
    const feat = ['log|C|', 'log|O|', 'log|L|', 'log|P|', 'sel graph', 'preds'];
    layers.forEach((n, li) => { nodes.push([]); for (let j = 0; j < n; j++) { const y = ((n - 1) / 2 - j) * 0.9 + 2; nodes[li].push([lx[li], y]); } });
    const segs = []; for (let l = 0; l < 3; l++) nodes[l].forEach((a) => nodes[l + 1].forEach((b) => segs.push([a, b]))); K.segs(g, segs, C.grey, 0.4, -0.02);
    const dts = nodes.map((l) => l.map(([x, y]) => K.dot(g, x, y, 0.3, C.grey, 1, 0.05)));
    feat.forEach((f, j) => K.text(g, f, -10.9 + 0.0, nodes[0][j][1], { size: 0.26, color: C.dim }));
    K.text(g, 'plan-cost network (tree-conv / GNN)', -6.3, 4.5, { size: 0.34, color: C.dim });
    ['features', 'hidden', 'hidden', 'cost/plan'].forEach((s, i) => K.text(g, s, lx[i], -1.0, { size: 0.26, color: C.dim }));
    const act = (l) => dts.forEach((row, li) => row.forEach((d) => { d.material = K.mat(li <= l ? C.amber : C.grey); }));
    R.push(() => act(-1));
    const cands = [{ order: leftDeep([0, 1, 2, 3]), name: '((C J O) J L) J P', pred: 11000 }, { order: null, name: 'C J (O J (L J P))', pred: 13500, sp: [1, 14] }, { order: null, name: '(C J O) J (L J P)', pred: 16000, sp: [3, 12] }];
    const trueCost = [treeCost(cands[0].order), BEST[15].cost, cardOf(3) + cardOf(12) + cardOf(15) + 0 + cardOf(12) * 0];
    // true cost for bushy candidates via C_out
    trueCost[1] = cardOf(12) + cardOf(14) + cardOf(15); trueCost[2] = cardOf(3) + cardOf(12) + cardOf(15);
    const cg = K.group(g, 2.4, 0); K.text(g, 'candidate join orders', 3.2, 4.5, { size: 0.34, color: C.dim });
    const rowsC = cands.map((c, i) => { const y = 3.4 - i * 1.7; K.rect(cg, 3.4, y, 7.6, 1.45, C.panel, 1, 0); const fr = K.frame(cg, 3.4, y, 7.6, 1.45, C.grey, 1); return { fr, a: K.dyn(cg, 3.4, y + 0.38, c.name, { size: 0.38, color: C.dim }), b: K.dyn(cg, 3.4, y - 0.12, '', { size: 0.32 }), c: K.dyn(cg, 3.4, y - 0.5, '', { size: 0.32 }) }; });
    const readA = K.dyn(g, -2, -3.3, '', { size: 0.4, color: C.amber }), readB = K.dyn(g, -2, -4.0, '', { size: 0.34, color: C.dim }), readC = K.dyn(g, -2, -4.7, '', { size: 0.34, color: C.dim });
    R.push(() => { rowsC.forEach((r, i) => { r.fr.material.color.set(C.grey); r.a.set(cands[i].name, C.dim); r.b.set(''); r.c.set(''); }); readA.set(''); readB.set(''); readC.set(''); });
    add('featurize query: relation sizes, join graph, predicates', () => { act(0); readA.set('1. encode query + candidate partial plan as tensors', C.amber); readB.set('features come from the catalog / statistics (the learned model does not replace them)', C.dim); });
    add('forward pass through plan-cost network', () => { act(3); readA.set('2. forward pass: network scores each candidate plan (latency prediction)', C.amber); readB.set('Neo / Bao style: value network guides search, trained on observed latencies', C.dim); });
    add('model proposes 3 plans with predicted cost', () => { rowsC.forEach((r, i) => { r.a.set(cands[i].name, C.text); r.b.set(`model predicts ${fmt(cands[i].pred)}`, C.amber); }); readA.set('3. top-3 candidates by predicted cost (numbers illustrative)', C.amber); });
    add('pick lowest predicted', () => { rowsC[0].fr.material.color.set(C.amber); readA.set(`4. argmin predicted = ${cands[0].name}  (${fmt(cands[0].pred)})`, C.amber); });
    add('verify with classical cost model + stats', () => { rowsC[0].c.set(`verified C_out = ${fmt(trueCost[0])}  (${(trueCost[0] / cands[0].pred).toFixed(1)}x worse)`, C.red); rowsC[0].fr.material.color.set(C.red); readA.set('5. verification: re-cost proposal with statistics -> regret too large, reject', C.red); readB.set('learned models can be badly wrong off-distribution, so production systems keep a safe fallback', C.dim); });
    add('fallback to next candidate', () => { rowsC[1].fr.material.color.set(C.amber); rowsC[1].c.set(`verified C_out = ${fmt(trueCost[1])}  (within 1.2x)`, C.green); rowsC[1].fr.material.color.set(C.green); readA.set(`6. second candidate verifies at ${fmt(trueCost[1])} -> accepted`, C.green); const sp = { 15: { split: [1, 14] }, 14: { split: [2, 12] }, 12: { split: [4, 8] } }; showPlan(planSpec(FULL, Object.assign({}, BEST, sp)), 'accepted plan'); });
    add('execute and record latency as training data', () => { readA.set('7. run plan, log (plan, observed latency) into the experience buffer -> periodic retraining', C.green); readB.set('exhaustive DP would be cheap here; learned search pays off at 20+ tables where DP explodes', C.dim); });
  }

  return { group: g, ev, reset() { R.forEach((f) => f()); }, tick: (t) => { tickPlan(t); if (g.userData.tick) g.userData.tick(t); } };
}

const optimizerView = {
  controls: [
    { id: 'algo', label: 'search algorithm', type: 'select', options: OPT_ALGOS.map(([value, label]) => ({ value, label })), value: 'bottom-up-dp', onChange: (v) => optCur && optCur.setAlgo(v) },
    { id: 'speed', label: 'speed', type: 'range', min: 1, max: 6, value: 2, onChange: (v) => optCur && optCur.setSpeed(+v) },
    { id: 'replay', label: 'replay', type: 'button', onChange: () => optCur && optCur.replay() },
  ],
  build(ctx) {
    const K = makeKit(ctx), root = K.root;
    let algo = cfgOf(ctx)['optimizer-search'] || 'bottom-up-dp', A = null, idx = 0, acc = 0, speed = 2, t0 = 0, cur = 0;
    const slot = K.group(root); const title = K.dyn(root, 0, 6.0, '', { size: 0.46, color: C.amber }), evT = K.dyn(root, 0, 5.45, '', { size: 0.0 });
    const mk = () => { if (A) { K.free(A.group); } A = optimizerAlgo(algo, K, slot, ctx); A.reset(); idx = 0; acc = 0; cur = 0; title.set(`${OPT_ALGOS.find((a) => a[0] === algo)[1]}  -  4-table join: C(1k) O(10k) L(40k) P*(50)`, C.amber); };
    const seek = (n) => { n = clamp(n, 0, A.ev.length); if (n < idx) { A.reset(); idx = 0; } while (idx < n) { A.ev[idx].fn(); idx++; } acc = 0; if (A.ev[idx - 1] && ctx.onInfo) ctx.onInfo(`<b>${OPT_ALGOS.find((a) => a[0] === algo)[1]}</b><br>step ${idx}/${A.ev.length}: ${A.ev[idx - 1].text}`); };
    const api = { setAlgo(v) { algo = v; mk(); }, setSpeed(v) { speed = v; }, replay() { mk(); } };
    optCur = api; mk();
    const desc = {
      'bottom-up-dp': 'Fills a table of best plans for every connected relation subset, smallest first (Selinger 1979). Each cell reuses the optimal sub-plans of smaller cells.',
      'top-down-cascades': 'Memo of logical groups; recursion asks for the best plan of the root group under an upper bound, pruning any expression whose lower bound exceeds the best found (Cascades / Volcano / Columbia).',
      'hypergraph-dphyp': 'Enumerates only connected-subgraph / connected-complement pairs on the query hypergraph, never testing disconnected (cross product) splits (Moerkotte-Neumann DPccp / DPhyp).',
      'heuristic-rules': 'Rule-based rewrite: apply transformations in fixed order (split conjunctions, push selections, form joins, greedy order). Fast and predictable but can miss the optimum.',
      learned: 'A neural model scores or proposes plans; the system verifies with a classical cost model and falls back when the learned choice is risky (Neo, Bao, Balsa).',
    };
    const inst = {
      group: root,
      update(dt, t) {
        acc += dt * speed * 0.9;
        while (acc >= 1 && idx < A.ev.length) { acc -= 1; A.ev[idx].fn(); idx++; if (ctx.onInfo) ctx.onInfo(`<b>${OPT_ALGOS.find((a) => a[0] === algo)[1]}</b><br>step ${idx}/${A.ev.length}: ${A.ev[idx - 1].text}`); }
        A.tick(t);
      },
      dispose() { optCur = null; K.dispose(); },
      onConfigChange(c) { const a = c['optimizer-search']; if (a && a !== algo) { algo = a; mk(); } },
      steps: [
        { title: 'The search problem', text: 'Join ordering of 4 tables: 15 subsets, bushy trees, cost = rows flowing through joins (C_out). The slot picks the search strategy.', run() { mk(); ctx.onInfo && ctx.onInfo(`<b>${OPT_ALGOS.find((a) => a[0] === algo)[1]}</b><br>${desc[algo]}`); } },
        { title: 'Early search', text: 'First third of the search events.', run() { mk(); seek(Math.ceil(A.ev.length * 0.33)); } },
        { title: 'Mid search', text: 'Two thirds: watch costs, pruning or pair emission depending on algorithm.', run() { mk(); seek(Math.ceil(A.ev.length * 0.66)); } },
        { title: 'Result', text: 'Search complete: chosen plan tree shown at right.', run() { mk(); seek(A.ev.length); } },
        { title: 'Compare', text: 'DP and DPhyp are exhaustive (optimal); Cascades is exhaustive but prunes with bounds; heuristics are fast but can be wrong; learned needs a fallback. Switch the optimizer-search slot or use the select.', run() { mk(); seek(A.ev.length); } },
      ],
    };
    return inst;
  },
};

// ================================================================ CARDINALITY ESTIMATOR
let cardCur = null;
const cardView = {
  controls: [
    { id: 'rho', label: 'column correlation rho', type: 'range', min: 0, max: 100, value: 80, onChange: (v) => cardCur && cardCur.setRho(+v / 100) },
    { id: 'restart', label: 'replay', type: 'button', onChange: () => cardCur && cardCur.replay() },
  ],
  build(ctx) {
    const K = makeKit(ctx), root = K.root;
    const NP = 400; let seed = 99; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const U = [], V = []; for (let i = 0; i < NP; i++) { U.push(rnd()); V.push(rnd()); }
    let rho = 0.8, t0 = null, shown = 99, dirty = true;
    const inst = new THREE.InstancedMesh(new THREE.CircleGeometry(0.5, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }), NP); root.add(inst);
    const SX = -9.5, SY = -0.8, SW = 6, dm = new THREE.Object3D(), col = new THREE.Color();
    K.text(root, 'independence assumption', -6.5, 6.3, { size: 0.42, color: C.amber });
    K.text(root, 'columns a, b of one table: P(a AND b) = P(a) * P(b)', -6.5, 5.8, { size: 0.32, color: C.dim });
    K.rect(root, SX + SW / 2, SY + SW / 2, SW, SW, C.panel, 1, -0.1);
    K.rect(root, SX + 0.9, SY + SW / 2, 1.8, SW, C.blue, 0.12, 0); K.rect(root, SX + SW / 2, SY + 0.9, SW, 1.8, C.purple, 0.12, 0);
    K.text(root, 'a < 0.3', SX + 0.9, SY + SW + 0.25, { size: 0.3, color: C.blue }); K.text(root, 'b < 0.3', SX - 0.6, SY + 0.9, { size: 0.3, color: C.purple });
    const info = K.group(root), chain = K.group(root), chainLbl = K.group(root);
    const R0 = 100000, FE = [1.5, 0.8, 2.0], names = ['sigma(a AND b)', 'JOIN T2', 'JOIN T3', 'JOIN T4'];
    const recompute = () => {
      let both = 0, ca = 0, cb = 0;
      for (let i = 0; i < NP; i++) {
        const x = U[i], y = clamp(rho * x + (1 - rho) * V[i], 0, 0.9999);
        const A = x < 0.3, B = y < 0.3; if (A) ca++; if (B) cb++; if (A && B) both++;
        dm.position.set(SX + x * SW, SY + y * SW, 0.1); dm.scale.setScalar(0.11); dm.updateMatrix(); inst.setMatrixAt(i, dm.matrix);
        inst.setColorAt(i, col.set(A && B ? C.orange : A || B ? '#8d99c4' : '#4a5273'));
      }
      inst.instanceMatrix.needsUpdate = true; inst.instanceColor.needsUpdate = true;
      const sa = ca / NP, sb = cb / NP, est0 = R0 * sa * sb, true0 = R0 * both / NP;
      const g = 1 + 1.5 * rho; const est = [est0], tru = [Math.max(true0, 1)];
      FE.forEach((f) => { est.push(est[est.length - 1] * f); tru.push(tru[tru.length - 1] * f * g); });
      K.clear(info);
      K.text(info, `sel(a)=${sa.toFixed(2)}  sel(b)=${sb.toFixed(2)}  est = ${sa.toFixed(2)} x ${sb.toFixed(2)} = ${(sa * sb).toFixed(3)}`, -6.5, -1.5, { size: 0.33, color: C.blue });
      K.text(info, `true selectivity (points in both bands) = ${(both / NP).toFixed(3)}   -> filter off by ${(both / NP / Math.max(sa * sb, 1e-6)).toFixed(1)}x`, -6.5, -2.0, { size: 0.33, color: C.orange });
      K.text(info, `each join: est uses uniform fan-out, true fan-out is ${g.toFixed(2)}x larger (skew / correlated keys)`, -6.5, -2.55, { size: 0.31, color: C.dim });
      const last = 3, nlj = est[last] < 20000, bad = tru[last] > 20000;
      K.text(info, `plan choice from estimate ${fmt(est[last])} rows: ${nlj ? 'index nested-loop join' : 'hash join'}`, -6.5, -3.4, { size: 0.36, color: C.amber });
      K.text(info, nlj && bad ? `reality: ${fmt(tru[last])} rows -> ${(tru[last] / est[last]).toFixed(1)}x more probes than planned (disaster plan)` : 'estimate and reality agree on the algorithm', -6.5, -3.95, { size: 0.33, color: nlj && bad ? C.red : C.green });
      K.clear(chain); K.clear(chainLbl);
      const bx0 = -0.9, base = -3.6, H = 6.4, ly = (r) => (clamp(Math.log10(Math.max(r, 1)), 2, 7) - 2) / 5 * H;
      for (let e = 2; e <= 7; e++) { K.line(chain, [[bx0 - 0.2, base + ly(10 ** e)], [bx0 + 10.1, base + ly(10 ** e)]], C.grey, 0.5, -0.05); K.text(chainLbl, `1e${e}`, bx0 - 0.6, base + ly(10 ** e), { size: 0.28, color: C.dim }); }
      K.text(chainLbl, 'rows (log scale)  est = blue   true = orange', bx0 + 4.8, 3.5 + 0.0, { size: 0.32, color: C.dim });
      names.forEach((nm, i) => {
        const cx = bx0 + 1.3 + i * 2.65; const ge = K.group(chain, 0, base); const ratio = est[i] / tru[i];
        const he = ly(est[i]), ht = ly(tru[i]);
        K.rect(ge, cx - 0.5, Math.max(he, 0.05) / 2, 0.85, Math.max(he, 0.05), C.blue, 1, 0.1); K.rect(ge, cx + 0.5, Math.max(ht, 0.05) / 2, 0.85, Math.max(ht, 0.05), C.orange, 1, 0.1);
        ge.userData = { i, vis: false }; ge.scale.y = 0.001; ge.visible = true;
        K.text(chainLbl, fmt(est[i]), cx - 0.5, base + he + 0.3, { size: 0.3, color: C.blue }); K.text(chainLbl, fmt(tru[i]), cx + 0.5, base + ht + 0.3, { size: 0.3, color: C.orange });
        K.text(chainLbl, nm, cx, base - 0.4, { size: 0.3, color: C.text });
        const bad = ratio < 0.5 || ratio > 2;
        K.text(chainLbl, `off by ${(1 / ratio).toFixed(1)}x`, cx, base - 0.85, { size: 0.32, color: bad ? C.red : C.green });
        chainLbl.children.slice(-6).forEach((c) => (c.userData.stage = i));
      });
      dirty = false;
    };
    recompute();
    const api = { setRho(v) { rho = v; dirty = true; }, replay() { t0 = null; shown = 0; } };
    cardCur = api;
    return {
      group: root,
      update(dt, t) {
        if (dirty) recompute();
        if (t0 === null) t0 = t;
        const el = t - t0;
        chain.children.forEach((g) => { if (g.userData && g.userData.i !== undefined) g.scale.y = Math.max(0.001, ease((el - g.userData.i * 0.7) / 0.6)); });
        chainLbl.children.forEach((c) => { if (c.userData.stage !== undefined) c.visible = el > c.userData.stage * 0.7 + 0.5; });
        const lim = shown;
        chain.children.forEach((g) => { if (g.userData && g.userData.i !== undefined && g.userData.i > lim) g.scale.y = 0.001; });
        chainLbl.children.forEach((c) => { if (c.userData.stage !== undefined && c.userData.stage > lim) c.visible = false; });
      },
      dispose() { cardCur = null; inst.geometry.dispose(); inst.material.dispose(); K.dispose(); },
      steps: [
        { title: 'Independence assumption', text: 'The estimator multiplies per-column selectivities. When columns are correlated (city and country) the product underestimates. Drag the correlation slider.', run() { shown = -1; t0 = null; ctx.onInfo && ctx.onInfo('<b>sel(a AND b) = sel(a) x sel(b)</b><br>Only valid if a and b are independent. Without multi-column (extended) statistics the optimizer cannot know otherwise.'); } },
        { title: 'Filter error', text: 'First bar pair: estimated vs true rows after the two predicates.', run() { shown = 0; t0 = null; } },
        { title: 'After join 1', text: 'Join size = |R| x |S| x sel_join, assuming uniform key distribution. Heavy hitters make the true fan-out larger, so the error multiplies.', run() { shown = 1; t0 = null; } },
        { title: 'Errors compound', text: 'Errors multiply through every join: log-error grows linearly with number of joins (Ioannidis & Christodoulakis 1991; "How good are query optimizers, really?").', run() { shown = 3; t0 = null; } },
        { title: 'Wrong plan', text: 'The estimate selects join algorithms and join order: an underestimate leads to nested loops / small hash tables that spill. Set correlation to 0 to see agreement.', run() { shown = 3; t0 = null; } },
      ],
    };
  },
};

// ================================================================ COST MODEL
const CM = { N: 1e6, T: 1e4, spc: 1, cpuT: 0.01, cpuI: 0.005, cpuO: 0.0025, leaf: 300 };
function planCosts(s, rpc, clustered, N = CM.N, T = CM.T) {
  const m = Math.max(1, s * N);
  const seq = { io: T * CM.spc, cpu: N * (CM.cpuT + CM.cpuO) };
  const pfML = Math.min(T, (2 * T * m) / (2 * T + m));
  const idxIO = (4 * rpc) + Math.ceil(s * N / CM.leaf) * (clustered ? CM.spc : rpc);
  const idx = { io: idxIO + (clustered ? Math.max(1, s * T) * CM.spc : pfML * rpc), cpu: m * (CM.cpuI + CM.cpuT + CM.cpuO) };
  const bmpPf = clustered ? Math.max(1, s * T) : pfML, perPage = rpc - (rpc - CM.spc) * Math.sqrt(bmpPf / T);
  const bmp = { io: 4 * rpc + Math.ceil(s * N / CM.leaf) * CM.spc + bmpPf * perPage, cpu: m * (CM.cpuI + CM.cpuO * 2 + CM.cpuT) };
  const o = { seq, idx, bmp }; Object.values(o).forEach((v) => (v.total = v.io + v.cpu)); return o;
}
let costCur = null;
const costView = {
  controls: [
    { id: 'sel', label: 'selectivity (log10 s = -5..0)', type: 'range', min: 0, max: 100, value: 62, onChange: (v) => costCur && costCur.set({ s: v }) },
    { id: 'rpc', label: 'random_page_cost', type: 'select', options: [{ value: '4', label: '4.0 (spinning disk)' }, { value: '1.1', label: '1.1 (SSD)' }], value: '4', onChange: (v) => costCur && costCur.set({ rpc: +v }) },
    { id: 'clustered', label: 'index correlates with heap (clustered)', type: 'toggle', value: false, onChange: (v) => costCur && costCur.set({ clustered: !!v }) },
  ],
  build(ctx) {
    const K = makeKit(ctx), root = K.root;
    let sv = 62, rpc = 4, clustered = false, dirty = true, t0 = null;
    const X0 = -9.5, XW = 11, Y0 = -3.8, YH = 7.2;
    const xs = (s) => X0 + ((Math.log10(s) + 5) / 5) * XW, ys = (c) => Y0 + (clamp(Math.log10(Math.max(c, 1)), 0.7, 5) - 0.7) / 4.3 * YH;
    K.text(root, 'cost of access paths for  SELECT ... WHERE k < x  on 1M rows / 10,000 pages', -4, 5.7, { size: 0.4, color: C.amber });
    K.rect(root, X0 + XW / 2, Y0 + YH / 2, XW + 0.2, YH + 0.2, C.panel, 1, -0.1);
    for (let e = 1; e <= 5; e++) { K.line(root, [[X0, ys(10 ** e)], [X0 + XW, ys(10 ** e)]], C.grey, 0.5, -0.05); K.text(root, '1e' + e, X0 - 0.5, ys(10 ** e), { size: 0.28, color: C.dim }); }
    for (let e = -5; e <= 0; e++) K.text(root, e === 0 ? '100%' : '1e' + e, xs(10 ** e), Y0 - 0.35, { size: 0.28, color: C.dim });
    K.text(root, 'selectivity s = matching rows / total rows  (log)', X0 + XW / 2, Y0 - 0.85, { size: 0.3, color: C.dim });
    K.text(root, 'cost (log)', X0 - 0.2, Y0 + YH + 0.35, { size: 0.3, color: C.dim });
    const dyn = K.group(root), bars = K.group(root, 4.4, 0);
    const CUR = { seq: [C.red, 'SeqScan'], idx: [C.blue, 'IndexScan'], bmp: [C.purple, 'BitmapHeapScan'] };
    const info = K.dyn(root, -4, -5.9, '', { size: 0.34, color: C.dim });
    const redraw = () => {
      K.clear(dyn); K.clear(bars); const s = 10 ** (-5 + 5 * sv / 100);
      Object.keys(CUR).forEach((k) => { const pts = []; for (let i = 0; i <= 100; i++) { const ss = 10 ** (-5 + i * 0.05); pts.push([xs(ss), ys(planCosts(ss, rpc, clustered)[k].total)]); } K.line(dyn, pts, CUR[k][0], 1, 0.1); });
      let cross = null; for (let i = 0; i < 400; i++) { const ss = 10 ** (-5 + i * 0.0125); const pc = planCosts(ss, rpc, clustered); if (pc.idx.total > pc.seq.total) { cross = ss; break; } }
      if (cross) { K.line(dyn, [[xs(cross), Y0], [xs(cross), Y0 + YH]], C.amber, 0.6, 0.05); K.text(dyn, `IndexScan loses to SeqScan above s=${(cross * 100).toPrecision(2)}%`, xs(cross), Y0 + YH - 0.35, { size: 0.32, color: C.amber }); }
      else K.text(dyn, 'index scan wins at every selectivity (clustered)', xs(1e-2), Y0 + YH - 0.35, { size: 0.32, color: C.amber });
      K.line(dyn, [[xs(s), Y0], [xs(s), Y0 + YH]], C.white, 0.8, 0.06);
      const pcs = planCosts(s, rpc, clustered); const win = Object.keys(pcs).sort((a, b) => pcs[a].total - pcs[b].total)[0];
      Object.keys(CUR).forEach((k) => K.dot(dyn, xs(s), ys(pcs[k].total), 0.14, CUR[k][0], 1, 0.2));
      K.text(bars, `at s = ${(s * 100).toPrecision(2)}%  (${fmt(s * CM.N)} rows)`, 3, 4.2, { size: 0.38, color: C.text });
      Object.keys(CUR).forEach((k, i) => {
        const y = 3.0 - i * 2.0, p = pcs[k], tot = p.total, L = (Math.log10(tot) / 5) * 5.4;
        K.text(bars, CUR[k][1] + (k === win ? '  <- chosen' : ''), 3, y + 0.6, { size: 0.36, color: k === win ? C.green : CUR[k][0] });
        K.rect(bars, 0.2 + (L * (p.io / tot)) / 2, y, L * (p.io / tot), 0.45, C.amber, 1, 0.1); K.rect(bars, 0.2 + L * (p.io / tot) + (L * (p.cpu / tot)) / 2, y, L * (p.cpu / tot), 0.45, C.cyan, 1, 0.1);
        K.text(bars, `IO ${fmt(p.io)} + CPU ${fmt(p.cpu)} = ${fmt(tot)}`, 3, y - 0.55, { size: 0.31, color: C.dim });
      });
      K.text(bars, 'bar length = log10(cost); amber = IO, cyan = CPU', 3, -3.0, { size: 0.28, color: C.dim });
      info.set(`SeqScan = pages x seq_page_cost + rows x (cpu_tuple+cpu_op)    IndexScan = descent + Mackert-Lohman pages x ${clustered ? 'seq' : 'random'}_page_cost(${rpc}) + rows x cpu    Bitmap = pages x [rpc - (rpc-spc) sqrt(pf/T)]`, C.dim);
      dirty = false;
    };
    redraw();
    const api = { set(o) { if (o.s !== undefined) sv = +o.s; if (o.rpc !== undefined) rpc = o.rpc; if (o.clustered !== undefined) clustered = o.clustered; dirty = true; } };
    costCur = api;
    return {
      group: root,
      update(dt, t) { if (dirty) redraw(); if (t0 === null) t0 = t; dyn.children.forEach((c, i) => { if (c.isLine && i < 3) c.geometry.setDrawRange(0, Math.floor(clamp((t - t0) / 1.5, 0, 1) * 101)); }); },
      dispose() { costCur = null; K.dispose(); },
      steps: [
        { title: 'Cost = IO + CPU', text: 'The cost model assigns abstract units: sequential page = 1, random page = 4 (PostgreSQL defaults), CPU per tuple 0.01. The optimizer compares plans using these.', run() { api.set({ s: 50 }); } },
        { title: 'Selective predicate', text: 'At s = 0.01% the index touches a handful of pages and wins by orders of magnitude.', run() { api.set({ s: 12 }); } },
        { title: 'Crossover', text: 'Random IO per matching row means the index loses once ~ a few % of rows match (every page ends up read anyway, randomly).', run() { api.set({ s: 70 }); } },
        { title: 'Bitmap scan in between', text: 'Bitmap scans sort heap page ids first so IO turns near-sequential; their cost curve bridges the two.', run() { api.set({ s: 82 }); } },
        { title: 'Hardware changes the plan', text: 'Switch random_page_cost to 1.1 (SSD) or toggle clustered: the crossover shifts right, so the same query gets a different plan.', run() { api.set({ s: 80, rpc: 1.1 }); } },
      ],
    };
  },
};

// ================================================================ LOGICAL / PHYSICAL PLAN
const OPC = { Project: C.green, Aggregate: C.amber, Select: C.purple, Join: C.cyan, Scan: C.blue, Sort: C.orange, Exchange: C.red, Index: C.blue };
const nd = (t, sub, kind, kids, note) => ({ t, sub, color: OPC[kind], kids, note, kind });
let logCur = null;
const logicalView = {
  controls: [
    { id: 'pushdown', label: 'apply rewrite rules (push-down, prune)', type: 'toggle', value: false, onChange: (v) => logCur && logCur.set(!!v) },
  ],
  build(ctx) {
    const K = makeKit(ctx), root = K.root; let opt = false, tv = null, hl = 0; const tg = K.group(root, 0, 0.4);
    K.text(root, 'SELECT c.name, SUM(o.total) FROM customers c JOIN orders o ON c.id = o.cid WHERE o.date > \'2024-01-01\' GROUP BY c.name', 0, 6.2, { size: 0.36, color: C.dim });
    const read = K.dyn(root, 0, -5.4, '', { size: 0.38, color: C.amber }), read2 = K.dyn(root, 0, -5.95, '', { size: 0.33, color: C.dim });
    const spec = () => !opt
      ? nd('PROJECT', 'c.name, sum_total', 'Project', [nd('AGGREGATE', 'gamma c.name; SUM(o.total)', 'Aggregate', [nd('SELECT', "sigma o.date > '2024-01-01'", 'Select', [nd('JOIN', 'c.id = o.cid', 'Join', [nd('SCAN', 'customers', 'Scan', null, '100k'), nd('SCAN', 'orders', 'Scan', null, '10M')], '10M')], '1M')], '1k')], '1k')
      : nd('PROJECT', 'c.name, sum_total', 'Project', [nd('AGGREGATE', 'gamma c.name; SUM(o.total)', 'Aggregate', [nd('JOIN', 'c.id = o.cid', 'Join', [nd('SCAN', 'customers  pi(id,name)', 'Scan', null, '100k'), nd('SELECT', "sigma o.date > '2024-01-01'", 'Select', [nd('SCAN', 'orders  pi(cid,total,date)', 'Scan', null, '10M')], '1M')], '1M')], '1k')], '1k');
    const draw = () => {
      K.clear(tg); tv = K.tree(tg, spec(), { y: 4.4, gap: 4.6, dy: 1.75, h: 0.95, size: 0.4, maxW: 9 });
      read.set(opt ? 'after push-down: the filter runs below the join, so the join sees 1M rows instead of 10M' : 'as produced by the binder: filter sits above the join (10M x 100k rows joined first)', C.amber);
      read2.set(opt ? 'equivalence: sigma_p(R join S) = R join sigma_p(S) when p only references S;  also column pruning' : 'logical operators say WHAT (relational algebra), never HOW (no hash / index / order yet). Numbers = estimated rows.', C.dim);
    };
    draw();
    const api = { set(v) { if (v !== opt) { opt = v; draw(); } } }; logCur = api;
    return {
      group: root, update(dt, t) { tv && tv.tick(t); }, dispose() { logCur = null; K.dispose(); },
      steps: [
        { title: 'Bound logical tree', text: 'The binder output becomes a tree of relational operators: scan, select (sigma), join, aggregate (gamma), project (pi).', run() { api.set(false); } },
        { title: 'Rows per operator', text: 'Each node carries estimated cardinality from statistics. The filter sits above the join so the join is huge.', run() { api.set(false); ctx.onInfo && ctx.onInfo('<b>Logical plan</b> = algebraic expression. Equivalent rewrites exist; the rewriter and optimizer choose among them.'); } },
        { title: 'Predicate push-down', text: 'Rewrite rule: move sigma below the join onto orders. Join input shrinks 10x.', run() { api.set(true); } },
        { title: 'Column pruning', text: 'Scans only produce needed columns (columnar stores read fewer column chunks).', run() { api.set(true); } },
        { title: 'Handoff', text: 'This logical plan feeds the optimizer which chooses join order and physical operators (next view: physical-plan).', run() { api.set(true); } },
      ],
    };
  },
};

let physCur = null;
const physView = {
  controls: [
    { id: 'join', label: 'join algorithm', type: 'select', options: [{ value: 'hash', label: 'Hash join' }, { value: 'merge', label: 'Merge join (needs sorted input)' }, { value: 'nl', label: 'Index nested-loop join' }], value: 'hash', onChange: (v) => physCur && physCur.set({ join: v }) },
    { id: 'scan', label: 'orders access path', type: 'select', options: [{ value: 'seq', label: 'Sequential scan' }, { value: 'idx', label: 'Index scan (date)' }], value: 'seq', onChange: (v) => physCur && physCur.set({ scan: v }) },
    { id: 'parallel', label: 'parallel (4 workers)', type: 'toggle', value: false, onChange: (v) => physCur && physCur.set({ par: !!v }) },
  ],
  build(ctx) {
    const K = makeKit(ctx), root = K.root; const st = { join: 'hash', scan: 'seq', par: false }; let tv = null; const tg = K.group(root, 0, 0.4);
    K.text(root, 'same query, physical operators chosen by the optimizer (cost in abstract units, cumulative)', 0, 6.2, { size: 0.36, color: C.dim });
    const read = K.dyn(root, 0, -5.4, '', { size: 0.38, color: C.amber }), read2 = K.dyn(root, 0, -5.95, '', { size: 0.33, color: C.dim });
    const draw = () => {
      K.clear(tg);
      const pcs = planCosts(0.1, 4, false, 1e7, 1e5);
      const scanC = st.scan === 'seq' ? pcs.seq.total : pcs.idx.total;
      const scanO = st.scan === 'seq' ? nd('SEQ SCAN', 'orders  filter date>..', 'Scan', null, `cost ${fmt(scanC)}`) : nd('INDEX SCAN', 'orders_date_idx', 'Index', null, `cost ${fmt(scanC)}`);
      const scanCu = nd('SEQ SCAN', 'customers', 'Scan', null, `cost ${fmt(1000 + 1e5 * 0.0125)}`);
      const custC = 1000 + 1e5 * 0.0125, nO = 1e6, nC = 1e5;
      let join, jc, extra = '';
      if (st.join === 'hash') { jc = custC + scanC + nC * 0.02 + nO * 0.0125; join = nd('HASH JOIN', 'build=customers probe=orders', 'Join', [scanO, scanCu], `cost ${fmt(jc)}`); extra = 'hash join: build side = smaller input (100k rows), probe streams 1M rows; no order needed. breaks a pipeline at the build.'; }
      else if (st.join === 'merge') {
        const s1 = nd('SORT', 'by o.cid', 'Sort', [scanO], `cost ${fmt(scanC + nO * Math.log2(nO) * 0.0025)}`), s2 = nd('SORT', 'by c.id', 'Sort', [scanCu], `cost ${fmt(custC + nC * Math.log2(nC) * 0.0025)}`);
        jc = scanC + nO * Math.log2(nO) * 0.0025 + custC + nC * Math.log2(nC) * 0.0025 + (nO + nC) * 0.01; join = nd('MERGE JOIN', 'o.cid = c.id', 'Join', [s1, s2], `cost ${fmt(jc)}`); extra = 'merge join needs both inputs sorted on the join key: the optimizer inserts SORT enforcers (or uses an index that already delivers the order = interesting order).';
      } else { const probe = nd('INDEX SCAN', 'customers_pkey (id = $o.cid)', 'Index', null, `1M probes x ${fmt(4 * 0.0125 + 4)}`); jc = scanC + nO * 4.05; join = nd('NESTED LOOP', 'inner = index lookup', 'Join', [scanO, probe], `cost ${fmt(jc)}`); extra = 'nested loop: for each of 1M outer rows probe the PK index (3-4 page hits): fine for tiny outers, ruinous here.'; }
      let top = nd('HASH AGG', 'group by c.name', 'Aggregate', [join], `cost ${fmt(jc + nO * 0.0125)}`);
      if (st.par) top = nd('FINAL AGG', 'merge partial results', 'Aggregate', [nd('GATHER', '4 workers (Exchange)', 'Exchange', [nd('PARTIAL AGG', 'per worker hash table', 'Aggregate', [join])])], `cost ${fmt((jc + nO * 0.0125) / 3.4)}`);
      const rootN = nd('PROJECT', 'c.name, sum', 'Project', [top]);
      tv = K.tree(tg, rootN, { y: 4.6, gap: 3.6, dy: st.par ? 1.3 : 1.55, h: 0.95, size: 0.37, maxW: 8 });
      read.set(extra, C.amber);
      read2.set(`seq vs index for orders (10% selectivity): seq ${fmt(pcs.seq.total)} vs index ${fmt(pcs.idx.total)}  ->  the cost model picks the cheaper unless forced here`, C.dim);
    };
    draw(); physCur = { set(o) { Object.assign(st, o); draw(); } };
    return {
      group: root, update(dt, t) { tv && tv.tick(t); }, dispose() { physCur = null; K.dispose(); },
      steps: [
        { title: 'Logical to physical', text: 'Each logical operator maps to one of several algorithms: JOIN -> hash / merge / nested loop, SCAN -> seq / index, AGGREGATE -> hash / sort.', run() { physCur.set({ join: 'hash', scan: 'seq', par: false }); } },
        { title: 'Access path', text: 'At 10% selectivity a sequential scan beats the unclustered index (see cost-model).', run() { physCur.set({ scan: 'idx' }); } },
        { title: 'Merge join + enforcers', text: 'Merge join demands sorted inputs; the optimizer adds SORT nodes unless a child already provides the order.', run() { physCur.set({ join: 'merge', scan: 'seq' }); } },
        { title: 'Nested loop', text: 'Index nested loop issues one index probe per outer row: ideal for OLTP lookups, terrible for 1M outer rows.', run() { physCur.set({ join: 'nl', scan: 'seq' }); } },
        { title: 'Parallel plan', text: 'Exchange / Gather operators split the plan across workers; aggregation becomes partial + final.', run() { physCur.set({ join: 'hash', scan: 'seq', par: true }); } },
      ],
    };
  },
};

// ================================================================ PLAN CACHE
const KW = new Set(['select', 'from', 'where', 'and', 'or', 'group', 'by', 'order', 'limit']);
function normalizeSql(sql) {
  let n = 0; const toks = sql.match(/'[^']*'|\d+|[A-Za-z_][A-Za-z_0-9]*|[*=<>,()]/g) || [];
  return toks.map((t) => (/^'/.test(t) || /^\d/.test(t) ? '$' + ++n : KW.has(t.toLowerCase()) ? t.toUpperCase() : /^[A-Za-z_]/.test(t) ? t.toLowerCase() : t)).join(' ');
}
const fnv1a = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const PC_Q = [
  { sql: 'SELECT * FROM users WHERE id = 42', prep: 's1' }, { sql: 'SELECT * FROM users WHERE id = 77', prep: 's1' }, { sql: "SELECT * FROM users WHERE name = 'bob'", prep: 's2' },
  { sql: 'SELECT * FROM users WHERE id = 42', prep: 's1' }, { sql: "SELECT * FROM users WHERE name = 'amy'", prep: 's2' }, { sql: 'select *  from users where id=9', prep: null },
  { sql: 'SELECT * FROM users WHERE id = 9', prep: null }, { sql: 'SELECT * FROM orders WHERE user_id = 7', prep: null },
];
let pcCur = null;
const planCacheView = {
  controls: [
    { id: 'next', label: 'next query', type: 'button', onChange: () => pcCur && pcCur.next() },
    { id: 'reset', label: 'reset cache', type: 'button', onChange: () => pcCur && pcCur.reset() },
    { id: 'auto', label: 'auto-run', type: 'toggle', value: true, onChange: (v) => pcCur && pcCur.setAuto(!!v) },
    { id: 'mode', label: 'plan cache policy', type: 'select', options: [{ value: 'none', label: 'none' }, { value: 'prepared-stmt', label: 'prepared statements' }, { value: 'normalized-literals', label: 'normalized literals' }], value: 'normalized-literals', onChange: (v) => pcCur && pcCur.setMode(v) },
  ],
  build(ctx) {
    const K = makeKit(ctx), root = K.root;
    let mode = cfgOf(ctx)['plan-cache'] || 'normalized-literals', qi = -1, stage = 0, timer = 0, auto = true, stages = [], cache = new Map(), stats = { hit: 0, miss: 0, ms: 0, saved: 0 };
    const PLAN = 1.8, EXEC = 0.3;
    const POS = { sql: [-8.2, 3.6], norm: [-3.9, 3.6], hash: [0.2, 3.6], lookup: [4.2, 3.6], reuse: [4.2, 0.9], plan: [-0.2, -0.9], insert: [4.2, -0.9], exec: [8.4, 0.0] };
    const W = { sql: 4.0, norm: 3.8, hash: 3.0, lookup: 3.0, reuse: 3.2, plan: 4.4, insert: 3.0, exec: 2.4 };
    const TITLE = { sql: 'client SQL', norm: 'normalize', hash: 'fingerprint', lookup: 'cache lookup', reuse: 'reuse cached plan', plan: 'parse+bind+optimize', insert: 'insert plan', exec: 'execute' };
    const box = {};
    Object.keys(POS).forEach((k) => { const [x, y] = POS[k]; K.rect(root, x, y, W[k], 1.4, C.panel, 1, 0); box[k] = { fr: K.frame(root, x, y, W[k], 1.4, C.grey, 1), t: K.dyn(root, x, y + 0.45, TITLE[k], { size: 0.32, color: C.dim }), v: K.dyn(root, x, y - 0.08, '', { size: 0.34 }), v2: K.dyn(root, x, y - 0.5, '', { size: 0.3, color: C.dim }) }; });
    const arrows = [['sql', 'norm'], ['norm', 'hash'], ['hash', 'lookup'], ['lookup', 'reuse'], ['lookup', 'plan'], ['plan', 'insert'], ['reuse', 'exec'], ['insert', 'exec']];
    arrows.forEach(([a, b]) => K.line(root, [[POS[a][0] + W[a] / 2 * (POS[b][0] > POS[a][0] ? 1 : 0), POS[a][1] - (POS[b][1] < POS[a][1] ? 0.7 : 0)], [POS[b][0] - W[b] / 2 * (POS[b][0] > POS[a][0] ? 1 : 0), POS[b][1] + (POS[b][1] < POS[a][1] ? 0.7 : 0)]], C.dim, 0.7, 0));
    K.text(root, 'hit', 5.6, 2.3, { size: 0.32, color: C.green }); K.text(root, 'miss', 1.4, 1.2, { size: 0.32, color: C.red });
    const dotM = K.dot(root, 0, 0, 0.13, C.amber, 1, 0.5);
    const tbl = K.group(root, 0, 0); K.text(root, 'plan cache (hash map: key -> compiled plan)', -5.8, -2.5, { size: 0.34, color: C.dim });
    const rowsT = []; for (let i = 0; i < 4; i++) rowsT.push(K.dyn(root, -4.9, -3.2 - i * 0.62, '', { size: 0.3 }));
    const ctr = K.dyn(root, 5.2, -3.4, '', { size: 0.36, color: C.green }), ctr2 = K.dyn(root, 5.2, -4.1, '', { size: 0.34, color: C.dim }), ctr3 = K.dyn(root, 5.2, -4.8, '', { size: 0.34, color: C.dim });
    const msg = K.dyn(root, 0, 5.7, '', { size: 0.4, color: C.amber });
    const resetBoxes = () => Object.values(box).forEach((b) => { b.fr.material.color.set(C.grey); b.v.set(''); b.v2.set(''); });
    const paintTable = () => { const e = [...cache.entries()]; rowsT.forEach((r, i) => { if (e[i]) r.set(`${e[i][0].padEnd(24).slice(0, 24)}  plan#${e[i][1].id}  hits=${e[i][1].hits}`, C.text); else r.set(i === 0 && e.length === 0 ? '(empty)' : '', C.dim); }); ctr.set(`hits ${stats.hit}   misses ${stats.miss}   hit-rate ${stats.hit + stats.miss ? Math.round(100 * stats.hit / (stats.hit + stats.miss)) : 0}%`, C.green); ctr2.set(`planning time spent ${stats.ms.toFixed(1)} ms   saved ${stats.saved.toFixed(1)} ms`, C.dim); ctr3.set(mode === 'none' ? 'every statement re-parsed and re-optimized' : mode === 'prepared-stmt' ? 'key = statement name; ad-hoc text never cached' : 'key = fingerprint(normalized SQL); parameter sniffing risk', C.dim); };
    let planId = 0;
    const planStages = () => {
      const q = PC_Q[qi]; const norm = normalizeSql(q.sql), fp = fnv1a(norm);
      let key = null; if (mode === 'prepared-stmt' && q.prep) key = q.prep; if (mode === 'normalized-literals') key = fp;
      const hit = key !== null && cache.has(key === q.prep ? q.prep : fp) ;
      const ent = (key !== null) ? cache.get(key) : null;
      const s = [{ b: 'sql', v: q.sql.length > 30 ? q.sql.slice(0, 30) + '..' : q.sql, v2: q.prep ? `via ${q.prep}` : 'ad-hoc text' }];
      if (mode === 'none') { s.push({ b: 'plan', v: `${PLAN} ms`, v2: 'every execution', cost: true }); }
      else if (mode === 'prepared-stmt' && !q.prep) { s.push({ b: 'plan', v: `${PLAN} ms`, v2: 'not prepared: no cache', cost: true }); }
      else {
        s.push({ b: 'norm', v: mode === 'prepared-stmt' ? `EXECUTE ${q.prep}` : norm.length > 27 ? norm.slice(0, 27) + '..' : norm, v2: mode === 'prepared-stmt' ? 'params bound ($1)' : 'literals -> $n, case/space' });
        s.push({ b: 'hash', v: mode === 'prepared-stmt' ? `key "${q.prep}"` : `fnv1a = ${fp}`, v2: mode === 'prepared-stmt' ? 'by statement name' : '32-bit (real engines: 64/128)' });
        s.push({ b: 'lookup', v: ent ? 'HIT' : 'MISS', v2: ent ? 'plan found' : 'no entry', col: ent ? C.green : C.red });
        if (ent) s.push({ b: 'reuse', v: `plan#${ent.id} (hits ${ent.hits + 1})`, v2: `saves ${PLAN} ms`, hit: key });
        else { s.push({ b: 'plan', v: `${PLAN} ms`, v2: 'parse + bind + optimize', cost: true }); s.push({ b: 'insert', v: `key ${mode === 'prepared-stmt' ? q.prep : fp}`, v2: 'cache grows', ins: key }); }
      }
      s.push({ b: 'exec', v: `${EXEC} ms`, v2: 'run plan', fin: true });
      return s;
    };
    const apply = (st) => {
      const b = box[st.b]; b.fr.material.color.set(st.col || C.amber); b.v.set(st.v, st.col || C.text); b.v2.set(st.v2 || '', C.dim);
      const [x, y] = POS[st.b]; dotM.position.set(x - W[st.b] / 2 + 0.2, y + 0.45, 0.5);
      if (st.cost) { stats.ms += PLAN; stats.miss++; }
      if (st.hit) { const e = cache.get(st.hit); e.hits++; stats.hit++; stats.saved += PLAN; }
      if (st.ins) { cache.set(st.ins, { id: ++planId, hits: 0 }); }
      msg.set(`Q${qi + 1}: ${PC_Q[qi].sql}`, C.amber);
      paintTable();
    };
    const startQ = () => { qi = (qi + 1) % PC_Q.length; if (qi === 0 && stats.hit + stats.miss > 0) doReset(false); resetBoxes(); stages = planStages(); stage = 0; apply(stages[0]); timer = 0; };
    const doReset = (all = true) => { cache = new Map(); stats = { hit: 0, miss: 0, ms: 0, saved: 0 }; planId = 0; if (all) { qi = -1; stages = []; stage = 0; resetBoxes(); msg.set('press next / auto-run', C.dim); } paintTable(); };
    doReset();
    const api = {
      next() { if (!stages.length || stage >= stages.length - 1) startQ(); else { stage++; apply(stages[stage]); timer = 0; } },
      reset() { doReset(); timer = 0; startQ(); },
      setAuto(v) { auto = v; }, setMode(m) { mode = m; doReset(); qi = -1; startQ(); },
    };
    pcCur = api; startQ();
    return {
      group: root,
      update(dt) { if (!auto) return; timer += dt; if (timer > 0.85) { timer = 0; if (stage >= stages.length - 1) { if (stage < stages.length + 1) { stage++; if (stage > stages.length) startQ(); } } else api.next(); } },
      dispose() { pcCur = null; K.dispose(); },
      onConfigChange(c) { if (c['plan-cache'] && c['plan-cache'] !== mode) api.setMode(c['plan-cache']); },
      steps: [
        { title: 'Planning is expensive', text: 'Parse + bind + optimize cost ~1-10 ms, comparable to the execution of an OLTP point query (0.3 ms here).', run() { auto = false; api.setMode('none'); } },
        { title: 'Prepared statements', text: 'The client sends PREPARE once (statement name) and EXECUTE with parameters; the server keeps the plan keyed by name. Only the app\'s prepared queries hit.', run() { auto = false; api.setMode('prepared-stmt'); for (let i = 0; i < 5; i++) { /* advance */ } } },
        { title: 'Normalized literals', text: 'The server lexes the text, replaces literals by $n, canonicalizes spacing/case, hashes it: id=42 and id=77 share one plan, even ad-hoc ones (MySQL has none; SQL Server forced parameterization; Oracle cursor_sharing).', run() { auto = true; api.setMode('normalized-literals'); } },
        { title: 'Costs of caching', text: 'Parameter sniffing: a plan built for a rare value (id with 3 rows) is reused for a popular one (3M rows). PostgreSQL switches from custom to generic plans after 5 executions if cost is comparable.', run() { auto = true; } },
      ],
    };
  },
};

// ================================================================ PIPELINE DAG
const PIPE = [
  { id: 'P0', name: 'scan product -> build HT_P', work: 50, deps: [], col: C.blue },
  { id: 'P1', name: 'scan customer -> build HT_C', work: 100, deps: [], col: C.purple },
  { id: 'P2', name: 'scan orders -> probe HT_C -> build HT_CO', work: 400, deps: ['P1'], col: C.cyan },
  { id: 'P3', name: 'scan lineitem -> probe HT_CO -> probe HT_P -> agg sink', work: 1600, deps: ['P2', 'P0'], col: C.green },
  { id: 'P4', name: 'scan agg HT -> sort sink', work: 150, deps: ['P3'], col: C.amber },
  { id: 'P5', name: 'scan sorted runs -> output', work: 60, deps: ['P4'], col: C.orange },
];
function schedulePipes(W) {
  const st = {}, en = {}, left = {}; PIPE.forEach((p) => (left[p.id] = p.work)); let t = 0;
  for (let it = 0; it < 100000; it++) {
    const act = PIPE.filter((p) => left[p.id] > 0 && p.deps.every((d) => left[d] <= 0));
    if (!act.length) break; const rate = (W * 100) / act.length, dt = 0.005;
    act.forEach((p) => { if (st[p.id] === undefined) st[p.id] = t; left[p.id] -= rate * dt; if (left[p.id] <= 0) en[p.id] = t + dt; }); t += dt;
  }
  return { st, en, end: t };
}
let pipeCur = null;
const pipelineView = {
  controls: [
    { id: 'workers', label: 'worker threads', type: 'range', min: 1, max: 8, value: 4, onChange: (v) => pipeCur && pipeCur.setW(+v) },
    { id: 'replay', label: 'replay schedule', type: 'button', onChange: () => pipeCur && pipeCur.replay() },
  ],
  build(ctx) {
    const K = makeKit(ctx), root = K.root; let W = 4, phase = 4, sch = schedulePipes(W), cur = 0, tv = null, clock = 0;
    const mkop = (t, sub, pipes, kids, note) => ({ t, sub, kids, note, pipes, color: C.grey });
    const scanP = mkop('SCAN product', 'filter cat=x', ['P0'], null), scanC = mkop('SCAN customer', '', ['P1'], null), scanO = mkop('SCAN orders', '', ['P2'], null), scanL = mkop('SCAN lineitem', '', ['P3'], null);
    const hj1 = mkop('HASH JOIN 1', 'probe o | build c', ['P2', 'P1'], [scanO, scanC]);
    const hj2 = mkop('HASH JOIN 2', 'probe l | build (o,c)', ['P3', 'P2'], [scanL, hj1]);
    const hj3 = mkop('HASH JOIN 3', 'probe | build p', ['P3', 'P0'], [hj2, scanP]);
    const agg = mkop('HASH AGG', 'sink P3 / src P4', ['P3', 'P4'], [hj3]);
    const srt = mkop('SORT', 'sink P4 / src P5', ['P4', 'P5'], [agg]);
    const tg = K.group(root, -6.0, 0);
    K.text(root, 'plan tree  (SELECT ... FROM c JOIN o JOIN l JOIN p GROUP BY .. ORDER BY ..)', -6.0, 6.2, { size: 0.34, color: C.dim });
    tv = K.tree(tg, srt, { y: 5.2, gap: 2.55, dy: 1.45, h: 0.9, size: 0.28, maxW: 7.4, noFlow: false });
    const pcol = {}; PIPE.forEach((p) => (pcol[p.id] = p.col));
    const paint = () => tv.nodes.forEach((n) => { const rect = n.g.children[0]; rect.material = K.mat(phase >= 2 ? pcol[n.pipes[n.kids && n.kids.length ? 0 : 0]] : C.grey); if (n.t === 'HASH AGG') rect.material = K.mat(phase >= 2 ? pcol.P4 : C.grey); if (n.t === 'SORT') rect.material = K.mat(phase >= 2 ? pcol.P5 : C.grey); });
    const brk = K.group(tg, 0, 5.2); const breakers = [[hj1, scanC, 'build'], [hj2, hj1, 'build'], [hj3, scanP, 'build'], [agg, hj3, 'agg sink'], [srt, agg, 'sort sink']];
    breakers.forEach(([par, kid, lab]) => { const mx = (par.px + kid.px) / 2, my = (par.py + kid.py) / 2; K.rect(brk, mx, my, 0.8, 0.12, C.red, 1, 0.3); K.text(brk, lab, mx + 0.95, my + 0.02, { size: 0.24, color: C.red }); });
    K.text(brk, 'red bar = pipeline breaker (consumes ALL input before emitting)', 0, -8.0, { size: 0.3, color: C.red });
    // DAG
    const dagG = K.group(root), DP = { P0: [1.9, 2.3], P1: [1.9, 4.5], P2: [4.2, 4.5], P3: [6.4, 3.4], P4: [8.4, 3.4], P5: [10.0, 4.5] };
    K.text(dagG, 'pipeline DAG (edges = must finish first)', 6.2, 5.9, { size: 0.34, color: C.dim });
    const dboxes = {};
    PIPE.forEach((p) => p.deps.forEach((d) => K.line(dagG, [[DP[d][0] + 0.7, DP[d][1]], [DP[p.id][0] - 0.7, DP[p.id][1]]], C.dim, 0.9, 0)));
    PIPE.forEach((p) => { const [x, y] = DP[p.id]; K.rect(dagG, x, y, 1.45, 0.9, p.col, 0.9, 0.05); const fr = K.frame(dagG, x, y, 1.45, 0.9, C.white, 0.4, 0.06); K.text(dagG, p.id, x, y + 0.15, { size: 0.36, color: '#0b0d14', z: 0.1 }); const w = K.dyn(dagG, x, y - 0.22, `${p.work} morsels`, { size: 0.24, color: '#0b0d14', z: 0.1 }); dboxes[p.id] = { fr }; });
    // gantt
    const gG = K.group(root), GX = 2.6, GW = 7.2, GY = 0.7, RH = 0.5, bars = K.group(gG), prog = {};
    K.text(gG, 'schedule (morsel-driven, workers shared among ready pipelines)', 6.2, 1.5, { size: 0.32, color: C.dim });
    const drawGantt = () => {
      K.clear(bars); sch = schedulePipes(W); const sc = GW / sch.end;
      PIPE.forEach((p, i) => { const y = GY - i * RH, x0 = GX + sch.st[p.id] * sc, w = (sch.en[p.id] - sch.st[p.id]) * sc; K.text(bars, p.id, GX - 0.5, y, { size: 0.28, color: p.col }); K.rect(bars, x0 + w / 2, y, w, RH * 0.7, p.col, 0.3, 0); prog[p.id] = K.rect(bars, x0, y, 0.001, RH * 0.7, p.col, 1, 0.05); prog[p.id].userData = { x0, w }; });
      K.text(bars, `makespan ${sch.end.toFixed(1)} s (1 unit = 100 morsels/s/worker), ${W} workers`, 6.2, GY - 6 * RH - 0.1, { size: 0.3, color: C.green });
    };
    drawGantt();
    const cur0 = K.rect(gG, GX, GY - 1.2, 0.03, 3.4, C.white, 0.8, 0.2);
    const read = K.dyn(root, 0, -5.5, '', { size: 0.38, color: C.amber }), read2 = K.dyn(root, 0, -6.0, '', { size: 0.32, color: C.dim });
    const setPhase = (p) => {
      phase = p; paint(); brk.visible = p >= 1; dagG.visible = p >= 3; gG.visible = p >= 4;
      read.set(['', 'pipeline breakers materialize their whole input (hash build, aggregate, sort): the tuple stream cannot be fused across them', 'between breakers, operators are fused into one loop: a tuple flows scan -> probe -> probe -> agg in registers, no materialization', 'each pipeline depends on the breakers it reads from: P3 needs HT_CO (P2) and HT_P (P0); P0 and P1 can run concurrently', 'workers process morsels (~100k tuples) of whichever pipelines are ready; the critical path is P1 -> P2 -> P3 -> P4 -> P5'][p] || '', C.amber);
      read2.set(p >= 2 ? 'colour = pipeline; tuples inside a pipeline are never written to memory between operators (HyPer / Umbra / DuckDB push-based model)' : '', C.dim);
    };
    setPhase(4); clock = 0;
    pipeCur = { setW(v) { W = v; drawGantt(); clock = 0; }, replay() { clock = 0; } };
    return {
      group: root,
      update(dt, t) {
        tv.tick(t); clock += dt; const T = clock % (sch.end + 1.2); cur0.position.x = GX + (Math.min(T, sch.end) / sch.end) * GW;
        const act = new Set();
        PIPE.forEach((p) => { const a = sch.st[p.id], b = sch.en[p.id]; const f = clamp((T - a) / (b - a), 0, 1); const pr = prog[p.id]; if (pr) { const w = pr.userData.w * f; pr.scale.x = Math.max(0.001, w); pr.position.x = pr.userData.x0 + w / 2; } if (T >= a && T < b) act.add(p.id); dboxes[p.id].fr.material.opacity = act.has(p.id) ? 1 : 0.3; });
        tv.nodes.forEach((n) => { const on = phase >= 4 && n.pipes.some((q) => act.has(q)); n.g.children[1].material.opacity = on ? 1 : 0.35; });
      },
      dispose() { pipeCur = null; K.dispose(); },
      steps: [
        { title: 'Operator tree', text: 'A physical plan for a 4-table join + aggregation + sort. Data normally flows leaf to root.', run() { setPhase(0); } },
        { title: 'Find the breakers', text: 'Pipeline breakers (hash build, aggregation sink, sort) must consume all input before emitting anything.', run() { setPhase(1); } },
        { title: 'Cut into pipelines', text: 'Between breakers, operators fuse into a pipeline: one loop per morsel, tuples stay in registers (HyPer/Umbra/DuckDB).', run() { setPhase(2); } },
        { title: 'Pipeline DAG', text: 'Breakers create dependencies: a pipeline that probes a hash table must wait for the pipeline that built it. Independent pipelines run concurrently.', run() { setPhase(3); } },
        { title: 'Schedule on workers', text: 'The scheduler hands out morsels to workers. Change the thread count: the critical path (P1->P2->P3->P4->P5) bounds speed-up.', run() { setPhase(4); clock = 0; } },
      ],
    };
  },
};

export const views = {
  statistics: statView, optimizer: optimizerView, 'cardinality-estimator': cardView, 'cost-model': costView,
  'logical-plan': logicalView, 'physical-plan': physView, 'plan-cache': planCacheView, 'pipeline-dag': pipelineView,
};
