import { generateCuteNickname } from 'cute-nickname'
import { useCallback, useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

import { getDropReceiveItemStash, getEffectiveDropFileSize, isMalianDropVirtualUrl } from '../utils/app-drop-protocol'
import { triggerBrowserDownload, triggerBrowserDownloads } from '../utils/triggerDownload'

/** 本机开发：信令与 rtc-config 统一走 127.0.0.1:3001（IPv4），避免 localhost 解析到 ::1 与 WebRTC 的 127.0.0.1 host 候选混用；并与仅用「局域网 IP 打开页面」时的行为区分。 */
function getSignalingOrigin(): string {
  const h = window.location.hostname
  if (h === 'localhost' || h === '127.0.0.1') {
    return 'http://127.0.0.1:3001'
  }
  return ''
}

/**
 * 与 `?roomid=…&name=…` 一致：从查询串读取展示名（已按 URL 规则解码，含中文）。
 * 同时支持 hash 内查询串，如 `/#/?name=…`。
 */
export function readDisplayNameFromUrl(): string {
  try {
    const fromSearch = (q: string) => {
      const s = q.startsWith('?') ? q : q ? `?${q}` : ''
      if (!s) return ''
      const raw = new URLSearchParams(s).get('name')
      if (raw == null) return ''
      return raw.trim()
    }
    const a = fromSearch(window.location.search)
    if (a) return a
    const hash = window.location.hash
    const qi = hash.indexOf('?')
    if (qi >= 0) {
      const b = fromSearch(hash.slice(qi))
      if (b) return b
    }
    return ''
  } catch {
    return ''
  }
}

const SESSION_RANDOM_CN_NICKNAME_KEY = 'p2p_transfer_session_cn_nickname'

/** 展示名最大长度（与信令、UI 一致） */
export const DISPLAY_NAME_MAX_LEN = 20

/**
 * 展示名：地址栏 `name` 优先；否则本地持久化一条 cute-nickname 生成的中文昵称（localStorage，跨会话不变）
 */
export function getEffectiveDisplayName(): string {
  const fromUrl = readDisplayNameFromUrl().trim().slice(0, DISPLAY_NAME_MAX_LEN)
  if (fromUrl) return fromUrl
  try {
    const fromLocal = localStorage.getItem(SESSION_RANDOM_CN_NICKNAME_KEY)?.trim()
    if (fromLocal) return fromLocal.slice(0, DISPLAY_NAME_MAX_LEN)
    const legacy = sessionStorage.getItem(SESSION_RANDOM_CN_NICKNAME_KEY)?.trim()
    if (legacy) {
      localStorage.setItem(SESSION_RANDOM_CN_NICKNAME_KEY, legacy.slice(0, DISPLAY_NAME_MAX_LEN))
      try {
        sessionStorage.removeItem(SESSION_RANDOM_CN_NICKNAME_KEY)
      } catch {
        /* ignore */
      }
      return legacy.slice(0, DISPLAY_NAME_MAX_LEN)
    }
  } catch {
    /* ignore */
  }
  let created = generateCuteNickname({ withEmoji: true, allowReduplication: true })
  created = created.trim().slice(0, DISPLAY_NAME_MAX_LEN)
  if (!created) {
    created = '访客'
  }
  try {
    localStorage.setItem(SESSION_RANDOM_CN_NICKNAME_KEY, created)
  } catch {
    /* ignore */
  }
  return created
}

/** 用户改昵称时写入本地（无 URL `name` 时与 getEffectiveDisplayName 同源） */
export function persistRandomCnNickname(name: string) {
  const n = name.trim().slice(0, DISPLAY_NAME_MAX_LEN)
  if (!n || readDisplayNameFromUrl().trim()) return
  try {
    localStorage.setItem(SESSION_RANDOM_CN_NICKNAME_KEY, n)
  } catch {
    /* ignore */
  }
}

const SIGNALING_SERVER = getSignalingOrigin()

/** 与 mb-pairdrop 一致：同一会话内固定 peerId，重连后不变（便于后续续传）。 */
const PEER_ID_STORAGE_KEY = 'p2p_transfer_peer_id'
const PEER_ID_HASH_STORAGE_KEY = 'p2p_transfer_peer_id_hash'

function loadStoredPeerAuth(): { peerId: string; peerIdHash: string } | undefined {
  try {
    const peerId = sessionStorage.getItem(PEER_ID_STORAGE_KEY)
    const peerIdHash = sessionStorage.getItem(PEER_ID_HASH_STORAGE_KEY)
    if (peerId && peerIdHash) return { peerId, peerIdHash }
  } catch {
    /* ignore */
  }
  return undefined
}

function savePeerAuth(peerId: string, peerIdHash: string) {
  try {
    sessionStorage.setItem(PEER_ID_STORAGE_KEY, peerId)
    sessionStorage.setItem(PEER_ID_HASH_STORAGE_KEY, peerIdHash)
  } catch {
    /* ignore */
  }
}

/** Fallback until /rtc-config loads (aligned with PairDrop server defaults). */
const DEFAULT_RTC_CONFIG = {
  sdpSemantics: 'unified-plan',
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }]
} as RTCConfiguration

function normalizeRtcConfig(raw: unknown): RTCConfiguration {
  if (!raw || typeof raw !== 'object') return DEFAULT_RTC_CONFIG
  const o = raw as Record<string, unknown>
  const iceServers = Array.isArray(o.iceServers) ? (o.iceServers as RTCIceServer[]) : (DEFAULT_RTC_CONFIG.iceServers as RTCIceServer[])
  return {
    sdpSemantics: typeof o.sdpSemantics === 'string' ? o.sdpSemantics : 'unified-plan',
    iceServers
  } as RTCConfiguration
}

async function fetchRtcConfig(): Promise<RTCConfiguration> {
  const url = SIGNALING_SERVER ? `${SIGNALING_SERVER}/rtc-config` : '/rtc-config'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`rtc-config ${res.status}`)
  return normalizeRtcConfig(await res.json())
}

/**
 * 单条 DC 消息 = 包头(4+fileId+4)+payload。SCTP/WebRTC 对单条用户消息常见上限约 64KB，
 * 256KB 分片易触发 OperationError: Failure to send data 并导致通道关闭。
 */
const CHUNK_SIZE = 32 * 1024

/** `file-complete` 早于部分分片到达时，短暂重试组装（unordered 或实现差异时的兜底） */
const RECEIVE_ASSEMBLE_RETRY_MS = 50
const RECEIVE_ASSEMBLE_MAX_ATTEMPTS = 80

/**
 * 接收端：累积分片达到此字节数时，合并为 partial Blob 并释放 ArrayBuffer。
 * Blob 数据由浏览器管理（可落 tmp/mmap），不直接占 JS 堆，显著降低 WebView OOM 风险。
 */
const RECEIVE_FLUSH_BYTES = 4 * 1024 * 1024

interface FileReceiveBuffer {
  partialBlobs: Blob[]
  partialBlobsBytes: number
  pendingChunks: ArrayBuffer[]
  pendingChunksBytes: number
  receivedCount: number
}

function flushReceiveBuffer(buf: FileReceiveBuffer): void {
  if (buf.pendingChunks.length === 0) return
  buf.partialBlobs.push(new Blob(buf.pendingChunks))
  buf.partialBlobsBytes += buf.pendingChunksBytes
  buf.pendingChunks = []
  buf.pendingChunksBytes = 0
}

/** 允许更多数据在途；与较小分片搭配，略降阈值以便更早背压 */
const DC_SEND_BUFFER_HIGH_WATER = 2 * 1024 * 1024

async function waitUntilDataChannelCanSend(dc: RTCDataChannel, limit = DC_SEND_BUFFER_HIGH_WATER): Promise<void> {
  if (dc.readyState !== 'open') {
    throw new Error('Data channel is not open')
  }
  dc.bufferedAmountLowThreshold = limit
  while (dc.bufferedAmount > limit) {
    await new Promise<void>((resolve, reject) => {
      const onLow = () => {
        dc.removeEventListener('bufferedamountlow', onLow)
        dc.removeEventListener('close', onClose)
        resolve()
      }
      const onClose = () => {
        dc.removeEventListener('bufferedamountlow', onLow)
        dc.removeEventListener('close', onClose)
        reject(new Error('Data channel closed while waiting for send buffer'))
      }
      dc.addEventListener('bufferedamountlow', onLow, { once: true })
      dc.addEventListener('close', onClose, { once: true })
    })
    if (dc.readyState !== 'open') {
      throw new Error('Data channel is not open')
    }
  }
}

