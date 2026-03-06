// Конфигурация скинов всех героев
// Чтобы добавить новый скин — просто добавь запись сюда и положи картинки в папку

const SKINS = {
  witch: {
    default: {
      id: 'default',
      name: 'Лесная Ведьма',
      frames: 4,
      path: '/assets/heroes/witch/default',
      unlockType: 'default',
      price: 0
    },
    level10: {
      id: 'level10',
      name: 'Ведьма Тьмы',
      frames: 4,
      path: '/assets/heroes/witch/level10',
      unlockType: 'level',
      unlockLevel: 10,
      price: 0
    },
    level25: {
      id: 'level25',
      name: 'Архиведьма',
      frames: 4,
      path: '/assets/heroes/witch/level25',
      unlockType: 'level',
      unlockLevel: 25,
      price: 0
    },
    level50: {
      id: 'level50',
      name: 'Повелительница Бездны',
      frames: 4,
      path: '/assets/heroes/witch/level50',
      unlockType: 'level',
      unlockLevel: 50,
      price: 0,
      legendary: true
    }
    // Скины за Stars добавляются так:
    // skin_shadow: {
    //   id: 'skin_shadow',
    //   name: 'Теневая Ведьма',
    //   frames: 4,
    //   path: '/assets/heroes/witch/skin_shadow',
    //   unlockType: 'stars',
    //   price: 50
    // }
  },
  paladin: {
    default: {
      id: 'default',
      name: 'Паладин Света',
      frames: 4,
      path: '/assets/heroes/paladin/default',
      unlockType: 'default',
      price: 0
    },
    level10: {
      id: 'level10',
      name: 'Рыцарь Угасшего Света',
      frames: 4,
      path: '/assets/heroes/paladin/level10',
      unlockType: 'level',
      unlockLevel: 10,
      price: 0
    },
    level25: {
      id: 'level25',
      name: 'Страж Бездны',
      frames: 4,
      path: '/assets/heroes/paladin/level25',
      unlockType: 'level',
      unlockLevel: 25,
      price: 0
    },
    level50: {
      id: 'level50',
      name: 'Последний Паладин',
      frames: 4,
      path: '/assets/heroes/paladin/level50',
      unlockType: 'level',
      unlockLevel: 50,
      price: 0,
      legendary: true
    }
  },
  shaman: {
    default: {
      id: 'default',
      name: 'Шаман Духов',
      frames: 4,
      path: '/assets/heroes/shaman/default',
      unlockType: 'default',
      price: 0
    },
    level10: {
      id: 'level10',
      name: 'Старший Шаман',
      frames: 4,
      path: '/assets/heroes/shaman/level10',
      unlockType: 'level',
      unlockLevel: 10,
      price: 0
    },
    level25: {
      id: 'level25',
      name: 'Голос Земли',
      frames: 4,
      path: '/assets/heroes/shaman/level25',
      unlockType: 'level',
      unlockLevel: 25,
      price: 0
    },
    level50: {
      id: 'level50',
      name: 'Дух Эредума',
      frames: 4,
      path: '/assets/heroes/shaman/level50',
      unlockType: 'level',
      unlockLevel: 50,
      price: 0,
      legendary: true
    }
  },
  berserker: {
    default: {
      id: 'default',
      name: 'Берсерк',
      frames: 4,
      path: '/assets/heroes/berserker/default',
      unlockType: 'default',
      price: 0
    },
    level10: {
      id: 'level10',
      name: 'Воин Крови',
      frames: 4,
      path: '/assets/heroes/berserker/level10',
      unlockType: 'level',
      unlockLevel: 10,
      price: 0
    },
    level25: {
      id: 'level25',
      name: 'Одержимый',
      frames: 4,
      path: '/assets/heroes/berserker/level25',
      unlockType: 'level',
      unlockLevel: 25,
      price: 0
    },
    level50: {
      id: 'level50',
      name: 'Дитя Хаоса',
      frames: 4,
      path: '/assets/heroes/berserker/level50',
      unlockType: 'level',
      unlockLevel: 50,
      price: 0,
      legendary: true
    }
  }
};

// Получить активный скин для героя с учётом уровня
function getActiveSkin(heroId, level, equippedSkinId = 'default') {
  const heroSkins = SKINS[heroId];
  if (!heroSkins) return null;

  // Если экипирован купленный скин — возвращаем его
  if (equippedSkinId !== 'default' && heroSkins[equippedSkinId]) {
    return heroSkins[equippedSkinId];
  }

  // Иначе — лучший разблокированный по уровню
  const levelSkins = [
    { id: 'level50', req: 50 },
    { id: 'level25', req: 25 },
    { id: 'level10', req: 10 }
  ];

  for (const s of levelSkins) {
    if (level >= s.req && heroSkins[s.id]) return heroSkins[s.id];
  }

  return heroSkins.default;
}

// Получить все скины героя с флагом разблокировки
function getHeroSkins(heroId, level, ownedSkinIds = []) {
  const heroSkins = SKINS[heroId];
  if (!heroSkins) return [];

  return Object.values(heroSkins).map(skin => ({
    ...skin,
    unlocked: skin.unlockType === 'default' ||
              (skin.unlockType === 'level' && level >= skin.unlockLevel) ||
              (skin.unlockType === 'stars' && ownedSkinIds.includes(skin.id))
  }));
}

// Товары магазина за Telegram Stars
const SHOP_ITEMS = {
  skins: [
    {
      id: 'witch_shadow',
      heroId: 'witch',
      name: 'Теневая Ведьма',
      description: 'Ведьма из царства теней',
      price: 50,
      type: 'skin',
      preview: '🌑'
    },
    {
      id: 'witch_blood',
      heroId: 'witch',
      name: 'Кровавая Ведьма',
      description: 'Пропитана кровью врагов',
      price: 75,
      type: 'skin',
      preview: '🩸'
    },
    {
      id: 'paladin_dark',
      heroId: 'paladin',
      name: 'Тёмный Паладин',
      description: 'Служит не свету а тьме',
      price: 50,
      type: 'skin',
      preview: '⬛'
    },
    {
      id: 'paladin_gold',
      heroId: 'paladin',
      name: 'Золотой Страж',
      description: 'Последний из золотых паладинов',
      price: 100,
      type: 'skin',
      preview: '👑'
    },
    {
      id: 'shaman_spirit',
      heroId: 'shaman',
      name: 'Дух Предков',
      description: 'Полупрозрачный — между миром живых и мёртвых',
      price: 50,
      type: 'skin',
      preview: '👻'
    },
    {
      id: 'berserker_demon',
      heroId: 'berserker',
      name: 'Демон Хаоса',
      description: 'Ярость поглотила человека полностью',
      price: 75,
      type: 'skin',
      preview: '😈'
    }
  ],
  effects: [
    {
      id: 'effect_fire',
      name: 'Огненный след',
      description: 'Способности оставляют огненный след',
      price: 30,
      type: 'effect',
      preview: '🔥'
    },
    {
      id: 'effect_void',
      name: 'Пустота',
      description: 'Чёрные дыры при каждом ударе',
      price: 40,
      type: 'effect',
      preview: '🌀'
    },
    {
      id: 'effect_lightning',
      name: 'Молния',
      description: 'Электрические разряды вокруг героя',
      price: 35,
      type: 'effect',
      preview: '⚡'
    }
  ]
};

module.exports = { SKINS, SHOP_ITEMS, getActiveSkin, getHeroSkins };
