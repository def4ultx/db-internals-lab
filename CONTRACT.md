# DB Internals Lab — shared contract

Stack: Vite 8 (multi-page, no framework), vanilla ES modules, three@0.186 (`import * as THREE from 'three'`, addons from `three/addons/...`). No CDN, no network at runtime. Dark theme in `src/shared/theme.css`; layer colours in `src/shared/layers.js`. Every page calls `mountNav('<page>')` from `src/shared/nav.js` (already wired in the stub .html files — keep that).
Run: `npm run dev` (port 5173). Verify with `npm run build`. Headless checks: system Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (use `puppeteer-core` if you need to install it; `npm i -D puppeteer-core`, coordinate: package.json edits must only ADD dependencies).
Audience: a learner studying database internals (CMU 15-445 / 15-721 level). Content must be accurate, concrete (numbers, byte layouts, real names), and explain **how components impact each other**. Prefer correctness over breadth-by-fluff. Use WebSearch/WebFetch to verify facts about specific systems when unsure.

## File ownership (do NOT edit files you don't own)
| Owner | Files |
|---|---|
| data-components | `src/data/components.js`, `src/data/edges.js`, `src/data/flows.js` |
| data-designs | `src/data/designs.js`, `src/data/rules.js` |
| data-systems | `src/data/systems.js`, `compare.html`, `src/compare/*` |
| explorer-core | `explore.html`, `src/explorer/*.js` (not `internals/`), `src/data/index.js` |
| internals-A..E | `src/explorer/internals/<their file>.js` only |
| learn | `index.html`, `learn.html`, `src/learn/*` |
| video | `video.html`, `src/video/*`, `public/video/*` |

## Canonical component ids (`src/data/components.js`). Fixed — you may ADD ids, never rename/remove.
layer `client`: `client`, `wire-protocol`, `connection-pool`
layer `frontend`: `lexer`, `parser`, `ast`, `binder`, `catalog`, `schema-manager`, `relational-algebra`
layer `planning`: `statistics`, `cardinality-estimator`, `cost-model`, `logical-plan`, `optimizer`, `physical-plan`, `plan-cache`, `pipeline-dag`
layer `execution`: `executor`, `operators`, `scheduler`, `parallelism`, `codegen`, `adaptive-execution`, `exchange-shuffle`, `columnar-processing`
layer `txn`: `txn-manager`, `concurrency-control`, `lock-manager`, `latch`, `mvcc`, `timestamp-oracle`, `isolation-levels`, `deadlock-detector`, `wal`, `recovery`
layer `storage`: `access-method`, `buffer-pool`, `prefetcher`, `btree`, `lsm-tree`, `skiplist`, `adaptive-radix-tree`, `heap-file`, `index-organized-table`, `page-file`, `slotted-page`, `column-store`, `compression`, `secondary-index`, `file-manager`
layer `distributed`: `router-coordinator`, `sharding`, `replication`, `consensus`, `distributed-commit`, `logical-clocks`, `disaggregated-storage`

