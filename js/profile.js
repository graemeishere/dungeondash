"use strict";
(function (DD) {
  const PROFILE_KEY = "dungeondash_profile_v2";
  const PROFILE_VERSION = 2;

  function makeHero(classKey) {
    return {
      id: "h" + Date.now() + Math.floor(Math.random() * 9999),
      classKey,
      level: 1,
      xp: 0,
      gold: 0,
      attrPoints: 0,
      attrs: { might: 0, agility: 0, focus: 0, vitality: 0 },
      equipped: { weapon: null, armor: null, trinket: null },
      inventory: [],
      stash: [],
      kills: 0,
      deaths: 0,
    };
  }

  const profile = {
    version: PROFILE_VERSION,
    heroes: [],
    activeHeroId: null,
    meta: { shards: 0 },
    quests: { active: [], completed: [] },
    unlocks: {},
  };

  function save() {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (e) { /* private browsing */ }
  }

  function migrate(raw) {
    try {
      const v1 = JSON.parse(localStorage.getItem("dungeondash_save_v1"));
      if (v1 && typeof v1.classKey === "string") {
        const hero = makeHero(v1.classKey);
        hero.level = v1.level || 1;
        hero.xp = v1.xp || 0;
        hero.gold = v1.gold || 0;
        hero.kills = v1.kills || 0;
        profile.heroes = [hero];
        profile.activeHeroId = hero.id;
      }
    } catch (e) { }
    save();
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(PROFILE_KEY));
      if (raw && raw.version === PROFILE_VERSION && Array.isArray(raw.heroes)) {
        profile.heroes = raw.heroes;
        profile.activeHeroId = raw.activeHeroId;
        profile.meta = raw.meta || { shards: 0 };
        profile.quests = raw.quests || { active: [], completed: [] };
        profile.unlocks = raw.unlocks || {};
      } else {
        migrate(raw);
      }
    } catch (e) { }
  }

  function getActiveHero() {
    if (!profile.activeHeroId) return null;
    return profile.heroes.find((h) => h.id === profile.activeHeroId) || null;
  }

  function createHero(classKey) {
    const hero = makeHero(classKey);
    profile.heroes.push(hero);
    profile.activeHeroId = hero.id;
    save();
    return hero;
  }

  function getOrCreateHero(classKey) {
    const existing = profile.heroes.find((h) => h.classKey === classKey);
    if (existing) {
      profile.activeHeroId = existing.id;
      save();
      return existing;
    }
    return createHero(classKey);
  }

  function clear() {
    profile.heroes = [];
    profile.activeHeroId = null;
    save();
  }

  DD.profile = {
    load,
    save,
    getActiveHero,
    createHero,
    getOrCreateHero,
    clear,
    migrate,
    data: profile,
  };

  load();
})(window.DD = window.DD || {});
