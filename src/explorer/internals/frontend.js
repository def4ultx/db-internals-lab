// Frontend internals (client, SQL frontend). Owner: internals-A.
import * as THREE from 'three';

export const views = {};
const INST = {};   // current instance per view id (controls talk to it)

/* ------------------------------------------------------------------ kit */
const C = {
  bg: '#0b0d14', panel: '#1a1e2e', panel2: '#252b40', text: '#e6e9f5', dim: '#8089a8',
  blue: '#7aa2f7', purple: '#bb9af7', yellow: '#e0af68', green: '#9ece6a', red: '#f7768e',
  cyan: '#2ac3de', orange: '#ff9e64', teal: '#73daca', pink: '#ff7eb6', grey: '#565f89',
};
const LS = 1.2;  // label size multiplier (makeLabel size = line height)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/** makeKit(ctx): owns a Group + every geometry/material/texture created through it.
 *  box(w,h,d,color,{x,y,z,opacity,parent,emissive}) -> Mesh      (shared unit-box geometry scaled)
 *  label(text,{size,color,x,y,z,parent,align}) -> Object3D       (via ctx.makeLabel)
 *  dyn({x,y,z,size,color,parent,align}) -> {set(text,color), obj}  (relabel only when text changes)
 *  line(pts[[x,y,z]..],color,{parent,opacity}) -> Line            (update with setLine)
 *  sub() -> child kit (its group is added to this group)        clear() disposes everything it made
 */
function makeKit(ctx) {
  const group = new THREE.Group();
  const disp = [];                     // {dispose()} objects
  const subs = [];
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const mats = new Map();
  const own = o => { disp.push(o); return o; };
  const color = c => new THREE.Color(c);
  function material(c, opacity = 1, emissive = 0) {
    const key = c + '|' + opacity + '|' + emissive;
    let m = mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: color(c), roughness: 0.55, metalness: 0.15, transparent: opacity < 1, opacity, emissive: color(c), emissiveIntensity: emissive });
      mats.set(key, m);
    }
    return m;
  }
  function box(w, h, d, c, o = {}) {
    const m = new THREE.Mesh(unit, o.mat || material(c, o.opacity ?? 1, o.emissive ?? 0));
    m.scale.set(w, h, d);
    m.position.set(o.x || 0, o.y || 0, o.z || 0);
    (o.parent || group).add(m);
    return m;
  }
  function setColor(mesh, c, opacity = 1, emissive = 0) { mesh.material = material(c, opacity, emissive); }
  function label(text, o = {}) {
    const s = ctx.makeLabel(String(text), { size: (o.size ?? 0.45) * LS, color: o.color ?? C.text, bg: o.bg });
    s.position.set((o.x || 0) + (o.align === 'left' ? s.scale.x / 2 : 0), o.y || 0, o.z ?? 0.05);
    (o.parent || group).add(s);
    s.userData._own = true;
    return s;
  }
  function freeObj(s) {
    s.traverse(n => {
      if (n.material) { const ms = Array.isArray(n.material) ? n.material : [n.material]; ms.forEach(m => { m.map && m.map.dispose(); m.dispose(); }); }
      if (n.geometry && n.geometry !== unit) n.geometry.dispose();
    });
    s.parent && s.parent.remove(s);
  }
  function dyn(o = {}) {
    const st = { text: null, color: null, obj: null };
    const api = {
      get obj() { return st.obj; },
      set(text, c) {
        text = String(text); c = c ?? o.color ?? C.text;
        if (text === st.text && c === st.color) return;
        if (st.obj) freeObj(st.obj);
        st.text = text; st.color = c;
        st.obj = ctx.makeLabel(text, { size: (o.size ?? 0.45) * LS, color: c, bg: o.bg });
        st.obj.position.set((o.x || 0) + (o.align === 'left' ? st.obj.scale.x / 2 : 0), o.y || 0, o.z ?? 0.05);
        (o.parent || group).add(st.obj);
        if (api.visible === false) st.obj.visible = false;
      },
      move(x, y, z) { o.x = x; o.y = y; if (z !== undefined) o.z = z; if (st.obj) st.obj.position.set(x + (o.align === 'left' ? st.obj.scale.x / 2 : 0), y, z ?? o.z ?? 0.05); },
      show(v) { api.visible = v; if (st.obj) st.obj.visible = v; },
    };
    own({ dispose() { if (st.obj) freeObj(st.obj); } });
    return api;
  }
  function line(pts, c, o = {}) {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: color(c), transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1 }));
    (o.parent || group).add(l);
    own({ dispose() { g.dispose(); l.material.dispose(); } });
    return l;
  }
  function setLine(l, pts) {
    const a = l.geometry.attributes.position;
    if (a.count !== pts.length) { l.geometry.setFromPoints(pts.map(p => new THREE.Vector3(...p))); return; }
    pts.forEach((p, i) => a.setXYZ(i, p[0], p[1], p[2] || 0)); a.needsUpdate = true; l.geometry.computeBoundingSphere();
  }
  function sub() { const k = makeKit(ctx); group.add(k.group); subs.push(k); return k; }
  function clear() {
    subs.forEach(s => s.dispose()); subs.length = 0;
    disp.forEach(d => d.dispose()); disp.length = 0;
    for (const ch of [...group.children]) { if (ch.userData._own || ch.isSprite) freeObj(ch); else group.remove(ch); }
    mats.forEach(m => m.dispose()); mats.clear();
  }
  function dispose() { clear(); unit.dispose(); }
  return { group, box, label, dyn, line, setLine, setColor, sub, clear, dispose, material, own };
}

/** Pulsing helper for highlight emissive */
const pulse = t => 0.5 + 0.5 * Math.sin(t * 5);

/** Token-colour palette shared by lexer/parser views */
const TOK = { KEYWORD: C.purple, IDENT: C.blue, NUMBER: C.orange, STRING: C.green, OP: C.yellow, PUNCT: C.grey, EOF: C.dim };

/* ------------------------------------------------------------ SQL lexer */
const KEYWORDS = new Set(['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'AS', 'JOIN', 'ON', 'INNER', 'LEFT', 'GROUP', 'BY', 'ORDER', 'LIMIT', 'HAVING', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'ASC', 'DESC', 'NULL', 'IS', 'IN', 'LIKE', 'BETWEEN', 'DISTINCT']);
/** real hand-written scanner. returns [{type,text,start,end,state,note}] (end exclusive) */
function lex(sql) {
  const out = []; let i = 0; const n = sql.length;
  const isAlpha = c => /[A-Za-z_]/.test(c), isDig = c => /[0-9]/.test(c);
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    const s = i;
    if (isAlpha(c)) {
      while (i < n && /[A-Za-z0-9_$]/.test(sql[i])) i++;
      const text = sql.slice(s, i); const up = text.toUpperCase();
      out.push(KEYWORDS.has(up) ? { type: 'KEYWORD', text, start: s, end: i, state: 'IN_WORD', note: 'keyword table hit: ' + up } : { type: 'IDENT', text, start: s, end: i, state: 'IN_WORD', note: 'not in keyword table -> identifier (folded: ' + text.toLowerCase() + ')' });
    } else if (isDig(c)) {
      while (i < n && /[0-9.]/.test(sql[i])) i++;
      out.push({ type: 'NUMBER', text: sql.slice(s, i), start: s, end: i, state: 'IN_NUM', note: 'numeric literal' });
    } else if (c === "'") {
      i++; while (i < n && sql[i] !== "'") i++; i++;
      out.push({ type: 'STRING', text: sql.slice(s, i), start: s, end: i, state: 'IN_STRING', note: 'string literal (until closing quote)' });
    } else if ('<>=!'.includes(c)) {
      i++; if (i < n && '=>'.includes(sql[i]) && c !== '=') i++;
      out.push({ type: 'OP', text: sql.slice(s, i), start: s, end: i, state: 'IN_OP', note: 'longest match operator' });
    } else if ('+-*/%'.includes(c)) {
      i++; out.push({ type: 'OP', text: c, start: s, end: i, state: 'IN_OP', note: 'arithmetic operator' });
    } else { i++; out.push({ type: 'PUNCT', text: c, start: s, end: i, state: 'PUNCT', note: 'punctuation' }); }
  }
  out.push({ type: 'EOF', text: '<EOF>', start: n, end: n, state: 'EOF', note: 'end of input' });
  return out;
}

/* ------------------------------------------------- SQL parser (Pratt/RD)
 * Real recursive-descent parser with precedence climbing. Records events:
 *  {k:'enter', fn, bp?}  {k:'exit'}  {k:'peek', tok}  {k:'consume', tok}  {k:'node', node}  {k:'link', parent, child}
 * Node: {id, type, label, children:[], tok?, span:[s,e), x,y (layout)}
 */
const BP = { OR: 1, AND: 2, NOT: 3, '=': 4, '<>': 4, '!=': 4, '<': 4, '>': 4, '<=': 4, '>=': 4, LIKE: 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
function parseSQL(sql) {
  const toks = lex(sql); let p = 0; let nid = 0; const ev = [];
  const peek = () => toks[p];
  const next = () => { const t = toks[p++]; ev.push({ k: 'consume', i: p - 1 }); return t; };
  const isKw = (t, w) => t.type === 'KEYWORD' && t.text.toUpperCase() === w;
  const mkNode = (type, label, tok, span, kind) => { const n = { id: nid++, type, label, children: [], tok, span, kind: kind || type }; ev.push({ k: 'node', node: n }); return n; };
  const link = (par, ch) => { par.children.push(ch); ev.push({ k: 'link', parent: par.id, child: ch.id }); };
  const enter = (fn, bp) => ev.push({ k: 'enter', fn, bp });
  const exit = () => ev.push({ k: 'exit' });
  function expectKw(w) { const t = peek(); if (!isKw(t, w)) throw new Error('expected ' + w); return next(); }
  function parseSelect() {
    enter('parseSelect');
    const first = expectKw('SELECT');
    const sel = mkNode('SelectStmt', 'SelectStmt', first, [first.start, 0], 'stmt');
    const list = mkNode('TargetList', 'targetList', null, [peek().start, 0], 'list');
    link(sel, list);
    enter('parseTargetList');
    for (;;) {
      const e = parseExpr(0); link(list, e);
      if (isKw(peek(), 'AS')) { next(); const a = next(); e.alias = a.text; }
      if (peek().text === ',') { next(); continue; } break;
    }
    exit();
    expectKw('FROM');
    enter('parseFrom');
    let from = parseTableRef(); 
    while (isKw(peek(), 'JOIN') || isKw(peek(), 'INNER') || isKw(peek(), 'LEFT')) {
      const jt = peek(); if (!isKw(jt, 'JOIN')) next(); const jk = expectKw('JOIN');
      const right = parseTableRef(); expectKw('ON');
      const cond = parseExpr(0);
      const j = mkNode('JoinExpr', 'JoinExpr', jk, [from.span[0], cond.span[1]], 'from');
      link(j, from); link(j, right); link(j, cond); from = j;
    }
    exit();
    link(sel, from);
    if (isKw(peek(), 'WHERE')) {
      const w = next(); enter('parseWhere');
      const e = parseExpr(0); const wn = mkNode('WhereClause', 'whereClause', w, [w.start, e.span[1]], 'clause');
      link(wn, e); link(sel, wn); exit();
    }
    if (isKw(peek(), 'GROUP')) {
      const g = next(); expectKw('BY'); enter('parseGroupBy');
      const gn = mkNode('GroupBy', 'groupBy', g, [g.start, 0], 'clause');
      for (;;) { const e = parseExpr(0); link(gn, e); gn.span[1] = e.span[1]; if (peek().text === ',') { next(); continue; } break; }
      link(sel, gn); exit();
    }
    if (isKw(peek(), 'ORDER')) {
      const o = next(); expectKw('BY'); enter('parseOrderBy');
      const on = mkNode('OrderBy', 'orderBy', o, [o.start, 0], 'clause');
      const e = parseExpr(0); link(on, e); on.span[1] = e.span[1];
      if (isKw(peek(), 'DESC') || isKw(peek(), 'ASC')) { const d = next(); on.label = 'orderBy ' + d.text.toUpperCase(); on.span[1] = d.end; }
      link(sel, on); exit();
    }
    if (isKw(peek(), 'LIMIT')) {
      const l = next(); const nn = next(); const ln = mkNode('Limit', 'limit ' + nn.text, l, [l.start, nn.end], 'clause'); link(sel, ln);
    }
    sel.span[1] = toks[p - 1].end; list.span[1] = list.children.length ? list.children[list.children.length - 1].span[1] : list.span[0];
    exit();
    return sel;
  }
  function parseTableRef() {
    enter('parseTableRef');
    const t = next(); let label = t.text; let end = t.end;
    const tn = mkNode('RangeVar', 'RangeVar', t, [t.start, t.end], 'from');
    tn.name = t.text;
    if (peek().type === 'IDENT') { const a = next(); tn.alias = a.text; tn.label = t.text + ' ' + a.text; end = a.end; tn.span[1] = end; }
    else tn.label = t.text;
    exit();
    return tn;
  }
  function parsePrimary() {
    enter('parsePrimary');
    const t = peek(); let n;
    if (t.type === 'NUMBER') { next(); n = mkNode('Const', t.text, t, [t.start, t.end], 'const'); n.value = t.text; n.ctype = t.text.includes('.') ? 'NUMERIC' : 'INT'; }
    else if (t.type === 'STRING') { next(); n = mkNode('Const', t.text, t, [t.start, t.end], 'const'); n.value = t.text; n.ctype = 'TEXT'; }
    else if (t.text === '(') { next(); n = parseExpr(0); const c = next(); n.span = [t.start, c.end]; }
    else if (t.text === '*') { next(); n = mkNode('Star', '*', t, [t.start, t.end], 'colref'); }
    else if (t.type === 'IDENT') {
      next();
      if (peek().text === '(') {
        next(); const f = mkNode('FuncCall', t.text + '()', t, [t.start, t.end], 'func'); f.fname = t.text;
        if (peek().text !== ')') for (;;) { const a = parseExpr(0); link(f, a); if (peek().text === ',') { next(); continue; } break; }
        const c = next(); f.span[1] = c.end; n = f;
      } else if (peek().text === '.') {
        next(); const c = next(); n = mkNode('ColumnRef', t.text + '.' + c.text, t, [t.start, c.end], 'colref'); n.qual = t.text; n.col = c.text;
      } else { n = mkNode('ColumnRef', t.text, t, [t.start, t.end], 'colref'); n.col = t.text; }
    } else throw new Error('unexpected ' + t.text);
    exit();
    return n;
  }
  function parseExpr(minBP) {
    enter('parseExpr', minBP);
    let left;
    if (isKw(peek(), 'NOT')) { const t = next(); const r = parseExpr(BP.NOT); left = mkNode('NotExpr', 'NOT', t, [t.start, r.span[1]], 'op'); link(left, r); }
    else if (peek().text === '-' ) { const t = next(); const r = parseExpr(7); left = mkNode('UnaryExpr', '-', t, [t.start, r.span[1]], 'op'); link(left, r); }
    else left = parsePrimary();
    for (;;) {
      const t = peek(); const key = t.type === 'KEYWORD' ? t.text.toUpperCase() : t.text;
      const bp = (t.type === 'OP' || t.type === 'KEYWORD') ? BP[key] : undefined;
      ev.push({ k: 'peek', i: p, bp });
      if (bp === undefined || bp <= minBP) break;
      next();
      const right = parseExpr(bp);
      const isBool = key === 'AND' || key === 'OR';
      const n = mkNode(isBool ? 'BoolExpr' : 'OpExpr', key, t, [left.span[0], right.span[1]], isBool ? 'bool' : 'op');
      n.op = key; link(n, left); link(n, right); left = n;
    }
    exit();
    return left;
  }
  const root = parseSelect();
  return { sql, toks, root, events: ev, BP };
}

/** tidy tree layout: assigns x (in leaf units) and depth; returns {nodes[], w, h} */
function layoutTree(root) {
  const nodes = []; let leaf = 0;
  (function walk(n, d) {
    n.depth = d; nodes.push(n);
    if (!n.children.length) { n.lx = leaf++; return; }
    n.children.forEach(c => walk(c, d + 1));
    n.lx = (n.children[0].lx + n.children[n.children.length - 1].lx) / 2;
  })(root, 0);
  const maxd = Math.max(...nodes.map(n => n.depth));
  return { nodes, leaves: Math.max(leaf, 1), depth: maxd + 1 };
}
const KIND_COLOR = { stmt: C.purple, list: C.grey, from: C.cyan, clause: C.yellow, op: C.orange, bool: C.pink, colref: C.blue, const: C.green, func: C.teal };

/** simple node-graph helper used by tree-ish views: nodes lerp to targets, edges follow */
function makeGraph(kit, parent, shared) {
  const nodes = shared || new Map(); const edges = [];
  return {
    nodes, edges,
    node(id, text, c, w, x, y, o = {}) {
      const g = new THREE.Group(); g.position.set(x, y, 0); (parent || kit.group).add(g);
      const m = kit.box(w, o.h ?? 0.7, o.d ?? 0.3, c, { parent: g, opacity: o.opacity ?? 0.95 });
      const l = kit.label(text, { size: o.size ?? 0.34, parent: g, z: 0.2, color: o.tcolor ?? '#0b0d14' });
      const n = { id, g, m, l, w, h: o.h ?? 0.7, tx: x, ty: y, color: c, text, sub: null };
      nodes.set(id, n); return n;
    },
    edge(a, b, c = C.grey, o = {}) {
      const l = kit.line([[0, 0, 0], [0, 0, 0]], c, { parent: parent || kit.group, opacity: o.opacity ?? 0.9 });
      const e = { a, b, l, lab: o.label ? kit.dyn({ size: 0.3, parent: parent || kit.group, color: o.lcolor ?? C.yellow }) : null, text: o.label || '' };
      edges.push(e); return e;
    },
    update(dt, k = 8) {
      nodes.forEach(n => { const a = 1 - Math.exp(-k * dt); n.g.position.x += (n.tx - n.g.position.x) * a; n.g.position.y += (n.ty - n.g.position.y) * a; });
      edges.forEach(e => {
        const A = nodes.get(e.a), B = nodes.get(e.b); if (!A || !B) return;
        const ax = A.g.position.x, ay = A.g.position.y - A.h / 2, bx = B.g.position.x, by = B.g.position.y + B.h / 2;
        kit.setLine(e.l, [[ax, ay, 0], [bx, by, 0]]);
        e.l.visible = A.g.visible && B.g.visible;
        if (e.lab) { e.lab.show(e.l.visible); e.lab.set(e.text, undefined); e.lab.move((ax + bx) / 2 + 0.1, (ay + by) / 2, 0.1); if (e.lab.obj) e.lab.obj.center?.set?.(0, 0.5); }
      });
    },
  };
}

/** packet animator: small boxes moving along polylines */
function makePackets(kit) {
  const list = [];
  return {
    send(path, c, o = {}) {
      const m = kit.box(o.w ?? 0.5, o.h ?? 0.3, 0.3, c, { x: path[0][0], y: path[0][1], z: path[0][2] || 0, emissive: 0.4 });
      list.push({ m, path, t: -(o.delay || 0), speed: o.speed ?? 6, done: o.done, len: pathLen(path) });
      return m;
    },
    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]; p.t += dt * p.speed; if (p.t < 0) { p.m.visible = false; continue; }
        p.m.visible = true;
        const d = Math.min(p.t, p.len); const pt = along(p.path, d); p.m.position.set(pt[0], pt[1], pt[2]);
        if (p.t >= p.len) { p.m.parent && p.m.parent.remove(p.m); list.splice(i, 1); p.done && p.done(); }
      }
    },
    clear() { list.forEach(p => p.m.parent && p.m.parent.remove(p.m)); list.length = 0; },
    get busy() { return list.length > 0; },
  };
}
function pathLen(path) { let L = 0; for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], (path[i][2] || 0) - (path[i - 1][2] || 0)); return L; }
function along(path, d) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i]; const L = Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] || 0) - (a[2] || 0));
    if (d <= L || i === path.length - 1) { const f = L ? Math.min(1, d / L) : 1; return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2] || 0, b[2] || 0, f)]; }
    d -= L;
  }
  return path[0];
}
/** titled panel: dark slab + title label. returns group */
function panel(kit, x, y, w, h, title, o = {}) {
  const g = new THREE.Group(); g.position.set(x, y, 0); kit.group.add(g);
  kit.box(w, h, 0.1, o.color || C.panel, { parent: g, z: -0.1, opacity: 0.85 });
  if (title) kit.label(title, { size: 0.4, color: o.tcolor || C.dim, parent: g, y: h / 2 - 0.35, z: 0.05 });
  return g;
}

