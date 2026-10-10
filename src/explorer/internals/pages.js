import { views as pageFile } from './pages-pagefile.js';
import { views as slotted } from './pages-slotted.js';
import { views as colstore } from './pages-colstore.js';
import { views as compr } from './pages-compression.js';
import { views as secidx } from './pages-secindex.js';
export const views = { ...pageFile, ...slotted, ...colstore, ...compr, ...secidx };
