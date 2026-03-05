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

    // Опыт за победу
    const xpGain = 100;
    const newXp = hero.xp + xpGain;
    const xpToLevel = hero.level * 150;
    let newLevel = hero.level;
    let remainingXp = newXp;

    if (newXp >= xpToLevel) {
      newLevel += 1;
      remainingXp = newXp - xpToLevel;
    }

    db.prepare(`
      UPDATE player_heroes SET xp = ?, level = ?
      WHERE telegram_id = ? AND hero_id = ?
    `).run(remainingXp, newLevel, telegramId, hero.hero_id);

    db.prepare('UPDATE players SET wins = wins + 1 WHERE telegram_id = ?').run(telegramId);

    return { newLevel, newXp: remainingXp, levelUp: newLevel > hero.level };
  },

  addLoss(telegramId) {
    const xpGain = 25; // Небольшой опыт за поражение
    const hero = this.getPlayerHero(telegramId);
    if (!hero) return;

    db.prepare(`
      UPDATE player_heroes SET xp = xp + ?
      WHERE telegram_id = ? AND hero_id = ?
    `).run(xpGain, telegramId, hero.hero_id);

    db.prepare('UPDATE players SET losses = losses + 1 WHERE telegram_id = ?').run(telegramId);
  },

  upgradeAbility(telegramId, abilityIndex) {
    const hero = this.getPlayerHero(telegramId);
    if (!hero) return null;
    const col = `ability${abilityIndex + 1}_level`;
    db.prepare(`UPDATE player_heroes SET ${col} = ${col} + 1 WHERE telegram_id = ? AND hero_id = ?`)
      .run(telegramId, hero.hero_id);
    return this.getPlayerHero(telegramId);
  }
};
