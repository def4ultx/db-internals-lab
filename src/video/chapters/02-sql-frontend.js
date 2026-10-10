import { W, C, L, p, pOut, ease, win, hexA, lerp, text, box, arrow, packet, pill, measure, callout, kinetic, rrect, clamp, code } from '../helpers.js';
export const title = 'From SQL text to a logical plan';
export const subtitle = 'Lexer · parser · binder · relational algebra';
export const color = '#bb9af7';
export const duration = 55;
export const focus = ['frontend', 'planning'];
export const narration = [
  { at: 0.6, text: 'Before anything runs, text must become structure. The lexer chops characters into tokens: keywords, identifiers, operators and literals.' },
  { at: 9.2, text: 'The parser applies the grammar and builds an abstract syntax tree, one node per clause, with no idea yet whether these tables exist.' },
  { at: 18.2, text: 'The binder fixes that. It looks up every name in the catalog, resolves aliases, checks types, and rejects unknown columns before any work happens.' },
  { at: 27.8, text: 'Next, relational algebra: projection, selection, join and aggregation. Declarative SQL becomes a tree of operators.' },
  { at: 35.5, text: 'That tree is the logical plan, and the optimizer may rewrite it freely. Here it pushes the filter below the join, so far fewer rows ever reach it.' },
  { at: 46.5, text: 'Same answer, far less work. Next: how does the optimizer choose?' },
];
const SQL = ['SELECT u.name, SUM(o.total)', 'FROM users u JOIN orders o ON u.id = o.user_id', 'WHERE o.total > 100 GROUP BY u.name'];
const KW = /^(SELECT|FROM|JOIN|ON|WHERE|GROUP|BY|SUM)$/;
function tokenize() { const out = []; SQL.forEach((ln, li) => { (ln.match(/\w+|[.,()=>]/g)).forEach(s => out.push({ s, li, k: KW.test(s) ? 'KEYWORD' : /^\d+$/.test(s) ? 'NUMBER' : /^\w+$/.test(s) ? 'IDENT' : 'PUNCT' })); }); return out; }
const TOKS = tokenize();
const KC = { KEYWORD: C.purple, IDENT: C.accent, NUMBER: C.orange, PUNCT: C.dim };
const AST = [ // id, label, x, y, w, parent, color, appear
  ['root', 'SelectStmt', 960, 180, 200, null, L.frontend, 10.2],
  ['sl', 'SelectList', 300, 320, 180, 'root', L.frontend, 11],
  ['fr', 'From', 850, 320, 130, 'root', L.frontend, 11.4],
  ['wh', 'Where', 1300, 320, 140, 'root', L.frontend, 11.8],
  ['gb', 'GroupBy', 1640, 320, 160, 'root', L.frontend, 12.2],
  ['c1', 'ColRef u.name', 170, 470, 190, 'sl', C.accent, 12.8],
  ['ag', 'Agg SUM', 430, 470, 170, 'sl', C.purple, 13.2],
  ['jn', 'Join', 850, 470, 120, 'fr', L.planning, 13.6],
  ['gt', 'Gt  >', 1300, 470, 120, 'wh', C.purple, 14],
  ['c2', 'ColRef u.name', 1640, 470, 190, 'gb', C.accent, 14.4],
  ['c3', 'ColRef o.total', 395, 620, 190, 'ag', C.accent, 14.8],
  ['t1', 'Table users u', 620, 620, 190, 'jn', L.storage, 15.2],
  ['t2', 'Table orders o', 850, 620, 190, 'jn', L.storage, 15.6],
  ['eq', 'ON u.id = o.user_id', 1065, 620, 230, 'jn', C.purple, 16],
  ['c4', 'ColRef o.total', 1285, 620, 0, 'gt', C.accent, 0],
];
export function draw(ctx, t, h) {
  // ---- Stage 1: lexer (2.6 - 10)
  const s1 = win(t, 2.6, 9.6, .5);
  if (s1 > 0) {
    ctx.save(); ctx.globalAlpha *= s1;
    SQL.forEach((ln, i) => { code(ctx, ln, 120, 190 + i * 52, { size: 34, alpha: p(t, 2.8 + i * .3, 3.4 + i * .3) }); });
    text(ctx, 'LEXER  characters → tokens', 120, 130, { size: 30, color: L.frontend, weight: 700, alpha: p(t, 2.8, 3.4) });
    // scan cursor line
    const sc = p(t, 3.6, 8, ease.lin); const ci = Math.floor(sc * TOKS.length);
    let x = 120, y = 420, rows = 0; const tcount = TOKS.length;
    TOKS.forEach((tk, i) => { const w = measure(ctx, tk.s, 26, true) + 30; if (x + w > 1780) { x = 120; y += 74; } const a = p(t, 3.6 + i * (4.4 / tcount), 3.6 + i * (4.4 / tcount) + .4, ease.back);
      pill(ctx, tk.s, x + w / 2, y, { color: KC[tk.k], size: 26, mono: true, alpha: a }); text(ctx, tk.k === 'PUNCT' ? 'punct' : tk.k.toLowerCase(), x + w / 2, y + 36, { size: 15, color: hexA(KC[tk.k], .8), align: 'center', alpha: a * .9 }); x += w + 12; });
    const leg = [['KEYWORD', C.purple], ['IDENT', C.accent], ['NUMBER', C.orange], ['PUNCT', C.dim]];
    leg.forEach(([n, c], i) => pill(ctx, n, 900 + i * 220, 780, { color: c, size: 20, alpha: p(t, 4, 5) }));
    text(ctx, 'whitespace dropped · keywords case-folded · string/number literals parsed', 120, 830, { size: 22, color: C.dim, alpha: p(t, 6, 7) });
    ctx.restore();
  }
  // ---- Stage 2: AST (9.2 - 18.2)
  const s2 = win(t, 9.6, 18.0, .5);
  if (s2 > 0) {
    ctx.save(); ctx.globalAlpha *= s2;
    text(ctx, 'PARSER  tokens → abstract syntax tree (grammar-driven: recursive descent / LALR)', 80, 130, { size: 28, color: L.frontend, weight: 700 });
    const nodes = AST.filter(n => n[7] > 0), byId = Object.fromEntries(AST.map(n => [n[0], n]));
    // Gt children
    const extra = [['c4', 'ColRef o.total', 1295, 620, 170, 'gt', C.accent, 16.4], ['lit', 'Lit 100', 1480, 620, 120, 'gt', C.orange, 16.8]]; extra.forEach(e => byId[e[0]] = e);
    const all = [...nodes.filter(n => n[0] !== 'c4'), ...extra];
    all.forEach(n => { if (!n[5]) return; const pr = byId[n[5]]; arrow(ctx, [[pr[2], pr[3] + 28], [n[2], n[3] - 28]], { color: hexA(C.dim, .8), width: 2, progress: p(t, n[7] - .3, n[7] + .25), head: false }); });
    all.forEach(n => { const a = p(t, n[7], n[7] + .45, ease.back); box(ctx, { x: n[2] - n[4] / 2, y: n[3] - 28, w: n[4], h: 56, label: n[1], color: n[6], alpha: clamp(a), size: 20, r: 10, glow: (t > n[7] && t < n[7] + .6) ? .8 : 0, scale: .8 + .2 * clamp(a) }); });
    // a token packet flying into the tree
    for (let i = 0; i < 5; i++) { const u = p(t, 9.8 + i * .25, 10.8 + i * .25); packet(ctx, [[200 + i * 150, 780], [960, 215]], u, { color: C.purple, size: 8, alpha: 1 - p(t, 10.6 + i * .25, 11) }); }
    callout(ctx, 'syntax only: a typo in a table name still parses', 960, 760, { color: C.warn, alpha: p(t, 16.8, 17.5), align: 'center' });
    ctx.restore();
  }
  // ---- Stage 3: binder (18.2 - 27.8)
  const s3 = win(t, 18.2, 27.6, .5);
  if (s3 > 0) {
    ctx.save(); ctx.globalAlpha *= s3;
    text(ctx, 'BINDER  names → catalog objects, types, column ids', 80, 130, { size: 28, color: L.frontend, weight: 700 });
    // catalog
    const cx0 = 1180; text(ctx, 'CATALOG', cx0, 190, { size: 22, color: L.frontend, weight: 700, alpha: p(t, 18.6, 19.2) });
    const tabs = [['users  (oid 16384)', ['id      INT  PK', 'name    TEXT', 'email   TEXT'], 215], ['orders  (oid 16391)', ['id        INT  PK', 'user_id   INT  FK', 'total     DECIMAL(10,2)'], 470]];
    tabs.forEach(([n, cols, y], i) => { const a = p(t, 18.8 + i * .3, 19.5 + i * .3); box(ctx, { x: cx0, y, w: 560, h: 220, color: L.frontend, alpha: a, r: 12 }); text(ctx, n, cx0 + 20, y + 36, { size: 24, color: C.fg, alpha: a }); cols.forEach((c, j) => text(ctx, c, cx0 + 30, y + 90 + j * 44, { size: 24, mono: true, color: C.fg, alpha: a, weight: 500 })); });
    // bindings
    const B = [['u.name', 'users.name  →  col 1, TEXT', 23, 1180 + 30, 215 + 134], ['o.total', 'orders.total  →  col 2, DECIMAL(10,2)', 25, 1180 + 30, 470 + 178], ['u.id = o.user_id', 'INT = INT  ✓ types compatible', 24, 1180 + 30, 470 + 134], ['o.total > 100', '100 cast to DECIMAL(10,2) ✓', 26, 0, 0]];
    const bnd = [[26.2, 0], [27, 0]];
    [['u.name', 'users.name : TEXT (col 1)', 19.8, 1, 215 + 134], ['o.total', 'orders.total : DECIMAL(10,2)', 21, 1, 470 + 178], ['u.id = o.user_id', 'INT = INT ✓  join keys compatible', 22.2, 1, 470 + 134]].forEach(([l, r, ts, _, ty], i) => {
      const y = 230 + i * 120; const a = p(t, ts, ts + .5);
      box(ctx, { x: 80, y, w: 330, h: 60, label: l, color: C.accent, alpha: a, mono: true, size: 22 });
      text(ctx, r, 450, y + 30, { size: 22, color: C.good, alpha: a, base: 'middle', weight: 600, mono: true });
      arrow(ctx, [[1000, y + 30], [1180, ty]], { color: hexA(C.good, .7), width: 2, progress: p(t, ts + .3, ts + 1), dashed: true, head: true });
      packet(ctx, [[410, y + 30], [1180, ty]], p(t, ts + .3, ts + 1.2), { color: C.good, size: 8, alpha: 1 - p(t, ts + 1.1, ts + 1.3) });
    });
    text(ctx, 'alias u → users, o → orders', 80, 610, { size: 22, color: C.dim, alpha: p(t, 20.4, 21) });
    // error case
    const ea = p(t, 24.2, 24.8); const shake = Math.sin(t * 40) * 5 * (1 - p(t, 24.6, 25.3)) * (t > 24.5 ? 1 : 0);
    box(ctx, { x: 80 + shake, y: 650, w: 330, h: 60, label: 'o.totl', color: C.bad, alpha: ea, mono: true, size: 22 });
    text(ctx, 'ERROR: column o.totl does not exist  (rejected before planning)', 80, 755, { size: 24, color: C.bad, alpha: p(t, 24.8, 25.4), mono: true, weight: 600 });
    text(ctx, 'Output: a bound tree  —  every name is now an id with a type', 80, 810, { size: 24, color: C.fg, alpha: p(t, 26, 26.8), weight: 600 });
    ctx.restore();
  }
  // ---- Stage 4: relational algebra symbols (27.8 - 35.5)
  const s4 = win(t, 28, 35.3, .5);
  if (s4 > 0) {
    ctx.save(); ctx.globalAlpha *= s4;
    text(ctx, 'RELATIONAL ALGEBRA  —  the operators every plan is made of', 80, 130, { size: 28, color: L.planning, weight: 700 });
    const ops = [['π', 'projection', 'pick columns', C.accent], ['σ', 'selection', 'filter rows', C.good], ['⋈', 'join', 'combine two inputs', L.planning], ['γ', 'aggregation', 'group and fold', C.purple]];
    ops.forEach(([s, n, d, c], i) => { const a = p(t, 28.6 + i * .7, 29.4 + i * .7, ease.back); const x = 130 + i * 440;
      box(ctx, { x, y: 220, w: 380, h: 330, color: c, alpha: clamp(a), glow: .3, scale: .85 + .15 * clamp(a) });
      text(ctx, s, x + 190, 380, { size: 190, color: c, align: 'center', base: 'middle', alpha: clamp(a), weight: 400, glow: 25 });
      text(ctx, n, x + 190, 490, { size: 32, color: C.fg, align: 'center', alpha: clamp(a), weight: 700 }); text(ctx, d, x + 190, 525, { size: 22, color: C.dim, align: 'center', alpha: clamp(a) }); });
    const f = 'Project(u.name, SUM)  ←  γ u.name; SUM(o.total)  ←  σ o.total>100  ←  users ⋈ orders';
    const fa = p(t, 31.8, 32.4); text(ctx, 'π u.name, SUM(o.total) ( γ u.name; SUM(o.total) ( σ o.total > 100 ( users ⋈ u.id=o.user_id orders ) ) )', 960, 660, { size: 28, mono: true, color: C.fg, align: 'center', alpha: fa, weight: 500 });
    text(ctx, 'declarative: WHAT we want, not HOW — there are many equivalent trees', 960, 730, { size: 26, color: C.dim, align: 'center', alpha: p(t, 33, 34) });
    ctx.restore();
  }
  // ---- Stage 5: logical plan + pushdown (35.5 - 54)
  const s5 = win(t, 35.5, 54.2, .5);
  if (s5 > 0) {
    ctx.save(); ctx.globalAlpha *= s5;
    text(ctx, 'LOGICAL PLAN  —  rewrite rule: predicate pushdown', 80, 130, { size: 28, color: L.planning, weight: 700 });
    const m = p(t, 40, 43, ease.inOut);
    const P = { agg: [620, 220], fil: [lerp(620, 900, m), lerp(340, 540, m)], jn: [620, lerp(460, 360, m)], u: [380, 680], o: [900, 690] };
    const N = (k, lbl, sub, c, w = 280) => { const [x, y] = P[k]; box(ctx, { x: x - w / 2, y: y - 38, w, h: 76, label: lbl, sub, color: c, size: 24, subSize: 17, alpha: p(t, 36 + ({ agg: 0, fil: .4, jn: .8, u: 1.2, o: 1.6 })[k], 36.6 + ({ agg: 0, fil: .4, jn: .8, u: 1.2, o: 1.6 })[k]), glow: k === 'fil' && t > 39.5 && t < 43.5 ? .9 : 0 }); };
    const E = (a, b, lbl, ts) => { arrow(ctx, [[P[a][0], P[a][1] + 38], [P[b][0], P[b][1] - 38]], { color: C.dim, width: 3, progress: p(t, ts, ts + .5), head: false }); };
    // edges (dynamic): chain agg <- fil? before: agg-fil-jn ; after: agg-jn, jn-fil-o
    const before = 1 - m;
    if (before > 0) { ctx.save(); ctx.globalAlpha *= before; E('agg', 'fil', '', 36.4); E('fil', 'jn', '', 36.8); ctx.restore(); }
    if (m > 0) { ctx.save(); ctx.globalAlpha *= m; E('agg', 'jn', '', 36.4); arrow(ctx, [[P.jn[0] + 60, P.jn[1] + 38], [P.fil[0], P.fil[1] - 38]], { color: C.dim, width: 3, head: false }); ctx.restore(); }
    arrow(ctx, [[P.jn[0] - 80, P.jn[1] + 38], [P.u[0], P.u[1] - 38]], { color: C.dim, width: 3, head: false, progress: p(t, 37.2, 37.7) });
    if (before > 0) { ctx.save(); ctx.globalAlpha *= before; arrow(ctx, [[P.jn[0] + 80, P.jn[1] + 38], [P.o[0], P.o[1] - 38]], { color: C.dim, width: 3, head: false, progress: p(t, 37.4, 37.9) }); ctx.restore(); }
    if (m > 0) { ctx.save(); ctx.globalAlpha *= m; arrow(ctx, [[P.fil[0], P.fil[1] + 38], [P.o[0], P.o[1] - 38]], { color: C.dim, width: 3, head: false }); ctx.restore(); }
    N('agg', 'γ Aggregate', 'u.name, SUM(o.total)', C.purple); N('fil', 'σ Filter', 'o.total > 100', C.good, 240); N('jn', '⋈ Join', 'u.id = o.user_id', L.planning); N('u', 'Scan users', '1M rows', L.storage, 240); N('o', 'Scan orders', '10M rows', L.storage, 240);
    // row-count packets
    const rc = (x, y, str, c, a = 1) => text(ctx, str, x, y, { size: 22, mono: true, color: c, alpha: a, weight: 700 });
    // right panel
    const rx = 1180; box(ctx, { x: rx, y: 190, w: 640, h: 540, color: L.planning, alpha: p(t, 38, 38.8), r: 14 });
    text(ctx, 'Rows reaching the join', rx + 30, 240, { size: 28, color: L.planning, alpha: p(t, 38.3, 39) });
    const b1 = 11, b2 = 1 + 1.2; // millions
    const val = lerp(11, 2.2, m);
    text(ctx, `${val.toFixed(1)} M`, rx + 320, 380, { size: 120, color: m > .5 ? C.good : C.bad, align: 'center', mono: true, glow: 20, alpha: p(t, 38.3, 39) });
    bar(ctx, rx + 40, 440, 560, 26, val / 11, m > .5 ? C.good : C.bad);
    text(ctx, 'before: 1M users + 10M orders', rx + 40, 520, { size: 24, color: C.dim, alpha: 1 - m * .7 });
    text(ctx, 'after:  1M users + 1.2M orders (o.total>100)', rx + 40, 560, { size: 24, color: C.good, alpha: p(t, 43, 44) });
    text(ctx, 'same result · ~5× less join work', rx + 40, 640, { size: 28, color: C.fg, weight: 700, alpha: p(t, 44.5, 45.5) });
    text(ctx, 'other rewrites: constant folding · projection pruning · subquery unnesting', rx + 40, 690, { size: 20, color: C.dim, alpha: p(t, 46, 47) });
    // flowing packets along the o edge
    const oEdge = [[P.o[0], P.o[1] - 38], [P.fil[0], P.fil[1] + 38]];
    for (let i = 0; i < 4; i++) packet(ctx, [[P.o[0], P.o[1] - 38], [m > .5 ? P.fil[0] : P.jn[0] + 80, m > .5 ? P.fil[1] + 38 : P.jn[1] + 38]], ((t * .6 + i / 4) % 1), { color: C.accent, size: 6, trail: .06, alpha: p(t, 38, 39) });
    ctx.restore();
  }
}
function bar(ctx, x, y, w, h, v, color) { ctx.save(); rrect(ctx, x, y, w, h, h / 2); ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill(); rrect(ctx, x, y, Math.max(h, w * clamp(v)), h, h / 2); ctx.fillStyle = color; ctx.fill(); ctx.restore(); }
