import { audio } from "./audio.js?v=f2e4a613";

const PROFILE_KEY = "dungeondash_profile_v2";
const PROFILE_VERSION = 3;

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
    clears: {},        // "dungeonId:tier" -> true (cleared at that tier)
    victory: false,    // true once every dungeon is cleared at the top tier
  };
}

// quests: active = accepted (max ACTIVE_CAP), completed = ids done.
// The "available" pool is derived (all defs not active/completed).
const ACTIVE_CAP = 3;
const ABANDON_COST = 100;

const profileData = {
  version: PROFILE_VERSION,
  heroes: [],
  activeHeroId: null,
  meta: { shards: 0 },
  quests: { active: [], completed: [] },
  unlocks: {},
  onboarded: false,
  settings: { volume: 0.8 }, // matches js/audio.js's masterGain default (see docs/design/audio-spec.md §1.4/§4.1)
};

function save() {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profileData));
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
      profileData.heroes = [hero];
      profileData.activeHeroId = hero.id;
    }
  } catch (e) { }
  save();
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (raw && Array.isArray(raw.heroes)) {
      profileData.heroes = raw.heroes;
      profileData.activeHeroId = raw.activeHeroId;
      profileData.meta = raw.meta || { shards: 0 };
      profileData.unlocks = raw.unlocks || {};
      profileData.onboarded = !!raw.onboarded;
      profileData.settings = raw.settings || { volume: 0.8 };
      const q = raw.quests || {};
      // v2 auto-assigned every quest to "active"; quests are now NPC-accepted,
      // so on upgrade keep completed but clear the auto-assigned active list.
      profileData.quests = {
        completed: Array.isArray(q.completed) ? q.completed : [],
        active: (raw.version === PROFILE_VERSION && Array.isArray(q.active)) ? q.active : [],
      };
      if (raw.version !== PROFILE_VERSION) { profileData.version = PROFILE_VERSION; save(); }
    } else {
      migrate(raw);
    }
  } catch (e) { }
}

function getActiveHero() {
  if (!profileData.activeHeroId) return null;
  return profileData.heroes.find((h) => h.id === profileData.activeHeroId) || null;
}

function createHero(classKey) {
  const hero = makeHero(classKey);
  profileData.heroes.push(hero);
  profileData.activeHeroId = hero.id;
  save();
  return hero;
}

function getOrCreateHero(classKey) {
  const existing = profileData.heroes.find((h) => h.classKey === classKey);
  if (existing) {
    profileData.activeHeroId = existing.id;
    save();
    return existing;
  }
  return createHero(classKey);
}

function clear() {
  profileData.heroes = [];
  profileData.activeHeroId = null;
  save();
}

// ---- quests ----

// Goal types: kills (optional faction), bossKill (dungeon id), clearDungeon
// (dungeon id), wonRuns, repelRaid. Rewards grant gold (+ optional xp).
// desc is the Quest Giver's own voice — a reason, not a goal restatement.
// goal/reward are untouched; only the flavor text changed here.
const QUEST_DEFS = [
  { id: "first_blood",  title: "First Blood",   desc: "New in town? Prove you can hold your own — draw first blood.",                        goal: { kills: 1 },                        reward: { gold: 20 } },
  { id: "bone_hunter",  title: "Bone Hunter",   desc: "The Catacombs' dead don't stay buried on their own — thin their numbers before they reach town.",  goal: { kills: 25, faction: "skeleton" },  reward: { gold: 75 } },
  { id: "goblin_slayer",title: "Goblin Slayer", desc: "Goblins keep raiding the road for whatever the Mines won't give them — give them a reason to stay below.", goal: { kills: 25, faction: "goblin" },    reward: { gold: 80 } },
  { id: "ghost_hunter", title: "Ghost Hunter",  desc: "Something in the Crypt raises the dead faster than we can bury them — put them down for good.",   goal: { kills: 20, faction: "undead" },    reward: { gold: 90 } },
  { id: "slay_king",    title: "Slay the King", desc: "A thousand years guarding a throne with no king left to sit it — end the Skeleton King's watch.",  goal: { bossKill: "catacombs" },           reward: { gold: 200, xp: 60 } },
  { id: "warlord_end",  title: "Warlord's End", desc: "Every goblin in the Mines answers to one warlord — cut the head off and the raids stop.",          goal: { bossKill: "goblinMines" },         reward: { gold: 220, xp: 70 } },
  { id: "lich_hunter",  title: "Lich Hunter",   desc: "The Lich has outlived everything it's ever fed on — make sure it doesn't outlive this, too.",     goal: { bossKill: "crypt" },               reward: { gold: 250, xp: 90 } },
  { id: "mine_clear",   title: "Clear the Mines", desc: "Don't just bloody the Goblin Mines — clear them floor to floor, so nothing crawls back up.",     goal: { clearDungeon: "goblinMines" }, reward: { gold: 180, xp: 50 } },
  { id: "survivor",     title: "Survivor",      desc: "Most who go down don't come back up — finish a full dungeon run and prove you're not most.",      goal: { wonRuns: 1 },                      reward: { gold: 120 } },
  { id: "defender",     title: "Town Defender", desc: "The town can't hold a raid without hands on the walls — be one of them.",                          goal: { repelRaid: 1 },                    reward: { gold: 120, xp: 40 } },
];

