# DB Internals Lab

An interactive lab for learning database internals (CMU 15-445 / 15-721 level): a 3D architecture explorer, guided lessons, a video and a system comparison.

## Run
```
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```
No network is needed at runtime.

## Pages
- `index.html` - home.
- `explore.html` - 3D explorer: layered architecture, semantic zoom into each component's internals, flow player, and a Design Composer (press `?` for shortcuts). Deep links: `#c=<component>`, `#system=<id>`, `#flow=<id>`, `#cfg=slot:option,...`.
- `learn.html` - guided learning content.
- `video.html` - animated video walkthrough.
- `compare.html` - side-by-side comparison of real systems.

## Structure
- `src/data/` - components, edges, flows, designs (slots/options), rules, systems; `index.js` loads them with a fixture fallback.
- `src/explorer/` - explorer app (`main.js`, `overview.js`, `internalsHost.js`, `composer.js`, `flowplayer.js`, ...); `internals/` holds the per-component 3D views.
- `src/shared/` - theme, layer palette, nav.
- `src/learn/`, `src/video/`, `src/compare/` - the other pages.
- `CONTRACT.md` - shared data schemas and the view interface.
