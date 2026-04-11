import dayjs from 'dayjs'

import { DropReceiveFileItem } from './app-drop-protocol'

/** 原生回调：入参为原生回传的任意 JSON/字符串等 */
export type JSBridgeCallback = (data?: unknown) => void

/** 与 WKWebViewJavascriptBridge 消息结构对齐的松散描述（仅文档/扩展用） */
export interface JSBridgeMessage {
  handlerName?: string
  data?: unknown
  callbackId?: string
  responseId?: string
  responseData?: unknown
}

/** H5 通过 registerHandler 暴露给原生的处理函数 */
export type JSBridgeHandler = (data?: unknown, callback?: JSBridgeCallback) => void

/** 原生注入对象上常见方法签名（各宿主实现略有差异，用 unknown 收口） */
interface WebViewJavascriptBridgeAPI {
  callHandler: (handlerName: string, data?: unknown, callback?: JSBridgeCallback) => void
  registerHandler: (handlerName: string, handler: JSBridgeHandler) => void
  /** Android lzyzsd 等实现需要调用 init 才能建立 Native→JS 消息通道，iOS WK 可能无此方法 */
  init?: (defaultHandler: (message: unknown, responseCallback?: JSBridgeCallback) => void) => void
}

interface WindowWithJSBridge extends Window {
  WebViewJavascriptBridge?: WebViewJavascriptBridgeAPI
  WVJBCallbacks?: JSBridgeCallback[]
}

/** 轮询等待 Bridge 注入的最大时长（ms） */
const BRIDGE_POLL_TIMEOUT = 8000
/** 轮询间隔（ms） */
const BRIDGE_POLL_INTERVAL = 50

class JsBridge {
  private static instance: JsBridge
  private window: WindowWithJSBridge = window as WindowWithJSBridge
  private isReady = false
  private readyCallbacks: (() => void)[] = []
  // 存储多个 handler，支持同名 handler 不被覆盖
  private handlersMap: Map<string, Set<JSBridgeHandler>> = new Map()
  // 记录已向原生注册的 handler
  private registeredToNative: Set<string> = new Set()
  private bridgePollTimer: ReturnType<typeof setInterval> | null = null
  private bridgePollTimeout: ReturnType<typeof setTimeout> | null = null

  private constructor() {
    this.setupBridge()
  }

  static getInstance(): JsBridge {
    if (!JsBridge.instance) {
      JsBridge.instance = new JsBridge()
    }
    return JsBridge.instance
  }

  /**
   * 设置WKWebViewJavascriptBridge
   */
  private setupBridge(): void {
    console.log('[JsBridge] 开始设置 JsBridge')

    if (this.window.WebViewJavascriptBridge) {
      console.log('[JsBridge] WebViewJavascriptBridge 已存在，直接初始化')
      this.initBridge()
      return
    }

    if (this.window.WVJBCallbacks) {
      console.log('[JsBridge] WVJBCallbacks 已存在，添加回调')
      this.window.WVJBCallbacks.push(() => this.initBridge())
      this.startBridgePoll()
      return
    }

    console.log('[JsBridge] 创建 WVJBCallbacks 并触发 bridge 加载')
    this.window.WVJBCallbacks = [() => this.initBridge()]

    // 创建iframe触发bridge初始化
    const WVJBIframe = document.createElement('iframe')
    WVJBIframe.style.display = 'none'
    WVJBIframe.src = 'https://__bridge_loaded__'
    document.documentElement.appendChild(WVJBIframe)
    setTimeout(() => {
      document.documentElement.removeChild(WVJBIframe)
    }, 0)
    this.startBridgePoll()
  }

