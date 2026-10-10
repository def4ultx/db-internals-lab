// internals-E2: router-coordinator (Vitess vtgate -> vttablet) and sharding (hash / range / consistent-hash ring / directory vindex)
import * as THREE from 'three';
import { makeKit, C } from './_dist-kit.js';

const hex2 = (n) => n.toString(16).padStart(2, '0');
const hash32 = (x) => { x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return (x ^ (x >>> 16)) >>> 0; };

// ============================================================================================
// router-coordinator
// ============================================================================================
const SHARDS = ['-40', '40-80', '80-c0', 'c0-'];
const SHARD_Y = [4.2, 1.4, -1.4, -4.2];
const NAMES = ['bob', 'alice', 'bob', 'carol'];
const USERS = Array.from({ length: 32 }, (_, i) => {
  const id = i + 1;
  return { id, name: NAMES[(id * 5) % 4], created: (id * 53) % 97, email: `u${id}@x.com` };
});
// Vitess "hash" vindex = 3DES of the 64-bit id -> keyspace_id. We use a multiplicative hash to a 1-byte keyspace_id prefix.
const ksHash = (id) => (Math.imul(id, 2654435761) >>> 24) & 255;
const ksRange = (id) => (id * 8) & 255; // "numeric"/range-style vindex: sequential ids stay together
const shardOf = (ks) => ks >> 6;
USERS.forEach(u => { u.ks = ksHash(u.id); u.shard = shardOf(u.ks); });

const QUERIES = [
  { id: 'point', label: 'Point read (id=?, hash vindex)' },
  { id: 'insert', label: 'INSERT (single shard + replica ship)' },
  { id: 'lookup', label: 'Secondary vindex (email=?)' },
  { id: 'in', label: 'IN (3,9,14,27): subset of shards' },
  { id: 'scatter', label: 'Scatter: name=\'bob\' (no vindex)' },
  { id: 'orderlimit', label: 'Scatter ORDER BY created DESC LIMIT 3' },
  { id: 'agg', label: 'Scatter GROUP BY name COUNT(*)' },
];

