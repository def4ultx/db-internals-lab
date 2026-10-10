// Systems catalogue. Each system maps onto the canonical design slots (see CONTRACT.md).
// `choices` is a best-fit mapping (some systems are a loose fit for a slot: the matching `details` entry explains the nuance).
// Extension over the contract: optional `tags` ('oltp'|'olap'|'nosql'|'embedded'|'distributed') used by the compare page filters.

const systems = [
  {
    id: 'mysql-innodb', name: 'MySQL / InnoDB', category: 'OLTP', tags: ['oltp'], since: 1995, language: 'C++',
    oneLiner: 'Row-store OLTP engine built around a clustered B+tree, undo-log MVCC and a redo log with doublewrite protection.',
    choices: {
      'index-structure': 'bplustree', 'table-organization': 'index-organized', 'page-layout': 'nsm-row',
      'exec-model': 'volcano', 'data-direction': 'pull', 'code-execution': 'precompiled-primitives',
      scheduling: 'thread-per-connection', parallelism: 'inter-query', 'optimizer-search': 'bottom-up-dp',
      statistics: 'equi-depth-histogram', 'buffer-eviction': 'lru', 'page-cache': 'buffer-pool',
      'concurrency-control': '2pl', 'mvcc-storage': 'delta-undo', 'isolation-default': 'repeatable-read',
      'deadlock-handling': 'wait-for-graph', recovery: 'aries-steal-noforce', compression: 'lz4-zstd',
      'secondary-index': 'btree', 'plan-cache': 'prepared-stmt', replication: 'async', 'replication-log': 'row-binlog',
      consensus: 'none-primary-backup', 'distributed-commit': 'none-single-node', 'storage-architecture': 'shared-nothing'
    },
    details: {
      'index-structure': 'Every table IS a B+tree keyed by the primary key (clustered index); 16 KB pages, leaf pages hold full rows. Secondary-index leaves store the PK value, so a secondary lookup is two tree descents.',
      'table-organization': 'Clustered index: rows live in PK order inside the leaf pages. Without an explicit PK InnoDB invents a hidden 6-byte DB_ROW_ID. Random PKs (UUIDv4) cause page splits and fragmentation.',
      'page-layout': 'Compact row format inside 16 KB pages with a page directory (slots every ~4-8 records), infimum/supremum records and a singly-linked record list.',
      'exec-model': 'Iterator (Volcano) model over the handler API: the SQL layer calls the storage engine row by row (ha_innodb::index_next). MySQL 8.0 added a hash join and an iterator executor refactor.',
      'optimizer-search': 'Left-deep greedy search with depth pruning (optimizer_search_depth, default 62) and cost model constants from mysql.server_cost / engine_cost. No Cascades-style memo.',
      statistics: 'Persistent index statistics from random page dives (innodb_stats_persistent_sample_pages) plus optional equi-height/singleton histograms from ANALYZE TABLE ... UPDATE HISTOGRAM (8.0).',
      'buffer-eviction': 'Buffer pool LRU split into young (5/8) and old (3/8) sublists with a midpoint insertion; a page must survive innodb_old_blocks_time (1 s) in old before promotion, protecting against scan pollution.',
      'concurrency-control': 'Writers use strict 2PL with row/gap/next-key locks (index-record locks). Plain SELECTs use consistent snapshot reads (MVCC) and take no locks.',
      'mvcc-storage': 'Newest version is updated in place in the clustered index; older versions are rebuilt from undo logs via the roll pointer (DB_ROLL_PTR) and trx id (DB_TRX_ID). Purge threads discard undo no longer visible to any read view.',
      'isolation-default': 'REPEATABLE READ (snapshot at first read) with next-key locking to prevent phantoms for locking reads.',
      recovery: 'ARIES-like: physiological redo log (ib_logfile / #innodb_redo, LSN-ordered), fuzzy checkpoints, STEAL/NO-FORCE; undo logs roll back uncommitted txns. Doublewrite buffer protects against torn 16 KB page writes.',
      compression: 'Transparent page compression (zlib/lz4 + hole punching) and legacy ROW_FORMAT=COMPRESSED; no columnar encoding.',
      replication: 'Asynchronous by default, with semi-sync plugin or Group Replication (Paxos-based) as upgrades.',
      'replication-log': 'Server-level binary log (row-based by default) is separate from InnoDB redo; 2PC between binlog and redo guarantees consistency (XA internally).',
      'plan-cache': 'No shared plan cache; server-side prepared statements cache the parse tree, re-optimised per execution. The old query cache was removed in 8.0.'
    },
    strengths: ['Mature, predictable OLTP performance; PK lookups are one tree descent', 'Excellent ecosystem (replication, tooling, managed services)', 'Non-locking consistent reads via undo-based MVCC', 'Crash safety well understood (redo + doublewrite)'],
    weaknesses: ['Clustered index makes random PKs and wide PKs expensive (every secondary index carries the PK)', 'Long transactions bloat undo history / history list length', 'Limited analytic optimizer and no vectorized execution', 'Scaling writes needs sharding (e.g. Vitess)'],
    bestFor: 'Classic web OLTP: point lookups, short transactions, read-heavy workloads with replicas.',
    architectureNotes: 'Two layers: the MySQL server (parser, optimizer, executor, binlog) and pluggable storage engines via the handler API; InnoDB is the default. InnoDB: clustered B+tree with 16 KB pages, buffer pool with young/old LRU, change buffer for secondary-index inserts, adaptive hash index, undo-log MVCC, ARIES-style redo log with fuzzy checkpoints plus doublewrite buffer, row/gap/next-key locking, and background purge/page-cleaner threads.',
    refs: [
      { title: 'InnoDB architecture (MySQL manual)', url: 'https://dev.mysql.com/doc/refman/8.0/en/innodb-architecture.html' },
      { title: 'InnoDB buffer pool (young/old LRU)', url: 'https://dev.mysql.com/doc/refman/8.0/en/innodb-buffer-pool.html' },
      { title: 'InnoDB doublewrite buffer', url: 'https://dev.mysql.com/doc/refman/8.0/en/innodb-doublewrite-buffer.html' },
      { title: 'InnoDB multi-versioning', url: 'https://dev.mysql.com/doc/refman/8.0/en/innodb-multi-versioning.html' }
    ]
  },
  {
    id: 'postgres', name: 'PostgreSQL', category: 'OLTP', tags: ['oltp'], since: 1996, language: 'C',
    oneLiner: 'Heap-file row store with append-only MVCC tuple versions, VACUUM, and a physical WAL with full-page writes.',
    choices: {
      'index-structure': 'bplustree', 'table-organization': 'heap', 'page-layout': 'nsm-row',
      'exec-model': 'volcano', 'data-direction': 'pull', 'code-execution': 'precompiled-primitives',
      scheduling: 'thread-per-connection', parallelism: 'intra-operator', 'optimizer-search': 'bottom-up-dp',
      statistics: 'equi-depth-histogram', 'buffer-eviction': 'clock', 'page-cache': 'buffer-pool',
      'concurrency-control': 'mvcc-timestamp', 'mvcc-storage': 'append-only', 'isolation-default': 'read-committed',
      'deadlock-handling': 'wait-for-graph', recovery: 'aries-steal-noforce', compression: 'lz4-zstd',
      'secondary-index': 'btree', 'plan-cache': 'prepared-stmt', replication: 'async', 'replication-log': 'physical-wal',
      consensus: 'none-primary-backup', 'distributed-commit': 'none-single-node', 'storage-architecture': 'shared-nothing'
    },
    details: {
      'index-structure': 'nbtree is a Lehman-Yao B+tree variant with right-links and high keys; also GiST, SP-GiST, GIN, BRIN and hash. Indexes store heap TIDs (block, offset), not the row.',
      'table-organization': 'Unordered heap of 8 KB slotted pages. CLUSTER reorders once but is not maintained. HOT updates avoid index writes when no indexed column changes and the new version fits on the same page.',
      'page-layout': '8 KB pages: 24-byte header, line-pointer array growing down, tuples growing up from the end; each tuple has a 23-byte header (xmin, xmax, cmin/cmax, ctid, infomask).',
      'exec-model': 'Classic Volcano iterator tree (ExecProcNode). Optional LLVM JIT for expressions and tuple deforming (jit = on for costly queries) reduces interpretation overhead.',
      scheduling: 'Process-per-connection (postmaster forks a backend), which is why poolers like PgBouncer are common. Parallel query uses dynamic background workers + shared memory queues (Gather / Gather Merge).',
      'optimizer-search': 'System-R style bottom-up dynamic programming over join subsets; switches to the genetic optimiser GEQO beyond geqo_threshold (12) relations.',
      statistics: 'pg_statistic per column: MCV list, equi-depth histogram bounds, n_distinct, correlation; extended statistics (dependencies, ndistinct, MCV) for multi-column.',
      'buffer-eviction': 'Clock-sweep over shared_buffers with usage counts (0-5); sequential scans and VACUUM use small ring buffers to avoid pool pollution. The OS page cache sits underneath (double buffering).',
      'concurrency-control': 'MVCC snapshots (xmin/xmax/xip list) plus row locks stored in the tuple header and heavyweight table locks. Serializable uses SSI (predicate locks + rw-dependency tracking).',
      'mvcc-storage': 'Update = insert new tuple version in the heap + mark old xmax; old versions stay in the same heap. VACUUM / autovacuum reclaims dead tuples and freezes old xids; bloat and xid wraparound are the operational costs.',
      'isolation-default': 'READ COMMITTED (new snapshot per statement); REPEATABLE READ is snapshot isolation; SERIALIZABLE is SSI.',
      'deadlock-handling': 'After deadlock_timeout (1 s) a waiting backend runs the wait-for-graph cycle check and aborts one victim.',
      recovery: 'Physical WAL (redo) with LSNs; full_page_writes logs the entire 8 KB page on first modification after a checkpoint to defeat torn pages. STEAL/NO-FORCE with checkpointer + bgwriter. No undo log: aborted tuples are simply invisible.',
      compression: 'TOAST compresses large values (pglz or lz4); no page-level or columnar compression in core.',
      replication: 'Streaming replication of WAL, async by default; synchronous_commit/synchronous_standby_names for sync or quorum.',
      'replication-log': 'Physical WAL streaming (byte-level), plus logical decoding / publications for row-level logical replication.',
      'plan-cache': 'Prepared statements cache plans per session; after 5 executions a generic plan may be chosen by cost comparison (plan_cache_mode).'
    },
    strengths: ['Rich SQL, extensibility (types, indexes, FDWs, extensions)', 'Powerful planner with extended statistics and many index types', 'Non-blocking MVCC readers; SSI serializability', 'Strong correctness and WAL tooling (PITR, logical decoding)'],
    weaknesses: ['Table/index bloat and VACUUM tuning; xid wraparound', 'Full-page writes inflate WAL', 'Process-per-connection scales poorly without pooler', 'Update-heavy workloads write amplify indexes (mitigated by HOT)'],
    bestFor: 'General-purpose OLTP with complex queries, extensions (PostGIS, pgvector) and strict correctness.',
    architectureNotes: 'Postmaster forks one backend process per connection; backends share shared_buffers, WAL buffers and lock tables in shared memory. Heap tuples carry xmin/xmax; visibility is decided against a snapshot via the commit log (pg_xact). Writers append WAL, backends mark pages dirty and the background writer/checkpointer flush them. Autovacuum removes dead tuples, updates the visibility map and freezes xids; index-only scans rely on the visibility map.',
    refs: [
      { title: 'Concurrency control (MVCC)', url: 'https://www.postgresql.org/docs/current/mvcc.html' },
      { title: 'Reliability and the Write-Ahead Log', url: 'https://www.postgresql.org/docs/current/wal-intro.html' },
      { title: 'Routine vacuuming', url: 'https://www.postgresql.org/docs/current/routine-vacuuming.html' },
      { title: 'Database physical storage (page layout)', url: 'https://www.postgresql.org/docs/current/storage-page-layout.html' }
    ]
  },
  {
    id: 'sqlite', name: 'SQLite', category: 'embedded', tags: ['embedded', 'oltp'], since: 2000, language: 'C',
    oneLiner: 'Serverless, single-file embedded SQL engine with a bytecode VM (VDBE) and B-tree storage.',
    choices: {
      'index-structure': 'bplustree', 'table-organization': 'index-organized', 'page-layout': 'nsm-row',
      'exec-model': 'volcano', 'data-direction': 'pull', 'code-execution': 'precompiled-primitives',
      scheduling: 'thread-per-connection', parallelism: 'inter-query', 'optimizer-search': 'bottom-up-dp',
      statistics: 'sampling', 'buffer-eviction': 'lru', 'page-cache': 'buffer-pool',
      'concurrency-control': '2pl', 'isolation-default': 'serializable', 'deadlock-handling': 'timeout',
      recovery: 'shadow-cow', compression: 'none', 'secondary-index': 'btree', 'plan-cache': 'prepared-stmt',
      'distributed-commit': 'none-single-node', 'storage-architecture': 'shared-nothing'
    },
    details: {
      'index-structure': 'Tables are B+trees keyed by rowid (data in leaves); indexes and WITHOUT ROWID tables are B-trees keyed by the index key. Page size 4 KB default, one file, pages numbered from 1.',
      'table-organization': 'Rowid tables are clustered on the 64-bit rowid; WITHOUT ROWID clusters on the declared PK.',
      'page-layout': 'Slotted B-tree pages: header, cell-pointer array, cells growing from the end; large payloads spill to overflow pages. Varint-encoded records.',
      'exec-model': 'SQL is compiled to VDBE bytecode (see EXPLAIN); the VM executes opcodes with cursors (OpenRead, Next, Column, ResultRow). It is tuple-at-a-time pull from the caller (sqlite3_step).',
      scheduling: 'Runs in the caller\'s thread; no background workers. Multiple connections may be used from different threads.',
      'optimizer-search': 'Next-Generation Query Planner: N-nearest-neighbours (N=1..) path solver, a bounded form of dynamic programming over join order, with a simple cost model.',
      statistics: 'ANALYZE writes sqlite_stat1 (avg rows per key prefix) and optionally sqlite_stat4 (sampled index keys).',
      'concurrency-control': 'Database-level locking: many readers OR one writer (rollback-journal mode); WAL mode lets readers proceed during one writer by reading a snapshot defined by a WAL end-mark. No row-level MVCC.',
      'isolation-default': 'SERIALIZABLE by construction (single writer); WAL gives snapshot reads for readers.',
      'deadlock-handling': 'Avoided by locking states (SHARED, RESERVED, PENDING, EXCLUSIVE); busy_timeout / SQLITE_BUSY handle contention.',
      recovery: 'Rollback journal copies original pages before modification (undo-style, atomic via journal deletion/header zeroing); WAL mode appends new page images to a -wal file and checkpoints back. Not ARIES.',
      'plan-cache': 'Statements are compiled to bytecode and reused via sqlite3_prepare; no cross-connection cache.'
    },
    strengths: ['Zero-config, single file, tiny footprint, ubiquitous', 'ACID with simple, well-tested recovery', 'Excellent read performance for local workloads', 'Public-domain and extremely well tested'],
    weaknesses: ['Single writer at a time', 'No network protocol, replication or horizontal scale', 'Limited parallelism and analytics', 'Dynamic typing surprises'],
    bestFor: 'Embedded storage in apps, browsers, mobile, edge devices and as a file format.',
    architectureNotes: 'Pipeline: tokenizer, LALR parser (Lemon), code generator emitting VDBE bytecode, B-tree module, pager (page cache, locking, journal/WAL), and OS interface (VFS). The pager owns transactions: it maps B-tree page requests to file I/O, enforces locks and writes the rollback journal or WAL.',
    refs: [
      { title: 'SQLite database file format', url: 'https://www.sqlite.org/fileformat2.html' },
      { title: 'Write-Ahead Logging', url: 'https://www.sqlite.org/wal.html' },
      { title: 'Next-Generation Query Planner', url: 'https://www.sqlite.org/queryplanner-ng.html' },
      { title: 'The SQLite bytecode engine', url: 'https://www.sqlite.org/opcode.html' }
    ]
  },
  {
    id: 'duckdb', name: 'DuckDB', category: 'embedded', tags: ['embedded', 'olap'], since: 2019, language: 'C++',
    oneLiner: 'In-process columnar OLAP engine with vectorized push-based pipelines and morsel-driven parallelism.',
    choices: {
      'index-structure': 'art', 'table-organization': 'columnar', 'page-layout': 'pax',
      'exec-model': 'vectorized', 'data-direction': 'push', 'code-execution': 'precompiled-primitives',
      scheduling: 'morsel-driven', parallelism: 'intra-operator', 'optimizer-search': 'bottom-up-dp',
      statistics: 'hyperloglog-ndv', 'buffer-eviction': 'lru', 'page-cache': 'buffer-pool',
      'concurrency-control': 'mvcc-timestamp', 'mvcc-storage': 'delta-undo', 'isolation-default': 'snapshot',
      recovery: 'shadow-cow', compression: 'for-bitpack', 'secondary-index': 'zonemap-minmax', 'plan-cache': 'prepared-stmt',
      'distributed-commit': 'none-single-node', 'storage-architecture': 'shared-nothing'
    },
    details: {
      'index-structure': 'Adaptive Radix Trees back PRIMARY KEY/UNIQUE constraints and optional CREATE INDEX; analytic queries mostly rely on min-max zonemaps and full scans instead.',
      'table-organization': 'Tables are split into row groups of 122,880 rows; each column in a row group is stored as compressed segments in 256 KB blocks of the single database file.',
      'page-layout': 'PAX-like: row groups hold one column segment per column, so a scan reads only needed columns while related columns remain co-located per row group.',
      'exec-model': 'Vectors of 2048 values (STANDARD_VECTOR_SIZE) with selection vectors and flat/constant/dictionary vector formats flow through operators.',
      'data-direction': 'Push-based pipelines: sources push DataChunks through streaming operators into sinks; pipeline breakers (hash join build, aggregate) end a pipeline. Pull-style sources are wrapped by the pipeline executor.',
      scheduling: 'Morsel-driven (Leis et al. 2014): a task scheduler hands row-group-sized chunks to worker threads; parallel sinks use thread-local state combined at Finalize.',
      'optimizer-search': 'Rule-based rewrites (filter pushdown, common-subexpression, unnesting) plus cost-based join ordering using DPccp-style dynamic programming with a greedy fallback for big graphs.',
      statistics: 'Per-segment min/max + null counts, HyperLogLog for distinct counts, and sampling for cardinality estimation.',
      'concurrency-control': 'Optimistic MVCC adapted from HyPer: in-place updates with undo buffers, snapshot isolation; write-write conflicts abort. Bulk appends are cheap and never block readers.',
      recovery: 'Write-ahead log for committed changes plus checkpoints that write new compressed blocks and flip the database header (two alternating headers).',
      compression: 'Lightweight, type-specific: constant, RLE, dictionary, bit-packing, FOR, FSST (strings), Chimp/Patas/ALP (floats); chosen per segment during checkpoint by trial.',
      'secondary-index': 'Zonemaps (min/max) per column segment skip data; ART indexes are for point lookups.'
    },
    strengths: ['Zero-dependency in-process analytics, great on local files (Parquet/CSV/JSON)', 'Vectorized push pipelines plus morsel parallelism use all cores', 'Out-of-core hash joins/aggregates/sorts', 'Excellent compression via lightweight encodings'],
    weaknesses: ['Single-process; no distributed execution', 'Single-writer process (multiple readers), limited OLTP concurrency', 'Updates/deletes less efficient than appends', 'Not a server (no built-in auth/replication)'],
    bestFor: 'Interactive analytics on a laptop or inside an app/pipeline; data science and ETL on Parquet/CSV.',
    architectureNotes: 'Classic stages: parser (libpg_query), binder, logical planner/optimizer, physical planner that creates pipelines (a DAG with dependencies at breakers), then the executor runs pipelines as tasks across threads. Storage: single file of fixed-size blocks, a buffer manager with spill-to-temp, columnar row groups, MVCC via undo buffers, and a WAL. Extensions add file formats, httpfs and more.',
    refs: [
      { title: 'DuckDB internals overview', url: 'https://duckdb.org/docs/stable/internals/overview' },
      { title: 'DuckDB vector format', url: 'https://duckdb.org/docs/stable/internals/vector' },
      { title: 'Morsel-Driven Parallelism (Leis et al.)', url: 'https://db.in.tum.de/~leis/papers/morsels.pdf' },
      { title: 'DuckDB: an Embeddable Analytical Database (SIGMOD demo)', url: 'https://mytherin.github.io/papers/2019-duckdbdemo.pdf' }
    ]
  },
  {
    id: 'clickhouse', name: 'ClickHouse', category: 'OLAP', tags: ['olap', 'distributed'], since: 2016, language: 'C++',
    oneLiner: 'Columnar OLAP engine on immutable MergeTree parts, sparse primary index and vectorized pipelines.',
    choices: {
      'index-structure': 'lsm', 'table-organization': 'columnar', 'page-layout': 'dsm-column',
      'exec-model': 'vectorized', 'data-direction': 'push', 'code-execution': 'precompiled-primitives',
      scheduling: 'thread-pool', parallelism: 'intra-query-exchange', 'optimizer-search': 'heuristic-rules',
      statistics: 'sampling', 'buffer-eviction': 'lru', 'page-cache': 'buffer-pool',
      'concurrency-control': 'mvcc-timestamp', 'mvcc-storage': 'append-only', 'isolation-default': 'snapshot',
      recovery: 'shadow-cow', compression: 'lz4-zstd', 'secondary-index': 'zonemap-minmax', 'plan-cache': 'none',
      replication: 'async', 'replication-log': 'physical-wal', consensus: 'raft', 'distributed-commit': 'none-single-node',
      sharding: 'hash', 'storage-architecture': 'shared-nothing'
    },
    details: {
      'index-structure': 'MergeTree: each INSERT writes an immutable sorted part; background merges combine parts (LSM-like, but with a sparse primary index instead of a per-key tree). The primary index stores one entry per granule (8192 rows) and is held in memory.',
      'table-organization': 'Each column is a separate file (.bin) with a mark file (.mrk2) mapping granules to compressed-block + in-block offsets; Wide vs Compact part formats exist for small inserts.',
      'exec-model': 'Blocks of columns (default ~65,505 rows) processed by a pipeline of processors connected by ports; many functions have SIMD-dispatched variants (AVX2/AVX-512 chosen at runtime). Optional expression JIT.',
      scheduling: 'Pipeline executor runs processors on a thread pool (max_threads, default = cores); parts/granule ranges are split between streams.',
      parallelism: 'Intra-node parallel streams over parts, and distributed queries across shards via Distributed tables with partial aggregation states merged on the initiator.',
      'optimizer-search': 'Mostly rule-based (predicate pushdown, PREWHERE, move-to-prewhere, aggregation in order); join reordering exists but is limited/young. Joins default to hash join with the right side in memory.',
      statistics: 'Sparse index + data-skipping indexes; optional column statistics (TDigest, CountMin, Uniq) for PREWHERE decisions; SAMPLE BY allows approximate queries.',
      'concurrency-control': 'No general transactions: readers snapshot the current set of immutable parts, so queries see a consistent state; experimental multi-statement transactions exist.',
      'mvcc-storage': 'Parts are never modified: updates/deletes are mutations that rewrite parts (lightweight deletes mark rows via a mask). ReplacingMergeTree/CollapsingMergeTree resolve versions at merge time.',
      recovery: 'Parts are written to a temp directory then atomically renamed; fsync is optional. Replicas re-fetch lost parts, coordinated through ClickHouse Keeper.',
      compression: 'Per-column codecs chained: Delta/DoubleDelta/Gorilla/T64 transforms then LZ4 (default) or ZSTD; LowCardinality adds dictionary encoding.',
      'secondary-index': 'Data-skipping indexes per granule block: minmax, set, bloom_filter, ngrambf, tokenbf, and vector/inverted variants.',
      replication: 'ReplicatedMergeTree: asynchronous multi-master inserts by default; insert_quorum gives quorum acks.',
      consensus: 'ClickHouse Keeper (a Raft implementation, ZooKeeper-compatible) stores replication log/metadata, not the data path.',
      sharding: 'Manual sharding via Distributed table and sharding key; cloud edition adds SharedMergeTree over object storage.'
    },
    strengths: ['Extremely fast scans/aggregations; superb compression', 'High ingest rates via batch inserts', 'Rich codecs, skip indexes, materialized views', 'Simple operations compared with Hadoop-era stacks'],
    weaknesses: ['No real transactions or efficient point updates', 'Joins and multi-table workloads weaker than MPP warehouses', 'Many small inserts create too many parts', 'Resharding is manual'],
    bestFor: 'Real-time analytics, log/event/metric stores, time-series aggregations over billions of rows.',
    architectureNotes: 'Each table engine decides storage and replication; MergeTree family dominates. Query path: parse, analyze, rule-based optimize, build a pipeline of processors, execute vectorized over blocks. Storage: partitions -> parts (sorted by ORDER BY key) -> columns -> granules; primary key marks make range selection cheap. Background merge threads keep part counts bounded; mutations rewrite parts.',
    refs: [
      { title: 'MergeTree table engine', url: 'https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree' },
      { title: 'ClickHouse architecture overview', url: 'https://clickhouse.com/docs/en/development/architecture' },
      { title: 'ClickHouse - Lightning Fast Analytics for Everyone (VLDB 2024)', url: 'https://www.vldb.org/pvldb/vol17/p3731-schulze.pdf' }
    ]
  },
  {
    id: 'starrocks', name: 'StarRocks', category: 'OLAP', tags: ['olap', 'distributed'], since: 2020, language: 'C++ / Java',
    oneLiner: 'MPP columnar analytic database with a Cascades CBO and a vectorized pipeline execution engine.',
    choices: {
      'index-structure': 'lsm', 'table-organization': 'columnar', 'page-layout': 'dsm-column',
      'exec-model': 'vectorized', 'data-direction': 'push', 'code-execution': 'precompiled-primitives',
      scheduling: 'morsel-driven', parallelism: 'intra-query-exchange', 'optimizer-search': 'top-down-cascades',
      statistics: 'equi-depth-histogram', 'buffer-eviction': 'lru', 'page-cache': 'buffer-pool',
      'concurrency-control': 'mvcc-timestamp', 'mvcc-storage': 'append-only', 'isolation-default': 'snapshot',
      recovery: 'shadow-cow', compression: 'lz4-zstd', 'secondary-index': 'zonemap-minmax', 'plan-cache': 'none',
      replication: 'quorum-raft', consensus: 'none-primary-backup', 'distributed-commit': 'two-phase-commit',
      sharding: 'hash', 'storage-architecture': 'shared-nothing'
    },
    details: {
      'index-structure': 'Tablets store versioned immutable rowsets (segments) and compact them in the background (LSM-like). Sort key => sparse prefix index (one entry per 1024 rows); Primary Key tables keep an in-memory (or persistent) PK index to support real-time upserts.',
      'table-organization': 'Segments store columns in pages with ordinal index, zone maps, bitmap and bloom filter indexes per column.',
      'exec-model': 'Vectorized operators on column chunks (default 4096 rows) using SIMD; low-cardinality dictionary optimisation for strings.',
      scheduling: 'Pipeline engine (since 2.x): fragments are split into pipelines of operators scheduled as lightweight drivers on a fixed pool of cores with cooperative yielding, avoiding thread-per-fragment blocking; scan morsels (tablet/segment chunks) feed drivers.',
      parallelism: 'Fragment instances across BEs with exchange (shuffle/broadcast/colocate) plus pipeline_dop intra-node parallelism.',
      'optimizer-search': 'FE runs a Cascades-style cost-based optimizer (memo, rules, properties) with join reorder, runtime filters, and materialized view rewrite.',
      statistics: 'Collected automatically or on demand: row count, NDV, min/max, null fraction, and equi-height histograms; MCV for skew.',
      'concurrency-control': 'Each load/transaction produces a new data version; queries read a fixed tablet version snapshot (publish-version protocol), so reads never block writes.',
      'distributed-commit': 'FE acts as transaction coordinator: loads write to tablets on BEs (prepare) then FE commits and publishes the version (2PC-style).',
      replication: 'Three replicas by default; a load succeeds after a majority of replicas apply it. Metadata on FEs is replicated via BDB JE (Paxos-like); data replicas are not Raft groups.',
      compression: 'LZ4 by default (ZSTD/Zlib optional) over dictionary/bitshuffle/RLE-like encodings per page.',
      'storage-architecture': 'Shared-nothing (BE with local disks) in the classic mode; shared-data mode (v3.x) separates compute and object storage with local cache.'
    },
    strengths: ['Fast MPP joins with Cascades CBO, runtime filters and colocate joins', 'Real-time upserts via Primary Key tables', 'Materialized views with automatic query rewrite', 'MySQL protocol compatibility'],
    weaknesses: ['Operational complexity of FE/BE topology and tablet balancing', 'Not for high-rate OLTP transactions', 'Smaller ecosystem than Spark/ClickHouse', 'Tablet count/skew needs design care'],
    bestFor: 'Interactive, high-concurrency analytics and BI dashboards, real-time warehouse with joins.',
    architectureNotes: 'Frontends (FE, Java) hold metadata, parse, plan and coordinate; Backends (BE, C++) store tablets and execute fragments. Optimizer is a Cascades implementation with statistics-driven costing. Execution is a vectorized pipeline engine with runtime filters and low-cardinality dictionaries. Storage uses columnar segments with rowset versions; compaction merges versions; shared-data mode puts segments on object storage.',
    refs: [
      { title: 'StarRocks architecture', url: 'https://docs.starrocks.io/docs/introduction/Architecture/' },
      { title: 'StarRocks introduction', url: 'https://docs.starrocks.io/docs/introduction/StarRocks_intro/' },
      { title: 'StarRocks documentation home', url: 'https://docs.starrocks.io/' }
    ]
  },
  {
    id: 'hadoop-hive', name: 'Hadoop / Hive', category: 'batch', tags: ['olap', 'distributed'], since: 2008, language: 'Java',
    oneLiner: 'HDFS + YARN with Hive SQL compiled to MapReduce/Tez over ORC/Parquet files and a metastore.',
    choices: {
      'table-organization': 'columnar', 'page-layout': 'pax', 'exec-model': 'vectorized', 'data-direction': 'push',
      'code-execution': 'precompiled-primitives', scheduling: 'thread-pool', parallelism: 'intra-query-exchange',
      'optimizer-search': 'top-down-cascades', statistics: 'hyperloglog-ndv', 'concurrency-control': 'mvcc-timestamp',
      'mvcc-storage': 'append-only', 'isolation-default': 'snapshot', recovery: 'shadow-cow', compression: 'lz4-zstd',
      'secondary-index': 'zonemap-minmax', 'plan-cache': 'none', replication: 'sync', 'replication-log': 'physical-wal',
      consensus: 'none-primary-backup', 'distributed-commit': 'none-single-node', sharding: 'hash', 'storage-architecture': 'shared-nothing'
    },
    details: {
      'table-organization': 'Tables are directories of immutable files (ORC/Parquet/Avro/text) partitioned by directory and optionally bucketed by hash; no clustered indexes.',
      'page-layout': 'ORC: files are split into ~64-256 MB stripes of column streams (PAX-like) with a footer and per-stripe/row-group (10k rows) min/max, bloom filters.',
      'exec-model': 'Vectorized execution (VectorizedRowBatch of 1024 rows) in Tez/LLAP; the legacy MapReduce path was row-at-a-time with materialization to HDFS between jobs.',
      'data-direction': 'Operator tree pushes rows/batches downstream (processRow); stages communicate via shuffle edges in the Tez DAG.',
      scheduling: 'YARN containers (or LLAP long-lived daemons) run map/reduce vertices; Tez reuses containers and pipelines vertices instead of MapReduce\'s job-per-stage barrier.',
      parallelism: 'Data parallel across HDFS blocks/splits with shuffle-based exchange between map and reduce vertices; Tez DAG supports broadcast and one-to-one edges.',
      'optimizer-search': 'Calcite-based cost-based optimizer (Volcano/Cascades-style planner) with join reordering, partition pruning and semijoin reduction; metastore statistics drive costs.',
      statistics: 'Metastore column statistics: NDV (HLL), min/max, null count, avg length; ANALYZE TABLE ... COMPUTE STATISTICS.',
      'concurrency-control': 'Hive ACID (transactional ORC tables): write IDs, snapshot reads, and delta/delete_delta directories merged at read; Hive Metastore + lock manager coordinate.',
      'mvcc-storage': 'Updates/deletes produce delta and delete-delta files; minor/major compaction rewrites them. Base files remain immutable (HDFS is append-only).',
      replication: 'HDFS write pipeline replicates each block to 3 DataNodes synchronously (default dfs.replication=3), with rack-aware placement.',
      consensus: 'NameNode HA uses an active/standby pair with JournalNode quorum and ZooKeeper failover; data path has no consensus.',
      sharding: 'HDFS splits files into 128 MB blocks; Hive partitions/buckets are logical hash/range-like groupings in directory layout.',
      'storage-architecture': 'Original design co-locates compute with HDFS blocks (shared-nothing, data locality); cloud deployments increasingly read S3 instead.'
    },
    strengths: ['Scales to petabytes on commodity hardware', 'Open file formats (ORC/Parquet) shared across engines', 'Fault tolerant by re-running tasks, HDFS replication', 'Mature metastore catalog used by Spark/Presto/Trino'],
    weaknesses: ['High latency (job startup, shuffle to disk in MR)', 'Small-file problem and NameNode memory limits', 'Weak interactive/OLTP; ACID tables are heavyweight', 'Operationally heavy stack'],
    bestFor: 'Large batch ETL and warehouse tables in a data lake needing a shared metastore.',
    architectureNotes: 'HDFS: NameNode (namespace + block map, edit log + fsimage) and DataNodes storing replicated blocks. Hive: HiveServer2 parses and optimizes SQL (Calcite), compiles to an operator DAG executed by MapReduce or Tez on YARN (optionally LLAP caching daemons), reading ORC/Parquet via SerDes. The Hive Metastore (RDBMS-backed) holds table, partition and statistics metadata and is the de-facto catalog for the Hadoop ecosystem.',
    refs: [
      { title: 'HDFS architecture', url: 'https://hadoop.apache.org/docs/stable/hadoop-project-dist/hadoop-hdfs/HdfsDesign.html' },
      { title: 'MapReduce: Simplified Data Processing on Large Clusters', url: 'https://research.google/pubs/mapreduce-simplified-data-processing-on-large-clusters/' },
      { title: 'Apache Tez', url: 'https://tez.apache.org/' },
      { title: 'ORC specification', url: 'https://orc.apache.org/specification/ORCv1/' },
      { title: 'Hive Transactions (ACID)', url: 'https://cwiki.apache.org/confluence/display/Hive/Hive+Transactions' }
    ]
  },
  {
    id: 'spark-sql', name: 'Spark SQL', category: 'batch', tags: ['olap', 'distributed'], since: 2014, language: 'Scala / Java',
    oneLiner: 'Distributed dataflow engine: Catalyst optimizer, Tungsten whole-stage codegen, AQE and shuffle-based exchange.',
    choices: {
      'table-organization': 'columnar', 'page-layout': 'pax', 'exec-model': 'compiled', 'data-direction': 'push',
      'code-execution': 'codegen-jit', scheduling: 'thread-pool', parallelism: 'intra-query-exchange',
      'optimizer-search': 'heuristic-rules', statistics: 'equi-depth-histogram', 'buffer-eviction': 'lru',
      'page-cache': 'buffer-pool', compression: 'lz4-zstd', 'secondary-index': 'zonemap-minmax', 'plan-cache': 'none',
      'distributed-commit': 'two-phase-commit', sharding: 'hash', 'storage-architecture': 'disaggregated-object-store'
    },
    details: {
      'table-organization': 'Spark has no storage of its own; it reads Parquet/ORC (columnar), Delta/Iceberg/Hudi table formats, JDBC, etc. Parquet reads are vectorized into ColumnarBatches.',
      'exec-model': 'Whole-stage code generation (Tungsten) fuses a chain of operators into one Java method compiled by Janino, removing virtual calls; Parquet scan and some operators use columnar batches.',
      'data-direction': 'Generated code follows the produce/consume model (push): each operator\'s consume() is inlined into its child\'s produce loop.',
      'code-execution': 'Runtime Java source generation compiled with Janino; falls back to interpreted iterators when method size exceeds the JVM 64 KB / 8000-byte JIT limits.',
      scheduling: 'Driver DAGScheduler splits the plan into stages at shuffle boundaries, TaskScheduler launches tasks on executor thread slots (spark.executor.cores).',
      parallelism: 'Partition-parallel tasks per stage; exchange via shuffle (hash/range/single partitioning) with map-side files and reduce-side fetch.',
      'optimizer-search': 'Catalyst: tree transformations with rule batches executed to fixed point (predicate pushdown, constant folding, column pruning), then a cost-based join reorder (DP) when stats are enabled and strategy selection (broadcast/sort-merge/shuffle-hash).',
      statistics: 'ANALYZE TABLE collects size, row count, column NDV/min/max/null and optionally equi-height histograms for CBO.',
      'buffer-eviction': 'BlockManager caches RDD/DataFrame partitions (MEMORY_AND_DISK) with LRU eviction; execution and storage share a unified memory pool.',
      'distributed-commit': 'Output committer protocol: tasks write to temp dirs, task commit then job commit (rename or manifest) approximates 2PC; table formats like Delta provide atomic commits via log + OCC.',
      sharding: 'Hash partitioning for shuffles/bucketing, range for sorts, adaptive coalescing of small partitions.',
      'storage-architecture': 'Compute is decoupled from storage by design (HDFS, S3, ADLS, GCS); shuffle and cache are the only local state.'
    },
    strengths: ['Unified batch, SQL, streaming and ML', 'Catalyst + Tungsten + AQE give strong optimisation (skew joins, coalesce partitions, dynamic join strategy)', 'Fault tolerance via lineage recompute', 'Rich connector and table-format ecosystem'],
    weaknesses: ['JVM overhead and shuffle cost; startup latency', 'Not for low-latency or transactional workloads', 'Tuning (partitions, memory, skew) is non-trivial', 'Small-file/shuffle-spill pathologies'],
    bestFor: 'Large-scale ETL, lakehouse transformations, SQL + ML pipelines.',
    architectureNotes: 'SQL -> unresolved logical plan -> analyzer (catalog resolution) -> Catalyst optimizer -> physical plans chosen by strategies -> Tungsten whole-stage codegen -> RDD DAG executed as stages. Adaptive Query Execution re-optimises at shuffle boundaries using runtime statistics (coalesce partitions, switch join to broadcast, split skewed partitions). Shuffle writes sorted map outputs (or via an external shuffle service) which reducers fetch over the network.',
    refs: [
      { title: 'Spark SQL: Relational Data Processing in Spark (SIGMOD 2015)', url: 'https://people.csail.mit.edu/matei/papers/2015/sigmod_spark_sql.pdf' },
      { title: 'Resilient Distributed Datasets (NSDI 2012)', url: 'https://www.usenix.org/system/files/conference/nsdi12/nsdi12-final138.pdf' },
      { title: 'Project Tungsten', url: 'https://www.databricks.com/blog/2015/04/28/project-tungsten-bringing-spark-closer-to-bare-metal.html' },
      { title: 'Adaptive Query Execution', url: 'https://spark.apache.org/docs/latest/sql-performance-tuning.html#adaptive-query-execution' }
    ]
  },
  {
    id: 'cassandra', name: 'Apache Cassandra', category: 'NoSQL', tags: ['nosql', 'distributed'], since: 2008, language: 'Java',
    oneLiner: 'Leaderless wide-column store: LSM storage, consistent-hash ring, gossip, tunable consistency.',
    choices: {
      'index-structure': 'lsm', 'table-organization': 'lsm-kv', 'page-layout': 'nsm-row', 'exec-model': 'materialization',
      scheduling: 'thread-pool', parallelism: 'inter-query', 'optimizer-search': 'heuristic-rules',
      'buffer-eviction': 'lru', 'concurrency-control': 'mvcc-timestamp', 'mvcc-storage': 'append-only',
      'isolation-default': 'read-committed', recovery: 'command-logging', compression: 'lz4-zstd',
      'secondary-index': 'inverted', 'plan-cache': 'prepared-stmt', replication: 'quorum-raft',
      consensus: 'none-primary-backup', 'distributed-commit': 'none-single-node', sharding: 'consistent-hash',
      'storage-architecture': 'shared-nothing'
    },
    details: {
      'index-structure': 'Memtable (skiplist/trie) -> flush to immutable SSTables; per-SSTable bloom filter, partition index and summary; compaction strategies STCS, LCS, TWCS (UCS in 5.0).',
      'table-organization': 'Partition key (hashed by Murmur3 to a token) selects replicas; clustering columns sort rows within a partition inside SSTables. Queries must name the partition key to be efficient.',
      'exec-model': 'No general executor: CQL is mapped to single-partition or token-range reads that merge memtable + SSTable iterators; no joins or arbitrary aggregates across partitions.',
      scheduling: 'Staged event-driven architecture (SEDA) stages with thread pools (read, mutation, compaction, gossip stages).',
      'optimizer-search': 'No cost-based optimizer; the planner picks the partition/clustering path and, if needed, a secondary index.',
      'concurrency-control': 'Last-write-wins per cell by client/coordinator timestamp; no locks. Lightweight transactions (LWT) use Paxos per partition; Accord-based transactions arrive in 5.x.',
      'mvcc-storage': 'Every write is a new timestamped cell version; deletes write tombstones that are purged after gc_grace_seconds (default 10 days) to avoid zombie data.',
      'isolation-default': 'Row-level atomicity and isolation within a partition write; no cross-partition isolation. Tunable consistency levels (ONE, QUORUM, LOCAL_QUORUM, ALL).',
      recovery: 'Commit log (append-only, periodic or batch fsync) replayed into memtables on restart; redo-only logical mutations, no undo. Hinted handoff, read repair and anti-entropy repair (Merkle trees) fix divergence between replicas.',
      'secondary-index': 'Legacy 2i are local per-node hidden tables; Storage-Attached Indexes (SAI, 5.0) are per-SSTable inverted/trie/kd-tree indexes.',
      replication: 'Leaderless: coordinator forwards the mutation to all RF replicas and waits for the consistency level (R+W>N gives strong reads). Rack/DC-aware placement (NetworkTopologyStrategy).',
      consensus: 'No leader or consensus on the data path; gossip disseminates membership and a phi-accrual failure detector marks nodes down.',
      sharding: 'Token ring with virtual nodes (num_tokens, default 16 in 4.x) assigned via consistent hashing; adding nodes streams token ranges.'
    },
    strengths: ['Linear write scalability and no single point of failure', 'Multi-datacenter replication with tunable consistency', 'Very high write throughput (sequential LSM + commit log)', 'Predictable partition-key access patterns'],
    weaknesses: ['Query-driven schema design; limited ad-hoc queries/joins', 'Tombstones, compaction and repair operational pain', 'Eventual consistency anomalies unless QUORUM everywhere', 'JVM GC pauses'],
    bestFor: 'High-volume, always-on writes with known access patterns across datacenters (time series, messaging, IoT).',
    architectureNotes: 'Dynamo-style distribution (consistent hashing, gossip, hinted handoff, tunable consistency) combined with a Bigtable-style data model and LSM storage engine. Any node can coordinate a request; the coordinator maps the partition token to replicas using the snitch and replication strategy. Write path: commit log + memtable; read path: memtable + bloom-filtered SSTables merged by timestamp, with optional row/key/chunk caches.',
    refs: [
      { title: 'Cassandra architecture overview', url: 'https://cassandra.apache.org/doc/latest/cassandra/architecture/overview.html' },
      { title: 'Dynamo: Amazon\'s Highly Available Key-value Store', url: 'https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf' },
      { title: 'Cassandra - A Decentralized Structured Storage System', url: 'https://www.cs.cornell.edu/projects/ladis2009/papers/lakshman-ladis2009.pdf' }
    ]
  },
  {
    id: 'scylladb', name: 'ScyllaDB', category: 'NoSQL', tags: ['nosql', 'distributed'], since: 2015, language: 'C++',
    oneLiner: 'Cassandra-compatible wide-column store rewritten on Seastar with a shard-per-core, shared-nothing design.',
    choices: {
      'index-structure': 'lsm', 'table-organization': 'lsm-kv', 'page-layout': 'nsm-row', 'exec-model': 'materialization',
      scheduling: 'thread-per-core', parallelism: 'inter-query', 'optimizer-search': 'heuristic-rules',
      'buffer-eviction': 'lru', 'page-cache': 'direct-io-uring', 'concurrency-control': 'mvcc-timestamp',
      'mvcc-storage': 'append-only', 'isolation-default': 'read-committed', recovery: 'command-logging',
      compression: 'lz4-zstd', 'secondary-index': 'inverted', 'plan-cache': 'prepared-stmt', replication: 'quorum-raft',
      consensus: 'raft', 'distributed-commit': 'none-single-node', sharding: 'consistent-hash', 'storage-architecture': 'shared-nothing'
    },
    details: {
      'index-structure': 'LSM like Cassandra (memtable, SSTables in the same format, bloom filters, STCS/LCS/ICS/TWCS compaction) but each shard owns its own memtables and SSTable set.',
      scheduling: 'Seastar framework: one pinned thread per CPU core (a "shard"), cooperative futures/continuations, no locks across cores, explicit message passing between shards; each shard owns a slice of the node\'s token range.',
      'page-cache': 'Bypasses the Linux page cache: reads via its own per-shard row cache and DMA/AIO (io_uring where available) with a userspace I/O scheduler that prioritises queries over compaction.',
      'buffer-eviction': 'Per-shard LRU row cache that merges memtable + SSTable data and is evicted under memory pressure (memory is pre-allocated per shard).',
      'concurrency-control': 'Same timestamp-LWW model as Cassandra; LWT historically Paxos; Raft-backed strongly consistent tables are introduced (tablets).',
      consensus: 'Since 5.x Raft is used for schema/topology metadata (and Raft-based strongly consistent tables); the regular data path remains leaderless with tunable consistency.',
      sharding: 'Token ring with vnodes plus intra-node shard assignment; Tablets (6.x) make load-balanced range splits dynamic.',
      parallelism: 'Inter-query across shards; a request is routed to the shard owning the key (token-aware drivers know shard IDs), cross-shard hops are avoided or messaged.'
    },
    strengths: ['Low and predictable tail latencies at high throughput', 'No JVM, few GC/tuning issues, linear core scaling', 'Drop-in Cassandra/DynamoDB-compatible APIs', 'Workload prioritisation and userspace I/O scheduling'],
    weaknesses: ['Same data-modeling constraints as Cassandra', 'Tombstones/compaction still matter', 'Shard-aware drivers needed for best performance', 'Smaller open-source ecosystem than Cassandra'],
    bestFor: 'Latency-sensitive, high-throughput key-value / wide-column workloads on few large nodes.',
    architectureNotes: 'Seastar shared-nothing runtime: each core has its own memory, network queue slice, I/O queue and SSTables; cross-core communication uses lock-free queues. Storage uses the same SSTable/commit-log model as Cassandra, and distribution uses the same ring/gossip. A userspace scheduler allocates I/O and CPU shares among classes (statement, compaction, streaming, repair) to keep foreground latency stable.',
    refs: [
      { title: 'ScyllaDB shard-per-core architecture', url: 'https://www.scylladb.com/product/technology/shard-per-core-architecture/' },
      { title: 'Seastar', url: 'https://seastar.io/' },
      { title: 'ScyllaDB architecture docs', url: 'https://docs.scylladb.com/manual/stable/architecture/index.html' }
    ]
  },
  {
    id: 'tigerbeetle', name: 'TigerBeetle', category: 'OLTP', tags: ['oltp', 'distributed'], since: 2020, language: 'Zig',
    oneLiner: 'Purpose-built financial ledger database: fixed 128-byte records, VSR consensus, LSM forest, deterministic simulation testing.',
    choices: {
      'index-structure': 'lsm', 'table-organization': 'lsm-kv', 'page-layout': 'nsm-row', 'exec-model': 'materialization',
      scheduling: 'thread-per-core', parallelism: 'inter-query', 'buffer-eviction': 'clock', 'page-cache': 'direct-io-uring',
      'concurrency-control': 'deterministic-calvin', 'isolation-default': 'serializable', recovery: 'command-logging',
      compression: 'none', 'plan-cache': 'none', replication: 'quorum-raft', 'replication-log': 'statement',
      consensus: 'raft', 'distributed-commit': 'none-single-node', clock: 'timestamp-oracle', 'storage-architecture': 'shared-nothing'
    },
    details: {
      'index-structure': 'An LSM "forest": a separate LSM tree per object tree and per index (e.g. accounts by id/ledger/code, transfers by debit/credit account, timestamp). Compaction is paced and bar-based so work per beat is bounded.',
      'table-organization': 'Fixed-size 128-byte Account and Transfer structs (cache-line aligned, no variable-length data); user_data fields attach external IDs. No SQL, only create/lookup/query operations.',
      scheduling: 'Single-threaded, event-loop-driven state machine per replica; I/O via io_uring (Linux) with Direct I/O, no threads, no locks.',
      'exec-model': 'Operations are batched (up to ~8,190 transfers per 1 MiB message) and executed as one deterministic state-machine step, amortizing consensus, fsync and network cost.',
      'buffer-eviction': 'Static allocation at startup (no malloc after init); grid blocks are cached in a set-associative cache using CLOCK-style eviction.',
      'concurrency-control': 'No concurrency control: the primary orders batches into a single log and each replica applies them sequentially, deterministically, giving strict serializability (Calvin-like determinism, but no sharded transactions).',
      recovery: 'Replicated log of prepares (VSR) with periodic checkpoints of the LSM; protocol-aware recovery repairs corrupted or lost WAL/grid blocks from other replicas using checksums (see the FAST 2018 paper "Protocol-Aware Recovery for Consensus-Based Storage").',
      replication: 'Viewstamped Replication (VSR, revisited) with flexible quorums; up to 6 replicas, each holding the full dataset; cluster is a single logical shard.',
      consensus: 'VSR is a leader-based replicated state machine, equivalent in structure to Raft/Multi-Paxos; also does view changes and state sync.',
      clock: 'Primary assigns monotonically increasing nanosecond timestamps to transfers; cluster time is synchronised to bound clock error.',
      testing: 'VOPR deterministic simulator runs whole clusters in one process with injected network/disk faults and time-accelerated simulation; plus simulated storage fault injection.'
    },
    strengths: ['Extreme OLTP throughput on hot accounts (10k+ transfers per batch)', 'Strict serializability and strong fault tolerance (storage faults, bit rot)', 'Deterministic simulation testing gives high confidence', 'Bounded memory, predictable latency'],
    weaknesses: ['Domain-specific data model (accounts/transfers only)', 'Single logical shard: capacity limited to one replicated set', 'No SQL, no ad hoc queries', 'Young project'],
    bestFor: 'Payments, ledgers, balances and inventory-like double-entry accounting at very high contention.',
    architectureNotes: 'State machine replication: clients send batched requests to the VSR primary, which assigns a timestamp and op number, writes the prepare to its journal, replicates to backups and commits when a quorum acks. Storage engine (LSM forest) is deterministic and replicas converge to identical on-disk state. Everything is statically allocated; I/O is explicit through io_uring; the code base is testable under the VOPR simulator and Jepsen.',
    refs: [
      { title: 'TigerBeetle docs', url: 'https://docs.tigerbeetle.com/' },
      { title: 'TigerBeetle architecture', url: 'https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/ARCHITECTURE.md' },
      { title: 'Viewstamped Replication Revisited', url: 'https://dspace.mit.edu/handle/1721.1/71763' },
      { title: 'Protocol-Aware Recovery for Consensus-Based Storage', url: 'https://www.usenix.org/system/files/conference/fast18/fast18-alagappan.pdf' }
    ]
  },
  {
    id: 'foundationdb', name: 'FoundationDB', category: 'NoSQL', tags: ['nosql', 'distributed'], since: 2013, language: 'C++ (Flow)',
    oneLiner: 'Ordered transactional key-value store with strict serializability, built and tested under deterministic simulation.',
    choices: {
      'index-structure': 'cow-btree', 'table-organization': 'index-organized', 'page-layout': 'nsm-row',
      scheduling: 'thread-per-core', parallelism: 'inter-query', 'concurrency-control': 'occ', 'mvcc-storage': 'time-travel',
      'isolation-default': 'serializable', recovery: 'command-logging', compression: 'none', replication: 'sync',
      consensus: 'multi-paxos', 'distributed-commit': 'percolator-timestamp', clock: 'timestamp-oracle',
      sharding: 'range', 'storage-architecture': 'shared-nothing'
    },
    details: {
      'index-structure': 'Each storage server keeps an ordered key-value map: SQLite-based B-tree engine (ssd-2), the Redwood copy-on-write versioned B+tree (7.x), or memory engine. Storage servers hold MVCC versions in memory for ~5 s and flush to disk.',
      'table-organization': 'Keyspace is a single ordered byte-string map; higher layers (Record Layer, Document Layer) build tables/indexes using tuple-encoded key prefixes.',
      scheduling: 'Each fdbserver process is single-threaded on the Flow actor framework (cooperative, deterministic); a machine runs one process per core with distinct roles.',
      'concurrency-control': 'Optimistic: a client reads at a read version from the sequencer, buffers writes, and sends read/write conflict ranges at commit; resolvers check that no conflicting write committed after the read version.',
      'mvcc-storage': 'Versions advance ~1M per second; transactions older than 5 s fail ("transaction_too_old"). Storage servers apply committed mutations from TLogs in version order.',
      recovery: 'Commit proxies push the mutation batch to all TLogs in the replication set and ack after all (or replication-factor many) fsync; storage servers pull and apply mutations; recovery re-elects a new generation of the transaction system and bounds the end of the log (epoch) with the sequencer.',
      replication: 'Synchronous to the TLog team (e.g. triple replication) on commit; storage teams replicate shards asynchronously from the log.',
      consensus: 'Coordinators run Paxos to store the cluster file/membership; ClusterController elected through coordinators; data path avoids consensus by using a pipelined commit with a single sequencer.',
      'distributed-commit': 'Commit pipeline: proxies batch -> sequencer assigns commit version -> resolvers check conflicts (sharded by key range) -> TLogs durably log -> ack. Single logical commit order gives strict serializability without 2PC across shards.',
      clock: 'Sequencer (master) hands out read and commit versions; no wall-clock dependence for correctness.',
      sharding: 'Contiguous key ranges (shards ~500 MB) assigned to teams of storage servers; DataDistributor splits, merges and rebalances; shard map lives in the system keyspace.',
      testing: 'Flow simulation runs the entire cluster (network, disk, clocks, machines) in one deterministic thread with fault injection ("buggify"), enabling reproducible bugs.'
    },
    strengths: ['Strict serializable multi-key ACID transactions at scale', 'Unmatched testing discipline (deterministic simulation)', 'Layered design: build SQL/document/record layers on a tiny core', 'Automatic sharding, fast recovery'],
    weaknesses: ['5-second transaction limit and 10 MB size limit', 'Raw KV API: you need a layer for higher-level data modelling', 'Hot key ranges can throttle (single resolver/proxy path)', 'Commit latency includes several network hops'],
    bestFor: 'Foundation for metadata stores, record layers (CloudKit) and workloads that need serializable transactions over sharded KV.',
    architectureNotes: 'Transaction system roles: Sequencer (versions), GRV proxies (read versions), Commit proxies (batching), Resolvers (conflict detection), TLogs (redo log); storage subsystem: Storage servers (key-range shards) and DataDistributor/Ratekeeper. The write path is log-first (TLog) then asynchronous apply; reads go to storage servers at a given version. Whole system is exercised by deterministic simulation.',
    refs: [
      { title: 'FoundationDB: A Distributed Unbundled Transactional Key Value Store (SIGMOD 2021)', url: 'https://www.foundationdb.org/files/fdb-paper.pdf' },
      { title: 'FoundationDB architecture', url: 'https://apple.github.io/foundationdb/architecture.html' },
      { title: 'Simulation and testing', url: 'https://apple.github.io/foundationdb/testing.html' }
    ]
  },
  {
    id: 'umbra-hyper', name: 'Umbra / HyPer', category: 'HTAP', tags: ['oltp', 'olap'], since: 2010, language: 'C++',
    oneLiner: 'TUM research systems: compiled, morsel-parallel, MVCC main-memory-optimised (HyPer) and SSD-based buffer-managed (Umbra) DBMS.',
    choices: {
      'index-structure': 'art', 'table-organization': 'columnar', 'page-layout': 'pax', 'exec-model': 'compiled',
      'data-direction': 'push', 'code-execution': 'hybrid-adaptive', scheduling: 'morsel-driven',
      parallelism: 'intra-operator', 'optimizer-search': 'hypergraph-dphyp', statistics: 'sampling',
      'page-cache': 'buffer-pool', 'concurrency-control': 'mvcc-timestamp', 'mvcc-storage': 'delta-undo',
      'isolation-default': 'serializable', recovery: 'aries-steal-noforce', compression: 'dictionary',
      'secondary-index': 'zonemap-minmax', 'plan-cache': 'none', 'distributed-commit': 'none-single-node',
      'storage-architecture': 'shared-nothing'
    },
    details: {
      'index-structure': 'Adaptive Radix Tree (ART) for primary/secondary indexes with optimistic lock coupling / ROWEX synchronisation; HyPer originally for in-memory, Umbra adds B+trees on buffer-managed pages.',
      'table-organization': 'HyPer: hybrid; hot data row-wise, cold chunks frozen into compressed, PAX-like Data Blocks with SMAs/PSMAs (lightweight indexes). Umbra: page-based storage with a unified buffer manager supporting variable-size pages (details vary by version).',
      'exec-model': 'Data-centric query compilation: pipelines are fused into tight loops (produce/consume), run for whole pipelines with data kept in registers.',
      'code-execution': 'HyPer compiled via LLVM IR. Umbra adds "Flying Start" (a custom assembler-like backend) and adaptive execution: begin with a bytecode interpreter or quick compiled code and switch to optimised LLVM code while the query runs.',
      scheduling: 'Morsel-driven parallelism (Leis et al. SIGMOD 2014): NUMA-aware work-stealing over ~100k-tuple morsels, dynamic parallelism per pipeline, elasticity under concurrent queries.',
      'optimizer-search': 'Cost-based with DPhyp-style enumeration for complex join graphs plus adaptive fallbacks to greedy/linearised search for very large queries; unnesting of arbitrary subqueries (Neumann/Kemper).',
      statistics: 'Sampling-based cardinality estimation on tables and base-table filters plus synopses; HyperLogLog sketches used for distinct counts.',
      'concurrency-control': 'Multi-version concurrency control tailored to main-memory: in-place updates with newest-to-oldest version chains in undo buffers, fast serializability validation with precision locking (HyPer paper).',
      'mvcc-storage': 'Newest version stored in place; undo/delta records chain older versions per transaction; garbage collected when no active snapshot needs them.',
      recovery: 'HyPer: redo logging + fork()-based or snapshot checkpoints. Umbra: write-ahead logging over its buffer manager with steal / no-force semantics.',
      compression: 'Data Blocks use truncation (frame of reference), dictionary and single-value compression per attribute chunk, enabling SIMD predicate evaluation on compressed data.'
    },
    strengths: ['State-of-the-art analytic and mixed (CH-benCHmark) performance', 'Adaptive compile latency hides code-gen cost', 'Sophisticated optimizer and unnesting', 'Research reference for push-based compiled engines'],
    weaknesses: ['Research/academic systems (HyPer acquired by Tableau; Umbra is a commercial/academic project)', 'Not open source / limited ecosystem', 'Single node (scale-up), no distributed story', 'Compiled code complexity'],
    bestFor: 'High-performance single-node HTAP and analytics; the architecture most often cited for compiled query execution and morsel-driven scheduling.',
    architectureNotes: 'Pipeline = unit of compilation and parallelism; pipeline breakers materialise into hash tables/sort buffers shared across workers. Workers pull morsels from a dispatcher; a morsel lives and runs on a NUMA-local core. Query compilation proceeds in stages (algebra -> pipelines -> IR -> machine code) with adaptive switching. Umbra supplements this with a buffer manager that handles variable-sized pages and pointer-swizzling-like fast paths so hot data is accessed at in-memory speed.',
    refs: [
      { title: 'Umbra: A Disk-Based System with In-Memory Performance (CIDR 2020)', url: 'https://db.in.tum.de/~freitag/papers/p29-neumann-cidr20.pdf' },
      { title: 'Efficiently Compiling Efficient Query Plans for Modern Hardware (VLDB 2011)', url: 'https://www.vldb.org/pvldb/vol4/p539-neumann.pdf' },
      { title: 'Morsel-Driven Parallelism (SIGMOD 2014)', url: 'https://db.in.tum.de/~leis/papers/morsels.pdf' },
      { title: 'Fast Serializable MVCC for Main-Memory DBMS (SIGMOD 2015)', url: 'https://db.in.tum.de/~muehlbau/papers/mvcc.pdf' }
    ]
  },
  {
    id: 'bigtable', name: 'Google Bigtable', category: 'NoSQL', tags: ['nosql', 'distributed'], since: 2005, language: 'C++',
    oneLiner: 'Sparse, sorted, multi-versioned map split into tablets, stored as SSTables on GFS/Colossus, coordinated via Chubby.',
    choices: {
      'index-structure': 'lsm', 'table-organization': 'lsm-kv', 'page-layout': 'nsm-row', scheduling: 'thread-pool',
      parallelism: 'inter-query', 'buffer-eviction': 'lru', 'concurrency-control': 'mvcc-timestamp', 'mvcc-storage': 'append-only',
      'isolation-default': 'serializable', recovery: 'command-logging', compression: 'lz4-zstd', 'secondary-index': 'bloom',
      replication: 'async', consensus: 'none-primary-backup', 'distributed-commit': 'none-single-node', sharding: 'range',
      'storage-architecture': 'shared-disk'
    },
    details: {
      'index-structure': 'Tablet server keeps a sorted memtable in memory plus immutable SSTables on GFS (Colossus today); minor compaction flushes the memtable, merging/major compactions rewrite SSTables and drop deleted data.',
      'table-organization': 'Map (row:string, column family:qualifier, timestamp:int64) -> value. Rows sorted lexicographically; column families are access-control and locality units (locality groups stored in separate SSTables).',
      'concurrency-control': 'Single-row transactions (atomic read-modify-write on one row); no multi-row transactions. Cells are versioned by timestamp (client or server).',
      'isolation-default': 'Strong consistency for operations on a single row; no cross-row isolation guarantee.',
      recovery: 'Writes go to a commit log (one per tablet server, shared across tablets) on GFS, then to the memtable; recovery replays the log segment sorted by (table,row,seq) after tablet reassignment.',
      compression: 'Two-pass: BMDiff (long common strings) then Zippy (fast LZ-style) per SSTable block; users choose per locality group.',
      'secondary-index': 'Optional Bloom filters per locality group avoid disk seeks for non-existent row/column pairs; block cache and scan cache sit above SSTables.',
      consensus: 'The master is chosen and tablet servers hold leases via Chubby (a Paxos-replicated lock service); each tablet is served by exactly one tablet server at a time. Data durability/replication is delegated to GFS/Colossus.',
      sharding: 'Tablets are row-key ranges (~100-200 MB) split dynamically; the master assigns tablets to servers; location metadata is stored in a three-level METADATA hierarchy rooted in Chubby.',
      replication: 'Within a cluster replication is done by the file system; Cloud Bigtable offers async multi-cluster replication.',
      'storage-architecture': 'Compute (tablet servers) is separated from storage (GFS/Colossus), which makes moving tablets cheap: only metadata changes.'
    },
    strengths: ['Massive scale with sorted range scans', 'Cheap tablet movement thanks to separated storage', 'Excellent write throughput (LSM)', 'Foundation for HBase, Cassandra data model'],
    weaknesses: ['Single-row transactions only', 'Schema design driven by row-key choice (hotspots)', 'No secondary indexes or joins', 'Dependent on lock service and DFS'],
    bestFor: 'Large-scale analytics inputs, time series and wide sparse tables with key-based access.',
    architectureNotes: 'Three components: client library, one master (tablet assignment, schema changes, GC, load balancing) and many tablet servers. Chubby holds the root tablet location, server liveness leases and schemas. Tablets are persisted as SSTable files with block index; reads merge memtable + SSTables; writes go to commit log + memtable. Cloud Bigtable exposes the same model with managed autoscaling.',
    refs: [
      { title: 'Bigtable: A Distributed Storage System for Structured Data (OSDI 2006)', url: 'https://research.google/pubs/bigtable-a-distributed-storage-system-for-structured-data/' },
      { title: 'The Chubby Lock Service', url: 'https://research.google/pubs/the-chubby-lock-service-for-loosely-coupled-distributed-systems/' },
      { title: 'The Google File System', url: 'https://research.google/pubs/the-google-file-system/' }
    ]
  },
  {
    id: 'vitess', name: 'Vitess', category: 'distributed-SQL', tags: ['oltp', 'distributed'], since: 2011, language: 'Go',
    oneLiner: 'Sharding and orchestration layer over MySQL: vtgate routes queries, vttablet manages each MySQL, vindexes map rows to shards.',
    choices: {
      'index-structure': 'bplustree', 'table-organization': 'index-organized', 'page-layout': 'nsm-row', 'exec-model': 'volcano',
      'data-direction': 'pull', scheduling: 'thread-per-connection', parallelism: 'intra-query-exchange',
      'optimizer-search': 'heuristic-rules', 'buffer-eviction': 'lru', 'page-cache': 'buffer-pool',
      'concurrency-control': '2pl', 'mvcc-storage': 'delta-undo', 'isolation-default': 'repeatable-read',
      'deadlock-handling': 'wait-for-graph', recovery: 'aries-steal-noforce', compression: 'lz4-zstd',
      'secondary-index': 'btree', 'plan-cache': 'normalized-literals', replication: 'semi-sync', 'replication-log': 'row-binlog',
      consensus: 'none-primary-backup', 'distributed-commit': 'two-phase-commit', sharding: 'directory-vindex',
      'storage-architecture': 'shared-nothing'
    },
    details: {
      'index-structure': 'Per-shard storage is plain MySQL/InnoDB (clustered B+tree). Vitess adds lookup vindexes: a sharded lookup table mapping a secondary column to the keyspace ID (a global secondary index implemented as another sharded table).',
      'exec-model': 'vtgate\'s engine composes primitives (Route, Join, Aggregate, Sort, Limit); cross-shard joins use nested-loop style (apply join) with the left side driving bind-variable queries to the right side. Single-shard queries are pushed down entirely.',
      scheduling: 'vtgate is a Go service with goroutines; each vttablet holds connection pools (query-service pool, transaction pool, stream pool) to its local mysqld, whose threads are per connection.',
      'optimizer-search': 'Gen4 planner: operator tree with cost-based routing choices (greedy-ish join ordering using shard counts) and pushdown of as much work as possible into a single MySQL route; not a full memo-based optimizer.',
      'plan-cache': 'vtgate caches plans keyed by normalized SQL (literals replaced by bind variables) plus keyspace, shared across sessions.',
      'concurrency-control': 'Per-shard transactions use InnoDB 2PL + MVCC. Multi-shard transactions can be best-effort (commit order) or atomic (two-phase commit with a transaction coordinator and metadata manager) via transaction_mode.',
      replication: 'Primary/replica MySQL with asynchronous or semi-sync replication; vttablet tracks lag, handles reparenting (PlannedReparentShard/EmergencyReparentShard), and topo server (etcd/ZooKeeper/Consul) stores cluster metadata.',
      'replication-log': 'MySQL binlog drives replicas, VReplication (MoveTables, Reshard, materialized views) streams binlog events per shard with filters.',
      sharding: 'Vindexes map column values to a 64-bit keyspace ID (hash, unicode_loose_md5, consistent lookup, region_json...); keyspace IDs are divided into ranges per shard (e.g. -80, 80-). Primary vindex determines placement.',
      'distributed-commit': 'Atomic distributed transactions use 2PC with a designated Metadata Manager shard and a transaction resolver for prepared/failed transactions; the default mode is best-effort multi-shard commit.',
      consensus: 'None inside a shard (MySQL replication); orchestrator/VTOrc automate failover; metadata consensus is delegated to etcd/ZooKeeper.'
    },
    strengths: ['Scales MySQL horizontally while keeping the MySQL wire protocol', 'Online resharding (VReplication), schema changes, and connection pooling', 'Battle-tested at YouTube, Slack, GitHub', 'Query routing/pushdown keeps single-shard OLTP fast'],
    weaknesses: ['Cross-shard joins/aggregations are slower and limited', 'Cross-shard transactions are not ACID by default', 'Operational complexity (topo, vttablets, vtctld, VTOrc)', 'Inherits MySQL limits on each shard'],
    bestFor: 'Scaling large MySQL OLTP fleets through horizontal sharding with online resharding.',
    architectureNotes: 'Application connects to vtgate (stateless proxy speaking MySQL protocol/gRPC), which parses, plans and routes using the VSchema (keyspaces, tables, vindexes) cached from the topology server. Each shard has a primary and replicas, each fronted by vttablet which provides connection pooling, query rewriting/limits, health checks and replication control over a local mysqld. vtctld/vtorc handle admin and failover.',
    refs: [
      { title: 'Vitess architecture', url: 'https://vitess.io/docs/overview/architecture/' },
      { title: 'Vitess vindexes', url: 'https://vitess.io/docs/reference/features/vindexes/' },
      { title: 'Vitess VReplication', url: 'https://vitess.io/docs/reference/vreplication/vreplication/' }
    ]
  },
  {
    id: 'cockroachdb', name: 'CockroachDB', category: 'distributed-SQL', tags: ['oltp', 'distributed'], since: 2015, language: 'Go',
    oneLiner: 'Distributed SQL on an MVCC key-value store (Pebble LSM) with Raft-replicated ranges and serializable transactions.',
    choices: {
      'index-structure': 'lsm', 'table-organization': 'lsm-kv', 'page-layout': 'nsm-row', 'exec-model': 'vectorized',
      'data-direction': 'pull', 'code-execution': 'precompiled-primitives', scheduling: 'thread-pool',
      parallelism: 'intra-query-exchange', 'optimizer-search': 'top-down-cascades', statistics: 'equi-depth-histogram',
      'buffer-eviction': 'clock', 'page-cache': 'buffer-pool', 'concurrency-control': 'mvcc-ssi', 'mvcc-storage': 'time-travel',
      'isolation-default': 'serializable', 'deadlock-handling': 'wait-for-graph', recovery: 'command-logging', compression: 'lz4-zstd',
      'secondary-index': 'btree', 'plan-cache': 'prepared-stmt', replication: 'quorum-raft', 'replication-log': 'physical-wal',
      consensus: 'raft', 'distributed-commit': 'percolator-timestamp', clock: 'hlc', sharding: 'range',
      'storage-architecture': 'shared-nothing'
    },
    details: {
      'index-structure': 'Each node stores key-value data in Pebble (RocksDB-compatible Go LSM). Table rows and indexes are encoded into the single ordered keyspace; MVCC timestamps are suffixed on keys.',
      'table-organization': 'Primary index holds the full row (one KV per column family); secondary indexes are separate key ranges. Data is cut into ranges (~512 MB) which are the unit of replication and rebalancing.',
      'exec-model': 'Vectorized engine (colexec) processes columnar batches (1024 rows) for suitable plans; the row engine remains for others. DistSQL pushes flows to the nodes that hold the data.',
      'optimizer-search': 'Cascades-style cost-based optimizer (optgen-generated rules, memo, physical properties) with locality-aware costing and statistics from histograms.',
      'concurrency-control': 'Serializable MVCC: transactions get a provisional commit timestamp from the HLC; writes lay down intents; read-write conflicts can push timestamps, with read refreshes to avoid restarts. Contended rows are queued in a lock table.',
      'mvcc-storage': 'All versions kept until the GC TTL (default 4 h in recent versions, 25 h earlier), enabling AS OF SYSTEM TIME historical and follower reads.',
      'deadlock-handling': 'Transaction record pushes with distributed deadlock detection via the wait-for graph in the txn wait queue.',
      recovery: 'Raft log per range plus Pebble WAL; replicas replay committed Raft entries. Snapshots rebuild lagging replicas.',
      replication: 'Each range is a Raft group (default 3 replicas, configurable zones/regions); writes commit when a quorum persists them.',
      consensus: 'Per-range Raft with leaseholders serving consistent reads without a Raft round; leader leases and epoch-based liveness.',
      'distributed-commit': 'Parallel commits: write intents plus a STAGING transaction record, then ack to client as soon as all writes are replicated, finalising the record asynchronously. Percolator-like but with record-based atomicity.',
      clock: 'Hybrid logical clock with max clock offset (500 ms default); uncertainty intervals restart reads; no atomic clocks required.',
      sharding: 'Range partitioning of the keyspace with automatic splits/merges by size and load.'
    },
    strengths: ['Serializable isolation by default with geo-replication', 'Automatic sharding, rebalancing and survival goals', 'Postgres wire/SQL compatibility', 'Follower reads and locality-aware placement'],
    weaknesses: ['Higher latency for cross-region writes (consensus + commit)', 'Transaction retry errors under contention', 'Not as fast for single-node OLTP/analytics as specialised engines', 'Licence change (BSL / enterprise)'],
    bestFor: 'Globally distributed OLTP needing strong consistency and automated operations.',
    architectureNotes: 'Layers: SQL (parse/optimize/execute) -> SQL transactional KV (distributed transaction coordinator, TxnCoordSender) -> distribution (range addressing via meta ranges) -> replication (Raft, leaseholders) -> storage (Pebble MVCC). Gateway node plans the query; DistSQL runs flows near the data.',
    refs: [
      { title: 'CockroachDB architecture overview', url: 'https://www.cockroachlabs.com/docs/stable/architecture/overview' },
      { title: 'CockroachDB: The Resilient Geo-Distributed SQL Database (SIGMOD 2020)', url: 'https://dl.acm.org/doi/10.1145/3318464.3386134' },
      { title: 'Transaction layer', url: 'https://www.cockroachlabs.com/docs/stable/architecture/transaction-layer' }
    ]
  },
  {
    id: 'spanner', name: 'Google Spanner', category: 'distributed-SQL', tags: ['oltp', 'distributed'], since: 2012, language: 'C++',
    oneLiner: 'Globally distributed SQL database with externally consistent transactions using TrueTime, Paxos groups and 2PC.',
    choices: {
      'index-structure': 'lsm', 'table-organization': 'index-organized', 'page-layout': 'pax', 'concurrency-control': '2pl',
      'mvcc-storage': 'time-travel', 'isolation-default': 'serializable', 'deadlock-handling': 'wait-die-wound-wait',
      recovery: 'command-logging', replication: 'quorum-raft', consensus: 'multi-paxos', 'distributed-commit': 'two-phase-commit',
      clock: 'truetime', sharding: 'range', 'storage-architecture': 'shared-disk'
    },
    details: {
      'index-structure': 'The state of each split is an LSM-style set of immutable files on Colossus (the original paper describes a Bigtable-like SSTable store; newer versions use the "Ressi" format); writes are sequenced by the Paxos log.',
      'table-organization': 'Tables are key-ordered by primary key; INTERLEAVE IN PARENT physically co-locates child rows with their parent row so related data shares a split.',
      'page-layout': 'Ressi stores data in a PAX-like layout with column-wise blocks within a row range.',
      'concurrency-control': 'Read-write transactions use pessimistic two-phase locking at the leader of each Paxos group with wound-wait deadlock avoidance; read-only transactions and snapshot reads are lock-free at a timestamp.',
      'mvcc-storage': 'Every value is versioned by commit timestamp; stale reads and read-only transactions read at a chosen timestamp (time travel within the GC window).',
      'isolation-default': 'External consistency (strict serializability): if T1 commits before T2 starts, T1\'s commit timestamp is smaller.',
      recovery: 'Each split replica applies the Paxos log to its tablet state; leaders write a log record per mutation (and for 2PC prepare/commit).',
      replication: 'Each split is a Paxos group with typically 3-5 replicas across zones/regions; majority needed for writes; read-only replicas available.',
      consensus: 'Multi-Paxos with long-lived leader leases (~10 s) per group.',
      'distributed-commit': 'Transactions spanning splits run 2PC with one Paxos group as coordinator; both coordinator and participants are replicated, so 2PC does not block on node failure.',
      clock: 'TrueTime API returns an interval [earliest, latest] using GPS and atomic clocks; commit wait delays the commit ack until TT.after(commit timestamp) is true, giving external consistency.',
      sharding: 'Data is partitioned into splits by key range; automatically split by size/load and moved between servers.'
    },
    strengths: ['External consistency across the globe', 'Fully managed with automatic sharding and failover', 'Lock-free consistent reads at timestamps', 'SQL with schema changes online'],
    weaknesses: ['Commit wait + cross-region Paxos adds write latency', 'Requires special hardware (TrueTime) - effectively Google-hosted only', 'Cost and proprietary', 'Limited transaction duration/mutation limits'],
    bestFor: 'Mission-critical globally distributed OLTP needing strong consistency at massive scale.',
    architectureNotes: 'A universe contains zones; each zone has a zonemaster and spanservers (hundreds to thousands). Each spanserver manages 100-1000 tablets/splits and runs a Paxos state machine per tablet, with a lock table and transaction manager on the leader. Data stored in Colossus. Placement driver moves directories (splits) to balance load and satisfy locality constraints.',
    refs: [
      { title: 'Spanner: Google\'s Globally-Distributed Database (OSDI 2012)', url: 'https://research.google/pubs/spanner-googles-globally-distributed-database-2/' },
      { title: 'Spanner: Becoming a SQL System (SIGMOD 2017)', url: 'https://research.google/pubs/spanner-becoming-a-sql-system/' },
      { title: 'Spanner TrueTime and external consistency', url: 'https://cloud.google.com/spanner/docs/true-time-external-consistency' }
    ]
  },
  {
    id: 'snowflake', name: 'Snowflake', category: 'OLAP', tags: ['olap', 'distributed'], since: 2014, language: 'C++ / Java',
    oneLiner: 'Cloud data warehouse with compute (virtual warehouses) separated from immutable micro-partitions on object storage.',
    choices: {
      'table-organization': 'columnar', 'page-layout': 'pax', 'exec-model': 'vectorized', 'data-direction': 'push',
      'code-execution': 'precompiled-primitives', scheduling: 'thread-pool', parallelism: 'intra-query-exchange',
      'optimizer-search': 'top-down-cascades', 'page-cache': 'buffer-pool', 'concurrency-control': 'mvcc-timestamp',
      'mvcc-storage': 'time-travel', 'isolation-default': 'read-committed', 'deadlock-handling': 'timeout',
      recovery: 'shadow-cow', 'secondary-index': 'zonemap-minmax', 'plan-cache': 'none', replication: 'async',
      'distributed-commit': 'none-single-node', sharding: 'hash', 'storage-architecture': 'disaggregated-object-store'
    },
    details: {
      'table-organization': 'Tables are broken into immutable micro-partitions (50-500 MB uncompressed) in a proprietary columnar PAX-like format on S3/Blob/GCS; metadata holds per-column min/max and distinct counts per partition.',
      'exec-model': 'Columnar, vectorized, push-based engine with no buffering of intermediate data to disk unless spilling is needed (per the SIGMOD 2016 paper).',
      scheduling: 'Virtual warehouses (clusters of EC2-like workers) execute queries; workers cache table file headers/column data on local SSD; work is distributed per file with work stealing (file stealing) to mitigate stragglers.',
      'optimizer-search': 'Cascades-style top-down optimizer in the cloud services layer using micro-partition metadata for pruning and cost estimation.',
      'concurrency-control': 'Snapshot isolation via MVCC over immutable files: writes create new micro-partitions and a new table version in the metadata store (FoundationDB).',
      'mvcc-storage': 'Old micro-partitions are retained for Time Travel (1 to 90 days) and Fail-safe (7 more days); enables UNDROP and zero-copy clones.',
      'isolation-default': 'Read committed at statement level; each statement sees a consistent snapshot; DML takes table-level locks (partition-level write conflicts).',
      recovery: 'No ARIES: object storage is durable and files are immutable; commits atomically update metadata in FoundationDB.',
      'secondary-index': 'No user indexes: pruning uses micro-partition metadata (zone maps), optionally clustering keys, search optimization service and materialized views.',
      'storage-architecture': 'Three layers: storage (object store), compute (virtual warehouses), cloud services (metadata, optimizer, security) - fully elastic and multi-cluster.'
    },
    strengths: ['Elastic, independent scaling of storage and compute', 'Near-zero administration, concurrency via multi-cluster warehouses', 'Zero-copy clones and time travel', 'Semi-structured data (VARIANT) support'],
    weaknesses: ['Proprietary and cloud-only, cost can balloon', 'Not for OLTP / low-latency point updates (unistore aside)', 'Limited tuning knobs / indexes', 'Cold-cache latency on warehouse start'],
    bestFor: 'Cloud data warehousing, BI with bursty concurrency, data sharing.',
    architectureNotes: 'Cloud services layer (metadata in FoundationDB, optimizer, transaction manager) is stateless-ish and multi-tenant; virtual warehouses are ephemeral compute clusters with local SSD caches that fetch micro-partitions from object storage; storage holds immutable micro-partitions. Queries are pruned using partition metadata, then workers scan only needed columns via range reads, pushing filters into scans. Result cache and metadata cache short-circuit repeated work.',
    refs: [
      { title: 'The Snowflake Elastic Data Warehouse (SIGMOD 2016)', url: 'https://dl.acm.org/doi/10.1145/2882903.2903741' },
      { title: 'Building An Elastic Query Engine on Disaggregated Storage (NSDI 2020)', url: 'https://www.usenix.org/conference/nsdi20/presentation/vuppalapati' },
      { title: 'Micro-partitions and data clustering', url: 'https://docs.snowflake.com/en/user-guide/tables-clustering-micropartitions' }
    ]
  },
  {
    id: 'rocksdb', name: 'RocksDB', category: 'embedded', tags: ['embedded', 'nosql'], since: 2012, language: 'C++',
    oneLiner: 'Embeddable LSM-tree key-value storage engine (LevelDB fork) widely used as the storage layer of other databases.',
    choices: {
      'index-structure': 'lsm', 'table-organization': 'lsm-kv', 'page-layout': 'nsm-row', scheduling: 'thread-pool',
      parallelism: 'inter-query', 'buffer-eviction': 'lru', 'page-cache': 'buffer-pool', 'concurrency-control': 'mvcc-timestamp',
      'mvcc-storage': 'append-only', 'isolation-default': 'snapshot', 'deadlock-handling': 'wait-for-graph',
      recovery: 'command-logging', compression: 'lz4-zstd', 'secondary-index': 'bloom', 'plan-cache': 'none',
      'distributed-commit': 'none-single-node', 'storage-architecture': 'shared-nothing'
    },
    details: {
      'index-structure': 'Memtable (skiplist by default; hash-skiplist/vector options) + WAL -> immutable SST files in levels L0..Ln. Leveled compaction (default) targets ~10x level size ratio; universal and FIFO compaction available. Block-based table: data blocks, index block (partitioned optional), filter block.',
      'table-organization': 'Ordered byte-string keys and values grouped in column families that share the WAL but have their own memtables/SSTs. Higher layers (MyRocks, CockroachDB, TiKV, Kafka Streams) build tables on top.',
      scheduling: 'Background thread pools for flush (high priority) and compaction (low priority) with rate limiter; subcompactions split big compactions.',
      'buffer-eviction': 'Sharded block cache (LRU or HyperClockCache) caches uncompressed data/index/filter blocks; pinning options for L0 index/filters.',
      'concurrency-control': 'Writes get sequence numbers; snapshots read at a sequence number. TransactionDB gives pessimistic locking; OptimisticTransactionDB validates write conflicts at commit.',
      'deadlock-handling': 'Pessimistic TransactionDB offers optional wait-for-graph deadlock detection and lock timeouts.',
      recovery: 'WAL replay into memtables; MANIFEST file logs version edits (SST add/remove); atomic flush across column families optional.',
      compression: 'Per-level choice: Snappy/LZ4 for upper levels, ZSTD for the bottom level; optional dictionary compression and prefix delta-encoding of keys within blocks.',
      'secondary-index': 'Bloom/Ribbon filters per SST (and prefix/whole-key) avoid disk reads for absent keys; no secondary indexes, applications maintain their own.',
      replication: 'None built-in; engines above provide replication (e.g. Raft in TiKV/CockroachDB).'
    },
    strengths: ['High write throughput with tunable amplification trade-offs', 'Highly configurable (compaction styles, caches, rate limits)', 'Embeds easily; production-proven (Facebook)', 'Foundation of many databases'],
    weaknesses: ['Read and space amplification need tuning', 'Compaction stalls / write stalls', 'Many knobs; easy to misconfigure', 'No SQL, no replication, no network layer'],
    bestFor: 'Embedded persistent KV storage for databases, streaming state and indexes.',
    architectureNotes: 'Write path: WAL append -> memtable insert -> (when full) flush to L0 SST -> background compaction merges into deeper levels. Read path: memtable -> immutable memtables -> L0 files (overlapping) -> one candidate file per deeper level, using bloom filters and the block cache. A MANIFEST tracks the live file set (version set); snapshots pin sequence numbers and file versions.',
    refs: [
      { title: 'RocksDB overview', url: 'https://github.com/facebook/rocksdb/wiki/RocksDB-Overview' },
      { title: 'RocksDB compaction', url: 'https://github.com/facebook/rocksdb/wiki/Compaction' },
      { title: 'RocksDB: Evolution of Development Priorities (TOS 2021)', url: 'https://www.usenix.org/conference/fast21/presentation/dong' }
    ]
  },
  {
    id: 'bigquery', name: 'Google BigQuery', category: 'OLAP', tags: ['olap', 'distributed'], since: 2011, language: 'C++ / Java',
    oneLiner: 'Serverless warehouse on the Dremel execution engine: Capacitor columnar files on Colossus and an in-memory shuffle tier.',
    choices: {
      'table-organization': 'columnar', 'page-layout': 'dsm-column', 'exec-model': 'vectorized', 'data-direction': 'push',
      scheduling: 'thread-pool', parallelism: 'intra-query-exchange', 'concurrency-control': 'mvcc-timestamp',
      'mvcc-storage': 'time-travel', 'isolation-default': 'snapshot', recovery: 'shadow-cow', compression: 'rle',
      'secondary-index': 'zonemap-minmax', 'plan-cache': 'none', sharding: 'hash', 'storage-architecture': 'disaggregated-object-store'
    },
    details: {
      'table-organization': 'Capacitor columnar format stores each column separately with repetition/definition levels for nested data (from Dremel); tables are sets of immutable files (blocks) on Colossus, reordered and re-clustered by background optimisation.',
      'exec-model': 'Dremel execution trees evolved into a DAG of stages with workers (slots) reading Capacitor data; intermediate results go through a distributed in-memory shuffle service (separate from workers) enabling dynamic repartitioning.',
      scheduling: 'Slots (units of CPU/RAM) are dynamically assigned to stages by the scheduler; on-demand pricing shares a large pool, reservations give dedicated slots.',
      parallelism: 'Query is split into stages; each stage runs thousands of workers in parallel; shuffle tier repartitions between stages by key.',
      'concurrency-control': 'Snapshot isolation for queries; DML and multi-statement transactions use optimistic concurrency with table-level conflict detection; load jobs are atomic.',
      'mvcc-storage': 'Time travel to any point in the last 7 days (configurable 2-7) by retaining old file versions; fail-safe 7 more days.',
      compression: 'Capacitor chooses encodings per column chunk (dictionary, RLE, delta, etc.) and reorders rows to maximise run lengths.',
      'secondary-index': 'No indexes in the usual sense: partitioning and clustering metadata prune blocks; search indexes available for text lookups.',
      'storage-architecture': 'Storage on Colossus is decoupled from compute and shuffle (Jupiter network); all state lives off the workers, so queries scale independently.'
    },
    strengths: ['Serverless; scales to petabytes with no cluster management', 'Separation of compute, storage and shuffle', 'Nested/repeated data handled natively', 'Strong integration with Google Cloud'],
    weaknesses: ['Black box tuning; cost model tied to bytes scanned or slots', 'Not for OLTP or low-latency point lookups', 'Limited DML throughput', 'Vendor lock-in'],
    bestFor: 'Serverless ad hoc analytics and large-scale ELT on Google Cloud.',
    architectureNotes: 'Separated layers: Colossus storage with Capacitor files and metadata (Spanner-backed), the Dremel query engine (root server, stage workers), an in-memory shuffle tier, Borg for resource management and Jupiter for networking. The planner prunes partitions/blocks via metadata, builds a stage DAG and may dynamically re-plan (e.g. repartition) using runtime statistics.',
    refs: [
      { title: 'Dremel: Interactive Analysis of Web-Scale Datasets', url: 'https://research.google/pubs/dremel-interactive-analysis-of-web-scale-datasets-2/' },
      { title: 'BigQuery storage overview', url: 'https://cloud.google.com/bigquery/docs/storage_overview' },
      { title: 'Inside Capacitor, BigQuery\'s columnar storage format', url: 'https://cloud.google.com/blog/products/bigquery/inside-capacitor-bigquerys-next-generation-columnar-storage-format' }
    ]
  }
];