## Canonical design-slot ids and option ids (`src/data/designs.js`). Fixed — you may ADD slots/options, never rename/remove.
| slot | options |
|---|---|
| `index-structure` | `bplustree`, `lsm`, `cow-btree`, `bwtree`, `skiplist`, `art`, `hash` |
| `table-organization` | `heap`, `index-organized`, `columnar`, `lsm-kv` |
| `page-layout` | `nsm-row`, `dsm-column`, `pax` |
| `exec-model` | `volcano`, `vectorized`, `materialization`, `compiled` |
| `data-direction` | `pull`, `push` |
| `code-execution` | `precompiled-primitives`, `codegen-jit`, `hybrid-adaptive` |
| `scheduling` | `thread-per-connection`, `thread-pool`, `morsel-driven`, `thread-per-core` |
| `parallelism` | `inter-query`, `intra-operator`, `intra-query-exchange` |
| `optimizer-search` | `bottom-up-dp`, `top-down-cascades`, `hypergraph-dphyp`, `heuristic-rules`, `learned` |
| `statistics` | `equi-width-histogram`, `equi-depth-histogram`, `ddsketch-quantile`, `hyperloglog-ndv`, `sampling` |
| `buffer-eviction` | `lru`, `clock`, `lru-k`, `arc-2q` |
| `page-cache` | `buffer-pool`, `mmap`, `direct-io-uring` |
| `concurrency-control` | `2pl`, `occ`, `mvcc-timestamp`, `mvcc-ssi`, `deterministic-calvin` |
| `mvcc-storage` | `append-only`, `delta-undo`, `time-travel` |
| `isolation-default` | `read-committed`, `repeatable-read`, `snapshot`, `serializable` |
| `deadlock-handling` | `wait-for-graph`, `timeout`, `wait-die-wound-wait`, `ordered-acquire` |
| `recovery` | `aries-steal-noforce`, `shadow-cow`, `command-logging`, `no-steal-force` |
| `compression` | `none`, `dictionary`, `for-bitpack`, `delta`, `rle`, `lz4-zstd` |
| `secondary-index` | `btree`, `hash`, `bitmap`, `zonemap-minmax`, `bloom`, `inverted` |
| `plan-cache` | `none`, `prepared-stmt`, `normalized-literals` |
| `replication` | `sync`, `semi-sync`, `async`, `quorum-raft` |
| `replication-log` | `statement`, `row-binlog`, `physical-wal` |
| `consensus` | `none-primary-backup`, `raft`, `multi-paxos` |
| `distributed-commit` | `two-phase-commit`, `three-phase-commit`, `percolator-timestamp`, `calvin-deterministic`, `none-single-node` |
| `clock` | `lamport`, `vector-clock`, `hlc`, `truetime`, `timestamp-oracle` |
| `sharding` | `hash`, `range`, `consistent-hash`, `directory-vindex` |
| `storage-architecture` | `shared-nothing`, `shared-disk`, `disaggregated-object-store` |

## Canonical system ids (`src/data/systems.js`)
`mysql-innodb`, `postgres`, `sqlite`, `duckdb`, `clickhouse`, `starrocks`, `hadoop-hive`, `spark-sql`, `cassandra`, `scylladb`, `tigerbeetle`, `foundationdb`, `umbra-hyper`, `bigtable`, `vitess`, plus optionally `cockroachdb`, `spanner`, `snowflake`, `rocksdb`, `bigquery`.

## Data schemas (ES modules, plain objects, `export default` an array unless noted)

### components.js → `export default Component[]`
```js
{
  id, name, layer,                     // layer ∈ LAYERS ids
  oltpOlap: 'both'|'oltp'|'olap',      // where it matters most
  summary,                             // 2–3 sentences, plain English
  responsibility,                      // one line: "turns X into Y"
  internals: [{ name, desc }],         // 3–8 sub-parts shown on zoom-in (names must match what the 3D internals view shows)
  keyIdeas: [string],                  // 3–6 bullets the learner must remember
  impacts: [{ with: componentId, how }],  // how this component's design affects/constrains OTHER components (≥2, concrete)
  systems: { 'mysql-innodb': 'one-sentence how they do it', ... },  // ≥4 systems each, use canonical system ids
  slots: [slotId],                     // design slots that configure this component
  refs: [{ title, url }],              // CMU 15-445/15-721 lecture, papers, docs (real URLs only)
  pos: { x, y }                        // optional hint; explorer auto-lays-out within layer otherwise
}
```

### edges.js → `export default Edge[]`  (the "simple interface between components")
```js
{
  id,                                  // e.g. 'parser>binder'
  from, to,                            // component ids
  kind: 'control'|'data'|'log'|'meta'|'network',
  label,                               // short: "AST"
  iface: {
    signature,                         // e.g. 'bind(ast: AST, catalog: Catalog): BoundAST'  (pseudo-code, language-neutral)
    payload,                           // an actual example value as a string (JSON / table / bytes) of what flows
    notes                              // 1–2 sentences: sync/async, batch size, ownership, back-pressure
  }
}
```
Cover the full pipeline end-to-end plus feedback edges (stats→cardinality, executor→buffer-pool, wal→recovery, lock-manager↔txn-manager, replication→wal, etc.). ≥ 80 edges.

