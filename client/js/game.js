// Главный игровой клиент

const tg = window.Telegram?.WebApp;
if (tg) { tg.expand(); tg.setHeaderColor('#0d0d0d'); }

// Telegram user данные
const DARK_NAMES = [
  'Азраэль', 'Морвен', 'Кайрон', 'Зарин', 'Лютар',
  'Севира', 'Дракос', 'Нирайя', 'Вортан', 'Эльдрис',
  'Малгор', 'Ксарина', 'Торвал', 'Диаса', 'Кревис'
];

function getOrCreateBrowserUser() {
  let stored = localStorage.getItem('eredum_user');
  if (stored) return JSON.parse(stored);
  const name = DARK_NAMES[Math.floor(Math.random() * DARK_NAMES.length)];
  const user = { id: 'browser_' + Math.random().toString(36).slice(2), first_name: name };
  localStorage.setItem('eredum_user', JSON.stringify(user));
  return user;
}

const telegramUser = tg?.initDataUnsafe?.user || getOrCreateBrowserUser();

let socket;
let player = null;
let selectedHeroId = null;
let currentHero = null;
let battleState = {};
let myTeam = null;
let timerInterval = null;
let selectedAbility = null;
let roundReady = false;
let selectedMode = '1v1';

// CSS аватар героя
function heroAvatar(heroId, size = '') {
  const sizeClass = size ? `hero-avatar-${size}` : '';
  return `<div class="hero-avatar ${sizeClass}">
    <div class="avatar-${heroId}">
      <div class="glow"></div>
      <div class="body"></div>
      <div class="head"></div>
      ${heroId === 'paladin' ? '<div class="shield"></div>' : ''}
      ${heroId === 'witch' ? '<div class="hat"></div><div class="orb"></div><div class="particles"></div>' : ''}
      ${heroId === 'shaman' ? '<div class="staff"></div><div class="aura"></div>' : ''}
      ${heroId === 'berserker' ? '<div class="axe"></div><div class="rage-aura"></div>' : ''}
    </div>
  </div>`;
}

// Показать экран
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}

// Инициализация
async function init() {
  showScreen('loading');

  try {
    const res = await fetch('/api/player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: String(telegramUser.id), username: telegramUser.first_name })
    });
    player = await res.json();

    // Проверить выбранного героя
    const heroRes = await fetch(`/api/player/${player.telegram_id}/hero`);
    currentHero = await heroRes.json();

    initSocket();

    if (!currentHero) {
      showHeroSelect();
    } else {
      showMenu();
    }
  } catch (e) {
    console.error(e);
    document.querySelector('#screen-loading .loader').style.display = 'none';
    document.querySelector('#screen-loading .subtitle').textContent = 'Ошибка подключения';
  }
}

// Socket.io
function initSocket() {
  socket = io();

  socket.on('queueJoined', ({ position, mode, required }) => {
    updateQueueSlots(position, required);
  });

  socket.on('playerReady', ({ telegramId, username }) => {
    // Показать что игрок выбрал способность
    const card = document.querySelector(`[data-tid="${telegramId}"]`);
    if (card) card.classList.add('ready-indicator');
  });

  socket.on('gameStart', (data) => {
    clearTimeout(window.queueTimeout);
    showBattle(data);
  });

  socket.on('turnStart', (data) => {
    updateBattleUI(data);
    startTimer(30);
    roundReady = false;
    selectedAbility = null;
    document.getElementById('waiting-msg').style.display = 'none';
    document.querySelectorAll('.fighter-card').forEach(c => c.classList.remove('ready-indicator'));

    // Блокируем способности если игрок мёртв
    const me = data.state[player.telegram_id];
    if (me && me.hp <= 0) {
      enableAbilities(false);
      document.getElementById('waiting-msg').style.display = 'block';
      document.getElementById('waiting-msg').textContent = '💀 Ты пал в бою...';
    } else {
      enableAbilities(true);
    }
  });

  socket.on('turnEnd', (data) => {
    updateBattleUI(data);
  });

  socket.on('gameOver', (data) => {
    clearInterval(timerInterval);
    showResult(data);
  });

  socket.on('abilityError', (msg) => {
    showToast(msg);
  });

  socket.on('error', (msg) => {
    showToast(msg);
  });
}

