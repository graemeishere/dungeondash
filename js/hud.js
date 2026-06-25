"use strict";
(function (DD) {
  DD.hud = {
    draw(ctx, game) {
      const pl = game.localPlayer;
      if (!pl) return;
      const font = "'Trebuchet MS', Verdana, sans-serif";

      // --- HP bar ---
      const bx = 16, by = 14, bw = 190, bh = 18;
      ctx.fillStyle = "rgba(10,8,18,0.7)";
      ctx.fillRect(bx - 4, by - 4, bw + 8, bh + 40);
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

      // --- XP bar ---
      ctx.fillStyle = "#1a1626";
      ctx.fillRect(bx, by + bh + 4, bw, 7);
      ctx.fillStyle = "#a06ce8";
      ctx.fillRect(bx, by + bh + 4, bw * DD.clamp(game.xp / game.xpNext(), 0, 1), 7);

      // class + level + gold + kills
      ctx.textAlign = "left";
      ctx.font = `bold 13px ${font}`;
      ctx.fillStyle = "#bdb3d6";
      ctx.fillText(`${pl.cfg.name} Lv ${game.level}`, bx, by + bh + 26);
      ctx.drawImage(DD.sprites.coin, bx + 102, by + bh + 14, 14, 14);
      ctx.fillStyle = "#ffd14a";
      ctx.fillText(`${game.gold}`, bx + 120, by + bh + 26);
      ctx.fillStyle = "#9b90b8";
      ctx.fillText(`Kills ${game.kills}`, bx + 150, by + bh + 26);

      const narrow = DD.WIDTH < 720;
      const typeLabel = {
        combat: "Combat", treasure: "Treasure", boss: "BOSS",
        trap: "Trap Gauntlet", elite: "Elite", shop: "Shop",
      }[game.roomType];
      const floorName = game.floorCfg().name || `Floor ${game.floor + 1}`;
      const roomLabel = `${floorName} · Tier ${game.tier + 1} · Room ${game.roomIndex + 1}/${game.plan().length} — ${typeLabel}`;

      // --- room progress ---
      ctx.font = `bold 13px ${font}`;
      if (narrow) {
        // stack under the HP block so nothing overlaps on phones
        ctx.fillStyle = "#bdb3d6";
        ctx.fillText(roomLabel, bx, by + bh + 44);
      } else {
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(10,8,18,0.7)";
        ctx.fillRect(DD.WIDTH / 2 - 95, 44, 190, 22);
        ctx.fillStyle = "#bdb3d6";
        ctx.fillText(roomLabel, DD.WIDTH / 2, 59);
      }

      // --- teammate HP (co-op) ---
      game.players.forEach((mate, i) => {
        if (mate === pl) return;
        const my = by + bh + (narrow ? 56 : 36) + i * 18;
        ctx.font = `bold 11px ${font}`;
        ctx.fillStyle = "#9b90b8";
        ctx.fillText(`P${i + 1} ${mate.cfg.name}`, bx, my + 9);
        ctx.fillStyle = "#1a1626";
        ctx.fillRect(bx + 78, my, 80, 9);
        ctx.fillStyle = mate.downed ? "#ff6b70" : "#6fce6f";
        ctx.fillRect(bx + 78, my, 80 * DD.clamp(mate.hp / mate.maxHp, 0, 1), 9);
        if (mate.downed) {
          ctx.fillStyle = "#ff6b70";
          ctx.fillText("DOWN!", bx + 164, my + 9);
        }
      });

      // --- objective (top right) ---
      ctx.textAlign = "right";
      ctx.font = `bold 15px ${font}`;
      const boss = game.skeletons.find((s) => s instanceof DD.Boss);
      if (boss) {
        // boss HP bar, top center (under the player HUD on phones)
        const bbw = Math.min(320, DD.WIDTH - 48);
        const bbx = DD.WIDTH / 2 - bbw / 2;
        const bby = narrow ? 70 : 16;
        ctx.fillStyle = "rgba(10,8,18,0.7)";
        ctx.fillRect(bbx - 4, bby - 4, bbw + 8, 22);
        ctx.fillStyle = "#1a1626";
        ctx.fillRect(bbx, bby, bbw, 14);
        ctx.fillStyle = "#e8484f";
        ctx.fillRect(bbx, bby, bbw * DD.clamp(boss.hp / boss.maxHp, 0, 1), 14);
        ctx.textAlign = "center";
        ctx.font = `bold 11px ${font}`;
        ctx.fillStyle = "#f2ecdd";
        ctx.fillText(boss.label || "BOSS", DD.WIDTH / 2, bby + 11);
      } else {
        const remaining = game.skeletons.filter((s) => !s.dead && !s.dying).length + game.spawnQueue.length;
        const chestsLeft = game.chests.filter((c) => !c.opened).length;
        const boxW = narrow ? 130 : 234;
        ctx.fillStyle = "rgba(10,8,18,0.7)";
        ctx.fillRect(DD.WIDTH - boxW - 16, 12, boxW, 26);
        if (game.roomType === "treasure" && chestsLeft > 0) {
          ctx.fillStyle = "#ffd14a";
          ctx.fillText(narrow ? `Chests: ${chestsLeft}` : `Open the chests! ${chestsLeft} left`, DD.WIDTH - 26, 31);
        } else if (remaining > 0) {
          ctx.fillStyle = "#f2ecdd";
          const eLabel = game.floorCfg().enemyLabel || "Enemies";
          ctx.fillText(narrow ? `Foes: ${remaining}` : `${eLabel}: ${remaining}`, DD.WIDTH - 26, 31);
        } else if (game.roomType === "shop") {
          ctx.fillStyle = "#ffd95e";
          ctx.fillText(narrow ? "Shop · Exit ▲" : "Spend your gold, then exit ▲", DD.WIDTH - 26, 31);
        } else if (game.roomType === "trap") {
          ctx.fillStyle = "#ff9234";
          ctx.fillText(narrow ? "Spikes! ▲" : "Mind the spikes! Exit ▲", DD.WIDTH - 26, 31);
        } else if (game.roomCleared && game.state === "play") {
          ctx.fillStyle = "#ffd95e";
          ctx.fillText(narrow ? "Exit ▲" : "Cleared! Exit through the door ▲", DD.WIDTH - 26, 31);
        }
      }
      ctx.textAlign = "left";

      // --- controls hint, fades out ---
      if (game.hintT > 0) {
        ctx.globalAlpha = DD.clamp(game.hintT, 0, 1);
        ctx.font = `12px ${font}`;
        ctx.fillStyle = "#bdb3d6";
        let hint = DD.input.touchSeen
          ? "left thumb: move • right thumb: aim & attack"
          : "WASD move • click / space attack • aim with mouse";
        if (pl.cfg.dash && !DD.input.touchSeen) hint += " • shift dash";
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

      // --- touch controls ---
      if (DD.input.touchSeen) {
        const R = DD.input.STICK_RADIUS;
        for (const stick of [DD.input.touch.move, DD.input.touch.aim]) {
          if (!stick.active) continue;
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = "#f2ecdd";
          ctx.beginPath();
          ctx.arc(stick.ox, stick.oy, R, 0, Math.PI * 2);
          ctx.fill();
          // knob clamped to the stick radius
          let kx = stick.x - stick.ox, ky = stick.y - stick.oy;
          const len = Math.hypot(kx, ky);
          if (len > R) { kx = (kx / len) * R; ky = (ky / len) * R; }
          ctx.globalAlpha = 0.45;
          ctx.beginPath();
          ctx.arc(stick.ox + kx, stick.oy + ky, 20, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        if (pl.cfg.dash) {
          const btn = DD.input.dashBtn();
          ctx.globalAlpha = pl.dashCd <= 0 ? 0.55 : 0.25;
          ctx.fillStyle = "#7fd6ff";
          ctx.beginPath();
          ctx.arc(btn.x, btn.y, btn.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = "#0e1b24";
          ctx.font = `bold 12px ${font}`;
          ctx.textAlign = "center";
          ctx.fillText("DASH", btn.x, btn.y + 4);
          ctx.textAlign = "left";
          ctx.globalAlpha = 1;
        }

        // Inventory button — always shown on touch screens
        const ibtn = DD.input.invBtn();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "#b48cff";
        ctx.beginPath();
        ctx.arc(ibtn.x, ibtn.y, ibtn.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = "#0e1b24";
        ctx.font = `bold 11px ${font}`;
        ctx.textAlign = "center";
        ctx.fillText("BAG", ibtn.x, ibtn.y + 4);
        ctx.textAlign = "left";
        ctx.globalAlpha = 1;
      }
    },
  };
})(window.DD);