/* ================================================================ LEXER */
const LEX_SQL = [
  "SELECT o.id, SUM(l.qty) FROM orders o WHERE o.price >= 100 AND o.note = 'rush';",
  "SELECT name FROM users WHERE age > 30 AND city <> 'Oslo' ORDER BY name LIMIT 10;",
  "SELECT 1+2*3 AS x, 'it' FROM t;",
];
views['lexer'] = {
  build(ctx) {
    const kit = makeKit(ctx); const root = kit.group;
    const cw = 0.285;                       // char cell width
    let sqlIdx = 0, toks = [], pos = 0, speed = 8, acc = 0, running = true;
    let srcKit = kit.sub(), outKit = kit.sub();
    const stateTxt = kit.dyn({ x: -9.6, y: 2.2, size: 0.4, align: 'left', color: C.yellow });
    const noteTxt = kit.dyn({ x: -9.6, y: 1.55, size: 0.36, align: 'left', color: C.dim });
    const cursor = kit.box(cw, 0.8, 0.12, C.yellow, { opacity: 0.35, z: -0.02, emissive: 0.5 });
    kit.label('input buffer  (cursor scans one char at a time; a DFA state decides the token class)', { x: 0, y: 4.9, size: 0.38, color: C.dim });
    kit.label('token stream  ->  parser', { x: -6.5, y: -0.2, size: 0.38, color: C.dim });
    // legend
    [['KEYWORD', C.purple], ['IDENT', C.blue], ['NUMBER', C.orange], ['STRING', C.green], ['OP', C.yellow], ['PUNCT', C.grey]].forEach(([n, c], i) => {
      kit.box(0.4, 0.4, 0.1, c, { x: -9 + i * 3.3, y: -5.6 }); kit.label(n, { x: -9 + i * 3.3 + 1.2, y: -5.6, size: 0.34, color: C.dim });
    });
    kit.label('keyword lookup: perfect-hash / sorted table; identifiers case-folded', { x: 0, y: -4.6, size: 0.34, color: C.dim });
    let cells = [], cellMesh = [], outBlocks = [], emitted = 0, flying = [];
    const x0 = () => -(LEX_SQL[sqlIdx].length * cw) / 2;
    function load(i) {
      sqlIdx = i; srcKit.clear(); outKit.clear(); srcKit = kit.sub(); outKit = kit.sub();
      const sql = LEX_SQL[i]; toks = lex(sql); pos = 0; emitted = 0; acc = 0; flying = []; outBlocks = [];
      cellMesh = [];
      for (let k = 0; k < sql.length; k++) cellMesh.push(srcKit.box(cw * 0.94, 0.62, 0.1, C.panel2, { x: x0() + (k + 0.5) * cw, y: 3.6, opacity: 0.9 }));
      // characters: draw each char as small label (monospace per-cell)
      for (let k = 0; k < sql.length; k++) if (sql[k] !== ' ') srcKit.label(sql[k], { x: x0() + (k + 0.5) * cw, y: 3.6, size: 0.3, z: 0.12 });
      srcKit.label('chars[' + sql.length + ']', { x: x0() - 1.1, y: 3.6, size: 0.3, color: C.dim });
    }
    function layoutPos(i) {   // token block placement in wrapped rows
      let x = -9.2, y = -1.2, row = 0;
      for (let k = 0; k <= i; k++) {
        const w = Math.max(0.9, toks[k].text.length * 0.26 + 0.5);
        if (x + w > 9.4) { x = -9.2; y -= 1.3; row++; }
        if (k === i) return { x: x + w / 2, y, w };
        x += w + 0.18;
      }
    }
    function emit(i) {
      const t = toks[i]; const lp = layoutPos(i); const c = TOK[t.type];
      const g = new THREE.Group(); outKit.group.add(g);
      const start = { x: x0() + ((t.start + t.end) / 2) * cw, y: 3.6 };
      g.position.set(start.x, start.y, 0.3);
      outKit.box(lp.w, 0.62, 0.2, c, { parent: g, emissive: 0.15 });
      outKit.label(t.text, { parent: g, size: 0.3, color: '#0b0d14', z: 0.15 });
      outKit.label(t.type, { parent: g, size: 0.2, color: C.dim, y: -0.55, z: 0.1 });
      flying.push({ g, from: start, to: lp, t: 0 });
      outBlocks.push(g);
    }
    function scanTo(n) { pos = clamp(n, 0, toks.length); }
    function refresh() {
      const sql = LEX_SQL[sqlIdx];
      // colour consumed chars by token class
      cellMesh.forEach(m => kit.setColor(m, C.panel2));
      for (let i = 0; i < Math.min(emitted, toks.length); i++) for (let k = toks[i].start; k < toks[i].end; k++) kit.setColor(cellMesh[k], TOK[toks[i].type], 0.55);
    }
    load(0);
    INST.lexer = { setSql(i) { load(i); running = true; }, setSpeed(v) { speed = v; }, restart() { load(sqlIdx); running = true; } };
    function update(dt, t) {
      if (running) {
        acc += dt * speed / 8;      // tokens advance with speed
        while (acc >= 0.35 && emitted < toks.length) { acc -= 0.35; emit(emitted); emitted++; }
        if (emitted >= toks.length && acc > 3) { acc = 0; /* loop */ load((sqlIdx + 1) % LEX_SQL.length); }
      }
      refresh();
      // cursor sweeps between current token start/end smoothly
      const cur = toks[Math.min(emitted, toks.length - 1)];
      const ph = clamp(acc / 0.35, 0, 1);
      if (cur) {
        const cx = lerp(cur.start, Math.max(cur.start, cur.end - 1), ph) + 0.5;
        cursor.position.set(x0() + cx * cw, 3.6, 0.08); cursor.scale.x = cw * (1 + (cur.end - cur.start - 1) * (1 - ph) * 0.0 + 0.1);
        stateTxt.set('state: ' + cur.state + '   token ' + Math.min(emitted + 1, toks.length) + '/' + toks.length, C.yellow);
        noteTxt.set(cur.note, C.dim);
      }
      flying.forEach(f => { f.t = Math.min(1, f.t + dt * 2.2); const e = ease(f.t); f.g.position.x = lerp(f.from.x, f.to.x, e); f.g.position.y = lerp(f.from.y, f.to.y, e); f.g.position.z = 0.3; });
      cursor.material.emissiveIntensity = 0.4 + 0.3 * pulse(t);
    }
    ctx.onInfo && ctx.onInfo('<b>Lexer</b>: a DFA over characters. Whitespace is skipped, the longest match wins (<code>&gt;=</code> not <code>&gt;</code>), keywords are looked up after scanning an identifier.');
    const steps = [
      { title: 'Characters in', text: 'The lexer sees only a flat buffer of bytes. It keeps one cursor and a small DFA state.', run() { running = false; load(sqlIdx); } },
      { title: 'Identifier or keyword?', text: 'Letters start IN_WORD; at the first non-word char the text is looked up in the keyword table (SELECT/FROM...). Not found: identifier, folded to lower-case (Postgres) or kept (MySQL).', run() { load(sqlIdx); running = false; emitted = 0; for (let i = 0; i < 3; i++) { emit(i); emitted++; } } },
      { title: 'Numbers, strings, operators', text: "Digits start IN_NUM; a quote starts IN_STRING until the closing quote; '<' peeks one char to choose between < <= <>. Longest match always wins.", run() { load(sqlIdx); running = false; const n = Math.min(toks.length - 1, 14); for (let i = 0; i < n; i++) { emit(i); emitted++; } } },
      { title: 'Whole stream', text: 'The output is a flat token stream (type, text, source offsets). Offsets let later phases report errors with line/column. No tree yet: that is the parser job.', run() { load(sqlIdx); running = false; for (let i = 0; i < toks.length; i++) { emit(i); emitted++; } flying.forEach(f => f.t = 1); } },
      { title: 'Animate', text: 'Replay continuously.', run() { load((sqlIdx + 1) % LEX_SQL.length); running = true; } },
    ];
    return { group: root, update, dispose() { kit.dispose(); }, onConfigChange() {}, steps };
  },
  controls: [
    { id: 'lex-sql', label: 'SQL text', type: 'select', options: [{ value: '0', label: 'join/agg query' }, { value: '1', label: 'filter + order' }, { value: '2', label: 'arithmetic + alias' }], value: '0', onChange(v) { INST.lexer?.setSql(+v); } },
    { id: 'lex-speed', label: 'scan speed', type: 'range', min: 2, max: 30, value: 8, step: 1, onChange(v) { INST.lexer?.setSpeed(v); } },
    { id: 'lex-restart', label: 'Restart scan', type: 'button', onChange() { INST.lexer?.restart(); } },
  ],
};

/* ================================================== shared tree scene */
const PARSE_SQL = [
  'SELECT a, b + c * 2 FROM t WHERE x > 5 AND y = 1',
  'SELECT a * b + c FROM t WHERE NOT x = 1 OR y = 2',
  'SELECT o.id FROM orders o JOIN customers c ON o.cid = c.id WHERE o.total > 100',
];
const CMP = new Set(['=', '<>', '!=', '<', '>', '<=', '>=', 'LIKE']);
function nodeName(n, style) {
  if (style === 'pg') {
    switch (n.type) {
      case 'OpExpr': return CMP.has(n.op) || n.op === 'LIKE' ? 'A_Expr' : 'A_Expr'; case 'TargetList': return 'targetList'; case 'Const': return 'A_Const';
      case 'WhereClause': return 'whereClause'; case 'NotExpr': return 'BoolExpr(NOT)'; case 'Star': return 'A_Star'; default: return n.type;
    }
  }
  if (style === 'duckdb') {
    switch (n.type) {
      case 'SelectStmt': return 'SelectNode'; case 'TargetList': return 'select_list'; case 'RangeVar': return 'BaseTableRef'; case 'WhereClause': return 'where_clause';
      case 'OpExpr': return CMP.has(n.op) ? 'ComparisonExpression' : 'OperatorExpression'; case 'BoolExpr': return 'ConjunctionExpression';
      case 'ColumnRef': return 'ColumnRefExpression'; case 'Const': return 'ConstantExpression'; case 'FuncCall': return 'FunctionExpression'; case 'JoinExpr': return 'JoinRef'; case 'NotExpr': return 'OperatorExpression(NOT)'; default: return n.type;
    }
  }
  return n.type;
}
function nodeText(n, style) {
  const nm = nodeName(n, style);
  switch (n.type) {
    case 'OpExpr': case 'BoolExpr': return nm + '\n' + n.op;
    case 'ColumnRef': case 'Const': case 'RangeVar': case 'FuncCall': return nm + '\n' + n.label;
    default: return nm;
  }
}
function nodeW(n, style) { const t = nodeText(n, style).split('\n'); return Math.max(1.1, Math.max(...t.map(s => s.length)) * 0.13 + 0.3); }

/** places the tree nodes in the box [x0,x1]x[ytop,ybot]; returns {pos(id)->[x,y], sx, sy} */
function placeTree(lay, x0, x1, ytop, ybot) {
  const sx = Math.min(1.9, (x1 - x0) / Math.max(1, lay.leaves - 1 || 1), 2.0);
  const span = (lay.leaves - 1) * sx; const cx = (x0 + x1) / 2;
  const sy = Math.min(1.7, (ytop - ybot) / Math.max(1, lay.depth - 1));
  const pos = new Map(); lay.nodes.forEach(n => pos.set(n.id, [cx - span / 2 + n.lx * sx, ytop - n.depth * sy]));
  return { pos, sx, sy };
}

