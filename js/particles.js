import { TILE } from "./util.js?v=428b9b89";
import { rt } from "./runtime.js?v=428b9b89";

const texts = [];

export const particles = {
  // Route burst params into the 3D particle system (js/fx3d.js). Effects are
  // raised to ~chest height in world space. Drops silently until the 3D kit
  // has finished loading.
  burst(x, y, opts) {
    const { count = 8, colors = ["#fff"], speed = 90, life = 0.5, gravity = 0 } = opts || {};
    if (rt.fx3d && rt.render3d) {
      const w = rt.render3d.cellToWorld(x / TILE, y / TILE);
      rt.fx3d.burst(w.x, 1.4, w.z, { count, colors, speed, life, gravity });
    }
  },

  text(x, y, str, color = "#fff") {
    texts.push({ x, y, str, color, life: 0.8 });
  },

  update(dt) {
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life -= dt; // rises in screen space at draw time
      if (t.life <= 0) texts.splice(i, 1);
    }
  },

  // Expanding impact ring on the floor.
  ring(x, y, color) {
    if (rt.fx3d && rt.render3d) {
      const w = rt.render3d.cellToWorld(x / TILE, y / TILE);
      rt.fx3d.ring(w.x, 0, w.z, color);
    }
  },

  // Floating damage/heal numbers, for the HUD overlay to project + draw.
  activeTexts() { return texts; },

  clear() {
    texts.length = 0;
  },
};
