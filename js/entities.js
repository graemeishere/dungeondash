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

  // Level-up choices. apply() mutates the player's per-run stats copy.
  DD.UPGRADES = [
    {
      id: "dmg", name: "Sharpened Edge", desc: "+30% damage",
      apply: (pl) => { pl.stats.dmg *= 1.3; },
    },
    {
      id: "speed", name: "Swift Boots", desc: "+15% move speed",
      apply: (pl) => { pl.stats.speed *= 1.15; },
    },
    {
      id: "hp", name: "Tough Hide", desc: "+3 max HP, heal 3",
      apply: (pl) => { pl.maxHp += 3; pl.hp = Math.min(pl.maxHp, pl.hp + 3); },
    },
    {
      id: "cd", name: "Quick Hands", desc: "Attack 20% faster",
      apply: (pl) => { pl.stats.cooldown = Math.max(0.08, pl.stats.cooldown * 0.8); },
    },
    {
      id: "reach", name: "Heavy Impact", desc: "Bigger attacks",
      apply: (pl) => {
        const s = pl.stats;
        if (s.attack === "melee") { s.range *= 1.25; s.arc *= 1.12; }
        else if (s.attack === "bolt") { s.splash *= 1.35; s.projSpeed *= 1.1; }
        else { s.pierce += 1; s.projSpeed *= 1.1; }
      },
    },
    {
      id: "siphon", name: "Soul Siphon", desc: "30% chance to heal 1 HP on kill",
      apply: (pl) => { pl.killHeal = (pl.killHeal || 0) + 0.3; },
    },
  ];

  const SPRITE_DRAW = 48; // on-screen size of a 16px character sprite

  function drawShadow(ctx, x, y, w) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(x, y + 5, w, w * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw a two-frame walking sprite anchored at the entity's feet.
  function drawSprite(ctx, frames, ent, moving) {
    const d = ent.drawSize || SPRITE_DRAW;
    const frame = moving ? frames[Math.floor(ent.animT * 8) % 2] : frames[0];
    ctx.save();
    ctx.translate(ent.x, ent.y);
    if (ent.flip) ctx.scale(-1, 1);
    ctx.drawImage(frame, -d / 2, -d + 10, d, d);
    ctx.restore();
  }

  // ---------------- Player ----------------

  class Player {
    constructor(classKey, x, y) {
      const c = DD.CLASSES[classKey];
      this.classKey = classKey;
      this.cfg = c;
      this.stats = { ...c }; // per-run copy that upgrades mutate
      this.x = x;
      this.y = y;
      this.r = 10;
      this.hp = c.hp;
      this.maxHp = c.hp;
      this.killHeal = 0;
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

    effDmg() {
      return Math.max(1, Math.round(this.stats.dmg));
    }

    onKill() {
      if (this.killHeal && Math.random() < this.killHeal && this.hp < this.maxHp) {
        this.hp += 1;
        DD.particles.text(this.x, this.y - 44, "+1 HP", "#ff8c91");
      }
    }

    update(dt, game) {
      const input = DD.input;
      this.attackCd -= dt;
      this.iframes -= dt;
      this.swingT -= dt;
      this.dashCd -= dt;

      this.aim = input.aimAngle(this);
      this.flip = Math.cos(this.aim) < 0;

      const { dx, dy } = input.moveVector();
      this.moving = dx !== 0 || dy !== 0;
      if (this.moving) this.animT += dt;

      if (this.stats.dash && (input.dashing() || input.consumeDashTap()) && this.dashCd <= 0 && this.dashT <= 0) {
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
        DD.room.moveEntity(this, dx * this.stats.speed * dt, dy * this.stats.speed * dt);
      }

      if (input.attacking() && this.attackCd <= 0) this.performAttack(game);
    }

    performAttack(game) {
      const c = this.stats;
      this.attackCd = c.cooldown;
      if (c.attack === "melee") {
        this.swingT = 0.14;
        this.swingAngle = this.aim;
        DD.audio.swing();
        let hitAny = false;
        for (const sk of game.enemies()) {
          if (sk.state === "spawn" || sk.dead) continue;
          const d = DD.dist(this.x, this.y, sk.x, sk.y);
          if (d > c.range + sk.r) continue;
          const da = Math.abs(DD.angleDiff(this.aim, DD.angleTo(this.x, this.y, sk.x, sk.y)));
          if (da > c.arc / 2 + 0.35) continue;
          sk.damage(this.effDmg(), this.x, this.y, game);
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
          dmg: this.effDmg(),
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
      const c = this.stats;
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

      for (const sk of game.enemies()) {
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
        for (const sk of game.enemies()) {
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

  // ---------------- Skeleton (and brute variant) ----------------

  class Skeleton {
    constructor(x, y, opts = {}) {
      this.x = x;
      this.y = y;
      this.big = !!opts.big;
      this.r = this.big ? 14 : 10;
      this.drawSize = this.big ? 68 : SPRITE_DRAW;
      this.hp = opts.hp ?? (this.big ? 16 : 6);
      this.maxHp = this.hp;
      this.speed = opts.speed ?? (this.big ? DD.rand(38, 48) : DD.rand(52, 78));
      this.dmg = opts.dmg ?? (this.big ? 2 : 1);
      this.xpValue = opts.xpValue ?? (this.big ? 12 : 5);
      this.coinDrop = opts.coinDrop ?? (this.big ? [2, 4] : [1, 3]);
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

      // knockback decays quickly (brutes barely budge)
      if (Math.abs(this.kbx) > 1 || Math.abs(this.kby) > 1) {
        const kbScale = this.big ? 0.4 : 1;
        DD.room.moveEntity(this, this.kbx * kbScale * dt, this.kby * kbScale * dt);
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
          for (const other of game.enemies()) {
            if (other === this || other.dead) continue;
            const od = DD.dist(this.x, this.y, other.x, other.y);
            if (od < this.r + other.r + 2 && od > 0.01) {
              mx += ((this.x - other.x) / od) * 40;
              my += ((this.y - other.y) / od) * 40;
            }
          }
          this.flip = mx < 0;
          DD.room.moveEntity(this, mx * dt, my * dt);
          if (d < this.r + 20 && !pl.dead) {
            this.state = "windup";
            this.stateT = this.big ? 0.5 : 0.38;
          }
          break;
        }

        case "windup":
          if (this.stateT <= 0) {
            if (!pl.dead && DD.dist(this.x, this.y, pl.x, pl.y) < this.r + 30) {
              pl.damage(this.dmg, this.x, this.y, game);
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
      DD.particles.text(this.x, this.y - this.drawSize + 4, `${n}`, "#ffd95e");
      DD.particles.burst(this.x, this.y - 14, { count: 6, colors: ["#e9e6da", "#b9b4a4"], speed: 90, life: 0.35 });
      if (this.hp <= 0) this.die(game);
    }

    die(game) {
      this.dead = true;
      game.kills++;
      game.addXP(this.xpValue);
      game.player.onKill();
      DD.audio.bones();
      DD.particles.burst(this.x, this.y - 14, {
        count: this.big ? 24 : 16, colors: ["#e9e6da", "#b9b4a4", "#fff"], speed: 140, life: 0.6, gravity: 260,
      });
      const coins = DD.randi(this.coinDrop[0], this.coinDrop[1]);
      for (let i = 0; i < coins; i++) {
        game.pickups.push(new Pickup("coin", this.x + DD.rand(-8, 8), this.y + DD.rand(-8, 8)));
      }
      if (Math.random() < 0.22) {
        game.pickups.push(new Pickup("heart", this.x, this.y));
      }
    }

    draw(ctx) {
      const d = this.drawSize;
      if (this.state === "spawn") {
        // rising out of the floor
        const t = DD.clamp(1 - this.stateT / 1.0, 0, 1);
        ctx.save();
        ctx.globalAlpha = t;
        drawShadow(ctx, this.x, this.y, this.r * t + 2);
        const h = Math.floor(d * t);
        if (h > 2) {
          const frame = DD.sprites.skeleton[0];
          ctx.drawImage(
            frame,
            0, 0, frame.width, frame.height * t,
            this.x - d / 2, this.y + 10 - h, d, h
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
        ctx.drawImage(DD.sprites.skeleton[0], -d / 2, -d + 10, d, d);
        ctx.restore();
      } else {
        drawSprite(ctx, DD.sprites.skeleton, this, this.state === "chase");
      }

      if (this.big && this.maxHp > this.hp) {
        // small HP bar over brutes
        ctx.fillStyle = "#1a1626";
        ctx.fillRect(this.x - 16, this.y - d + 2, 32, 4);
        ctx.fillStyle = "#e8484f";
        ctx.fillRect(this.x - 16, this.y - d + 2, 32 * (this.hp / this.maxHp), 4);
      }

      if (this.state === "windup") {
        ctx.fillStyle = "#ff5252";
        ctx.font = "bold 18px 'Trebuchet MS', Verdana, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("!", this.x, this.y - d + 4);
        ctx.textAlign = "left";
      }
    }
  }

  // ---------------- Boss: the Skeleton King ----------------

  class Boss extends Skeleton {
    constructor(x, y) {
      super(x, y, { big: true, hp: 70, speed: 55, dmg: 2, xpValue: 40, coinDrop: [12, 18] });
      this.r = 18;
      this.drawSize = 96;
      this.slamCd = 4.5;
      this.summonCd = 7;
      this.slamT = 0;     // active slam windup
      this.stateT = 1.4;  // longer rise
    }

    update(dt, game) {
      const pl = game.player;
      this.slamCd -= dt;
      this.summonCd -= dt;
      const enraged = this.hp < this.maxHp * 0.3;
      this.speed = enraged ? 85 : 55;

      // slam: telegraphed AoE around the king
      if (this.slamT > 0) {
        this.slamT -= dt;
        this.flash = 0; // don't mix flash with telegraph
        this.animT += dt;
        if (this.slamT <= 0) {
          DD.audio.slam();
          game.shake = Math.max(game.shake, 10);
          DD.particles.burst(this.x, this.y, { count: 30, colors: ["#e9e6da", "#8b80a8", "#fff"], speed: 220, life: 0.5 });
          if (!pl.dead && DD.dist(this.x, this.y, pl.x, pl.y) < 105) {
            pl.damage(2, this.x, this.y, game);
          }
          this.state = "recover";
          this.stateT = 0.7;
        }
        return;
      }

      if (this.state !== "spawn" && !pl.dead) {
        if (this.slamCd <= 0 && DD.dist(this.x, this.y, pl.x, pl.y) < 150) {
          this.slamT = 0.85;
          this.slamCd = enraged ? 3.2 : 5.0;
          return;
        }
        if (this.summonCd <= 0 && game.skeletons.filter((s) => !s.dead && !(s instanceof Boss)).length < 5) {
          this.summonCd = enraged ? 6 : 9;
          for (let i = 0; i < 2; i++) {
            const pos = DD.room.randomFloorPos(pl.x, pl.y, 120);
            game.skeletons.push(new Skeleton(pos.x, pos.y));
            DD.audio.spawn();
          }
        }
      }

      super.update(dt, game);
    }

    die(game) {
      super.die(game);
      game.bossDefeated = true;
      game.shake = 12;
      DD.particles.burst(this.x, this.y - 20, { count: 50, colors: ["#ffd14a", "#e9e6da", "#fff"], speed: 260, life: 1.0, gravity: 200 });
    }

    draw(ctx) {
      // slam telegraph circle
      if (this.slamT > 0) {
        ctx.strokeStyle = `rgba(255, 82, 82, ${0.4 + 0.5 * Math.sin(this.slamT * 30)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 105, 0, Math.PI * 2);
        ctx.stroke();
      }
      super.draw(ctx);
      if (this.state !== "spawn") {
        // crown
        const bob = Math.floor(this.animT * 8) % 2;
        ctx.drawImage(DD.sprites.crown, this.x - 14, this.y - this.drawSize + 6 + bob * 2, 28, 14);
      }
    }
  }

  // ---------------- Chest ----------------

  class Chest {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.r = 12;
      this.opened = false;
    }

    open(game) {
      if (this.opened) return;
      this.opened = true;
      DD.audio.chest();
      DD.particles.burst(this.x, this.y - 14, { count: 14, colors: ["#ffd14a", "#fff3b8"], speed: 120, life: 0.5, gravity: -40 });
      const coins = DD.randi(4, 7);
      for (let i = 0; i < coins; i++) {
        game.pickups.push(new Pickup("coin", this.x + DD.rand(-10, 10), this.y + DD.rand(-6, 10)));
      }
      if (Math.random() < 0.5) {
        game.pickups.push(new Pickup("heart", this.x, this.y + 6));
      }
      game.addXP(4);
    }

    draw(ctx) {
      drawShadow(ctx, this.x, this.y, 13);
      const img = this.opened ? DD.sprites.chestOpen : DD.sprites.chestClosed;
      ctx.drawImage(img, this.x - 16, this.y - 24, 32, 32);
      if (!this.opened) {
        // sparkle so it reads as interactive
        const t = performance.now() / 300;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t);
        ctx.fillStyle = "#fff3b8";
        ctx.fillRect(this.x + 8, this.y - 26, 3, 3);
        ctx.globalAlpha = 1;
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
  DD.Boss = Boss;
  DD.Chest = Chest;
  DD.Projectile = Projectile;
  DD.Pickup = Pickup;
})(window.DD);
