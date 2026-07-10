"use strict";
// Phase 1 of the 2D->3D transition: a reusable 3D dungeon renderer.
//
// Design contract (see docs/plans/2026-06-20-3d-dungeon-transition-scope.md):
//   * The 2D tile grid stays the source of truth. This module only DRAWS it.
//   * It consumes the same `tiles[]` model js/room.js owns (0=floor,1=wall,2=door).
//   * Architecture is rendered with InstancedMesh keyed on the Kenney kit's
//     single shared colormap material, so the whole room is a handful of draw
//     calls regardless of size (the spike's 438 naive-clone calls -> ~3).
//   * Characters are NOT handled here yet; Phase 2 billboards 2D sprites using
//     the projectToScreen() helper below.
//
// ES module (modern three.js is ESM). The host page provides an importmap that
// resolves the bare "three" specifier to js/lib/three/three.module.js.
import * as THREE from "three";
import { GLTFLoader } from "./lib/three/GLTFLoader.js";
import { planRoomDecor, PIECE_DIR } from "./decor3d.js";

const FLOOR = 0, WALL = 1, DOOR = 2;

// Swappable dungeon kits. "edge" walls are thin directional panels placed on
// floor-cell boundaries (KayKit); "fill" walls are symmetric blocks that fill a
// whole wall cell (Kenney). Switch the whole look by changing ACTIVE_KIT.
const DUNGEON_KITS = {
  kaykit: {
    dir: "KayKit Dungeon Remastered/Assets/gltf/",
    ext: ".gltf", floor: "floor_tile_large", wall: "wall", wallStyle: "edge",
  },
  kenney: {
    dir: "Kenney Modular Dungeon Kit/Models/GLB format/",
    ext: ".glb", floor: "template-floor", wall: "template-wall", door: "gate-door",
    wallStyle: "fill",
  },
};
const ACTIVE_KIT = "kaykit";
const ORIGIN = new THREE.Vector3(0, 0, 0);

// 3D pickups/props (from the KayKit dungeon pack). Swappable like the kits.
const ITEM_DIR = "KayKit Dungeon Remastered/Assets/gltf/";
const ITEMS = {
  coin:  { url: ITEM_DIR + "coin.gltf",           scale: 4.0, spin: true, bob: true },
  heart: { url: ITEM_DIR + "bottle_A_green.gltf", scale: 1.6, bob: true },
  chest: { url: ITEM_DIR + "chest.gltf",          scale: 1.3 },
  // weapon/gear drops (KayKit Adventurers assets); keyed by item.icon
  sword: { url: "KayKit Adventurers/Assets/gltf/sword_1handed.gltf", scale: 1.3, spin: true, bob: true },
  axe:   { url: "KayKit Adventurers/Assets/gltf/axe_1handed.gltf",   scale: 1.3, spin: true, bob: true },
};

// Flying projectiles rendered as 3D models oriented along their velocity (the
// model points +Z; rotation.y = atan2(vx, vy) aligns it with the shot).
const PROJECTILES = {
  arrow: { url: "KayKit Adventurers/Assets/gltf/arrow_bow.gltf", scale: 1.4, y: 0.6 },
};

// Pull the first renderable mesh out of a loaded GLB scene. Kenney pieces are a
// single mesh sharing the colormap material, so this is all we need to instance.
function firstMesh(root) {
  let found = null;
  root.traverse((o) => { if (!found && o.isMesh) found = o; });
  return found;
}

