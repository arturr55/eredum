const { getHeroStats } = require('./heroes');
const db = require('./db');

const TURN_TIME = 30; // секунд на ход

class GameRoom {
  constructor(roomId, players, io) {
    this.roomId = roomId;
    this.io = io;
    this.turnTimer = null;

    // Инициализация двух команд: [0,1] vs [2,3]
    this.teams = {
      A: players.slice(0, 2),
      B: players.slice(2, 4)
    };

    // Состояние каждого игрока в бою
    this.fighters = {};
    for (const p of players) {
      const heroData = db.getPlayerHero(p.telegramId);
      const abilityLevels = [
        heroData.ability1_level,
        heroData.ability2_level,
        heroData.ability3_level
      ];
      const hero = getHeroStats(p.heroId, heroData.level, abilityLevels);

      this.fighters[p.telegramId] = {
        telegramId: p.telegramId,
        username: p.username,
        heroId: p.heroId,
        hero,
        hp: hero.stats.hp,
        maxHp: hero.stats.hp,
        mana: hero.stats.mana,
        maxMana: hero.stats.mana,
        def: hero.stats.def,
        atk: hero.stats.atk,
        // Статусы
        stunned: 0,
        barrier: 0,
        curseStacks: {},   // { targetId: stacks }
        rage: 0,           // Берсерк
        spiritHealTurns: 0,
        spiritHealAmount: 0,
        defReduction: {},  // { targetId: { reduction, turns } }
        nextAbilityMultiplier: 1,
        team: this.teams.A.find(pl => pl.telegramId === p.telegramId) ? 'A' : 'B',
        // Выбранное действие в этом ходу
        chosenAbility: null,
        chosenTarget: null,
        ready: false
      };
    }

    this.turn = 0;
    this.log = [];
    this.gameOver = false;
  }

  start() {
    this.turn = 1;
    this.broadcastState('gameStart');
    this.startTurn();
  }

  startTurn() {
    // Сброс выборов
    for (const f of Object.values(this.fighters)) {
      f.chosenAbility = null;
      f.chosenTarget = null;
      // Мёртвые автоматически пропускают ход
      f.ready = f.hp <= 0;
    }

    this.io.to(this.roomId).emit('turnStart', {
      turn: this.turn,
      timeLimit: TURN_TIME,
      state: this.getPublicState()
    });

    // Таймер хода
    this.turnTimer = setTimeout(() => {
      this.resolveTurn();
    }, TURN_TIME * 1000);
  }

  playerAction(telegramId, abilityIndex) {
    const fighter = this.fighters[telegramId];
    if (!fighter || fighter.ready || this.gameOver || fighter.hp <= 0) return;

    // Автовыбор цели: первый живой враг
    const enemies = this.getEnemies(telegramId);
    const allies = this.getAllies(telegramId);
    const ability = fighter.hero.abilities[abilityIndex];

    if (!ability) return;

    // Проверка маны
    if (fighter.mana < ability.manaCost) {
      this.io.to(this.getSocketId(telegramId)).emit('abilityError', 'Недостаточно маны');
      return;
    }

    // Определить цель
    let target = null;
    if (ability.target === 'enemy' && enemies.length > 0) target = enemies[0].telegramId;
    if (ability.target === 'ally' && allies.length > 0) {
      // Хилим самого раненого
      target = allies.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0]?.telegramId || telegramId;
    }
    if (ability.target === 'self') target = telegramId;

    fighter.chosenAbility = abilityIndex;
    fighter.chosenTarget = target;
    fighter.ready = true;

    this.io.to(this.roomId).emit('playerReady', { telegramId, username: fighter.username });