/* ================================================================ PARSER */
views['parser'] = {
  build(ctx) {
    const kit = makeKit(ctx); const root = kit.group;
    let style = 'generic';
    let parsed, lay, graph, treeKit, tokKit, tokBlocks, stackKit, nodeById, speed = 5, playing = true, n = 0, acc = 0, evIdx = 0;
    const status = kit.dyn({ x: -9.8, y: -5.9, size: 0.38, align: 'left', color: C.yellow });
    kit.label('call stack', { x: -7.4, y: 2.9, size: 0.38, color: C.dim });
    kit.label('token stream (lookahead = 1)', { x: 0, y: 5.75, size: 0.38, color: C.dim });
    kit.label('AST being built (children are created first for operators, parent last)', { x: 3.3, y: 2.9, size: 0.34, color: C.dim });
    const bpTable = 'binding powers:  OR 1 < AND 2 < NOT 3 < = < > 4 < + - 5 < * / 6';
    kit.label(bpTable, { x: 0, y: -5.3, size: 0.33, color: C.cyan });
    const stackRows = []; for (let i = 0; i < 8; i++) stackRows.push(kit.dyn({ x: -9.8, y: 2.1 - i * 0.62, size: 0.36, align: 'left' }));
    function load(i) {
      treeKit && treeKit.dispose(); tokKit && tokKit.dispose();
      treeKit = kit.sub(); tokKit = kit.sub();
      parsed = parseSQL(PARSE_SQL[i]); lay = layoutTree(parsed.root);
      const pl = placeTree(lay, -3.2, 9.6, 1.9, -4.4);
      graph = makeGraph(treeKit, treeKit.group); nodeById = new Map(); lay.nodes.forEach(nd => nodeById.set(nd.id, nd));
      lay.nodes.forEach(nd => {
        const p = pl.pos.get(nd.id); const nm = nodeText(nd, style); const gn = graph.node(nd.id, nm, KIND_COLOR[nd.kind] || C.grey, nodeW(nd, style), p[0], p[1], { h: nm.includes('\n') ? 0.85 : 0.6, size: 0.27 });
        gn.g.position.set(p[0], p[1], 0);
        gn.g.visible = false;
      });
      lay.nodes.forEach(nd => nd.children.forEach(c => { const e = graph.edge(nd.id, c.id, C.grey); e.l.visible = false; e.pair = [nd.id, c.id]; }));
      // tokens
      tokBlocks = []; let x = -9.8;
      const allW = parsed.toks.map(t => Math.max(0.7, t.text.length * 0.2 + 0.35));
      const tot = allW.reduce((a, b) => a + b + 0.1, 0); const sc = Math.min(1, 19.6 / tot);
      parsed.toks.forEach((t, k) => {
        const w = allW[k] * sc; const c = TOK[t.type];
        const g = new THREE.Group(); g.position.set(x + w / 2, 5.0, 0); tokKit.group.add(g);
        const m = tokKit.box(w, 0.6, 0.2, c, { parent: g });
        tokKit.label(t.text, { parent: g, size: 0.27 * Math.max(0.75, sc), color: '#0b0d14', z: 0.15 });
        tokBlocks.push({ m, g, c }); x += w + 0.1 * sc;
      });
      set(0);
    }
    const ptr = kit.box(0.2, 0.2, 0.2, C.yellow, { emissive: 0.8 }); ptr.rotation.z = Math.PI / 4;
    let stateInfo = null;
    function simulate(upto) {
      const st = { consumed: 0, stack: [], nodes: new Set(), links: new Set(), last: -1, status: 'start: parseSelect() is called on the first token', peekIdx: 0 };
      for (let i = 0; i < upto && i < parsed.events.length; i++) {
        const e = parsed.events[i];
        if (e.k === 'enter') st.stack.push({ fn: e.fn, bp: e.bp });
        else if (e.k === 'exit') { st.stack.pop(); }
        else if (e.k === 'consume') { st.consumed = e.i + 1; st.status = 'consume ' + parsed.toks[e.i].text; }
        else if (e.k === 'node') { st.nodes.add(e.node.id); st.last = e.node.id; st.status = 'make node ' + nodeName(e.node, style); }
        else if (e.k === 'link') { st.links.add(e.parent + '>' + e.child); }
        else if (e.k === 'peek') {
          st.peekIdx = e.i; const tk = parsed.toks[e.i]; const top = [...st.stack].reverse().find(f => f.fn === 'parseExpr');
          if (e.bp === undefined) st.status = "peek '" + tk.text + "': not a binary operator -> return";
          else if (top && e.bp <= top.bp) st.status = "peek '" + tk.text + "' bp " + e.bp + ' <= minBP ' + top.bp + ' -> stop; caller binds tighter';
          else st.status = "peek '" + tk.text + "' bp " + e.bp + ' > minBP ' + (top ? top.bp : 0) + ' -> consume, parse right side with minBP ' + e.bp;
        }
      }
      if (st.peekIdx < st.consumed) st.peekIdx = st.consumed;
      if (upto >= parsed.events.length) st.status = 'parseSelect() returned: stack empty, root = SelectStmt, all tokens consumed';
      return st;
    }
    function set(i) { evIdx = clamp(i, 0, parsed.events.length); stateInfo = simulate(evIdx); render(); }
    function render() {
      const st = stateInfo;
      graph.nodes.forEach((gn, id) => { gn.g.visible = st.nodes.has(id); const hl = id === st.last; kit.setColor(gn.m, gn.color, 1, hl ? 0.6 : 0); gn.g.scale.setScalar(hl ? 1.12 : 1); });
      graph.edges.forEach(e => { e.vis = st.links.has(e.pair[0] + '>' + e.pair[1]); });
      tokBlocks.forEach((b, k) => { const done = k < st.consumed; kit.setColor(b.m, b.c, done ? 0.35 : 1, k === st.peekIdx && !done ? 0.8 : 0); });
      const cur = tokBlocks[Math.min(st.peekIdx, tokBlocks.length - 1)]; ptr.position.set(cur.g.position.x, 4.45, 0.2);
      stackRows.forEach((r, i) => {
        const f = st.stack[i]; if (!f) { r.set(' ', C.dim); return; }
        r.set('› '.repeat(0) + '  '.repeat(Math.min(i, 3)) + f.fn + (f.bp !== undefined ? '(minBP=' + f.bp + ')' : '()'), i === st.stack.length - 1 ? C.yellow : C.dim);
      });
      status.set(st.status, C.yellow);
    }
    function update(dt, t) {
      graph.update(dt);
      graph.edges.forEach(e => { e.l.visible = !!e.vis && e.l.visible; });
      if (playing && evIdx < parsed.events.length) { acc += dt * speed; while (acc >= 1) { acc -= 1; if (evIdx < parsed.events.length) { set(evIdx + 1); } } }
      else if (playing && evIdx >= parsed.events.length) { acc += dt; if (acc > 4) { acc = 0; set(0); } }
      ptr.rotation.y = t * 2;
    }
    INST.parser = { setSql(i) { load(i); playing = true; }, setSpeed(v) { speed = v; }, restart() { set(0); playing = true; }, toggle(v) { playing = v; }, setStyle(s) { style = s; load(INST.parser.cur || 0); }, cur: 0 };
    INST.parser.setSql = i => { INST.parser.cur = i; load(i); playing = true; };
    load(0);
    function find(pred) { return Math.max(1, parsed.events.findIndex(pred) + 1); }
    const steps = [
      { title: 'Recursive descent', text: 'Each grammar rule is a function: parseSelect calls parseTargetList, parseFrom, parseWhere. The call stack IS the parse state.', run() { playing = false; set(find(e => e.k === 'enter' && e.fn === 'parseTargetList')); } },
      { title: 'Expressions: precedence climbing', text: 'parseExpr(minBP) parses a primary, then loops: while the next operator binds tighter than minBP, consume it and recurse for the right side with that operator\'s power. This is why * ends up below +.', run() { playing = false; set(find(e => e.k === 'peek' && e.bp === 6)); } },
      { title: 'Operators become nodes', text: 'Once both operands are built, an OpExpr node is created with them as children; the tree grows bottom-up for expressions and top-down for statements.', run() { playing = false; set(find(e => e.k === 'node' && e.node.type === 'OpExpr') + 3); } },
      { title: 'Boolean connectives', text: 'AND (2) binds tighter than OR (1) but looser than comparison (4): x > 5 AND y = 1 becomes AND(>(x,5), =(y,1)).', run() { playing = false; set(find(e => e.k === 'node' && e.node.type === 'BoolExpr') + 1); } },
      { title: 'Done: AST returned', text: 'parseSelect returns the root. Syntax errors are detected here (unexpected token), but whether table t or column x exist is NOT known yet: that is the binder.', run() { playing = false; set(parsed.events.length); } },
      { title: 'Play', text: 'Run the animation continuously.', run() { set(0); playing = true; } },
    ];
    ctx.onInfo && ctx.onInfo('<b>Parser</b>: hand-written recursive descent + Pratt precedence climbing (DuckDB/Umbra/ClickHouse style). Postgres, MySQL use bison LALR(1) tables; SQLite uses Lemon. Output: parse tree / AST.');
    return { group: root, update, dispose() { kit.dispose(); }, onConfigChange() {}, steps };
  },
  controls: [
    { id: 'par-sql', label: 'SQL text', type: 'select', options: [{ value: '0', label: 'b + c * 2, AND' }, { value: '1', label: 'a * b + c, NOT/OR' }, { value: '2', label: 'JOIN ... ON' }], value: '0', onChange(v) { INST.parser?.setSql(+v); } },
    { id: 'par-speed', label: 'speed (events/s)', type: 'range', min: 1, max: 20, value: 5, step: 1, onChange(v) { INST.parser?.setSpeed(v); } },
    { id: 'par-restart', label: 'Replay', type: 'button', onChange() { INST.parser?.restart(); } },
  ],
};

/* ===================================================================== AST */
views['ast'] = {
  build(ctx) {
    const kit = makeKit(ctx); const root = kit.group;
    let style = 'generic', order = 'pre', showSpan = true, sqlIdx = 0;
    let parsed, lay, graph, treeKit, srcKit, seq = [], k = 0, running = true, acc = 0, cur = null, speed = 2;
    const seqTxt = kit.dyn({ x: -9.8, y: -5.6, size: 0.36, align: 'left', color: C.yellow });
    const spanBar = kit.box(1, 0.16, 0.1, C.yellow, { y: 5.1, emissive: 0.7 });
    kit.label('source text with node span [start,end)', { x: 0, y: 6.1, size: 0.36, color: C.dim });
    kit.label('AST: typed nodes, children owned by parent, every node keeps a source span', { x: 0, y: 3.2, size: 0.38, color: C.dim });
    const cw = 0.25;
    function load(i) {
      sqlIdx = i; treeKit && treeKit.dispose(); srcKit && srcKit.dispose(); treeKit = kit.sub(); srcKit = kit.sub();
      parsed = parseSQL(PARSE_SQL[i]); lay = layoutTree(parsed.root);
      const sql = parsed.sql; const x0 = -sql.length * cw / 2;
      for (let q = 0; q < sql.length; q++) if (sql[q] !== ' ') srcKit.label(sql[q], { x: x0 + (q + 0.5) * cw, y: 5.55, size: 0.27, color: C.text });
      parsed.toks.forEach(t => { if (t.type !== 'EOF') srcKit.box((t.end - t.start) * cw * 0.98, 0.45, 0.05, TOK[t.type], { x: x0 + (t.start + t.end) / 2 * cw, y: 5.55, z: -0.05, opacity: 0.35 }); });
      const pl = placeTree(lay, -9.2, 9.2, 2.1, -4.3);
      graph = makeGraph(treeKit, treeKit.group);
      lay.nodes.forEach(nd => { const p = pl.pos.get(nd.id); const nm = nodeText(nd, style); graph.node(nd.id, nm, KIND_COLOR[nd.kind] || C.grey, nodeW(nd, style), p[0], p[1], { h: nm.includes('\n') ? 0.85 : 0.6, size: 0.27 }); });
      lay.nodes.forEach(nd => nd.children.forEach(c => graph.edge(nd.id, c.id, C.grey)));
      graph.nodes.forEach(n => { n.g.position.set(n.tx, n.ty, 0); });
      buildSeq(); k = 0; acc = 0;
    }
    function buildSeq() {
      seq = [];
      if (order === 'pre') (function w(n) { seq.push(n); n.children.forEach(w); })(parsed.root);
      else if (order === 'post') (function w(n) { n.children.forEach(w); seq.push(n); })(parsed.root);
      else { const q = [parsed.root]; while (q.length) { const n = q.shift(); seq.push(n); q.push(...n.children); } }
    }
    function describe(n) {
      const nm = nodeName(n, style);
      const f = {};
      if (n.children.length) f.children = n.children.map(c => nodeName(c, style) + (c.label && !c.children.length ? '(' + c.label + ')' : ''));
      if (n.op) f.op = "'" + n.op + "'"; if (n.col) f.column = n.col; if (n.qual) f.qualifier = n.qual; if (n.value) f.value = n.value; if (n.name) f.relation = n.name; if (n.alias) f.alias = n.alias;
      f.span = '[' + n.span[0] + ',' + n.span[1] + ') = "' + parsed.sql.slice(n.span[0], n.span[1]) + '"';
      return '<b>' + nm + '</b> { ' + Object.entries(f).map(([a, b]) => '<br>&nbsp;&nbsp;' + a + ': ' + (Array.isArray(b) ? '[' + b.join(', ') + ']' : b)).join(',') + '<br>}';
    }
    function visit(i) {
      k = clamp(i, 0, seq.length);
      const done = new Set(seq.slice(0, k).map(n => n.id)); cur = seq[Math.max(0, k - 1)];
      graph.nodes.forEach((gn, id) => { const d = done.has(id); kit.setColor(gn.m, gn.color, d ? 1 : 0.4, id === cur.id ? 0.7 : 0); gn.g.scale.setScalar(id === cur.id ? 1.12 : 1); });
      if (k > 0) {
        const x0 = -parsed.sql.length * cw / 2; const w = Math.max(cw, (cur.span[1] - cur.span[0]) * cw);
        spanBar.visible = showSpan; spanBar.scale.x = w; spanBar.position.set(x0 + (cur.span[0] + cur.span[1]) / 2 * cw, 5.2, 0.1);
        ctx.onInfo && ctx.onInfo(describe(cur));
      } else spanBar.visible = false;
      seqTxt.set((order === 'pre' ? 'pre-order (visit, then children)' : order === 'post' ? 'post-order (children, then visit)' : 'breadth-first') + ':  ' + seq.slice(0, k).map(n => n.label.split('\n')[0]).join(' > ').slice(-100), C.yellow);
    }
    function update(dt) {
      graph.update(dt);
      if (running) { acc += dt * speed; while (acc >= 1) { acc -= 1; if (k < seq.length) visit(k + 1); else if (acc > -3) { acc = -4; setTimeout(() => {}, 0); } } if (k >= seq.length && acc >= 0) { acc = -3; } if (k >= seq.length && acc < 0) { acc += 0; } }
      if (running && k >= seq.length) { acc += dt * speed; if (acc > 2) { acc = 0; k = 0; visit(1); } }
    }
    INST.ast = {
      setSql(i) { load(i); visit(0); }, setOrder(o) { order = o; buildSeq(); visit(0); running = true; }, setStyle(s) { style = s; load(sqlIdx); visit(0); running = true; },
      setSpan(v) { showSpan = v; visit(k); }, run() { visit(0); running = true; }, setSpeed(v) { speed = v; },
    };
    load(0); visit(1);
    const steps = [
      { title: 'Typed nodes', text: 'Each node is a struct with a type tag (Postgres Node.type / DuckDB ParsedExpression class). Statements, table references and expressions form separate families.', run() { running = false; order = 'pre'; buildSeq(); visit(1); } },
      { title: 'Pre-order walk', text: 'A visitor (switch on node type) visits a node before its children: used e.g. to collect referenced tables or find aggregates.', run() { running = false; order = 'pre'; buildSeq(); visit(Math.ceil(seq.length / 2)); } },
      { title: 'Post-order walk', text: 'Children first: the binder and constant folder need operand types/values before they can decide the parent. Spans let errors point at exact text.', run() { running = false; order = 'post'; buildSeq(); visit(Math.ceil(seq.length / 2)); } },
      { title: 'Still unresolved', text: 'ColumnRef x stores only the NAME "x". No table, no type, no column id. Resolving names is the binder; the AST is purely syntactic.', run() { running = false; order = 'pre'; buildSeq(); const i = seq.findIndex(n => n.type === 'ColumnRef'); visit(i + 1); } },
      { title: 'Animate', text: 'Continuous traversal.', run() { running = true; } },
    ];
    ctx.onInfo && ctx.onInfo('<b>AST</b>: tree of typed nodes. Click a step or change traversal.');
    return { group: root, update, dispose() { kit.dispose(); }, onConfigChange() {}, steps };
  },
  controls: [
    { id: 'ast-sql', label: 'SQL text', type: 'select', options: [{ value: '0', label: 'b + c * 2, AND' }, { value: '1', label: 'a * b + c, NOT/OR' }, { value: '2', label: 'JOIN ... ON' }], value: '0', onChange(v) { INST.ast?.setSql(+v); } },
    { id: 'ast-order', label: 'traversal', type: 'select', options: [{ value: 'pre', label: 'pre-order' }, { value: 'post', label: 'post-order' }, { value: 'bfs', label: 'breadth-first' }], value: 'pre', onChange(v) { INST.ast?.setOrder(v); } },
    { id: 'ast-style', label: 'node naming', type: 'select', options: [{ value: 'generic', label: 'generic' }, { value: 'pg', label: 'PostgreSQL parsenodes' }, { value: 'duckdb', label: 'DuckDB parser classes' }], value: 'generic', onChange(v) { INST.ast?.setStyle(v); } },
    { id: 'ast-span', label: 'show source span', type: 'toggle', value: true, onChange(v) { INST.ast?.setSpan(v); } },
    { id: 'ast-speed', label: 'speed', type: 'range', min: 0.5, max: 6, step: 0.5, value: 2, onChange(v) { INST.ast?.setSpeed(v); } },
    { id: 'ast-run', label: 'Run traversal', type: 'button', onChange() { INST.ast?.run(); } },
  ],
};