  /**
   * 轮询等待延后注入的 WebViewJavascriptBridge（原生可能不调用 WVJBCallbacks）
   */
  private startBridgePoll(): void {
    if (this.isReady) return
    this.bridgePollTimer = setInterval(() => {
      if (this.isReady) {
        this.clearBridgePoll()
        return
      }
      if (this.window.WebViewJavascriptBridge) {
        console.log('[JsBridge] 轮询检测到 WebViewJavascriptBridge 已注入')
        this.clearBridgePoll()
        this.initBridge()
        return
      }
    }, BRIDGE_POLL_INTERVAL)
    this.bridgePollTimeout = setTimeout(() => {
      this.clearBridgePoll()
      if (!this.isReady) {
        console.warn('[JsBridge] 等待 WebViewJavascriptBridge 超时')
      }
    }, BRIDGE_POLL_TIMEOUT)
  }

  private clearBridgePoll(): void {
    if (this.bridgePollTimer !== null) {
      clearInterval(this.bridgePollTimer)
      this.bridgePollTimer = null
    }
    if (this.bridgePollTimeout !== null) {
      clearTimeout(this.bridgePollTimeout)
      this.bridgePollTimeout = null
    }
  }

  /**
   * 初始化bridge
   * iOS WK 通常无 init；Android（如 lzyzsd）需调用 init 才能建立 Native→JS 通道，有则调用不影响其他宿主
   */
  private initBridge(): void {
    console.log('[JsBridge] 初始化 bridge')
    this.clearBridgePoll()

    if (this.window.WebViewJavascriptBridge) {
      console.log('[JsBridge] WebViewJavascriptBridge 可用，设置为就绪状态')

      // 包装原生的 registerHandler，拦截直接调用（如 iframe 通过 window.parent 访问）
      this.wrapNativeRegisterHandler()

      // Android 等宿主依赖 init 建立消息通道，存在则调用；iOS WK 无 init 时跳过
      const bridge = this.window.WebViewJavascriptBridge
      if (typeof bridge.init === 'function') {
        bridge.init((_message: unknown, _responseCallback?: JSBridgeCallback) => {
          // 默认处理器，通常由具体 registerHandler 处理
        })
      }

      this.isReady = true
      const callbackCount = this.readyCallbacks.length
      this.readyCallbacks.forEach((callback) => callback())
      this.readyCallbacks = []
      console.log(`[JsBridge] Bridge 初始化完成，执行了 ${callbackCount} 个回调`)
    } else {
      console.warn('[JsBridge] WebViewJavascriptBridge 不可用')
    }
  }

  /**
   * 包装原生的 registerHandler 方法，支持多 handler
   */
  private wrapNativeRegisterHandler(): void {
    const bridge = this.window.WebViewJavascriptBridge
    if (!bridge) return

    // 保存原始方法
    const originalRegisterHandler = bridge.registerHandler.bind(bridge)

    // 替换为包装后的方法
    bridge.registerHandler = (handlerName: string, handler: JSBridgeHandler) => {
      console.log(`[JsBridge] 拦截 registerHandler: ${handlerName}`)

      // 将 handler 添加到 Map 中
      if (!this.handlersMap.has(handlerName)) {
        this.handlersMap.set(handlerName, new Set())
      }
      this.handlersMap.get(handlerName)!.add(handler)

      // 只向原生注册一次
      if (!this.registeredToNative.has(handlerName)) {
        this.registeredToNative.add(handlerName)
        originalRegisterHandler(handlerName, (data: unknown, callback?: JSBridgeCallback) => {
          const logData = handlerName === 'dropReceiveFile' ? this.omitBase64ForLog(data) : data
          console.log(`[JsBridge] 收到原生调用 ${handlerName}，${dayjs().format('mm:ss.SSS')} 分发给 ${this.handlersMap.get(handlerName)?.size || 0} 个 handler`, logData)
          const handlers = this.handlersMap.get(handlerName)
          console.log('handlers', handlerName, handlers?.size)
          if (handlers) {
            handlers.forEach((h) => {
              try {
                h(data, callback)
              } catch (error) {
                console.error(`[JsBridge] handler ${handlerName} 执行出错:`, error)
              }
            })
          }
        })
      }
    }
  }

  /**
   * 等待bridge准备就绪
   */
  private waitForReady(callback: () => void): void {
    if (this.isReady) {
      callback()
    } else {
      this.readyCallbacks.push(callback)
    }
  }

