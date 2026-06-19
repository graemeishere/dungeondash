"use strict";
(function (DD) {
  DD.INV_CAP = 15;

  DD.ITEM_RARITY = {
    common: { color: "#b0a8cc", weight: 60, scale: 1.0, label: "Common" },
    rare:   { color: "#4a9bff", weight: 28, scale: 1.6, label: "Rare"   },
    epic:   { color: "#c87dff", weight: 12, scale: 2.5, label: "Epic"   },
  };

  const ITEM_BASES = [
    // Weapons — improve damage / attack stats
    { name: "Iron Sword",   slot: "weapon",  icon: "sword", mods: { dmg: 1.5 } },
    { name: "Keen Blade",   slot: "weapon",  icon: "sword", mods: { dmg: 1.0, cooldown: -0.04 } },
    { name: "Heavy Maul",   slot: "weapon",  icon: "sword", mods: { dmg: 3.0 } },
    { name: "Magic Focus",  slot: "weapon",  icon: "sword", mods: { dmg: 1.5, projSpeed: 28 } },
    // Armor — improve survivability
    { name: "Leather Vest", slot: "armor",   icon: "armor", mods: { hp: 2 } },
    { name: "Chain Mail",   slot: "armor",   icon: "armor", mods: { hp: 4 } },
    { name: "Swift Leather",slot: "armor",   icon: "armor", mods: { hp: 1, speed: 14 } },
    { name: "Arcane Robe",  slot: "armor",   icon: "armor", mods: { hp: 2, projSpeed: 22 } },
    // Trinkets — utility / hybrid bonuses
    { name: "Swift Ring",   slot: "trinket", icon: "ring",  mods: { speed: 20 } },
    { name: "Vampire Fang", slot: "trinket", icon: "ring",  mods: { killHeal: 0.3 } },
    { name: "Power Gem",    slot: "trinket", icon: "ring",  mods: { dmg: 1.5 } },
    { name: "Vigor Amulet", slot: "trinket", icon: "ring",  mods: { hp: 2, speed: 7 } },
  ];

  // Labels used in the inventory tooltip
  const STAT_LABELS = {
    dmg: "Damage", speed: "Speed", hp: "Max HP", cooldown: "Cooldown",
    projSpeed: "Proj Speed", range: "Range", arc: "Arc",
    splash: "Splash", pierce: "Pierce", killHeal: "Lifesteal",
  };

  // Stats where a higher value is better (cooldown is inverted)
  const HIGHER_IS_BETTER = new Set([
    "dmg", "speed", "hp", "projSpeed", "range", "arc", "splash", "pierce", "killHeal",
  ]);

  // Generate a random item for the given floor (0-based) and optional min rarity.
  DD.rollItem = function ({ floor = 0, minRarity } = {}) {
    // Choose rarity
    const entries = Object.entries(DD.ITEM_RARITY);
    const pool = minRarity
      ? entries.slice(entries.findIndex(([r]) => r === minRarity))
      : entries;
    const total = pool.reduce((s, [, r]) => s + r.weight, 0);
    let roll = Math.random() * total;
    let rarity = pool[0][0];
    for (const [r, def] of pool) {
      roll -= def.weight;
      if (roll <= 0) { rarity = r; break; }
    }

    const base = DD.choice(ITEM_BASES);
    const scale = DD.ITEM_RARITY[rarity].scale;
    const mods = {};
    for (const [k, v] of Object.entries(base.mods)) {
      mods[k] = Math.round(v * scale * 100) / 100;
    }

    return {
      id: base.slot[0] + Date.now().toString(36) + Math.floor(Math.random() * 9999),
      name: base.name,
      slot: base.slot,
      rarity,
      icon: base.icon,
      levelReq: 1,
      mods,
    };
  };

  // Equip an item from inventory (or anywhere) onto the hero. Returns the
  // previously equipped item in that slot (now moved to inventory), or null.
  DD.equip = function (hero, item) {
    const idx = hero.inventory.findIndex((i) => i.id === item.id);
    if (idx >= 0) hero.inventory.splice(idx, 1);
    const prev = hero.equipped[item.slot];
    if (prev) hero.inventory.unshift(prev); // put old item back at front
    hero.equipped[item.slot] = item;
    return prev;
  };

  // Move the equipped item in a slot back into inventory.
  DD.unequip = function (hero, slot) {
    const item = hero.equipped[slot];
    if (!item) return null;
    hero.equipped[slot] = null;
    hero.inventory.unshift(item);
    return item;
  };

  // Returns [{key, text}] for tooltip display.
  DD.itemStatLines = function (item) {
    return Object.entries(item.mods || {}).map(([k, v]) => {
      const label = STAT_LABELS[k] || k;
      let text;
      if (k === "killHeal") {
        text = `+${Math.round(v * 100)}% ${label}`;
      } else if (k === "cooldown") {
        text = `${v.toFixed(2)}s ${label} (faster)`;
      } else if (Math.abs(v) >= 1) {
        text = `${v > 0 ? "+" : ""}${Math.round(v)} ${label}`;
      } else {
        text = `${v > 0 ? "+" : ""}${v.toFixed(1)} ${label}`;
      }
      return { key: k, text };
    });
  };

  // Returns {key: delta} where positive delta means item a is better than b.
  DD.compareItems = function (a, b) {
    const diff = {};
    const keys = new Set([...Object.keys(a.mods || {}), ...Object.keys(b.mods || {})]);
    for (const k of keys) {
      const va = (a.mods || {})[k] || 0;
      const vb = (b.mods || {})[k] || 0;
      const d = va - vb;
      if (Math.abs(d) > 0.0001) diff[k] = HIGHER_IS_BETTER.has(k) ? d : -d;
    }
    return diff;
  };
})(window.DD = window.DD || {});
