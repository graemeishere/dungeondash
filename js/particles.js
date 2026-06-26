"use strict";
(function (DD) {
  const list = [];
  const texts = [];

  DD.particles = {
    burst(x, y, opts) {
      const { count = 8, colors = ["#fff"], speed = 90, life = 0.5, size = 3, gravity = 0, spread = Math.PI * 2, angle = 0 } = opts || {};
      // 3D mode: route the same params into the 3D particle system (the 2D list
      // isn't drawn in 3D). Effects are raised to ~chest height in world space.
      if (DD.use3d && DD.fx3d && DD.render3d) {
        const w = DD.render3d.cellToWorld(x / DD.TILE, y / DD.TILE);
        DD.fx3d.burst(w.x, 1.4, w.z, { count, colors, speed, life, gravity });
        return;
      }
      for (let i = 0; i < count; i++) {
        const a = angle + (Math.random() - 0.5) * spread;
        const sp = speed * DD.rand(0.4, 1.1);
        list.push({
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: life * DD.rand(0.6, 1.2),
          maxLife: life,
          size: size * DD.rand(0.7, 1.3),
          color: DD.choice(colors),
          gravity,
        });
      }
    },

    text(x, y, str, color = "#fff") {
      texts.push({ x, y, str, color, life: 0.8 });
    },

    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.life -= dt;
        if (p.life <= 0) { list.splice(i, 1); continue; }
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        t.life -= dt;
        if (!DD.use3d) t.y -= 36 * dt; // 2D rises in px; 3D rises in screen space at draw
        if (t.life <= 0) texts.splice(i, 1);
      }
    },

    // Floating damage/heal numbers, for the 3D HUD overlay to project + draw.
    activeTexts() { return texts; },

    draw(ctx) {
      for (const p of list) {
        ctx.globalAlpha = DD.clamp(p.life / (p.maxLife * 0.6), 0, 1);
        ctx.fillStyle = p.color;
        const s = p.size;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      ctx.font = "bold 15px 'Trebuchet MS', Verdana, sans-serif";
      ctx.textAlign = "center";
      for (const t of texts) {
        ctx.globalAlpha = DD.clamp(t.life / 0.4, 0, 1);
        ctx.fillStyle = "#1a1626";
        ctx.fillText(t.str, t.x + 1, t.y + 1);
        ctx.fillStyle = t.color;
        ctx.fillText(t.str, t.x, t.y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    },

    clear() {
      list.length = 0;
      texts.length = 0;
    },
  };
})(window.DD);