### flows.js → `export default Flow[]`  (animated data-flow scenarios the explorer plays)
```js
{
  id, title, workload: 'OLTP'|'OLAP'|'DISTRIBUTED'|'RECOVERY',
  sql,                                 // example statement (or '' for crash recovery)
  description,
  steps: [{ edge: edgeId, label, payload, note, at?: number /*parallel groups share same at*/ }]
}
```
Required flows: `oltp-point-select`, `oltp-update-commit` (WAL, locks, MVCC, group-commit), `olap-scan-agg` (columnar, zone maps, vectorized, morsel parallel), `olap-join-shuffle` (distributed hash join with exchange), `distributed-2pc-commit`, `raft-replicated-write`, `crash-recovery-aries`, `lsm-write-read-compact`.

### designs.js → `export default Slot[]`
```js
{
  id, title, component: componentId /*primary*/, also: [componentId],   // components impacted
  question,                          // "How do we organise the primary index on disk?"
  default: optionId,
  options: [{
    id, label,
    summary,                         // 2–3 sentences how it works
    pros: [], cons: [],
    usedBy: [systemId],
    metrics: { pointRead, rangeScan, writeThroughput, analyticScan, spaceEfficiency, concurrency, simplicity },  // each integer 1..5 (5 best). Be honest, not uniform.
    effects: [{ target: componentId|edgeId, change }],  // concrete knock-on changes ("compaction thread appears", "bloom filter on read path")
    research: [{ title, url }]       // papers / talks
  }]
}
```
Slots in the table above must all exist, with every option listed there.

### rules.js → `export default Rule[]`
```js
{ id, when: { slot, option }, with: { slot, option }, type: 'synergy'|'conflict'|'implies', note }
```
e.g. `lsm` + `bloom` synergy; `deterministic-calvin` + `two-phase-commit` conflict; `columnar` implies `vectorized`-friendly. ≥ 40 rules. The explorer shows these when the user composes a config.

### systems.js → `export default System[]` and `export const featureRows`
```js
{ id, name, category: 'OLTP'|'OLAP'|'HTAP'|'NoSQL'|'embedded'|'distributed-SQL'|'batch', since, language, oneLiner,
  choices: { [slotId]: optionId },   // best mapping onto the slots above (omit only when truly not applicable)
  details: { [slotId]: 'short factual note specific to the system' },
  strengths: [], weaknesses: [], bestFor, architectureNotes, refs: [{title,url}] }
```
`featureRows`: array of `{ key, label, slot? }` describing comparison table rows.

## Explorer ↔ internals interface
`src/data/index.js` (explorer-core) re-exports `{ components, edges, flows, slots, rules, systems }` and helper lookups.

Each internals file (`src/explorer/internals/<name>.js`) does:
```js
import * as THREE from 'three';
export const views = {
  'buffer-pool': {
    // Called when the user zooms into this component. Return a THREE.Group centred at origin, roughly fitting a 20×12×12 unit box.
    // `ctx` = { config, palette, makeLabel(text,{size,color}) -> THREE.Sprite|Mesh, onInfo(htmlString) , addPacket(opts) }
    //   config: { [slotId]: optionId }   // current design choices — the view MUST visibly change with relevant slots
    build(ctx) { const group = new THREE.Group(); /* ... */ return { group, update(dt, t), dispose(), onConfigChange(config), steps: [{title, text, run(){...}}] }; },
    // Optional interactive controls the explorer renders as HTML next to the 3D scene:
    controls: [{ id, label, type: 'button'|'range'|'select'|'toggle', options?, min?, max?, value?, onChange(v, api) }]   // ids must be unique per view
  }, ...
};
```
Rules for views: real mechanics, not decoration (e.g. B+tree view actually performs insert with splits and lookups with highlighted path; LSM view flushes memtable → L0 → compaction with real merge of keys; slotted page shows header/slot array/free space/tuples growing from both ends with actual byte offsets; clock eviction shows the hand sweeping with ref bits). Label things with real terms. `steps` is a guided walkthrough (3–8 steps) the explorer shows as "Next ▶". Dispose all geometries/materials. Keep each view < ~25k triangles; use InstancedMesh for repeated cells. Text: use `ctx.makeLabel`. Views must work with `config` defaults when slots are missing.