function buildRouter(ctx) {
  const kit = makeKit(ctx);
  const { group } = kit;
  const cfg = () => ctx.config || {};
  const S = { q: 'point', id: 21, readReplica: false, fail: false, run: 0, role: [0, 0, 0, 0], busy: false }; // role[s]: 0 = main box is primary, 1 = replica box promoted
  const posV = { client: [-9.8, 0, 0], gate: [-4, 0, 0], topo: [-4, 5.4, 0], lookup: [-4, -5.4, 0], merge: [-4, -2.5, 0.6] };

  // client
  const client = kit.box(2, 1.4, 1, C.blue, posV.client); client.userData.base = C.blue;
  kit.text('client\n(mysql proto)', { size: 0.35, color: '#fff' }, [posV.client[0], posV.client[1], 0.7]);
  const resultLbl = kit.text('', { size: 0.34, color: C.green, align: 'left' }, [posV.client[0], -1.7, 0.7]);

  // vtgate container + stages
  const gate = kit.box(5, 8.2, 0.6, 0x232840, [posV.gate[0], 0, -0.3]);
  kit.text('vtgate (stateless router)', { size: 0.4, color: C.orange }, [posV.gate[0], 3.75, 0.2]);
  const stage = {};
  [['parse', 'sqlparser -> AST', 2.4], ['plan', 'planner (Gen4): pick Route', 0.9], ['vindex', 'vindex: col -> keyspace_id', -0.6], ['merge', 'merge-sort / aggregate', -2.1]].forEach(([k, t, y]) => {
    const m = kit.box(4.4, 1.0, 0.5, 0x2e3556, [posV.gate[0], y, 0.1]); m.userData.base = 0x2e3556;
    kit.text(t, { size: 0.3, color: C.text }, [posV.gate[0], y + 0.32, 0.45]);
    stage[k] = { m, note: kit.text('', { size: 0.28, color: C.yellow }, [posV.gate[0], y - 0.22, 0.45]) };
  });
  const topo = kit.box(4, 0.9, 0.5, 0x3a3320, posV.topo);
  kit.text('topo (etcd/ZK): VSchema, shard map,\ntablet health stream', { size: 0.28, color: C.yellow }, [posV.topo[0], posV.topo[1], 0.4]);
  kit.line([[posV.topo[0], posV.topo[1] - 0.45, 0], [posV.gate[0], 4.1, 0]], C.yellow);
  const lookup = kit.box(4, 0.9, 0.5, 0x2a3a3a, posV.lookup);
  kit.text('lookup vindex table\nuser_email_idx(email -> keyspace_id)', { size: 0.26, color: C.cyan }, [posV.lookup[0], posV.lookup[1], 0.4]);
  kit.line([[posV.gate[0], -4.1, 0], [posV.lookup[0], posV.lookup[1] + 0.45, 0]], C.cyan);

  kit.line([[-8.8, 0, 0], [-6.5, 0, 0]], C.line);

  // shards
  const sh = SHARDS.map((name, s) => {
    const y = SHARD_Y[s];
    const tab = kit.box(2.4, 1.2, 0.8, 0x2d4a3a, [3.4, y, 0]); tab.userData.base = 0x2d4a3a;
    const db = kit.cyl(0.8, 1.2, 0x34415f, [6.6, y, 0]); db.userData.base = 0x34415f;
    const rep = kit.box(1.8, 1.0, 0.7, 0x2d3a4a, [9.5, y, 0]); rep.userData.base = 0x2d3a4a;
    const tl = kit.text('', { size: 0.3, color: '#fff' }, [3.4, y, 0.5]);
    const rl = kit.text('', { size: 0.27, color: '#fff' }, [9.5, y, 0.45]);
    const dl = kit.text('', { size: 0.28, color: C.dim }, [6.6, y - 1.1, 0]);
    kit.text(`shard ${name}`, { size: 0.32, color: C.orange }, [3.4, y + 0.95, 0]);
    kit.text('mysqld', { size: 0.26, color: C.dim }, [6.6, y + 0.9, 0]);
    kit.line([[1.9, 0, 0], [2.0, y, 0]].map((p, i) => i ? [2.2, y, 0] : [-1.5, 0, 0]), C.line, { opacity: 0.35 });
    kit.line([[4.6, y, 0], [5.8, y, 0]], C.line);
    kit.line([[7.4, y, 0], [8.6, y, 0]], C.line);
    const rows = USERS.filter(u => u.shard === s).length;
    dl.set(`${rows} rows`);
    return { tab, db, rep, tl, rl, dl, y };
  });
  kit.line([[-1.5, 4.2, 0], [-1.5, -4.2, 0]], C.line, { opacity: 0.35 });
  const tabPos = (s) => [3.4, SHARD_Y[s], 0];
  const repPos = (s) => [9.5, SHARD_Y[s], 0];
  const primaryBox = (s) => (S.role[s] === 0 ? 'tab' : 'rep');
  const refreshRoles = () => {
    sh.forEach((x, s) => {
      const failed = S.fail && s === 2;
      const mainIsPrimary = S.role[s] === 0;
      const t1 = mainIsPrimary ? 'PRIMARY' : 'REPLICA';
      x.tl.set(`vttablet\n${failed && mainIsPrimary ? 'DOWN' : t1}`, failed && mainIsPrimary ? C.red : '#fff');
      x.rl.set(`vttablet\n${mainIsPrimary ? 'REPLICA' : 'PRIMARY'}`, '#fff');
      kit.setColor(x.tab, failed && mainIsPrimary ? 0x7a2a3a : (mainIsPrimary ? 0x2d4a3a : 0x2d3a4a));
      kit.setColor(x.rep, !mainIsPrimary ? 0x2d4a3a : 0x2d3a4a);
      if (failed && !mainIsPrimary) kit.setColor(x.tab, 0x7a2a3a);
      x.tab.userData.base = x.tab.material.color.getHex(); x.rep.userData.base = x.rep.material.color.getHex();
    });
  };
  const flash = (mesh, color = C.yellow, dur = 0.7) => { kit.glow(mesh, color, 0.9); kit.after(dur, () => { mesh.material.emissive.set(0); }); };
  const vkind = () => (cfg().sharding === 'range' ? 'range' : cfg().sharding === 'directory-vindex' ? 'lookup' : 'hash');
  const ksOf = (id) => (vkind() === 'range' ? ksRange(id) : ksHash(id));
  const shOfId = (id) => shardOf(ksOf(id));

  const infoHtml = (html) => ctx.onInfo && ctx.onInfo(html);

  // ---- plan builder (real data, real routing) ----
  function plan() {
    const id = S.id;
    const vk = vkind();
    const vname = vk === 'range' ? 'range-style vindex (ks = id*8)' : vk === 'lookup' ? 'lookup vindex (directory)' : 'hash vindex (3DES(id) -> keyspace_id)';
    const p = { sql: '', route: '', vstep: '', targets: [], reply: {}, mergeTxt: '', result: '', write: false, lookupHop: false, topK: false };
    const rowsOf = (s) => USERS.filter(u => u.shard === s);
    switch (S.q) {
      case 'point': {
        const u = USERS.find(x => x.id === id) || { id, name: '-', ks: ksOf(id) };
        const ks = ksOf(id); const s = shardOf(ks);
        p.sql = `SELECT name FROM user WHERE id = ${id}`;
        p.route = 'Route: EqualUnique'; p.lookupHop = vk === 'lookup';
        p.vstep = `${vk === 'lookup' ? 'lookup' : vk}(${id}) = 0x${hex2(ks)} -> ${SHARDS[s]}`;
        p.targets = [s]; p.reply[s] = '1 row';
        p.mergeTxt = 'passthrough'; p.result = `name = '${(USERS.find(x => x.id === id) || {}).name}'`;
        break;
      }
      case 'insert': {
        const ks = ksOf(id); const s = shardOf(ks);
        p.sql = `INSERT INTO user(id,name) VALUES (${id},'zed')`; p.write = true;
        p.route = 'Route: EqualUnique (DML)'; p.vstep = `${vk}(${id}) = 0x${hex2(ks)} -> ${SHARDS[s]}`;
        p.targets = [s]; p.reply[s] = 'OK 1'; p.mergeTxt = 'passthrough'; p.result = 'OK, 1 row affected';
        break;
      }
      case 'lookup': {
        const u = USERS.find(x => x.id === id) || USERS[0];
        p.sql = `SELECT * FROM user WHERE email='${u.email}'`; p.lookupHop = true;
        p.route = 'Route: EqualUnique (lookup)';
        p.vstep = `lookup(${u.email}) -> ks 0x${hex2(u.ks)} -> ${SHARDS[u.shard]}`;
        p.targets = [u.shard]; p.reply[u.shard] = '1 row'; p.mergeTxt = 'passthrough'; p.result = `id=${u.id} name='${u.name}'`;
        break;
      }
      case 'in': {
        const ids = [3, 9, 14, 27]; p.sql = 'SELECT * FROM user WHERE id IN (3,9,14,27)';
        const by = {}; ids.forEach(i => { const s = shOfId(i); (by[s] = by[s] || []).push(i); });
        p.route = 'Route: IN (SubShard)'; p.vstep = ids.map(i => `${i}->0x${hex2(ksOf(i))}`).join(' ');
        p.targets = Object.keys(by).map(Number); p.targets.forEach(s => { p.reply[s] = `${by[s].length} row`; });
        p.mergeTxt = `concat ${ids.length} rows`; p.result = `${ids.length} rows from ${p.targets.length} shard(s)`;
        break;
      }
      case 'scatter': {
        p.sql = "SELECT * FROM user WHERE name='bob'"; p.route = 'Route: Scatter (no vindex on name)';
        p.vstep = 'no vindex -> all 4 shards'; p.targets = [0, 1, 2, 3];
        let tot = 0; p.targets.forEach(s => { const n = rowsOf(s).filter(u => u.name === 'bob').length; p.reply[s] = `${n} rows`; tot += n; });
        p.mergeTxt = `concat -> ${tot} rows`; p.result = `${tot} rows (latency = slowest shard)`;
        break;
      }
      case 'orderlimit': {
        p.sql = 'SELECT id,created FROM user ORDER BY created DESC LIMIT 3'; p.route = 'Route: Scatter + MergeSort(created DESC) + Limit 3';
        p.vstep = 'each shard: ORDER BY .. LIMIT 3 (pushed down)'; p.targets = [0, 1, 2, 3]; p.topK = true;
        let all = [];
        p.targets.forEach(s => { const r = rowsOf(s).sort((a, b) => b.created - a.created).slice(0, 3); p.reply[s] = 'top3: ' + r.map(u => u.created).join(','); all = all.concat(r); });
        all.sort((a, b) => b.created - a.created); const top = all.slice(0, 3);
        p.mergeTxt = `k-way merge 12 -> LIMIT 3`; p.result = 'created: ' + top.map(u => u.created).join(', ');
        break;
      }
      case 'agg': {
        p.sql = 'SELECT name, COUNT(*) FROM user GROUP BY name'; p.route = 'Route: Scatter + Ordered/Hash Aggregate (SUM of COUNT)';
        p.vstep = 'push down partial GROUP BY'; p.targets = [0, 1, 2, 3];
        const tot = {};
        p.targets.forEach(s => { const c = {}; rowsOf(s).forEach(u => { c[u.name] = (c[u.name] || 0) + 1; tot[u.name] = (tot[u.name] || 0) + 1; }); p.reply[s] = Object.entries(c).map(([k, v]) => `${k[0]}${v}`).join(' '); });
        p.mergeTxt = 'SUM partial counts'; p.result = Object.entries(tot).map(([k, v]) => `${k}:${v}`).join(' ');
        break;
      }
    }
    return p;
  }

  function stageNote(k, t, color = C.yellow) { stage[k].note.set(t, color); }
  function resetStages() { Object.keys(stage).forEach(k => { stage[k].note.set(' '); kit.setColor(stage[k].m, stage[k].m.userData.base); }); resultLbl.set(' '); }

  function runQuery() {
    const my = ++S.run; kit.clearTimers(); resetStages(); refreshRoles();
    const p = plan(); const alive = () => S.run === my;
    const isRead = !p.write;
    const useRep = S.readReplica && isRead;
    infoHtml(`<b>vtgate query</b><br><code>${p.sql}</code><br>Step 1: client -> vtgate (MySQL wire protocol, ~0.1 ms)`);
    kit.send(posV.client, [posV.gate[0] - 2.5, 0.0, 0], { color: C.blue, dur: 0.9, label: 'SQL', size: 0.2 });
    kit.after(0.9, () => { if (!alive()) return; flash(stage.parse.m, C.purple, 0.6); stageNote('parse', p.sql.length > 34 ? p.sql.slice(0, 33) + '..' : p.sql); infoHtml(`<b>Parse</b>: ${p.sql}<br>AST built with vitess sqlparser (yacc, ~10 us). Plan cache keyed by normalized SQL.`); });
    kit.after(1.6, () => { if (!alive()) return; flash(stage.plan.m, C.yellow, 0.6); stageNote('plan', p.route.replace('Route: ', '')); infoHtml(`<b>Plan</b>: ${p.route}<br>Planner consults VSchema (cached from topo): table <code>user</code> has Primary vindex <code>hash(id)</code>, secondary lookup vindex on <code>email</code>.`); });
    let t = 2.3;
    kit.after(t, () => { if (!alive()) return; flash(stage.vindex.m, C.green, 0.8); stageNote('vindex', p.vstep, C.green); infoHtml(`<b>Vindex</b>: ${p.vstep}<br>keyspace_id (1st byte shown) falls into one shard key range: -40 | 40-80 | 80-c0 | c0-. ${p.targets.length} of 4 shards targeted.`); });
    t += 0.8;
    if (p.lookupHop) {
      const lt = t;
      kit.after(lt, () => { if (!alive()) return; kit.send([posV.gate[0], -2.8, 0], posV.lookup, { color: C.cyan, dur: 0.7, label: 'lookup', size: 0.2 }); infoHtml('<b>Lookup vindex</b>: extra hop: SELECT keyspace_id FROM user_email_idx WHERE email=? (itself a sharded table; adds ~1 RTT).'); });
      kit.after(lt + 0.7, () => { if (!alive()) return; flash(lookup, C.cyan, 0.5); kit.send(posV.lookup, [posV.gate[0], -2.8, 0], { color: C.cyan, dur: 0.7, label: 'ks', size: 0.2 }); });
      t += 1.5;
    }
    // buffering/failover
    const needFailover = S.fail && p.targets.includes(2) && S.role[2] === 0 && !useRep;
    if (needFailover) {
      kit.after(t, () => { if (!alive()) return; stageNote('plan', 'primary 80-c0 unhealthy: BUFFER', C.red); infoHtml('<b>Failover</b>: vtgate tablet-health stream shows 80-c0 has no PRIMARY. With --enable_buffer it buffers the query instead of failing while orchestrator/vtorc runs EmergencyReparentShard.'); });
      t += 1.6;
      kit.after(t, () => { if (!alive()) return; S.role[2] = 1; refreshRoles(); flash(sh[2].rep, C.green, 0.8); infoHtml('<b>Failover done</b>: replica promoted to PRIMARY (new term in topo). Buffered query is released to the new primary; clients see only added latency.'); });
      t += 0.6;
    }
    let pending = p.targets.length;
    p.targets.forEach((s, ti) => {
      kit.after(t + ti * 0.05, () => {
        if (!alive()) return;
        const box = useRep ? 'rep' : primaryBox(s);
        const dest = box === 'tab' ? tabPos(s) : repPos(s);
        const from = [posV.gate[0] + 2.5, SHARD_Y[s] * 0.2, 0];
        kit.send(from, [dest[0] - 1.1, dest[1], 0], { color: C.orange, dur: 1.0, label: p.write ? 'DML' : 'SELECT', size: 0.2, onArrive: () => {
          if (!alive()) return; flash(sh[s][box], C.orange, 0.8); flash(sh[s].db, C.orange, 0.8);
          kit.after(0.8, () => {
            if (!alive()) return;
            kit.send([dest[0] - 1.1, dest[1], 0], [posV.gate[0] + 2.5, SHARD_Y[s] * 0.2, 0], { color: C.green, dur: 1.0, label: p.reply[s], size: 0.2, onArrive: () => {
              if (!alive()) return; if (--pending === 0) done(); } });
            if (p.write && !useRep) kit.send([dest[0] + 1.0, dest[1], 0], [repPos(s)[0] - 1, dest[1], 0], { color: C.red, dur: 1.2, label: 'binlog', size: 0.16 });
          });
        } });
      });
    });
    function done() {
      flash(stage.merge.m, C.green, 0.9); stageNote('merge', p.mergeTxt, C.green);
      infoHtml(`<b>Merge</b>: ${p.mergeTxt}<br>${p.targets.length > 1 ? `Scatter-gather: vtgate waits for ALL ${p.targets.length} shards; one slow shard slows the query. Memory = sum of partial results.` : 'Single-shard route: no merge, pure proxy. This is why choosing the sharding key = the most common WHERE column matters.'}`);
      kit.after(0.9, () => { if (!alive()) return; kit.send([posV.gate[0] - 2.5, 0, 0], [posV.client[0] + 1, 0, 0], { color: C.green, dur: 0.9, label: 'rows', size: 0.2, onArrive: () => { resultLbl.set(p.result, C.green); flash(client, C.green, 0.6); infoHtml(`<b>Result</b>: ${p.result}<br>${p.route}`); } }); });
    }
  }

  refreshRoles();
  infoHtml('<b>router-coordinator</b>: vtgate speaks MySQL protocol to clients, consults the VSchema, and routes to vttablets (one per mysqld). Press <i>Run query</i> or Next.');

  const steps = [
    { title: 'Topology', text: 'Clients see ONE MySQL endpoint (vtgate). VSchema + shard map live in topo (etcd). vtgate is stateless; vttablets sit in front of each mysqld.', run() { S.q = 'point'; resetStages(); kit.clearTimers(); S.run++; refreshRoles(); flash(topo, C.yellow, 1.5); infoHtml('<b>Topology</b>: 4 shards by keyspace_id range. Each shard = primary vttablet+mysqld and replicas. vtgate gets the VSchema and a tablet health stream from topo.'); } },
    { title: 'Point query via vindex', text: 'hash vindex maps id -> keyspace_id -> shard. One shard touched.', run() { S.q = 'point'; S.id = 21; runQuery(); } },
    { title: 'Secondary (lookup) vindex', text: 'WHERE email=? has no hash of id; a lookup table maps email -> keyspace_id first (extra hop) but stays single-shard.', run() { S.q = 'lookup'; runQuery(); } },
    { title: 'Scatter-gather', text: 'No vindex on name: fan out to all shards, concatenate.', run() { S.q = 'scatter'; runQuery(); } },
    { title: 'Merge sort + LIMIT', text: 'Each shard returns its top 3; vtgate merges 12 rows to 3.', run() { S.q = 'orderlimit'; runQuery(); } },
    { title: 'Primary failure', text: 'Primary of 80-c0 dies: vtgate buffers, replica is promoted, query completes.', run() { S.fail = true; S.role[2] = 0; S.q = 'insert'; S.id = 70; S.id = 53; runQuery(); } },
  ];

  return {
    group, steps, kit,
    api: { S, runQuery, refreshRoles },
    update(dt) { kit.update(dt); },
    dispose() { S.run++; kit.dispose(); },
    onConfigChange() { infoHtml(`<b>Vindex mode</b>: ${vkind()}. Re-run the query to see routing change.`); },
  };
}

