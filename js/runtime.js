"use strict";
// Late-bound 3D handles.
//
// The renderer, character manager and effects system are created asynchronously
// by js/boot3d.js — after GLB kits and rigs resolve — while the rest of the game
// is already running and drawing 2D fallbacks. A plain `import` can't express
// "this exists later", so they live as properties on one shared object that
// boot3d.js fills in and everything else reads through.
//
// Read them as `rt.render3d`, never destructure: a destructured `const
// { render3d } = rt` captures whatever null was there at import time.
export const rt = {
  render3d: null,  // DungeonRenderer (js/render3d.js)
  charMgr: null,   // CharacterManager (js/char3d.js)
  char3d: null,    // { classModelKey, enemyModelKey, RIG }
  fx3d: null,      // FX3D particle system (js/fx3d.js)
};
