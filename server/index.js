import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import parser from 'ua-parser-js';

/** 与 mb-pairdrop server/peer.js _setName 中 deviceName 一致（用于雷达卡片副标题，对应 PairDrop 的 .device-name） */
function deviceNameFromUserAgent(uaHeader) {
  const ua = parser(typeof uaHeader === 'string' ? uaHeader : '');
  let deviceName = '';
  if (ua.os && ua.os.name) {
    deviceName = ua.os.name.replace('Mac OS', 'Mac') + ' ';
  }
  if (ua.device && ua.device.model) {
    deviceName += ua.device.model;
  } else if (ua.browser && ua.browser.name) {
    deviceName += ua.browser.name;
  }
  if (!deviceName.trim()) {
    deviceName = 'Unknown Device';
  }
  return deviceName.trim();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEBUG_SIGNALING = process.env.DEBUG_SIGNALING === '1';
const slog = (...args) => {
  if (DEBUG_SIGNALING) console.log(...args);
};

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
      slog('[Server] RTC config loaded from', process.env.RTC_CONFIG);
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
app.get('/health', (req, res) => {
  res.status(200).type('text/plain').send('ok');
});
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

// Room management：roomId -> Map<stablePeerId, { displayName, deviceName }>（deviceName 由 UA 解析，同 PairDrop）
const rooms = new Map();

/** 首参 string 兼容旧客户端；第二参为地址栏展示名；或单参 { roomId, displayName } */
function parseJoinRoomPayload(payload, displayNameArg) {
  if (typeof payload === 'string') {
    const roomId = payload.trim();
    if (!roomId) return null;
    const displayName =
      typeof displayNameArg === 'string' ? displayNameArg.trim().slice(0, 64) : '';
    return { roomId, displayName };
  }
  if (payload && typeof payload === 'object' && typeof payload.roomId === 'string') {
    const roomId = payload.roomId.trim();
    if (!roomId) return null;
    let displayName = '';
    if (typeof payload.displayName === 'string') {
      displayName = payload.displayName.trim().slice(0, 64);
    } else if (typeof displayNameArg === 'string') {
      displayName = displayNameArg.trim().slice(0, 64);
    }
    return { roomId, displayName };
  }
  return null;
}

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
    socket.data.deviceName = deviceNameFromUserAgent(socket.handshake.headers['user-agent']);
    socket.join(`peer:${stablePeerId}`);
    next();
  } catch (e) {
    next(e);
  }
});

io.on('connection', (socket) => {
  const stablePeerId = socket.data.stablePeerId;
  slog(`[Server] Client connected: socket=${socket.id} stablePeerId=${stablePeerId}`);
  socket.emit('rtc-config', rtcConfig);

  // Join room（roomId 字符串 + 可选第二参 displayName，或对象体）
  socket.on('join-room', (payload, displayNameArg) => {
    const parsed = parseJoinRoomPayload(payload, displayNameArg);
    if (!parsed) {
      socket.emit('error', 'Invalid room ID');
      return;
    }
    const { roomId, displayName } = parsed;

    // 离开其它业务房间，保留 socket 自带 id 房间与 peer:<uuid> 私有信令房间（避免迭代中修改 Set）
    const roomsToLeave = [...socket.rooms].filter(
      (room) => room !== socket.id && !room.startsWith('peer:')
    );
    for (const room of roomsToLeave) {
      socket.leave(room);
      if (rooms.has(room)) {
        const roomMap = rooms.get(room);
        roomMap.delete(stablePeerId);
        if (roomMap.size === 0) {
          rooms.delete(room);
        }
      }
      socket.to(room).emit('peer-left', stablePeerId);
    }

    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    rooms.get(roomId).set(stablePeerId, {
      displayName,
      deviceName: socket.data.deviceName || 'Unknown Device',
    });

    slog(`[Server] ${stablePeerId} (socket ${socket.id}) joined room: ${roomId}`);

    const roomMap = rooms.get(roomId);
    const peers = [];
    const peerInfos = [];
    for (const [id, meta] of roomMap) {
      if (id === stablePeerId) continue;
      peers.push(id);
      peerInfos.push({
        id,
        displayName: meta.displayName || '',
        deviceType: meta.deviceName || '',
      });
    }

    slog(`[Server] Room ${roomId} peers:`, peers);

    socket.emit('joined-room', {
      roomId,
      peerId: stablePeerId,
      peerIdHash: socket.data.peerIdHash,
      deviceType: socket.data.deviceName || '',
      peers,
      peerInfos,
    });

    // 单对象避免多参数在部分链路下丢失第二参；旧客户端若只认 string 需同步升级
    socket.to(roomId).emit('peer-joined', {
      peerId: stablePeerId,
      displayName: displayName || '',
      deviceType: socket.data.deviceName || '',
    });
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
    slog(`[Server] Client disconnected: socket=${socket.id} stablePeerId=${stablePeerId}`);

    rooms.forEach((roomMap, roomId) => {
      if (roomMap.has(stablePeerId)) {
        roomMap.delete(stablePeerId);
        socket.to(roomId).emit('peer-left', stablePeerId);
        slog(`[Server] Notified room ${roomId} that ${stablePeerId} left`);
        if (roomMap.size === 0) {
          rooms.delete(roomId);
        }
      }
    });
  });
});

const clientDist = process.env.CLIENT_DIST;
/** 避免缺失的静态资源被 SPA 回退成 index.html（否则模块脚本会得到 text/html） */
const STATIC_EXT_NO_SPA_FALLBACK =
  /\.(js|mjs|cjs|css|map|json|ico|svg|png|jpe?g|gif|webp|woff2?|ttf|eot|txt|wasm)(\?.*)?$/i;
const CACHE_HTML = 'no-cache, no-store, must-revalidate';
const CACHE_ASSET_HASHED = 'public, max-age=31536000, immutable';

if (clientDist && fs.existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      setHeaders(res, filePath) {
        if (path.basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', CACHE_HTML);
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', CACHE_ASSET_HASHED);
        }
      },
    })
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io')) return next();
    if (STATIC_EXT_NO_SPA_FALLBACK.test(req.path)) return next();
    const indexHtml = path.join(clientDist, 'index.html');
    if (!fs.existsSync(indexHtml)) return next();
    res.setHeader('Cache-Control', CACHE_HTML);
    res.sendFile(indexHtml);
  });
  slog('[Server] Serving static from', clientDist);
}

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Signaling server running on port ${PORT}`);
});
