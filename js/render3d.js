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

const KIT = "Kenney Modular Dungeon Kit/Models/GLB format/";
const FLOOR = 0, WALL = 1, DOOR = 2;

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

    // Chosen look: top-down ANGLED (Diablo/Hades). Perspective for a touch of depth.
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    this.camAngle = 0; // horizontal orbit for inspection / future camera control

    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2238, 0.9));
    const sun = new THREE.DirectionalLight(0xfff1d0, 1.1);
    sun.position.set(6, 14, 8);
    this.scene.add(sun);

    this.loader = new GLTFLoader();
    this.proto = null;        // { floor, wall, door } meshes
    this.dungeon = null;      // current THREE.Group of InstancedMeshes
    this.CELL = 1;            // grid cell size, derived from the floor footprint
    this.wallH = 1;
    this.W = 0; this.H = 0;
    this._w = 1; this._h = 1; // viewport px (for projectToScreen)

    // Resolves once the kit pieces are loaded; callers await this before build.
    this.ready = this._loadPieces();
  }

  async _loadPieces() {
    const load = (n) =>
      this.loader.loadAsync(encodeURI(KIT + n + ".glb")).then((g) => g.scene);
    const [floor, wall, door] = await Promise.all([
      load("template-floor"), load("template-wall"), load("gate-door"),
    ]);
    // Bake each piece's intrinsic GLB transform (scale/orientation) into a base
    // matrix so instances reproduce it exactly.
    const baseOf = (root) => {
      const m = firstMesh(root);
      m.updateWorldMatrix(true, false);
      return { mesh: m, base: m.matrixWorld.clone() };
    };
    this.proto = { floor: baseOf(floor), wall: baseOf(wall), door: baseOf(door) };

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

  // Build (or rebuild) the dungeon mesh from a tile grid.
  // grid: { tiles:number[], w:number, h:number }
  buildRoom({ tiles, w, h }) {
    if (this.dungeon) { this.scene.remove(this.dungeon); this.dungeon = null; }
    this.W = w; this.H = h;

    const floors = [], walls = [], doors = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        floors.push([x, y]); // floor under every cell
        const t = tiles[y * w + x];
        if (t === WALL) walls.push([x, y]);
        else if (t === DOOR) doors.push([x, y]);
      }
    }
    const g = new THREE.Group();
    g.add(this._instance(this.proto.floor, floors));
    if (walls.length) g.add(this._instance(this.proto.wall, walls));
    if (doors.length) g.add(this._instance(this.proto.door, doors));
    this.scene.add(g);
    this.dungeon = g;
    this._frameCamera();
    return { drawCalls: 1 + (walls.length ? 1 : 0) + (doors.length ? 1 : 0) };
  }

  _frameCamera() {
    this._span = Math.max(this.W, this.H) * this.CELL;
  }

  resize(w, h) {
    this._w = w; this._h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // gx,gy may be fractional (entity world position in cells) -> screen px + depth.
  // This is the bridge Phase 2 will use to billboard 2D character sprites.
  projectToScreen(gx, gy, gridYUp = 0) {
    const v = this._cellWorld(gx, gy);
    v.y = gridYUp;
    v.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this._w, y: (-v.y * 0.5 + 0.5) * this._h, depth: v.z };
  }

  setOrbit(angle) { this.camAngle = angle; }

  render() {
    const r = (this._span || 10) * 0.52, y = (this._span || 10) * 0.62;
    this.camera.position.set(Math.sin(this.camAngle) * r, y, Math.cos(this.camAngle) * r);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
    return this.renderer.info.render; // { calls, triangles, ... }
  }
}