// --- ЭКРАН ВЫБОРА ГЕРОЯ ---
function showHeroSelect() {
  const grid = document.getElementById('hero-grid');
  grid.innerHTML = '';

  Object.values(HEROES).forEach(hero => {
    const card = document.createElement('div');
    card.className = 'hero-card';
    card.innerHTML = `
      ${heroAvatar(hero.id)}
      <div class="hero-card-name" style="color:${hero.color}">${hero.name}</div>
      <div class="hero-card-role">${hero.role}</div>
    `;
    card.addEventListener('click', () => selectHero(hero.id, card));
    grid.appendChild(card);
  });

  document.getElementById('btn-select-hero').addEventListener('click', confirmHeroSelect);
  showScreen('hero-select');
}

function selectHero(heroId, card) {
  selectedHeroId = heroId;
  document.querySelectorAll('.hero-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');

  const hero = HEROES[heroId];
  const detail = document.getElementById('hero-detail');
  detail.className = 'hero-detail filled';
  detail.innerHTML = `
    <strong style="color:${hero.color}">${hero.name}</strong><br>
    ${hero.description}<br><br>
    <strong>Пассивка:</strong> ${hero.passive.icon} ${hero.passive.name} — ${hero.passive.desc}
  `;

  document.getElementById('btn-select-hero').disabled = false;
}

async function confirmHeroSelect() {
  if (!selectedHeroId) return;
  const res = await fetch(`/api/player/${player.telegram_id}/hero`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ heroId: selectedHeroId })
  });
  currentHero = await res.json();
  showMenu();
}

// --- ГЛАВНОЕ МЕНЮ ---
function showMenu() {
  const hero = HEROES[currentHero.hero_id];
  const xpToLevel = currentHero.level * 150;
  const xpPercent = Math.min(100, Math.floor((currentHero.xp / xpToLevel) * 100));

  document.getElementById('menu-username').textContent = player.username;
  document.getElementById('menu-hero-name').textContent = hero.name;
  document.getElementById('menu-level').textContent = `Ур. ${currentHero.level}`;
  document.getElementById('menu-hero-display').innerHTML = heroAvatar(currentHero.hero_id, 'large');

  document.getElementById('xp-bar').style.width = xpPercent + '%';
  document.getElementById('xp-label').textContent = `${currentHero.xp} / ${xpToLevel} XP`;

  document.getElementById('menu-stats').innerHTML = `
    <div class="stat-box"><div class="stat-value">${player.wins}</div><div class="stat-label">Побед</div></div>
    <div class="stat-box"><div class="stat-value">${player.losses || 0}</div><div class="stat-label">Поражений</div></div>
    <div class="stat-box"><div class="stat-value">${currentHero.level}</div><div class="stat-label">Уровень</div></div>
  `;

  document.getElementById('wins-info').textContent =
    player.wins + player.losses > 0
      ? `Винрейт: ${Math.floor((player.wins / (player.wins + player.losses)) * 100)}%`
      : 'Ещё не играл';

  // Кнопки режима
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMode = btn.dataset.mode;
    });
  });

  document.getElementById('btn-upgrade').onclick = showUpgrade;
  document.getElementById('btn-shop').onclick = showShop;
  document.getElementById('btn-pvp').onclick = joinQueue;
  document.getElementById('btn-change-hero').onclick = () => {
    selectedHeroId = null;
    showHeroSelect();
  };

  showScreen('menu');
}

