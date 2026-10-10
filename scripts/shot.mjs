// Screenshot frames: node scripts/shot.mjs <outdir> [--port 5182] [--chapter N] [--count 6] | [--t 12.5,40,...]
// Requires dev server running on the port. Writes <outdir>/ch<NN>_t<local>.png (1920x1080). Look at them with the Read tool.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const a = process.argv.slice(2), out = a[0]; fs.mkdirSync(out, { recursive: true });
const get = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const port = get('port', 5182), chap = get('chapter'), count = +get('count', 6), ts = get('t');
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1920, height: 1080 });
pg.on('pageerror', e => console.log('PAGEERROR', e.message)); pg.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await pg.goto(`http://localhost:${port}/video.html?render=1`); await pg.waitForFunction('window.__ready', { timeout: 30000 });
const tl = await pg.evaluate('window.__vid.timeline'); const total = await pg.evaluate('window.__vid.total');
const jobs = [];
if (ts) ts.split(',').forEach(t => { const c = chap ? tl.find(c => c.num === +chap) : null; jobs.push({ g: (c ? c.start : 0) + +t, name: c ? `ch${String(c.num).padStart(2, '0')}_t${t}` : `abs_t${t}` }); });
else for (const c of tl) { if (chap && +chap !== c.num) continue; const n = count; for (let i = 0; i < n; i++) { const lt = 1 + (c.end - c.start - 2) * (i + .5) / n; jobs.push({ g: c.start + lt, name: `ch${String(c.num).padStart(2, '0')}_t${lt.toFixed(1)}` }); } }
for (const j of jobs) { await pg.evaluate(t => window.__vid.renderAt(t), j.g); const el = await pg.$('canvas'); await el.screenshot({ path: `${out}/${j.name}.png` }); console.log(j.name); }
console.log('total', total, JSON.stringify(tl)); await b.close();
