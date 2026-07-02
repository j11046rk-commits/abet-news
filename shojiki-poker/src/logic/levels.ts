/**
 * LV判定コピー（HANDOFF §1・辛口ボイス）。
 * 負けを運のせいにする人に「正直になれよ」と刺すトーン。数値しきい値は §1 準拠。
 */

export type Level = {
  label: string; // 例: "LV.クラッシャー"
  line: string; // 辛口コピー
  tone: 'crush' | 'win' | 'luck' | 'fix'; // エンブレム/色分け用
};

/** キャッシュ: bb/100 基準。 */
export function cashLevel(bb100: number): Level {
  if (!Number.isFinite(bb100)) {
    return { label: '未計測', line: 'まず記録を入れろ。話はそれからや。', tone: 'luck' };
  }
  if (bb100 >= 8) return { label: '鉄強プレイヤー', line: 'そろそろ仕事やめる？', tone: 'crush' };
  if (bb100 >= 4) return { label: '勝ち組', line: 'ちゃんと勝ててる。正直、優秀。', tone: 'win' };
  if (bb100 >= 0) return { label: '肩次第', line: '実力かどうかは、正直あやしい。', tone: 'luck' };
  return { label: 'お魚さん', line: 'ぴちぴち。みんなあなたを待っている。', tone: 'fix' };
}

/** トーナメント: ROI(%) 基準。 */
export function mttLevel(roi: number): Level {
  if (!Number.isFinite(roi)) {
    return { label: '未計測', line: 'まず1戦、記録しろ。', tone: 'luck' };
  }
  if (roi >= 30) return { label: '鉄強プレイヤー', line: 'ほぼフォクセンです。', tone: 'crush' };
  if (roi >= 10) return { label: '勝ち組', line: '勝ててる。出場を増やそう。', tone: 'win' };
  if (roi >= 0) return { label: '肩次第', line: 'ポーカーなんて肩や。肩なんや。', tone: 'luck' };
  return { label: 'お魚さん', line: 'そろそろお魚卒業するの？しないの？', tone: 'fix' };
}

/** サンプル警告（辛口のまま・HANDOFF §1）。十分なら null。 */
export function cashSampleWarning(totalHands: number): string | null {
  if (totalHands < 5000) {
    return '⚠ まだ少なすぎ。bb/100は数千〜数万貯めて初めて本物。今の数字はほぼ運。';
  }
  return null;
}

export function mttSampleWarning(count: number): string | null {
  if (count < 50) {
    return '⚠ 分散が桁違い。ROIは100戦超えて初めて意味を持つ。今のは運。';
  }
  return null;
}
