// High-level architecture scene: layer slabs, component nodes, interface edges, ambient packets.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LAYERS, EDGE_KINDS } from '../shared/layers.js';

export const LAYER_GAP = 7.6, CELL_X = 3.7, CELL_Z = 3.1; 
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };

function haloTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,0.9)'); r.addColorStop(0.4, 'rgba(255,255,255,0.28)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Overview {
  constructor({ components, edges, makeLabel }) {
    this.group = new THREE.Group();
    this.makeLabel = makeLabel;
    this.nodes = new Map(); this.edgeObjs = new Map(); this.slabs = new Map();
    this.hiddenLayers = new Set(); this.highlightNodes = null; this.highlightEdges = null; this.activeEdges = new Set();
    this.nodeDim = new Map(); this.selected = null; this.hover = null; this.selectedEdge = null; this.hoverEdge = null;
    this.ambientOn = true; this.ambientBoost = 1;
    this._disposables = [];
    this.haloTex = haloTexture(); this._disposables.push(this.haloTex);
    this.nodeGeo = new RoundedBoxGeometry(2.6, 0.8, 1.5, 3, 0.2); this._disposables.push(this.nodeGeo);
    this._layout(components); this._buildSlabs(); this._buildNodes(components); this._buildEdges(edges); this._buildAmbient();
  }

  _layout(components) {
    const byLayer = {}; LAYERS.forEach((l) => (byLayer[l.id] = []));
    components.forEach((c) => byLayer[c.layer].push(c));
    this.byLayer = byLayer;
    let maxCols = 3, maxRows = 1;
    const dims = {};
    for (const l of LAYERS) {
      const n = byLayer[l.id].length;
      const cols = Math.max(3, Math.min(6, Math.ceil(Math.sqrt(n * 2.2)))); const rows = Math.max(1, Math.ceil(n / cols));
      dims[l.id] = { cols, rows }; maxCols = Math.max(maxCols, cols); maxRows = Math.max(maxRows, rows);
    }
    this.W = maxCols * CELL_X + 3; this.D = maxRows * CELL_Z + 3.4;
    this.layerY = {}; this.pos = {};
    LAYERS.forEach((l, i) => {
      const y = -i * LAYER_GAP; this.layerY[l.id] = y;
      const { cols } = dims[l.id]; const list = byLayer[l.id]; const rows = Math.ceil(list.length / cols);
      list.forEach((c, k) => {
        const r = Math.floor(k / cols), col = k % cols;
        const inRow = r === rows - 1 ? list.length - r * cols : cols;
        this.pos[c.id] = new THREE.Vector3((col - (inRow - 1) / 2) * CELL_X, y + 0.75, (r - (rows - 1) / 2) * CELL_Z);
      });
    });
    this.center = new THREE.Vector3(0, -LAYER_GAP * (LAYERS.length - 1) / 2, 0);
  }

  _buildSlabs() {
    const geo = new RoundedBoxGeometry(this.W, 0.22, this.D, 2, 0.08); this._disposables.push(geo);
    const egeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(this.W, 0.22, this.D)); this._disposables.push(egeo);
    for (const l of LAYERS) {
      const color = new THREE.Color(l.color);
      const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.1, roughness: 0.9, depthWrite: false, emissive: color, emissiveIntensity: 0.08 });
      const mesh = new THREE.Mesh(geo, mat); mesh.position.y = this.layerY[l.id]; mesh.renderOrder = -2; mesh.userData = { type: 'layer', id: l.id };
      const lmat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
      const outline = new THREE.LineSegments(egeo, lmat); mesh.add(outline);
      const label = this.makeLabel(l.name.toUpperCase(), { size: 0.62, color: l.color, weight: 800 });
      label.position.set(-this.W / 2 + label.scale.x / 2 + 0.3, 0.7, this.D / 2 + 0.2); mesh.add(label);
      this.group.add(mesh); this._disposables.push(mat, lmat);
      this.slabs.set(l.id, { mesh, mat, lmat, label, base: 0.1, o: 1 });
    }
  }

  _buildNodes(components) {
    for (const c of components) {
      const color = new THREE.Color(LAYERS.find((l) => l.id === c.layer).color);
      const mat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.55), emissive: color, emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.25, transparent: true });
      const mesh = new THREE.Mesh(this.nodeGeo, mat); mesh.userData = { type: 'node', id: c.id };
      const g = new THREE.Group(); g.position.copy(this.pos[c.id]); g.add(mesh);
      const hm = new THREE.SpriteMaterial({ map: this.haloTex, color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
      const halo = new THREE.Sprite(hm); halo.scale.set(5.2, 3.4, 1); halo.position.y = -0.2; g.add(halo);
      const label = this.makeLabel(String(c.name).split(/ \/ | \(/)[0], { size: 0.56, color: '#eef2ff' }); label.position.y = 0.95; label.renderOrder = 5; g.add(label);
      this.group.add(g); this._disposables.push(mat, hm);
      this.nodes.set(c.id, { comp: c, group: g, mesh, mat, halo, hm, label, color, badge: null, badgeText: '', o: 1, glow: 0.35, scale: 1, baseColor: color });
    }
  }

  _curveFor(e) {
    const a = this.pos[e.from], b = this.pos[e.to];
    const mid = a.clone().add(b).multiplyScalar(0.5); const dir = b.clone().sub(a); const len = dir.length();
    const sign = (e.from < e.to ? 1 : -1) * (0.6 + hash(e.id) * 0.6);
    const ctrl = mid.clone();
    if (Math.abs(dir.y) < 0.5) { ctrl.y += 1.1 + len * 0.13; ctrl.z += sign * 0.8; }
    else { const perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize(); ctrl.addScaledVector(perp, sign * (1.0 + len * 0.07)); ctrl.z += sign * 1.2; }
    const s = a.clone(); s.y += 0.1; const t = b.clone(); t.y += 0.1;
    return new THREE.QuadraticBezierCurve3(s, ctrl, t);
  }

  _buildEdges(edges) {
    const coneGeo = new THREE.ConeGeometry(0.085, 0.24, 8); this._disposables.push(coneGeo);
    const up = new THREE.Vector3(0, 1, 0);
    this.edgeList = edges;
    for (const e of edges) {
      const curve = this._curveFor(e);
      const color = new THREE.Color(EDGE_KINDS[e.kind] || '#8a93b5');
      const geo = new THREE.TubeGeometry(curve, 28, 0.04, 5, false); const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.38, depthWrite: false });
      const tube = new THREE.Mesh(geo, mat); tube.userData = { type: 'edge', id: e.id };
      const pgeo = new THREE.TubeGeometry(curve, 16, 0.2, 4, false); const pick = new THREE.Mesh(pgeo, new THREE.MeshBasicMaterial({ visible: false })); pick.userData = { type: 'edge', id: e.id };
      const cmat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 });
      const cone = new THREE.Mesh(coneGeo, cmat); cone.position.copy(curve.getPoint(0.6)); cone.quaternion.setFromUnitVectors(up, curve.getTangent(0.6).normalize());
      this.group.add(tube, pick, cone); this._disposables.push(geo, mat, pgeo, pick.material, cmat);
      this.edgeObjs.set(e.id, { edge: e, curve, tube, pick, cone, mat, cmat, color, o: 0.38, w: 1, hidden: false });
    }
    this.pickables = [...[...this.nodes.values()].map((n) => n.mesh), ...[...this.edgeObjs.values()].map((x) => x.pick), ...[...this.slabs.values()].map((s) => s.mesh)];
  }

  _buildAmbient() {
    const N = Math.min(220, Math.max(40, this.edgeObjs.size * 2));
    const geo = new THREE.SphereGeometry(0.09, 8, 6); const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.ambient = new THREE.InstancedMesh(geo, mat, N); this.ambient.frustumCulled = false;
    this._disposables.push(geo, mat);
    this.ambientState = Array.from({ length: N }, () => ({ e: null, t: Math.random(), v: 0.12 + Math.random() * 0.22 }));
    this.edgeKeys = [...this.edgeObjs.keys()];
    this._dummy = new THREE.Object3D(); this._tmpC = new THREE.Color();
    this.group.add(this.ambient);
  }

  // ---- state setters ----
  setLayerHidden(id, hidden) { hidden ? this.hiddenLayers.add(id) : this.hiddenLayers.delete(id); }
  setHighlight(nodes, edges) { this.highlightNodes = nodes; this.highlightEdges = edges; }
  setBadges(map) { // id -> text
    for (const [id, n] of this.nodes) {
      const text = map.get(id) || '';
      if (text === n.badgeText) continue;
      if (n.badge) { n.group.remove(n.badge); n.badge.userData.dispose?.(); n.badge = null; }
      n.badgeText = text;
      if (text) { const b = this.makeLabel(text, { size: 0.34, color: '#0b0e17', bg: '#' + n.color.getHexString(), weight: 700 }); b.position.set(0.9, 1.5, 0.4); b.renderOrder = 6; n.badge = b; n.group.add(b); }
    }
  }
  setNodeDim(map) { this.nodeDim = map; }
  nodeVisible(id) { return !this.hiddenLayers.has(this.nodes.get(id).comp.layer); }

  pick(raycaster) {
    const vis = this.pickables.filter((m) => {
      const t = m.userData; if (t.type === 'layer') return !this.hiddenLayers.has(t.id);
      if (t.type === 'node') return this.nodeVisible(t.id);
      const e = this.edgeObjs.get(t.id).edge; return this.nodeVisible(e.from) && this.nodeVisible(e.to);
    });
    const hits = raycaster.intersectObjects(vis, false);
    if (!hits.length) return null;
    const pri = hits.find((h) => h.object.userData.type === 'node') || hits.find((h) => h.object.userData.type === 'edge') || hits[0];
    return pri.object.userData;
  }

  update(dt, t) {
    const k = 1 - Math.exp(-dt * 9);
    for (const [id, n] of this.nodes) {
      const hidden = this.hiddenLayers.has(n.comp.layer);
      let o = hidden ? 0 : 1;
      if (!hidden) {
        if (this.highlightNodes && !this.highlightNodes.has(id)) o = 0.14;
        else if (this.nodeDim.has(id)) o = this.nodeDim.get(id);
      }
      n.o += (o - n.o) * k;
      const sel = this.selected === id, hov = this.hover === id;
      const hl = this.highlightNodes?.has(id);
      const glowT = sel ? 1.5 : hov ? 1.1 : hl ? 0.85 : 0.35;
      n.glow += (glowT - n.glow) * k;
      const pulse = sel ? 0.12 * Math.sin(t * 4) : 0;
      n.mat.emissiveIntensity = n.glow + pulse; n.mat.opacity = n.o; n.mat.transparent = n.o < 0.98; n.mat.depthWrite = n.o >= 0.98;
      n.hm.opacity = n.o * (0.18 + n.glow * 0.3);
      n.group.visible = n.o > 0.02;
      n.label.material.opacity = Math.min(1, n.o * 1.2);
      if (n.badge) n.badge.material.opacity = n.o;
      const sc = 1 + (sel ? 0.1 : hov ? 0.06 : 0); n.scale += (sc - n.scale) * k; n.mesh.scale.setScalar(n.scale);
    }
    for (const [lid, s] of this.slabs) {
      const hidden = this.hiddenLayers.has(lid);
      const hasHl = this.highlightNodes && [...this.highlightNodes].some((id) => this.nodes.get(id)?.comp.layer === lid);
      const target = hidden ? 0 : this.highlightNodes && !hasHl ? 0.03 : 0.1;
      s.o += (target - s.o) * k; s.mat.opacity = s.o; s.lmat.opacity = hidden ? 0 : Math.min(0.6, s.o * 5.5);
      s.mesh.visible = s.o > 0.005; s.label.material.opacity = hidden ? 0 : this.highlightNodes && !hasHl ? 0.25 : 1;
    }
    for (const [id, x] of this.edgeObjs) {
      const e = x.edge; const hidden = !this.nodeVisible(e.from) || !this.nodeVisible(e.to);
      x.hidden = hidden;
      let o = hidden ? 0 : 0.26;
      if (!hidden) {
        if (this.highlightEdges) o = this.highlightEdges.has(id) ? 0.85 : 0.05;
        if (this.activeEdges.has(id)) o = 1;
        if (this.selectedEdge === id || this.hoverEdge === id) o = 1;
      }
      x.o += (o - x.o) * k; x.mat.opacity = x.o; x.cmat.opacity = Math.min(1, x.o + 0.2);
      const w = (this.selectedEdge === id || this.hoverEdge === id || this.activeEdges.has(id)) ? 2.6 : 1;
      x.w += (w - x.w) * k;
      x.tube.visible = x.cone.visible = x.o > 0.02;
    }
    this._updateAmbient(dt);
  }

  _updateAmbient(dt) {
    const am = this.ambient; const on = this.ambientOn && this.edgeKeys.length;
    am.visible = !!on; if (!on) return;
    const d = this._dummy; let i = 0;
    for (const p of this.ambientState) {
      if (!p.e || p.t >= 1) {
        // pick a random visible edge, weighted by being not dimmed
        for (let tries = 0; tries < 6; tries++) { const id = this.edgeKeys[(Math.random() * this.edgeKeys.length) | 0]; const x = this.edgeObjs.get(id); if (!x.hidden && (!this.highlightEdges || this.highlightEdges.has(id))) { p.e = x; break; } p.e = null; }
        p.t = Math.random() * 0.2; p.v = 0.12 + Math.random() * 0.22;
        if (p.e) { this._tmpC.copy(p.e.color); }
      }
      if (p.e && this.highlightEdges && (i % 3)) p.e = null;
      if (p.e) { p.t += dt * p.v * this.ambientBoost; d.position.copy(p.e.curve.getPoint(Math.min(p.t, 1))); d.scale.setScalar(1); this._tmpC.copy(p.e.color); this.ambient.setColorAt(i, this._tmpC); }
      else d.scale.setScalar(0);
      d.updateMatrix(); am.setMatrixAt(i++, d.matrix);
    }
    am.instanceMatrix.needsUpdate = true; if (am.instanceColor) am.instanceColor.needsUpdate = true;
  }

  dispose() { this._disposables.forEach((d) => d.dispose?.()); this.nodes.forEach((n) => { n.label.userData.dispose?.(); n.badge?.userData.dispose?.(); }); this.slabs.forEach((s) => s.label.userData.dispose?.()); this.ambient.dispose(); }
}
