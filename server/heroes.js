// Базовые характеристики и способности всех героев

const HEROES = {
  paladin: {
    id: 'paladin',
    name: 'Паладин',
    description: 'Танк. Защищает союзников барьерами.',
    baseStats: { hp: 120, def: 40, atk: 60, mana: 50, spd: 40 },
    color: '#FFD700',
    abilities: [
      {
        id: 'shield_bash',
        name: 'Удар щитом',
        description: 'Наносит урон и оглушает цель на 1 ход',
        manaCost: 10,
        cooldown: 0,
        type: 'damage',
        target: 'enemy',
        effect: { damage: 0.8, stun: 1 }
      },
      {
        id: 'holy_barrier',
        name: 'Священный барьер',
        description: 'Ставит барьер на союзника — поглощает урон 1 ход',
        manaCost: 20,
        cooldown: 2,
        type: 'buff',
        target: 'ally',
        effect: { barrier: 1.5 } // множитель от DEF
      },
      {
        id: 'divine_light',
        name: 'Свет правосудия',
        description: 'Урон всем врагам и хил всем союзникам',
        manaCost: 35,
        cooldown: 4,
        type: 'aoe',
        target: 'all',
        effect: { damage: 0.6, heal: 0.3 }
      }
    ],
    passive: {
      id: 'guardian',
      name: 'Страж',
      description: 'Если союзник падает ниже 20% HP — автоматически ставит барьер'
    }
  },

  witch: {
    id: 'witch',
    name: 'Ведьма',
    description: 'Контроль и урон. Проклятия накапливаются и взрываются.',
    baseStats: { hp: 65, def: 15, atk: 90, mana: 90, spd: 55 },
    color: '#9B59B6',
    abilities: [
      {
        id: 'curse',
        name: 'Проклятие',
        description: 'Накладывает проклятие на врага. 3 стека = взрыв',
        manaCost: 15,
        cooldown: 0,
        type: 'debuff',
        target: 'enemy',
        effect: { curse_stack: 1, damage_per_stack: 0.4 }
      },
      {
        id: 'hex_wave',
        name: 'Волна проклятий',
        description: 'Проклятие на всех врагов',
        manaCost: 30,
        cooldown: 3,
        type: 'aoe_debuff',
        target: 'all_enemies',
        effect: { curse_stack: 1, damage_per_stack: 0.3 }
      },
      {
        id: 'dark_pact',
        name: 'Тёмный договор',
        description: 'Тратит 20% HP — следующая способность удваивается',
        manaCost: 0,
        cooldown: 5,
        type: 'self_buff',
        target: 'self',
        effect: { hp_cost: 0.2, next_ability_multiplier: 2.0 }
      }
    ],
    passive: {
      id: 'curse_explosion',
      name: 'Взрыв проклятий',
      description: 'При 3 стеках проклятия — автоматический взрыв (урон × 2)'
    }
  },

  shaman: {
    id: 'shaman',
    name: 'Шаман',
    description: 'Хил и поддержка. Духи помогают союзникам.',
    baseStats: { hp: 75, def: 20, atk: 45, mana: 110, spd: 50 },
    color: '#2ECC71',
    abilities: [
      {
        id: 'spirit_heal',
        name: 'Исцеление духов',
        description: 'Восстанавливает HP союзнику',
        manaCost: 20,
        cooldown: 0,
        type: 'heal',
        target: 'ally',
        effect: { heal: 1.2 }
      },
      {
        id: 'mana_restore',
        name: 'Поток маны',
        description: 'Восстанавливает ману всей команде',
        manaCost: 0,
        cooldown: 3,
        type: 'mana',
        target: 'all_allies',
        effect: { mana_restore: 25 }
      },
      {
        id: 'spirit_ward',
        name: 'Духи-хранители',
        description: 'Призывает духов — хилят всю команду 3 хода',
        manaCost: 40,
        cooldown: 5,
        type: 'aoe_heal',
        target: 'all_allies',
        effect: { heal_per_turn: 0.15, duration: 3 }
      }
    ],
    passive: {
      id: 'earth_spirits',
      name: 'Духи земли',
      description: 'Каждый ход восстанавливает 5 маны всем союзникам'
    }
  },

  berserker: {
    id: 'berserker',
    name: 'Берсерк',
    description: 'Чистый урон. Ярость растёт от получения урона.',
    baseStats: { hp: 100, def: 25, atk: 110, mana: 30, spd: 70 },
    color: '#E74C3C',
    abilities: [
      {
        id: 'rage_strike',
        name: 'Яростный удар',
        description: 'Сильный удар. Урон растёт с уровнем ярости',
        manaCost: 10,
        cooldown: 0,
        type: 'damage',
        target: 'enemy',
        effect: { damage: 1.2, rage_bonus: 0.1 } // +10% урона за каждый стек ярости
      },
      {
        id: 'armor_break',
        name: 'Сломать броню',
        description: 'Снижает DEF врага на 50% на 2 хода',
        manaCost: 15,
        cooldown: 3,
        type: 'debuff',
        target: 'enemy',
        effect: { def_reduction: 0.5, duration: 2 }
      },
      {
        id: 'berserker_rage',
        name: 'Берсерк-режим',
        description: 'Атакует всех врагов. Чем меньше HP — тем больше урон',
        manaCost: 20,
        cooldown: 4,
        type: 'aoe',
        target: 'all_enemies',
        effect: { damage: 0.9, low_hp_bonus: 2.0 } // х2 при HP < 30%
      }
    ],
    passive: {
      id: 'fury',
      name: 'Ярость',
      description: 'Получая урон накапливает ярость (макс 10 стеков). Каждый стек +10% ATK'
    }
  }
};

// Рассчитать реальные статы с учётом уровня и прокачки способностей
function getHeroStats(heroId, level, abilityLevels = [1, 1, 1]) {
  const hero = HEROES[heroId];
  if (!hero) return null;

  const levelBonus = 1 + (level - 1) * 0.04;
  const stats = {};
  for (const [key, val] of Object.entries(hero.baseStats)) {
    stats[key] = Math.floor(val * levelBonus);
  }

  // Способности с учётом прокачки
  const abilities = hero.abilities.map((ab, i) => {
    const abLevel = abilityLevels[i] || 1;
    const abBonus = 1 + (abLevel - 1) * 0.15; // +15% за каждый уровень способности
    return { ...ab, level: abLevel, effectBonus: abBonus };
  });

  return { ...hero, stats, abilities };
}

module.exports = { HEROES, getHeroStats };
