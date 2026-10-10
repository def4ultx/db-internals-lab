# Video engine (owner: video agent)

`renderAt(t)` (src/video/engine.js) draws the whole 1920x1080 frame on a 2D canvas as a **pure function of t**. No Date.now, no Math.random, no state kept between frames (derive everything from `t` – use `rng(seed)`/`hash(n)` from helpers for deterministic randomness). Same code is used by the in-browser player and the offline renderer (scripts/render-video.mjs).

## Chapter module (src/video/chapters/NN-name.js, auto-discovered in numeric order)
```js
export const title = 'The big picture';           // shown on the title card + minimap strip
export const subtitle = 'Life of a query';        // optional
export const color = '#7aa2f7';                   // optional accent (default: layer colour by index)
export const duration = 60;                       // seconds (INCLUDING the first 2.6s title card)
export const focus = ['client','frontend'];       // layer ids lit in the persistent mini-map; may be a function (localT)=>ids
export const narration = [                        // = captions = TTS script. Cue shows from `at` until the next cue
  { at: 0.6,  text: 'Every query begins as a string of text...' },
  { at: 6.8,  text: '...' },
];
export function draw(ctx, t, h) { /* t = seconds since chapter start (0..duration) */ }
```
Rules
- Canvas is 1920x1080, ctx is already clipped; the engine draws background, the title card (t in 0..2.6s – so draw NOTHING important before ~2.4s), mini-map (top strip y<70), captions (bottom, y>=880) and the progress bar. **Content safe area: x 60..1860, y 110..870.** Never draw below y=870 (captions cover it).
- Ctx state: always `ctx.save()/restore()` around transforms. Fonts are set by helpers; use `h.text` rather than raw fillText.
- Narration: 2.4 words/second average. A cue with N words needs at least N/2.4 seconds before the next cue (run `node scripts/check-video.mjs`). Cues are 12–30 words, one idea each. Visuals must be in sync with what the cue says (the cue starting at `at` says X -> show X at `at`..`at+2s`). Chapter total words = about 2.3 x duration.
- Visual language: dark theme, layer colours (`h.L.client|frontend|planning|execution|txn|storage|distributed`), glow, smooth easing (`h.ease.*`, `h.p(t,a,b,ease)`), camera zooms (`h.camera`), glowing labelled packets travelling on labelled arrows between component boxes, kinetic typography for key phrases. Every second something should be moving or revealing; avoid static screens and avoid walls of text. Minimum font size 18px (video is viewed small). No overlaps – check by looking at screenshots.
- Use REAL content: real byte layouts, numbers, real system names, as in CONTRACT.md. Accuracy matters (CMU 15-445/15-721 level).
- Do not import anything but `../helpers.js` (and `../../shared/layers.js` if wanted). No DOM, no fetch, no images.

## Helpers (src/video/helpers.js) – the `h` argument
W,H, C (colour tokens + fonts), L (layer colours), clamp, lerp, ease{lin,in,out,inOut,expo,back,elastic}, p(t,a,b,fn) progress 0..1, pOut, win(t,a,b) fade window, rng(seed), hash(n), hexA(hex,alpha), mix(c1,c2,u), text(ctx,str,x,y,{size,color,weight,align,base,mono,alpha,glow,maxWidth}), measure, lines, type (typewriter), kinetic (word-by-word typography), rrect, box(ctx,{x,y,w,h,label,sub,color,alpha,glow,...}), pill, pathPoint(pts,u), arrow(ctx,pts,{color,label,progress,dashed,...}), packet(ctx,pts,u,{color,label}), stream(ctx,pts,t,{rate,count,color,label}), camera(t,keys)->{apply(ctx)}, table, code (SQL highlight), cells (byte/cell grid), bar, heading, callout. Read the file for exact signatures – you may add chapter-local helpers inside your chapter file; do not edit helpers.js/engine.js (ask the video lead for changes).

## Dev loop
Dev server for the video agent runs on port 5182 (`npx vite --port 5182`). Screenshots: `node scripts/shot.mjs /tmp/shots/ch3 --chapter 3 --count 8` (or `--t 12.5,40`), then Read the PNGs. `node scripts/check-video.mjs` validates durations/narration pacing.
