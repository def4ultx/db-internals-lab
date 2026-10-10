import chapters from './chapters/index.js';
import { createRenderer } from './engine.js';
const params = new URLSearchParams(location.search);

if (params.has('render')) {          // headless offline-render mode: canvas only, window.__vid.renderAt(t)
  document.body.innerHTML = '<canvas id="c" style="display:block"></canvas>';
  document.body.style.cssText = 'margin:0;padding:0;background:#000'; document.body.classList.remove('has-nav');
  const r = createRenderer(document.getElementById('c'), chapters, { captions: params.get('captions') !== '0' });
  window.__vid = { renderAt: t => r.renderAt(t), total: r.total, cues: r.timeline.chapters.flatMap(c => c.cues.map(q => ({ at: c.start + q.at, text: q.text, chapter: c.num }))), timeline: r.timeline.chapters.map(c => ({ num: c.num, title: c.title, start: c.start, end: c.end, cues: c.cues.length })) };
  r.renderAt(0); window.__ready = true;
} else initPlayer();

function fmt(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

function initPlayer() {
  const app = document.getElementById('app');
  app.innerHTML = `
  <style>
    .vwrap{max-width:1500px;margin:0 auto;padding:18px 20px 60px}
    .vwrap h1{margin:6px 0 4px;font-size:26px}.vwrap .sub{color:var(--dim);margin:0 0 16px}
    .stage{display:grid;grid-template-columns:1fr 300px;gap:16px}
    @media(max-width:1100px){.stage{grid-template-columns:1fr}}
    .screen{background:#000;border:1px solid var(--line);border-radius:10px;overflow:hidden;position:relative}
    .screen canvas,.screen video{width:100%;display:block;aspect-ratio:16/9;background:#000}
    .ctl{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#10141f;border-top:1px solid var(--line);flex-wrap:wrap}
    .ctl button,.ctl select{background:#1b2236;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:6px 11px;cursor:pointer;font-size:14px}
    .ctl button:hover{background:#26304f}.ctl button.on{background:#2c3a6b;border-color:var(--accent)}
    .scrub{position:relative;flex:1 1 300px;height:28px;display:flex;align-items:center}
    .scrub input{width:100%;margin:0}.ticks{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none}
    .ticks i{position:absolute;top:6px;bottom:6px;width:2px;background:rgba(255,255,255,.35)}
    .time{font-family:var(--mono);font-size:13px;color:var(--dim);min-width:92px}
    .chlist{background:#10141f;border:1px solid var(--line);border-radius:10px;padding:8px;max-height:640px;overflow:auto}
    .chlist button{display:block;width:100%;text-align:left;background:none;border:0;border-left:4px solid var(--c);color:var(--fg);padding:9px 10px;margin:3px 0;border-radius:4px;cursor:pointer;font-size:14px}
    .chlist button:hover{background:#1b2236}.chlist button.on{background:#222c4a}
    .chlist small{display:block;color:var(--dim);font-size:12px}
    .note{color:var(--dim);font-size:13px;margin-top:10px}
    details{margin-top:16px;background:#10141f;border:1px solid var(--line);border-radius:10px;padding:10px 14px}
    details p{margin:8px 0;color:var(--fg);font-size:14px}details b{color:var(--accent)}
  </style>
  <div class="vwrap">
    <h1>How a SQL database works &mdash; the motion-graphic film</h1>
    <p class="sub">10 chapters, ~10 minutes: query life-cycle, optimizer, execution, storage, columnar, transactions, durability, distributed systems and how the choices ripple. Rendered live in your browser (scrub, chapters, captions, optional narration).</p>
    <div id="paneL"><div class="stage"><div><div class="screen" id="screen"><canvas id="cv"></canvas></div>
      <div class="ctl"><button id="bPlay">&#9654; Play</button><div class="scrub"><input id="seek" type="range" min="0" max="1000" value="0"><div class="ticks" id="ticks"></div></div><span class="time" id="time">0:00 / 0:00</span>
      <select id="speed"><option value=".5">0.5x</option><option value=".75">0.75x</option><option value="1" selected>1x</option><option value="1.5">1.5x</option><option value="2">2x</option><option value="4">4x</option></select>
      <button id="bCap" class="on">CC</button><button id="bNar">&#128266; Narrate</button><button id="bFs">&#x26F6; Fullscreen</button></div></div>
      <div class="chlist" id="chlist"></div></div>
      <p class="note">Shortcuts: Space play/pause, &larr;/&rarr; 5 s, [ ] previous/next chapter, C captions, F fullscreen. Deep links: <code>#chapter=5</code>, <code>#t=123</code>. Narration uses your browser&rsquo;s speech synthesis voice.</p></div>
    <details><summary>How this is made</summary><p>Every frame is a pure function <code>renderAt(t)</code> of time drawn on a 1920&times;1080 canvas (<code>src/video/engine.js</code>, chapters in <code>src/video/chapters/</code>). The same function drives this player and the offline renderer <code>scripts/render-video.mjs</code> (headless Chrome &rarr; ffmpeg &rarr; <code>public/video/db-internals.mp4</code>). Re-render with <code>npm run render:video</code>.</p></details>
  </div>`;
  const $ = id => document.getElementById(id);
  const cv = $('cv'); const R = createRenderer(cv, chapters); const total = R.total;
  // chapter list
  const L = R.timeline.chapters; const cols = ['#7aa2f7', '#bb9af7', '#e0af68', '#9ece6a', '#2ac3de', '#2ac3de', '#f7768e', '#f7768e', '#ff9e64', '#c0caf5'];
  $('chlist').innerHTML = L.map((c, i) => `<button data-i="${i}" style="--c:${c.color || cols[i % cols.length]}">${c.num}. ${c.title}<small>${fmt(c.start)} &ndash; ${fmt(c.end)}${c.subtitle ? ' &middot; ' + c.subtitle : ''}</small></button>`).join('');
  $('ticks').innerHTML = L.slice(1).map(c => `<i style="left:${c.start / total * 100}%"></i>`).join('');
  let t = 0, playing = false, last = 0, speed = 1, narrate = false, lastCueKey = '';
  const seekTo = (x, upd = true) => { t = Math.min(Math.max(0, x), total - .01); lastCueKey = ''; if (narrate && window.speechSynthesis) speechSynthesis.cancel(); draw(); if (upd) history.replaceState(null, '', '#t=' + Math.round(t)); };
  function draw() { R.renderAt(t); $('seek').value = Math.round(t / total * 1000); $('time').textContent = fmt(t) + ' / ' + fmt(total); const cur = R.chapterAt(t).index; document.querySelectorAll('#chlist button').forEach((b, i) => b.classList.toggle('on', i === cur)); }
  function speak() {
    if (!narrate || !window.speechSynthesis || !playing) return; const cue = R.cueAt(t); if (!cue) return; const key = cue.chapter.num + ':' + cue.at; if (key === lastCueKey) return; lastCueKey = key;
    speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(cue.text); u.rate = Math.min(2, 1.0 * speed); speechSynthesis.speak(u);
  }
  function loop(now) { if (playing) { t += (now - last) / 1000 * speed; last = now; if (t >= total) { t = total - .01; playing = false; $('bPlay').innerHTML = '&#9654; Play'; } draw(); speak(); } requestAnimationFrame(loop); }
  const play = v => { playing = v; last = performance.now(); $('bPlay').innerHTML = v ? '&#10074;&#10074; Pause' : '&#9654; Play'; if (!v && window.speechSynthesis) speechSynthesis.cancel(); lastCueKey = ''; if (v && t >= total - .1) t = 0; };
  $('bPlay').onclick = () => play(!playing);
  $('seek').oninput = e => seekTo(+e.target.value / 1000 * total);
  $('speed').onchange = e => { speed = +e.target.value; };
  $('bCap').onclick = e => { R.state.captions = !R.state.captions; e.target.classList.toggle('on', R.state.captions); draw(); };
  $('bNar').onclick = e => { narrate = !narrate; e.target.classList.toggle('on', narrate); if (!narrate && window.speechSynthesis) speechSynthesis.cancel(); lastCueKey = ''; };
  $('bFs').onclick = () => { const s = $('screen'); document.fullscreenElement ? document.exitFullscreen() : s.requestFullscreen(); };
  $('chlist').onclick = e => { const b = e.target.closest('button'); if (b) { seekTo(L[+b.dataset.i].start + .01, false); history.replaceState(null, '', '#chapter=' + L[+b.dataset.i].num); } };
  cv.onclick = () => play(!playing);
  addEventListener('keydown', e => { if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' && e.target.type !== 'range') return; const k = e.key;
    if (k === ' ') { e.preventDefault(); if ($('paneL').style.display !== 'none') play(!playing); } else if (k === 'ArrowRight') seekTo(t + 5); else if (k === 'ArrowLeft') seekTo(t - 5);
    else if (k === ']') seekTo(Math.min(L.length - 1, R.chapterAt(t).index + 1) && L[Math.min(L.length - 1, R.chapterAt(t).index + 1)].start); else if (k === '[') { const c = R.chapterAt(t); seekTo(t - c.start > 3 ? c.start : L[Math.max(0, c.index - 1)].start); }
    else if (k === 'c' || k === 'C') $('bCap').click(); else if (k === 'f' || k === 'F') $('bFs').click(); });
  function fromHash() { const m = location.hash.match(/(chapter|t)=([\d.]+)/); if (!m) return false; if (m[1] === 'chapter') seekTo(L[Math.min(L.length - 1, Math.max(0, +m[2] - 1))].start + .01, false); else seekTo(+m[2], false); return true; }
  addEventListener('hashchange', fromHash); fromHash(); draw(); requestAnimationFrame(loop);
  window.__player = { seekTo, play };
}
