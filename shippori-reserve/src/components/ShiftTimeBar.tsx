import { chipColors } from "@/lib/staff";

/**
 * この日のシフトを 17:00〜25:00 の時間軸で見せる（店主要望 2026-08-28）。
 *
 * 名前の並びだけだと「何時に何人いるか」が頭の中の計算になる。
 * 帯にして重ねれば、薄い時間帯（人が足りない）と厚い時間帯（多い）が
 * ひと目で分かる——シフトを組み直す判断はそこから始まる。
 *
 * 軸は店主指定で 17:00〜25:00 に固定。営業は18時からだが、仕込みの17時台も
 * 見えるようにしておく。人数の数字は出さない——帯が見えていれば数は読める
 * （店主指示 2026-08-28）。
 */

export type ShiftBarEntry = {
  name: string;
  colorIndex: number;
  /** 分（0:00起点）。25:00 = 1500 */
  start: number;
  end: number;
  /** 時間の概念を持たない人（店長・オーナー）。通し扱いで出す */
  wholeDay?: boolean;
};

const AXIS_START = 17 * 60; // 17:00
const AXIS_END = 25 * 60; // 25:00
const SPAN = AXIS_END - AXIS_START;

const pct = (min: number): string =>
  `${(((Math.min(Math.max(min, AXIS_START), AXIS_END) - AXIS_START) / SPAN) * 100).toFixed(2)}%`;

export default function ShiftTimeBar({
  entries,
  note = true,
}: {
  entries: ShiftBarEntry[];
  /** 下の説明文。ひと月ぶんを縦に並べる画面では1回で足りるので消せる */
  note?: boolean;
}) {
  if (entries.length === 0) return null;

  return (
    <div className="shiftbar" aria-label="この日のシフトの時間帯">
      {/* 時間の目盛（17〜25時） */}
      <div className="shiftbar__scale" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="shiftbar__tick" style={{ left: pct((17 + i) * 60) }}>
            {((17 + i) % 24) || 24}
          </span>
        ))}
      </div>

      {/* 人ごとの帯 */}
      <div className="shiftbar__rows">
        {entries.map((e) => (
          <div key={`${e.name}-${e.start}`} className="shiftbar__row">
            <span className="shiftbar__name" style={chipColors(e.colorIndex)}>
              {e.name}
            </span>
            <span className="shiftbar__track">
              <span
                className={`shiftbar__bar${e.wholeDay ? " shiftbar__bar--whole" : ""}`}
                style={{
                  left: pct(e.start),
                  width: `calc(${pct(e.end)} - ${pct(e.start)})`,
                  ...chipColors(e.colorIndex),
                }}
              />
            </span>
          </div>
        ))}
      </div>

      {note ? (
        <p className="shiftbar__note">薄い帯＝時間を決めていない人（店長など・通し扱い）</p>
      ) : null}
    </div>
  );
}
