// usage: node _shotD.mjs <view> <out.png> [config "a:b,c:d"] [evalJS run in page, awaited] [camx,camy,camz]
import puppeteer from 'puppeteer-core';
const [view, out, config = '', js = '', cam = ''] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1500,900'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 900 });
const errs = []; p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
await p.goto(`http://localhost:5178/src/explorer/internals/_harness-D.html?view=${view}&config=${config}`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
if (cam) { const [x, y, z] = cam.split(',').map(Number); await p.evaluate((x, y, z) => window.__h.setCam(x, y, z), x, y, z); }
if (js) { const r = await p.evaluate(`(async()=>{${js}})()`); if (r !== undefined) console.log('EVAL', JSON.stringify(r)); await new Promise((r) => setTimeout(r, 700)); }
await p.screenshot({ path: out });
console.log('ERRORS', errs.length ? errs : 'none');
await b.close();
