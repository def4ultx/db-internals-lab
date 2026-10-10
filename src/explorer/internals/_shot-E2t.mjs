// usage: node _shot-E2.mjs <view> <out.png> [cfg=a:b,c:d] [evalJS...]   (evalJS runs in page w/ window.__h; may use await; `adv(sec)` helper)
import puppeteer from 'puppeteer-core';
const [view, out, cfg = '', ...evals] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 850 });
const errs = [];
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
await p.goto(`http://localhost:5180/src/explorer/internals/_harness-E2t.html?view=${view}&cfg=${cfg}`);
await p.waitForFunction('window.__h && window.__h.ready', { timeout: 20000 }).catch(() => errs.push('harness not ready'));
for (const e of evals) { const r = await p.evaluate(`(async()=>{const h=window.__h;const adv=s=>h.advance(s);${e}})()`).catch(x => errs.push('EVAL: ' + x.message)); if (r !== undefined) console.log('eval=>', JSON.stringify(r)); }
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: out });
console.log('infoText:', (await p.evaluate(() => document.getElementById('info').innerText)).slice(0, 600));
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
await b.close();
