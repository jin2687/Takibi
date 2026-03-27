/** ランダムな英数字 8 文字のルームIDを生成 */
export function generateRoomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

/** 現在のURLからルームIDを取得（クエリパラメータ `room`） */
export function getRoomIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('room')
}

/** ルームIDを含む招待URLを生成 */
export function buildInviteUrl(roomId: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('room', roomId)
  return url.toString()
}