// --- ПРОКАЧКА ---
async function showUpgrade() {
  const hero = HEROES[currentHero.hero_id];

  document.getElementById('upgrade-hero-display').innerHTML = heroAvatar(currentHero.hero_id, 'large');
  document.getElementById('upgrade-shards').textContent = `⚫ ${player.shards || 0} осколков`;

  const abilitiesEl = document.getElementById('upgrade-abilities');
  abilitiesEl.innerHTML = '';

  const abilityKeys = ['ability1_level', 'ability2_level', 'ability3_level'];

  hero.abilities.forEach((ab, i) => {
    const currentLevel = currentHero[abilityKeys[i]] || 1;
    const maxLevel = 5;
    const cost = currentLevel * 50;
    const canAfford = (player.shards || 0) >= cost;
    const isMax = currentLevel >= maxLevel;

    const card = document.createElement('div');
    card.className = 'upgrade-card';
    card.innerHTML = `
      <div class="upgrade-card-left">
        <div class="upgrade-ability-icon">${ab.icon}</div>
        <div class="upgrade-ability-info">
          <div class="upgrade-ability-name">${ab.name}</div>
          <div class="upgrade-ability-desc">${ab.desc}</div>
          <div class="upgrade-level-dots">
            ${Array.from({length: maxLevel}, (_, j) =>
              `<div class="level-dot ${j < currentLevel ? 'filled' : ''}"></div>`
            ).join('')}
          </div>
        </div>
      </div>
      <div class="upgrade-card-right">
        <div class="upgrade-level-badge">Ур. ${currentLevel}</div>
        ${isMax
          ? `<div class="upgrade-max">МАКС</div>`
          : `<button class="upgrade-btn ${canAfford ? '' : 'cant-afford'}" data-index="${i}">
              ${canAfford ? `⬆️ ${cost}⚫` : `🔒 ${cost}⚫`}
            </button>`
        }
      </div>
    `;
    abilitiesEl.appendChild(card);
  });

  // Пассивка
  document.getElementById('upgrade-passive').innerHTML = `
    <div class="passive-info">
      <span class="passive-icon">${hero.passive.icon}</span>
      <div>
        <div class="passive-name">${hero.passive.name}</div>
        <div class="passive-desc">${hero.passive.desc}</div>
      </div>
    </div>
  `;

  // Обработчики кнопок прокачки
  abilitiesEl.querySelectorAll('.upgrade-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const index = parseInt(btn.dataset.index);
      const res = await fetch(`/api/player/${player.telegram_id}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ abilityIndex: index })
      });
      const result = await res.json();
      if (result.error) {
        showToast(result.error);
      } else {
        showToast(`✅ Прокачано до уровня ${result.newLevel}!`);
        // Обновляем данные
        currentHero = await (await fetch(`/api/player/${player.telegram_id}/hero`)).json();
        player = await (await fetch('/api/player', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telegramId: player.telegram_id, username: player.username })
        })).json();
        showUpgrade();
      }
    });
  });

  document.getElementById('btn-back-upgrade').onclick = showMenu;
  showScreen('upgrade');
}

// --- МАГАЗИН ---
let shopData = null;
let ownedData = null;
let activeShopTab = 'skins';

async function showShop() {
  document.getElementById('btn-back-shop').onclick = showMenu;

  // Загрузить данные магазина и купленного
  [shopData, ownedData] = await Promise.all([
    fetch('/api/shop').then(r => r.json()),
    fetch(`/api/player/${player.telegram_id}/owned-items`).then(r => r.json())
  ]);

  // Обновить баланс Stars в шапке
  document.getElementById('shop-stars').textContent = `⭐ ${player.stars || 0}`;

  // Переключение вкладок
  document.querySelectorAll('.shop-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.shop-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeShopTab = tab.dataset.tab;
      renderShopItems();
    };
  });

  renderShopItems();
  showScreen('shop');
}

function renderShopItems() {
  const container = document.getElementById('shop-items');
  container.innerHTML = '';

  const items = shopData[activeShopTab] || [];

  items.forEach(item => {
    const isOwned = activeShopTab === 'skins'
      ? (ownedData.skins[item.heroId] || []).includes(item.id)
      : ownedData.effects.includes(item.id);

    const heroInfo = item.heroId ? HEROES[item.heroId] : null;

    const card = document.createElement('div');
    card.className = 'shop-item-card' + (isOwned ? ' owned' : '');
    card.innerHTML = `
      <div class="shop-item-preview">${item.preview}</div>
      <div class="shop-item-info">
        <div class="shop-item-name">${item.name}</div>
        ${heroInfo ? `<div class="shop-item-hero" style="color:${heroInfo.color}">${heroInfo.icon} ${heroInfo.name}</div>` : ''}
        <div class="shop-item-desc">${item.description}</div>
      </div>
      <div class="shop-item-action">
        ${isOwned
          ? `<div class="shop-owned-badge">✓ Есть</div>`
          : `<button class="shop-buy-btn" data-id="${item.id}">⭐ ${item.price}</button>`
        }
      </div>
    `;
    container.appendChild(card);
  });

  // Обработчики кнопок покупки
  container.querySelectorAll('.shop-buy-btn').forEach(btn => {
    btn.addEventListener('click', () => purchaseItem(btn.dataset.id, btn));
  });
}

async function purchaseItem(itemId, btn) {
  btn.disabled = true;
  btn.textContent = '...';

  // В Telegram — используем openInvoice если доступно
  // Сейчас: прямая покупка через сервер (тест-режим)
  try {
    const res = await fetch(`/api/player/${player.telegram_id}/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId })
    });
    const result = await res.json();

    if (result.error) {
      showToast('❌ ' + result.error);
      btn.disabled = false;
      btn.textContent = '⭐ ' + shopData[activeShopTab].find(i => i.id === itemId)?.price;
    } else {
      showToast('✅ Куплено!');
      // Обновить owned данные
      ownedData = await fetch(`/api/player/${player.telegram_id}/owned-items`).then(r => r.json());
      renderShopItems();
    }
  } catch (e) {
    showToast('❌ Ошибка покупки');
    btn.disabled = false;
  }
}

