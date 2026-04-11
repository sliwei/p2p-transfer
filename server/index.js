import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 与 mb-pairdrop server/peer.js 同源思路：会话级 UUID + peerIdHash 校验，重连后 peerId 不变，便于后续断点续传。
 * 生产环境请设置 PEER_ID_SECRET，否则重启后旧 hash 全部失效。
 */
const PEER_ID_SECRET = process.env.PEER_ID_SECRET || 'p2p-transfer-dev-peer-secret';

function isValidUuid(uuid) {
  return (
    typeof uuid === 'string' &&
    /^([0-9]|[a-f]){8}-(([0-9]|[a-f]){4}-){3}([0-9]|[a-f]){12}$/.test(uuid)
  );
}

function hashPeerId(peerId) {
  return crypto
    .createHash('sha3-512')
    .update(PEER_ID_SECRET, 'utf8')
    .update(crypto.createHash('sha3-512').update(peerId, 'utf8').digest('hex'))
    .digest('hex');
}

/** Same shape as PairDrop: https://github.com/schlagmichdoch/PairDrop (rtc_config + RTC_CONFIG env) */
function loadRtcConfig() {
  if (process.env.RTC_CONFIG && process.env.RTC_CONFIG !== 'false') {
    try {
      const raw = fs.readFileSync(process.env.RTC_CONFIG, 'utf8');
      const cfg = JSON.parse(raw);
      console.log('[Server] RTC config loaded from', process.env.RTC_CONFIG);
      return cfg;
    } catch (e) {
      console.error('[Server] Failed to read RTC_CONFIG, using defaults:', e.message);
    }
  }
  // Same idea as PairDrop default (server/index.js): STUN only. TURN only via RTC_CONFIG + coturn when you need relay.
  return {
    sdpSemantics: 'unified-plan',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };
}

const rtcConfig = loadRtcConfig();

const app = express();
app.use(cors({ origin: true }));
app.get('/rtc-config', (req, res) => {
  res.json(rtcConfig);
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    methods: ["GET", "POST"],
    credentials: false,
    allowedHeaders: ["*"]
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Room management：存稳定 peerId（UUID），与 socket.id 解耦
const rooms = new Map(); // roomId -> Set<stablePeerId>

io.use((socket, next) => {
  try {
    const auth = socket.handshake.auth || {};
    const clientPeerId = typeof auth.peerId === 'string' ? auth.peerId : null;
    const clientHash = typeof auth.peerIdHash === 'string' ? auth.peerIdHash : null;

    let stablePeerId;
    if (
      clientPeerId &&
      clientHash &&
      isValidUuid(clientPeerId) &&
      hashPeerId(clientPeerId) === clientHash
    ) {
      stablePeerId = clientPeerId;
    } else {
      stablePeerId = crypto.randomUUID();
    }

    socket.data.stablePeerId = stablePeerId;
    socket.data.peerIdHash = hashPeerId(stablePeerId);
    socket.join(`peer:${stablePeerId}`);
    next();
  } catch (e) {
    next(e);
  }
});

io.on('connection', (socket) => {
  const stablePeerId = socket.data.stablePeerId;
  console.log(`[Server] Client connected: socket=${socket.id} stablePeerId=${stablePeerId}`);
  socket.emit('rtc-config', rtcConfig);

  // Join room
  socket.on('join-room', (roomId) => {
    if (!roomId || typeof roomId !== 'string') {
      socket.emit('error', 'Invalid room ID');
      return;
    }

    // 离开其它业务房间，保留 socket 自带 id 房间与 peer:<uuid> 私有信令房间（避免迭代中修改 Set）
    const roomsToLeave = [...socket.rooms].filter(
      (room) => room !== socket.id && !room.startsWith('peer:')
    );
    for (const room of roomsToLeave) {
      socket.leave(room);
      if (rooms.has(room)) {
        rooms.get(room).delete(stablePeerId);
        if (rooms.get(room).size === 0) {
          rooms.delete(room);
        }
      }
      socket.to(room).emit('peer-left', stablePeerId);
    }

    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(stablePeerId);

    console.log(`[Server] ${stablePeerId} (socket ${socket.id}) joined room: ${roomId}`);

    const peerSet = rooms.get(roomId);
    const peers = peerSet ? Array.from(peerSet).filter((id) => id !== stablePeerId) : [];

    console.log(`[Server] Room ${roomId} peers:`, peers);

    socket.emit('joined-room', {
      roomId,
      peerId: stablePeerId,
      peerIdHash: socket.data.peerIdHash,
      peers,
    });

    socket.to(roomId).emit('peer-joined', stablePeerId);
  });

  socket.on('offer', ({ targetId, offer }) => {
    socket.to(`peer:${targetId}`).emit('offer', {
      senderId: stablePeerId,
      offer,
    });
  });

  socket.on('answer', ({ targetId, answer }) => {
    socket.to(`peer:${targetId}`).emit('answer', {
      senderId: stablePeerId,
      answer,
    });
  });

  socket.on('ice-candidate', ({ targetId, candidate }) => {
    socket.to(`peer:${targetId}`).emit('ice-candidate', {
      senderId: stablePeerId,
      candidate,
    });
  });

  socket.on('disconnect', () => {
    console.log(`[Server] Client disconnected: socket=${socket.id} stablePeerId=${stablePeerId}`);

    rooms.forEach((peerSet, roomId) => {
      if (peerSet.has(stablePeerId)) {
        peerSet.delete(stablePeerId);
        socket.to(roomId).emit('peer-left', stablePeerId);
        console.log(`[Server] Notified room ${roomId} that ${stablePeerId} left`);
        if (peerSet.size === 0) {
          rooms.delete(roomId);
        }
      }
    });
  });
});

const clientDist = process.env.CLIENT_DIST;
if (clientDist && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io')) return next();
    const indexHtml = path.join(clientDist, 'index.html');
    if (!fs.existsSync(indexHtml)) return next();
    res.sendFile(indexHtml);
  });
  console.log('[Server] Serving static from', clientDist);
}

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Signaling server running on port ${PORT}`);
});
