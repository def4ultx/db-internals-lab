// Shared helpers for distributed.js views (internals-E2). Simulation time + packets + tracked disposables.
import * as THREE from 'three';

export const C = {
  bg: 0x0b0d14, panel: 0x1a1e2e, line: 0x3b4261,
  blue: '#7aa2f7', purple: '#bb9af7', yellow: '#e0af68', green: '#9ece6a',
  red: '#f7768e', cyan: '#2ac3de', orange: '#ff9e64', text: '#c0caf5', dim: '#7982a9',
};

export function makeKit(ctx) {
  const group = new THREE.Group();
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };
  let simT = 0;
  const timers = [];
  const packets = [];
  const animators = [];

  const geoBox = track(new THREE.BoxGeometry(1, 1, 1));
  const geoSphere = track(new THREE.SphereGeometry(1, 16, 12));
  const geoCyl = track(new THREE.CylinderGeometry(1, 1, 1, 24));

  const kit = {
    group, THREE, C,
    get t() { return simT; },
    track,
    mat(color, o = {}) {
      return track(new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...o }));
    },
    box(w, h, d, color, pos = [0, 0, 0], parent = group, o = {}) {
      const m = new THREE.Mesh(geoBox, kit.mat(color, o));
      m.scale.set(w, h, d); m.position.set(...pos); parent.add(m); return m;
    },
    cyl(r, h, color, pos = [0, 0, 0], parent = group, o = {}) {
      const m = new THREE.Mesh(geoCyl, kit.mat(color, o));
      m.scale.set(r, h, r); m.position.set(...pos); parent.add(m); return m;
    },
    sphere(r, color, pos = [0, 0, 0], parent = group, o = {}) {
      const m = new THREE.Mesh(geoSphere, kit.mat(color, o));
      m.scale.setScalar(r); m.position.set(...pos); parent.add(m); return m;
    },
    setColor(mesh, color) { mesh.material.color.set(color); if (mesh.material.emissive) mesh.material.emissive.set(0x000000); },
    glow(mesh, color, k = 0.6) { mesh.material.emissive.set(color); mesh.material.emissiveIntensity = k; },
    /** Updatable text label. h.set(text, color?) */
    text(text, o = {}, pos = [0, 0, 0], parent = group) {
      const h = { sprite: null, text: null, color: o.color, o };
      const build = () => {
        if (h.sprite) { parent.remove(h.sprite); h.sprite.material.map?.dispose(); h.sprite.material.dispose(); }
        h.sprite = ctx.makeLabel(h.text, { ...h.o, color: h.color });
        h.sprite.position.set(...pos); parent.add(h.sprite);
      };
      h.set = (t, color) => { if (t === h.text && (!color || color === h.color)) return; h.text = t; if (color) h.color = color; build(); };
      h.pos = (x, y, z) => { pos = [x, y, z]; if (h.sprite) h.sprite.position.set(x, y, z); };
      h.set(text, o.color);
      track({ dispose() { if (h.sprite) { h.sprite.material.map?.dispose(); h.sprite.material.dispose(); } } });
      return h;
    },
    line(pts, color = C.line, o = {}, parent = group) {
      const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
      const m = track(new THREE.LineBasicMaterial({ color, transparent: true, opacity: o.opacity ?? 0.8 }));
      track(g); const l = new THREE.Line(g, m); parent.add(l); return l;
    },
    segs(pts, color = C.line, o = {}, parent = group) { // pairs
      const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
      const m = track(new THREE.LineBasicMaterial({ color, transparent: true, opacity: o.opacity ?? 0.8 }));
      track(g); const l = new THREE.LineSegments(g, m); parent.add(l); return l;
    },
    clear(obj) { // remove children, disposing label sprites only (geometry shared)
      while (obj.children.length) { const c = obj.children[0]; obj.remove(c); c.traverse(n => { if (n.isSprite) { n.material.map?.dispose(); n.material.dispose(); } else if (n.isMesh && n.userData.ownMat) n.material.dispose(); }); }
    },
    /** Schedule fn after `delay` sim seconds. returns id */
    after(delay, fn) { const tm = { at: simT + delay, fn, dead: false }; timers.push(tm); return tm; },
    cancel(tm) { if (tm) tm.dead = true; },
    clearTimers() { timers.length = 0; },
    /** Moving packet from a to b (Vector3-like arrays). opts {color,dur,size,onArrive,arc,drop} */
    send(a, b, o = {}) {
      const m = kit.sphere(o.size ?? 0.22, o.color ?? C.orange, a, group, { emissive: o.color ?? C.orange, emissiveIntensity: 0.7 });
      const p = { m, a: new THREE.Vector3(...a), b: new THREE.Vector3(...b), t0: simT, dur: o.dur ?? 1, onArrive: o.onArrive, arc: o.arc ?? 0, drop: o.drop };
      if (o.label) { p.lab = kit.text(o.label, { size: 0.32, color: o.labelColor ?? o.color ?? C.text }, [0, 0.5, 0], m); p.lab.sprite.scale.multiplyScalar(1 / (o.size ?? 0.22)); }
      packets.push(p); return p;
    },
    animate(fn) { animators.push(fn); },
    update(dt) {
      simT += dt;
      for (let i = timers.length - 1; i >= 0; i--) { const tm = timers[i]; if (tm.dead) { timers.splice(i, 1); } else if (simT >= tm.at) { timers.splice(i, 1); tm.fn(); } }
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i]; const u = Math.min(1, (simT - p.t0) / p.dur);
        p.m.position.lerpVectors(p.a, p.b, u); p.m.position.y += Math.sin(u * Math.PI) * p.arc;
        if (p.drop && u >= p.drop) { kit._killPacket(p, i); continue; } // lost in transit
        if (u >= 1) { kit._killPacket(p, i); p.onArrive && p.onArrive(); }
      }
      for (const f of animators) f(dt, simT);
    },
    _killPacket(p, i) {
      group.remove(p.m); p.m.material.dispose(); if (p.lab) { p.lab.sprite.material.map?.dispose(); p.lab.sprite.material.dispose(); }
      packets.splice(i, 1);
    },
    dispose() {
      packets.slice().forEach((p, i) => kit._killPacket(p, packets.indexOf(p)));
      group.traverse(n => { if (n.isSprite) { n.material.map?.dispose(); n.material.dispose(); } });
      disposables.forEach(d => d.dispose && d.dispose());
      timers.length = 0; animators.length = 0;
    },
  };
  return kit;
}

/** Generic HTML helpers for ctx.onInfo */
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
export const info = (title, body) => `<b>${title}</b><br>${body}`;