/**
 * 马良虚拟 URL：`fetch` + ReadableStream 按 P2P 分片长度读入 buffer，不整段 `blob()`/`arrayBuffer()`。
 * 避免将 `carry` 与单次 `read()` 的 `value` 拼成新的大 `Uint8Array`（双倍峰值，大文件易触发 renderer OOM）。
 */
async function readVirtualUrlChunkToBuffer(reader: ReadableStreamDefaultReader<Uint8Array>, streamState: { carry: Uint8Array; streamDone: boolean }, byteLength: number): Promise<ArrayBuffer> {
  const out = new Uint8Array(byteLength)
  let pos = 0
  while (pos < byteLength) {
    if (streamState.carry.length > 0) {
      const n = Math.min(streamState.carry.length, byteLength - pos)
      out.set(streamState.carry.subarray(0, n), pos)
      pos += n
      streamState.carry = streamState.carry.subarray(n)
      continue
    }
    if (streamState.streamDone) break
    const { done, value } = await reader.read()
    if (done) streamState.streamDone = true
    if (!value?.length) continue
    const need = byteLength - pos
    if (value.length <= need) {
      out.set(value, pos)
      pos += value.length
    } else {
      out.set(value.subarray(0, need), pos)
      pos += need
      streamState.carry = value.subarray(need)
    }
  }
  if (pos < byteLength) {
    throw new Error('马良虚拟文件流提前结束，与声明大小不一致')
  }
  return out.buffer
}

type PairdropFileBridgeNative = {
  open: (fileId: string) => boolean
  readChunkBase64: (fileId: string, byteLength: number) => string | null
  close: (fileId: string) => void
}

function getPairdropFileBridge(): PairdropFileBridgeNative | null {
  const w = window as Window & { PairdropFileBridge?: PairdropFileBridgeNative }
  const b = w.PairdropFileBridge
  if (!b || typeof b.open !== 'function' || typeof b.readChunkBase64 !== 'function' || typeof b.close !== 'function') {
    return null
  }
  return b
}

