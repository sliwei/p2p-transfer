/**
 * 分享 / 二维码：仅包含 r，不含 n（对方打开后由本机随机或地址栏分配昵称）
 */
export function buildRoomShareUrl(roomId: string): string {
  const u = new URL(window.location.href)
  u.search = ''
  u.searchParams.set('r', roomId.trim())
  return u.toString()
}
