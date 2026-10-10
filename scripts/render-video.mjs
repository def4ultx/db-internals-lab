// Offline deterministic render: node scripts/render-video.mjs [--workers 4] [--fps 30] [--from 0 --to <sec>] [--out public/video/db-internals.mp4] [--port 5182] [--noaudio] [--noserver]
// Steps renderAt(t) per frame in headless Chrome (puppeteer-core), pipes JPEG frames into ffmpeg (libx264). Several workers render time
// slices in parallel into segment files that are concatenated. Narration audio is synthesised with macOS `say` and muxed (skip with --noaudio).
import puppeteer from 'puppeteer-core'; import { spawn, execFileSync } from 'child_process'; import fs from 'fs'; import path from 'path'; import os from 'os';
const a = process.argv.slice(2); const get = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; }; const has = k => a.includes('--' + k);
const FPS = +get('fps', 30), WORKERS = +get('workers', 4), PORT = +get('port', 5182), OUT = path.resolve(get('out', 'public/video/db-internals.mp4'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbvid-'));
let server; let base = `http://localhost:${PORT}`;
async function up() { try { return (await fetch(base + '/video.html')).ok; } catch { return false; } }
if (!(await up()) && !has('noserver')) { const { createServer } = await import('vite'); server = await createServer({ server: { port: PORT, strictPort: true } }); await server.listen(); console.log('started vite on', PORT); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu-vsync', '--force-color-profile=srgb'] });
const probe = await browser.newPage(); await probe.goto(base + '/video.html?render=1'); await probe.waitForFunction('window.__ready', { timeout: 60000 });
const total = await probe.evaluate('window.__vid.total'); const cues = await probe.evaluate('window.__vid.cues'); await probe.close();
const t0 = +get('from', 0), t1 = Math.min(total, +get('to', total)); const nFrames = Math.round((t1 - t0) * FPS);
console.log(`total ${total}s, rendering ${t0}-${t1}s = ${nFrames} frames @${FPS}fps with ${WORKERS} workers`);
const per = Math.ceil(nFrames / WORKERS); const segs = [];
async function worker(w) {
  const f0 = w * per, f1 = Math.min(nFrames, f0 + per); if (f0 >= f1) return; const seg = path.join(tmp, `seg${w}.mp4`); segs[w] = seg;
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2), '-movflags', '+faststart', seg], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise(r => ff.on('close', r));
  const pg = await browser.newPage(); await pg.setViewport({ width: 1920, height: 1080 }); await pg.goto(base + '/video.html?render=1'); await pg.waitForFunction('window.__ready');
  for (let f = f0; f < f1; f++) {
    const t = t0 + f / FPS; const data = await pg.evaluate(t => { window.__vid.renderAt(t); return document.getElementById('c').toDataURL('image/jpeg', 0.93).slice(23); }, t);
    if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    if (w === 0 && f % 300 === 0) console.log(`  worker0 frame ${f}/${f1} (${(100 * f / f1).toFixed(0)}%)`);
  }
  ff.stdin.end(); await done; await pg.close();
}
const tStart = Date.now(); await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w))); await browser.close(); if (server) await server.close();
console.log('frames done in', ((Date.now() - tStart) / 1000).toFixed(0), 's; concatenating');
const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, segs.filter(Boolean).map(s => `file '${s}'`).join('\n'));
const video = path.join(tmp, 'video.mp4'); execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
let audio = null;
if (!has('noaudio') && t0 === 0) { try { // narration with macOS say: one clip per cue, tempo-fit into its slot, delayed to cue time
  const voice = get('voice', 'Samantha'); const clips = []; const wpm = +get('wpm', 165);
  cues.forEach((c, i) => { const aiff = path.join(tmp, `c${i}.aiff`); execFileSync('say', ['-v', voice, '-r', String(wpm), '-o', aiff, c.text]); const next = cues[i + 1] ? cues[i + 1].at : c.at + 12; clips.push({ aiff, at: c.at, slot: next - c.at - .25 }); });
  const inputs = [], filt = []; clips.forEach((c, i) => { inputs.push('-i', c.aiff); const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', c.aiff]).toString()); const tempo = Math.min(1.6, Math.max(1, dur / c.slot)); if (dur / c.slot > 1.15) console.log(`  narration cue ${i} speech ${dur.toFixed(1)}s in ${c.slot.toFixed(1)}s slot -> tempo ${tempo.toFixed(2)}`); filt.push(`[${i}:a]atempo=${tempo.toFixed(3)},adelay=${Math.round(c.at * 1000)}|${Math.round(c.at * 1000)},apad[a${i}]`); });
  const mixIn = clips.map((_, i) => `[a${i}]`).join(''); filt.push(`${mixIn}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,volume=1.0[aout]`);
  audio = path.join(tmp, 'narration.m4a'); execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filt.join(';'), '-map', '[aout]', '-t', String(total), '-c:a', 'aac', '-b:a', '160k', audio], { maxBuffer: 1 << 28 });
} catch (e) { console.log('narration audio skipped:', e.message.split('\n')[0]); audio = null; } }
const args = ['-y', '-loglevel', 'error', '-i', video]; if (audio) args.push('-i', audio); args.push('-c:v', 'copy'); if (audio) args.push('-c:a', 'copy', '-shortest'); args.push('-movflags', '+faststart', OUT);
execFileSync('ffmpeg', args);
const sz = fs.statSync(OUT).size; const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT]).toString().trim();
console.log(`WROTE ${OUT}  ${(sz / 1048576).toFixed(1)} MB  duration ${dur}s  audio=${!!audio}`); fs.rmSync(tmp, { recursive: true, force: true });