export class DungeonRenderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // cap for mobile
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0812);

    // Low isometric "diorama" look (KayKit). Perspective for a touch of depth.
    // Tuned values (user-chosen): 25° elevation, 35° FOV.
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 600);
    this.camAngle = 0;        // horizontal orbit offset (spike inspection)
    this.elev = 0.436;        // camera elevation in radians (~25°)
    this.camMode = "fixed";   // "fixed" = frame whole room, "follow" = track player
    this.followT = new THREE.Vector3();
    this._camDist = 40;
    this._fixedDist = 40;

    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x40384f, 1.05);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d0, 1.4);
    this.sun.position.set(8, 18, 10);
    this.scene.add(this.sun);
    // Fixed pool of 2 point lights (a fixed count avoids three.js shader
    // recompiles when rooms change): [0] = the room's scripted light (boss
    // centerpiece / hub warmth), [1] = the doorway glow when the gate opens.
    this.pointLights = [0, 1].map(() => {
      const pl = new THREE.PointLight(0xffffff, 0, 60, 1.6);
      this.scene.add(pl);
      return pl;
    });

    this.kit = DUNGEON_KITS[ACTIVE_KIT];
    this.loader = new GLTFLoader();
    this.proto = null;        // { floor, wall, door } meshes
    this.dungeon = null;      // current THREE.Group of InstancedMeshes
    this.CELL = 1;            // grid cell size, derived from the floor footprint
    this.wallH = 1;
    this.W = 0; this.H = 0;
    this._w = 1; this._h = 1; // viewport px (for projectToScreen)

    // Decor piece registry: every named piece the decor planner can request,
    // lazy-loaded and cached. When late loads land, needsRebuild asks the
    // caller (game3d) for one identical rebuild that now includes them.
    this.pieceProtos = new Map(); // name -> { mesh, base }
    this.pieceFailed = new Set();
    this.needsRebuild = false;
    this._lastDesc = null;
    this.flameWorld = [];     // torch-flame world positions for fx3d

    // Billboard layer: 2D character sprites stood up as camera-facing quads in
    // the 3D scene (Phase 2). Kept in its own group so rebuilding the dungeon
    // architecture never disturbs the entities.
    this.spriteGroup = new THREE.Group();
    this.scene.add(this.spriteGroup);
    this._pool = []; // reused THREE.Sprite slots

    // 3D items/pickups (coins, potions, chests).
    this.itemGroup = new THREE.Group();
    this.scene.add(this.itemGroup);
    this.itemProtos = {};       // key -> loaded scene prototype
    this.itemMap = new Map();   // entity -> { mesh, cfg }

    // 3D projectiles (arrows) oriented along velocity.
    this.projGroup = new THREE.Group();
    this.scene.add(this.projGroup);
    this.projProtos = {};
    this.projMap = new Map();

    // Resolves once the kit pieces are loaded; callers await this before build.
    this.ready = this._loadPieces();
  }

  async _loadPieces() {
    const k = this.kit;
    const load = (n) => this.loader.loadAsync(encodeURI(k.dir + n + k.ext)).then((g) => g.scene);
    const names = [k.floor, k.wall].concat(k.door ? [k.door] : []);
    const scenes = await Promise.all(names.map(load));
    const [floor, wall, door] = scenes;
    // Bake each piece's intrinsic transform (scale/orientation) into a base
    // matrix so instances reproduce it exactly.
    const baseOf = (root) => {
      const m = firstMesh(root);
      m.updateWorldMatrix(true, false);
      return { mesh: m, base: m.matrixWorld.clone() };
    };
    this.proto = { floor: baseOf(floor), wall: baseOf(wall) };
    if (door) this.proto.door = baseOf(door);
    // seed the decor registry with the base pieces so ensurePieces never
    // re-fetches them
    this.pieceProtos.set(k.floor, this.proto.floor);
    this.pieceProtos.set(k.wall, this.proto.wall);

    const fb = new THREE.Box3().setFromObject(floor);
    this.CELL = Math.max(fb.max.x - fb.min.x, fb.max.z - fb.min.z) || 1;
    const wb = new THREE.Box3().setFromObject(wall);
    this.wallH = wb.max.y - wb.min.y;
    return this;
  }

  // Lazy-load decor pieces by name (from the KayKit pack). Anything that was
  // missing when the room built triggers exactly one rebuild once loaded.
  async ensurePieces(names) {
    const missing = names.filter((n) => !this.pieceProtos.has(n) && !this.pieceFailed.has(n));
    if (!missing.length) return;
    let loadedAny = false;
    await Promise.allSettled(missing.map(async (n) => {
      try {
        const g = await this.loader.loadAsync(encodeURI(PIECE_DIR + n + ".gltf"));
        const meshes = [];
        g.scene.updateWorldMatrix(true, true);
        g.scene.traverse((o) => { if (o.isMesh) meshes.push({ mesh: o, base: o.matrixWorld.clone() }); });
        if (!meshes.length) throw new Error("no mesh in " + n);
        // meshes: every submesh (some pieces, e.g. spike tiles, have several);
        // mesh/base: the first, for single-mesh consumers; scene: for cloning
        this.pieceProtos.set(n, { mesh: meshes[0].mesh, base: meshes[0].base, meshes, scene: g.scene });
        loadedAny = true;
      } catch (e) {
        this.pieceFailed.add(n); // log-and-drop: the planner keeps its RNG
        console.error("decor piece load failed:", n, e);
      }
    }));
    if (loadedAny) this.needsRebuild = true;
  }

  // Grid cell (gx,gy) -> world-space center, matching the layout used for instances.
  _cellWorld(gx, gy) {
    return new THREE.Vector3(
      (gx - this.W / 2 + 0.5) * this.CELL, 0, (gy - this.H / 2 + 0.5) * this.CELL,
    );
  }

  // Rotation that makes a wall-hugging piece face into the room from a wall on
  // the given side (models face +Z at rot 0; the room lies +Z of a north wall).
  static _inwardRot(dir) {
    return dir === "N" ? 0 : dir === "S" ? Math.PI : dir === "E" ? -Math.PI / 2 : Math.PI / 2;
  }

  // Build (or rebuild) the dungeon from a tile grid + decor inputs.
  // desc: { tiles:number[], w, h, seed?, theme?, roomType?, isLobby?, isTown? }
  // Missing decor fields default so old callers ({tiles,w,h}) keep working.
  buildRoom(desc) {
    if (this.dungeon) { this.scene.remove(this.dungeon); this.dungeon = null; }
    this.needsRebuild = false;
    this._lastDesc = desc;
    const { w, h } = desc;
    this.W = w; this.H = h;
    const g = new THREE.Group();

    const plan = planRoomDecor(desc);
    this.ensurePieces(plan.pieces); // background; sets needsRebuild when done
    this.setAtmosphere(plan.atmosphere);

    // Group placements by piece -> one InstancedMesh per piece type. Unloaded
    // architecture falls back to the base floor/wall (never see-through while
    // variants stream in); unloaded props are skipped until the rebuild.
    const groups = new Map(); // piece -> [{gx,gy,rot,mount,up,edge,dir}]
    const put = (piece, placement, fallback) => {
      if (!this.pieceProtos.has(piece)) {
        if (!fallback || !this.pieceProtos.has(fallback)) return;
        piece = fallback;
      }
      let list = groups.get(piece);
      if (!list) groups.set(piece, (list = []));
      list.push(placement);
    };
    for (const f of plan.floors) put(f.piece, f, this.kit.floor);
    for (const wl of plan.walls) put(wl.piece, { ...wl, rot: DungeonRenderer._inwardRot(wl.dir), edge: true }, this.kit.wall);
    for (const p of plan.props) put(p.piece, p, null);

    let drawCalls = 0;
    for (const [piece, placements] of groups) {
      const proto = this.pieceProtos.get(piece);
      // one InstancedMesh per submesh of the piece (most have exactly one);
      // fit scale derives from the piece's first submesh so they stay together
      for (const sub of (proto.meshes || [proto])) {
        g.add(this._instancePlaced(sub, placements, proto));
        drawCalls++;
      }
    }

    // torch-flame emitters in world space, for fx3d
    this.flameWorld = plan.flames.map((f) => {
      const p = this._placementWorld(f);
      return { x: p.x, y: f.up * this.wallH, z: p.z };
    });

    // scripted room light (slot 0); slot 1 is reserved for the doorway glow
    const scripted = (plan.lights || [])[0];
    const pl0 = this.pointLights[0];
    if (scripted) {
      const p = this._cellWorld(scripted.gx, scripted.gy);
      pl0.position.set(p.x, scripted.up * this.wallH, p.z);
      pl0.color.set(scripted.color);
      pl0.intensity = scripted.intensity * this.CELL * this.CELL; // physical falloff
      pl0.distance = this.CELL * 10;
    } else {
      pl0.intensity = 0;
    }
    this.pointLights[1].intensity = 0;

    // Doorway frames + gates. Cloned (not instanced): wall_doorway is a
    // multi-mesh piece and there are at most a couple of door cells. The gate
    // slides up out of the frame on setDoorOpen — no room rebuild involved.
    if (this.doorGroup) { this.scene.remove(this.doorGroup); this.doorGroup = null; }
    this.gates = [];
    this._doorOpen = null; // force game3d's per-frame diff to re-apply state
    this._doorCenter = null;
    if (plan.door && plan.door.cells.length) {
      const dc = plan.door.cells;
      const avg = dc.reduce((a, c) => { const p = this._cellWorld(c.gx, c.gy); a.x += p.x; a.z += p.z; return a; }, { x: 0, z: 0 });
      this._doorCenter = { x: avg.x / dc.length, z: avg.z / dc.length + this.CELL / 2 };
    }
    if (plan.door && plan.door.cells.length) {
      const frameProto = this.pieceProtos.get(plan.door.frame);
      const gateProto = this.pieceProtos.get(plan.door.gate);
      const dg = new THREE.Group();
      for (const c of plan.door.cells) {
        // the doorway stands on the wall line's inner face (the boundary the
        // neighbouring wall panels sit on)
        const pos = this._cellWorld(c.gx, c.gy);
        pos.z += this.CELL / 2;
        if (frameProto && frameProto.scene) {
          const f = frameProto.scene.clone(true);
          f.position.copy(pos);
          dg.add(f);
        }
        if (gateProto && gateProto.scene) {
          const gt = gateProto.scene.clone(true);
          gt.position.copy(pos);
          dg.add(gt);
          this.gates.push(gt);
        }
      }
      this.scene.add(dg);
      this.doorGroup = dg;
    }

    // Spike traps: InstancedMeshes (one per submesh of the spike tile) whose
    // per-instance Y follows the trap cycle (sunk / warning tips / up), driven
    // by updateSpikes() each frame. Timing stays authoritative in room.js.
    if (this.spikeInst) { this.scene.remove(this.spikeInst); this.spikeInst = null; this._spikeSubs = null; }
    this.spikeList = plan.spikes || [];
    const spikeProto = this.pieceProtos.get("floor_tile_big_spikes");
    if (this.spikeList.length && spikeProto) {
      const grp = new THREE.Group();
      this._spikeSubs = (spikeProto.meshes || [spikeProto]).map((sub) => {
        const inst = new THREE.InstancedMesh(sub.mesh.geometry, sub.mesh.material, this.spikeList.length);
        inst.frustumCulled = false;
        grp.add(inst);
        return { inst, base: sub.base };
      });
      this.scene.add(grp);
      this.spikeInst = grp;
      this.updateSpikes(this.spikeList.map(() => 0));
    }

    this.scene.add(g);
    this.dungeon = g;
    this._frameCamera();
    return { drawCalls };
  }

  // stages[i]: 0 = sunk under the floor, 1 = warning tips, 2 = fully up.
  // The spike tile's blades rise ~2u from its base, so sinking 2.15u hides it.
  updateSpikes(stages) {
    if (!this._spikeSubs) return;
    const T = new THREE.Matrix4(), M = new THREE.Matrix4();
    const LIFT = [-2.15, -1.55, -0.02];
    for (const { inst, base } of this._spikeSubs) {
      this.spikeList.forEach((s, i) => {
        const p = this._cellWorld(s.tx, s.ty);
        T.makeTranslation(p.x, LIFT[stages[i]] ?? LIFT[0], p.z);
        M.multiplyMatrices(T, base);
        inst.setMatrixAt(i, M);
      });
      inst.instanceMatrix.needsUpdate = true;
    }
  }

  // Slide the gates up into the frame (open) or back down (closed). Instant
  // skips the tween — used right after a rebuild and for guests joining a
  // room that is already cleared.
  setDoorOpen(open, instant = false) {
    this._doorOpen = !!open;
    this._doorAnimT = instant ? 1 : 0;
  }

  // World position for a planner placement: cell center, pushed to the wall
  // boundary when mounted on an edge.
  _placementWorld(p) {
    const c = this._cellWorld(p.gx, p.gy);
    const off = this.CELL * 0.42; // just inside the wall face
    if (p.mount === "N") c.z -= off;
    else if (p.mount === "S") c.z += off;
    else if (p.mount === "E") c.x += off;
    else if (p.mount === "W") c.x -= off;
    return c;
  }

  // Uniform scale that makes a piece's footprint fill `fit` of a cell (used
  // for obstacle props of very different natural sizes).
  _fitScale(proto, fit) {
    if (!proto.mesh.geometry.boundingBox) proto.mesh.geometry.computeBoundingBox();
    const bb = proto.mesh.geometry.boundingBox;
    const s = proto.base.getMaxScaleOnAxis() || 1;
    const span = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * s;
    if (!span) return 1;
    return Math.min(3, Math.max(0.5, (fit * this.CELL) / span));
  }

  // Instance a (sub)mesh over planner placements
  // ({gx,gy,rot,mount?,up?,edge?,fit?}); fitProto anchors auto-fit scale to the
  // whole piece rather than this submesh.
  _instancePlaced(proto, placements, fitProto) {
    const inst = new THREE.InstancedMesh(proto.mesh.geometry, proto.mesh.material, placements.length);
    const T = new THREE.Matrix4(), R = new THREE.Matrix4(), S = new THREE.Matrix4(), M = new THREE.Matrix4();
    const half = this.CELL / 2;
    placements.forEach((p, i) => {
      let pos;
      if (p.edge) {
        // wall panels sit ON the cell boundary (not inset like mounted props)
        pos = this._cellWorld(p.gx, p.gy);
        if (p.dir === "N") pos.z -= half;
        else if (p.dir === "S") pos.z += half;
        else if (p.dir === "E") pos.x += half;
        else pos.x -= half;
      } else {
        pos = this._placementWorld(p);
        pos.x += (p.ox || 0) * this.CELL; // sub-cell offsets (quarter-tile quads)
        pos.z += (p.oz || 0) * this.CELL;
      }
      const rot = p.mount ? DungeonRenderer._inwardRot(p.mount) : (p.rot || 0);
      T.makeTranslation(pos.x, (p.up || 0) * this.wallH, pos.z);
      R.makeRotationY(p.edge ? (p.rot || 0) : rot);
      M.multiplyMatrices(T, R);
      if (p.fit) { const k = this._fitScale(fitProto || proto, p.fit); S.makeScale(k, k, k); M.multiply(S); }
      M.multiply(proto.base);
      inst.setMatrixAt(i, M);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    return inst;
  }

  // Per-theme scene mood: background + light colors.
  setAtmosphere(a) {
    if (!a) return;
    this.scene.background.set(a.bg);
    this.hemi.color.set(a.hemiSky);
    this.hemi.groundColor.set(a.hemiGround);
    this.sun.color.set(a.sun);
  }

  _frameCamera() {
    this._span = Math.max(this.W, this.H) * this.CELL;
    // Distance to fit the whole room at the iso angle (tuned). The wider of the
    // two spans drives it so nothing clips off-screen.
    this._fixedDist = this._span * 1.15;
    if (this.camMode === "fixed") this._camDist = this._fixedDist;
  }

  // "fixed" frames the whole room; "follow" tracks the player at a closer zoom.
  setCameraMode(mode) {
    this.camMode = mode === "follow" ? "follow" : "fixed";
    this._camDist = this.camMode === "follow" ? this.CELL * 5 : (this._fixedDist || this._span * 1.15);
  }
  setFollowTarget(x, z) { this.followT.set(x, 0, z); }

  resize(w, h) {
    this._w = w; this._h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // gx,gy may be fractional (entity world position in cells) -> screen px + depth.
  // This is the bridge Phase 2 will use to billboard 2D character sprites.
  projectToScreen(gx, gy, gridYUp = 0) {
    const v = this.cellToWorld(gx, gy);
    v.y = gridYUp;
    v.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this._w, y: (-v.y * 0.5 + 0.5) * this._h, depth: v.z };
  }

  setOrbit(angle) { this.camAngle = angle; }

  // Continuous entity position (cx,cy = px/TILE) -> world. Entities already
  // encode their fractional position, so unlike _cellWorld (which takes integer
  // tile indices and centres them with +0.5) we must NOT add the half-cell
  // offset — doing so pushed characters half a cell (2u) off the floor/wall
  // grid, which read as walking into / not reaching the walls.
  cellToWorld(cx, cy) {
    return new THREE.Vector3((cx - this.W / 2) * this.CELL, 0, (cy - this.H / 2) * this.CELL);
  }

  _makeSprite() {
    const tex = new THREE.CanvasTexture(document.createElement("canvas"));
    tex.magFilter = THREE.NearestFilter; // keep the pixel art crisp
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    this.spriteGroup.add(sp);
    return sp;
  }

  // Stand up the game's 2D entities as billboards on the 3D floor. Each item:
  //   { canvas, gx, gy, w, h, cx, cy }
  //   canvas   - per-entity offscreen render (captured 2D sprite)
  //   gx, gy   - fractional grid position (entity world px / TILE)
  //   w, h     - billboard size in world units
  //   cx, cy   - sprite anchor in [0..1] from lower-left (feet ~ (0.5, low))
  setEntities(items) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const sp = this._pool[i] || (this._pool[i] = this._makeSprite());
      sp.visible = true;
      const tex = sp.material.map;
      tex.image = it.canvas;
      tex.needsUpdate = true;
      const p = this.cellToWorld(it.gx, it.gy); // continuous entity mapping
      sp.position.set(p.x, 0, p.z);
      sp.scale.set(it.w, it.h, 1);
      sp.center.set(it.cx, it.cy);
    }
    for (let i = items.length; i < this._pool.length; i++) this._pool[i].visible = false;
  }

  // Load the 3D pickup/prop models (call once, in the background).
  async loadItems() {
    const entries = Object.entries(ITEMS);
    const res = await Promise.allSettled(
      entries.map(([, c]) => this.loader.loadAsync(encodeURI(c.url)).then((g) => g.scene))
    );
    res.forEach((r, i) => {
      if (r.status === "fulfilled") this.itemProtos[entries[i][0]] = r.value;
      else console.error("item load failed:", entries[i][0], r.reason);
    });
    return this;
  }

  // Place 3D items on the floor from a per-frame list: { entity, key, gx, gy }.
  // Static meshes (no rig) with optional spin/bob. Entities not present are removed.
  setItems(list) {
    const now = performance.now() * 0.001;
    const seen = new Set();
    for (const it of list) {
      seen.add(it.entity);
      let rec = this.itemMap.get(it.entity);
      if (!rec) {
        const proto = this.itemProtos[it.key];
        if (!proto) continue; // not loaded (or unknown) -> caller billboards it
        const cfg = ITEMS[it.key];
        const mesh = proto.clone(true);
        mesh.scale.setScalar(cfg.scale);
        this.itemGroup.add(mesh);
        rec = { mesh, cfg };
        this.itemMap.set(it.entity, rec);
      }
      const p = this.cellToWorld(it.gx, it.gy);
      const bob = rec.cfg.bob ? 0.25 + Math.sin(now * 3 + it.gx) * 0.15 : 0;
      rec.mesh.position.set(p.x, bob, p.z);
      if (rec.cfg.spin) rec.mesh.rotation.y = now * 2.5;
    }
    for (const [ent, rec] of this.itemMap) {
      if (!seen.has(ent)) { this.itemGroup.remove(rec.mesh); this.itemMap.delete(ent); }
    }
  }

  // True if a given item key has a loaded 3D model.
  hasItem(key) { return !!this.itemProtos[key]; }

  async loadProjectiles() {
    const entries = Object.entries(PROJECTILES);
    const res = await Promise.allSettled(
      entries.map(([, c]) => this.loader.loadAsync(encodeURI(c.url)).then((g) => g.scene))
    );
    res.forEach((r, i) => {
      if (r.status === "fulfilled") this.projProtos[entries[i][0]] = r.value;
      else console.error("projectile load failed:", entries[i][0], r.reason);
    });
    return this;
  }
  hasProjectile(key) { return !!this.projProtos[key]; }

  // Place flying projectiles from { entity, key, gx, gy, rotationY }.
  setProjectiles(list) {
    const seen = new Set();
    for (const it of list) {
      seen.add(it.entity);
      let rec = this.projMap.get(it.entity);
      if (!rec) {
        const proto = this.projProtos[it.key];
        if (!proto) continue;
        const cfg = PROJECTILES[it.key];
        const mesh = proto.clone(true);
        mesh.scale.setScalar(cfg.scale);
        this.projGroup.add(mesh);
        rec = { mesh, cfg };
        this.projMap.set(it.entity, rec);
      }
      const p = this.cellToWorld(it.gx, it.gy);
      rec.mesh.position.set(p.x, rec.cfg.y, p.z);
      rec.mesh.rotation.y = it.rotationY;
    }
    for (const [ent, rec] of this.projMap) {
      if (!seen.has(ent)) { this.projGroup.remove(rec.mesh); this.projMap.delete(ent); }
    }
  }

  render() {
    // gate open/close tween (~0.55s), driven by wall-clock frame delta
    if (this.gates && this.gates.length && this._doorOpen !== null) {
      const now = performance.now();
      const dt = Math.min(0.05, (now - (this._lastRenderT || now)) / 1000);
      this._doorAnimT = Math.min(1, (this._doorAnimT == null ? 1 : this._doorAnimT) + dt / 0.55);
      const k = this._doorAnimT;
      const lift = (this._doorOpen ? k : 1 - k) * this.wallH * 0.92;
      for (const gt of this.gates) {
        gt.position.y = lift;
        gt.visible = !(this._doorOpen && k >= 1); // fully open = out of sight
      }
      // warm glow spilling from the open doorway — "the way forward"
      const glow = this.pointLights[1];
      if (this._doorCenter) {
        const g = (this._doorOpen ? k : 1 - k) * 1.1 * this.CELL * this.CELL;
        glow.position.set(this._doorCenter.x, this.wallH * 0.5, this._doorCenter.z);
        glow.color.set(0xffc070);
        glow.distance = this.CELL * 6;
        glow.intensity = g;
      }
    }
    this._lastRenderT = performance.now();

    const tgt = this.camMode === "follow" ? this.followT : ORIGIN;
    const dist = this._camDist || (this._span || 10) * 1.15;
    const horiz = dist * Math.cos(this.elev), cy = dist * Math.sin(this.elev);
    // camAngle=0 puts the camera on the +Z (front) side looking toward -Z, the
    // KayKit diorama framing; the spike can orbit via setOrbit().
    this.camera.position.set(tgt.x + Math.sin(this.camAngle) * horiz, cy, tgt.z + Math.cos(this.camAngle) * horiz);
    this.camera.lookAt(tgt.x, 0, tgt.z);
    this.renderer.render(this.scene, this.camera);
    return this.renderer.info.render; // { calls, triangles, ... }
  }
}
