const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const db = require('./db');
const GameRoom = require('./GameRoom');
const { getActiveSkin, getHeroSkins } = require('./skins');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Очереди матчмейкинга по режиму
const queues = { '1v1': [], '2v2': [] };

// Активные комнаты
const rooms = {};

// REST API — получить или создать игрока
app.post('/api/player', (req, res) => {
  const { telegramId, username } = req.body;
  if (!telegramId) return res.status(400).json({ error: 'telegramId required' });

  let player = db.getPlayer(telegramId);
  if (!player) {
    player = db.createPlayer(telegramId, username || 'Unknown');
  }
  res.json(player);
});

// REST API — получить героя игрока
app.get('/api/player/:telegramId/hero', (req, res) => {
  const hero = db.getPlayerHero(req.params.telegramId);
  res.json(hero || null);
});

// REST API — выбрать героя
app.post('/api/player/:telegramId/hero', (req, res) => {
  const { heroId } = req.body;
  const result = db.setPlayerHero(req.params.telegramId, heroId);
  res.json(result);
});

// REST API — получить все скины героя
app.get('/api/player/:telegramId/skins/:heroId', (req, res) => {
  const { telegramId, heroId } = req.params;
  const hero = db.getPlayerHeroById(telegramId, heroId);
  if (!hero) return res.json([]);
  const owned = db.getOwnedSkins(telegramId, heroId);
  const skins = getHeroSkins(heroId, hero.level, owned);
  res.json(skins);
});

// REST API — экипировать скин
app.post('/api/player/:telegramId/skin', (req, res) => {
  const { heroId, skinId } = req.body;
  const result = db.equipSkin(req.params.telegramId, heroId, skinId);
  res.json(result);
});

// REST API — прокачать способность
app.post('/api/player/:telegramId/upgrade', (req, res) => {
  const { abilityIndex } = req.body;
  const result = db.upgradeAbility(req.params.telegramId, abilityIndex);
  res.json(result);
});

// REST API — получить активный скин
app.get('/api/player/:telegramId/active-skin/:heroId', (req, res) => {
  const { telegramId, heroId } = req.params;
  const hero = db.getPlayerHeroById(telegramId, heroId);
  if (!hero) return res.json(null);
  const skin = getActiveSkin(heroId, hero.level, hero.skin_id);
  res.json(skin);
});

// Socket.io
io.on('connection', (socket) => {
  console.log('Подключился:', socket.id);

  // Игрок входит в матчмейкинг
  socket.on('joinQueue', ({ telegramId, mode = '2v2' }) => {
    const player = db.getPlayer(telegramId);
    if (!player) return socket.emit('error', 'Игрок не найден');

    const hero = db.getPlayerHero(telegramId);
    if (!hero) return socket.emit('error', 'Герой не выбран');

    const validMode = mode === '1v1' ? '1v1' : '2v2';
    const queue = queues[validMode];

    // Убрать из всех очередей если уже был
    queues['1v1'] = queues['1v1'].filter(q => q.socketId !== socket.id);
    queues['2v2'] = queues['2v2'].filter(q => q.socketId !== socket.id);

    const entry = { socketId: socket.id, telegramId, heroId: hero.hero_id, username: player.username, level: hero.level, mode: validMode };
    queue.push(entry);
    socket.data.mode = validMode;

    socket.emit('queueJoined', { position: queue.length, mode: validMode, required: validMode === '1v1' ? 2 : 4 });
    console.log(`Очередь ${validMode}: ${queue.length}`);

    const required = validMode === '1v1' ? 2 : 4;

    if (queue.length >= required) {
      const players = queue.splice(0, required);
      const roomId = `room_${Date.now()}`;
      const room = new GameRoom(roomId, players, io, validMode);
      rooms[roomId] = room;

      players.forEach(p => {
        const playerSocket = io.sockets.sockets.get(p.socketId);
        if (playerSocket) {
          playerSocket.join(roomId);
          playerSocket.data.roomId = roomId;
          playerSocket.data.telegramId = p.telegramId;
        }
      });

      room.start();
    }
  });

  // Игрок выбирает способность
  socket.on('useAbility', ({ abilityIndex }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    rooms[roomId].playerAction(socket.data.telegramId, abilityIndex);
  });

  // Покинуть очередь
  socket.on('leaveQueue', () => {
    queues['1v1'] = queues['1v1'].filter(q => q.socketId !== socket.id);
    queues['2v2'] = queues['2v2'].filter(q => q.socketId !== socket.id);
  });

  socket.on('disconnect', () => {
    queues['1v1'] = queues['1v1'].filter(q => q.socketId !== socket.id);
    queues['2v2'] = queues['2v2'].filter(q => q.socketId !== socket.id);
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].playerDisconnected(socket.data.telegramId);
    }
    console.log('Отключился:', socket.id);
  });
});

// Удалить комнату после завершения
function cleanupRoom(roomId) {
  delete rooms[roomId];
}
global.cleanupRoom = cleanupRoom;

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
