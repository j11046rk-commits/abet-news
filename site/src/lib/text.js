// 「要確認」で始まる値を判定するヘルパー。
// 本人が確定するまでの暫定表示を、サイト上でも目立たせて取りこぼしを防ぐ。
export function isTBC(value) {
  return typeof value === 'string' && value.trim().startsWith('要確認');
}

// 「要確認：xxx」から先頭ラベルを除いた中身を返す（表示用ヒント）。
export function tbcHint(value) {
  return String(value).replace(/^要確認[:：]?\s*/, '');
}