function extractVirtualFileId(virtualUrl: string): string {
  const raw = virtualUrl
    .slice(virtualUrl.lastIndexOf('/') + 1)
    .split('?')[0]
    .split('#')[0]
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function base64ChunkToArrayBuffer(base64: string, expectedByteLength: number): ArrayBuffer {
  const bin = atob(base64)
  const len = bin.length
  if (len !== expectedByteLength) {
    throw new Error(`原生分片长度不一致: expected=${expectedByteLength} actual=${len}`)
  }
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

/** 发送大文件时降低 `setTransfers` 频率，减轻 WebView 渲染压力（分片仍按 CHUNK_SIZE 发送） */
const SEND_PROGRESS_UI_MIN_MS = 160

/** 198.18.0.0/15 常为 Clash/Surge 等 TUN、Fake-IP；WebRTC host 走该地址时与对端真实网卡候选极难配对 */
function candidateLooksLikeTunnelFakeIp(candidateStr: string): boolean {
  return /198\.(18|19)\.\d{1,3}\.\d{1,3}/.test(candidateStr)
}

/**
 * 可传文件：DC open 且 PC/ICE 处于稳定 connected，避免 ICE disconnected 时仍显示已连接、吞吐极低。
 */
function recomputePeerTransferStatus(p: Peer): Peer['status'] {
  const cs = p.connection.connectionState
  const ice = p.connection.iceConnectionState
  if (cs === 'failed' || cs === 'closed' || ice === 'failed' || ice === 'closed') {
    return 'disconnected'
  }
  if (p.dataChannel?.readyState !== 'open') return 'connecting'
  if (cs !== 'connected') return 'connecting'
  if (ice === 'disconnected') return 'connecting'
  if (ice === 'connected' || ice === 'completed') return 'connected'
  return 'connecting'
}

export type IceTransportPath = 'relay' | 'direct' | 'unknown'

/**
 * 根据 getStats 选中 candidate-pair 判断：任一端 candidateType 为 relay 即经 TURN 中继。
 */
async function detectIceTransportPath(pc: RTCPeerConnection): Promise<{
  path: IceTransportPath
  detail: string
}> {
  try {
    const stats = await pc.getStats()
    const byId = new Map<string, Record<string, unknown>>()

    stats.forEach((report) => {
      const r = report as unknown as Record<string, unknown>
      const id = typeof r.id === 'string' ? r.id : ''
      if (id) byId.set(id, r)
    })

    let selectedPairId: string | undefined
    stats.forEach((report) => {
      const r = report as unknown as Record<string, unknown>
      if (r.type === 'transport' && typeof r.selectedCandidatePairId === 'string') {
        selectedPairId = r.selectedCandidatePairId
      }
    })

    if (!selectedPairId) {
      let nominatedId: string | undefined
      let succeededId: string | undefined
      stats.forEach((report) => {
        const r = report as unknown as Record<string, unknown>
        if (r.type !== 'candidate-pair') return
        const id = typeof r.id === 'string' ? r.id : ''
        if (!id) return
        if (r.nominated === true) nominatedId = id
        if (r.state === 'succeeded') succeededId = id
      })
      selectedPairId = nominatedId ?? succeededId
    }

    if (!selectedPairId) {
      return { path: 'unknown', detail: '无选中 candidate-pair' }
    }

    const pair = byId.get(selectedPairId)
    if (!pair || pair.type !== 'candidate-pair') {
      return { path: 'unknown', detail: 'pair 记录缺失' }
    }

    const localCid = pair.localCandidateId as string | undefined
    const remoteCid = pair.remoteCandidateId as string | undefined

    const readType = (cid: string | undefined): string | undefined => {
      if (!cid) return undefined
      const c = byId.get(cid)
      if (!c) return undefined
      const t = c.candidateType as string | undefined
      if (t) return t
      return undefined
    }

    const localType = readType(localCid)
    const remoteType = readType(remoteCid)
    const detail = `local=${localType ?? '?'} remote=${remoteType ?? '?'}`
    if (!localType && !remoteType) {
      return { path: 'unknown', detail }
    }
    const relay = localType === 'relay' || remoteType === 'relay'
    return { path: relay ? 'relay' : 'direct', detail }
  } catch (e) {
    return { path: 'unknown', detail: e instanceof Error ? e.message : String(e) }
  }
}

export interface Peer {
  id: string
  name?: string
  /** 与 mb-pairdrop `peer.name.deviceName` / 卡片 `.device-name` 同源（服务端 UA 解析） */
  deviceType?: string
  connection: RTCPeerConnection
  dataChannel?: RTCDataChannel
  status: 'connecting' | 'connected' | 'disconnected'
  iceCandidates: RTCIceCandidateInit[] // Buffer for ICE candidates before remote description is set
  /** 由 getStats 解析；DataChannel 打开后异步写入 */
  iceTransportPath?: IceTransportPath
  /** 如 local=srflx remote=relay */
  iceTransportDetail?: string
}

export interface TransferProgress {
  fileId: string
  fileName: string
  fileSize: number
  sentBytes: number
  speed: number // bytes per second
  status: 'pending' | 'transferring' | 'completed' | 'error'
  targetPeerId?: string
  direction: 'sending' | 'receiving'
}

/** 每个 fileId 在 0% / 50% / 100% 各打一条 `[P2P][传输进度]`，替代逐分片与全量列表刷屏 */
function emitTransferProgressMilestoneLogs(transfers: Map<string, TransferProgress>, milestonesByFileId: Map<string, Set<0 | 50 | 100>>): void {
  const active = new Set<string>()
  for (const t of transfers.values()) {
    active.add(t.fileId)
    let m = milestonesByFileId.get(t.fileId)
    if (!m) {
      m = new Set()
      milestonesByFileId.set(t.fileId, m)
    }
    const { sentBytes, fileSize, status } = t
    const r = fileSize > 0 ? sentBytes / fileSize : 0
    const doneOk = status === 'completed' || (fileSize > 0 && sentBytes >= fileSize && status !== 'error')

    const log = (pct: 0 | 50 | 100) => {
      if (m!.has(pct)) return
      m!.add(pct)
      console.log(`[P2P][传输进度] ${pct}%`, { ...t })
    }

    log(0)
    if (fileSize > 0 && r >= 0.5) log(50)
    if (doneOk) {
      if (fileSize > 0 && r >= 0.5 && !m!.has(50)) log(50)
      if (fileSize === 0 && !m!.has(50)) log(50)
      log(100)
    }
  }
  for (const id of milestonesByFileId.keys()) {
    if (!active.has(id)) milestonesByFileId.delete(id)
  }
}

export interface ReceivedFile {
  id: string
  name: string
  size: number
  type: string
  blob: Blob
  fromPeerId: string
  timestamp: number
}

export interface TransferRequest {
  requestId: string
  fromPeerId: string
  /** 与 Socket `peer-joined` / Peer.name 一致的对端展示名（如「可爱蘑菇」） */
  fromPeerName?: string
  filesInfo: { name: string; size: number }[]
}

/** 发送方雷达卡片：等待对端确认 / 被拒提示 / 传输结束短时提示 */
export type OutgoingTransferHint = 'waiting' | 'rejected' | 'completed'

export function useWebRTC(roomId: string | null) {
  const [myPeerId, setMyPeerId] = useState<string>('')
  const [myPeerName, setMyPeerName] = useState<string>(() => getEffectiveDisplayName())
  const myPeerNameRef = useRef(myPeerName)
  useEffect(() => {
    myPeerNameRef.current = myPeerName
  }, [myPeerName])
  const [myDeviceType, setMyDeviceType] = useState<string>('')
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map())
  const [transfers, setTransfers] = useState<Map<string, TransferProgress>>(new Map())
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([])
  /** 本批接收完成后一次性交给 UI 弹窗（避免多文件间隙误判为「已全部收完」） */
  const [receivedModalPayload, setReceivedModalPayload] = useState<ReceivedFile[] | null>(null)
  const [incomingRequests, setIncomingRequests] = useState<TransferRequest[]>([])
  /** 发送端：各对端设备上的传输提示（与 RadarView 展示同步） */
  const [outgoingTransferHint, setOutgoingTransferHint] = useState<Record<string, OutgoingTransferHint>>({})
  /** 信令（Socket）已加入房间；与 WebRTC 是否可传文件无关 */
  const [signalingInRoom, setSignalingInRoom] = useState(false)
  /** 当前批次「全部文件」总字节数（对端 id → 总大小），供雷达合并进度分母 */
  const [transferBatchTotalBytesByPeer, setTransferBatchTotalBytesByPeer] = useState<Record<string, number>>({})

  const updateOutgoingHint = useCallback((peerId: string, hint: OutgoingTransferHint | null) => {
    setOutgoingTransferHint((prev) => {
      const next = { ...prev }
      if (hint === null) {
        delete next[peerId]
      } else {
        next[peerId] = hint
      }
      return next
    })
  }, [])

  /** 进入房间后再读一次地址栏，避免与信令时序或其它逻辑导致展示名未带上 */
  useEffect(() => {
    if (!roomId) return
    const fromUrl = readDisplayNameFromUrl().trim()
    if (fromUrl) {
      setMyPeerName(fromUrl.slice(0, DISPLAY_NAME_MAX_LEN))
      return
    }
    setMyPeerName(getEffectiveDisplayName())
  }, [roomId])

  const socketRef = useRef<Socket | null>(null)
  /** 主动 close 时跳过 disconnect 里的 setState，避免卸载清理顺序导致泄漏或更新已卸载树 */
  const skipSocketDisconnectStateRef = useRef(false)
  /** 信令层稳定 id（与 socket.id 解耦），用于比较 peer-joined / 协商发起方 */
  const myStablePeerIdRef = useRef<string>('')
  const connectingRef = useRef(false)
  const rtcConfigRef = useRef<RTCConfiguration>(DEFAULT_RTC_CONFIG)
  /** PairDrop processes one WS signal at a time; Socket.io async handlers can interleave — serialize signaling. */
  const signalingChainRef = useRef(Promise.resolve())

  const peersRef = useRef<Map<string, Peer>>(new Map())
  /** ICE candidates received before we have a Peer (e.g. trickle arrives before offer) */
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
  const transfersRef = useRef<Map<string, TransferProgress>>(new Map())
  const receiveBuffersRef = useRef<Map<string, FileReceiveBuffer>>(new Map())
  /** 分片早于 file-start 到达时暂存（unordered DC） */
  const orphanChunksRef = useRef<Map<string, Map<number, ArrayBuffer>>>(new Map())
  const receiveAssembleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const fileMetadataRef = useRef<Map<string, { name: string; size: number; type: string; totalChunks: number; fromPeerId: string }>>(new Map())
  const pendingRequestsRef = useRef<Map<string, { peerId: string; resolve: () => void; reject: (reason: unknown) => void }>>(new Map())
  const receivedFilesRef = useRef<ReceivedFile[]>([])
  /** 与 transfer-request 对齐：收到几份 file-complete 后再弹窗 */
  const incomingReceiveBatchRef = useRef<{ fromPeerId: string; total: number; completed: number; sliceStart: number } | null>(null)
  const transferProgressLogMilestonesRef = useRef<Map<string, Set<0 | 50 | 100>>>(new Map())

  /** 对端断开 / DC 关闭 / 信令断开时立即结束「等待对方确认」，避免 sendFilesBatch 挂起导致 UI 一直「发送中」 */
  const rejectPendingTransferRequestsForPeer = (peerId: string, reason: Error) => {
    const map = pendingRequestsRef.current
    for (const [requestId, entry] of [...map.entries()]) {
      if (entry.peerId === peerId) {
        map.delete(requestId)
        entry.reject(reason)
      }
    }
  }

  const rejectAllPendingTransferRequests = (reason: Error) => {
    const map = pendingRequestsRef.current
    for (const [requestId, entry] of [...map.entries()]) {
      map.delete(requestId)
      entry.reject(reason)
    }
  }
  /** DataChannel 打开后解析 getStats，每渲染更新 .current */
  const refreshIcePathRef = useRef<(peerId: string) => void>(() => {})
  /** 信令下发的对端展示名（地址栏 name），在 createPeerConnection 时写入 Peer.name */
  const peerDisplayNamesRef = useRef<Map<string, string>>(new Map())
  /** 与 mb-pairdrop server/peer.js deviceName 同源：服务端按 UA 解析的设备描述，写入 Peer.deviceType */
  const peerDeviceTypesRef = useRef<Map<string, string>>(new Map())

  const applyRemoteDisplayName = useCallback((peerId: string, displayName: string) => {
    const trimmed = displayName.trim().slice(0, DISPLAY_NAME_MAX_LEN)
    if (!trimmed) return
    peerDisplayNamesRef.current.set(peerId, trimmed)
    const p = peersRef.current.get(peerId)
    if (p) {
      p.name = trimmed
      setPeers(new Map(peersRef.current))
    }
  }, [])

  const applyRemoteDeviceSubtitle = useCallback((peerId: string, deviceSubtitle: string) => {
    const trimmed = deviceSubtitle.trim()
    if (!trimmed) return
    peerDeviceTypesRef.current.set(peerId, trimmed)
    const p = peersRef.current.get(peerId)
    if (p) {
      p.deviceType = trimmed
      setPeers(new Map(peersRef.current))
    }
  }, [])

  // Update refs when state changes
  useEffect(() => {
    transfersRef.current = transfers
  }, [transfers])

  useEffect(() => {
    emitTransferProgressMilestoneLogs(transfers, transferProgressLogMilestonesRef.current)
  }, [transfers])

  useEffect(() => {
    receivedFilesRef.current = receivedFiles
  }, [receivedFiles])

  useEffect(() => {
    console.log('[P2P][已接收文件列表]', {
      count: receivedFiles.length,
      files: receivedFiles.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        type: f.type,
        fromPeerId: f.fromPeerId
      }))
    })
  }, [receivedFiles])

  useEffect(() => {
    console.log('[P2P][入站传输请求列表]', incomingRequests)
  }, [incomingRequests])

  useEffect(() => {
    refreshIcePathRef.current = (peerId: string) => {
      const run = async () => {
        const p = peersRef.current.get(peerId)
        if (!p?.connection || p.connection.connectionState === 'closed') return
        const { path, detail } = await detectIceTransportPath(p.connection)
        const cur = peersRef.current.get(peerId)
        if (!cur || cur.connection !== p.connection) return
        setPeers((prev) => {
          const newPeers = new Map(prev)
          const currentPeer = newPeers.get(peerId)
          if (currentPeer && currentPeer.connection === p.connection && (currentPeer.iceTransportPath !== path || currentPeer.iceTransportDetail !== detail)) {
            currentPeer.iceTransportPath = path
            currentPeer.iceTransportDetail = detail
            return newPeers
          }
          return prev
        })
      }
      void run()
      window.setTimeout(() => void run(), 400)
      window.setTimeout(() => void run(), 1500)
    }
  }, [])

  const clearReceiveAssembleTimer = useCallback((fileId: string) => {
    const t = receiveAssembleTimersRef.current.get(fileId)
    if (t) {
      clearTimeout(t)
      receiveAssembleTimersRef.current.delete(fileId)
    }
  }, [])

  const failReceiveAssembly = useCallback(
    (fileId: string, detail: string) => {
      clearReceiveAssembleTimer(fileId)
      console.error('[DataChannel] 分片缺失，丢弃损坏文件:', fileId, detail)
      orphanChunksRef.current.delete(fileId)
      fileMetadataRef.current.delete(fileId)
      receiveBuffersRef.current.delete(fileId)
      setTransfers((prev) => {
        const updated = new Map(prev)
        const tr = updated.get(fileId)
        if (tr) {
          tr.status = 'error'
          updated.set(fileId, tr)
        }
        return updated
      })
    },
    [clearReceiveAssembleTimer]
  )

  const finalizeReceiveFileTransfer = useCallback(
    (fileId: string): 'completed' | 'incomplete' | 'aborted' => {
      const metadata = fileMetadataRef.current.get(fileId)
      const buf = receiveBuffersRef.current.get(fileId)
      if (!metadata || !buf) return 'aborted'

      if (buf.receivedCount < metadata.totalChunks) return 'incomplete'

      if (buf.pendingChunks.length > 0) {
        flushReceiveBuffer(buf)
      }
      const blob = new Blob(buf.partialBlobs, { type: metadata.type })
      const receivedFile: ReceivedFile = {
        id: fileId,
        name: metadata.name,
        size: metadata.size,
        type: metadata.type,
        blob,
        fromPeerId: metadata.fromPeerId,
        timestamp: Date.now()
      }
      console.log('[P2P][传输进度] 接收文件组装完成', {
        fileId,
        name: metadata.name,
        size: metadata.size,
        fromPeerId: metadata.fromPeerId,
        blobSize: blob.size
      })

      clearReceiveAssembleTimer(fileId)
      orphanChunksRef.current.delete(fileId)

      const batch = incomingReceiveBatchRef.current
      let modalSliceStart: number | null = null
      if (batch && batch.fromPeerId === metadata.fromPeerId) {
        batch.completed += 1
        if (batch.completed >= batch.total) {
          modalSliceStart = batch.sliceStart
          incomingReceiveBatchRef.current = null
        }
      }

      setReceivedFiles((prev) => {
        const next = [...prev, receivedFile]
        receivedFilesRef.current = next
        if (modalSliceStart !== null) {
          const start = modalSliceStart
          queueMicrotask(() => setReceivedModalPayload(next.slice(start)))
        }
        return next
      })
      setTransfers((prev) => {
        const updated = new Map(prev)
        const transfer = updated.get(fileId)
        if (transfer) {
          transfer.status = 'completed'
          transfer.sentBytes = metadata.size
          updated.set(fileId, transfer)
        }
        if (modalSliceStart !== null) {
          const fromId = metadata.fromPeerId
          const toRemove: string[] = []
          for (const [id, t] of updated) {
            if (t.direction === 'receiving' && t.targetPeerId === fromId) toRemove.push(id)
          }
          for (const id of toRemove) updated.delete(id)
        }
        return updated
      })
      fileMetadataRef.current.delete(fileId)
      receiveBuffersRef.current.delete(fileId)
      if (modalSliceStart !== null) {
        const fromId = metadata.fromPeerId
        queueMicrotask(() => {
          setTransferBatchTotalBytesByPeer((prev) => {
            if (!(fromId in prev)) return prev
            const n = { ...prev }
            delete n[fromId]
            return n
          })
        })
      }
      return 'completed'
    },
    [clearReceiveAssembleTimer]
  )

  const scheduleReceiveAssemblyRetries = useCallback(
    (fileId: string, attempt: number) => {
      const existing = receiveAssembleTimersRef.current.get(fileId)
      if (existing) clearTimeout(existing)

      if (attempt >= RECEIVE_ASSEMBLE_MAX_ATTEMPTS) {
        receiveAssembleTimersRef.current.delete(fileId)
        const metadata = fileMetadataRef.current.get(fileId)
        const buf = receiveBuffersRef.current.get(fileId)
        const got = buf?.receivedCount ?? 0
        failReceiveAssembly(fileId, metadata ? `超时仍未收齐分片 ${got}/${metadata.totalChunks}` : '状态已丢失')
        return
      }

      const delay = attempt === 0 ? 0 : RECEIVE_ASSEMBLE_RETRY_MS
      const t = setTimeout(() => {
        receiveAssembleTimersRef.current.delete(fileId)
        const r = finalizeReceiveFileTransfer(fileId)
        if (r === 'completed' || r === 'aborted') return
        scheduleReceiveAssemblyRetries(fileId, attempt + 1)
      }, delay)
      receiveAssembleTimersRef.current.set(fileId, t)
    },
    [failReceiveAssembly, finalizeReceiveFileTransfer]
  )

  const handleDataChannelMessage = useCallback(
    (peerId: string, data: string | ArrayBuffer) => {
      if (typeof data === 'string') {
        // Metadata or control message
        try {
          const message = JSON.parse(data)
          if (message.type === 'peer-display') {
            const dn = typeof message.displayName === 'string' ? message.displayName : ''
            console.log('[P2P][协议] DC peer-display', { fromPeerId: peerId, displayName: dn })
            applyRemoteDisplayName(peerId, dn)
            return
          }
          if (message.type === 'transfer-request') {
            console.log('[P2P][协议] DC transfer-request', { fromPeerId: peerId, requestId: message.requestId, filesInfo: message.filesInfo })
            const fromPeerName = peersRef.current.get(peerId)?.name?.trim() || peerDisplayNamesRef.current.get(peerId)?.trim() || ''
            setIncomingRequests((prev) => [
              ...prev,
              {
                requestId: message.requestId,
                fromPeerId: peerId,
                fromPeerName: fromPeerName || undefined,
                filesInfo: message.filesInfo
              }
            ])
          } else if (message.type === 'transfer-response') {
            console.log('[P2P][协议] DC transfer-response', { fromPeerId: peerId, requestId: message.requestId, accepted: message.accepted })
            const pending = pendingRequestsRef.current.get(message.requestId)
            if (pending) {
              if (message.accepted) {
                pending.resolve()
              } else {
                pending.reject('User rejected the transfer')
              }
              pendingRequestsRef.current.delete(message.requestId)
            }
          } else if (message.type === 'file-start') {
            console.log('[P2P][协议] DC file-start', { fromPeerId: peerId, fileId: message.fileId, fileName: message.fileName, fileSize: message.fileSize, totalChunks: message.totalChunks })
            // Initialize file reception
            const fileId = message.fileId
            fileMetadataRef.current.set(fileId, {
              name: message.fileName,
              size: message.fileSize,
              type: message.fileType,
              totalChunks: message.totalChunks,
              fromPeerId: peerId
            })
            const buf: FileReceiveBuffer = {
              partialBlobs: [],
              partialBlobsBytes: 0,
              pendingChunks: [],
              pendingChunksBytes: 0,
              receivedCount: 0
            }
            const orphans = orphanChunksRef.current.get(fileId)
            if (orphans) {
              orphanChunksRef.current.delete(fileId)
              const sorted = [...orphans.entries()].sort((a, b) => a[0] - b[0])
              for (const [, chunkBuf] of sorted) {
                buf.pendingChunks.push(chunkBuf)
                buf.pendingChunksBytes += chunkBuf.byteLength
                buf.receivedCount++
              }
              if (buf.pendingChunksBytes >= RECEIVE_FLUSH_BYTES) {
                flushReceiveBuffer(buf)
              }
            }
            receiveBuffersRef.current.set(fileId, buf)

            setTransfers((prev) => {
              const updated = new Map(prev)
              updated.set(fileId, {
                fileId,
                fileName: message.fileName,
                fileSize: message.fileSize,
                sentBytes: 0,
                speed: 0,
                status: 'transferring',
                targetPeerId: peerId,
                direction: 'receiving'
              })
              return updated
            })
          } else if (message.type === 'file-complete') {
            const fileId = message.fileId
            console.log('[P2P][协议] DC file-complete', { fromPeerId: peerId, fileId })
            const r = finalizeReceiveFileTransfer(fileId)
            if (r === 'incomplete') {
              scheduleReceiveAssemblyRetries(fileId, 0)
            }
          }
        } catch (e) {
          console.error('[DataChannel] Error parsing message:', e)
        }
      } else {
        // Binary data (file chunk)
        const view = new DataView(data)
        const fileIdLength = view.getUint32(0)
        const fileId = new TextDecoder().decode(new Uint8Array(data, 4, fileIdLength))
        const chunkIndex = view.getUint32(4 + fileIdLength)
        const chunkData = new Uint8Array(data, 8 + fileIdLength)
        const chunkBuf = chunkData.buffer.slice(chunkData.byteOffset, chunkData.byteOffset + chunkData.byteLength)

        const buf = receiveBuffersRef.current.get(fileId)
        if (buf) {
          buf.pendingChunks.push(chunkBuf)
          buf.pendingChunksBytes += chunkBuf.byteLength
          buf.receivedCount++
          if (buf.pendingChunksBytes >= RECEIVE_FLUSH_BYTES) {
            flushReceiveBuffer(buf)
          }

          const metadata = fileMetadataRef.current.get(fileId)
          if (metadata) {
            const receivedBytes = buf.partialBlobsBytes + buf.pendingChunksBytes
            setTransfers((prev) => {
              const updated = new Map(prev)
              const transfer = updated.get(fileId)
              if (transfer) {
                transfer.sentBytes = Math.min(receivedBytes, metadata.size)
              }
              return updated
            })

            if (buf.receivedCount === metadata.totalChunks) {
              void finalizeReceiveFileTransfer(fileId)
            }
          }
        } else {
          let pending = orphanChunksRef.current.get(fileId)
          if (!pending) {
            pending = new Map()
            orphanChunksRef.current.set(fileId, pending)
          }
          pending.set(chunkIndex, chunkBuf)
        }
      }
    },
    [applyRemoteDisplayName, finalizeReceiveFileTransfer, scheduleReceiveAssemblyRetries]
  )
  const removePeer = useCallback((peerId: string) => {
    rejectPendingTransferRequestsForPeer(peerId, new Error('对端已断开连接'))
    const peer = peersRef.current.get(peerId)
    if (peer) {
      peer.connection.close()
      peersRef.current.delete(peerId)
    }
    pendingIceCandidatesRef.current.delete(peerId)
    peerDisplayNamesRef.current.delete(peerId)
    peerDeviceTypesRef.current.delete(peerId)
    if (incomingReceiveBatchRef.current?.fromPeerId === peerId) {
      incomingReceiveBatchRef.current = null
    }
    setTransferBatchTotalBytesByPeer((prev) => {
      if (!(peerId in prev)) return prev
      const n = { ...prev }
      delete n[peerId]
      return n
    })
    setOutgoingTransferHint((prev) => {
      if (!(peerId in prev)) return prev
      const next = { ...prev }
      delete next[peerId]
      return next
    })
    setPeers((prev) => {
      const updated = new Map(prev)
      updated.delete(peerId)
      return updated
    })
  }, [])
  const setupDataChannel = useCallback(
    (peerId: string, dataChannel: RTCDataChannel) => {
      dataChannel.binaryType = 'arraybuffer'
      dataChannel.bufferedAmountLowThreshold = DC_SEND_BUFFER_HIGH_WATER
      dataChannel.onopen = () => {
        const peerInRef = peersRef.current.get(peerId)
        if (peerInRef) {
          peerInRef.dataChannel = dataChannel
          peerInRef.status = recomputePeerTransferStatus(peerInRef)
          peerInRef.iceTransportPath = undefined
          peerInRef.iceTransportDetail = undefined
        }
        try {
          const fromUrl = readDisplayNameFromUrl().trim().slice(0, DISPLAY_NAME_MAX_LEN)
          const label = (fromUrl || myPeerNameRef.current.trim()).slice(0, DISPLAY_NAME_MAX_LEN) || getEffectiveDisplayName()
          if (label && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify({ type: 'peer-display', displayName: label }))
          }
        } catch {
          /* ignore */
        }
        setPeers(new Map(peersRef.current))
        refreshIcePathRef.current(peerId)
      }

      dataChannel.onclose = () => {
        rejectPendingTransferRequestsForPeer(peerId, new Error('数据通道已关闭'))
        const peerInRef = peersRef.current.get(peerId)
        if (peerInRef) {
          peerInRef.iceTransportPath = undefined
          peerInRef.iceTransportDetail = undefined
          peerInRef.status = recomputePeerTransferStatus(peerInRef)
          setPeers(new Map(peersRef.current))
        }
      }

      dataChannel.onerror = (error) => {
        const err = (error as RTCErrorEvent).error
        console.error('[DataChannel] Error:', peerId.slice(0, 12), err instanceof Error ? err.message : error)
        const peerInRef = peersRef.current.get(peerId)
        if (peerInRef) {
          peerInRef.iceTransportPath = undefined
          peerInRef.iceTransportDetail = undefined
          peerInRef.status = recomputePeerTransferStatus(peerInRef)
          setPeers(new Map(peersRef.current))
        }
      }

      dataChannel.onmessage = (event) => {
        handleDataChannelMessage(peerId, event.data)
      }
    },
    [handleDataChannelMessage]
  )

  const createPeerConnection = useCallback(
    (peerId: string, isInitiator: boolean): RTCPeerConnection => {
      // Check if connection already exists
      const existingPeer = peersRef.current.get(peerId)
      if (existingPeer) {
        const dn = peerDisplayNamesRef.current.get(peerId)?.trim()
        if (dn && existingPeer.name !== dn) {
          existingPeer.name = dn
          setPeers(new Map(peersRef.current))
        }
        const dt = peerDeviceTypesRef.current.get(peerId)?.trim()
        if (dt && existingPeer.deviceType !== dt) {
          existingPeer.deviceType = dt
          setPeers(new Map(peersRef.current))
        }
        return existingPeer.connection
      }

      const pc = new RTCPeerConnection(rtcConfigRef.current)
      const remoteName = peerDisplayNamesRef.current.get(peerId)?.trim()
      const remoteDeviceSubtitle = peerDeviceTypesRef.current.get(peerId)?.trim()
      const newPeer: Peer = {
        id: peerId,
        name: remoteName || undefined,
        deviceType: remoteDeviceSubtitle || undefined,
        connection: pc,
        status: 'connecting',
        iceCandidates: []
      }

      // Update both ref and state
      peersRef.current.set(peerId, newPeer)
      setPeers((prev) => {
        const updated = new Map(prev)
        updated.set(peerId, newPeer)
        return updated
      })

      // PairDrop sends event.candidate over JSON — use toJSON() so sdpMid / sdpMLineIndex survive socket.io serialization
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          const c = event.candidate
          const payload =
            typeof c.toJSON === 'function'
              ? c.toJSON()
              : {
                  candidate: c.candidate,
                  sdpMid: c.sdpMid,
                  sdpMLineIndex: c.sdpMLineIndex,
                  usernameFragment: c.usernameFragment
                }
          socketRef.current.emit('ice-candidate', {
            targetId: peerId,
            candidate: payload
          })
        }
      }

      pc.onconnectionstatechange = () => {
        const peerInRef = peersRef.current.get(peerId)
        if (peerInRef) {
          const newStatus = recomputePeerTransferStatus(peerInRef)
          peerInRef.status = newStatus
        }

        // Trigger React re-render by creating new Map with current ref values
        setPeers(new Map(peersRef.current))

        // Clean up failed connections
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          setTimeout(() => removePeer(peerId), 1000)
        } else if (pc.connectionState === 'connected' && peerInRef?.dataChannel?.readyState === 'open') {
          refreshIcePathRef.current(peerId)
        }
      }

      pc.oniceconnectionstatechange = () => {
        const peerInRef = peersRef.current.get(peerId)
        if (peerInRef) {
          peerInRef.status = recomputePeerTransferStatus(peerInRef)
          setPeers(new Map(peersRef.current))
        }
      }

      // Data channel handling
      if (isInitiator) {
        // 文件传输依赖顺序：unordered 时 control 与 binary 可能乱序，file-complete 会早于分片触发「分片缺失」
        const dataChannel = pc.createDataChannel('fileTransfer', {
          ordered: true
        })
        setupDataChannel(peerId, dataChannel)
        newPeer.dataChannel = dataChannel
      } else {
        pc.ondatachannel = (event) => {
          setupDataChannel(peerId, event.channel)
          // Update ref then sync to state
          const peerInRef = peersRef.current.get(peerId)
          if (peerInRef) {
            peerInRef.dataChannel = event.channel
          }
          setPeers(new Map(peersRef.current))
        }
      }

      // Create offer if initiator
      if (isInitiator && socketRef.current) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            const d = pc.localDescription
            if (!d?.sdp) {
              console.error('[WebRTC] Missing localDescription after setLocalDescription for:', peerId)
              return
            }
            // Trickle ICE: send offer immediately; extra candidates go via onicecandidate
            socketRef.current?.emit('offer', {
              targetId: peerId,
              offer: { type: d.type, sdp: d.sdp }
            })
          })
          .catch((err) => console.error('[WebRTC] Error creating offer:', err))
      }

      return pc
    },
    [removePeer, setupDataChannel]
  )

  const handleOffer = useCallback(
    async (senderId: string, offer: RTCSessionDescriptionInit) => {
      const pc = createPeerConnection(senderId, false)

      try {
        await pc.setRemoteDescription(offer)

        // Add any buffered ICE candidates
        const peer = peersRef.current.get(senderId)
        if (peer && peer.iceCandidates.length > 0) {
          for (const candidate of peer.iceCandidates) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate))
          }
          peer.iceCandidates = []
        }

        const earlyPending = pendingIceCandidatesRef.current.get(senderId)
        if (earlyPending && earlyPending.length > 0) {
          for (const candidate of earlyPending) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate))
            } catch (e) {
              console.error('[WebRTC] Error adding early ICE candidate:', e)
            }
          }
          pendingIceCandidatesRef.current.delete(senderId)
        }

        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        const d = pc.localDescription
        if (!d?.sdp) {
          console.error('[WebRTC] Missing localDescription after answer for:', senderId)
          return
        }
        socketRef.current?.emit('answer', {
          targetId: senderId,
          answer: { type: d.type, sdp: d.sdp }
        })
      } catch (err) {
        console.error('[WebRTC] Error handling offer:', err)
      }
    },
    [createPeerConnection]
  )

  const handleAnswer = useCallback(async (senderId: string, answer: RTCSessionDescriptionInit) => {
    const peer = peersRef.current.get(senderId)
    if (peer) {
      try {
        await peer.connection.setRemoteDescription(answer)

        if (peer.iceCandidates.length > 0) {
          for (const candidate of peer.iceCandidates) {
            await peer.connection.addIceCandidate(new RTCIceCandidate(candidate))
          }
          peer.iceCandidates = []
        }

        const earlyPending = pendingIceCandidatesRef.current.get(senderId)
        if (earlyPending && earlyPending.length > 0) {
          for (const candidate of earlyPending) {
            try {
              await peer.connection.addIceCandidate(new RTCIceCandidate(candidate))
            } catch (e) {
              console.error('[WebRTC] Error adding early ICE candidate (answer path):', e)
            }
          }
          pendingIceCandidatesRef.current.delete(senderId)
        }
      } catch (err) {
        console.error('[WebRTC] Error handling answer:', err)
      }
    }
  }, [])

  const handleIceCandidate = useCallback(async (senderId: string, candidate: RTCIceCandidateInit) => {
    const peer = peersRef.current.get(senderId)
    if (!peer) {
      const list = pendingIceCandidatesRef.current.get(senderId) ?? []
      list.push(candidate)
      pendingIceCandidatesRef.current.set(senderId, list)
      return
    }
    const candidateStr = candidate.candidate || ''
    if (candidateLooksLikeTunnelFakeIp(candidateStr)) {
      console.warn('[WebRTC] 收到对端含 198.18.x/198.19.x 的候选：对端多半开着 Clash/Surge TUN。请双方关闭 TUN 或退出代理后再连。')
    }

    if (peer.connection.remoteDescription) {
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate))
      } catch (err) {
        console.error('[WebRTC] Error adding ICE candidate:', err)
      }
    } else {
      peer.iceCandidates.push(candidate)
    }
  }, [])
  // Load RTC config (PairDrop-style) then connect signaling — ensures PC uses server iceServers + sdpSemantics
  useEffect(() => {
    if (!roomId || connectingRef.current || socketRef.current?.connected) return

    let cancelled = false
    connectingRef.current = true

    const setupSocket = () => {
      skipSocketDisconnectStateRef.current = false
      signalingChainRef.current = Promise.resolve()

      const enqueueSignaling = (fn: () => Promise<void>) => {
        signalingChainRef.current = signalingChainRef.current.then(() => fn()).catch((e) => console.error('[WebRTC] signaling step failed:', e))
      }

      const newSocket = io(SIGNALING_SERVER, {
        // 每次握手（含自动重连）重新读 sessionStorage，避免首连 `{}` 后无法带上新下发的 hash
        auth: (cb) => {
          cb(loadStoredPeerAuth() ?? {})
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
      })
      socketRef.current = newSocket

      newSocket.on('rtc-config', (cfg: unknown) => {
        rtcConfigRef.current = normalizeRtcConfig(cfg)
      })

      newSocket.on('connect', () => {
        // 第二参为展示名，旧服务端仅读首参 string 仍可进房
        newSocket.emit('join-room', roomId, getEffectiveDisplayName())
      })

      newSocket.on(
        'joined-room',
        ({
          peerId,
          peerIdHash,
          name,
          deviceType,
          peers: existingPeers,
          peerInfos
        }: {
          roomId: string
          peerId: string
          peerIdHash: string
          name?: string
          deviceType?: string
          peers: string[]
          peerInfos?: { id: string; displayName?: string; deviceType?: string }[]
        }) => {
          setSignalingInRoom(true)
          myStablePeerIdRef.current = peerId
          setMyPeerId(peerId)
          setMyPeerName((prev) => {
            const fromUrl = readDisplayNameFromUrl().trim()
            if (fromUrl) return fromUrl.slice(0, DISPLAY_NAME_MAX_LEN)
            const serverName = typeof name === 'string' ? name.trim() : ''
            if (serverName) return serverName.slice(0, DISPLAY_NAME_MAX_LEN)
            return prev || getEffectiveDisplayName()
          })
          if (deviceType) setMyDeviceType(deviceType)
          if (peerIdHash) {
            savePeerAuth(peerId, peerIdHash)
          }

          if (Array.isArray(peerInfos)) {
            for (const row of peerInfos) {
              if (row && typeof row.id === 'string') {
                applyRemoteDisplayName(row.id, typeof row.displayName === 'string' ? row.displayName : '')
                applyRemoteDeviceSubtitle(row.id, typeof row.deviceType === 'string' ? row.deviceType : '')
              }
            }
          }

          if (existingPeers && existingPeers.length > 0) {
            existingPeers.forEach((otherPeerId: string) => {
              if (otherPeerId !== peerId) {
                const shouldInitiate = peerId < otherPeerId
                if (shouldInitiate) {
                  createPeerConnection(otherPeerId, true)
                }
              }
            })
          }
        }
      )

      newSocket.on('peer-joined', (payload: unknown, displayNameArg?: unknown) => {
        let joinedPeerId: string
        let remoteDisplay = ''
        let remoteDeviceSubtitle = ''
        if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'peerId' in payload) {
          const o = payload as { peerId: string; displayName?: string; deviceType?: string }
          joinedPeerId = o.peerId
          remoteDisplay = typeof o.displayName === 'string' ? o.displayName : ''
          remoteDeviceSubtitle = typeof o.deviceType === 'string' ? o.deviceType : ''
        } else if (Array.isArray(payload) && typeof payload[0] === 'string') {
          joinedPeerId = payload[0]
          remoteDisplay = typeof payload[1] === 'string' ? payload[1] : ''
        } else if (typeof payload === 'string') {
          joinedPeerId = payload
          remoteDisplay = typeof displayNameArg === 'string' ? displayNameArg : ''
        } else {
          return
        }
        if (remoteDisplay) applyRemoteDisplayName(joinedPeerId, remoteDisplay)
        if (remoteDeviceSubtitle) applyRemoteDeviceSubtitle(joinedPeerId, remoteDeviceSubtitle)
        const myId = myStablePeerIdRef.current
        if (joinedPeerId === myId) {
          return
        }
        const shouldInitiate = myId < joinedPeerId
        if (shouldInitiate) {
          createPeerConnection(joinedPeerId, true)
        }
      })

      newSocket.on('peer-renamed', (payload: unknown) => {
        if (!payload || typeof payload !== 'object' || !('peerId' in payload)) return
        const o = payload as { peerId: string; displayName?: string }
        if (typeof o.peerId !== 'string') return
        const dn = typeof o.displayName === 'string' ? o.displayName : ''
        if (dn) applyRemoteDisplayName(o.peerId, dn)
      })

      newSocket.on('peer-left', (peerId: string) => {
        removePeer(peerId)
      })

      newSocket.on('offer', ({ senderId, offer }) => {
        enqueueSignaling(() => handleOffer(senderId, offer))
      })

      newSocket.on('answer', ({ senderId, answer }) => {
        enqueueSignaling(() => handleAnswer(senderId, answer))
      })

      newSocket.on('ice-candidate', ({ senderId, candidate }) => {
        enqueueSignaling(() => handleIceCandidate(senderId, candidate))
      })

      newSocket.on('disconnect', () => {
        if (skipSocketDisconnectStateRef.current) {
          return
        }
        rejectAllPendingTransferRequests(new Error('信令已断开，请稍后重试'))
        setSignalingInRoom(false)
        peersRef.current.forEach((p) => p.connection.close())
        peersRef.current.clear()
        pendingIceCandidatesRef.current.clear()
        peerDisplayNamesRef.current.clear()
        peerDeviceTypesRef.current.clear()
        setPeers(new Map())
      })
    }

    void (async () => {
      try {
        rtcConfigRef.current = await fetchRtcConfig()
      } catch {
        rtcConfigRef.current = DEFAULT_RTC_CONFIG
      }
      if (cancelled) {
        connectingRef.current = false
        return
      }
      setupSocket()
    })()

    return () => {
      cancelled = true
      connectingRef.current = false
      signalingChainRef.current = Promise.resolve()
      skipSocketDisconnectStateRef.current = true
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [roomId, createPeerConnection, handleOffer, handleAnswer, handleIceCandidate, removePeer, applyRemoteDisplayName, applyRemoteDeviceSubtitle])

  // Separate cleanup effect for component unmount
  useEffect(() => {
    return () => {
      connectingRef.current = false
      // 后声明的 effect 先清理：若此处只把 ref 置空而不 close，roomId effect 的 cleanup 将无法关闭信令连接
      skipSocketDisconnectStateRef.current = true
      socketRef.current?.close()
      socketRef.current = null
      const peerMap = peersRef.current
      const pendingMap = pendingIceCandidatesRef.current
      const timersMap = receiveAssembleTimersRef.current
      const orphanMap = orphanChunksRef.current
      const buffersMap = receiveBuffersRef.current
      const peersSnapshot = new Map(peerMap)
      peersSnapshot.forEach((peer) => {
        peer.connection.close()
      })
      peerMap.clear()
      pendingMap.clear()
      timersMap.forEach((tid) => clearTimeout(tid))
      timersMap.clear()
      orphanMap.clear()
      buffersMap.clear()
    }
  }, [])

  const sendFile = useCallback(async (file: File, targetPeerId?: string) => {
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const fileSize = getEffectiveDropFileSize(file)
    const stash = getDropReceiveItemStash(file)
    const virtualUrl = stash && typeof stash.url === 'string' && isMalianDropVirtualUrl(stash.url) ? stash.url : null
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE)

    const peersToSend = targetPeerId
      ? (() => {
          const p = peersRef.current.get(targetPeerId)
          if (p && p.status === 'connected' && p.dataChannel?.readyState === 'open') return [p]
          return []
        })()
      : Array.from(peersRef.current.values()).filter((p) => p.status === 'connected' && p.dataChannel?.readyState === 'open')

    if (peersToSend.length === 0) {
      throw new Error('No connected peers available')
    }

    // Initialize transfer progress
    setTransfers((prev) => {
      const updated = new Map(prev)
      updated.set(fileId, {
        fileId,
        fileName: file.name,
        fileSize,
        sentBytes: 0,
        speed: 0,
        status: 'transferring',
        targetPeerId,
        direction: 'sending'
      })
      return updated
    })

    // Send metadata to all target peers
    const metadata = {
      type: 'file-start',
      fileId,
      fileName: file.name,
      fileSize,
      fileType: file.type,
      totalChunks
    }
    console.log('[P2P][发送] file-start', metadata, {
      targetPeerIds: peersToSend.map((p) => p.id),
      virtualUrl: virtualUrl ?? undefined
    })

    const markTransferError = (reason: string) => {
      console.error('[WebRTC] sendFile:', reason)
      setTransfers((prev) => {
        const updated = new Map(prev)
        const transfer = updated.get(fileId)
        if (transfer) {
          transfer.status = 'error'
          updated.set(fileId, transfer)
        }
        return updated
      })
    }

    let virtualReader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let nativeVirtualBridge: PairdropFileBridgeNative | null = null
    let nativeVirtualFileId = ''

    try {
      for (const peer of peersToSend) {
        if (peer.dataChannel?.readyState === 'open') {
          await waitUntilDataChannelCanSend(peer.dataChannel)
          peer.dataChannel.send(JSON.stringify(metadata))
        }
      }

      // Send file chunks
      let sentBytes = 0
      const startTime = Date.now()

      const virtualStreamState = { carry: new Uint8Array(0), streamDone: false }
      if (virtualUrl) {
        const bridge = getPairdropFileBridge()
        const fileId = extractVirtualFileId(virtualUrl)
        if (bridge && fileId) {
          const opened = bridge.open(fileId)
          if (!opened) {
            throw new Error(`原生虚拟文件打开失败: fileId=${fileId}`)
          }
          nativeVirtualBridge = bridge
          nativeVirtualFileId = fileId
          console.log('[P2P][发送] 虚拟文件读取路径=native-bridge', { fileId, fileSize })
        } else {
          const res = await fetch(virtualUrl)
          if (!res.ok) throw new Error(`读取马良虚拟文件失败: ${res.status}`)
          if (!res.body) throw new Error('马良虚拟文件响应无可读流')
          virtualReader = res.body.getReader()
          console.log('[P2P][发送] 虚拟文件读取路径=fetch-stream', { fileSize })
        }
      }

      let lastProgressUiAt = 0
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, fileSize)
        const chunkByteLen = end - start

        const arrayBuffer: ArrayBuffer =
          nativeVirtualBridge != null
            ? base64ChunkToArrayBuffer(nativeVirtualBridge.readChunkBase64(nativeVirtualFileId, chunkByteLen) ?? '', chunkByteLen)
            : virtualReader != null
              ? await readVirtualUrlChunkToBuffer(virtualReader, virtualStreamState, chunkByteLen)
              : await file.slice(start, end).arrayBuffer()

        // Create chunk packet: [fileIdLength: 4 bytes][fileId: N bytes][chunkIndex: 4 bytes][data]
        const fileIdBytes = new TextEncoder().encode(fileId)
        const packet = new ArrayBuffer(4 + fileIdBytes.length + 4 + arrayBuffer.byteLength)
        const view = new DataView(packet)

        view.setUint32(0, fileIdBytes.length)
        new Uint8Array(packet, 4, fileIdBytes.length).set(fileIdBytes)
        view.setUint32(4 + fileIdBytes.length, i)
        new Uint8Array(packet, 8 + fileIdBytes.length).set(new Uint8Array(arrayBuffer))

        for (const peer of peersToSend) {
          if (peer.dataChannel?.readyState === 'open') {
            await waitUntilDataChannelCanSend(peer.dataChannel)
            try {
              peer.dataChannel.send(packet)
            } catch (sendErr) {
              const msg = sendErr instanceof Error ? sendErr.message : String(sendErr)
              throw new Error(`发送分片失败 (${i + 1}/${totalChunks}): ${msg}`)
            }
          }
        }

        sentBytes += arrayBuffer.byteLength
        const elapsed = (Date.now() - startTime) / 1000
        const speed = elapsed > 0 ? sentBytes / elapsed : 0

        const now = Date.now()
        if (now - lastProgressUiAt >= SEND_PROGRESS_UI_MIN_MS || i === totalChunks - 1) {
          lastProgressUiAt = now
          setTransfers((prev) => {
            const updated = new Map(prev)
            const transfer = updated.get(fileId)
            if (transfer) {
              transfer.sentBytes = sentBytes
              transfer.speed = speed
            }
            return updated
          })
        }
      }

      for (const peer of peersToSend) {
        if (peer.dataChannel?.readyState === 'open') {
          await waitUntilDataChannelCanSend(peer.dataChannel)
          peer.dataChannel.send(JSON.stringify({ type: 'file-complete', fileId }))
        }
      }

      console.log('[P2P][发送] file-complete 已发', { fileId, fileName: file.name, sentBytes, targetPeerIds: peersToSend.map((p) => p.id) })

      setTransfers((prev) => {
        const updated = new Map(prev)
        const transfer = updated.get(fileId)
        if (transfer) {
          transfer.status = 'completed'
        }
        return updated
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      markTransferError(msg)
      throw e
    } finally {
      try {
        if (virtualReader) await virtualReader.cancel().catch(() => {})
      } catch {
        /* ignore */
      }
      try {
        if (nativeVirtualBridge && nativeVirtualFileId) {
          nativeVirtualBridge.close(nativeVirtualFileId)
        }
      } catch {
        /* ignore */
      }
    }

    return fileId
  }, [])

  const sendFilesBatch = useCallback(
    async (files: File[], targetPeerId: string) => {
      const peer = peersRef.current.get(targetPeerId)
      if (!peer || peer.status !== 'connected' || peer.dataChannel?.readyState !== 'open') {
        throw new Error('Peer not connected')
      }

      for (const entry of pendingRequestsRef.current.values()) {
        if (entry.peerId === targetPeerId) {
          throw new Error('该设备已有待确认的传输请求')
        }
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
      const filesInfo = files.map((f) => ({ name: f.name, size: getEffectiveDropFileSize(f) }))

      setTransfers((prev) => {
        const u = new Map(prev)
        for (const [id, t] of u) {
          if (t.direction === 'sending' && t.targetPeerId === targetPeerId) u.delete(id)
        }
        return u
      })

      // Send transfer request
      const requestMessage = {
        type: 'transfer-request',
        requestId,
        filesInfo
      }
      console.log('[P2P][发送] transfer-request', { targetPeerId, requestMessage })

      updateOutgoingHint(targetPeerId, 'waiting')

      await waitUntilDataChannelCanSend(peer.dataChannel)
      peer.dataChannel.send(JSON.stringify(requestMessage))

      // Wait for response
      try {
        await new Promise<void>((resolve, reject) => {
          pendingRequestsRef.current.set(requestId, { peerId: targetPeerId, resolve, reject })
          setTimeout(() => {
            if (pendingRequestsRef.current.has(requestId)) {
              pendingRequestsRef.current.delete(requestId)
              reject(new Error('Transfer request timeout'))
            }
          }, 60000)
        })
      } catch (e) {
        updateOutgoingHint(targetPeerId, null)
        const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e)
        if (msg === 'User rejected the transfer') {
          updateOutgoingHint(targetPeerId, 'rejected')
          window.setTimeout(() => updateOutgoingHint(targetPeerId, null), 2000)
        }
        throw e
      }

      updateOutgoingHint(targetPeerId, null)

      const batchTotalBytes = files.reduce((s, f) => s + getEffectiveDropFileSize(f), 0)
      setTransferBatchTotalBytesByPeer((prev) => ({ ...prev, [targetPeerId]: batchTotalBytes }))

      try {
        for (const file of files) {
          await sendFile(file, targetPeerId)
        }
        updateOutgoingHint(targetPeerId, 'completed')
        window.setTimeout(() => updateOutgoingHint(targetPeerId, null), 2000)
      } finally {
        setTransfers((prev) => {
          const u = new Map(prev)
          for (const [id, t] of u) {
            if (t.direction === 'sending' && t.targetPeerId === targetPeerId) u.delete(id)
          }
          return u
        })
        setTransferBatchTotalBytesByPeer((prev) => {
          if (!(targetPeerId in prev)) return prev
          const n = { ...prev }
          delete n[targetPeerId]
          return n
        })
      }
    },
    [sendFile, updateOutgoingHint]
  )

  const acknowledgeReceivedModal = useCallback(() => {
    setReceivedModalPayload(null)
  }, [])

  /** 释放已处理完毕的 receivedFiles Blob 引用，避免 WebView 内存持续累积 */
  const releaseReceivedFiles = useCallback((fileIds: string[]) => {
    if (fileIds.length === 0) return
    const idSet = new Set(fileIds)
    setReceivedFiles((prev) => {
      const next = prev.filter((f) => !idSet.has(f.id))
      receivedFilesRef.current = next
      return next
    })
  }, [])

  const respondToTransferRequest = useCallback((requestId: string, accepted: boolean) => {
    setIncomingRequests((prev) => {
      const request = prev.find((r) => r.requestId === requestId)
      if (request) {
        const peer = peersRef.current.get(request.fromPeerId)
        if (peer && peer.dataChannel?.readyState === 'open') {
          peer.dataChannel.send(
            JSON.stringify({
              type: 'transfer-response',
              requestId,
              accepted
            })
          )
        }
        if (accepted) {
          setTransfers((p) => {
            const u = new Map(p)
            for (const [id, t] of u) {
              if (t.direction === 'receiving' && t.targetPeerId === request.fromPeerId) u.delete(id)
            }
            return u
          })
          const recvBatchBytes = request.filesInfo.reduce((s, info) => s + info.size, 0)
          setTransferBatchTotalBytesByPeer((prev) => ({ ...prev, [request.fromPeerId]: recvBatchBytes }))
          incomingReceiveBatchRef.current = {
            fromPeerId: request.fromPeerId,
            total: request.filesInfo.length,
            completed: 0,
            sliceStart: receivedFilesRef.current.length
          }
        }
      }
      return prev.filter((r) => r.requestId !== requestId)
    })
  }, [])

  const downloadFile = useCallback((file: ReceivedFile) => {
    try {
      triggerBrowserDownload(file.blob, file.name, file.type)
    } catch (e) {
      console.error('[WebRTC] downloadFile 失败:', e)
    }
  }, [])

  const downloadReceivedFiles = useCallback((files: ReceivedFile[]) => {
    try {
      if (files.length === 0) return
      triggerBrowserDownloads(
        files.map((f) => ({ blob: f.blob, filename: f.name, mimeHint: f.type })),
        { albumOriented: true }
      )
    } catch (e) {
      console.error('[WebRTC] downloadReceivedFiles 失败:', e)
    }
  }, [])

  const setMyDisplayName = useCallback((raw: string) => {
    const trimmed = raw.trim().slice(0, DISPLAY_NAME_MAX_LEN)
    const finalName = trimmed || '访客'
    setMyPeerName(finalName)
    myPeerNameRef.current = finalName
    persistRandomCnNickname(finalName)
    const sock = socketRef.current
    if (sock?.connected) {
      sock.emit('update-display-name', finalName)
    }
    for (const [, p] of peersRef.current) {
      const dc = p.dataChannel
      if (dc?.readyState === 'open') {
        try {
          dc.send(JSON.stringify({ type: 'peer-display', displayName: finalName }))
        } catch {
          /* ignore */
        }
      }
    }
  }, [])

  const p2pFileTransferReady = Array.from(peers.values()).some((p) => p.dataChannel?.readyState === 'open')

  return {
    myPeerId,
    myPeerName,
    setMyDisplayName,
    myDeviceType,
    peers: Array.from(peers.values()),
    transfers: Array.from(transfers.values()),
    receivedFiles,
    signalingInRoom,
    p2pFileTransferReady,
    sendFile,
    sendFilesBatch,
    incomingRequests,
    outgoingTransferHint,
    respondToTransferRequest,
    downloadFile,
    downloadReceivedFiles,
    receivedModalPayload,
    acknowledgeReceivedModal,
    releaseReceivedFiles,
    transferBatchTotalBytesByPeer
  }
}