### Component → view assignment (every canonical component id below needs a view unless noted; if a component is trivial, build a simple but still meaningful pipeline/diagram view)
- **internals-A** (`src/explorer/internals/frontend.js`, `planning.js`): client, wire-protocol, connection-pool, lexer, parser, ast, binder, catalog, schema-manager, relational-algebra, statistics (histogram vs DDSketch vs HLL side-by-side, driven by `statistics` slot), cardinality-estimator, cost-model, logical-plan, optimizer (bottom-up DP vs top-down cascades memo vs DPhyp vs heuristic vs learned, `optimizer-search` slot), physical-plan, plan-cache, pipeline-dag (pipelines + breakers).
- **internals-B** (`src/explorer/internals/execution.js`): executor (volcano pull vs vectorized vs push-compiled vs materialization, `exec-model`/`data-direction`), operators, scheduler (`scheduling`: morsel-driven vs thread-per-core vs pool), parallelism (inter vs intra), codegen (`code-execution`: precompiled primitives vs JIT vs hybrid swap), adaptive-execution, exchange-shuffle, columnar-processing (SIMD, selection vectors).
- **internals-C** (`src/explorer/internals/storage.js`): access-method, buffer-pool (+LRU vs Clock vs LRU-K vs ARC, `buffer-eviction`), prefetcher (read-ahead), btree (split/merge/overflow/COW/BwTree delta chains), lsm-tree (memtable, WAL, SSTables, bloom, compaction, tombstones), skiplist, adaptive-radix-tree, heap-file vs index-organized-table, file-manager.
- **internals-D** (`src/explorer/internals/pages.js`): page-file (page header, links, rebalance, how bits are stored — show actual hex/bytes and bit-level fields, checksum/CRC), slotted-page (cell layout, slot array, free space, overflow), column-store (PAX, row groups, zone maps, null bitmaps, bitmaps), compression (dictionary, FOR, delta, RLE, bit-packing — live encode of data), secondary-index (btree/hash/bitmap/zonemap/bloom/inverted).
- **internals-E** (`src/explorer/internals/txn.js`, `distributed.js`): txn-manager, concurrency-control (2PL vs OCC vs MVCC vs Calvin), lock-manager (lock table, compat matrix, intent locks), latch (vs lock, latch crabbing), mvcc (version chains, visibility rules, append-only vs undo vs time-travel), timestamp-oracle, isolation-levels (anomalies: dirty read, non-repeatable, phantom, write skew — interactive schedule), deadlock-detector (wait-for graph cycle), wal, recovery (ARIES analysis/redo/undo, steal/force, dirty page table), router-coordinator, sharding, replication (sync/semi-sync/async, binlog/WAL shipping), consensus (Raft leader election + log replication; Multi-Paxos), distributed-commit (2PC/3PC/Percolator/Calvin), logical-clocks (Lamport, vector, HLC, TrueTime), disaggregated-storage (compute/storage separation, S3, caching).
internals-E has the most views: split into two files `txn.js` (txn-manager … recovery) and `distributed.js` (the rest). Each exports `views`.

The explorer imports: `frontend.js, planning.js, execution.js, storage.js, pages.js, txn.js, distributed.js` and merges their `views`. A missing view falls back to a generic auto-generated view built from `components.js` internals.
