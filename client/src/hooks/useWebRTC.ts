import { generateCuteNickname } from 'cute-nickname'
import { useCallback, useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

import { describeFileForLog } from '../utils/app-drop-protocol'
import { triggerBrowserDownload } from '../utils/triggerDownload'

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

/**
 * 展示名：地址栏 `name` 优先；否则会话内固定一条 cute-nickname 生成的中文昵称（刷新不丢，关标签后重开再生成）
 */
export function getEffectiveDisplayName(): string {
  const fromUrl = readDisplayNameFromUrl().trim().slice(0, 64)
  if (fromUrl) return fromUrl
  try {
    const cached = sessionStorage.getItem(SESSION_RANDOM_CN_NICKNAME_KEY)?.trim()
    if (cached) return cached.slice(0, 64)
  } catch {
    /* ignore */
  }
  let created = generateCuteNickname({ withEmoji: false })
  created = created.trim().slice(0, 64)
  if (!created) {
    created = '访客'
  }
  try {
    sessionStorage.setItem(SESSION_RANDOM_CN_NICKNAME_KEY, created)
  } catch {
    /* ignore */
  }
  return created
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
  const [myDeviceType, setMyDeviceType] = useState<string>('')
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map())
  const [transfers, setTransfers] = useState<Map<string, TransferProgress>>(new Map())
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([])
  const [incomingRequests, setIncomingRequests] = useState<TransferRequest[]>([])
  /** 发送端：各对端设备上的传输提示（与 RadarView 展示同步） */
  const [outgoingTransferHint, setOutgoingTransferHint] = useState<Record<string, OutgoingTransferHint>>({})
  /** 信令（Socket）已加入房间；与 WebRTC 是否可传文件无关 */
  const [signalingInRoom, setSignalingInRoom] = useState(false)

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
      setMyPeerName(fromUrl.slice(0, 64))
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
  const receivedChunksRef = useRef<Map<string, Map<number, ArrayBuffer>>>(new Map())
  /** 分片早于 file-start 到达时暂存（unordered DC） */
  const orphanChunksRef = useRef<Map<string, Map<number, ArrayBuffer>>>(new Map())
  const receiveAssembleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const fileMetadataRef = useRef<Map<string, { name: string; size: number; type: string; totalChunks: number; fromPeerId: string }>>(new Map())
  const pendingRequestsRef = useRef<Map<string, { peerId: string; resolve: () => void; reject: (reason: unknown) => void }>>(new Map())

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
    const trimmed = displayName.trim().slice(0, 64)
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
    refreshIcePathRef.current = (peerId: string) => {
      const run = async () => {
        const p = peersRef.current.get(peerId)
        if (!p?.connection || p.connection.connectionState === 'closed') return
        const { path, detail } = await detectIceTransportPath(p.connection)
        const cur = peersRef.current.get(peerId)
        if (!cur || cur.connection !== p.connection) return
        const pathCn = path === 'relay' ? 'TURN 中继' : path === 'direct' ? '直联(非 relay)' : '未知'
        setPeers((prev) => {
          const newPeers = new Map(prev)
          const currentPeer = newPeers.get(peerId)
          if (currentPeer && currentPeer.connection === p.connection && (currentPeer.iceTransportPath !== path || currentPeer.iceTransportDetail !== detail)) {
            currentPeer.iceTransportPath = path
            currentPeer.iceTransportDetail = detail
            console.log('[WebRTC] 对端', peerId.slice(0, 12), '传输路径:', pathCn, '|', detail)
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
      receivedChunksRef.current.delete(fileId)
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
      const chunks = receivedChunksRef.current.get(fileId)
      if (!metadata || !chunks) return 'aborted'

      for (let i = 0; i < metadata.totalChunks; i++) {
        if (!chunks.has(i)) return 'incomplete'
      }

      const orderedChunks: ArrayBuffer[] = []
      for (let i = 0; i < metadata.totalChunks; i++) {
        orderedChunks.push(chunks.get(i)!)
      }

      const blob = new Blob(orderedChunks, { type: metadata.type })
      const receivedFile: ReceivedFile = {
        id: fileId,
        name: metadata.name,
        size: metadata.size,
        type: metadata.type,
        blob,
        fromPeerId: metadata.fromPeerId,
        timestamp: Date.now()
      }

      clearReceiveAssembleTimer(fileId)
      orphanChunksRef.current.delete(fileId)
      setReceivedFiles((prev) => [...prev, receivedFile])
      setTransfers((prev) => {
        const updated = new Map(prev)
        const transfer = updated.get(fileId)
        if (transfer) {
          transfer.status = 'completed'
          transfer.sentBytes = metadata.size
          updated.set(fileId, transfer)
        }
        return updated
      })
      fileMetadataRef.current.delete(fileId)
      receivedChunksRef.current.delete(fileId)
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
        const chunks = receivedChunksRef.current.get(fileId)
        const got = chunks?.size ?? 0
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
            applyRemoteDisplayName(peerId, dn)
            return
          }
          if (message.type === 'transfer-request') {
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
            // Initialize file reception
            const fileId = message.fileId
            fileMetadataRef.current.set(fileId, {
              name: message.fileName,
              size: message.fileSize,
              type: message.fileType,
              totalChunks: message.totalChunks,
              fromPeerId: peerId
            })
            receivedChunksRef.current.set(fileId, new Map())
            const bucket = receivedChunksRef.current.get(fileId)!
            const orphans = orphanChunksRef.current.get(fileId)
            if (orphans) {
              orphanChunksRef.current.delete(fileId)
              orphans.forEach((buf, idx) => {
                bucket.set(idx, buf)
              })
            }

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

        const chunks = receivedChunksRef.current.get(fileId)
        if (chunks) {
          chunks.set(chunkIndex, chunkBuf)

          const metadata = fileMetadataRef.current.get(fileId)
          if (metadata) {
            let receivedBytes = 0
            chunks.forEach((buf) => {
              receivedBytes += buf.byteLength
            })
            setTransfers((prev) => {
              const updated = new Map(prev)
              const transfer = updated.get(fileId)
              if (transfer) {
                transfer.sentBytes = Math.min(receivedBytes, metadata.size)
              }
              return updated
            })

            if (chunks.size === metadata.totalChunks) {
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
    console.log('[WebRTC] Removing peer:', peerId)
    rejectPendingTransferRequestsForPeer(peerId, new Error('对端已断开连接'))
    const peer = peersRef.current.get(peerId)
    if (peer) {
      peer.connection.close()
      peersRef.current.delete(peerId)
    }
    pendingIceCandidatesRef.current.delete(peerId)
    peerDisplayNamesRef.current.delete(peerId)
    peerDeviceTypesRef.current.delete(peerId)
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
        console.log('[DataChannel] Opened with:', peerId)
        const peerInRef = peersRef.current.get(peerId)
        if (peerInRef) {
          peerInRef.dataChannel = dataChannel
          peerInRef.status = recomputePeerTransferStatus(peerInRef)
          peerInRef.iceTransportPath = undefined
          peerInRef.iceTransportDetail = undefined
        }
        try {
          const label = getEffectiveDisplayName()
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
        console.log('[DataChannel] Closed with:', peerId)
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
        console.log('[WebRTC] Connection to', peerId, 'already exists, reusing')
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

      console.log('[WebRTC] Creating connection to', peerId, 'isInitiator:', isInitiator)

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

      pc.onicecandidateerror = (e) => {
        const ev = e as RTCPeerConnectionIceErrorEvent
        const isTurn = typeof ev.url === 'string' && /^(turn|turns):/i.test(ev.url)
        // console.warn('[WebRTC] ICE candidate error:', peerId, {
        //   code: ev.errorCode,
        //   text: ev.errorText,
        //   url: ev.url,
        //   address: ev.address,
        //   port: ev.port
        // })
        if (ev.errorCode === 701 && isTurn) {
          // console.warn('[WebRTC] 701：连不上该 TURN。公网 TURN 常被墙；本地像 PairDrop 一样只配 STUN 即可。需要中继时请自建 coturn 并设置 RTC_CONFIG（见 server/rtc_config.example.json）。')
        } else if (ev.errorCode === 701 && !isTurn) {
          // console.warn('[WebRTC] 701：STUN binding 超时（常见于 IPv6 或网络抖动）。已内置多 STUN；若仍慢请检查防火墙/代理或部署 TURN。')
        }
      }

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
          const candidateStr = c.candidate ?? ''
          const type = candidateStr.includes('typ host') ? 'host' : candidateStr.includes('typ srflx') ? 'srflx' : candidateStr.includes('typ relay') ? 'relay' : 'unknown'
          const ipMatch = candidateStr.match(/([0-9]{1,3}\.){3}[0-9]{1,3}/)
          const ip = ipMatch ? ipMatch[0] : 'unknown'
          if (candidateStr.includes('.local')) {
            // console.warn(
            //   '[WebRTC] 发现 mDNS 候选 (.local)。本机双浏览器/多内核时，对端常无法解析该主机名，ICE 会失败。请在 Chrome 打开 chrome://flags 搜索「WebRTC」关闭「隐藏本地 IP」/ mDNS，或两台设备用同一 WiFi + 局域网 IP 访问。'
            // )
          }
          if (candidateLooksLikeTunnelFakeIp(candidateStr)) {
            // console.warn(
            //   '[WebRTC] 发现 host 候选落在 198.18.x/198.19.x（多为 Clash / Surge / VPN 的 TUN 或 Fake-IP）。这会导致与对端 127.0.0.1/局域网 host 候选无法配对。请关闭 TUN 模式、改用规则/系统代理、或临时退出代理后再试 WebRTC。'
            // )
          }
          console.log('[WebRTC] Sending ICE candidate to:', peerId, 'type:', type, 'ip:', ip)
          socketRef.current.emit('ice-candidate', {
            targetId: peerId,
            candidate: payload
          })
        } else if (!event.candidate) {
          console.log('[WebRTC] ICE gathering complete for:', peerId)
        }
      }

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] Connection state with ${peerId}:`, pc.connectionState)

        const peerInRef = peersRef.current.get(peerId)
        if (peerInRef) {
          const newStatus = recomputePeerTransferStatus(peerInRef)
          peerInRef.status = newStatus
          console.log(`[WebRTC] Updated peer ${peerId} status to ${newStatus}, ref size:`, peersRef.current.size)
        }

        // Trigger React re-render by creating new Map with current ref values
        setPeers(new Map(peersRef.current))
        console.log(`[WebRTC] Triggered state update, new Map size:`, peersRef.current.size)

        // Clean up failed connections
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          setTimeout(() => removePeer(peerId), 1000)
        } else if (pc.connectionState === 'connected' && peerInRef?.dataChannel?.readyState === 'open') {
          refreshIcePathRef.current(peerId)
        }
      }

      pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState
        console.log(`[WebRTC] ICE state with ${peerId}:`, s)
        if (s === 'failed') {
          // console.warn(
          //   '[WebRTC] ICE 失败常见原因：① 若 host 出现 198.18.x（见上文警告）→ 关掉 Clash/Surge TUN 或 Fake-IP；② 对称 NAT（仅 srflx、无 relay）→ coturn + RTC_CONFIG；③ mDNS（.local）→ Chrome 关闭 WebRTC 隐藏本地 IP；④ 本机测试用 http://127.0.0.1:5173 双标签。'
          // )
        }
        const peerInRef = peersRef.current.get(peerId)
        if (peerInRef) {
          peerInRef.status = recomputePeerTransferStatus(peerInRef)
          setPeers(new Map(peersRef.current))
        }
      }

      pc.onicegatheringstatechange = () => {
        console.log(`[WebRTC] ICE gathering state with ${peerId}:`, pc.iceGatheringState)
      }

      pc.onsignalingstatechange = () => {
        console.log(`[WebRTC] Signaling state with ${peerId}:`, pc.signalingState)
      }

      // Data channel handling
      if (isInitiator) {
        // 文件传输依赖顺序：unordered 时 control 与 binary 可能乱序，file-complete 会早于分片触发「分片缺失」
        const dataChannel = pc.createDataChannel('fileTransfer', {
          ordered: true
        })
        console.log('[WebRTC] Created data channel for:', peerId, 'readyState:', dataChannel.readyState)
        setupDataChannel(peerId, dataChannel)
        newPeer.dataChannel = dataChannel
      } else {
        pc.ondatachannel = (event) => {
          console.log('[WebRTC] Received data channel from:', peerId, 'channel:', event.channel.label, 'readyState:', event.channel.readyState)
          setupDataChannel(peerId, event.channel)
          // Update ref then sync to state
          const peerInRef = peersRef.current.get(peerId)
          if (peerInRef) {
            peerInRef.dataChannel = event.channel
            console.log('[WebRTC] Updated peer in ref with data channel, status:', peerInRef.status)
          }
          setPeers(new Map(peersRef.current))
        }
      }

      // Create offer if initiator
      if (isInitiator && socketRef.current) {
        console.log('[WebRTC] Creating offer for:', peerId)
        pc.createOffer()
          .then((offer) => {
            console.log('[WebRTC] Setting local description for:', peerId)
            return pc.setLocalDescription(offer)
          })
          .then(() => {
            const d = pc.localDescription
            if (!d?.sdp) {
              console.error('[WebRTC] Missing localDescription after setLocalDescription for:', peerId)
              return
            }
            // Trickle ICE: send offer immediately; extra candidates go via onicecandidate
            console.log('[WebRTC] Emitting offer (trickle) to:', peerId, 'gathering:', pc.iceGatheringState)
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
      console.log('[WebRTC] Handling offer from:', senderId)
      const pc = createPeerConnection(senderId, false)

      try {
        await pc.setRemoteDescription(offer)
        console.log('[WebRTC] Set remote description for:', senderId)

        // Add any buffered ICE candidates
        const peer = peersRef.current.get(senderId)
        if (peer && peer.iceCandidates.length > 0) {
          console.log('[WebRTC] Adding', peer.iceCandidates.length, 'buffered ICE candidates for:', senderId)
          for (const candidate of peer.iceCandidates) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate))
          }
          peer.iceCandidates = []
        }

        const earlyPending = pendingIceCandidatesRef.current.get(senderId)
        if (earlyPending && earlyPending.length > 0) {
          console.log('[WebRTC] Adding', earlyPending.length, 'early trickle ICE candidates for:', senderId)
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
        console.log('[WebRTC] Sending answer (trickle) to:', senderId, 'gathering:', pc.iceGatheringState)
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
    console.log('[WebRTC] Handling answer from:', senderId)
    const peer = peersRef.current.get(senderId)
    if (peer) {
      try {
        await peer.connection.setRemoteDescription(answer)
        console.log('[WebRTC] Set remote description (answer) for:', senderId)

        if (peer.iceCandidates.length > 0) {
          console.log('[WebRTC] Adding', peer.iceCandidates.length, 'buffered ICE candidates for:', senderId)
          for (const candidate of peer.iceCandidates) {
            await peer.connection.addIceCandidate(new RTCIceCandidate(candidate))
          }
          peer.iceCandidates = []
        }

        const earlyPending = pendingIceCandidatesRef.current.get(senderId)
        if (earlyPending && earlyPending.length > 0) {
          console.log('[WebRTC] Adding', earlyPending.length, 'early trickle ICE (after answer) for:', senderId)
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
    } else {
      // console.warn('[WebRTC] No peer found for answer from:', senderId)
    }
  }, [])

  const handleIceCandidate = useCallback(async (senderId: string, candidate: RTCIceCandidateInit) => {
    const peer = peersRef.current.get(senderId)
    if (!peer) {
      const list = pendingIceCandidatesRef.current.get(senderId) ?? []
      list.push(candidate)
      pendingIceCandidatesRef.current.set(senderId, list)
      console.log('[WebRTC] Buffering ICE before peer exists for:', senderId, 'total:', list.length)
      return
    }
    const candidateStr = candidate.candidate || ''
    if (candidateLooksLikeTunnelFakeIp(candidateStr)) {
      console.warn('[WebRTC] 收到对端含 198.18.x/198.19.x 的候选：对端多半开着 Clash/Surge TUN。请双方关闭 TUN 或退出代理后再连。')
    }
    const type = candidateStr.includes('typ host') ? 'host' : candidateStr.includes('typ srflx') ? 'srflx' : candidateStr.includes('typ relay') ? 'relay' : 'unknown'
    const ipMatch = candidateStr.match(/([0-9]{1,3}\.){3}[0-9]{1,3}/)
    const ip = ipMatch ? ipMatch[0] : 'unknown'

    if (peer.connection.remoteDescription) {
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate))
        console.log('[WebRTC] Added ICE candidate for:', senderId, 'type:', type, 'ip:', ip)
      } catch (err) {
        console.error('[WebRTC] Error adding ICE candidate:', err)
      }
    } else {
      console.log('[WebRTC] Buffering ICE candidate for:', senderId, 'type:', type, 'ip:', ip)
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
        console.log('[WebRTC] rtc-config updated from signaling')
      })

      newSocket.on('connect', () => {
        console.log('[Socket] Connected: socket.id=', newSocket.id, 'emit join-room')
        // 第二参为展示名，旧服务端仅读首参 string 仍可进房
        newSocket.emit('join-room', roomId, getEffectiveDisplayName())
      })

      newSocket.on(
        'joined-room',
        ({
          roomId: joinedRoomId,
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
          console.log('[Socket] Joined room:', joinedRoomId, 'as stable peerId', peerId)
          setSignalingInRoom(true)
          myStablePeerIdRef.current = peerId
          setMyPeerId(peerId)
          setMyPeerName((prev) => {
            const fromUrl = readDisplayNameFromUrl().trim()
            if (fromUrl) return fromUrl.slice(0, 64)
            const serverName = typeof name === 'string' ? name.trim() : ''
            if (serverName) return serverName.slice(0, 64)
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
            console.log('[Socket] Connecting to existing peers:', existingPeers)
            existingPeers.forEach((otherPeerId: string) => {
              if (otherPeerId !== peerId) {
                const shouldInitiate = peerId < otherPeerId
                console.log(`[Socket] Peer ${otherPeerId}: shouldInitiate=${shouldInitiate} (myId=${peerId})`)
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
        console.log('[Socket] Peer joined:', joinedPeerId, remoteDisplay ? `name=${remoteDisplay}` : '')
        if (remoteDisplay) applyRemoteDisplayName(joinedPeerId, remoteDisplay)
        if (remoteDeviceSubtitle) applyRemoteDeviceSubtitle(joinedPeerId, remoteDeviceSubtitle)
        const myId = myStablePeerIdRef.current
        if (joinedPeerId === myId) {
          console.log('[Socket] Ignoring self join')
          return
        }
        const shouldInitiate = myId < joinedPeerId
        console.log(`[Socket] Peer ${joinedPeerId} joined: shouldInitiate=${shouldInitiate} (myStableId=${myId})`)
        if (shouldInitiate) {
          createPeerConnection(joinedPeerId, true)
        }
      })

      newSocket.on('peer-left', (peerId: string) => {
        console.log('[Socket] Peer left:', peerId)
        removePeer(peerId)
      })

      newSocket.on('offer', ({ senderId, offer }) => {
        console.log('[Socket] Received offer from:', senderId)
        enqueueSignaling(() => handleOffer(senderId, offer))
      })

      newSocket.on('answer', ({ senderId, answer }) => {
        console.log('[Socket] Received answer from:', senderId)
        enqueueSignaling(() => handleAnswer(senderId, answer))
      })

      newSocket.on('ice-candidate', ({ senderId, candidate }) => {
        enqueueSignaling(() => handleIceCandidate(senderId, candidate))
      })

      newSocket.on('disconnect', () => {
        if (skipSocketDisconnectStateRef.current) {
          console.log('[Socket] Disconnected (intentional cleanup)')
          return
        }
        console.log('[Socket] Disconnected')
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
        console.log('[WebRTC] rtc-config loaded via HTTP')
      } catch (e) {
        // console.warn('[WebRTC] rtc-config fetch failed, using default:', e)
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
      console.log('[Socket] Cleanup - disconnecting')
      skipSocketDisconnectStateRef.current = true
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [roomId, createPeerConnection, handleOffer, handleAnswer, handleIceCandidate, removePeer, applyRemoteDisplayName, applyRemoteDeviceSubtitle])

  // Separate cleanup effect for component unmount
  useEffect(() => {
    return () => {
      console.log('[WebRTC] Component unmounting, cleaning up')
      connectingRef.current = false
      // 后声明的 effect 先清理：若此处只把 ref 置空而不 close，roomId effect 的 cleanup 将无法关闭信令连接
      skipSocketDisconnectStateRef.current = true
      socketRef.current?.close()
      socketRef.current = null
      const peerMap = peersRef.current
      const pendingMap = pendingIceCandidatesRef.current
      const peersSnapshot = new Map(peerMap)
      peersSnapshot.forEach((peer) => {
        peer.connection.close()
      })
      peerMap.clear()
      pendingMap.clear()
      receiveAssembleTimersRef.current.forEach((tid) => clearTimeout(tid))
      receiveAssembleTimersRef.current.clear()
      orphanChunksRef.current.clear()
    }
  }, [])

  const sendFile = useCallback(async (file: File, targetPeerId?: string) => {
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

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
        fileSize: file.size,
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
      fileSize: file.size,
      fileType: file.type,
      totalChunks
    }

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

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, file.size)
        const chunk = file.slice(start, end)
        const arrayBuffer = await chunk.arrayBuffer()

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

      for (const peer of peersToSend) {
        if (peer.dataChannel?.readyState === 'open') {
          await waitUntilDataChannelCanSend(peer.dataChannel)
          peer.dataChannel.send(JSON.stringify({ type: 'file-complete', fileId }))
        }
      }

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
    }

    return fileId
  }, [])

  const sendFilesBatch = useCallback(
    async (files: File[], targetPeerId: string) => {
      console.log('[WebRTC] sendFilesBatch 待发送文件列表', {
        targetPeerId,
        count: files.length,
        files: files.map(describeFileForLog)
      })

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
      const filesInfo = files.map((f) => ({ name: f.name, size: f.size }))

      // Send transfer request
      const requestMessage = {
        type: 'transfer-request',
        requestId,
        filesInfo
      }

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

      for (const file of files) {
        await sendFile(file, targetPeerId)
      }

      updateOutgoingHint(targetPeerId, 'completed')
      window.setTimeout(() => updateOutgoingHint(targetPeerId, null), 2000)
    },
    [sendFile, updateOutgoingHint]
  )

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
      }
      return prev.filter((r) => r.requestId !== requestId)
    })
  }, [])

  const downloadFile = useCallback((file: ReceivedFile) => {
    console.log('[WebRTC] downloadFile:', file)
    try {
      triggerBrowserDownload(file.blob, file.name)
    } catch (e) {
      console.error('[WebRTC] downloadFile 失败:', e)
    }
  }, [])

  const p2pFileTransferReady = Array.from(peers.values()).some((p) => p.dataChannel?.readyState === 'open')

  return {
    myPeerId,
    myPeerName,
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
    downloadFile
  }
}