// --- ОЧЕРЕДЬ ---
function joinQueue() {
  showScreen('queue');
  document.getElementById('queue-hero-icon').innerHTML = heroAvatar(currentHero.hero_id);

  const modeLabel = selectedMode === '1v1' ? '1 на 1' : '2 на 2';
  document.getElementById('queue-status').textContent = `Режим: ${modeLabel} — ищем...`;

  document.getElementById('btn-leave-queue').onclick = () => {
    socket.emit('leaveQueue');
    showMenu();
  };

  const required = selectedMode === '1v1' ? 2 : 4;
  updateQueueSlots(0, required);
  socket.emit('joinQueue', { telegramId: player.telegram_id, heroId: currentHero.hero_id, mode: selectedMode });
}

function updateQueueSlots(count, required = 4) {
  const container = document.getElementById('queue-players');
  container.innerHTML = '';
  for (let i = 0; i < required; i++) {
    const slot = document.createElement('div');
    slot.className = 'queue-slot' + (i < count ? ' filled' : '');
    slot.textContent = i < count ? '✓' : '?';
    container.appendChild(slot);
  }
  const modeLabel = required === 2 ? '1 на 1' : '2 на 2';
  document.getElementById('queue-status').textContent = `${modeLabel}: ${count}/${required} игроков`;
}

// --- БОЙ ---
function showBattle(data) {
  battleState = data.state;

  // Определить мою команду
  myTeam = battleState[player.telegram_id]?.team;

  renderFighters();
  renderAbilities();
  updateBattleLog([]);

  document.getElementById('battle-turn').textContent = `Ход ${data.turn}`;
  startTimer(30);

  showScreen('battle');
}

function updateBattleUI(data) {
  const prevState = { ...battleState };
  battleState = data.state;
  document.getElementById('battle-turn').textContent = `Ход ${data.turn}`;

  // Анимируем изменения HP перед рендером
  Object.values(battleState).forEach(f => {
    const prev = prevState[f.telegramId];
    if (prev && prev.hp > f.hp && f.hp >= 0) {
      const dmg = prev.hp - f.hp;
      scheduleHitAnimation(f.telegramId, dmg);
    }
    if (prev && prev.hp < f.hp) {
      scheduleHealAnimation(f.telegramId, f.hp - prev.hp);
    }
  });

  renderFighters();
  if (data.log) updateBattleLog(data.log);
}

function scheduleHitAnimation(tid, dmg) {
  setTimeout(() => {
    const card = document.querySelector(`[data-tid="${tid}"]`);
    if (!card) return;
    card.classList.add('hit-flash');
    setTimeout(() => card.classList.remove('hit-flash'), 400);
    showFloatingText(card, `-${dmg}`, 'dmg-float');
  }, 100);
}

