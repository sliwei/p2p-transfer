/** 与待传列表中「文字」项识别一致；接收端用 name + type 判断 */
export const P2P_TEXT_NAME_PREFIX = '【文字】'
export const P2P_TEXT_DEFAULT_FILENAME = `${P2P_TEXT_NAME_PREFIX}消息.txt`

/** 单条文字最大体积（避免误贴超大内容） */
export const P2P_TEXT_MAX_BYTES = 2 * 1024 * 1024

export function isP2pTextFile(file: File): boolean {
  return file.type.startsWith('text/plain') && file.name.startsWith(P2P_TEXT_NAME_PREFIX)
}

export function isP2pTextReceived(f: { name: string; type: string }): boolean {
  return f.type.startsWith('text/plain') && f.name.startsWith(P2P_TEXT_NAME_PREFIX)
}

export function createTextPayloadFile(text: string): File {
  return new File([text], P2P_TEXT_DEFAULT_FILENAME, { type: 'text/plain;charset=utf-8' })
}

export function getTextPayloadByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}
