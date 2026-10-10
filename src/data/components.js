import front from './parts/c-front.js';
import plan from './parts/c-plan.js';
import exec from './parts/c-exec.js';
import txn from './parts/c-txn.js';
import store1 from './parts/c-store1.js';
import store2 from './parts/c-store2.js';
import dist from './parts/c-dist.js';
// Aggregator: component catalogue (see CONTRACT.md). Authoring helper lives in parts/_h.js.
export default [...front, ...plan, ...exec, ...txn, ...store1, ...store2, ...dist];
