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

  socket.on('queueJoined', ({ position }) => {
    updateQueueSlots(position);
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
    enableAbilities(true);
    document.getElementById('waiting-msg').style.display = 'none';
    document.querySelectorAll('.fighter-card').forEach(c => c.classList.remove('ready-indicator'));
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
      <div class="hero-icon">${hero.icon}</div>
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
  document.getElementById('menu-hero-display').textContent = hero.icon;

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

  document.getElementById('btn-pvp').onclick = joinQueue;
  document.getElementById('btn-change-hero').onclick = () => {
    selectedHeroId = null;
    showHeroSelect();
  };

  showScreen('menu');
}

// --- ОЧЕРЕДЬ ---
function joinQueue() {
  showScreen('queue');
  document.getElementById('queue-hero-icon').textContent = HEROES[currentHero.hero_id].icon;
  document.getElementById('queue-status').textContent = 'Ищем игроков...';

  document.getElementById('btn-leave-queue').onclick = () => {
    socket.emit('leaveQueue');
    showMenu();
  };

  updateQueueSlots(0);
  socket.emit('joinQueue', { telegramId: player.telegram_id, heroId: currentHero.hero_id });
}

function updateQueueSlots(count) {
  const slots = document.querySelectorAll('.queue-slot');
  slots.forEach((slot, i) => {
    if (i < count) {
      slot.classList.add('filled');
      slot.textContent = '✓';
    } else {
      slot.classList.remove('filled');
      slot.textContent = '?';
    }
  });
  document.getElementById('queue-status').textContent = `Игроков: ${count}/4`;
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
  battleState = data.state;
  document.getElementById('battle-turn').textContent = `Ход ${data.turn}`;
  renderFighters();
  if (data.log) updateBattleLog(data.log);
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

    const statusIcons = [];
    if (f.stunned > 0) statusIcons.push('😵');
    if (f.barrier > 0) statusIcons.push('🛡');
    if (f.rage > 0) statusIcons.push(`😤${f.rage}`);

    card.innerHTML = `
      ${f.barrier > 0 ? `<div class="barrier-badge">🛡</div>` : ''}
      <div class="fighter-icon">${hero?.icon || '?'}</div>
      <div class="fighter-name">${isMe ? '(Ты) ' : ''}${f.username}</div>
      <div class="hp-bar-wrap">
        <div class="hp-bar ${hpPct < 30 ? 'low' : ''}" style="width:${hpPct}%"></div>
      </div>
      <div class="hp-text">${f.hp}/${f.maxHp}</div>
      <div class="mana-bar-wrap">
        <div class="mana-bar" style="width:${manaPct}%"></div>
      </div>
      <div class="status-icons">${statusIcons.join(' ')}</div>
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
      <div style="font-size:18px;color:var(--green);font-weight:700;margin-bottom:8px">+${xpGained} XP</div>
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
