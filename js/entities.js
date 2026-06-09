"use strict";
(function (DD) {
  DD.CLASSES = {
    warrior: {
      name: "Warrior", color: "#aeb9cd",
      hp: 12, speed: 165, attack: "melee", range: 46, arc: 2.4, dmg: 3, cooldown: 0.5,
      desc: "Heavy armor and wide sword swings.",
      stats: "HP 12 • Big melee arc",
    },
    rogue: {
      name: "Rogue", color: "#3d7a4f",
      hp: 8, speed: 225, attack: "melee", range: 34, arc: 1.5, dmg: 2, cooldown: 0.22, dash: true,
      desc: "Lightning-fast stabs. Shift to dash.",
      stats: "HP 8 • Fastest • Dash",
    },
    mage: {
      name: "Mage", color: "#8657d8",
      hp: 6, speed: 160, attack: "bolt", dmg: 3, cooldown: 0.5, projSpeed: 380, splash: 38,
      desc: "Lobs magic bolts that explode on impact.",
      stats: "HP 6 • AoE damage",
    },
    ranger: {
      name: "Ranger", color: "#8a5e2e",
      hp: 8, speed: 185, attack: "arrow", dmg: 2, cooldown: 0.32, projSpeed: 540, pierce: 1,
      desc: "Rapid arrows that pierce through enemies.",
      stats: "HP 8 • Piercing shots",
    },
  };

  const SPRITE_DRAW = 48; // on-screen size of a 16px character sprite

  function drawShadow(ctx, x, y, w) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(x, y + 5, w, w * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw a two-frame walking sprite anchored at the entity's feet.
  function drawSprite(ctx, frames, ent, moving) {
    const frame = moving ? frames[Math.floor(ent.animT * 8) % 2] : frames[0];
    ctx.save();
    ctx.translate(ent.x, ent.y);
    if (ent.flip) ctx.scale(-1, 1);
    ctx.drawImage(frame, -SPRITE_DRAW / 2, -SPRITE_DRAW + 10, SPRITE_DRAW, SPRITE_DRAW);
    ctx.restore();
  }

  // ---------------- Player ----------------

  class Player {
    constructor(classKey, x, y) {
      const c = DD.CLASSES[classKey];
      this.classKey = classKey;
      this.cfg = c;
      this.x = x;
      this.y = y;
      this.r = 10;
      this.hp = c.hp;
      this.maxHp = c.hp;
      this.aim = 0;
      this.flip = false;
      this.animT = 0;
      this.moving = false;
      this.attackCd = 0;
      this.iframes = 0;
      this.swingT = 0;       // remaining time on the melee swipe visual
      this.swingAngle = 0;
      this.dashCd = 0;
      this.dashT = 0;
      this.dashDir = { x: 1, y: 0 };
      this.dead = false;
    }

    update(dt, game) {
      const input = DD.input;
      this.attackCd -= dt;
      this.iframes -= dt;
      this.swingT -= dt;
      this.dashCd -= dt;

      this.aim = DD.angleTo(this.x, this.y, input.mouse.x, input.mouse.y);
      this.flip = Math.cos(this.aim) < 0;

      const { dx, dy } = input.moveVector();
      this.moving = dx !== 0 || dy !== 0;
      if (this.moving) this.animT += dt;

      let speed = this.cfg.speed;
      if (this.cfg.dash && input.dashing() && this.dashCd <= 0 && this.dashT <= 0) {
        this.dashT = 0.16;
        this.dashCd = 1.6;
        this.iframes = Math.max(this.iframes, 0.3);
        this.dashDir = this.moving ? { x: dx, y: dy } : { x: Math.cos(this.aim), y: Math.sin(this.aim) };
        DD.audio.dash();
      }
      if (this.dashT > 0) {
        this.dashT -= dt;
        DD.room.moveEntity(this, this.dashDir.x * 620 * dt, this.dashDir.y * 620 * dt);
        DD.particles.burst(this.x, this.y, { count: 2, colors: ["#bfe8c8", "#ffffff"], speed: 20, life: 0.3, size: 4 });
      } else {
        DD.room.moveEntity(this, dx * speed * dt, dy * speed * dt);
      }

      if (input.attacking() && this.attackCd <= 0) this.performAttack(game);
    }

    performAttack(game) {
      const c = this.cfg;
      this.attackCd = c.cooldown;
      if (c.attack === "melee") {
        this.swingT = 0.14;
        this.swingAngle = this.aim;
        DD.audio.swing();
        let hitAny = false;
        for (const sk of game.skeletons) {
          if (sk.state === "spawn" || sk.dead) continue;
          const d = DD.dist(this.x, this.y, sk.x, sk.y);
          if (d > c.range + sk.r) continue;
          const da = Math.abs(DD.angleDiff(this.aim, DD.angleTo(this.x, this.y, sk.x, sk.y)));
          if (da > c.arc / 2 + 0.35) continue;
          sk.damage(c.dmg, this.x, this.y, game);
          hitAny = true;
        }
        if (hitAny) DD.audio.hit();
      } else {
        const speed = c.projSpeed;
        game.projectiles.push(new Projectile({
          x: this.x + Math.cos(this.aim) * 14,
          y: this.y - 12 + Math.sin(this.aim) * 14,
          vx: Math.cos(this.aim) * speed,
          vy: Math.sin(this.aim) * speed,
          dmg: c.dmg,
          kind: c.attack,
          pierce: c.pierce || 0,
          splash: c.splash || 0,
        }));
        if (c.attack === "bolt") DD.audio.bolt(); else DD.audio.shoot();
      }
    }

    damage(n, fromX, fromY, game) {
      if (this.iframes > 0 || this.dead) return;
      this.hp -= n;
      this.iframes = 0.9;
      DD.audio.hurt();
      game.shake = Math.max(game.shake, 6);
      DD.particles.burst(this.x, this.y - 14, { count: 10, colors: ["#e8484f", "#a32630"], speed: 110, life: 0.4 });
      DD.particles.text(this.x, this.y - 40, `-${n}`, "#ff6b70");
      const a = DD.angleTo(fromX, fromY, this.x, this.y);
      DD.room.moveEntity(this, Math.cos(a) * 14, Math.sin(a) * 14);
      if (this.hp <= 0) {
        this.hp = 0;
        this.dead = true;
        DD.particles.burst(this.x, this.y - 14, { count: 26, colors: ["#e8484f", "#f2c09a", "#ffffff"], speed: 160, life: 0.8, gravity: 220 });
      }
    }

    draw(ctx) {
      if (this.iframes > 0 && Math.floor(this.iframes * 12) % 2 === 0 && !this.dead) {
        drawShadow(ctx, this.x, this.y, this.r + 2);
        return; // blink while invulnerable
      }
      drawShadow(ctx, this.x, this.y, this.r + 2);
      drawSprite(ctx, DD.sprites.players[this.classKey], this, this.moving);
      if (this.swingT > 0) this.drawSwing(ctx);
    }

    drawSwing(ctx) {
      const t = 1 - this.swingT / 0.14; // 0 -> 1
      const c = this.cfg;
      ctx.save();
      ctx.translate(this.x, this.y - 12);
      ctx.rotate(this.swingAngle);
      ctx.globalAlpha = 0.85 * (1 - t * 0.6);
      ctx.fillStyle = "#fff8e0";
      ctx.beginPath();
      const a0 = -c.arc / 2 + c.arc * t - 0.5;
      const a1 = a0 + 0.9;
      ctx.arc(0, 0, c.range, a0, a1);
      ctx.arc(0, 0, c.range * 0.45, a1, a0, true);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  // ---------------- Projectile ----------------

  class Projectile {
    constructor(opts) {
      Object.assign(this, opts);
      this.dead = false;
      this.hitList = new Set();
    }

    update(dt, game) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      if (DD.room.pointHitsWall(this.x, this.y)) {
        this.explode(game);
        return;
      }

      if (this.kind === "bolt") {
        DD.particles.burst(this.x, this.y, { count: 1, colors: ["#b48cff", "#7a4fd0"], speed: 14, life: 0.25, size: 3 });
      }

      for (const sk of game.skeletons) {
        if (sk.dead || sk.state === "spawn" || this.hitList.has(sk)) continue;
        if (DD.dist(this.x, this.y, sk.x, sk.y - 12) < sk.r + 6) {
          sk.damage(this.dmg, this.x - this.vx, this.y - this.vy, game);
          DD.audio.hit();
          this.hitList.add(sk);
          if (this.splash) {
            this.explode(game);
          } else if (this.hitList.size > this.pierce) {
            this.dead = true;
          }
          return;
        }
      }
    }

    explode(game) {
      this.dead = true;
      if (this.splash) {
        DD.audio.splash();
        game.shake = Math.max(game.shake, 3);
        DD.particles.burst(this.x, this.y, { count: 18, colors: ["#b48cff", "#8657d8", "#fff"], speed: 150, life: 0.4 });
        for (const sk of game.skeletons) {
          if (sk.dead || sk.state === "spawn" || this.hitList.has(sk)) continue;
          if (DD.dist(this.x, this.y, sk.x, sk.y - 12) < this.splash + sk.r) {
            sk.damage(this.dmg, this.x, this.y, game);
          }
        }
      } else {
        DD.particles.burst(this.x, this.y, { count: 5, colors: ["#d9cfa8", "#8b80a8"], speed: 70, life: 0.3 });
      }
    }

    draw(ctx) {
      if (this.kind === "bolt") {
        ctx.fillStyle = "#b48cff";
        ctx.beginPath();
        ctx.arc(this.x, this.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#f1e6ff";
        ctx.beginPath();
        ctx.arc(this.x, this.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const a = Math.atan2(this.vy, this.vx);
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(a);
        ctx.strokeStyle = "#d9b87a";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.lineTo(7, 0);
        ctx.stroke();
        ctx.fillStyle = "#e9e6da";
        ctx.beginPath();
        ctx.moveTo(11, 0);
        ctx.lineTo(4, -4);
        ctx.lineTo(4, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // ---------------- Skeleton ----------------

  class Skeleton {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.r = 10;
      this.hp = 6;
      this.maxHp = 6;
      this.speed = DD.rand(52, 78);
      this.state = "spawn"; // spawn -> chase -> windup -> recover
      this.stateT = 1.0;
      this.animT = Math.random() * 10;
      this.flip = false;
      this.flash = 0;
      this.kbx = 0;
      this.kby = 0;
      this.dead = false;
      this.wanderA = DD.rand(0, Math.PI * 2);
    }

    update(dt, game) {
      this.stateT -= dt;
      this.flash -= dt;
      this.animT += dt;

      // knockback decays quickly
      if (Math.abs(this.kbx) > 1 || Math.abs(this.kby) > 1) {
        DD.room.moveEntity(this, this.kbx * dt, this.kby * dt);
        this.kbx *= Math.pow(0.0001, dt);
        this.kby *= Math.pow(0.0001, dt);
      }

      const pl = game.player;

      switch (this.state) {
        case "spawn":
          if (Math.random() < 0.3) {
            DD.particles.burst(this.x, this.y, { count: 1, colors: ["#6b6481", "#46415c"], speed: 40, life: 0.4, gravity: -60 });
          }
          if (this.stateT <= 0) this.state = "chase";
          break;

        case "chase": {
          if (pl.dead) break;
          const d = DD.dist(this.x, this.y, pl.x, pl.y);
          let a;
          if (d < 360) {
            a = DD.angleTo(this.x, this.y, pl.x, pl.y);
          } else {
            if (Math.random() < dt * 0.8) this.wanderA = DD.rand(0, Math.PI * 2);
            a = this.wanderA;
          }
          let mx = Math.cos(a) * this.speed;
          let my = Math.sin(a) * this.speed;
          // gently push away from other skeletons so they don't stack
          for (const other of game.skeletons) {
            if (other === this || other.dead) continue;
            const od = DD.dist(this.x, this.y, other.x, other.y);
            if (od < 22 && od > 0.01) {
              mx += ((this.x - other.x) / od) * 40;
              my += ((this.y - other.y) / od) * 40;
            }
          }
          this.flip = mx < 0;
          DD.room.moveEntity(this, mx * dt, my * dt);
          if (d < 30 && !pl.dead) {
            this.state = "windup";
            this.stateT = 0.38;
          }
          break;
        }

        case "windup":
          if (this.stateT <= 0) {
            if (!pl.dead && DD.dist(this.x, this.y, pl.x, pl.y) < 40) {
              pl.damage(1, this.x, this.y, game);
            }
            this.state = "recover";
            this.stateT = 0.9;
          }
          break;

        case "recover":
          if (this.stateT <= 0) this.state = "chase";
          break;
      }
    }

    damage(n, fromX, fromY, game) {
      if (this.dead || this.state === "spawn") return;
      this.hp -= n;
      this.flash = 0.12;
      const a = DD.angleTo(fromX, fromY, this.x, this.y);
      this.kbx = Math.cos(a) * 220;
      this.kby = Math.sin(a) * 220;
      DD.particles.text(this.x, this.y - 44, `${n}`, "#ffd95e");
      DD.particles.burst(this.x, this.y - 14, { count: 6, colors: ["#e9e6da", "#b9b4a4"], speed: 90, life: 0.35 });
      if (this.hp <= 0) this.die(game);
    }

    die(game) {
      this.dead = true;
      game.kills++;
      DD.audio.bones();
      DD.particles.burst(this.x, this.y - 14, {
        count: 16, colors: ["#e9e6da", "#b9b4a4", "#fff"], speed: 140, life: 0.6, gravity: 260,
      });
      const coins = DD.randi(1, 3);
      for (let i = 0; i < coins; i++) {
        game.pickups.push(new Pickup("coin", this.x + DD.rand(-8, 8), this.y + DD.rand(-8, 8)));
      }
      if (Math.random() < 0.22) {
        game.pickups.push(new Pickup("heart", this.x, this.y));
      }
    }

    draw(ctx) {
      if (this.state === "spawn") {
        // rising out of the floor
        const t = DD.clamp(1 - this.stateT / 1.0, 0, 1);
        ctx.save();
        ctx.globalAlpha = t;
        drawShadow(ctx, this.x, this.y, this.r * t + 2);
        const h = Math.floor(SPRITE_DRAW * t);
        if (h > 2) {
          const frame = DD.sprites.skeleton[0];
          ctx.drawImage(
            frame,
            0, 0, frame.width, frame.height * t,
            this.x - SPRITE_DRAW / 2, this.y + 10 - h, SPRITE_DRAW, h
          );
        }
        ctx.restore();
        return;
      }

      drawShadow(ctx, this.x, this.y, this.r + 2);

      if (this.flash > 0) {
        // white flash on hit
        ctx.save();
        ctx.translate(this.x, this.y);
        if (this.flip) ctx.scale(-1, 1);
        ctx.filter = "brightness(3)";
        ctx.drawImage(DD.sprites.skeleton[0], -SPRITE_DRAW / 2, -SPRITE_DRAW + 10, SPRITE_DRAW, SPRITE_DRAW);
        ctx.restore();
      } else {
        drawSprite(ctx, DD.sprites.skeleton, this, this.state === "chase");
      }

      if (this.state === "windup") {
        ctx.fillStyle = "#ff5252";
        ctx.font = "bold 18px 'Trebuchet MS', Verdana, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("!", this.x, this.y - 44);
        ctx.textAlign = "left";
      }
    }
  }

  // ---------------- Pickup ----------------

  class Pickup {
    constructor(kind, x, y) {
      this.kind = kind; // 'coin' | 'heart'
      this.x = x;
      this.y = y;
      const a = DD.rand(0, Math.PI * 2);
      this.vx = Math.cos(a) * DD.rand(30, 90);
      this.vy = Math.sin(a) * DD.rand(30, 90);
      this.t = 0;
      this.dead = false;
    }

    update(dt, game) {
      this.t += dt;
      // scatter then settle
      this.vx *= Math.pow(0.01, dt);
      this.vy *= Math.pow(0.01, dt);
      DD.room.moveEntity(Object.assign(this, { r: 5 }), this.vx * dt, this.vy * dt);

      const pl = game.player;
      if (pl.dead || this.t < 0.25) return;
      const d = DD.dist(this.x, this.y, pl.x, pl.y);
      if (d < 70) {
        // magnet toward the player
        const a = DD.angleTo(this.x, this.y, pl.x, pl.y);
        const pull = 340 * (1 - d / 70) + 60;
        this.x += Math.cos(a) * pull * dt;
        this.y += Math.sin(a) * pull * dt;
      }
      if (d < pl.r + 6) this.collect(game);
    }

    collect(game) {
      this.dead = true;
      if (this.kind === "coin") {
        game.gold++;
        DD.audio.coin();
        DD.particles.text(this.x, this.y - 16, "+1", "#ffd14a");
      } else {
        game.player.hp = Math.min(game.player.maxHp, game.player.hp + 2);
        DD.audio.heal();
        DD.particles.text(this.x, this.y - 16, "+2 HP", "#ff8c91");
        DD.particles.burst(this.x, this.y, { count: 8, colors: ["#ff8c91", "#e8484f"], speed: 60, life: 0.4, gravity: -80 });
      }
    }

    draw(ctx) {
      const bobY = Math.sin(this.t * 5) * 2;
      const img = this.kind === "coin" ? DD.sprites.coin : DD.sprites.heart;
      ctx.drawImage(img, this.x - 8, this.y - 10 + bobY, 16, 16);
    }
  }

  DD.Player = Player;
  DD.Skeleton = Skeleton;
  DD.Projectile = Projectile;
  DD.Pickup = Pickup;
})(window.DD);