let curRouter = null;
const routerView = {
  build(ctx) { const v = buildRouter(ctx); curRouter = v; return v; },
  controls: [
    { id: 'rc-query', label: 'Query', type: 'select', options: QUERIES.map(q => ({ value: q.id, label: q.label })), value: 'point', onChange(v) { if (curRouter) curRouter.api.S.q = v; } },
    { id: 'rc-id', label: 'id / key (1..32)', type: 'range', min: 1, max: 32, value: 21, step: 1, onChange(v) { if (curRouter) curRouter.api.S.id = +v; } },
    { id: 'rc-run', label: 'Run query', type: 'button', onChange() { curRouter && curRouter.api.runQuery(); } },
    { id: 'rc-replica', label: 'Reads @replica', type: 'toggle', value: false, onChange(v) { if (curRouter) curRouter.api.S.readReplica = !!v; } },
    { id: 'rc-fail', label: 'Fail primary of 80-c0', type: 'toggle', value: false, onChange(v) { if (curRouter) { const S = curRouter.api.S; S.fail = !!v; if (!v) S.role[2] = 0; curRouter.api.refreshRoles(); } } },
  ],
};

// ============================================================================================
// sharding
// ============================================================================================
const NODE_COL = [0x7aa2f7, 0x9ece6a, 0xff9e64, 0xbb9af7, 0x2ac3de, 0xe0af68];
const NODE_NAME = ['A', 'B', 'C', 'D', 'E', 'F'];
const H = 1024; // hash space