function scheduleHealAnimation(tid, amount) {
  setTimeout(() => {
    const card = document.querySelector(`[data-tid="${tid}"]`);
    if (!card) return;
    card.classList.add('heal-flash');
    setTimeout(() => card.classList.remove('heal-flash'), 400);
    showFloatingText(card, `+${amount}`, 'heal-float');
  }, 100);
}

function showFloatingText(card, text, cls) {
  const el = document.createElement('div');
  el.className = `floating-text ${cls}`;
  el.textContent = text;
  card.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

function renderFighters() {
  const enemies = Object.values(battleState).filter(f => f.team !== myTeam);
  const allies = Object.values(battleState).filter(f => f.team === myTeam);

  renderFighterRow('enemy-fighters', enemies, false);
  renderFighterRow('ally-fighters', allies, true);
}

function renderFighterRow(containerId, fighters, isAlly) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  fighters.forEach(f => {
    const hero = HEROES[f.heroId];
    const hpPct = Math.max(0, Math.floor((f.hp / f.maxHp) * 100));
    const manaPct = Math.max(0, Math.floor((f.mana / f.maxMana) * 100));
    const isMe = f.telegramId === player.telegram_id;

    const card = document.createElement('div');
    card.className = 'fighter-card' + (f.hp <= 0 ? ' dead' : '') + (f.ready ? ' ready-indicator' : '');
    card.dataset.tid = f.telegramId;
    if (hero?.color) card.style.borderColor = f.hp > 0 ? hero.color + '55' : '';

    const statusIcons = [];
    if (f.stunned > 0) statusIcons.push('<span title="Оглушён">😵</span>');
    if (f.barrier > 0) statusIcons.push(`<span title="Барьер">🛡${f.barrier}</span>`);
    if (f.rage > 0) statusIcons.push(`<span title="Ярость">😤${f.rage}</span>`);

    const hpColor = hpPct > 50 ? 'var(--green)' : hpPct > 25 ? 'var(--gold)' : 'var(--accent)';

    card.innerHTML = `
      ${isMe ? '<div class="me-badge">ТЫ</div>' : ''}
      ${hero ? heroAvatar(hero.id, 'battle') : '<div class="fighter-icon">?</div>'}
      <div class="fighter-name">${f.username}</div>
      <div class="hp-bar-wrap">
        <div class="hp-bar" style="width:${hpPct}%;background:${hpColor}"></div>
      </div>
      <div class="hp-text">${f.hp}/${f.maxHp}</div>
      <div class="mana-bar-wrap">
        <div class="mana-bar" style="width:${manaPct}%"></div>
      </div>
      <div class="status-icons">${statusIcons.join('')}</div>
    `;
    container.appendChild(card);
  });
}

function renderAbilities() {
  const hero = HEROES[currentHero.hero_id];
  const grid = document.getElementById('abilities-grid');
  grid.innerHTML = '';

  const abilityIcons = hero.abilities.map((ab, i) => {
    const btn = document.createElement('button');
    btn.className = 'ability-btn';
    btn.dataset.index = i;
    btn.innerHTML = `
      <span class="ability-icon">${ab.icon}</span>
      <div class="ability-info">
        <div class="ability-name">${ab.name}</div>
        <div class="ability-desc">${ab.desc}</div>
      </div>
      <span class="ability-cost">${ab.manaCost > 0 ? ab.manaCost + ' 💧' : 'Бесплатно'}</span>
    `;
    btn.addEventListener('click', () => useAbility(i, btn));
    grid.appendChild(btn);
    return btn;
  });
}

function useAbility(index, btn) {
  if (roundReady) return;
  roundReady = true;
  selectedAbility = index;

  document.querySelectorAll('.ability-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');

  enableAbilities(false);
  document.getElementById('waiting-msg').style.display = 'block';

  socket.emit('useAbility', { abilityIndex: index });
}

function enableAbilities(enabled) {
  document.querySelectorAll('.ability-btn').forEach(btn => {
    btn.disabled = !enabled;
  });
}

function updateBattleLog(lines) {
  const log = document.getElementById('battle-log');
  log.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  log.scrollTop = log.scrollHeight;
}

