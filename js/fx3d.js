"use strict";
// 3D combat effects: a lightweight GPU particle system rendered as a single
// THREE.Points draw call (additive glowing sprites). The existing 2D
// particles.burst calls are bridged into this when ?3d is active, so every
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

    // Melee weapon trails: a 0.9-rad arc segment (unit radius, scaled per
    // swing) swept across the swing's arc, same shape as the 2D drawSwing.
    this.arcGeo = new THREE.RingGeometry(0.45, 1.0, 16, 1, 0, 0.9);
    this.arcs = [];      // active { mesh, t, life, angle, arc, r }
    this.arcPool = [];   // reusable meshes

    // Attack telegraphs (boss slam): a flat danger ring at the AoE radius + a
    // fill disc that closes to full over the windup, so the player reads where
    // + when. Two pooled meshes per telegraph.
    this.telegraphRingGeo = new THREE.RingGeometry(0.86, 1.0, 44);
    this.telegraphDiscGeo = new THREE.CircleGeometry(1, 40);
    this.telegraphs = [];      // active { ring, disc, t, life, r }
    this.telegraphPool = [];   // reusable { ring, disc }

    // Boss aura: a single persistent additive glow sprite that follows the boss.
    this.bossGlow = null;
    this._bossGlowT = 0;

    // Torch flames: persistent emitters (world positions) that drip glow
    // particles into the shared Points pool — ambience with zero extra draw
    // calls. Set per room via setFlames().
    this.flames = [];
    this._flameAcc = 0;
  }

  // Replace the room's torch-flame emitters: [{x, y, z}].
  setFlames(list) {
    this.flames = list || [];
    this._flameAcc = 0;
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

  // Danger telegraph on the floor: an outline ring at `radius` (world units) plus
  // a fill disc that grows 0 -> radius over `dur`, warning of an incoming AoE.
  telegraph(wx, wy, wz, radius, dur, color) {
    let t = this.telegraphPool.pop();
    if (!t) {
      const mk = (geo) => {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }));
        m.rotation.x = -Math.PI / 2; // lie flat on the floor
        this.scene.add(m);
        return m;
      };
      t = { ring: mk(this.telegraphRingGeo), disc: mk(this.telegraphDiscGeo) };
    }
    const col = color || "#ff3b3b";
    t.ring.material.color.set(col); t.disc.material.color.set(col);
    for (const m of [t.ring, t.disc]) {
      m.position.set(wx, (wy || 0) + 0.12, wz);
      m.visible = true;
    }
    t.ring.scale.setScalar(radius);
    this.telegraphs.push({ ...t, t: 0, life: dur || 0.85, r: radius });
  }

  // Persistent additive glow sprite following the boss; pass null to clear it.
  setBossGlow(pos, color) {
    if (!pos) {
      if (this.bossGlow) { this.bossGlow.visible = false; }
      return;
    }
    if (!this.bossGlow) {
      this.bossGlow = new THREE.Sprite(this.orbMat.clone());
      this.scene.add(this.bossGlow);
    }
    this.bossGlow.material.color.set(color || "#ffc23a");
    this.bossGlow.position.set(pos.x, pos.y == null ? 1.4 : pos.y, pos.z);
    this.bossGlow.visible = true;
  }

  // Melee weapon trail: a flat additive arc segment at world (wx,wy,wz) that
  // sweeps across the swing over `dur` seconds and fades. `angle`/`arc` are 2D
  // radians (aim direction + swing width), `radius` the reach in world units.
  //
  // depthTest:false (graphics audit re-verification, Phase 4): the arc is
  // centered ON the attacker at ~waist height and swept toward wherever they're
  // aiming, which is very often away from the camera (the follow camera sits
  // behind/south of the player by design, render3d.js's fixed camAngle). For
  // any swing aimed into or out of the screen, most of the wedge sits on the
  // far side of the attacker's own opaque body from the camera and was being
  // depth-clipped by it almost entirely -- a screenshot aimed cross-screen (east/
  // west) showed a bold, high-contrast wedge against BOTH a grey (catacombs) and
  // warm tan (goblinMines) floor, so the floor-palette contrast the original
  // audit worried about was fine; the earlier "inconclusive" pin was very likely
  // catching a toward/away-from-camera swing and reading its self-occluded
  // sliver. Skipping the depth test (already depthWrite:false, so this can't
  // occlude anything drawn after it) makes the trail read the same regardless
  // of swing direction without touching color, opacity or timing.
  swingArc(wx, wy, wz, angle, arc, radius, color, dur) {
    let m = this.arcPool.pop();
    if (!m) {
      m = new THREE.Mesh(this.arcGeo, new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      }));
      m.renderOrder = 10; // draw after opaque characters/props regardless of scene-graph order
      this.scene.add(m);
    }
    m.material.color.set(color || "#fff8e0");
    m.position.set(wx, wy, wz);
    m.scale.setScalar(radius);
    m.visible = true;
    this.arcs.push({ mesh: m, t: 0, life: dur || 0.25, angle, arc, r: radius });
  }

  // Spawn a burst at world (wx,wy,wz). opts mirror particles.burst:
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
    // torch flames: each emitter drips a small rising ember every ~90ms
    this._flameAcc += dt;
    if (this.flames.length && this._flameAcc >= 0.09) {
      this._flameAcc = 0;
      for (const f of this.flames) {
        this.burst(f.x, f.y, f.z, {
          count: 1, colors: ["#ffb347", "#ffd95e", "#ff8c42"], speed: 3, life: 0.45, gravity: -60,
        });
      }
    }

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

    // sweeping swing arcs + sparks at the leading edge. The segment start
    // angle mirrors the 2D drawSwing sweep; the mesh lies flat (rotation.x
    // = -PI/2), which maps a 2D angle a to rotation.z = -(a + 0.9) because
    // the 2D y axis becomes world Z with flipped handedness.
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.t += dt;
      const k = a.t / a.life;
      if (k >= 1) { a.mesh.visible = false; this.arcPool.push(a.mesh); this.arcs.splice(i, 1); continue; }
      const a0 = a.angle - a.arc / 2 + a.arc * k - 0.5;
      a.mesh.rotation.set(-Math.PI / 2, 0, -(a0 + 0.9));
      a.mesh.material.opacity = 0.85 * (1 - k * k);
      const lead = a0 + 0.9;
      this.burst(a.mesh.position.x + Math.cos(lead) * a.r * 0.85, a.mesh.position.y,
                 a.mesh.position.z + Math.sin(lead) * a.r * 0.85,
                 { count: 1, colors: ["#fff8e0", "#ffe9a8"], speed: 8, life: 0.22 });
    }

    // attack telegraphs: fill disc closes to the danger radius over the windup,
    // the outline ring pulses, and both brighten toward impact.
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const g = this.telegraphs[i];
      g.t += dt;
      const k = g.t / g.life;
      if (k >= 1) {
        g.ring.visible = false; g.disc.visible = false;
        this.telegraphPool.push({ ring: g.ring, disc: g.disc });
        this.telegraphs.splice(i, 1);
        continue;
      }
      const pulse = 0.7 + 0.3 * Math.sin(g.t * 22);
      g.ring.material.opacity = (0.7 + 0.3 * k) * pulse;    // bright danger boundary
      g.disc.scale.setScalar(g.r);                          // full danger zone, shown from the start
      g.disc.material.opacity = (0.14 + 0.55 * k * k) * pulse; // subtle warning -> intense at impact
    }

    // boss aura: gentle pulse + slow gold embers rising off the king
    if (this.bossGlow && this.bossGlow.visible) {
      this._bossGlowT += dt;
      const s = 3.6 + 0.5 * Math.sin(this._bossGlowT * 3);
      this.bossGlow.scale.setScalar(s);
      this.bossGlow.material.opacity = 0.8 + 0.2 * Math.sin(this._bossGlowT * 3);
      // steady rise of gold embers off the king
      this._auraAcc = (this._auraAcc || 0) + dt;
      if (this._auraAcc >= 0.05) {
        this._auraAcc = 0;
        const p = this.bossGlow.position;
        this.burst(p.x + (Math.random() - 0.5) * 1.6, 0.3, p.z + (Math.random() - 0.5) * 1.6,
          { count: 1, colors: ["#ffd14a", "#ffb347", "#fff0b0"], speed: 3, life: 0.7, gravity: -45 });
      }
    }
  }
}
