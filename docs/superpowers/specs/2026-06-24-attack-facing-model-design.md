# Attack facing/movement model — design

## Context
The twin-stick game lets you move (WASD / left stick) and aim (mouse / right
stick) independently. In `?3d` this produced two issues:
1. **Slide while attacking** — the attack clip freezes the legs while the entity
   keeps moving, so the character slides across the floor.
2. **Facing/attack mismatch** — the 3D model faces its *movement* direction
   (`faceFromMove`) but attacks fire toward *aim*, so you can face one way and
   attack another.

A first attempt (additive upper/lower-body blend) was reverted as too complex.
Chosen model: **face-aim + root-the-swing**.

## Behaviour
- **Roaming (not attacking):** face the movement direction (unchanged).
- **During a swing:** face the attack/aim direction, and **root movement** for
  the swing's duration; movement resumes immediately after. The entity actually
  stops in the sim, so collision and the 3D model stay in sync (no slide).
- **One duration drives everything:** a per-class `swingLock` value is the single
  source of truth for the movement-root, the face-aim window, and the 3D
  attack-animation hold — so they can never drift and produce a tail-slide.
- **3D only:** the movement-root is gated on `DD.use3d`; the legacy 2D game's
  free-move-while-attacking is unchanged.
- **Skeletons unchanged:** their AI already stops them in a windup/recover stance
  to attack, so they don't slide. (Enemy facing-during-windup is a later polish.)

## Implementation
- **Revert additive blend** (`js/char3d.js`, `js/game.js`): drop the additive
  clip build + `Character.base()/attack()/clearAttack()`; `CharacterManager.sync`
  and `game.js rigClip` go back to the single-clip `Character.play()` path
  (`{clip, once, timeScale, restart}`).
- **`swingLock` per class** in `DD.CLASSES` (`js/entities.js`): warrior 0.4,
  rogue 0.35, mage 0.4, ranger 0.5 (each < its cooldown, so holding attack gives
  a brief move-gap between swings; tunable).
- **Root + lock timer** (`js/entities.js Player`): `performAttack` sets
  `atkAnimAt = game.time`, `swingDur = c.swingLock`, `lockT = swingDur`; `update`
  decrements `lockT` and skips `moveEntity` while `DD.use3d && lockT > 0` (dash
  still moves). 
- **Facing + animation** (`js/game.js`): the player faces `faceFromAim(aim)`
  while `lockT > 0`, else `faceFromMove`; `comboAttack` uses `ent.swingDur` as its
  window (skeletons keep the existing `ATK_WIN`/`ATK_WIN_SEQ` constants).

## Verification
- `?3d&dev=combat&class=warrior|rogue|mage|ranger`: attacking faces the aim
  direction; no slide while attacking; movement resumes right after the swing;
  skeletons unaffected. Legacy 2D (`?dev=combat` without `?3d`, or no flags)
  still moves freely while attacking.
- Redeploy to GitHub Pages; incognito for fresh cache.
