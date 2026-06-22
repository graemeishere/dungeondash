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

    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x40384f, 1.05));
    const sun = new THREE.DirectionalLight(0xfff1d0, 1.4);
    sun.position.set(8, 18, 10);
    this.scene.add(sun);

    this.kit = DUNGEON_KITS[ACTIVE_KIT];
    this.loader = new GLTFLoader();
    this.proto = null;        // { floor, wall, door } meshes
    this.dungeon = null;      // current THREE.Group of InstancedMeshes
    this.CELL = 1;            // grid cell size, derived from the floor footprint
    this.wallH = 1;
    this.W = 0; this.H = 0;
    this._w = 1; this._h = 1; // viewport px (for projectToScreen)

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

    const fb = new THREE.Box3().setFromObject(floor);
    this.CELL = Math.max(fb.max.x - fb.min.x, fb.max.z - fb.min.z) || 1;
    const wb = new THREE.Box3().setFromObject(wall);
    this.wallH = wb.max.y - wb.min.y;
    return this;
  }

  // Grid cell (gx,gy) -> world-space center, matching the layout used for instances.
  _cellWorld(gx, gy) {
    return new THREE.Vector3(
      (gx - this.W / 2 + 0.5) * this.CELL, 0, (gy - this.H / 2 + 0.5) * this.CELL,
    );
  }

  _instance(proto, cells) {
    const inst = new THREE.InstancedMesh(proto.mesh.geometry, proto.mesh.material, cells.length);
    const t = new THREE.Matrix4(), out = new THREE.Matrix4();
    cells.forEach(([gx, gy], i) => {
      const p = this._cellWorld(gx, gy);
      t.makeTranslation(p.x, p.y, p.z);
      out.multiplyMatrices(t, proto.base); // place at cell, keep the piece's own transform
      inst.setMatrixAt(i, out);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false; // whole room is on-screen; skip per-instance culling
    return inst;
  }

  // Thin directional wall panels placed on floor-cell edges. edges: [{gx,gy,dir}]
  // dir in N/S/E/W; the panel sits on that boundary, rotated to face inward.
  _instanceWalls(proto, edges) {
    const inst = new THREE.InstancedMesh(proto.mesh.geometry, proto.mesh.material, edges.length);
    const T = new THREE.Matrix4(), R = new THREE.Matrix4(), M = new THREE.Matrix4();
    const half = this.CELL / 2;
    edges.forEach((e, i) => {
      const c = this._cellWorld(e.gx, e.gy);
      let ox = 0, oz = 0, rot = 0;
      if (e.dir === "N") { oz = -half; rot = 0; }
      else if (e.dir === "S") { oz = half; rot = 0; }
      else if (e.dir === "E") { ox = half; rot = Math.PI / 2; }
      else { ox = -half; rot = Math.PI / 2; }
      T.makeTranslation(c.x + ox, 0, c.z + oz);
      R.makeRotationY(rot);
      M.multiplyMatrices(T, R).multiply(proto.base);
      inst.setMatrixAt(i, M);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    return inst;
  }

  // Build (or rebuild) the dungeon mesh from a tile grid.
  // grid: { tiles:number[], w:number, h:number }
  buildRoom({ tiles, w, h }) {
    if (this.dungeon) { this.scene.remove(this.dungeon); this.dungeon = null; }
    this.W = w; this.H = h;
    const g = new THREE.Group();
    let drawCalls;

    if (this.kit.wallStyle === "edge") {
      // KayKit: floor on floor+door cells; thin walls on every floor-cell edge
      // whose neighbour is solid (WALL or out-of-bounds). DOOR/FLOOR neighbours
      // stay open, which leaves the doorway gap for free.
      const solid = (x, y) => x < 0 || y < 0 || x >= w || y >= h || tiles[y * w + x] === WALL;
      const floors = [], edges = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const t = tiles[y * w + x];
          if (t === WALL) continue;        // wall cells: no floor
          floors.push([x, y]);             // floor + door cells get a floor tile
          if (t === DOOR) continue;        // door cells: keep the opening
          if (solid(x, y - 1)) edges.push({ gx: x, gy: y, dir: "N" });
          if (solid(x, y + 1)) edges.push({ gx: x, gy: y, dir: "S" });
          if (solid(x + 1, y)) edges.push({ gx: x, gy: y, dir: "E" });
          if (solid(x - 1, y)) edges.push({ gx: x, gy: y, dir: "W" });
        }
      }
      g.add(this._instance(this.proto.floor, floors));
      if (edges.length) g.add(this._instanceWalls(this.proto.wall, edges));
      drawCalls = 1 + (edges.length ? 1 : 0);
    } else {
      // Kenney: floor under every cell, symmetric wall/door blocks fill cells.
      const floors = [], walls = [], doors = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          floors.push([x, y]);
          const t = tiles[y * w + x];
          if (t === WALL) walls.push([x, y]);
          else if (t === DOOR) doors.push([x, y]);
        }
      }
      g.add(this._instance(this.proto.floor, floors));
      if (walls.length) g.add(this._instance(this.proto.wall, walls));
      if (doors.length && this.proto.door) g.add(this._instance(this.proto.door, doors));
      drawCalls = 1 + (walls.length ? 1 : 0) + (doors.length ? 1 : 0);
    }

    this.scene.add(g);
    this.dungeon = g;
    this._frameCamera();
    return { drawCalls };
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

  render() {
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
