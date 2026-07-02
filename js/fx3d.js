"use strict";
// 3D combat effects: a lightweight GPU particle system rendered as a single
// THREE.Points draw call (additive glowing sprites). The existing 2D
// DD.particles.burst calls are bridged into this when ?3d is active, so every
// hit/death/dash effect becomes 3D with no re-wiring.
//
// ES module; the host importmap resolves "three".
import * as THREE from "three";

// Soft radial glow used for every particle (round, fading edge).
function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.85)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const VS = 0.03;   // 2D px/s velocity -> world units/s
const SIZE = 0.5;  // base point size (world units, distance-attenuated)

export class FX3D {
  constructor(scene, cap = 600) {
    this.cap = cap;
    this.n = 0;
    this.parts = new Array(cap);
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    geo.setDrawRange(0, 0);
    this.geo = geo;

    // Additive + vertex colours: fade is done by scaling rgb toward 0 (adding
    // less light), so we don't need per-particle alpha.
    this.scene = scene;
    this.glowTex = glowTexture();
    this.mat = new THREE.PointsMaterial({
      map: this.glowTex, size: SIZE, sizeAttenuation: true, vertexColors: true,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this._c = new THREE.Color();

    // Glowing orbs (mage bolts / magic shots): one additive sprite per projectile.
    this.orbMat = new THREE.SpriteMaterial({
      map: this.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.orbs = new Map(); // entity -> Sprite

    // Expanding ground rings (spell impacts).
    this.ringGeo = new THREE.RingGeometry(0.55, 1.0, 28);
    this.rings = [];     // active { mesh, t, life }
    this.ringPool = [];  // reusable meshes
  }

  // Place glowing orbs from { entity, x, y, z, color, size }. Pooled per entity.
  setOrbs(list) {
    const seen = new Set();
    for (const it of list) {
      seen.add(it.entity);
      let s = this.orbs.get(it.entity);
      if (!s) { s = new THREE.Sprite(this.orbMat.clone()); this.scene.add(s); this.orbs.set(it.entity, s); }
      s.material.color.set(it.color || "#b48cff");
      s.position.set(it.x, it.y, it.z);
      s.scale.setScalar(it.size || 1);
    }
    for (const [e, s] of this.orbs) {
      if (!seen.has(e)) { this.scene.remove(s); this.orbs.delete(e); }
    }
  }

  // Expanding flat ring shockwave on the floor at a world point.
  ring(wx, wy, wz, color) {
    let m = this.ringPool.pop();
    if (!m) {
      m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      this.scene.add(m);
    }
    m.material.color.set(color || "#b48cff");
    m.position.set(wx, wy + 0.15, wz);
    m.rotation.x = -Math.PI / 2; // lie flat on the floor
    m.scale.setScalar(0.2);
    m.material.opacity = 1;
    m.visible = true;
    this.rings.push({ mesh: m, t: 0, life: 0.4 });
  }

  // Spawn a burst at world (wx,wy,wz). opts mirror DD.particles.burst:
  // { count, colors[], speed, life, gravity }  (gravity>0 = fall, as in 2D).
  burst(wx, wy, wz, opts) {
    const count = opts.count || 8;
    const colors = opts.colors || ["#ffffff"];
    const speed = opts.speed == null ? 90 : opts.speed;
    const life = opts.life == null ? 0.5 : opts.life;
    const gravity = opts.gravity || 0;
    for (let i = 0; i < count && this.n < this.cap; i++) {
      const idx = this.n++;
      const a = Math.random() * Math.PI * 2;
      const sp = speed * VS * (0.4 + Math.random() * 0.7);
      this._c.set(colors[(Math.random() * colors.length) | 0]);
      this.parts[idx] = {
        x: wx, y: wy, z: wz,
        vx: Math.cos(a) * sp, vz: Math.sin(a) * sp,
        vy: 0.5 + Math.random() * 1.3,   // upward pop off the surface
        grav: gravity * VS,              // 2D +gravity (down) -> -Y
        life: life * (0.6 + Math.random() * 0.6), max: life,
        r: this._c.r, cg: this._c.g, b: this._c.b,
      };
    }
  }

  update(dt) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; } // floor bounce
      const f = Math.max(0, Math.min(1, p.life / (p.max * 0.6))); // brightness fade
      const o = w * 3;
      this.pos[o] = p.x; this.pos[o + 1] = p.y; this.pos[o + 2] = p.z;
      this.col[o] = p.r * f; this.col[o + 1] = p.cg * f; this.col[o + 2] = p.b * f;
      this.parts[w] = p; // compact survivors toward the front
      w++;
    }
    this.n = w;
    this.geo.setDrawRange(0, w);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;

    // expanding impact rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { r.mesh.visible = false; this.ringPool.push(r.mesh); this.rings.splice(i, 1); continue; }
      r.mesh.scale.setScalar(0.2 + k * 4); // expand to ~4u radius
      r.mesh.material.opacity = 1 - k;
    }
  }
}