function buildSharding(ctx) {
  const kit = makeKit(ctx);
  const { group } = kit;
  const MAXN = 6, NKEYS = 78, BASE = 48;
  const S = { N: 3, vn: 4, extra: [0, 0, 0, 0, 0, 0], mode: null, splits: [], dir: [], hotInjected: false, lastMoved: null, note: '' };
  const modeCfg = () => (ctx.config && ctx.config.sharding) || 'hash';
  S.mode = modeCfg();

  // keys
  const keys = [];
  for (let i = 0; i < NKEYS; i++) {
    const nat = i < BASE ? Math.floor(hash32(i * 977 + 5) % 900) : 900 + (i - BASE) * 3 + 1; // hot keys: monotonically increasing ids
    keys.push({ i, nat, h: hash32(nat * 31 + 7) & (H - 1), owner: 0, shown: 0, active: i < BASE, mesh: null, target: new THREE.Vector3(), hot: i >= BASE });
  }
  const geoK = kit.track(new THREE.SphereGeometry(0.16, 10, 8));
  const geoB = kit.track(new THREE.BoxGeometry(1, 1, 1));
  const nodeMats = NODE_COL.map(c => kit.track(new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 })));
  const matWhite = kit.track(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8 }));
  const matLine = kit.track(new THREE.MeshBasicMaterial({ color: 0x59628a }));
  const matDim = kit.track(new THREE.MeshStandardMaterial({ color: 0x2a2f48 }));
  const segMats = NODE_COL.map(c => kit.track(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35 })));
  const ringGeo = kit.track(new THREE.TorusGeometry(3, 0.04, 6, 96));
  keys.forEach(k => { k.mesh = new THREE.Mesh(geoK, nodeMats[0]); k.mesh.visible = k.active; group.add(k.mesh); });

  const struct = new THREE.Group(); group.add(struct);
  const nodeG = new THREE.Group(); group.add(nodeG);
  const title = kit.text('', { size: 0.42, color: C.orange }, [0, 5.9, 0]);
  const formula = kit.text('', { size: 0.3, color: C.text }, [0, 5.35, 0]);
  const mk = (geo, mat, pos, scale, parent = struct) => { const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.scale.set(...scale); parent.add(m); return m; };
  const lab = (t, o, pos, parent = struct) => { const s = ctx.makeLabel(t, o); s.position.set(...pos); parent.add(s); return s; };

  // ---- ownership ----
  const tokens = () => { // ring tokens sorted
    const t = [];
    for (let n = 0; n < S.N; n++) { const c = S.vn + S.extra[n]; for (let v = 0; v < c; v++) t.push({ pos: hash32(n * 7919 + v * 104729 + 13) & (H - 1), n, v }); }
    return t.sort((a, b) => a.pos - b.pos);
  };
  const ownerOf = (k, tk) => {
    switch (S.mode) {
      case 'range': { let o = S.splits[0].node; for (const r of S.splits) if (k.nat >= r.lo) o = r.node; return o; }
      case 'consistent-hash': { tk = tk || tokens(); for (const t of tk) if (t.pos >= k.h) return t.n; return tk[0].n; }
      case 'directory-vindex': return S.dir[k.i];
      default: return k.h % S.N;
    }
  };
  const active = () => keys.filter(k => k.active);
  const counts = () => { const c = new Array(MAXN).fill(0); active().forEach(k => c[k.owner]++); return c; };
  const recompute = () => { const tk = S.mode === 'consistent-hash' ? tokens() : null; active().forEach(k => { k.owner = ownerOf(k, tk); }); };
  function initMode() {
    S.extra = [0, 0, 0, 0, 0, 0]; S.lastMoved = null;
    if (S.mode === 'range') S.splits = Array.from({ length: S.N }, (_, n) => ({ lo: Math.floor(n * 1000 / S.N), node: n }));
    if (S.mode === 'directory-vindex') keys.forEach(k => { S.dir[k.i] = k.h % S.N; });
    recompute();
    keys.forEach(k => { k.shown = k.owner; k.mesh.material = nodeMats[k.owner]; });
  }

  // ---- layout targets ----
  const nodeX = (n) => (n - (S.N - 1) / 2) * 3.0;
  function layoutTargets() {
    const a = active();
    const cnt = {};
    a.forEach((k, idx) => {
      if (S.mode === 'consistent-hash') {
        const th = k.h / H * Math.PI * 2; const r = 2.4;
        k.target.set(RING.x + r * Math.sin(th), RING.y + r * Math.cos(th), 0.2);
      } else if (S.mode === 'range' || S.mode === 'directory-vindex') {
        const row = (k.i % 3); k.target.set(-9 + k.nat / 1000 * 18, 2.2 + row * 0.42, 0.2);
      } else {
        const row = (k.i % 3); k.target.set(-9 + k.h / (H - 1) * 18, 2.2 + row * 0.42, 0.2);
      }
    });
  }
  const RING = { x: 0, y: 2.0 };

  function drawStruct() {
    kit.clear(struct);
    const tk = S.mode === 'consistent-hash' ? tokens() : null;
    const cnt = counts();
    if (S.mode === 'hash') {
      title.set('HASH (mod N) sharding', C.orange); formula.set(`owner = hash(key) mod N   (N=${S.N})   x-axis: hash(key) 0..${H - 1}`);
      mk(geoB, matLine, [0, 1.6, 0], [18.2, 0.04, 0.04]);
      for (let h = 0; h < 36; h++) { // stripe of owner(h mod N)
        const hv = (h + 0.5) * H / 36; mk(geoB, segMats[Math.floor(hv) % S.N], [-9 + (h + 0.5) * 0.5, 1.35, 0], [0.5, 0.3, 0.05]);
      }
      lab(`stripes show hash mod ${S.N}: ownership interleaves, so range scans hit every node`, { size: 0.28, color: C.dim }, [0, 0.9, 0]);
    } else if (S.mode === 'range') {
      title.set('RANGE sharding', C.orange); formula.set('owner = range containing key (sorted split points); x-axis: key 0..999');
      const sp = S.splits.slice().sort((a, b) => a.lo - b.lo);
      sp.forEach((r, idx) => {
        const lo = r.lo, hi = idx + 1 < sp.length ? sp[idx + 1].lo : 1000;
        const x0 = -9 + lo / 1000 * 18, x1 = -9 + hi / 1000 * 18;
        mk(geoB, segMats[r.node], [(x0 + x1) / 2, 1.6, 0], [x1 - x0 - 0.04, 0.35, 0.05]);
        mk(geoB, matLine, [x0, 2.45, 0], [0.04, 1.8, 0.04]);
        lab(`${lo}`, { size: 0.26, color: C.dim }, [x0 + 0.3, 3.7, 0]);
      });
      lab('range scans & ORDER BY stay on one node; monotonic keys => hot tail range', { size: 0.28, color: C.dim }, [0, 0.9, 0]);
    } else if (S.mode === 'consistent-hash') {
      title.set('CONSISTENT-HASH ring + virtual nodes', C.orange);
      formula.set(`owner = first vnode token clockwise from hash(key);  ${S.N} nodes x ${S.vn} vnodes = ${tk.length} tokens`);
      mk(ringGeo, matLine, [RING.x, RING.y, 0], [1, 1, 1]).scale.setScalar(2.9 / 3);
      tk.forEach(t => { const th = t.pos / H * Math.PI * 2; const r = 2.9; const m = mk(geoB, nodeMats[t.n], [RING.x + r * Math.sin(th), RING.y + r * Math.cos(th), 0.05], [0.14, 0.4, 0.2]); m.rotation.z = -th; });
      // token table on the right
      const rows = tk.slice(0, 14).map(t => `${String(t.pos).padStart(4)} -> ${NODE_NAME[t.n]}#${t.v}`);
      lab('token ring (pos -> node#vnode)\n' + rows.join('\n') + (tk.length > 14 ? `\n... +${tk.length - 14} more` : ''), { size: 0.25, color: C.dim, align: 'left' }, [7.2, 2.3, 0]);
      lab('hash(key) -> walk clockwise\nto next vnode token', { size: 0.27, color: C.dim }, [-6.5, 2.5, 0]);
    } else {
      title.set('DIRECTORY / lookup-vindex sharding', C.orange); formula.set('owner = lookup_table[key]  (explicit key -> shard map; flexible, but lookup = extra hop + metadata size)');
      mk(geoB, matDim, [0, 3.4, -0.2], [18.4, 2.1, 0.1]);
      const sample = active().slice(0, 6).map(k => `user:${k.nat} -> ${NODE_NAME[k.owner]}`).join('    ');
      lab('lookup table (cached in vtgate):\n' + sample + '    ... ' + active().length + ' entries', { size: 0.28, color: C.text }, [0, 3.45, 0.0]);
      lab('x-axis: key; color = explicit owner (not contiguous, not hashed)', { size: 0.27, color: C.dim }, [0, 0.95, 0]);
    }
    // node row
    kit.clear(nodeG);
    const mx = Math.max(1, ...cnt.slice(0, S.N));
    const total = active().length;
    for (let n = 0; n < S.N; n++) {
      const x = nodeX(n);
      mk(geoB, nodeMats[n], [x, -4.4, 0], [2.2, 0.35, 1.2], nodeG);
      const hgt = Math.max(0.05, cnt[n] * 0.085);
      const bar = mk(geoB, segMats[n], [x, -4.2 + hgt / 2, 0], [1.2, hgt, 0.8], nodeG); bar.material = segMats[n];
      const share = total ? Math.round(cnt[n] / total * 100) : 0;
      lab(`node ${NODE_NAME[n]}\n${cnt[n]} keys (${share}%)`, { size: 0.3, color: '#fff' }, [x, -5.35, 0.5], nodeG);
    }
    if (S.mode === 'consistent-hash') { /* ring keys sit inside the tokens */ }
    refreshInfo(cnt, total);
  }

  function refreshInfo(cnt, total) {
    const mean = total / S.N; const mx = Math.max(...cnt.slice(0, S.N));
    const imb = (mx / mean).toFixed(2);
    const moved = S.lastMoved ? `<br><b>Last op moved ${S.lastMoved.n}/${total} keys = ${(S.lastMoved.n / total * 100).toFixed(0)}%</b> (${S.lastMoved.what}). Ideal minimum ~ 1/N = ${(100 / S.N).toFixed(0)}%.` : '';
    const why = {
      'hash': 'owner = hash mod N. Even spread, but changing N remaps ~N/(N+1) of keys (a full reshard). Range scans touch every node.',
      'range': 'Sorted split points. Efficient range scans; hot-spots with monotonic keys (timestamps/auto-inc): the last range takes all writes. Fix = split the range and move half.',
      'consistent-hash': 'Keys & vnode tokens share one ring. Adding a node steals only the arcs before its tokens: ~1/(N+1) of keys move. More vnodes per node = smoother balance (Dynamo, Cassandra, Memcached ketama).',
      'directory-vindex': 'An explicit lookup table decides placement (Vitess lookup vindex, MongoDB chunk map, HBase meta). Rebalancing is surgical: move exactly the entries you choose. Cost: extra lookup hop and table to keep consistent.',
    }[S.mode];
    ctx.onInfo && ctx.onInfo(`<b>${S.mode}</b> (N=${S.N}, ${total} keys, imbalance max/mean = ${imb}) <br>${why}${moved}${S.note ? '<br>' + S.note : ''}`);
  }

  // ---- ops ----
  function diffAndMove(what) {
    const before = active().map(k => k.owner);
    recompute();
    let moved = 0; const a = active();
    a.forEach((k, idx) => {
      if (k.owner !== before[idx]) {
        moved++;
        const from = [nodeX(Math.min(before[idx], S.N - 1)), -4.0, 0.3], to = [nodeX(k.owner), -4.0, 0.3];
        k.mesh.material = matWhite;
        kit.send(from, to, { color: NODE_COL[k.owner], dur: 1.1, arc: 1.2 + (idx % 5) * 0.2, size: 0.12, onArrive: () => { k.shown = k.owner; k.mesh.material = nodeMats[k.owner]; } });
      } else { k.shown = k.owner; k.mesh.material = nodeMats[k.owner]; }
    });
    S.lastMoved = { n: moved, what };
    layoutTargets(); drawStruct();
  }
  function addNode() {
    if (S.N >= MAXN) { S.note = 'Max 6 nodes in this demo.'; drawStruct(); return; }
    S.note = ''; const oldN = S.N;
    if (S.mode === 'range') { // split the heaviest range at its median key; upper half -> new node
      const cnt = {}; active().forEach(k => { const r = rangeIdx(k); (cnt[r] = cnt[r] || []).push(k); });
      let best = null; Object.entries(cnt).forEach(([r, ks]) => { if (!best || ks.length > best.ks.length) best = { r: +r, ks }; });
      splitRange(best, S.N); S.N++;
      diffAndMove(`range split + new node ${NODE_NAME[S.N - 1]}`);
    } else if (S.mode === 'directory-vindex') {
      S.N++; diffAndMove(`new node ${NODE_NAME[S.N - 1]} joins empty: nothing moves until you Rebalance`);
    } else if (S.mode === 'consistent-hash') { S.N++; diffAndMove(`node ${NODE_NAME[S.N - 1]} steals arcs of its ${S.vn} vnodes`); }
    else { S.N++; diffAndMove(`mod ${oldN} -> mod ${S.N}: remap almost everything`); }
  }
  const rangeIdx = (k) => { let idx = 0; const sp = S.splits.slice().sort((a, b) => a.lo - b.lo); sp.forEach((r, i) => { if (k.nat >= r.lo) idx = i; }); return idx; };
  function splitRange(best, node) {
    const sp = S.splits.slice().sort((a, b) => a.lo - b.lo);
    const ks = best.ks.slice().sort((a, b) => a.nat - b.nat);
    const lo = sp[best.r].lo, hi = best.r + 1 < sp.length ? sp[best.r + 1].lo : 1000;
    const at = ks.length >= 2 ? ks[Math.floor(ks.length / 2)].nat : Math.floor((lo + hi) / 2);
    S.splits = sp.concat([{ lo: Math.max(lo + 1, at), node }]).sort((a, b) => a.lo - b.lo);
  }
  function injectHot() {
    keys.forEach(k => { if (k.hot) { k.active = true; k.mesh.visible = true; } });
    S.hotInjected = true; S.note = '30 sequential new keys (ids 901..988, like timestamps or auto-increment) arrive.';
    if (S.mode === 'directory-vindex') { // placement policy: least-loaded
      const c = counts(); keys.filter(k => k.hot).forEach(k => { const n = c.slice(0, S.N).indexOf(Math.min(...c.slice(0, S.N))); S.dir[k.i] = n; c[n]++; k.owner = n; });
    }
    const a = active(); a.forEach(k => { if (k.hot) { k.owner = ownerOf(k); k.shown = k.owner; k.mesh.material = nodeMats[k.owner]; k.mesh.position.set(k.target.x, 6.5, 0.2); } });
    S.lastMoved = null; layoutTargets(); drawStruct();
  }
  function rebalance() {
    const c = counts(); const total = active().length;
    const light = c.slice(0, S.N).indexOf(Math.min(...c.slice(0, S.N)));
    const heavy = c.slice(0, S.N).indexOf(Math.max(...c.slice(0, S.N)));
    if (S.mode === 'hash') { S.note = 'mod-N has no knob: only changing N (full reshard) rebalances. Hash already spreads sequential keys evenly; a single hot KEY would still pin one node.'; drawStruct(); return; }
    S.note = '';
    if (S.mode === 'range') {
      const cnt = {}; active().forEach(k => { const r = rangeIdx(k); (cnt[r] = cnt[r] || []).push(k); });
      let best = null; Object.entries(cnt).forEach(([r, ks]) => { if (!best || ks.length > best.ks.length) best = { r: +r, ks }; });
      splitRange(best, light); diffAndMove(`split heaviest range, upper half -> node ${NODE_NAME[light]}`);
    } else if (S.mode === 'consistent-hash') {
      S.extra[light] += S.vn; diffAndMove(`lightest node ${NODE_NAME[light]} gets +${S.vn} weighted vnodes`);
    } else {
      let guard = 0; const target = Math.floor(total / S.N);
      const dc = counts();
      const before = active().map(k => k.owner);
      while (guard++ < 200) {
        const cc = counts(); const l = cc.slice(0, S.N).indexOf(Math.min(...cc.slice(0, S.N))); const hv = cc.slice(0, S.N).indexOf(Math.max(...cc.slice(0, S.N)));
        if (cc[hv] - cc[l] <= 1) break;
        const k = active().find(k => k.owner === hv); S.dir[k.i] = l; k.owner = l;
      }
      active().forEach((k, i) => { k._ow = k.owner; k.owner = before[i]; });
      active().forEach((k, i) => { S.dir[k.i] = k._ow; });
      diffAndMove('explicit directory entries moved heavy -> light');
    }
  }

  // ---- lookup demo ----
  function lookupKey() {
    const a = active(); if (!a.length) return; const k = a[Math.floor(Math.random() * a.length)];
    k.mesh.material = matWhite;
    const to = nodeX(k.owner);
    kit.send([k.mesh.position.x, k.mesh.position.y, 0.3], [to, -3.8, 0.3], { color: 0xffffff, dur: 1.2, arc: 0.5, size: 0.2, label: `user:${k.nat}`, onArrive: () => { k.mesh.material = nodeMats[k.owner]; } });
    const how = { hash: `hash=${k.h}, ${k.h} mod ${S.N} = ${k.h % S.N}`, range: S.mode === 'range' ? `${k.nat} falls in range starting ${(S.splits.slice().sort((a, b) => a.lo - b.lo)[rangeIdx(k)] || S.splits[0]).lo}` : '', 'consistent-hash': `hash=${k.h}; next token clockwise belongs to ${NODE_NAME[k.owner]}`, 'directory-vindex': `lookup_table[user:${k.nat}] = ${NODE_NAME[k.owner]} (extra hop)` }[S.mode];
    ctx.onInfo(`<b>Route user:${k.nat}</b> -> node ${NODE_NAME[k.owner]}<br>${how}`);
  }
  function reset() { S.N = 3; S.hotInjected = false; S.note = ''; keys.forEach(k => { if (k.hot) { k.active = false; k.mesh.visible = false; } }); initMode(); layoutTargets(); drawStruct(); keys.forEach(k => k.mesh.position.copy(k.target)); }
  function setMode(m) { S.mode = m; reset(); }

  reset();

  kit.animate((dt) => {
    keys.forEach(k => { if (k.active) { k.mesh.position.lerp(k.target, Math.min(1, dt * 4)); } });
  });

  const steps = [
    { title: 'Key -> shard function', text: 'Every sharding scheme is a function key -> node. Colors show current ownership.', run() { S.note = ''; setMode(modeCfg()); lookupKey(); } },
    { title: 'Add a node: mod-N', text: 'hash mod N: N=3 -> 4 remaps ~75% of keys.', run() { setMode('hash'); addNode(); } },
    { title: 'Add a node: consistent ring', text: 'Ring + vnodes: only ~1/4 of keys move, all to the new node.', run() { setMode('consistent-hash'); addNode(); } },
    { title: 'Range hot-spot', text: 'Sequential keys all hit the last range.', run() { setMode('range'); injectHot(); } },
    { title: 'Rebalance by splitting', text: 'Split the hot range and move half to the lightest node.', run() { rebalance(); } },
    { title: 'Directory: surgical moves', text: 'Lookup table lets you move exactly the entries you pick.', run() { setMode('directory-vindex'); addNode(); kit.after(1.5, rebalance); } },
  ];

  return {
    group, steps,
    api: { addNode, injectHot, rebalance, reset, lookupKey, S, setVn(v) { S.vn = v; S.extra = [0, 0, 0, 0, 0, 0]; if (S.mode === 'consistent-hash') diffAndMove(`vnodes per node = ${v}`); } },
    update(dt) { kit.update(dt); },
    dispose() { kit.clear(struct); kit.clear(nodeG); kit.dispose(); },
    onConfigChange() { if (modeCfg() !== S.mode) setMode(modeCfg()); },
  };
}

let curSh = null;
const shardingView = {
  build(ctx) { const v = buildSharding(ctx); curSh = v; return v; },
  controls: [
    { id: 'sh-add', label: 'Add node', type: 'button', onChange() { curSh && curSh.api.addNode(); } },
    { id: 'sh-hot', label: 'Inject hot-spot (30 sequential keys)', type: 'button', onChange() { curSh && curSh.api.injectHot(); } },
    { id: 'sh-rebalance', label: 'Rebalance', type: 'button', onChange() { curSh && curSh.api.rebalance(); } },
    { id: 'sh-lookup', label: 'Route a key', type: 'button', onChange() { curSh && curSh.api.lookupKey(); } },
    { id: 'sh-vnodes', label: 'Vnodes per node (ring)', type: 'range', min: 1, max: 16, value: 4, step: 1, onChange(v) { curSh && curSh.api.setVn(+v); } },
    { id: 'sh-reset', label: 'Reset', type: 'button', onChange() { curSh && curSh.api.reset(); } },
  ],
};

export const views = { 'router-coordinator': routerView, sharding: shardingView };