export const featureRows = [
  { key: 'category', label: 'Category' },
  { key: 'since', label: 'First release' },
  { key: 'language', label: 'Implementation language' },
  { key: 'index-structure', label: 'Primary index structure', slot: 'index-structure' },
  { key: 'table-organization', label: 'Table organization', slot: 'table-organization' },
  { key: 'page-layout', label: 'Page / tuple layout', slot: 'page-layout' },
  { key: 'exec-model', label: 'Execution model', slot: 'exec-model' },
  { key: 'data-direction', label: 'Data flow direction', slot: 'data-direction' },
  { key: 'code-execution', label: 'Code execution', slot: 'code-execution' },
  { key: 'scheduling', label: 'Scheduling', slot: 'scheduling' },
  { key: 'parallelism', label: 'Parallelism', slot: 'parallelism' },
  { key: 'optimizer-search', label: 'Optimizer search', slot: 'optimizer-search' },
  { key: 'statistics', label: 'Statistics', slot: 'statistics' },
  { key: 'buffer-eviction', label: 'Buffer eviction', slot: 'buffer-eviction' },
  { key: 'page-cache', label: 'Page cache / I/O', slot: 'page-cache' },
  { key: 'concurrency-control', label: 'Concurrency control', slot: 'concurrency-control' },
  { key: 'mvcc-storage', label: 'MVCC storage', slot: 'mvcc-storage' },
  { key: 'isolation-default', label: 'Default isolation', slot: 'isolation-default' },
  { key: 'deadlock-handling', label: 'Deadlock handling', slot: 'deadlock-handling' },
  { key: 'recovery', label: 'Recovery', slot: 'recovery' },
  { key: 'compression', label: 'Compression', slot: 'compression' },
  { key: 'secondary-index', label: 'Secondary / skip index', slot: 'secondary-index' },
  { key: 'plan-cache', label: 'Plan cache', slot: 'plan-cache' },
  { key: 'replication', label: 'Replication', slot: 'replication' },
  { key: 'replication-log', label: 'Replication log', slot: 'replication-log' },
  { key: 'consensus', label: 'Consensus', slot: 'consensus' },
  { key: 'distributed-commit', label: 'Distributed commit', slot: 'distributed-commit' },
  { key: 'clock', label: 'Clock', slot: 'clock' },
  { key: 'sharding', label: 'Sharding', slot: 'sharding' },
  { key: 'storage-architecture', label: 'Storage architecture', slot: 'storage-architecture' }
];

export default systems;
