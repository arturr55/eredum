const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../eredum.db');
const db = new Database(dbPath);

// Создаём таблицы
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    telegram_id TEXT PRIMARY KEY,
    username TEXT,
    stars INTEGER DEFAULT 0,
    shards INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS player_heroes (
    telegram_id TEXT,
    hero_id TEXT,
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    ability1_level INTEGER DEFAULT 1,
    ability2_level INTEGER DEFAULT 1,
    ability3_level INTEGER DEFAULT 1,
    skin_id TEXT DEFAULT 'default',
    PRIMARY KEY (telegram_id, hero_id),
    FOREIGN KEY (telegram_id) REFERENCES players(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS selected_hero (
    telegram_id TEXT PRIMARY KEY,
    hero_id TEXT,
    FOREIGN KEY (telegram_id) REFERENCES players(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS owned_skins (
    telegram_id TEXT,
    hero_id TEXT,
    skin_id TEXT,
    purchased_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (telegram_id, hero_id, skin_id)
  );

  CREATE TABLE IF NOT EXISTS owned_items (
    telegram_id TEXT,
    item_id TEXT,
    purchased_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (telegram_id, item_id)
  );
`);

module.exports = {
  getPlayer(telegramId) {
    return db.prepare('SELECT * FROM players WHERE telegram_id = ?').get(telegramId);
  },

  createPlayer(telegramId, username) {
    db.prepare('INSERT INTO players (telegram_id, username) VALUES (?, ?)').run(telegramId, username);
    return this.getPlayer(telegramId);
  },

  getPlayerHero(telegramId) {
    const selected = db.prepare('SELECT hero_id FROM selected_hero WHERE telegram_id = ?').get(telegramId);
    if (!selected) return null;
    return db.prepare('SELECT * FROM player_heroes WHERE telegram_id = ? AND hero_id = ?')
      .get(telegramId, selected.hero_id);
  },

  setPlayerHero(telegramId, heroId) {
    // Создать героя если нет
    const existing = db.prepare('SELECT * FROM player_heroes WHERE telegram_id = ? AND hero_id = ?')
      .get(telegramId, heroId);
    if (!existing) {
      db.prepare('INSERT INTO player_heroes (telegram_id, hero_id) VALUES (?, ?)').run(telegramId, heroId);
    }
    // Установить выбранного героя
    db.prepare('INSERT OR REPLACE INTO selected_hero (telegram_id, hero_id) VALUES (?, ?)').run(telegramId, heroId);
    return this.getPlayerHero(telegramId);
  },

  addWin(telegramId) {
    const hero = this.getPlayerHero(telegramId);
    if (!hero) return;

    const xpGain = 100;
    const shardsGain = 30; // Осколки за победу
    const newXp = hero.xp + xpGain;
    const xpToLevel = hero.level * 150;
    let newLevel = hero.level;
    let remainingXp = newXp;

    if (newXp >= xpToLevel) {
      newLevel += 1;
      remainingXp = newXp - xpToLevel;
    }

    db.prepare(`UPDATE player_heroes SET xp = ?, level = ? WHERE telegram_id = ? AND hero_id = ?`)
      .run(remainingXp, newLevel, telegramId, hero.hero_id);
    db.prepare('UPDATE players SET wins = wins + 1, shards = shards + ? WHERE telegram_id = ?')
      .run(shardsGain, telegramId);

    return { newLevel, newXp: remainingXp, levelUp: newLevel > hero.level, shardsGain };
  },

  addLoss(telegramId) {
    const hero = this.getPlayerHero(telegramId);
    if (!hero) return;
    const xpGain = 25;
    const shardsGain = 10; // Небольшие осколки за поражение

    db.prepare(`UPDATE player_heroes SET xp = xp + ? WHERE telegram_id = ? AND hero_id = ?`)
      .run(xpGain, telegramId, hero.hero_id);
    db.prepare('UPDATE players SET losses = losses + 1, shards = shards + ? WHERE telegram_id = ?')
      .run(shardsGain, telegramId);
  },

  getPlayerHeroById(telegramId, heroId) {
    return db.prepare('SELECT * FROM player_heroes WHERE telegram_id = ? AND hero_id = ?')
      .get(telegramId, heroId);
  },

  getOwnedSkins(telegramId, heroId) {
    return db.prepare('SELECT skin_id FROM owned_skins WHERE telegram_id = ? AND hero_id = ?')
      .all(telegramId, heroId).map(r => r.skin_id);
  },

  equipSkin(telegramId, heroId, skinId) {
    db.prepare('UPDATE player_heroes SET skin_id = ? WHERE telegram_id = ? AND hero_id = ?')
      .run(skinId, telegramId, heroId);
    return this.getPlayerHeroById(telegramId, heroId);
  },

  addOwnedSkin(telegramId, heroId, skinId) {
    db.prepare('INSERT OR IGNORE INTO owned_skins (telegram_id, hero_id, skin_id) VALUES (?, ?, ?)')
      .run(telegramId, heroId, skinId);
  },

  getOwnedItems(telegramId) {
    return db.prepare('SELECT item_id FROM owned_items WHERE telegram_id = ?')
      .all(telegramId).map(r => r.item_id);
  },

  addOwnedItem(telegramId, itemId) {
    db.prepare('INSERT OR IGNORE INTO owned_items (telegram_id, item_id) VALUES (?, ?)')
      .run(telegramId, itemId);
  },

  addStars(telegramId, amount) {
    db.prepare('UPDATE players SET stars = stars + ? WHERE telegram_id = ?').run(amount, telegramId);
  },

  deductStars(telegramId, amount) {
    db.prepare('UPDATE players SET stars = MAX(0, stars - ?) WHERE telegram_id = ?').run(amount, telegramId);
  },

  upgradeAbility(telegramId, abilityIndex) {
    const hero = this.getPlayerHero(telegramId);
    if (!hero) return { error: 'Герой не найден' };

    const col = `ability${abilityIndex + 1}_level`;
    const currentLevel = hero[col];
    const maxLevel = 5;

    if (currentLevel >= maxLevel) return { error: 'Максимальный уровень' };

    // Стоимость: уровень × 50 осколков
    const cost = currentLevel * 50;
    const player = this.getPlayer(telegramId);
    if (!player || player.shards < cost) return { error: `Нужно ${cost} осколков` };

    db.prepare(`UPDATE player_heroes SET ${col} = ${col} + 1 WHERE telegram_id = ? AND hero_id = ?`)
      .run(telegramId, hero.hero_id);
    db.prepare('UPDATE players SET shards = shards - ? WHERE telegram_id = ?')
      .run(cost, telegramId);

    return { success: true, cost, newLevel: currentLevel + 1 };
  }
};
