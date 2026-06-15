/**
 * badth-overlay-server
 * ---------------------------------------------------------
 * 1) Connects to a TikTok LIVE room (by @username) using
 *    tiktok-live-connector.
 * 2) Listens for gifts, follows, likes, chat, shares, subs.
 * 3) Broadcasts those events over WebSocket to any connected
 *    overlay page (overlay.html), which then plays the
 *    matching effect video.
 *
 * One server instance can host MULTIPLE rooms/clients at once.
 * Each browser overlay connects with: wss://yourserver/?user=TIKTOK_USERNAME
 * ---------------------------------------------------------
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Serve the overlay + dashboard static files
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

// ---------------------------------------------------------
// Room manager: one TikTokConnection per username, fan-out to
// every overlay socket subscribed to that username.
// ---------------------------------------------------------
const rooms = new Map(); // username -> { connection, sockets:Set, status }

function getOrCreateRoom(username) {
  username = username.toLowerCase().replace('@', '');
  if (rooms.has(username)) return rooms.get(username);

  const room = {
    connection: null,
    sockets: new Set(),
    status: 'connecting',
  };
  rooms.set(username, room);

  const connection = new WebcastPushConnection(username, {
    // Increases reliability; uses TikTok's own signing service.
    enableExtendedGiftInfo: true,
  });
  room.connection = connection;

  connection.connect()
    .then(state => {
      room.status = 'connected';
      broadcast(room, { type: 'status', status: 'connected', roomId: state.roomId });
      console.log(`[${username}] connected. roomId=${state.roomId}`);
    })
    .catch(err => {
      room.status = 'error';
      broadcast(room, { type: 'status', status: 'error', message: err.message });
      console.error(`[${username}] connect failed:`, err.message);
    });

  // ---- Event wiring ----
  connection.on('gift', data => {
    // Only fire on the final repeat of a streak (or non-streakable gifts)
    if (data.giftType === 1 && !data.repeatEnd) return;

    broadcast(room, {
      type: 'gift',
      user: data.uniqueId,
      nickname: data.nickname,
      giftName: data.giftName,
      giftId: data.giftId,
      repeatCount: data.repeatCount,
      diamondCount: data.diamondCount,
    });
  });

  connection.on('like', data => {
    broadcast(room, {
      type: 'like',
      user: data.uniqueId,
      nickname: data.nickname,
      likeCount: data.likeCount,
      totalLikeCount: data.totalLikeCount,
    });
  });

  connection.on('follow', data => {
    broadcast(room, {
      type: 'follow',
      user: data.uniqueId,
      nickname: data.nickname,
    });
  });

  connection.on('share', data => {
    broadcast(room, {
      type: 'share',
      user: data.uniqueId,
      nickname: data.nickname,
    });
  });

  connection.on('chat', data => {
    broadcast(room, {
      type: 'chat',
      user: data.uniqueId,
      nickname: data.nickname,
      comment: data.comment,
    });
  });

  connection.on('subscribe', data => {
    broadcast(room, {
      type: 'subscribe',
      user: data.uniqueId,
      nickname: data.nickname,
    });
  });

  connection.on('streamEnd', () => {
    room.status = 'ended';
    broadcast(room, { type: 'status', status: 'ended' });
  });

  connection.on('disconnected', () => {
    room.status = 'disconnected';
    broadcast(room, { type: 'status', status: 'disconnected' });
  });

  return room;
}

function broadcast(room, payload) {
  const msg = JSON.stringify(payload);
  for (const ws of room.sockets) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

// Clean up a room if no overlay clients are connected for a while
function maybeCleanupRoom(username) {
  const room = rooms.get(username);
  if (!room) return;
  if (room.sockets.size === 0) {
    setTimeout(() => {
      const r = rooms.get(username);
      if (r && r.sockets.size === 0) {
        try { r.connection?.disconnect(); } catch (e) {}
        rooms.delete(username);
        console.log(`[${username}] room cleaned up (no clients)`);
      }
    }, 60_000); // 1 minute grace period
  }
}

// ---------------------------------------------------------
// WebSocket endpoint: /?user=USERNAME
// ---------------------------------------------------------
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const username = (url.searchParams.get('user') || '').trim();

  if (!username) {
    ws.send(JSON.stringify({ type: 'status', status: 'error', message: 'missing ?user=tiktok_username' }));
    ws.close();
    return;
  }

  const room = getOrCreateRoom(username);
  room.sockets.add(ws);
  ws.send(JSON.stringify({ type: 'status', status: room.status }));

  console.log(`overlay client joined room "${username}" (${room.sockets.size} total)`);

  ws.on('close', () => {
    room.sockets.delete(ws);
    console.log(`overlay client left room "${username}" (${room.sockets.size} total)`);
    maybeCleanupRoom(username);
  });
});

server.listen(PORT, () => {
  console.log(`badth-overlay-server running on port ${PORT}`);
});
