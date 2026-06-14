"use strict";
(function (DD) {
  DD.ATTRS = ["might", "agility", "focus", "vitality"];

  // Produce base combat stats from a hero's persistent data.
  // Parity guarantee: at level 1, all attrs 0, no gear — result equals {...DD.CLASSES[classKey]}.
  DD.deriveStats = function (hero) {
    const c = DD.CLASSES[hero.classKey];
    if (!c) return {};
    const attrs = hero.attrs || {};
    const lvl = Math.max(0, (hero.level || 1) - 1); // bonus levels above 1

    const might    = attrs.might    || 0;
    const agility  = attrs.agility  || 0;
    const focus    = attrs.focus    || 0;
    const vitality = attrs.vitality || 0;

    const s = { ...c }; // exact copy at baseline
    s.killHeal = 0;     // not in any class def; gear can add to it

    // Per-level growth and attribute scaling (both 0 at baseline)
    s.dmg   = c.dmg   + lvl * 0.15 + might   * 0.5;
    s.speed = c.speed + lvl * 2    + agility * 5;
    s.hp    = c.hp    + lvl * 0.5  + vitality * 1.5;

    if (c.cooldown  !== undefined) s.cooldown  = Math.max(0.08, c.cooldown - agility * 0.01);
    if (c.range     !== undefined) s.range     = c.range     + focus * 2;
    if (c.arc       !== undefined) s.arc       = c.arc       + focus * 0.05;
    if (c.projSpeed !== undefined) s.projSpeed = c.projSpeed + focus * 10;
    if (c.splash    !== undefined) s.splash    = c.splash    + focus * 2;

    // Equipped gear mods (Stage 3+; no-op while all slots are null)
    const eqp = hero.equipped || {};
    for (const slot of ["weapon", "armor", "trinket"]) {
      const item = eqp[slot];
      if (!item || !item.mods) continue;
      for (const [k, v] of Object.entries(item.mods)) {
        if (k !== "attr" && k in s) s[k] = (s[k] || 0) + v;
      }
    }

    return s;
  };
})(window.DD = window.DD || {});