/* ======================================================== table panel util */
/** draws a small table. cols [{name,w}], rows [[...cells]]. returns {rowMesh[], hdr, top, h, cellDyn} */
function tablePanel(kit, x, y, title, cols, rows, o = {}) {
  const rh = o.rh ?? 0.5, W = cols.reduce((a, c) => a + c.w, 0) + 0.3, H = (rows.length + 1) * rh + 0.75;
  const g = new THREE.Group(); g.position.set(x, y, 0); kit.group.add(g);
  kit.box(W, H, 0.12, o.color || C.panel, { parent: g, z: -0.12, opacity: 0.92 });
  kit.label(title, { parent: g, y: H / 2 - 0.3, size: o.tsize ?? 0.36, color: o.tcolor || C.yellow });
  let cx = -W / 2 + 0.15; const colX = cols.map(c => { const r = cx + c.w / 2; cx += c.w; return r; });
  const hy = H / 2 - 0.75; const out = { g, W, H, rowMesh: [], rowY: [], cells: [], colX, hdrMesh: null };
  out.hdrMesh = kit.box(W - 0.2, rh * 0.92, 0.05, C.panel2, { parent: g, y: hy, z: 0.0 });
  cols.forEach((c, i) => kit.label(c.name, { parent: g, x: colX[i], y: hy, size: 0.27, color: C.dim, z: 0.06 }));
  rows.forEach((r, j) => {
    const ry = hy - (j + 1) * rh; out.rowY.push(ry);
    out.rowMesh.push(kit.box(W - 0.2, rh * 0.92, 0.05, C.bg, { parent: g, y: ry, z: 0.0, opacity: 0.55 }));
    out.cells.push(r.map((v, i) => kit.label(v, { parent: g, x: colX[i], y: ry, size: 0.28, color: C.text, z: 0.06 })));
  });
  return out;
}

/* ============================================================== CATALOG */
const PG_TYPES = { 20: ['int8', 8], 23: ['int4', 4], 25: ['text', -1], 1700: ['numeric', -1] };
views['catalog'] = {
  build(ctx) {
    const kit = makeKit(ctx); const root = kit.group;
    let ver = 0, warm = false, inval = false, phase = 0, phaseT = 0, seqName = 'orders', playing = false, tp = null;
    let tkit = kit.sub();
    const CLS = [['16384', 'orders', 'r', '4', '1000000', '12500'], ['16390', 'customers', 'r', '2', '100000', '1250'], ['16398', 'orders_pkey', 'i', '1', '1000000', '2745']];
    const ATT = () => {
      const a = [['16384', 'id', '20', '1'], ['16384', 'cust_id', '23', '2'], ['16384', 'total', '1700', '3'], ['16384', 'status', '25', '4'], ['16390', 'id', '23', '1'], ['16390', 'name', '25', '2']];
      if (ver > 0) a.splice(4, 0, ['16384', 'note', '25', '5']);
      return a;
    };
    const status = kit.dyn({ x: -9.8, y: -5.9, size: 0.38, align: 'left', color: C.yellow });
    const cacheTxt = kit.dyn({ x: -8.0, y: -1.0, size: 0.3, color: C.dim });
    let P = {};
    const hl = []; // [mesh]
    const cacheBox = kit.box(3.6, 1.2, 0.12, C.panel, { x: -8.0, y: 1.4, z: -0.1, opacity: 0.92 });
    kit.label('syscache / relcache', { x: -8.0, y: 2.25, size: 0.34, color: C.yellow });
    const cacheState = kit.dyn({ x: -8.0, y: 1.35, size: 0.3 });
    kit.label('lookup: "orders"\nhash(name, nsp)', { x: -8.0, y: 4.4, size: 0.32, color: C.text });
    const reqBox = kit.box(3.6, 1.2, 0.12, C.blue, { x: -8.0, y: 4.4, z: -0.1, opacity: 0.35 });
    const tdBox = kit.box(3.9, 2.9, 0.12, C.green, { x: -8.0, y: -2.9, z: -0.1, opacity: 0.18 });
    kit.label('RelationData\n(TupleDesc built)', { x: -8.0, y: -1.8, size: 0.33, color: C.green });
    const tdTxt = kit.dyn({ x: -8.0, y: -3.4, size: 0.3, color: C.text });
    function build() {
      tkit.dispose(); tkit = kit.sub();
      P.cls = tablePanel(tkit, 0.3, 3.7, 'pg_class   (one row per table/index)', [{ name: 'oid', w: 1.1 }, { name: 'relname', w: 2.2 }, { name: 'kind', w: 0.8 }, { name: 'natts', w: 1.0 }, { name: 'reltuples', w: 1.7 }, { name: 'relpages', w: 1.6 }], CLS.map(r => { const q = [...r]; if (ver > 0 && q[1] === 'orders') q[3] = '5'; return q; }));
      P.att = tablePanel(tkit, 1.3, -0.35, 'pg_attribute   (one row per column)', [{ name: 'attrelid', w: 1.4 }, { name: 'attname', w: 2.0 }, { name: 'atttypid', w: 1.5 }, { name: 'attnum', w: 1.2 }], ATT());
      P.typ = tablePanel(tkit, 7.6, -0.35, 'pg_type', [{ name: 'oid', w: 0.9 }, { name: 'typname', w: 1.4 }, { name: 'len', w: 0.6 }], Object.entries(PG_TYPES).map(([k, v]) => [k, v[0], String(v[1])]));
      P.idx = tablePanel(tkit, 7.6, 3.7, 'pg_index', [{ name: 'indrelid', w: 1.3 }, { name: 'indkey', w: 0.9 }, { name: 'uniq', w: 0.6 }], [['16384', '1', 't']]);
      tkit.label('(system catalogs are ordinary tables, stored in heap pages + B-tree indexes)', { x: 1.3, y: -5.35, size: 0.3, color: C.dim });
    }
    build();
    function clearHL() { [P.cls, P.att, P.typ, P.idx].forEach(p => p.rowMesh.forEach(m => tkit.setColor(m, C.bg, 0.55))); }
    function mark(panel, i, c = C.yellow) { tkit.setColor(panel.rowMesh[i], c, 0.5, 0.15); }
    function timeline(name) {
      seqName = name; clearHL(); tp = []; const ok = name !== 'ghost';
      const cached = warm && !inval;
      tp.push({ t: 0, f: () => { status.set("1. parser/binder asks catalog: lookup relation '" + name + "'", C.yellow); cacheState.set(cached ? 'HIT (relcache)' : 'MISS', cached ? C.green : C.red); tdTxt.set(' '); tkit.setColor(reqBox, C.blue, 0.9, 0.5); } });
      if (cached) {
        tp.push({ t: 1.4, f: () => { status.set('2. relcache hit: no catalog I/O; pointer to cached RelationData returned (pinned by refcount)', C.green); tdTxt.set(tdText(name)); } });
        return;
      }
      if (!ok) { tp.push({ t: 1.4, f: () => { status.set('2. pg_class index probe (relname,nsp) -> no match: ERROR relation "ghost" does not exist', C.red); cacheState.set('MISS -> not found', C.red); } }); return; }
      const ci = CLS.findIndex(r => r[1] === name);
      tp.push({ t: 1.4, f: () => { status.set('2. miss: B-tree probe on pg_class_relname_nsp_index -> heap tuple oid=' + CLS[ci][0], C.yellow); mark(P.cls, ci); } });
      tp.push({ t: 3.0, f: () => { status.set('3. scan pg_attribute by (attrelid, attnum) index: one tuple per column -> names, type oids, positions', C.yellow); ATT().forEach((r, k) => { if (r[0] === CLS[ci][0]) mark(P.att, k); }); } });
      tp.push({ t: 4.6, f: () => { status.set('4. resolve atttypid in pg_type -> type name / length / alignment (also cached in syscache)', C.yellow); ATT().forEach(r => { if (r[0] === CLS[ci][0]) { const k = Object.keys(PG_TYPES).indexOf(r[2]); mark(P.typ, k, C.cyan); } }); if (ci === 0) mark(P.idx, 0, C.green); } });
      tp.push({ t: 6.2, f: () => { status.set('5. RelationData / TupleDesc assembled and stored in relcache; later lookups are hash hits', C.green); tdTxt.set(tdText(name)); cacheState.set('now cached', C.green); warm = true; inval = false; } });
    }
    function tdText(name) { const ci = CLS.find(r => r[1] === name); if (!ci) return ' '; return ATT().filter(r => r[0] === ci[0]).map(r => r[1] + ' ' + PG_TYPES[r[2]][0]).join('\n'); }
    function ddl() {
      ver = 1; build(); clearHL(); inval = true; warm = true;
      status.set('DDL: ALTER TABLE orders ADD COLUMN note text -> new pg_attribute row, natts=5, sinval message broadcast; cached entries invalid', C.red);
      cacheState.set('INVALIDATED', C.red); tdTxt.set(' '); mark(P.att, 4, C.red); mark(P.cls, 0, C.red); tp = null;
    }
    function resetAll() { ver = 0; warm = false; inval = false; build(); clearHL(); cacheState.set('cold', C.dim); tdTxt.set(' '); status.set('catalog at version 0. Run a lookup.', C.dim); tp = null; }
    cacheState.set('cold', C.dim); status.set('catalog at version 0. Run a lookup.', C.dim);
    let tt = 0, fired = 0;
    function run(name) { phaseT = 0; fired = 0; timeline(name); tt = 0; }
    INST.catalog = { run, ddl, reset: resetAll };
    function update(dt, t) {
      if (tp) { tt += dt; while (fired < tp.length && tt >= tp[fired].t) { tp[fired].f(); fired++; } }
      tkit.setColor(reqBox, C.blue, 0.35 + 0.2 * pulse(t) * (tp && fired < 2 ? 1 : 0), 0.2);
    }
    ctx.onInfo && ctx.onInfo('<b>Catalog</b>: metadata stored as tables (Postgres <code>pg_class</code>, <code>pg_attribute</code>, <code>pg_type</code>; MySQL <code>information_schema</code> over the InnoDB data dictionary; SQLite <code>sqlite_schema</code>). A cache sits in front because every statement needs it.');
    const steps = [
      { title: 'Metadata as tables', text: 'The catalog is stored in ordinary relations: pg_class has one row per table/index, pg_attribute one row per column. The DB uses its own storage engine to store its own schema.', run() { resetAll(); } },
      { title: 'Cold lookup', text: 'Name -> oid via an index probe on pg_class, then columns from pg_attribute, then type info from pg_type. That is 3+ index lookups, far too slow per statement.', run() { resetAll(); run('orders'); } },
      { title: 'Cache hit', text: 'The result is cached (relcache/syscache) so the next lookup is one hash probe with no I/O.', run() { resetAll(); warm = true; run('orders'); } },
      { title: 'DDL invalidates', text: 'ALTER TABLE changes catalog rows transactionally, then broadcasts an invalidation message (sinval) so every backend drops its stale cache entry before binding new queries.', run() { resetAll(); warm = true; ddl(); } },
      { title: 'Missing relation', text: 'A failed probe is also a catalog answer: the binder turns it into "relation does not exist" at plan time rather than run time.', run() { resetAll(); run('ghost'); } },
    ];
    return { group: root, update, dispose() { kit.dispose(); }, onConfigChange() {}, steps };
  },
  controls: [
    { id: 'cat-table', label: 'lookup relation', type: 'select', options: ['orders', 'customers', 'ghost'], value: 'orders', onChange(v) { INST.catalog?.run(v); } },
    { id: 'cat-lookup', label: 'Run lookup', type: 'button', onChange() { INST.catalog?.run('orders'); } },
    { id: 'cat-ddl', label: 'ALTER TABLE ADD COLUMN', type: 'button', onChange() { INST.catalog?.ddl(); } },
    { id: 'cat-reset', label: 'Reset catalog', type: 'button', onChange() { INST.catalog?.reset(); } },
  ],
};