function questDef(id) { return QUEST_DEFS.find((d) => d.id === id) || null; }

// Quests the player can still accept: not active, not completed.
function availableQuests() {
  const active = profileData.quests.active;
  const completed = profileData.quests.completed;
  return QUEST_DEFS.filter((d) => !completed.includes(d.id) && !active.find((q) => q.id === d.id));
}

function acceptQuest(id) {
  if (profileData.quests.active.length >= ACTIVE_CAP) return false;
  if (profileData.quests.completed.includes(id)) return false;
  if (profileData.quests.active.find((q) => q.id === id)) return false;
  if (!questDef(id)) return false;
  profileData.quests.active.push({ id, progress: {} });
  save();
  return true;
}

// Drop an active quest for a gold fee. Returns true if abandoned.
function abandonQuest(id, hero) {
  const idx = profileData.quests.active.findIndex((q) => q.id === id);
  if (idx < 0) return false;
  if (hero && (hero.gold || 0) < ABANDON_COST) return false;
  if (hero) hero.gold -= ABANDON_COST;
  profileData.quests.active.splice(idx, 1);
  save();
  return true;
}

// Advance accepted quests. `update` may include kills, killsByFaction, won,
// bossKill (dungeon id), clearDungeon (dungeon id), repelRaid.
function progressQuests(update) {
  const { kills = 0, killsByFaction = {}, won, bossKill, clearDungeon, repelRaid } = update;
  let changed = false;
  for (const q of profileData.quests.active) {
    const def = questDef(q.id);
    if (!def) continue;
    const g = def.goal;
    if (g.kills) {
      const inc = g.faction ? (killsByFaction[g.faction] || 0) : kills;
      q.progress.kills = (q.progress.kills || 0) + inc;
      if (q.progress.kills >= g.kills) { completeQuest(q, def); changed = true; }
    }
    if (g.bossKill && bossKill === g.bossKill) { completeQuest(q, def); changed = true; }
    if (g.clearDungeon && clearDungeon === g.clearDungeon) { completeQuest(q, def); changed = true; }
    if (g.wonRuns && won) {
      q.progress.wonRuns = (q.progress.wonRuns || 0) + 1;
      if (q.progress.wonRuns >= g.wonRuns) { completeQuest(q, def); changed = true; }
    }
    if (g.repelRaid && repelRaid) {
      q.progress.repelRaid = (q.progress.repelRaid || 0) + 1;
      if (q.progress.repelRaid >= g.repelRaid) { completeQuest(q, def); changed = true; }
    }
  }
  profileData.quests.active = profileData.quests.active.filter(
    (q) => !profileData.quests.completed.includes(q.id)
  );
  if (changed) save();
}

function completeQuest(q, def) {
  if (profileData.quests.completed.includes(q.id)) return;
  profileData.quests.completed.push(q.id);
  audio.questComplete();
  const hero = getActiveHero();
  if (hero) {
    if (def.reward.gold) hero.gold = (hero.gold || 0) + def.reward.gold;
    if (def.reward.xp) hero.xp = (hero.xp || 0) + def.reward.xp;
  }
}

// ---- dungeon clear tracking (per hero) ----

function markClear(hero, dungeonId, tier) {
  if (!hero) return;
  hero.clears = hero.clears || {};
  hero.clears[`${dungeonId}:${tier}`] = true;
}

function hasClear(hero, dungeonId, tier) {
  return !!(hero && hero.clears && hero.clears[`${dungeonId}:${tier}`]);
}

function setOnboarded() {
  profileData.onboarded = true;
  save();
}

export const profile = {
  load,
  save,
  getActiveHero,
  createHero,
  getOrCreateHero,
  clear,
  migrate,
  data: profileData,
  questDefs: QUEST_DEFS,
  questDef,
  availableQuests,
  acceptQuest,
  abandonQuest,
  progressQuests,
  markClear,
  hasClear,
  setOnboarded,
  ABANDON_COST,
  ACTIVE_CAP,
};

load();