function startTimer(seconds) {
  clearInterval(timerInterval);
  let t = seconds;
  const el = document.getElementById('battle-timer');
  el.textContent = t;
  el.classList.remove('urgent');

  timerInterval = setInterval(() => {
    t--;
    el.textContent = t;
    if (t <= 10) el.classList.add('urgent');
    if (t <= 0) clearInterval(timerInterval);
  }, 1000);
}

// --- РЕЗУЛЬТАТ ---
async function showResult(data) {
  const isWinner = data.winners.includes(player.telegram_id);
  const myResult = data.results?.[player.telegram_id];

  // Обновить данные игрока
  const res = await fetch(`/api/player/${player.telegram_id}/hero`);
  currentHero = await res.json();
  const pRes = await fetch('/api/player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramId: player.telegram_id, username: player.username })
  });
  player = await pRes.json();

  const xpToLevel = currentHero.level * 150;
  const xpPercent = Math.min(100, Math.floor((currentHero.xp / xpToLevel) * 100));
  const xpGained = isWinner ? 100 : 25;

  // Победители и проигравшие
  const finalState = data.finalState || {};
  const winnerNames = data.winners.map(tid => finalState[tid]?.username || '?');
  const loserNames = data.losers.map(tid => finalState[tid]?.username || '?');

  const titleEl = document.getElementById('result-title');
  titleEl.className = 'result-title ' + (isWinner ? 'win' : 'lose');
  titleEl.innerHTML = isWinner ? '🏆 ПОБЕДА!' : '💀 ПОРАЖЕНИЕ';

  const rewardsEl = document.getElementById('result-rewards');
  rewardsEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:14px">
      <div style="text-align:center;flex:1">
        <div style="font-size:11px;color:var(--text2);margin-bottom:4px">ПОБЕДИТЕЛИ</div>
        ${winnerNames.map(n => `<div style="color:var(--gold);font-weight:700">${n}</div>`).join('')}
      </div>
      <div style="font-size:24px;align-self:center">⚔️</div>
      <div style="text-align:center;flex:1">
        <div style="font-size:11px;color:var(--text2);margin-bottom:4px">ПРОИГРАВШИЕ</div>
        ${loserNames.map(n => `<div style="color:var(--accent)">${n}</div>`).join('')}
      </div>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:12px">
      <div style="font-size:13px;color:var(--text2);margin-bottom:6px">Твой герой: ${HEROES[currentHero.hero_id]?.icon} ${HEROES[currentHero.hero_id]?.name} — Ур. ${currentHero.level}</div>
      <div style="display:flex;gap:16px;justify-content:center;margin-bottom:8px">
      <div style="font-size:18px;color:var(--green);font-weight:700">+${xpGained} XP</div>
      <div style="font-size:18px;color:#aaa;font-weight:700">+${isWinner ? 30 : 10} ⚫</div>
    </div>
      ${myResult?.levelUp ? '<div class="level-up-notice">🎉 НОВЫЙ УРОВЕНЬ!</div>' : ''}
      <div class="xp-bar-wrap" style="margin:8px 0">
        <div class="xp-bar" style="width:${xpPercent}%"></div>
        <span id="xp-label">${currentHero.xp} / ${xpToLevel} XP</span>
      </div>
      <div style="display:flex;justify-content:center;gap:20px;margin-top:10px;font-size:13px">
        <div>🏆 Побед: <strong style="color:var(--gold)">${player.wins}</strong></div>
        <div>💀 Поражений: <strong style="color:var(--accent)">${player.losses || 0}</strong></div>
        <div>📊 Винрейт: <strong>${player.wins + (player.losses||0) > 0 ? Math.floor(player.wins/(player.wins+(player.losses||0))*100) : 0}%</strong></div>
      </div>
    </div>
  `;

  const logEl = document.getElementById('result-log');
  logEl.innerHTML = `
    <div style="font-size:11px;color:var(--text2);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">Лог боя</div>
    ${(data.log || []).map(l => `<div>${l}</div>`).join('')}
  `;

  document.getElementById('btn-play-again').onclick = () => showMenu();

  showScreen('result');
}

// Тост уведомления
function showToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
    background:#333; color:#fff; padding:10px 20px; border-radius:20px;
    font-size:13px; z-index:9999; animation:fadeIn 0.3s;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// Старт
init();