  /** 是否可能为嵌入宿主（含 iOS/Android 注入链） */
  isNativeEmbedHost(): boolean {
    return this.isIOSWebView()
  }

  /** Bridge 已初始化且可 call/register */
  isBridgeReady(): boolean {
    return this.isReady && !!this.window.WebViewJavascriptBridge
  }

  /** Bridge 就绪后执行一次（嵌入页用） */
  whenReady(callback: () => void): void {
    this.waitForReady(callback)
  }

  /**
   * 检查是否在iOS WebView环境中
   */
  isIOSWebView(): boolean {
    // 优先检查 WebViewJavascriptBridge 是否存在
    if (this.window.WebViewJavascriptBridge) {
      return true
    }
    return false
  }

  /**
   * 辅助方法：深拷贝数据并省略 base64 数据，用于打印日志
   */
  private omitBase64ForLog(data: unknown): unknown {
    if (!data) return data
    try {
      const cloned = JSON.parse(JSON.stringify(data))
      if (cloned && typeof cloned === 'object') {
        if (Array.isArray(cloned.items)) {
          cloned.items.forEach((item: DropReceiveFileItem) => {
            if (item.data) item.data = '[BASE64_DATA_OMITTED]'
            if (item.base64) item.base64 = '[BASE64_DATA_OMITTED]'
          })
        } else if (Array.isArray(cloned.files)) {
          cloned.files.forEach((item: DropReceiveFileItem) => {
            if (item.data) item.data = '[BASE64_DATA_OMITTED]'
            if (item.base64) item.base64 = '[BASE64_DATA_OMITTED]'
          })
        } else if (cloned.file) {
          if (cloned.file.data) cloned.file.data = '[BASE64_DATA_OMITTED]'
          if (cloned.file.base64) cloned.file.base64 = '[BASE64_DATA_OMITTED]'
        } else {
          if (cloned.data) cloned.data = '[BASE64_DATA_OMITTED]'
          if (cloned.base64) cloned.base64 = '[BASE64_DATA_OMITTED]'
        }
      }
      return cloned
    } catch {
      return data
    }
  }

  /**
   * 调用iOS原生方法
   * @param handlerName 处理器名称
   * @param data 数据
   * @param callback 回调函数
   */
  callHandler(handlerName: string, data?: unknown, callback?: JSBridgeCallback): void {
    const logData = ['dropLoadComplete', 'dropSelectFile', 'dropFileFlow', 'dropSaveFile'].includes(handlerName) ? this.omitBase64ForLog(data) : data
    console.log(`[JsBridge] 调用处理器: ${handlerName}`, logData)

    if (!this.isNativeEmbedHost()) {
      console.warn('[JsBridge] 非 WebView 宿主环境，跳过 callHandler:', handlerName)
      callback?.({ error: 'Not in WebView environment' })
      return
    }

    this.waitForReady(() => {
      if (this.window.WebViewJavascriptBridge) {
        console.log(`[JsBridge] 执行 callHandler: ${handlerName}`)
        this.window.WebViewJavascriptBridge.callHandler(handlerName, data, (response: unknown) => {
          console.log(`[JsBridge] 收到响应 ${handlerName}:`, response)
          callback?.(response)
        })
      } else {
        console.error('[JsBridge] WebViewJavascriptBridge 不可用')
        callback?.({ error: 'WebViewJavascriptBridge not available' })
      }
    })
  }

  /**
   * 注册H5方法供iOS调用
   * 支持同名 handler 多次注册，不会覆盖
   * @param handlerName 处理器名称
   * @param handler 处理函数
   */
  registerHandler(handlerName: string, handler: JSBridgeHandler): void {
    if (!this.isNativeEmbedHost()) {
      console.debug('[JsBridge] 非 WebView 宿主，跳过 registerHandler:', handlerName)
      return
    }
    this.waitForReady(() => {
      // 等待 bridge 就绪后，调用已被包装的 registerHandler
      if (this.window.WebViewJavascriptBridge) {
        this.window.WebViewJavascriptBridge.registerHandler(handlerName, handler)
      }
    })
  }