    // Если все готовы — разрешаем ход досрочно
    if (Object.values(this.fighters).every(f => f.ready || f.hp <= 0)) {
      clearTimeout(this.turnTimer);
      this.resolveTurn();
    }
  }

  resolveTurn() {
    if (this.gameOver) return;

    // Шаман пассивка: +5 маны всем союзникам каждый ход
    for (const f of Object.values(this.fighters)) {
      if (f.heroId === 'shaman' && f.hp > 0) {
        const allies = this.getAllies(f.telegramId);
        for (const ally of allies) {
          ally.mana = Math.min(ally.maxMana, ally.mana + 5);
        }
      }
    }

    // Применить Spirit Ward хил
    for (const f of Object.values(this.fighters)) {
      if (f.spiritHealTurns > 0 && f.hp > 0) {
        const healAmt = Math.floor(f.maxHp * f.spiritHealAmount);
        f.hp = Math.min(f.maxHp, f.hp + healAmt);
        f.spiritHealTurns--;
        this.log.push(`${f.username} восстанавливает ${healAmt} HP от духов`);
      }
    }

    // Сортируем по скорости
    const activeFighters = Object.values(this.fighters)
      .filter(f => f.hp > 0 && f.ready)
      .sort((a, b) => b.hero.stats.spd - a.hero.stats.spd);

    for (const fighter of activeFighters) {
      if (fighter.hp <= 0) continue;
      if (fighter.stunned > 0) {
        fighter.stunned--;
        this.log.push(`${fighter.username} оглушён и пропускает ход`);
        continue;
      }

      const abilityIndex = fighter.chosenAbility;
      if (abilityIndex === null) continue;

      this.applyAbility(fighter, abilityIndex);
    }

    // Снизить кулдауны и обновить статусы
    for (const f of Object.values(this.fighters)) {
      if (f.barrier > 0) f.barrier = 0; // барьер на 1 ход
      // Снизить def reduction
      for (const [tid, rd] of Object.entries(f.defReduction)) {
        rd.turns--;
        if (rd.turns <= 0) delete f.defReduction[tid];
      }
    }

    this.turn++;

    // Проверить конец игры
    const winner = this.checkWinner();
    if (winner) {
      this.endGame(winner);
      return;
    }

    this.broadcastState('turnEnd');
    this.startTurn();
  }

  applyAbility(fighter, abilityIndex) {
    const ability = fighter.hero.abilities[abilityIndex];
    if (!ability) return;

    const multiplier = fighter.nextAbilityMultiplier || 1;
    fighter.nextAbilityMultiplier = 1;

    // Списать ману
    fighter.mana -= ability.manaCost;

    const bonus = ability.effectBonus || 1;
    const target = fighter.chosenTarget ? this.fighters[fighter.chosenTarget] : null;
    const enemies = this.getEnemies(fighter.telegramId);
    const allies = this.getAllies(fighter.telegramId);

    switch (ability.id) {
      case 'shield_bash': {
        if (!target || target.hp <= 0) break;
        const dmg = this.calcDamage(fighter, target, ability.effect.damage * bonus * multiplier);
        this.dealDamage(target, dmg);
        target.stunned = ability.effect.stun;
        this.log.push(`${fighter.username} оглушает ${target.username} на ${dmg} урона`);
        break;
      }

      case 'holy_barrier': {
        const t = target || fighter;
        t.barrier = Math.floor(t.def * ability.effect.barrier * bonus);
        this.log.push(`${fighter.username} ставит барьер на ${t.username} (${t.barrier} HP)`);
        break;
      }

      case 'divine_light': {
        const dmg = Math.floor(fighter.atk * ability.effect.damage * bonus * multiplier);
        for (const e of enemies) {
          if (e.hp > 0) this.dealDamage(e, dmg);
        }
        const healAmt = Math.floor(fighter.hero.stats.atk * ability.effect.heal * bonus);
        for (const a of [...allies, fighter]) {
          if (a.hp > 0) a.hp = Math.min(a.maxHp, a.hp + healAmt);
        }
        this.log.push(`${fighter.username} использует Свет правосудия`);
        break;
      }

      case 'curse': {
        if (!target || target.hp <= 0) break;
        if (!fighter.curseStacks[target.telegramId]) fighter.curseStacks[target.telegramId] = 0;
        fighter.curseStacks[target.telegramId]++;
        const stacks = fighter.curseStacks[target.telegramId];
        this.log.push(`${fighter.username} проклинает ${target.username} (стек ${stacks})`);
        // Пассивка: взрыв на 3 стеках
        if (stacks >= 3) {
          const explodeDmg = Math.floor(fighter.atk * ability.effect.damage_per_stack * stacks * 2 * bonus * multiplier);
          this.dealDamage(target, explodeDmg);
          fighter.curseStacks[target.telegramId] = 0;
          this.log.push(`ВЗРЫВ ПРОКЛЯТИЙ на ${target.username}: ${explodeDmg} урона!`);
        } else {
          const tickDmg = Math.floor(fighter.atk * ability.effect.damage_per_stack * bonus * multiplier);
          this.dealDamage(target, tickDmg);
        }
        break;
      }

      case 'hex_wave': {
        for (const e of enemies) {
          if (e.hp <= 0) continue;
          if (!fighter.curseStacks[e.telegramId]) fighter.curseStacks[e.telegramId] = 0;
          fighter.curseStacks[e.telegramId]++;
          const tickDmg = Math.floor(fighter.atk * ability.effect.damage_per_stack * bonus * multiplier);
          this.dealDamage(e, tickDmg);
        }
        this.log.push(`${fighter.username} проклинает всех врагов`);
        break;
      }

      case 'dark_pact': {
        const hpCost = Math.floor(fighter.maxHp * ability.effect.hp_cost);
        fighter.hp = Math.max(1, fighter.hp - hpCost);
        fighter.nextAbilityMultiplier = ability.effect.next_ability_multiplier;
        this.log.push(`${fighter.username} заключает тёмный договор (-${hpCost} HP, следующая способность x2)`);
        break;
      }

      case 'spirit_heal': {
        // Хилим самого раненого союзника или себя если нет союзников
        const healTarget = allies.sort((a, b) => (a.hp/a.maxHp) - (b.hp/b.maxHp))[0] || fighter;
        const healAmt = Math.floor(fighter.hero.stats.atk * ability.effect.heal * bonus * multiplier);
        healTarget.hp = Math.min(healTarget.maxHp, healTarget.hp + healAmt);
        this.log.push(`${fighter.username} лечит ${healTarget.username} на ${healAmt} HP`);
        this.checkPaladinPassive(healTarget);
        break;
      }

      case 'mana_restore': {
        for (const a of [...allies, fighter]) {
          if (a.hp > 0) a.mana = Math.min(a.maxMana, a.mana + ability.effect.mana_restore);
        }
        this.log.push(`${fighter.username} восстанавливает ману команде`);
        break;
      }

      case 'spirit_ward': {
        const healPerTurn = ability.effect.heal_per_turn * bonus;
        for (const a of [...allies, fighter]) {
          if (a.hp > 0) {
            a.spiritHealTurns = ability.effect.duration;
            a.spiritHealAmount = healPerTurn;
          }
        }
        this.log.push(`${fighter.username} призывает духов-хранителей (хил всей команде ${ability.effect.duration} хода)`);
        break;
      }

      case 'nature_embrace': {
        const selfHeal = Math.floor(fighter.maxHp * ability.effect.heal * bonus * multiplier);
        fighter.hp = Math.min(fighter.maxHp, fighter.hp + selfHeal);
        if (ability.effect.cleanse) {
          fighter.stunned = 0;
        }
        this.log.push(`${fighter.username} восстанавливает себе ${selfHeal} HP и снимает негативные эффекты`);
        break;
      }

      case 'team_restoration': {
        const teamHeal = Math.floor(fighter.maxHp * ability.effect.heal * bonus * multiplier);
        for (const a of [...allies, fighter]) {
          if (a.hp > 0) a.hp = Math.min(a.maxHp, a.hp + teamHeal);
        }
        this.log.push(`${fighter.username} восстанавливает всей команде ${teamHeal} HP!`);
        break;
      }

      case 'witch_self_heal': {
        const witchHeal = Math.floor(fighter.hero.stats.atk * ability.effect.heal * bonus * multiplier);
        fighter.hp = Math.min(fighter.maxHp, fighter.hp + witchHeal);
        this.log.push(`${fighter.username} поглощает боль — восстанавливает ${witchHeal} HP`);
        break;
      }

      case 'coven_ritual': {
        const covenHeal = Math.floor(fighter.maxHp * ability.effect.heal * bonus * multiplier);
        for (const a of [...allies, fighter]) {
          if (a.hp > 0) a.hp = Math.min(a.maxHp, a.hp + covenHeal);
        }
        this.log.push(`${fighter.username} проводит ритуал ковена — вся команда восстанавливает ${covenHeal} HP`);
        break;
      }

      case 'rage_strike': {
        if (!target || target.hp <= 0) break;
        const rageBonus = 1 + (fighter.rage * ability.effect.rage_bonus);
        const dmg = this.calcDamage(fighter, target, ability.effect.damage * bonus * multiplier * rageBonus);
        this.dealDamage(target, dmg);
        this.log.push(`${fighter.username} бьёт ${target.username} на ${dmg} (ярость ${fighter.rage})`);
        break;
      }

      case 'armor_break': {
        if (!target || target.hp <= 0) break;
        target.defReduction[fighter.telegramId] = {
          reduction: ability.effect.def_reduction,
          turns: ability.effect.duration
        };
        this.log.push(`${fighter.username} ломает броню ${target.username} на ${ability.effect.duration} хода`);
        break;
      }

      case 'berserker_rage': {
        const lowHpBonus = fighter.hp / fighter.maxHp < 0.3 ? ability.effect.low_hp_bonus : 1;
        const dmg = Math.floor(fighter.atk * ability.effect.damage * bonus * multiplier * lowHpBonus);
        for (const e of enemies) {
          if (e.hp > 0) this.dealDamage(e, dmg);
        }
        this.log.push(`${fighter.username} впадает в берсерк-режим (урон ${dmg}${lowHpBonus > 1 ? ' КРИТИЧНО!' : ''})`);
        break;
      }
    }
  }

  calcDamage(attacker, target, multiplier) {
    let defVal = target.def;
    // Учесть снижение защиты
    for (const rd of Object.values(target.defReduction || {})) {
      defVal = Math.floor(defVal * (1 - rd.reduction));
    }
    const raw = Math.floor(attacker.atk * multiplier);
    const reduced = Math.max(Math.floor(raw * 0.1), raw - Math.floor(defVal * 0.4));
    return reduced;
  }

  dealDamage(target, amount) {
    if (target.barrier > 0) {
      const absorbed = Math.min(target.barrier, amount);
      target.barrier -= absorbed;
      amount -= absorbed;
    }
    target.hp = Math.max(0, target.hp - amount);
    // Берсерк пассивка: ярость от получения урона
    if (target.heroId === 'berserker' && amount > 0) {
      target.rage = Math.min(10, target.rage + 1);
    }
    // Паладин пассивка
    this.checkPaladinPassive(target);
  }

  checkPaladinPassive(fighter) {
    if (fighter.hp / fighter.maxHp < 0.2 && fighter.barrier === 0) {
      // Найти паладина в союзниках
      const paladin = this.getAllies(fighter.telegramId).find(a => a.heroId === 'paladin' && a.hp > 0);
      if (paladin) {
        fighter.barrier = Math.floor(paladin.def * 1.0);
        this.log.push(`Паладин автоматически защищает ${fighter.username}!`);
      }
    }
  }

  checkWinner() {
    const aAlive = this.teams.A.some(p => this.fighters[p.telegramId]?.hp > 0);
    const bAlive = this.teams.B.some(p => this.fighters[p.telegramId]?.hp > 0);
    if (!aAlive) return 'B';
    if (!bAlive) return 'A';
    return null;
  }

  endGame(winnerTeam) {
    this.gameOver = true;
    clearTimeout(this.turnTimer);

    const winners = this.teams[winnerTeam].map(p => p.telegramId);
    const losers = this.teams[winnerTeam === 'A' ? 'B' : 'A'].map(p => p.telegramId);

    const results = {};
    for (const tid of winners) {
      results[tid] = db.addWin(tid);
    }
    for (const tid of losers) {
      db.addLoss(tid);
    }

    this.io.to(this.roomId).emit('gameOver', {
      winnerTeam,
      winners,
      losers,
      results,
      log: this.log.slice(-20),
      finalState: this.getPublicState()
    });

    // Очистить комнату через 10 сек
    setTimeout(() => {
      global.cleanupRoom(this.roomId);
    }, 10000);
  }

  playerDisconnected(telegramId) {
    const fighter = this.fighters[telegramId];
    if (fighter) {
      fighter.hp = 0;
      this.log.push(`${fighter.username} отключился`);
    }
    const winner = this.checkWinner();
    if (winner) this.endGame(winner);
  }

  getEnemies(telegramId) {
    const myTeam = this.fighters[telegramId]?.team;
    return Object.values(this.fighters).filter(f => f.team !== myTeam && f.hp > 0);
  }

  getAllies(telegramId) {
    const myTeam = this.fighters[telegramId]?.team;
    return Object.values(this.fighters).filter(f => f.team === myTeam && f.telegramId !== telegramId && f.hp > 0);
  }

  getSocketId(telegramId) {
    for (const [id, socket] of this.io.sockets.sockets) {
      if (socket.data.telegramId === telegramId) return id;
    }
    return null;
  }

  getPublicState() {
    const state = {};
    for (const [tid, f] of Object.entries(this.fighters)) {
      state[tid] = {
        telegramId: f.telegramId,
        username: f.username,
        heroId: f.heroId,
        heroName: f.hero.name,
        team: f.team,
        hp: f.hp,
        maxHp: f.maxHp,
        mana: f.mana,
        maxMana: f.maxMana,
        barrier: f.barrier,
        stunned: f.stunned,
        rage: f.rage,
        ready: f.ready
      };
    }
    return state;
  }

  broadcastState(event) {
    this.io.to(this.roomId).emit(event, {
      turn: this.turn,
      state: this.getPublicState(),
      log: this.log.slice(-10)
    });
  }
}

module.exports = GameRoom;