/* =============================================================== BINDER */
const CAT = {
  orders: { oid: 16384, cols: [['id', 'int8'], ['cust_id', 'int4'], ['total', 'numeric'], ['status', 'text']] },
  customers: { oid: 16390, cols: [['id', 'int4'], ['name', 'text']] },
};
const BIND_SQL = [
  'SELECT o.id, c.name FROM orders o JOIN customers c ON o.cust_id = c.id WHERE o.total > 100',
  'SELECT o.id, c.name FROM orders o JOIN customers c ON o.cust_id = c.id WHERE o.totl > 100',
  'SELECT id, c.name FROM orders o JOIN customers c ON o.cust_id = c.id WHERE o.total > 100',
  "SELECT o.id FROM orders o JOIN customers c ON o.cust_id = c.id WHERE c.name > 100",
];
const INTF = { int2: 1, int4: 2, int8: 3 };
function editDist(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 0; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
/** runs a real name-resolution + type-check pass; returns events [{id, annot, status, hl:{tbl,col}, err, color}] */
function runBinder(root) {
  const ev = []; const scope = []; let failed = false;
  const E = (n, annot, status, hl, o = {}) => ev.push({ id: n.id, annot, status, hl, ...o });
  const fail = (n, msg, hint) => { failed = true; E(n, 'ERROR', msg + (hint ? '   ' + hint : ''), null, { err: true }); };
  const typeOf = n => n.btype;
  function bindFrom(n) {
    if (n.type === 'JoinExpr') { bindFrom(n.children[0]); bindFrom(n.children[1]); return; }
    if (n.type === 'RangeVar') {
      const t = CAT[n.name]; if (!t) { fail(n, 'relation "' + n.name + '" does not exist'); return; }
      scope.push({ alias: n.alias || n.name, table: n.name, t }); E(n, 'oid ' + t.oid, "catalog lookup '" + n.name + "' -> oid " + t.oid + ', ' + t.cols.length + ' columns; alias ' + (n.alias || n.name) + ' added to scope', { tbl: n.name });
    }
  }
  function bind(n) {
    if (failed) return;
    n.children.forEach(bind); if (failed) return;
    if (n.type === 'ColumnRef') {
      let found = [];
      if (n.qual) { const s = scope.find(s => s.alias === n.qual); if (!s) { fail(n, 'missing FROM-clause entry for table "' + n.qual + '"'); return; } const i = s.t.cols.findIndex(c => c[0] === n.col); if (i >= 0) found.push({ s, i }); }
      else scope.forEach(s => { const i = s.t.cols.findIndex(c => c[0] === n.col); if (i >= 0) found.push({ s, i }); });
      if (found.length === 0) {
        const cands = (n.qual ? scope.filter(s => s.alias === n.qual) : scope).flatMap(s => s.t.cols.map(c => ({ s, c: c[0] })));
        const best = cands.map(x => ({ ...x, d: editDist(n.col, x.c) })).sort((a, b) => a.d - b.d)[0];
        fail(n, 'column "' + n.label + '" does not exist', best && best.d <= 2 ? 'HINT: Perhaps you meant "' + best.s.alias + '.' + best.c + '".' : ''); return;
      }
      if (found.length > 1) { fail(n, 'column reference "' + n.col + '" is ambiguous', 'candidates: ' + found.map(f => f.s.alias + '.' + n.col).join(', ')); return; }
      const f = found[0]; n.btype = f.s.t.cols[f.i][1]; n.bcol = f.s.table + '.' + f.i;
      E(n, '#' + (f.i + 1) + ' ' + n.btype, n.label + " resolved in scope '" + f.s.alias + "' -> " + f.s.table + '.' + f.s.t.cols[f.i][0] + ' (attnum ' + (f.i + 1) + ', type ' + n.btype + ')', { tbl: f.s.table, col: f.i });
    } else if (n.type === 'Const') { n.btype = n.ctype === 'INT' ? 'int4' : n.ctype === 'NUMERIC' ? 'numeric' : 'text'; E(n, n.btype, 'literal ' + n.label + ' has type ' + n.btype, null); }
    else if (n.type === 'OpExpr') {
      const a = typeOf(n.children[0]), b = typeOf(n.children[1]); let cast = null;
      if (a !== b) {
        if (INTF[a] && INTF[b]) cast = INTF[a] > INTF[b] ? ['right', b, a] : ['left', a, b];
        else if ((INTF[a] && b === 'numeric') || (a === 'numeric' && INTF[b])) cast = INTF[a] ? ['left', a, 'numeric'] : ['right', b, 'numeric'];
        else { fail(n, 'operator does not exist: ' + a + ' ' + n.op + ' ' + b, 'HINT: No operator matches the given name and argument types. You might need to add explicit type casts.'); return; }
      }
      const cmp = CMP.has(n.op); n.btype = cmp ? 'bool' : (cast ? cast[2] : a);
      E(n, (cast ? 'cast ' + cast[1] + '->' + cast[2] + ' ' : '') + n.btype, 'operator ' + a + ' ' + n.op + ' ' + b + (cast ? ': implicit cast of ' + cast[0] + ' operand ' + cast[1] + ' -> ' + cast[2] + ' inserted' : ': exact match') + ' -> ' + n.btype, null, cast ? { cast: true } : {});
    } else if (n.type === 'BoolExpr') { n.btype = 'bool'; E(n, 'bool', n.op + ' requires boolean operands: ok', null); }
    else if (n.type === 'FuncCall') { n.btype = 'numeric'; E(n, 'numeric', 'function ' + n.fname + ' resolved', null); }
  }
  const sel = root; const list = sel.children.find(c => c.type === 'TargetList'); const from = sel.children.find(c => ['RangeVar', 'JoinExpr'].includes(c.type)); const where = sel.children.find(c => c.type === 'WhereClause');
  bindFrom(from);
  if (!failed && from.type === 'JoinExpr') bind(from.children[2]);
  if (!failed && where) { bind(where.children[0]); if (!failed) E(where, 'bool', 'WHERE must be boolean: ok', null); }
  if (!failed) list.children.forEach(bind);
  if (!failed) E(sel, 'BoundQuery', 'all names resolved, all types checked -> bound tree ready for the planner', null, { done: true });
  return ev;
}
views['binder'] = {
  build(ctx) {
    const kit = makeKit(ctx); const root = kit.group;
    let parsed, lay, graph, tk, ck, events = [], evIdx = 0, acc = 0, speed = 1.6, playing = true, scen = 0, annots = new Map(), catRows = new Map(), line;
    const status = kit.dyn({ x: -9.8, y: -5.6, size: 0.37, align: 'left', color: C.yellow });
    kit.label('parsed AST (names unresolved)', { x: -4.8, y: 5.6, size: 0.36, color: C.dim });
    kit.label('catalog (via syscache)', { x: 7.1, y: 5.6, size: 0.36, color: C.dim });
    const lineMat = kit.line([[0, 0, 0.3], [1, 0, 0.3]], C.yellow, { opacity: 0.0 });
    function load(i) {
      scen = i; tk && tk.dispose(); ck && ck.dispose(); tk = kit.sub(); ck = kit.sub(); annots.clear(); catRows.clear();
      parsed = parseSQL(BIND_SQL[i]); lay = layoutTree(parsed.root);
      const pl = placeTree(lay, -9.4, 3.0, 4.4, -2.8);
      graph = makeGraph(tk, tk.group);
      lay.nodes.forEach(nd => { const p = pl.pos.get(nd.id); const nm = nodeText(nd, 'generic'); const g = graph.node(nd.id, nm, KIND_COLOR[nd.kind] || C.grey, nodeW(nd, 'generic'), p[0], p[1], { h: nm.includes('\n') ? 0.85 : 0.6, size: 0.26 }); g.g.position.set(p[0], p[1], 0); kit.setColor(g.m, g.color, 0.55); annots.set(nd.id, tk.dyn({ x: p[0], y: p[1] - 0.82, size: 0.24, color: C.green, parent: tk.group })); });
      lay.nodes.forEach(nd => nd.children.forEach(c => graph.edge(nd.id, c.id, C.grey)));
      let y = 3.9;
      Object.entries(CAT).forEach(([name, t]) => {
        const P = tablePanel(ck, 7.3, y - (t.cols.length + 1) * 0.27, name + '  (oid ' + t.oid + ')', [{ name: '#', w: 0.6 }, { name: 'column', w: 1.9 }, { name: 'type', w: 1.5 }], t.cols.map((c, k) => [String(k + 1), c[0], c[1]]), { rh: 0.5 });
        catRows.set(name, P); y -= P.H + 0.5;
      });
      events = runBinder(parsed.root); evIdx = 0; acc = 0; render(0);
    }
    function render(n) {
      evIdx = clamp(n, 0, events.length);
      graph.nodes.forEach((gn, id) => kit.setColor(gn.m, gn.color, 0.5, 0));
      catRows.forEach(P => { ck.setColor(P.hdrMesh, C.panel2); P.rowMesh.forEach(m => ck.setColor(m, C.bg, 0.55)); });
      annots.forEach(a => a.set(' ', C.dim));
      let lastEv = null;
      for (let i = 0; i < evIdx; i++) {
        const e = events[i]; lastEv = e; const gn = graph.nodes.get(e.id);
        kit.setColor(gn.m, e.err ? C.red : gn.color, 1, i === evIdx - 1 ? 0.6 : 0);
        annots.get(e.id).set(e.annot, e.err ? C.red : e.cast ? C.orange : C.green);
        if (e.hl) { const P = catRows.get(e.hl.tbl); if (e.hl.col === undefined) ck.setColor(P.hdrMesh, C.cyan, 1, 0.3); else if (i === evIdx - 1) ck.setColor(P.rowMesh[e.hl.col], C.yellow, 0.95, 0.5); else ck.setColor(P.rowMesh[e.hl.col], C.green, 0.45, 0.1); }
      }
      if (lastEv) { status.set((lastEv.err ? 'ERROR: ' : lastEv.done ? 'DONE: ' : '') + lastEv.status, lastEv.err ? C.red : lastEv.done ? C.green : C.yellow); lineTo(lastEv); }
      else { status.set('binder walks the AST with a scope stack; FROM is bound first, then WHERE, then the select list', C.dim); lineMat.material.opacity = 0; }
    }
    function lineTo(e) {
      if (e.hl && e.hl.col !== undefined) {
        const gn = graph.nodes.get(e.id), P = catRows.get(e.hl.tbl); const px = P.g.position.x + P.colX[0] - 0.5, py = P.g.position.y + P.rowY[e.hl.col];
        kit.setLine(lineMat, [[gn.g.position.x + gn.w / 2, gn.g.position.y, 0.3], [px, py, 0.3]]); lineMat.material.opacity = 0.85; lineMat.material.transparent = true;
      } else lineMat.material.opacity = 0;
    }
    function update(dt, t) {
      graph.update(dt);
      if (playing) {
        acc += dt * speed;
        if (acc >= 1) { acc = 0; if (evIdx < events.length) render(evIdx + 1); }
        if (evIdx >= events.length && acc === 0) { playing = true; acc = -3.5 * speed; }
        if (evIdx >= events.length && acc < 0) { acc += dt * speed * 0; }
      }
      if (evIdx >= events.length && playing && acc < -0.01) { acc += dt * speed; if (acc >= -0.01) { acc = 0; render(0); } }
    }
    INST.binder = { setScen(i) { load(i); playing = true; }, setSpeed(v) { speed = v; }, restart() { render(0); acc = 0; playing = true; } };
    load(0);
    const idxOf = f => Math.max(1, events.findIndex(f) + 1);
    const steps = [
      { title: 'FROM first: resolve relations', text: 'The binder builds a scope: each table reference is looked up in the catalog (name -> oid -> columns). Aliases o and c now map to concrete tables.', run() { playing = false; load(scen); render(idxOf(e => e.tbl === undefined && e.hl && e.hl.tbl && e.hl.col === undefined) + 1); } },
      { title: 'Column references -> ids', text: 'Each name is resolved against the scope: o.cust_id becomes (table orders, attnum 2, int4). Unqualified names are searched in every scope entry; zero matches = "does not exist", two = "ambiguous".', run() { playing = false; render(idxOf(e => e.hl && e.hl.col !== undefined) + 1); } },
      { title: 'Type checking + implicit casts', text: 'Operators are resolved by argument types. o.total (numeric) > 100 (int4): no exact operator, so the binder inserts an implicit int4 -> numeric cast. text > int4 has no operator at all and fails.', run() { playing = false; load(0); render(idxOf(e => e.cast)); } },
      { title: 'Error: unknown column', text: 'A typo is caught here, before any planning: error with a closest-match hint (edit distance) at the exact source span of the node.', run() { playing = false; load(1); render(events.length); } },
      { title: 'Error: ambiguous name', text: 'id exists in both orders and customers. SQL requires you to qualify it; the binder detects two candidates and refuses to guess.', run() { playing = false; load(2); render(events.length); } },
      { title: 'Error: type mismatch', text: 'c.name (text) > 100 (int4): there is no text > integer operator, so binding fails (Postgres) - MySQL would instead coerce silently.', run() { playing = false; load(3); render(events.length); } },
      { title: 'Success', text: 'Output is a bound tree: every name replaced by catalog ids and every expression typed. The optimizer never sees raw names again.', run() { playing = false; load(0); render(events.length); } },
    ];
    ctx.onInfo && ctx.onInfo('<b>Binder / analyzer</b>: semantic analysis. Name resolution via scope stack, type inference, implicit casts, star expansion, permission checks.');
    return { group: root, update, dispose() { kit.dispose(); }, onConfigChange() {}, steps };
  },
  controls: [
    { id: 'bind-scen', label: 'scenario', type: 'select', options: [{ value: '0', label: 'valid query' }, { value: '1', label: 'typo: o.totl' }, { value: '2', label: 'ambiguous: id' }, { value: '3', label: 'type mismatch' }], value: '0', onChange(v) { INST.binder?.setScen(+v); } },
    { id: 'bind-speed', label: 'speed', type: 'range', min: 0.5, max: 5, step: 0.5, value: 1.6, onChange(v) { INST.binder?.setSpeed(v); } },
    { id: 'bind-replay', label: 'Replay', type: 'button', onChange() { INST.binder?.restart(); } },
  ],
};

/* ======================================================= RELATIONAL ALGEBRA */
const RA_SCEN = [
  {
    name: 'selection pushdown', rule: 'sigma_p(R join S) == sigma_p(R) join S      if attrs(p) subset of attrs(R)',
    nodes: { pi: ['π name', C.teal], sel: ['σ total>100', C.yellow], join: ['⋈ cust_id=id', C.orange], o: ['orders', C.blue], c: ['customers', C.blue] },
    before: { pos: { pi: [0, 4.2], sel: [0, 2.5], join: [0, 0.8], o: [-3.6, -1.6], c: [3.6, -1.6] }, edges: [['pi', 'sel', 50000], ['sel', 'join', 1000000], ['join', 'o', 1000000], ['join', 'c', 100000]], note: 'join first: 1M-row hash build/probe, filter afterwards' },
    after: { pos: { pi: [0, 4.2], join: [0, 2.5], sel: [-3.6, 0.5], o: [-3.6, -1.7], c: [3.6, -1.7] }, edges: [['pi', 'join', 50000], ['join', 'sel', 50000], ['sel', 'o', 1000000], ['join', 'c', 100000]], note: 'filter first: the join only sees 50k orders (5% selectivity)' },
  },
  {
    name: 'join reordering (assoc/comm)', rule: '(R join S) join T == R join (S join T)     R join S == S join R',
    nodes: { j2: ['⋈ region_id', C.orange], j1: ['⋈ cust_id', C.orange], o: ['orders', C.blue], c: ['customers', C.blue], r: ['region', C.blue] },
    before: { pos: { j2: [0, 3.4], j1: [-2.4, 1.2], o: [-4.8, -1.2], c: [-0.2, -1.2], r: [3.8, -1.2] }, edges: [['j2', 'j1', 1000000], ['j2', 'r', 10], ['j1', 'o', 1000000], ['j1', 'c', 100000]], note: 'orders x customers first: 1M-row intermediate result' },
    after: { pos: { j2: [0, 3.4], j1: [2.4, 1.2], o: [-3.8, -1.2], c: [0.2, -1.2], r: [4.8, -1.2] }, edges: [['j2', 'o', 1000000], ['j2', 'j1', 100000], ['j1', 'c', 100000], ['j1', 'r', 10]], note: 'small tables first: intermediate shrinks to 100k; orders joins last' },
  },
  {
    name: 'projection pushdown', rule: 'pi_A(R join S) == pi_A(pi_A1(R) join pi_A2(S))   keep only attributes still needed',
    nodes: { pi: ['π id,name', C.teal], join: ['⋈ cust_id=id', C.orange], po: ['π id,cust_id', C.teal], pc: ['π id,name', C.teal], o: ['orders', C.blue], c: ['customers', C.blue] },
    unit: 'MB', hide: ['po', 'pc'],
    before: { pos: { pi: [0, 4.2], join: [0, 2.2], po: [-3.6, 0.2], pc: [3.6, 0.2], o: [-3.6, -1.7], c: [3.6, -1.7] }, edges: [['pi', 'join', 24], ['join', 'o', 192], ['join', 'c', 8]], note: 'full 120-byte order rows travel into the join' },
    after: { pos: { pi: [0, 4.2], join: [0, 2.2], po: [-3.6, 0.0], pc: [3.6, 0.0], o: [-3.6, -1.9], c: [3.6, -1.9] }, edges: [['pi', 'join', 24], ['join', 'po', 40], ['join', 'pc', 2.4], ['po', 'o', 120], ['pc', 'c', 8]], note: 'narrow tuples: join output 40 MB instead of 192 MB; column stores get this for free' },
  },
  {
    name: 'split conjunction + push both', rule: 'sigma_{p and q}(R join S) == sigma_p(R) join sigma_q(S)    (p over R only, q over S only)',
    nodes: { sel: ['σ total>100 ∧ region=EU', C.yellow], join: ['⋈ cust_id=id', C.orange], sp: ['σ total>100', C.yellow], sq: ['σ region=EU', C.yellow], o: ['orders', C.blue], c: ['customers', C.blue] },
    hide: ['sp', 'sq'],
    before: { pos: { sel: [0, 3.6], join: [0, 1.6], sp: [-3.6, 0.0], sq: [3.6, 0.0], o: [-3.6, -1.9], c: [3.6, -1.9] }, edges: [['sel', 'join', 1000000], ['join', 'o', 1000000], ['join', 'c', 100000]], note: 'the whole conjunction is evaluated after a 1M-row join' },
    after: { pos: { sel: [0, 3.6], join: [0, 1.8], sp: [-3.6, -0.2], sq: [3.6, -0.2], o: [-3.6, -2.0], c: [3.6, -2.0] }, edges: [['sel', 'join', 5000], ['join', 'sp', 50000], ['join', 'sq', 10000], ['sp', 'o', 1000000], ['sq', 'c', 100000]], note: 'each conjunct runs at the earliest operator where its attributes exist' },
    afterNodes: { sel: ['(sel eliminated)', C.grey] },
  },
  {
    name: 'eager aggregation (γ pushdown)', rule: 'gamma_{k; sum(x)}(R join S) == gamma(gamma_{k; sum(x)}(R) join S)   when k is the join key of R',
    nodes: { g: ['γ cust_id; SUM(total)', C.pink], join: ['⋈ cust_id=id', C.orange], g2: ['γ cust_id; SUM(total)', C.pink], o: ['orders', C.blue], c: ['customers', C.blue] },
    hide: ['g2'],
    before: { pos: { g: [0, 4.0], join: [0, 2.0], g2: [-3.6, 0.0], o: [-3.6, -1.9], c: [3.6, -1.9] }, edges: [['g', 'join', 100000], ['join', 'o', 1000000], ['join', 'c', 100000]], note: 'aggregate after joining: 1M rows through the join' },
    after: { pos: { g: [0, 4.0], join: [0, 2.0], g2: [-3.6, 0.0], o: [-3.6, -1.9], c: [3.6, -1.9] }, edges: [['g', 'join', 100000], ['join', 'g2', 100000], ['join', 'c', 100000], ['g2', 'o', 1000000]], note: 'pre-aggregate orders to one row per customer (1M -> 100k) before the join', afterG: true },
  },
];
const fmtN = (n, unit) => unit ? (n >= 100 ? Math.round(n) : n) + ' ' + unit : n >= 1e6 ? (n / 1e6) + 'M' : n >= 1e3 ? (n / 1e3) + 'k' : String(n);
views['relational-algebra'] = {
  build(ctx) {
    const kit = makeKit(ctx); const root = kit.group;
    let sc = 0, after = false, anim = 0, auto = false, autoT = 0;
    let tk = kit.sub(), ek = kit.sub(), graph, dots = null, edgesNow = [];
    const ruleTxt = kit.dyn({ x: 0, y: 5.8, size: 0.37, color: C.cyan });
    const costTxt = kit.dyn({ x: 0, y: -4.3, size: 0.42, color: C.yellow });
    const noteTxt = kit.dyn({ x: 0, y: -5.0, size: 0.34, color: C.text });
    kit.label('σ select (filter)   ·   π project (columns)   ·   ⋈ join   ·   γ group/aggregate   ·   ρ rename   ·   ∪ − × set ops', { x: 0, y: -5.75, size: 0.3, color: C.dim });
    const sphere = new THREE.BoxGeometry(0.14, 0.14, 0.14), dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(C.green) });
    const MAXD = 160; const inst = new THREE.InstancedMesh(sphere, dotMat, MAXD); inst.count = 0; kit.group.add(inst);
    kit.own({ dispose() { sphere.dispose(); dotMat.dispose(); inst.dispose(); } });
    const dm = new THREE.Object3D();
    function load(i) {
      sc = i; tk.dispose(); tk = kit.sub(); const S = RA_SCEN[i];
      graph = makeGraph(tk, tk.group);
      Object.entries(S.nodes).forEach(([id, [txt, col]]) => { const w = Math.max(1.6, txt.length * 0.2 + 0.3); const p = S.before.pos[id]; const n = graph.node(id, txt, col, w, p[0], p[1], { h: 0.7, size: 0.3 }); n.g.position.set(p[0], p[1], 0); });
      setState(false, true);
    }
    function setState(a, instant) {
      after = a; const S = RA_SCEN[sc]; const st = a ? S.after : S.before; ek.dispose(); ek = kit.sub();
      const g2 = makeGraph(ek, ek.group, graph.nodes); edgesNow = [];
      graph.nodes.forEach((n, id) => { const p = st.pos[id]; n.tx = p[0]; n.ty = p[1]; if (instant) n.g.position.set(p[0], p[1], 0); n.g.visible = !(S.hide && S.hide.includes(id)) || (a && isUsed(st, id)) || (!a && isUsed(st, id)); });
      st.edges.forEach(([p, c, rows]) => { const e = g2.edge(p, c, C.grey, { label: ' ' }); e.text = fmtN(rows, S.unit); edgesNow.push({ e, rows, p, c, ph: Math.random() }); });
      // update node label for eliminated selection in scenario 4
      ek.g2 = g2; edgesRef = g2;
      const total = st.edges.reduce((s, e) => s + e[2], 0);
      costTxt.set((a ? 'AFTER' : 'BEFORE') + ':  Σ tuples moved between operators = ' + fmtN(Math.round(total * 100) / 100, S.unit), a ? C.green : C.yellow);
      noteTxt.set(st.note, C.text); ruleTxt.set('rewrite rule:  ' + S.rule, C.cyan);
    }
    let edgesRef = null;
    const isUsed = (st, id) => st.edges.some(e => e[0] === id || e[1] === id);
    function update(dt, t) {
      graph.update(dt); edgesRef && edgesRef.update(0);
      if (auto) { autoT += dt; if (autoT > 4) { autoT = 0; setState(!after); } }
      // flowing dots
      let n = 0;
      edgesNow.forEach(o => {
        const A = graph.nodes.get(o.p), B = graph.nodes.get(o.c); if (!A || !B || !A.g.visible || !B.g.visible) return;
        const k = Math.max(1, Math.round(Math.log10(o.rows * (RA_SCEN[sc].unit ? 1e4 : 1) + 10) * 1.6));
        for (let q = 0; q < k && n < MAXD; q++) {
          const u = ((t * 0.35 + o.ph + q / k) % 1);       // child -> parent
          const x = lerp(B.g.position.x, A.g.position.x, u), y = lerp(B.g.position.y + B.h / 2, A.g.position.y - A.h / 2, u);
          dm.position.set(x, y, 0.2); dm.updateMatrix(); inst.setMatrixAt(n++, dm.matrix);
        }
      });
      inst.count = n; inst.instanceMatrix.needsUpdate = true;
    }
    INST['relational-algebra'] = { load, toggle() { setState(!after); }, setAfter(v) { setState(v); }, auto(v) { auto = v; autoT = 0; } };
    load(0);
    const steps = [
      { title: 'A query as an algebra tree', text: 'SQL maps to relational algebra: σ (selection), π (projection), ⋈ (join), γ (aggregation). Each edge carries a relation; the number is its cardinality.', run() { auto = false; load(sc); } },
      { title: 'Equivalence rule', text: 'The algebra has proven identities. They let the optimizer rewrite a tree into a different tree with the SAME result, so it can choose the cheapest one.', run() { auto = false; setState(false); } },
      { title: 'Apply the rewrite', text: 'Nodes slide to their new place. Watch the edge labels: fewer tuples cross the expensive operators after the rewrite.', run() { auto = false; setState(true); } },
      { title: 'Cost = tuples moved', text: 'The sum of edge cardinalities is a crude cost; real cost models also weigh CPU, memory (hash table size) and I/O. A rewrite that always wins (selection pushdown) is a heuristic rule; others (join order) need cost-based search.', run() { auto = false; setState(true); } },
      { title: 'Try the other equivalences', text: 'Use the equivalence selector: join reordering, projection pushdown, conjunct splitting, eager aggregation.', run() { load((sc + 1) % RA_SCEN.length); setState(false); auto = true; } },
    ];
    ctx.onInfo && ctx.onInfo('<b>Relational algebra</b>: the logical language the optimizer rewrites. Sets of tuples in, sets of tuples out; operators are closed so they compose into trees.');
    return { group: root, update, dispose() { kit.dispose(); }, onConfigChange() {}, steps };
  },
  controls: [
    { id: 'ra-scen', label: 'equivalence', type: 'select', options: RA_SCEN.map((s, i) => ({ value: String(i), label: s.name })), value: '0', onChange(v) { INST['relational-algebra']?.load(+v); } },
    { id: 'ra-apply', label: 'Apply / revert rewrite', type: 'button', onChange() { INST['relational-algebra']?.toggle(); } },
    { id: 'ra-auto', label: 'auto-toggle', type: 'toggle', value: false, onChange(v) { INST['relational-algebra']?.auto(v); } },
  ],
};

