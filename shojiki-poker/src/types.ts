/** データモデル（HANDOFF §3）。全てローカルに永続保存する。 */

export type CashSession = {
  id: string;
  date: number; // epoch ms
  bb: number; // 1BBの円額
  hours: number; // プレイ時間
  players: number; // 2〜10
  hph: number; // 推定ハンド/時（人数から自動、手動上書き可）
  profit: number; // 収支（円・符号付き）
};

export type MttEntry = {
  id: string;
  date: number; // epoch ms
  buyin: number; // バイイン（円）
  rebuys: number; // リエントリー回数（追加バイイン数）
  field: number; // 参加人数
  finish: number; // 自分の着順
  cash: number; // 獲得賞金（円・非入賞は0）
};

/** 成績タブの混在タイムライン用。 */
export type TimelineItem =
  | { kind: 'cash'; date: number; data: CashSession }
  | { kind: 'mtt'; date: number; data: MttEntry };
