"use strict";
// 3D boot: creates the renderer and the character manager, then hands them to
// the rest of the game. Lifted verbatim out of the inline <script type="module">
// that used to live at the bottom of index.html, so that index.html carries
// markup and one entry point rather than logic.
//
// Loaded after js/boot.js, matching the old ordering (game code first, then the
// 3D layer attaching itself to it).
import { DungeonRenderer } from "./render3d.js?v=0511a6b1";
import { rt } from "./runtime.js?v=0511a6b1";

const c3 = document.getElementById("game3d");
const dr = new DungeonRenderer(c3);
rt.render3d = dr;
// boot.js ran its first fitCanvas() before this renderer existed, so size it now
// (otherwise the view is squashed until the first window resize).
dr.resize(c3.width || window.innerWidth, c3.height || window.innerHeight);

// Start loading the KayKit characters IMMEDIATELY, in parallel with the decor
// kit — players/enemies fall back to 2D billboards until their model arrives,
// and a floor can boot straight into gameplay, so getting the models in early is
// what kills the billboard flash. (The decor kit itself resolves fast; it was
// the serialized char load after it that was slow.)
(async () => {
  const m = await import("./char3d.js?v=0511a6b1");
  const mgr = new m.CharacterManager(dr.scene, new m.CharacterFactory());
  // expose the swappable mappings to the game
  rt.char3d = { classModelKey: m.classModelKey, enemyModelKey: m.enemyModelKey, RIG: m.RIG };
  // Set charMgr immediately and load models in the background, so each character
  // pops in as its model arrives instead of waiting for all.
  rt.charMgr = mgr;
  await mgr.preloadAll();
  console.log("char3d: ready");
})().catch((e) => console.error("3D character preload failed:", e));

try { await dr.ready; } catch (e) { console.error("3D kit load failed:", e); }
dr.loadItems().catch((e) => console.error("3D items load failed:", e)); // background
dr.loadProjectiles().catch((e) => console.error("3D projectiles load failed:", e));
// 3D combat effects (particles); bridged from the particle system
try {
  const fx = await import("./fx3d.js?v=0511a6b1");
  rt.fx3d = new fx.FX3D(dr.scene);
} catch (e) { console.error("3D fx load failed:", e); }
