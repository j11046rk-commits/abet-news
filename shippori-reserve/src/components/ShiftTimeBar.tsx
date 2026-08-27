import { chipColors } from "@/lib/staff";

/**
 * この日のシフトを 17:00〜25:00 の時間軸で見せる（店主要望 2026-08-28）。
 *
 * 名前の並びだけだと「何時に何人いるか」が頭の中の計算になる。
 * 帯にして重ねれば、薄い時間帯（人が足りない）と厚い時間帯（多い）が
 * ひと目で分かる——シフトを組み直す判断はそこから始まる。
 *
 * 軸は店主指定で 17:00〜25:00 に固定。営業は18時からだが、仕込みの17時台も
 * 見えるようにしておく。数字の行は1時間刻みの人数。
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

/** 1時間刻みの人数（17-18, 18-19, … 24-25 の8コマ） */
export function shiftHourCounts(entries: ShiftBarEntry[]): { hour: number; count: number }[] {
  return Array.from({ length: 8 }, (_, i) => {
    const from = AXIS_START + i * 60;
    const to = from + 60;
    const count = entries.filter((e) => e.start < to && e.end > from).length;
    return { hour: 17 + i, count };
  });
}

/**
 * 時間帯ごとの人数だけの1行（シフトを組む画面の各日用）。
 * タップで下書きが変わるたびに動く——「21時台が薄い」に組みながら気づける。
 */
export function ShiftHourStrip({ entries }: { entries: ShiftBarEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <span className="shiftbar__density shiftbar__density--inline" aria-label="時間帯ごとの人数（17〜25時）">
      {shiftHourCounts(entries).map((h) => (
        <span
          key={h.hour}
          className={`shiftbar__cell shiftbar__cell--${Math.min(h.count, 4)}`}
          title={`${h.hour % 24 || 24}時台 ${h.count}人`}
        >
          {h.count}
        </span>
      ))}
    </span>
  );
}

export default function ShiftTimeBar({
  entries,
  note = true,
}: {
  entries: ShiftBarEntry[];
  /** 下の説明文。ひと月ぶんを縦に並べる画面では1回で足りるので消せる */
  note?: boolean;
}) {
  if (entries.length === 0) return null;

  const hours = shiftHourCounts(entries);

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

      {/* 時間帯ごとの人数。薄い時間帯がひと目で分かるように濃さを変える */}
      <div className="shiftbar__density" aria-label="時間帯ごとの人数">
        {hours.map((h) => (
          <span
            key={h.hour}
            className={`shiftbar__cell shiftbar__cell--${Math.min(h.count, 4)}`}
            title={`${h.hour % 24 || 24}時台 ${h.count}人`}
          >
            {h.count}
          </span>
        ))}
      </div>
      {note ? (
        <p className="shiftbar__note">下の数字＝その時間帯の人数（時間なしの人は通し扱い）</p>
      ) : null}
    </div>
  );
}
