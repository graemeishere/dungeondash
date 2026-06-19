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

  // ---- quests ----

  const QUEST_DEFS = [
    {
      id: "first_blood",
      title: "First Blood",
      desc: "Slay your first skeleton.",
      goal: { kills: 1 },
      reward: { gold: 20 },
    },
    {
      id: "dungeon_delver",
      title: "Dungeon Delver",
      desc: "Defeat 50 skeletons across all runs.",
      goal: { kills: 50 },
      reward: { gold: 75 },
    },
    {
      id: "bone_collector",
      title: "Bone Collector",
      desc: "Defeat 200 skeletons.",
      goal: { kills: 200 },
      reward: { gold: 200 },
    },
    {
      id: "floor_two",
      title: "Deeper Darkness",
      desc: "Reach the Crypt (Floor 2).",
      goal: { floor: 2 },
      reward: { gold: 50 },
    },
    {
      id: "survivor",
      title: "Survivor",
      desc: "Complete a full run without dying.",
      goal: { wonRuns: 1 },
      reward: { gold: 150 },
    },
  ];

  function ensureActiveQuests() {
    const active = profile.quests.active;
    const completed = profile.quests.completed;
    for (const def of QUEST_DEFS) {
      if (!completed.includes(def.id) && !active.find((q) => q.id === def.id)) {
        active.push({ id: def.id, progress: {} });
      }
    }
  }

  function progressQuests(update) {
    const { kills = 0, floor, won } = update;
    let changed = false;
    for (const q of profile.quests.active) {
      const def = QUEST_DEFS.find((d) => d.id === q.id);
      if (!def) continue;
      const g = def.goal;
      if (g.kills) {
        q.progress.kills = (q.progress.kills || 0) + kills;
        if (q.progress.kills >= g.kills) { completeQuest(q, def); changed = true; }
      }
      if (g.floor !== undefined && floor !== undefined && floor >= g.floor) {
        completeQuest(q, def); changed = true;
      }
      if (g.wonRuns && won) {
        q.progress.wonRuns = (q.progress.wonRuns || 0) + 1;
        if (q.progress.wonRuns >= g.wonRuns) { completeQuest(q, def); changed = true; }
      }
    }
    // prune completed from active list
    profile.quests.active = profile.quests.active.filter(
      (q) => !profile.quests.completed.includes(q.id)
    );
    if (changed) ensureActiveQuests();
  }

  function completeQuest(q, def) {
    if (profile.quests.completed.includes(q.id)) return;
    profile.quests.completed.push(q.id);
    const hero = getActiveHero();
    if (hero && def.reward.gold) hero.gold = (hero.gold || 0) + def.reward.gold;
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
    questDefs: QUEST_DEFS,
    ensureActiveQuests,
    progressQuests,
  };

  load();
  ensureActiveQuests();
})(window.DD = window.DD || {});
