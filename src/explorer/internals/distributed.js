// internals-E2: distributed & cloud component views. Merged from part files.
import { views as routing } from './d-routing.js';          // router-coordinator, sharding
import { views as replication } from './d-replication.js';  // replication, consensus
import { views as consensus } from './d-consensus.js';      // consensus (Raft / Multi-Paxos)
import { views as txn } from './d-txn.js';                  // distributed-commit, logical-clocks
import { views as storage } from './d-storage.js';          // disaggregated-storage
export const views = { ...routing, ...replication, ...consensus, ...txn, ...storage };