/* ============================================================ SCHEMA MANAGER */
views['schema-manager'] = {
  build(ctx) {
    const kit = makeKit(ctx); const root = kit.group;
    const COLS = 8, ROWS = 4, N = COLS * ROWS; let mode = 'instant', running = false, el = 0, writes = 0, blocked = 0, applied = 0, logLen = 0, copied = 0, lockMode = 'none', cut = false, done = false, nextW = 0;
    const DUR = { instant: 2.6, blocking: 9, online: 12 };
    const aCells = [], bCells = [];
    const cellW = 0.9, cellH = 0.55;
    const ax = -8, bx = 2.6, gy = 2.2;
    const cell = (x, y, c) => kit.box(cellW * 0.9, cellH * 0.85, 0.12, c, { x, y, opacity: 0.95 });
    for (let i = 0; i < N; i++) { const c = i % COLS, r = Math.floor(i / COLS); aCells.push(cell(ax + c * cellW + 0.45, gy - r * cellH, C.blue)); bCells.push(cell(bx + c * cellW + 0.45, gy - r * cellH, C.panel2)); }
    const tA = kit.dyn({ x: ax + 3.6, y: gy + 1.1, size: 0.36, color: C.blue }), tB = kit.dyn({ x: bx + 3.6, y: gy + 1.1, size: 0.36, color: C.green });
    const cat = kit.box(5.4, 1.2, 0.1, C.panel, { x: -2.9 + 0.2, y: 5.2, z: -0.1, opacity: 0.9 });
    kit.label('catalog / data dictionary', { x: -2.7, y: 5.85, size: 0.3, color: C.dim });
    const catTxt = kit.dyn({ x: -2.7, y: 5.1, size: 0.33 });
    const lockBox = kit.box(5.2, 0.9, 0.1, C.panel, { x: 6.2, y: 5.1, z: -0.1, opacity: 0.9 }); const lockTxt = kit.dyn({ x: 6.2, y: 5.1, size: 0.34 });
    kit.label('metadata lock (MDL) on table', { x: 6.2, y: 5.75, size: 0.3, color: C.dim });
    const logBox = kit.box(8.6, 0.8, 0.1, C.panel, { x: -2.0, y: -1.5, z: -0.1, opacity: 0.9 }); kit.label('change log (binlog / triggers) captured while copying', { x: -2.0, y: -0.85, size: 0.3, color: C.dim });
    const logTxt = kit.dyn({ x: -2.0, y: -1.5, size: 0.3 });
    const qBox = kit.box(8.6, 0.8, 0.1, C.panel, { x: -2.0, y: -3.0, z: -0.1, opacity: 0.9 }); kit.label('application writes (INSERT/UPDATE per second arrive continuously)', { x: -2.0, y: -2.35, size: 0.3, color: C.dim });
    const qTxt = kit.dyn({ x: -2.0, y: -3.0, size: 0.32 });
    const statTxt = kit.dyn({ x: -2.0, y: -4.55, size: 0.4, color: C.yellow }); const explain = kit.dyn({ x: -2.0, y: -5.3, size: 0.33, color: C.text });
    const arrow = kit.box(1.4, 0.15, 0.1, C.grey, { x: 0.9, y: gy - 0.9 });
    const writeDots = []; for (let i = 0; i < 6; i++) writeDots.push(kit.box(0.3, 0.3, 0.2, C.orange, { x: -2, y: -3.58, emissive: 0.5 }));
    const bar = kit.box(8.6, 0.12, 0.1, C.panel2, { x: -2.0, y: -4.05 }); const barFill = kit.box(0.01, 0.16, 0.12, C.green, { x: -6.3, y: -4.05 });
    function reset() {
      el = 0; running = false; writes = 0; blocked = 0; applied = 0; logLen = 0; copied = 0; lockMode = 'none'; cut = false; done = false; nextW = 0;
      aCells.forEach(m => kit.setColor(m, C.blue)); bCells.forEach(m => kit.setColor(m, C.panel2, 0.5));
      writeDots.forEach(d => d.visible = false);
      tA.set('orders  (schema v1: id, cust_id, total)', C.blue); tB.set(mode === 'instant' ? '(no copy needed)' : 'shadow table _orders_new (v2 + note)', mode === 'instant' ? C.dim : C.green);
      catTxt.set('orders: v1  [id, cust_id, total]', C.text); lockTxt.set('SHARED (reads+writes ok)', C.green); logTxt.set('-'); qTxt.set('0 writes'); statTxt.set('ready:  ALTER TABLE orders ADD COLUMN note text DEFAULT NULL', C.dim);
      explain.set({ instant: 'INSTANT: only the dictionary changes; rows are rewritten lazily', blocking: 'COPY/rewrite: build new table under an exclusive lock', online: 'ONLINE: shadow-table copy + change-log replay + atomic rename (gh-ost, pt-osc, InnoDB online DDL)' }[mode], C.text);
      bCells.forEach(m => m.visible = mode !== 'instant');
      arrow.visible = mode !== 'instant';
    }
    function update(dt, t) {
      if (running) {
        el += dt; const p = clamp(el / DUR[mode], 0, 1);
        // incoming writes
        nextW -= dt; if (nextW <= 0 && !done) { nextW = 0.45; writes++; const free = writeDots.find(d => !d.visible); if (free) { free.visible = true; free.userData.t = 0; free.userData.blocked = false; } }
        if (mode === 'instant') {
          if (p > 0.25 && lockMode !== 'ddl') { lockMode = 'ddl'; }
          if (p > 0.25 && p < 0.45) { lockTxt.set('EXCLUSIVE (brief, ms)', C.red); catTxt.set('orders: v1 -> v2  [+ note DEFAULT NULL]', C.yellow); }
          if (p >= 0.45) { lockTxt.set('SHARED (reads+writes ok)', C.green); catTxt.set('orders: v2  [id, cust_id, total, note]', C.green); tA.set('orders  (rows keep v1 layout; v2 on new writes)', C.blue); aCells.forEach((m, i) => { if (i % 5 === 0 && p > 0.6) kit.setColor(m, C.green, 1, 0.2); }); statTxt.set('done in O(1): no row touched. Old rows get the default on read', C.green); }
          if (p >= 1) { done = true; running = false; }
        } else if (mode === 'blocking') {
          lockMode = 'x'; lockTxt.set('EXCLUSIVE until copy ends', C.red); copied = Math.floor(p * N); statTxt.set('copying ' + copied + '/' + N + ' rows  |  blocked writes: ' + blocked, C.red);
          if (p >= 1) { done = true; running = false; lockTxt.set('SHARED (after rename)', C.green); catTxt.set('orders: v2  [id, cust_id, total, note]', C.green); statTxt.set('done. Downtime ~ copy duration (hours on a 500 GB table). ' + blocked + ' writes were blocked', C.red); }
        } else {
          const copyP = clamp(p / 0.82, 0, 1); copied = Math.floor(copyP * N);
          if (p < 0.82) { lockTxt.set('SHARED (writes keep flowing)', C.green); logLen = Math.round(writes * 0.9); statTxt.set('copying chunk ' + copied + '/' + N + '  |  change log: ' + logLen + ' events pending', C.yellow); }
          else if (p < 0.95) { lockTxt.set('replay log, then lock', C.yellow); logLen = Math.max(0, Math.round(writes * 0.9 * (1 - (p - 0.82) / 0.13))); statTxt.set('draining change log: ' + logLen + ' left', C.yellow); }
          else if (p < 1) { lockTxt.set('EXCLUSIVE (cut-over, ms)', C.red); statTxt.set('atomic RENAME orders -> _orders_old, _orders_new -> orders', C.red); catTxt.set('orders: v2  [id, cust_id, total, note]', C.yellow); }
          if (p >= 1) { done = true; running = false; lockTxt.set('SHARED', C.green); catTxt.set('orders: v2  [id, cust_id, total, note]', C.green); statTxt.set('done: writers saw at most a ms-long pause', C.green); }
        }
        for (let i = 0; i < N; i++) {
          if (mode === 'instant') continue;
          if (i < copied) { kit.setColor(bCells[i], C.green, 1, 0.1); kit.setColor(aCells[i], C.blue, 0.45); } else { kit.setColor(bCells[i], C.panel2, 0.5); kit.setColor(aCells[i], C.blue, 1, 0); }
        }
        if (mode !== 'instant' && copied < N && copied >= 0) kit.setColor(aCells[copied], C.yellow, 1, 0.6);
        if (mode === 'blocking') { blocked = Math.round(writes * 0.98); logTxt.set('-', C.dim); }
        logTxt.set(mode === 'online' ? logLen + ' pending events' : '-', C.yellow);
        qTxt.set(writes + ' writes issued   |   ' + (mode === 'blocking' ? blocked + ' blocked (waiting on MDL) ' : mode === 'online' ? (writes - 0) + ' applied to old table + logged' : writes + ' applied'), mode === 'blocking' ? C.red : C.text);
        barFill.scale.x = Math.max(0.01, 8.6 * p); barFill.position.x = -6.3 + 4.3 * p - 4.3 + 4.3;
        barFill.position.x = -2.0 - 4.3 + 4.3 * p;
      }
      writeDots.forEach(d => {
        if (!d.visible) return;
        d.userData.t += dt * (mode === 'blocking' && !done ? 0.4 : 1.2);
        const u = d.userData.t; const x = -6 + (d.userData.i ??= Math.random() * 8) * 0 + u * 3.5;
        if (mode === 'blocking' && running) { d.position.set(-6.2 + Math.min(u, 0.8) * 1.0 + (writeDots.indexOf(d)) * 0.38, -3.58, 0.2); kit.setColor(d, C.red, 1, 0.4); if (d.userData.t > 40) d.visible = false; }
        else { kit.setColor(d, C.orange, 1, 0.4); d.position.set(-6 + u * 3.2, -3.58, 0.2); if (u > 2.4) d.visible = false; }
      });
      if (!running && !done) { barFill.scale.x = 0.01; }
      lockBox.material.emissiveIntensity = 0;
    }
    reset();
    INST['schema-manager'] = { setMode(m) { mode = m; reset(); }, run() { reset(); running = true; }, reset };
    const stepsRun = m => () => { mode = m; reset(); running = true; };
    const steps = [
      { title: 'Schema = catalog entry + row format', text: 'A table definition lives in the catalog (v1). Every row on disk was written using that layout, so changing the schema must reconcile old rows with the new definition.', run() { reset(); } },
      { title: 'Blocking rewrite', text: 'Classic ALTER TABLE COPY: take an exclusive metadata lock, build a new table with the new layout, swap. Correct and simple, but every write waits for the whole copy.', run: stepsRun('blocking') },
      { title: 'Online: shadow table + change log', text: 'Copy in small chunks while writes continue; capture concurrent changes (binlog/triggers) and replay them; take a very short exclusive lock only for the atomic RENAME cut-over (gh-ost, pt-online-schema-change, InnoDB online DDL).', run: stepsRun('online') },
      { title: 'Instant: metadata only', text: 'MySQL 8 INSTANT / Postgres 11 fast-default store the new column and its default in the catalog. Old rows are never rewritten: readers fill in the default; the row carries a schema version.', run: stepsRun('instant') },
      { title: 'Transactional DDL', text: 'Postgres makes DDL transactional (catalog rows are MVCC tuples; ROLLBACK works). MySQL commits DDL implicitly; the data dictionary is crash-safe via an atomic DDL log.', run() { mode = 'instant'; reset(); } },
    ];
    ctx.onInfo && ctx.onInfo('<b>Schema manager</b>: DDL execution and online schema change. Locks (MDL), catalog versioning, row version tags, shadow tables.');
    return { group: root, update, dispose() { kit.dispose(); }, onConfigChange() {}, steps };
  },
  controls: [
    { id: 'sm-mode', label: 'ALTER strategy', type: 'select', options: [{ value: 'instant', label: 'INSTANT (metadata only)' }, { value: 'blocking', label: 'COPY (blocking rewrite)' }, { value: 'online', label: 'ONLINE (shadow table)' }], value: 'instant', onChange(v) { INST['schema-manager']?.setMode(v); } },
    { id: 'sm-run', label: 'Run ALTER TABLE ADD COLUMN', type: 'button', onChange() { INST['schema-manager']?.run(); } },
    { id: 'sm-reset', label: 'Reset', type: 'button', onChange() { INST['schema-manager']?.reset(); } },
  ],
};