  /**
   * 取消注册 handler
   * @param handlerName 处理器名称
   * @param handler 处理函数（可选，不传则移除所有）
   */
  unregisterHandler(handlerName: string, handler?: JSBridgeHandler): void {
    if (!this.handlersMap.has(handlerName)) return

    if (handler) {
      this.handlersMap.get(handlerName)!.delete(handler)
    } else {
      this.handlersMap.get(handlerName)!.clear()
    }
  }

  /**
   * 关闭WebView
   */
  closeWebView(callback?: JSBridgeCallback): void {
    this.callHandler('closeWebView', {}, callback)
  }

  // 调整屏幕高度（0~1的数值，首次打开不调用） ------ updateScreenHeight     字段heightRate
  updateScreenHeight(params: { heightRate: number }, callback?: JSBridgeCallback): void {
    this.callHandler('updateScreenHeight', params, callback)
  }

  // 保存到相册（图片oss地址） ------ saveImageToPhoto  字段 imgUrl
  saveImageToPhoto(params: { imgUrl: string }, callback?: JSBridgeCallback): void {
    this.callHandler('saveImageToPhoto', params, callback)
  }

  // 加载3D课件（参数未知？） -----   load3dCourse  字段url
  load3dCourse(params: { id: string | number; cover: string; url: string }[], callback?: JSBridgeCallback): void {
    this.callHandler('load3dCourse', params, callback)
  }

  // 加载图片课件(ai类型、原图地址) ----- loadImageCourse  字段 style   imgUrl
  loadImageCourse(params: { style: string; imgUrl: string; descript: string; prompt: string }, callback?: JSBridgeCallback): void {
    this.callHandler('loadImageCourse', params, callback)
  }

  // 选择图片和拍照
  getImage(callback?: JSBridgeCallback): void {
    this.callHandler('getImage', null, callback)
  }

  // 发送信令同步 ------ sendMsgSync     字段 msg
  sendMsgSync(params: string, callback?: JSBridgeCallback): void {
    this.callHandler('sendMsgSync', params, callback)
  }

  // —— P2P 嵌入页 drop 协议（H5 → APP）——

  /** 1. H5 加载完成，通知 APP 可交互 */
  dropLoadComplete(extra?: Record<string, unknown>, callback?: JSBridgeCallback): void {
    this.callHandler('dropLoadComplete', extra ?? {}, callback)
  }

  /** 2. 通知 APP：H5 侧已选/待传文件（无参；宿主自行处理后续动作） */
  dropSelectFile(callback?: JSBridgeCallback): void {
    this.callHandler('dropSelectFile', null, callback)
  }

  /** 3. 插入对话流（发送成功或收到文件等） */
  dropFileFlow(payload: unknown, callback?: JSBridgeCallback): void {
    this.callHandler('dropFileFlow', payload, callback)
  }

  /** 4. 请求 APP 保存到相册（通常传 base64 等） */
  dropSaveFile(payload: unknown, callback?: JSBridgeCallback): void {
    this.callHandler('dropSaveFile', payload, callback)
  }

  /**
   * 调用JavaScript方法（供iOS调用）
   * 这个方法主要是为了与iOS的callJavaScriptMethod对应
   */
  callJavaScriptMethod(methodName: string, data?: unknown, callback?: JSBridgeCallback): void {
    const globalLike = this.window as unknown as Record<string, unknown>
    const candidate = globalLike[methodName]
    if (typeof candidate === 'function') {
      try {
        const result = (candidate as (arg?: unknown) => unknown)(data)
        callback?.(result)
      } catch (error) {
        callback?.({ error: (error as Error).message })
      }
    } else {
      callback?.({ error: `Method ${methodName} not found` })
    }
  }
}

// 导出单例实例
export const jsBridge = JsBridge.getInstance()

export default jsBridge
