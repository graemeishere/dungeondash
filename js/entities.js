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

  // Level-up choices. apply() records into runBuffs and calls recompute() so
  // temporary run power never leaks onto the persistent hero profile.
  DD.UPGRADES = [
    {
      id: "dmg", name: "Sharpened Edge", desc: "+30% damage",
      apply: (pl) => { pl.runBuffs.dmg *= 1.3; pl.recompute(); },
    },
    {
      id: "speed", name: "Swift Boots", desc: "+15% move speed",
      apply: (pl) => { pl.runBuffs.speed *= 1.15; pl.recompute(); },
    },
    {
      id: "hp", name: "Tough Hide", desc: "+3 max HP, heal 3",
      apply: (pl) => { pl.runBuffs.maxHp += 3; pl.recompute(); pl.hp = Math.min(pl.maxHp, pl.hp + 3); },
    },
    {
      id: "cd", name: "Quick Hands", desc: "Attack 20% faster",
      apply: (pl) => { pl.runBuffs.cd *= 0.8; pl.recompute(); },
    },
    {
      id: "reach", name: "Heavy Impact", desc: "Bigger attacks",
      apply: (pl) => {
        const b = pl.baseStats;
        if (b.attack === "melee") { pl.runBuffs.range *= 1.25; pl.runBuffs.arc *= 1.12; }
        else if (b.attack === "bolt") { pl.runBuffs.splash *= 1.35; pl.runBuffs.projSpeed *= 1.1; }
        else { pl.runBuffs.pierce += 1; pl.runBuffs.projSpeed *= 1.1; }
        pl.recompute();
      },
    },
    {
      id: "siphon", name: "Soul Siphon", desc: "30% chance to heal 1 HP on kill",
      apply: (pl) => { pl.runBuffs.killHeal += 0.3; pl.recompute(); },
    },
  ];

  const SPRITE_DRAW = 48; // on-screen size of a 16px character sprite
  const DOWNED_TIME = 18;
  const REVIVE_TIME = 1.6;

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
    constructor(classKey, x, y, inputProvider, hero) {
      const c = DD.CLASSES[classKey];
      this.classKey = classKey;
      this.cfg = c;
      this.baseStats = hero ? DD.deriveStats(hero) : { ...c };
      this.runBuffs = { dmg: 1, speed: 1, cd: 1, range: 1, arc: 1, splash: 1, projSpeed: 1, pierce: 0, maxHp: 0, killHeal: 0 };
      this.recompute();
      this.input = inputProvider || DD.input;
      this.x = x;
      this.y = y;
      this.r = 10;
      this.hp = this.maxHp;
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
      this.downed = false;   // co-op: waiting for a revive
      this.downT = 0;
      this.reviveP = 0;
    }

    recompute() {
      const b = this.baseStats;
      const r = this.runBuffs;
      this.stats = { ...b };
      this.stats.dmg      = b.dmg   * r.dmg;
      this.stats.speed    = b.speed * r.speed;
      this.stats.cooldown = Math.max(0.08, b.cooldown * r.cd);
      if (b.range     !== undefined) this.stats.range     = b.range     * r.range;
      if (b.arc       !== undefined) this.stats.arc       = b.arc       * r.arc;
      if (b.projSpeed !== undefined) this.stats.projSpeed = b.projSpeed * r.projSpeed;
      if (b.splash    !== undefined) this.stats.splash    = b.splash    * r.splash;
      if (b.pierce    !== undefined) this.stats.pierce    = b.pierce    + r.pierce;
      this.maxHp    = Math.floor(b.hp) + r.maxHp;
      this.killHeal = (b.killHeal || 0) + r.killHeal;
    }

    alive() { return !this.dead && !this.downed; }

    effDmg() {
      return Math.max(1, Math.round(this.stats.dmg));
    }

    onKill() {
      if (this.killHeal && Math.random() < this.killHeal && this.hp < this.maxHp) {
        this.hp += 1;
        DD.particles.text(this.x, this.y - 44, "+1 HP", "#ff8c91");
      }
    }

    goDown(game) {
      this.downed = true;
      this.downT = DOWNED_TIME;
      this.reviveP = 0;
      this.hp = 0;
    }

    revive(partial) {
      this.downed = false;
      this.dead = false;
      this.hp = Math.max(1, Math.ceil(this.maxHp * partial));
      this.iframes = 1.5;
      DD.audio.heal();
      DD.particles.burst(this.x, this.y - 14, { count: 14, colors: ["#6fce6f", "#fff"], speed: 90, life: 0.5, gravity: -60 });
    }

    update(dt, game) {
      if (this.dead) return;

      if (this.downed) {
        this.downT -= dt;
        // a teammate standing close revives; stepping away decays progress
        const helper = game.players.find((p) => p !== this && p.alive() &&
          DD.dist(p.x, p.y, this.x, this.y) < 40);
        if (helper) {
          this.reviveP += dt / REVIVE_TIME;
          if (this.reviveP >= 1) this.revive(0.5);
        } else {
          this.reviveP = Math.max(0, this.reviveP - dt);
        }
        if (this.downed && this.downT <= 0) {
          // failed revive: sit out until the room is cleared
          this.dead = true;
          DD.particles.burst(this.x, this.y - 14, { count: 20, colors: ["#8b80a8", "#f2c09a"], speed: 120, life: 0.7, gravity: 200 });
        }
        return;
      }

      const input = this.input;
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
          sk.damage(this.effDmg(), this.x, this.y, game, this);
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
          owner: this,
        }));
        if (c.attack === "bolt") DD.audio.bolt(); else DD.audio.shoot();
      }
    }

    damage(n, fromX, fromY, game) {
      if (this.iframes > 0 || this.dead || this.downed) return;
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
        const teammateUp = game.players.some((p) => p !== this && p.alive());
        if (teammateUp) {
          this.goDown(game);
        } else {
          this.dead = true;
          DD.particles.burst(this.x, this.y - 14, { count: 26, colors: ["#e8484f", "#f2c09a", "#ffffff"], speed: 160, life: 0.8, gravity: 220 });
        }
      }
    }

    draw(ctx) {
      if (this.dead) return;

      if (this.downed) {
        // lying down, with a fading timer ring and revive progress
        drawShadow(ctx, this.x, this.y, this.r + 4);
        ctx.save();
        ctx.translate(this.x, this.y - 8);
        ctx.rotate(this.flip ? Math.PI / 2 : -Math.PI / 2);
        ctx.globalAlpha = 0.8;
        ctx.drawImage(DD.sprites.players[this.classKey][0], -SPRITE_DRAW / 2, -SPRITE_DRAW + 14, SPRITE_DRAW, SPRITE_DRAW);
        ctx.restore();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#ff6b70";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y - 16, 16, -Math.PI / 2, -Math.PI / 2 + (this.downT / DOWNED_TIME) * Math.PI * 2);
        ctx.stroke();
        if (this.reviveP > 0) {
          ctx.fillStyle = "#1a1626";
          ctx.fillRect(this.x - 16, this.y - 44, 32, 5);
          ctx.fillStyle = "#6fce6f";
          ctx.fillRect(this.x - 16, this.y - 44, 32 * this.reviveP, 5);
        }
        return;
      }

      if (this.iframes > 0 && Math.floor(this.iframes * 12) % 2 === 0) {
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

  // ---------------- Player projectile ----------------

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
          sk.damage(this.dmg, this.x - this.vx, this.y - this.vy, game, this.owner);
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
            sk.damage(this.dmg, this.x, this.y, game, this.owner);
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

  // ---------------- Enemy bone shot ----------------

  class EnemyShot {
    constructor(x, y, angle, speed = 240, dmg = 1) {
      this.x = x;
      this.y = y;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.dmg = dmg;
      this.t = 0;
      this.dead = false;
    }

    update(dt, game) {
      this.t += dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (DD.room.pointHitsWall(this.x, this.y)) { this.dead = true; return; }
      for (const pl of game.players) {
        if (!pl.alive()) continue;
        if (DD.dist(this.x, this.y, pl.x, pl.y - 8) < pl.r + 5) {
          pl.damage(this.dmg, this.x - this.vx, this.y - this.vy, game);
          this.dead = true;
          return;
        }
      }
    }

    draw(ctx) {
      // spinning bone
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.t * 12);
      ctx.strokeStyle = "#e9e6da";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(6, 0);
      ctx.stroke();
      ctx.fillStyle = "#e9e6da";
      for (const ex of [-6, 6]) {
        ctx.beginPath();
        ctx.arc(ex, -2, 2, 0, Math.PI * 2);
        ctx.arc(ex, 2, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ---------------- Skeleton (melee / archer / bomber, brute, elite) ----------------

  class Skeleton {
    constructor(x, y, opts = {}) {
      this.x = x;
      this.y = y;
      this.kind = opts.kind || "melee"; // melee | archer | bomber | shade
      this.faction = opts.faction || "skeleton";
      this.big = !!opts.big;
      this.elite = !!opts.elite;
      this.name = opts.name || null;
      const scale = opts.scale || 1;
      this.r = this.big ? 14 : 10;
      this.drawSize = this.big ? 68 : SPRITE_DRAW;

      const baseHp = opts.hp ?? (
        this.big ? 16 :
        this.kind === "bomber" ? 4 :
        this.kind === "archer" ? 5 :
        this.kind === "shade"  ? 3 : 6);
      this.hp = Math.round(baseHp * scale);
      this.maxHp = this.hp;
      const baseSpeed = opts.speed ?? (
        this.big ? DD.rand(38, 48) :
        this.kind === "bomber" ? DD.rand(100, 118) :
        this.kind === "archer" ? DD.rand(48, 60) :
        this.kind === "shade"  ? DD.rand(85, 105) :
        DD.rand(52, 78));
      this.speed = baseSpeed * (1 + 0.06 * (scale - 1));
      this.dmg = opts.dmg ?? (this.big ? 2 : 1) + (scale >= 1.9 ? 1 : 0);
      this.xpValue = opts.xpValue ?? (
        this.elite ? 25 : this.big ? 12 :
        this.kind === "shade" ? 4 :
        this.kind === "melee" ? 5 : 7);
      this.coinDrop = opts.coinDrop ?? (
        this.elite ? [6, 10] : this.big ? [2, 4] :
        this.kind === "shade" ? [0, 2] : [1, 3]);

      this.state = "spawn"; // spawn -> chase -> windup/fuse -> recover
      this.stateT = 1.0;
      this.shootCd = DD.rand(1.0, 2.2);
      this.animT = Math.random() * 10;
      this.flip = false;
      this.flash = 0;
      this.kbx = 0;
      this.kby = 0;
      this.dead = false;
      this.wanderA = DD.rand(0, Math.PI * 2);
    }

    frames() {
      if (this.kind === "archer") return DD.sprites.skeletonArcher;
      if (this.kind === "bomber") return DD.sprites.skeletonBomber;
      if (this.kind === "shade")  return DD.sprites.skeletonShade;
      return DD.sprites.skeleton;
    }

    update(dt, game) {
      this.stateT -= dt;
      this.flash -= dt;
      this.animT += dt;
      this.shootCd -= dt;

      // knockback decays quickly (brutes barely budge)
      if (Math.abs(this.kbx) > 1 || Math.abs(this.kby) > 1) {
        const kbScale = this.big ? 0.4 : 1;
        DD.room.moveEntity(this, this.kbx * kbScale * dt, this.kby * kbScale * dt);
        this.kbx *= Math.pow(0.0001, dt);
        this.kby *= Math.pow(0.0001, dt);
      }

      const pl = game.nearestAlivePlayer(this.x, this.y);

      switch (this.state) {
        case "spawn":
          if (Math.random() < 0.3) {
            DD.particles.burst(this.x, this.y, { count: 1, colors: ["#6b6481", "#46415c"], speed: 40, life: 0.4, gravity: -60 });
          }
          if (this.stateT <= 0) this.state = "chase";
          break;

        case "chase": {
          if (!pl) break;
          const d = DD.dist(this.x, this.y, pl.x, pl.y);
          let a;
          if (d < 380) {
            a = DD.angleTo(this.x, this.y, pl.x, pl.y);
            if (this.kind === "archer") {
              // hold a comfortable range
              if (d < 150) a += Math.PI;          // back away
              else if (d < 240) a += Math.PI / 2; // strafe
              if (this.shootCd <= 0 && d < 340) {
                this.shootCd = DD.rand(1.9, 2.6);
                game.enemyShots.push(new EnemyShot(this.x, this.y - 14, DD.angleTo(this.x, this.y, pl.x, pl.y - 8)));
                DD.audio.shoot();
              }
            }
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
          // shades phase through walls; others use room collision
          if (this.kind === "shade") {
            this.x = DD.clamp(this.x + mx * dt, DD.TILE, DD.WIDTH - DD.TILE);
            this.y = DD.clamp(this.y + my * dt, DD.TILE, DD.HEIGHT - DD.TILE);
          } else {
            DD.room.moveEntity(this, mx * dt, my * dt);
          }

          if (this.kind === "bomber") {
            if (d < 60) { this.state = "fuse"; this.stateT = 0.8; }
          } else if ((this.kind === "melee" || this.kind === "shade") && d < this.r + 20) {
            this.state = "windup";
            this.stateT = this.big ? 0.5 : 0.38;
          }
          break;
        }

        case "windup":
          if (this.stateT <= 0) {
            if (pl && DD.dist(this.x, this.y, pl.x, pl.y) < this.r + 30) {
              pl.damage(this.dmg, this.x, this.y, game);
            }
            this.state = "recover";
            this.stateT = 0.9;
          }
          break;

        case "fuse":
          if (this.stateT <= 0) this.explodeNow(game);
          break;

        case "recover":
          if (this.stateT <= 0) this.state = "chase";
          break;
      }
    }

    explodeNow(game) {
      DD.audio.slam();
      game.shake = Math.max(game.shake, 7);
      DD.particles.burst(this.x, this.y - 10, { count: 26, colors: ["#ff9234", "#ffd14a", "#e9e6da"], speed: 200, life: 0.5 });
      for (const p of game.players) {
        if (p.alive() && DD.dist(this.x, this.y, p.x, p.y) < 75) p.damage(2, this.x, this.y, game);
      }
      for (const sk of game.enemies()) {
        if (sk !== this && !sk.dead && sk.state !== "spawn" && DD.dist(this.x, this.y, sk.x, sk.y) < 75) {
          sk.damage(3, this.x, this.y, game, null);
        }
      }
      this.die(game, null);
    }

    damage(n, fromX, fromY, game, attacker) {
      if (this.dead || this.state === "spawn") return;
      this.hp -= n;
      this.flash = 0.12;
      const a = DD.angleTo(fromX, fromY, this.x, this.y);
      this.kbx = Math.cos(a) * 220;
      this.kby = Math.sin(a) * 220;
      DD.particles.text(this.x, this.y - this.drawSize + 4, `${n}`, "#ffd95e");
      DD.particles.burst(this.x, this.y - 14, { count: 6, colors: ["#e9e6da", "#b9b4a4"], speed: 90, life: 0.35 });
      if (this.hp <= 0) this.die(game, attacker);
    }

    die(game, attacker) {
      if (this.dead) return;
      this.dead = true;
      game.kills++;
      game.addXP(this.xpValue);
      if (attacker) attacker.onKill();
      DD.audio.bones();
      const deathColors = this.kind === "shade"
        ? ["#6688ff", "#99aaff", "#3344cc"]
        : ["#e9e6da", "#b9b4a4", "#fff"];
      DD.particles.burst(this.x, this.y - 14, {
        count: this.big ? 24 : 16, colors: deathColors, speed: 140, life: 0.6, gravity: 260,
      });
      const coins = DD.randi(this.coinDrop[0], this.coinDrop[1]);
      for (let i = 0; i < coins; i++) {
        game.pickups.push(new Pickup("coin", this.x + DD.rand(-8, 8), this.y + DD.rand(-8, 8)));
      }
      if (this.elite || Math.random() < 0.18) {
        game.pickups.push(new Pickup("heart", this.x, this.y));
      }
      // Item drops: elite = guaranteed rare+, brute = 25%, regular = 10%
      if (game.hero && DD.rollItem) {
        const chance = this.elite ? 1.0 : this.big ? 0.25 : 0.10;
        if (Math.random() < chance) {
          const minRarity = this.elite ? "rare" : undefined;
          game.pickups.push(new Pickup("item", this.x, this.y - 8,
            DD.rollItem({ floor: game.floor, minRarity, faction: this.faction })));
        }
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
          const frame = this.frames()[0];
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

      // shade is semi-transparent
      if (this.kind === "shade") ctx.globalAlpha = 0.72;

      const fuseFlash = this.state === "fuse" && Math.floor(this.stateT * 14) % 2 === 0;

      if (this.flash > 0 || fuseFlash) {
        ctx.save();
        ctx.translate(this.x, this.y);
        if (this.flip) ctx.scale(-1, 1);
        ctx.filter = fuseFlash
          ? "brightness(2) sepia(1) hue-rotate(-50deg) saturate(4)"
          : "brightness(3)";
        ctx.drawImage(this.frames()[0], -d / 2, -d + 10, d, d);
        ctx.restore();
        ctx.filter = "none";
      } else {
        drawSprite(ctx, this.frames(), this, this.state === "chase");
      }

      if (this.kind === "shade") ctx.globalAlpha = 1;

      if ((this.big || this.elite) && this.maxHp > this.hp) {
        // small HP bar over brutes and elites
        ctx.fillStyle = "#1a1626";
        ctx.fillRect(this.x - 16, this.y - d + 2, 32, 4);
        ctx.fillStyle = "#e8484f";
        ctx.fillRect(this.x - 16, this.y - d + 2, 32 * (this.hp / this.maxHp), 4);
      }

      if (this.name) {
        ctx.font = "bold 11px 'Trebuchet MS', Verdana, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffd95e";
        ctx.fillText(this.name, this.x, this.y - d - 2);
        ctx.textAlign = "left";
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

  // ---------------- Boss ----------------

  class Boss extends Skeleton {
    constructor(x, y, opts = {}) {
      super(x, y, {
        big: true,
        hp: opts.hp ?? 70,
        speed: 55,
        dmg: opts.dmg ?? 2,
        xpValue: 40,
        coinDrop: [12, 18],
      });
      this.bossName = opts.name || "SKELETON KING";
      this.label = this.bossName;
      this.summonKind = opts.summonKind || "melee";
      this.r = 18;
      this.drawSize = 96;
      this.slamCd = 4.5;
      this.summonCd = 7;
      this.slamT = 0;     // active slam windup
      this.stateT = 1.4;  // longer rise
    }

    update(dt, game) {
      const pl = game.nearestAlivePlayer(this.x, this.y);
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
          for (const p of game.players) {
            if (p.alive() && DD.dist(this.x, this.y, p.x, p.y) < 105) {
              p.damage(2, this.x, this.y, game);
            }
          }
          this.state = "recover";
          this.stateT = 0.7;
        }
        return;
      }

      if (this.state !== "spawn" && pl) {
        if (this.slamCd <= 0 && DD.dist(this.x, this.y, pl.x, pl.y) < 150) {
          this.slamT = 0.85;
          this.slamCd = enraged ? 3.2 : 5.0;
          return;
        }
        if (this.summonCd <= 0 && game.skeletons.filter((s) => !s.dead && !(s instanceof Boss)).length < 5) {
          this.summonCd = enraged ? 6 : 9;
          for (let i = 0; i < 2; i++) {
            const pos = DD.room.randomFloorPos(pl.x, pl.y, 120);
            game.skeletons.push(new Skeleton(pos.x, pos.y, {
              kind: i === 0 ? this.summonKind : "melee",
              faction: this.faction || "skeleton",
            }));
            DD.audio.spawn();
          }
        }
      }

      super.update(dt, game);
    }

    die(game, attacker) {
      super.die(game, attacker);
      game.bossDefeated = true;
      game.shake = 12;
      DD.particles.burst(this.x, this.y - 20, { count: 50, colors: ["#ffd14a", "#e9e6da", "#fff"], speed: 260, life: 1.0, gravity: 200 });
      if (game.hero && DD.rollItem) {
        game.pickups.push(new Pickup("item", this.x + DD.rand(-24, 24), this.y, DD.rollItem({ floor: game.floor, minRarity: "rare" })));
      }
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
      if (game.hero && DD.rollItem) {
        game.pickups.push(new Pickup("item", this.x, this.y + 6, DD.rollItem({ floor: game.floor })));
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
    constructor(kind, x, y, item) {
      this.kind = kind; // 'coin' | 'heart' | 'item'
      this.item = item || null;
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

      const pl = game.nearestAlivePlayer(this.x, this.y);
      if (!pl || this.t < 0.25) return;
      const d = DD.dist(this.x, this.y, pl.x, pl.y);
      if (d < 70) {
        // magnet toward the player
        const a = DD.angleTo(this.x, this.y, pl.x, pl.y);
        const pull = 340 * (1 - d / 70) + 60;
        this.x += Math.cos(a) * pull * dt;
        this.y += Math.sin(a) * pull * dt;
      }
      if (d < pl.r + 6) this.collect(game, pl);
    }

    collect(game, pl) {
      this.dead = true;
      if (this.kind === "coin") {
        game.gold++;
        DD.audio.coin();
        DD.particles.text(this.x, this.y - 16, "+1", "#ffd14a");
      } else if (this.kind === "heart") {
        pl.hp = Math.min(pl.maxHp, pl.hp + 2);
        DD.audio.heal();
        DD.particles.text(this.x, this.y - 16, "+2 HP", "#ff8c91");
        DD.particles.burst(this.x, this.y, { count: 8, colors: ["#ff8c91", "#e8484f"], speed: 60, life: 0.4, gravity: -80 });
      } else if (this.kind === "item" && this.item && game.hero) {
        if (game.hero.inventory.length >= (DD.INV_CAP || 15)) {
          DD.particles.text(this.x, this.y - 16, "Bag full!", "#e8484f");
          return;
        }
        game.hero.inventory.push(this.item);
        DD.profile.save();
        const rColor = DD.ITEM_RARITY[this.item.rarity].color;
        DD.audio.chest();
        DD.particles.text(this.x, this.y - 16, this.item.name, rColor);
        DD.particles.burst(this.x, this.y, { count: 8, colors: [rColor, "#fff"], speed: 70, life: 0.4, gravity: -60 });
      }
    }

    draw(ctx) {
      const bobY = Math.sin(this.t * 5) * 2;
      if (this.kind === "item" && this.item && DD.sprites.items) {
        const rColor = (DD.ITEM_RARITY[this.item.rarity] || {}).color || "#8b80a8";
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.t * 4);
        ctx.fillStyle = rColor;
        ctx.beginPath();
        ctx.arc(this.x, this.y - 2 + bobY, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        const icon = DD.sprites.items[this.item.icon];
        if (icon) ctx.drawImage(icon, this.x - 8, this.y - 10 + bobY, 16, 16);
      } else {
        const img = this.kind === "coin" ? DD.sprites.coin : DD.sprites.heart;
        ctx.drawImage(img, this.x - 8, this.y - 10 + bobY, 16, 16);
      }
    }
  }

  // ---------------- Shop item ----------------

  class ShopItem {
    constructor(kind, x, y, price, label, upgrade) {
      this.kind = kind; // 'heal' | 'maxhp' | 'upgrade'
      this.x = x;
      this.y = y;
      this.r = 14;
      this.price = price;
      this.label = label;
      this.upgrade = upgrade || null;
      this.sold = false;
    }

    tryBuy(game, pl) {
      if (this.sold || game.gold < this.price) return false;
      game.gold -= this.price;
      this.sold = true;
      DD.audio.chest();
      DD.particles.burst(this.x, this.y - 14, { count: 12, colors: ["#ffd14a", "#fff"], speed: 100, life: 0.5, gravity: -50 });
      if (this.kind === "heal") {
        pl.hp = pl.maxHp;
        DD.particles.text(this.x, this.y - 30, "Healed!", "#6fce6f");
      } else if (this.kind === "maxhp") {
        pl.runBuffs.maxHp += 3;
        pl.recompute();
        pl.hp = Math.min(pl.maxHp, pl.hp + 3);
        DD.particles.text(this.x, this.y - 30, "+3 Max HP", "#ff8c91");
      } else if (this.kind === "upgrade" && this.upgrade) {
        this.upgrade.apply(pl);
        DD.particles.text(this.x, this.y - 30, this.upgrade.name + "!", "#ffd95e");
      }
      return true;
    }

    draw(ctx) {
      const font = "'Trebuchet MS', Verdana, sans-serif";
      // pedestal
      ctx.fillStyle = "#2e2a40";
      ctx.fillRect(this.x - 16, this.y - 8, 32, 14);
      ctx.fillStyle = "#3e3857";
      ctx.fillRect(this.x - 16, this.y - 8, 32, 4);
      if (this.sold) {
        ctx.fillStyle = "#7a7090";
        ctx.font = `bold 11px ${font}`;
        ctx.textAlign = "center";
        ctx.fillText("SOLD", this.x, this.y + 2);
        ctx.textAlign = "left";
        return;
      }
      const bobY = Math.sin(performance.now() / 250 + this.x) * 2;
      let icon = DD.sprites.scroll;
      if (this.kind === "heal") icon = DD.sprites.heart;
      if (this.kind === "maxhp") icon = DD.sprites.heart;
      ctx.drawImage(icon, this.x - 10, this.y - 30 + bobY, 20, 20);
      if (this.kind === "maxhp") {
        ctx.fillStyle = "#fff";
        ctx.font = `bold 12px ${font}`;
        ctx.fillText("+", this.x + 7, this.y - 18 + bobY);
      }
      ctx.font = `bold 11px ${font}`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#d8cfee";
      ctx.fillText(this.label, this.x, this.y + 18);
      const canAfford = DD.game.gold >= this.price;
      ctx.fillStyle = canAfford ? "#ffd14a" : "#e8484f";
      ctx.fillText(`${this.price}g`, this.x, this.y + 31);
      ctx.textAlign = "left";
    }
  }

  DD.makeShopkeeper = (x, y) => ({
    x, y,
    draw(c) {
      c.drawImage(DD.sprites.shopkeeper[Math.floor(performance.now() / 600) % 2],
        this.x - 24, this.y - 38, 48, 48);
    },
  });

  DD.Player = Player;
  DD.Skeleton = Skeleton;
  DD.Boss = Boss;
  DD.Chest = Chest;
  DD.Projectile = Projectile;
  DD.EnemyShot = EnemyShot;
  DD.Pickup = Pickup;
  DD.ShopItem = ShopItem;
})(window.DD);