/* ============================================================ WIRE PROTOCOL */
const be32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = n => [(n >>> 8) & 255, n & 255];
const le24 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const le32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const cstr = s => [...[...s].map(c => c.charCodeAt(0)), 0];
const str = s => [...s].map(c => c.charCodeAt(0));
const F = (name, bytes, c, note) => ({ name, bytes, c, note });
const PGC = { tag: C.purple, len: C.yellow, body: C.blue, body2: C.green, body3: C.orange, body4: C.cyan, body5: C.pink };
function pgMsg(dir, title, tag, tagMeaning, bodyFields) {
  const bodyLen = bodyFields.reduce((a, f) => a + f.bytes.length, 0);
  return { dir, title, fields: [F('type tag', [tag.charCodeAt(0)], PGC.tag, "'" + tag + "' = " + tagMeaning), F('int32 length', be32(bodyLen + 4), PGC.len, 'length of everything after the tag, INCLUDING these 4 bytes = ' + (bodyLen + 4)), ...bodyFields] };
}
const WIRE = {
  'pg-simple': [
    pgMsg('c2s', 'Query  (simple query protocol)', 'Q', 'Query', [F('query cstring', cstr('SELECT 1'), PGC.body, 'SQL text, NUL-terminated; parsed+planned+run in one shot')]),
    pgMsg('s2c', 'RowDescription', 'T', 'RowDescription', [F('int16 #fields', be16(1), PGC.body, '1 column'), F('name cstring', cstr('?column?'), PGC.body2, 'column label chosen by server'), F('int32 table oid', be32(0), PGC.body3, '0 = not a table column'), F('int16 attnum', be16(0), PGC.body3, '0'), F('int32 type oid', be32(23), PGC.body4, '23 = int4 (pg_type)'), F('int16 typlen', be16(4), PGC.body4, '4 bytes'), F('int32 typmod', be32(-1), PGC.body5, '-1 = none'), F('int16 format', be16(0), PGC.body5, '0 = text')]),
    pgMsg('s2c', 'DataRow', 'D', 'DataRow', [F('int16 #cols', be16(1), PGC.body, '1 column'), F('int32 col len', be32(1), PGC.body2, 'value is 1 byte (-1 would mean NULL)'), F('value bytes', str('1'), PGC.body3, "text format: ASCII '1'")]),
    pgMsg('s2c', 'CommandComplete', 'C', 'CommandComplete', [F('tag cstring', cstr('SELECT 1'), PGC.body, 'command tag with row count')]),
    pgMsg('s2c', 'ReadyForQuery', 'Z', 'ReadyForQuery', [F('txn status', str('I'), PGC.body, "'I' idle, 'T' in transaction, 'E' failed transaction")]),
  ],
  'pg-extended': [
    pgMsg('c2s', 'Parse  (prepare once)', 'P', 'Parse', [F('stmt name', cstr('s1'), PGC.body, 'named prepared statement ("" = unnamed)'), F('query cstring', cstr('SELECT $1::int'), PGC.body2, '$1 = parameter placeholder'), F('int16 #param types', be16(0), PGC.body3, '0 = let the server infer')]),
    pgMsg('c2s', 'Bind  (parameters)', 'B', 'Bind', [F('portal', cstr(''), PGC.body, 'unnamed portal'), F('stmt name', cstr('s1'), PGC.body2, 'which prepared statement'), F('int16 #fmt codes', be16(0), PGC.body3, 'all params use text format'), F('int16 #params', be16(1), PGC.body3, 'one parameter'), F('int32 param len', be32(1), PGC.body4, '1 byte'), F('param value', str('7'), PGC.body4, "'7' - sent separately from SQL: no injection"), F('int16 #res fmt', be16(0), PGC.body5, 'results in text')]),
    pgMsg('c2s', 'Execute', 'E', 'Execute', [F('portal', cstr(''), PGC.body, 'unnamed portal'), F('int32 max rows', be32(0), PGC.body2, '0 = all rows; N>0 = cursor-style fetch of N rows')]),
    pgMsg('c2s', 'Sync', 'S', 'Sync', []),
    pgMsg('s2c', 'ParseComplete / BindComplete', '1', 'ParseComplete (then 2 = BindComplete)', []),
    pgMsg('s2c', 'DataRow', 'D', 'DataRow', [F('int16 #cols', be16(1), PGC.body, '1 column'), F('int32 col len', be32(1), PGC.body2, '1 byte'), F('value', str('7'), PGC.body3, "'7'")]),
    pgMsg('s2c', 'ReadyForQuery', 'Z', 'ReadyForQuery', [F('txn status', str('I'), PGC.body, 'idle')]),
  ],
};
function myPkt(dir, title, seq, fields) {
  const len = fields.reduce((a, f) => a + f.bytes.length, 0);
  return { dir, title, fields: [F('3-byte payload length', le24(len), PGC.len, 'little-endian = ' + len + ' bytes of payload'), F('sequence id', [seq], PGC.tag, 'resets to 0 at each command; ' + seq + ' here'), ...fields] };
}
WIRE.mysql = [
  myPkt('c2s', 'COM_QUERY', 0, [F('command byte', [3], PGC.body, '0x03 = COM_QUERY'), F('query string', str('SELECT 1'), PGC.body2, 'NOT NUL-terminated: length comes from the header')]),
  myPkt('s2c', 'Column count', 1, [F('lenenc int', [1], PGC.body, '1 column in the result set')]),
  myPkt('s2c', 'Column definition 41', 2, [F('catalog', [3, ...str('def')], PGC.body, 'length-encoded string "def"'), F('schema/table/org_table', [0, 0, 0], PGC.body2, 'empty strings (computed expression)'), F('name', [1, ...str('1')], PGC.body3, 'column label "1"'), F('org_name', [0], PGC.body2, ''), F('0x0c', [12], PGC.tag, 'length of fixed-length fields below'), F('charset', [0x3f, 0], PGC.body4, '63 = binary'), F('column length', le32(1), PGC.body4, 'max display length'), F('type', [8], PGC.body5, '0x08 = MYSQL_TYPE_LONGLONG'), F('flags', [0x81, 0], PGC.body5, 'NOT_NULL | BINARY'), F('decimals+filler', [0, 0, 0], PGC.body, '')]),
  myPkt('s2c', 'EOF (end of column defs)', 3, [F('0xFE', [0xfe], PGC.body, 'EOF marker'), F('warnings', [0, 0], PGC.body2, '0'), F('status flags', [2, 0], PGC.body3, 'SERVER_STATUS_AUTOCOMMIT')]),
  myPkt('s2c', 'Text resultset row', 4, [F('lenenc string', [1, ...str('1')], PGC.body, 'length 1, then ASCII "1": every value is a string in the text protocol')]),
  myPkt('s2c', 'EOF / OK', 5, [F('0xFE', [0xfe], PGC.body, 'EOF marker'), F('warnings', [0, 0], PGC.body2, '0'), F('status flags', [2, 0], PGC.body3, 'autocommit')]),
];
const hx = b => b.toString(16).toUpperCase().padStart(2, '0');
const asc = b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
views['wire-protocol'] = {
  build(ctx) {
    const kit = makeKit(ctx); const root = kit.group;
    let proto = 'pg-simple', mi = 0, reveal = 0, auto = true, hold = 0, speed = 14;
    let mk = kit.sub(); let cells = [], flat = [];
    const title = kit.dyn({ x: 0, y: 3.7, size: 0.48, color: C.text });
    const dirTxt = kit.dyn({ x: 0, y: 4.45, size: 0.36, color: C.dim });
    const total = kit.dyn({ x: 0, y: -5.9, size: 0.34, color: C.dim });
    const CW = 1.15, PER = 16;
    function protoName() { return { 'pg-simple': 'PostgreSQL frontend/backend v3 - simple query', 'pg-extended': 'PostgreSQL v3 - extended query (prepared)', mysql: 'MySQL client/server protocol' }[proto]; }
    function build() {
      mk.dispose(); mk = kit.sub(); cells = []; flat = [];
      const list = WIRE[proto]; const m = list[mi];
      // timeline chips
      const tw = 17 / list.length;
      list.forEach((q, i) => {
        const x = -8.5 + (i + 0.5) * tw; const col = q.dir === 'c2s' ? C.blue : C.green;
        mk.box(tw * 0.9, 0.7, 0.1, col, { x, y: 5.4, opacity: i === mi ? 1 : 0.28, emissive: i === mi ? 0.3 : 0 });
        mk.label((q.dir === 'c2s' ? '→ ' : '← ') + q.title.split('  ')[0].split(' / ')[0], { x, y: 5.4, size: Math.min(0.3, tw * 0.1), color: i === mi ? '#0b0d14' : C.text, z: 0.1 });
      });
      title.set(m.title, m.dir === 'c2s' ? C.blue : C.green);
      dirTxt.set(protoName() + '   |   ' + (m.dir === 'c2s' ? 'client → server' : 'server → client'), C.dim);
      // flatten bytes
      let idx = 0; const fieldOf = [];
      m.fields.forEach((f, fi) => f.bytes.forEach(b => { flat.push({ b, f, fi }); idx++; }));
      const rows = Math.ceil(flat.length / PER) || 1; const x0 = -(Math.min(flat.length, PER) * CW) / 2 + CW / 2; const y0 = 2.5;
      flat.forEach((q, i) => {
        const r = Math.floor(i / PER), c = i % PER; const x = x0 + c * CW, y = y0 - r * 1.55;
        const box = mk.box(CW * 0.9, 0.75, 0.15, q.f.c, { x, y, opacity: 0.18 });
        const hex = mk.label(hx(q.b), { x, y, size: 0.4, color: '#ffffff', z: 0.15 }); const a = mk.label(asc(q.b), { x, y: y - 0.65, size: 0.3, color: C.dim, z: 0.1 });
        hex.visible = false; a.visible = false;
        cells.push({ box, hex, a, f: q.f });
      });
      if (!flat.length) mk.label('(no payload: the tag + length are the whole message)', { x: 0, y: 2.0, size: 0.34, color: C.dim });
      // legend
      const legY = y0 - rows * 1.55 - 0.2;
      m.fields.forEach((f, i) => {
        const col = i % 2, row = Math.floor(i / 2); const lx = -9.5 + col * 9.6, ly = legY - row * 0.58;
        mk.box(0.35, 0.35, 0.1, f.c, { x: lx, y: ly });
        mk.label(f.name + ' = ' + f.bytes.map(hx).join(' ') + '  ' + (f.note || ''), { x: lx + 0.3, y: ly, size: 0.27, color: C.text, align: 'left' });
      });
      total.set('message size: ' + flat.length + ' bytes' + (proto === 'mysql' ? '  (header 4 + payload ' + (flat.length - 4) + ')' : '  (1 tag + ' + Math.max(0, flat.length - 1) + ' counted by length)'), C.dim);
      reveal = 0; hold = 0;
      ctx.onInfo && ctx.onInfo('<b>' + m.title + '</b><br>' + m.fields.map(f => '<span style="color:' + f.c + '">■</span> ' + f.name + ': <code>' + f.bytes.map(hx).join(' ') + '</code>').join('<br>'));
    }
    function showN(n) { reveal = n; cells.forEach((c, i) => { const on = i < n; c.hex.visible = on; c.a.visible = on; kit.setColor(c.box, flat[i].f.c, on ? 0.95 : 0.18, i === n - 1 ? 0.8 : 0); }); }
    function go(i) { mi = ((i % WIRE[proto].length) + WIRE[proto].length) % WIRE[proto].length; build(); }
    build();
    let acc = 0;
    function update(dt) {
      if (reveal < flat.length) { acc += dt * speed; while (acc >= 1 && reveal < flat.length) { acc -= 1; showN(reveal + 1); } }
      else if (auto) { hold += dt; if (hold > 2.6) go(mi + 1); }
    }
    INST['wire-protocol'] = { setProto(p) { proto = p; mi = 0; build(); }, go, next() { go(mi + 1); }, setAuto(v) { auto = v; }, setSpeed(v) { speed = v; }, replay() { build(); } };
    const stepFor = (p, i) => () => { auto = false; if (proto !== p) { proto = p; } mi = i; build(); showN(flat.length); };
    const steps = [
      { title: 'A framed message', text: 'Every protocol frames its messages so a stream (TCP) can be split back into messages: Postgres = 1-byte type tag + int32 length; MySQL = 3-byte length + sequence id.', run: stepFor('pg-simple', 0) },
      { title: 'Length counts itself (PG)', text: 'The Postgres length includes its own 4 bytes but not the tag: SELECT 1 is 9 bytes, +4 = 13 = 0x0D.', run: stepFor('pg-simple', 0) },
      { title: 'Result metadata then rows', text: 'RowDescription announces name and type OID once; each DataRow then carries only length-prefixed values (-1 = NULL). Text format sends numbers as ASCII.', run: stepFor('pg-simple', 2) },
      { title: 'Extended protocol: Parse/Bind', text: 'The SQL is sent once (Parse); later executions send only Bind with parameter values, so the server can skip parsing/planning and injection is impossible.', run: stepFor('pg-extended', 1) },
      { title: 'MySQL packet header', text: 'MySQL: 3-byte little-endian payload length + 1-byte sequence id; the command byte (0x03 COM_QUERY) is the first payload byte. A packet of 16 MB-1 is split.', run: stepFor('mysql', 0) },
      { title: 'MySQL text resultset', text: 'Column definitions come before rows; each row is a sequence of length-encoded strings (everything is a string in the text protocol; binary protocol is used for prepared statements).', run: stepFor('mysql', 2) },
    ];
    return { group: root, update, dispose() { kit.dispose(); }, onConfigChange() {}, steps };
  },
  controls: [
    { id: 'wire-proto', label: 'protocol', type: 'select', options: [{ value: 'pg-simple', label: 'PostgreSQL simple query' }, { value: 'pg-extended', label: 'PostgreSQL extended (Parse/Bind/Execute)' }, { value: 'mysql', label: 'MySQL COM_QUERY' }], value: 'pg-simple', onChange(v) { INST['wire-protocol']?.setProto(v); } },
    { id: 'wire-next', label: 'Next message', type: 'button', onChange() { INST['wire-protocol']?.next(); } },
    { id: 'wire-auto', label: 'auto-advance', type: 'toggle', value: true, onChange(v) { INST['wire-protocol']?.setAuto(v); } },
    { id: 'wire-speed', label: 'byte reveal speed', type: 'range', min: 3, max: 60, step: 1, value: 14, onChange(v) { INST['wire-protocol']?.setSpeed(v); } },
  ],
};

