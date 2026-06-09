"use strict";
(function (DD) {
  DD.hud = {
    draw(ctx, game) {
      const pl = game.player;
      const font = "'Trebuchet MS', Verdana, sans-serif";

      // --- HP bar ---
      const bx = 16, by = 14, bw = 190, bh = 18;
      ctx.fillStyle = "rgba(10,8,18,0.7)";
      ctx.fillRect(bx - 4, by - 4, bw + 8, bh + 30);
      ctx.fillStyle = "#1a1626";
      ctx.fillRect(bx, by, bw, bh);
      const frac = DD.clamp(pl.hp / pl.maxHp, 0, 1);
      ctx.fillStyle = frac > 0.5 ? "#6fce6f" : frac > 0.25 ? "#e8c84a" : "#e8484f";
      ctx.fillRect(bx, by, bw * frac, bh);
      // segment ticks, one per HP point
      ctx.fillStyle = "rgba(10,8,18,0.5)";
      for (let i = 1; i < pl.maxHp; i++) {
        ctx.fillRect(bx + (bw / pl.maxHp) * i, by, 1, bh);
      }
      ctx.fillStyle = "#f2ecdd";
      ctx.font = `bold 12px ${font}`;
      ctx.textAlign = "center";
      ctx.fillText(`${pl.hp} / ${pl.maxHp}`, bx + bw / 2, by + 13);

      // class name + gold + kills
      ctx.textAlign = "left";
      ctx.font = `bold 13px ${font}`;
      ctx.fillStyle = "#bdb3d6";
      ctx.fillText(pl.cfg.name, bx, by + bh + 16);
      ctx.drawImage(DD.sprites.coin, bx + 84, by + bh + 4, 14, 14);
      ctx.fillStyle = "#ffd14a";
      ctx.fillText(`${game.gold}`, bx + 102, by + bh + 16);
      ctx.fillStyle = "#9b90b8";
      ctx.fillText(`Kills ${game.kills}`, bx + 134, by + bh + 16);

      // --- enemies remaining (top right) ---
      const remaining = game.skeletons.filter((s) => !s.dead).length + game.spawnQueue.length;
      ctx.textAlign = "right";
      ctx.font = `bold 15px ${font}`;
      if (remaining > 0) {
        ctx.fillStyle = "rgba(10,8,18,0.7)";
        ctx.fillRect(DD.WIDTH - 168, 12, 152, 26);
        ctx.fillStyle = "#f2ecdd";
        ctx.fillText(`Skeletons: ${remaining}`, DD.WIDTH - 26, 31);
      } else if (game.state === "play") {
        ctx.fillStyle = "#ffd95e";
        ctx.fillText("Room cleared! Door is open.", DD.WIDTH - 26, 31);
      }
      ctx.textAlign = "left";

      // --- controls hint, fades out ---
      if (game.hintT > 0) {
        ctx.globalAlpha = DD.clamp(game.hintT, 0, 1);
        ctx.font = `12px ${font}`;
        ctx.fillStyle = "#bdb3d6";
        let hint = "WASD move • click / space attack • aim with mouse";
        if (pl.cfg.dash) hint += " • shift dash";
        ctx.fillText(hint, 16, DD.HEIGHT - 14);
        ctx.globalAlpha = 1;
      }

      // dash cooldown pip
      if (pl.cfg.dash) {
        ctx.fillStyle = pl.dashCd <= 0 ? "#7fd6ff" : "#3a4a5c";
        ctx.beginPath();
        ctx.arc(bx + bw + 18, by + 9, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
})(window.DD);