/* =================================================================== CLIENT */
views['client'] = {
  build(ctx) {
    const kit = makeKit(ctx); const root = kit.group; const pk = makePackets(kit);
    let mode = 'extended', fetch = 250, prepared = false, clock = 0, sched = [], running = false, rtts = 0, rows = 0, batches = 0, loopT = 0, auto = true;
    const TOTAL = 1000, X = { app: -8.2, drv: -3.0, srv: 7.2 }, Y = 1.6;
    function node(x, w, h, title, color, lines) {
      kit.box(w, h, 0.2, color, { x, y: Y, z: -0.1, opacity: 0.22 }); kit.box(w, 0.06, 0.25, color, { x, y: Y + h / 2 });
      kit.label(title, { x, y: Y + h / 2 + 0.45, size: 0.4, color }); kit.label(lines, { x, y: Y - 0.35, size: 0.28, color: C.text, z: 0.3 });
    }
    node(X.app, 3.6, 4.0, 'application / ORM', C.blue, 'rs = stmt.executeQuery(\n"SELECT * FROM orders\n WHERE cust_id = ?")\n\nORM maps rows\nto objects');
    node(X.drv, 4.4, 4.0, 'driver (libpq / JDBC)', C.purple, 'statement cache\nencode parameters\nTLS + auth\nframing / decode rows\ncursor (fetch size)');
    node(X.srv, 4.6, 4.0, 'server backend', C.green, 'Parse → Bind → Execute\n(parse, plan, run)\nportal holds cursor\nstreams DataRow msgs');
    // wire
    kit.box(5.0, 0.12, 0.12, C.grey, { x: 1.75, y: Y + 0.9 }); kit.box(5.0, 0.12, 0.12, C.grey, { x: 1.75, y: Y - 0.9 });
    kit.box(2.2, 0.12, 0.12, C.grey, { x: X.app + 2.7, y: Y }); kit.label('TCP + TLS socket\n(RTT ≈ 1 ms in-DC, 50+ ms cross-region)', { x: 1.75, y: Y + 1.9, size: 0.3, color: C.dim });
    kit.label('request →', { x: 1.75, y: Y + 1.3, size: 0.26, color: C.purple }); kit.label('← DataRow batches', { x: 1.75, y: Y - 1.3, size: 0.26, color: C.green });
    const stat = kit.dyn({ x: 0, y: -1.3, size: 0.44, color: C.yellow }); const sub = kit.dyn({ x: 0, y: -2.2, size: 0.34, color: C.text });
    const logTxt = kit.dyn({ x: 0, y: -3.2, size: 0.32, color: C.dim });
    const tl = kit.dyn({ x: 0, y: -4.4, size: 0.34, color: C.cyan });
    const hl = { app: kit.box(3.6, 4.0, 0.05, C.blue, { x: X.app, y: Y, z: -0.2, opacity: 0 }), drv: kit.box(4.4, 4.0, 0.05, C.purple, { x: X.drv, y: Y, z: -0.2, opacity: 0 }), srv: kit.box(4.6, 4.0, 0.05, C.green, { x: X.srv, y: Y, z: -0.2, opacity: 0 }) };
    const flash = {}; const setHL = (k, v = 1) => { flash[k] = v; };
    const at = (t, f) => sched.push({ t: clock + t, f });
    function msg(from, to, c, len, delay, label, cb) {
      at(delay, () => { const y = from < to ? Y + 0.9 : Y - 0.9; pk.send([[X[Object.keys(X)[from]] ?? 0, y], [X[Object.keys(X)[to]] ?? 0, y]], c, { speed: 6.5, w: len, done: cb }); logTxt.set(label, c); });
    }
    function packet(fromKey, toKey, c, delay, label, w = 0.5, cb) {
      at(delay, () => { const f = X[fromKey], t = X[toKey]; const yy = f < t ? Y + 0.9 : Y - 0.9; pk.send([[f + (f < t ? 2.3 : -2.3), yy, 0.2], [t + (f < t ? -2.4 : 2.4), yy, 0.2]], c, { speed: 5, w, done: cb }); logTxt.set(label, c); });
    }
    function run() {
      pk.clear(); sched = []; clock = 0; rtts = 0; rows = 0; batches = 0; running = true; loopT = 0;
      const ext = mode === 'extended'; const cursor = fetch < TOTAL; const nb = cursor ? Math.ceil(TOTAL / fetch) : 1;
      let t = 0;
      at(t, () => { setHL('app'); logTxt.set('app calls executeQuery(); driver takes a pooled connection', C.blue); });
      t += 0.8; at(t, () => setHL('drv'));
      if (ext && !prepared) { packet('drv', 'srv', C.purple, t, "Parse 'SELECT ... WHERE cust_id=$1' + Bind + Execute + Sync (pipelined)", 0.9); t += 1.5; at(t - 0.3, () => { rtts++; setHL('srv'); }); }
      else if (ext && prepared) { packet('drv', 'srv', C.purple, t, 'Bind(stmt s1, $1=42) + Execute + Sync   (Parse skipped: statement cached)', 0.5); t += 1.5; at(t - 0.3, () => { rtts++; setHL('srv'); }); }
      else { packet('drv', 'srv', C.purple, t, "Query 'SELECT ... WHERE cust_id = 42'  (value spliced into SQL text)", 0.9); t += 1.5; at(t - 0.3, () => { rtts++; setHL('srv'); }); }
      t += 0.5;
      for (let b = 0; b < nb; b++) {
        const n = Math.min(fetch, TOTAL - b * fetch); const bb = b;
        if (b > 0) { packet('drv', 'srv', C.purple, t, "Execute(portal, max_rows=" + fetch + ")  - ask for the next batch (1 more RTT)", 0.4); t += 1.5; at(t - 0.3, () => { rtts++; setHL('srv'); }); t += 0.2; }
        packet('srv', 'drv', C.green, t, 'DataRow x ' + n + (cursor ? ' + PortalSuspended' : ' + CommandComplete + ReadyForQuery'), 0.4 + Math.min(1.4, n / 400), () => { rows += n; batches++; setHL('drv'); });
        t += 1.5;
        if (nb > 8 && b === 2) { b = nb - 2; t += 0.3; at(t, () => { logTxt.set('... ' + (nb - 3) + ' more batches ...', C.dim); }); }
      }
      at(t, () => { setHL('app'); rows = TOTAL; logTxt.set('driver decodes text/binary values to app types; ResultSet ready', C.blue); });
      t += 1.0; at(t, () => { running = false; loopT = 0; });
      totalRtt = (ext ? 1 : 1) + (cursor ? nb - 1 : 0);
    }
    let totalRtt = 1;
    function update(dt, t) {
      pk.update(dt);
      if (running) { clock += dt; for (let i = sched.length - 1; i >= 0; i--) { if (sched[i].t <= clock) { const s = sched.splice(i, 1)[0]; s.f(); } } }
      else if (auto) { loopT += dt; if (loopT > 3) run(); }
      Object.keys(hl).forEach(k => { flash[k] = Math.max(0, (flash[k] || 0) - dt * 1.2); hl[k].material.opacity = 0.0; kit.setColor(hl[k], { app: C.blue, drv: C.purple, srv: C.green }[k], 0.12 + 0.5 * (flash[k] || 0), 0.5 * (flash[k] || 0)); });
      const nb = fetch < TOTAL ? Math.ceil(TOTAL / fetch) : 1;
      stat.set('round trips this query: ' + (running ? rtts : totalRtt) + ' / ' + (fetch < TOTAL ? nb : 1) + '     rows received: ' + Math.min(rows, TOTAL) + ' / ' + TOTAL, C.yellow);
      sub.set((mode === 'extended' ? (prepared ? 'extended protocol, statement already prepared: parse + plan skipped' : 'extended protocol: Parse+Bind+Execute pipelined in ONE flight') : 'simple protocol: SQL text with literals, parsed every time') + '  |  fetch size ' + (fetch >= TOTAL ? 'ALL' : fetch), C.text);
      const rtt = 1; tl.set('estimated latency at 1 ms RTT: ' + (nb * rtt) + ' ms network  |  at 50 ms RTT: ' + (nb * 50) + ' ms   (fetch size × RTT is why big batches matter)', C.cyan);
    }
    INST.client = { setMode(m) { mode = m; run(); }, setFetch(v) { fetch = Math.max(10, Math.round(v / 10) * 10); run(); }, setPrepared(v) { prepared = v; run(); }, run, auto(v) { auto = v; } };
    run();
    const S = f => () => { auto = false; f(); };
    const steps = [
      { title: 'App builds a query', text: 'The app (often via an ORM) asks the driver for a result set. The driver, not the app, owns the socket, TLS session, statement cache and type codecs.', run: S(() => { mode = 'extended'; prepared = false; run(); clock = 0.1; }) },
      { title: 'Acquire a connection', text: 'The driver borrows an already-authenticated connection from the pool (connection-pool). Opening a new one costs TCP handshake + TLS + auth, tens of ms.', run: S(() => { run(); }) },
      { title: 'Serialise to wire bytes', text: 'Simple protocol sends SQL text; extended protocol sends Parse/Bind/Execute messages with parameters separate from SQL (see wire-protocol).', run: S(() => { mode = 'extended'; prepared = false; run(); }) },
      { title: 'One network round trip', text: 'Request and first response need at least 1 RTT. Pipelining Parse/Bind/Execute/Sync in one flight avoids 3 separate RTTs.', run: S(() => { mode = 'extended'; prepared = false; fetch = 1000; run(); }) },
      { title: 'Server executes', text: 'The server backend parses (unless cached), plans, runs the plan and writes DataRow messages into the socket as rows are produced.', run: S(() => { mode = 'extended'; prepared = true; fetch = 1000; run(); }) },
      { title: 'Rows stream in batches', text: 'With a cursor/fetch size N the portal is suspended after N rows and the client asks for more: more round trips but bounded client memory. Fetch size ALL is one trip but buffers everything.', run: S(() => { fetch = 100; run(); }) },
      { title: 'Decode into app types', text: 'The driver converts text/binary column values (using the type OIDs from RowDescription) into native objects; the ORM may then build entity objects (watch the N+1 problem).', run: S(() => { fetch = 250; run(); }) },
    ];
    ctx.onInfo && ctx.onInfo('<b>Client</b>: application + driver. Controls the number of round trips (fetch size, pipelining, prepared statements) and therefore end-to-end latency.');
    return { group: root, update, dispose() { pk.clear(); kit.dispose(); }, onConfigChange() {}, steps };
  },
  controls: [
    { id: 'cl-mode', label: 'protocol', type: 'select', options: [{ value: 'extended', label: 'extended (Parse/Bind/Execute)' }, { value: 'simple', label: 'simple (text query)' }], value: 'extended', onChange(v) { INST.client?.setMode(v); } },
    { id: 'cl-prep', label: 'statement already prepared', type: 'toggle', value: false, onChange(v) { INST.client?.setPrepared(v); } },
    { id: 'cl-fetch', label: 'fetch size (rows/batch)', type: 'range', min: 10, max: 1000, step: 10, value: 250, onChange(v) { INST.client?.setFetch(v); } },
    { id: 'cl-run', label: 'Run query', type: 'button', onChange() { INST.client?.run(); } },
  ],
};

/* ========================================================== CONNECTION POOL */
views['connection-pool'] = {
  build(ctx) {
    const kit = makeKit(ctx); const root = kit.group;
    let P = 4, lambda = 6, pooling = true, simT = 0, reqs = [], queue = [], slots = [], doneN = 0, sumWait = 0, sumLat = 0, nextArr = 0, opened = 0;
    const SERV = 0.8, HAND = 0.7, MAXC = 100;
    const MAXP = 16;
    let slotK = kit.sub(), qk = kit.sub();
    const slotBoxes = [], slotLab = [];
    for (let i = 0; i < MAXP; i++) { const x = -2.2 + (i % 4) * 1.6, y = 3.2 - Math.floor(i / 4) * 1.5; slotBoxes.push(kit.box(1.4, 1.2, 0.15, C.panel2, { x, y })); }
    kit.label('connection pool\n(authenticated, TLS-established sockets)', { x: 0.2, y: 5.4, size: 0.34, color: C.dim });
    kit.label('wait queue  (FIFO)', { x: -7.8, y: 5.4, size: 0.34, color: C.dim });
    kit.label('database server\nbackends', { x: 7.6, y: 5.4, size: 0.34, color: C.dim });
    kit.box(4.2, 7.0, 0.15, C.panel, { x: 7.6, y: 1.5, z: -0.1, opacity: 0.8 });
    const srvTxt = kit.dyn({ x: 7.6, y: -0.2, size: 0.3, color: C.text });
    const srvCells = []; for (let i = 0; i < 40; i++) srvCells.push(kit.box(0.4, 0.4, 0.15, C.green, { x: 5.8 + (i % 8) * 0.5, y: 4.0 - Math.floor(i / 8) * 0.5, opacity: 0.0 }));
    const qCells = []; for (let i = 0; i < 40; i++) qCells.push(kit.box(0.5, 0.5, 0.15, C.yellow, { x: -9.3 + (i % 6) * 0.7, y: 3.9 - Math.floor(i / 6) * 0.7, opacity: 0.0 }));
    const m1 = kit.dyn({ x: -1, y: -2.0, size: 0.4, color: C.yellow }), m2 = kit.dyn({ x: -1, y: -2.8, size: 0.36, color: C.text }), m3 = kit.dyn({ x: -1, y: -3.6, size: 0.36, color: C.cyan }), m4 = kit.dyn({ x: -1, y: -4.6, size: 0.33, color: C.dim });
    function resetSim() { reqs = []; queue = []; slots = Array.from({ length: MAXP }, () => null); doneN = 0; sumWait = 0; sumLat = 0; simT = 0; nextArr = 0; opened = 0; }
    resetSim();
    const rnd = () => -Math.log(1 - Math.random());
    function update(dt, t) {
      simT += dt; nextArr -= dt;
      while (nextArr <= 0) { nextArr += rnd() / lambda; const r = { arr: simT, state: 'queued', svc: SERV * (0.4 + rnd() * 0.6), rem: 0, slot: -1, hs: 0 }; reqs.push(r); queue.push(r); }
      const active = pooling ? 0 : reqs.filter(r => r.state === 'handshake' || r.state === 'running').length;
      if (pooling) {
        for (let i = 0; i < P; i++) {
          const s = slots[i];
          if (s) { s.rem -= dt; if (s.rem <= 0) { s.state = 'done'; doneN++; sumLat += simT - s.arr; slots[i] = null; } }
          if (!slots[i] && queue.length) { const r = queue.shift(); r.state = 'running'; r.rem = r.svc; r.slot = i; r.wait = simT - r.arr; sumWait += r.wait; slots[i] = r; }
        }
        for (let i = P; i < MAXP; i++) slots[i] = null;
      } else {
        // no pool: each request opens its own connection (TCP+TLS+auth handshake) then runs; cap at MAXC
        let running = reqs.filter(r => r.state === 'handshake' || r.state === 'running').length;
        while (queue.length && running < MAXC) { const r = queue.shift(); r.state = 'handshake'; r.hs = HAND; r.wait = simT - r.arr; sumWait += r.wait; running++; opened++; }
        reqs.forEach(r => { if (r.state === 'handshake') { r.hs -= dt; if (r.hs <= 0) { r.state = 'running'; r.rem = r.svc; } } else if (r.state === 'running') { r.rem -= dt; if (r.rem <= 0) { r.state = 'done'; doneN++; sumLat += simT - r.arr; } } });
      }
      reqs = reqs.filter(r => r.state !== 'done');
      // visuals
      for (let i = 0; i < MAXP; i++) {
        const box = slotBoxes[i]; box.visible = pooling && i < P; const s = slots[i];
        if (box.visible) kit.setColor(box, s ? C.orange : C.panel2, s ? 0.55 + 0.45 * (1 - s.rem / s.svc) : 1, s ? 0.25 : 0);
      }
      const qn = queue.length; qCells.forEach((c, i) => { kit.setColor(c, qn > 20 ? C.red : C.yellow, i < qn ? 0.95 : 0, 0.2); });
      const run = reqs.filter(r => r.state === 'running').length, hs = reqs.filter(r => r.state === 'handshake').length;
      const nconn = pooling ? P : run + hs;
      srvCells.forEach((c, i) => { const on = i < nconn; kit.setColor(c, i < run && !pooling ? C.green : pooling ? C.green : C.yellow, on ? 0.9 : 0, 0.15); });
      const mem = nconn * 8;
      srvTxt.set(nconn + ' backend' + (nconn === 1 ? '' : 's') + (pooling ? ' (fixed)' : ' (one per request)') + '\n≈ ' + mem + ' MB RSS at ~8 MB each (process-per-connection)\n' + (nconn > 60 ? 'context-switch + lock contention\ncliff: throughput collapses' : nconn > 0 ? 'OK' : ''), nconn > 60 ? C.red : C.text);
      const T = Math.max(simT, 1); const W = doneN ? sumLat / doneN : 0;
      m1.set((pooling ? 'pooling ON  (size ' + P + ')' : 'pooling OFF  (connect per request, handshake ' + HAND + ' s)') + '   λ = ' + lambda + ' req/s', pooling ? C.green : C.red);
      m2.set('queue ' + qn + '   in service ' + run + (pooling ? '' : '   handshaking ' + hs) + '   throughput ' + (doneN / T).toFixed(1) + '/s   capacity ≈ ' + (pooling ? (P / SERV / 0.7).toFixed(1) : '∞ until DB melts') + '/s', C.text);
      m3.set("avg latency W = " + W.toFixed(2) + " s   avg concurrency L = λ·W ≈ " + (lambda * W).toFixed(1) + "   (Little's law)", C.cyan);
      m4.set(pooling ? (lambda > P / (SERV * 0.7) ? 'arrival rate exceeds pool capacity: the queue grows without bound' : 'pool absorbs bursts: excess requests wait instead of opening more backends') : 'every request pays TCP + TLS + auth, and the server forks a process: expensive', C.dim);
    }
    INST['connection-pool'] = { setP(v) { P = Math.round(v); }, setL(v) { lambda = v; }, setPool(v) { pooling = v; resetSim(); }, reset: resetSim };
    const steps = [
      { title: 'Why a pool', text: 'Opening a connection costs a TCP handshake, TLS, authentication and (in Postgres) forking a backend process of several MB. A pool opens N connections once and lends them out.', run() { pooling = false; resetSim(); } },
      { title: 'Acquire / release', text: 'A request borrows a connection, runs one or more statements, and returns it. If all N are busy it waits in a FIFO queue (or times out).', run() { pooling = true; P = 4; lambda = 4; resetSim(); } },
      { title: 'Pool size is a throttle', text: 'Capacity ≈ pool size / service time. Past the knee more connections only add context switches and lock contention, so a small pool (cores × 2 + disks) is often fastest.', run() { pooling = true; P = 2; lambda = 6; resetSim(); } },
      { title: 'Overload: queue grows', text: 'When arrival rate exceeds capacity the queue grows; bounded queues and timeouts turn that into back-pressure instead of a dead database.', run() { pooling = true; P = 2; lambda = 12; resetSim(); } },
      { title: 'Transaction pooling', text: 'PgBouncer in transaction mode multiplexes thousands of client connections onto a few server connections by reassigning at COMMIT, at the cost of session state (SET, prepared statements, advisory locks).', run() { pooling = true; P = 6; lambda = 14; resetSim(); } },
    ];
    ctx.onInfo && ctx.onInfo('<b>Connection pool</b>: bounded set of reusable connections. Process-per-connection (Postgres) makes this essential; MySQL uses a thread per connection; some systems (Vitess/ProxySQL/PgBouncer) pool in a proxy.');
    return { group: root, update, dispose() { kit.dispose(); }, onConfigChange() {}, steps };
  },
  controls: [
    { id: 'cp-pool', label: 'pooling enabled', type: 'toggle', value: true, onChange(v) { INST['connection-pool']?.setPool(v); } },
    { id: 'cp-size', label: 'pool size', type: 'range', min: 1, max: 16, step: 1, value: 4, onChange(v) { INST['connection-pool']?.setP(v); } },
    { id: 'cp-rate', label: 'arrival rate λ (req/s)', type: 'range', min: 1, max: 20, step: 1, value: 6, onChange(v) { INST['connection-pool']?.setL(v); } },
    { id: 'cp-reset', label: 'Reset stats', type: 'button', onChange() { INST['connection-pool']?.reset(); } },
  ],
};
