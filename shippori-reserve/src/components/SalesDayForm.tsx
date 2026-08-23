"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSalesDay } from "@/app/(app)/sales/actions";
import { fmtYen, type SalesDay } from "@/lib/sales";

/**
 * 営業日の設定にある売上（目標・実績・うち物販）の手入力。店長・オーナーのみ。
 * 実績は普段エアレジ（週次レポート）から自動で入るので、ここは目標入力と手直し用。
 *
 * 「うち物販」は太巻きの日のような特需だけの欄なので、普段は畳んでおく。
 * 毎日出ていると、入れなくていい日にも何か入れなきゃという気にさせてしまう。
 */
export default function SalesDayForm({ date, sales }: { date: string; sales: SalesDay | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState(sales?.target_yen?.toString() ?? "");
  const [actual, setActual] = useState(sales?.actual_yen?.toString() ?? "");
  const [retail, setRetail] = useState(sales?.tax8_yen?.toString() ?? "");
  const [openRetail, setOpenRetail] = useState(sales?.tax8_yen != null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parse = (v: string): number | null => {
    const t = v.trim().replaceAll(",", "");
    if (t === "") return null;
    const n = Number(t);
    return Number.isInteger(n) && n >= 0 ? n : NaN;
  };

  // 入力中の「店内飲食はいくらになるか」をその場で出す。
  // 打ち間違い（桁を1つ多い等）はこの行が変になるので一番早く気づける。
  // 式は lib/sales.ts の salesView と同じ「実績 − 物販」。ここだけ別の計算にすると
  // 入力中に出る金額と、保存後にカレンダーへ出る金額が食い違う。
  const a = parse(actual);
  const r = parse(retail);
  // 空欄は「変更しない」。保存済みの物販が残るので、プレビューもその値で計算する。
  // ここを 0 とみなすと、物販を消したつもりの人に「店内＝実績」と嘘を見せることになる。
  const savedRetail = sales?.tax8_yen ?? 0;
  const effRetail = r ?? savedRetail;
  const dineIn =
    typeof a === "number" && !Number.isNaN(a) && !Number.isNaN(r) ? a - effRetail : null;
  const retailStays = r === null && savedRetail > 0;

  function submit() {
    setError(null);
    setSaved(false);
    const t = parse(target);
    if (Number.isNaN(t) || Number.isNaN(a) || Number.isNaN(r)) {
      setError("金額は0以上の整数で入れてください。");
      return;
    }
    startTransition(async () => {
      const res = await setSalesDay(date, t, a, r);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="card">
      <p className="micro" style={{ letterSpacing: "0.12em", margin: "0 0 0.5rem" }}>
        この日の売上
      </p>
      <div className="row" style={{ gap: "0.5rem", alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <label className="field-label" htmlFor="sales-target">
            目標（円）
          </label>
          <input
            id="sales-target"
            className="field"
            type="text"
            inputMode="numeric"
            placeholder="例: 50000"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label" htmlFor="sales-actual">
            実績（店内＋物販・円）
          </label>
          <input
            id="sales-actual"
            className="field"
            type="text"
            inputMode="numeric"
            placeholder="自動取込あり"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={submit}>
          {pending ? "保存中" : "保存"}
        </button>
      </div>

      {openRetail ? (
        <div style={{ marginTop: "0.6rem" }}>
          <label className="field-label" htmlFor="sales-retail">
            うち物販（お持ち帰り・消費税8%）
          </label>
          <input
            id="sales-retail"
            className="field"
            type="text"
            inputMode="numeric"
            placeholder="例: 622500"
            value={retail}
            onChange={(e) => setRetail(e.target.value)}
          />
          <p className="micro" style={{ margin: "0.3rem 0 0" }}>
            {retailStays ? (
              <>
                空欄のままだと、いま入っている物販 <strong>{fmtYen(savedRetail)}</strong> は残ります。
                無かったことにするなら <strong>0</strong> を入れてください。
              </>
            ) : dineIn != null && dineIn >= 0 ? (
              <>
                この日の店内は <strong>{fmtYen(dineIn)}</strong>。
                カレンダーと売上タブの日毎の数字・目標達成の判定は、こちらで見ます。
                物販は月間の合計にだけ入ります。
              </>
            ) : (
              <>太巻きやオードブルのような、お持ち帰りの売上だけを入れてください。</>
            )}
          </p>
        </div>
      ) : (
        <button
          type="button"
          className="linklike"
          style={{ marginTop: "0.5rem" }}
          onClick={() => setOpenRetail(true)}
        >
          ＋ この日は物販（お持ち帰り）があった
        </button>
      )}

      {error ? <p className="err">{error}</p> : null}
      {saved ? (
        <p className="micro" style={{ color: "var(--ok)", margin: "0.35rem 0 0" }}>
          保存しました。カレンダーと売上タブに反映されます。
        </p>
      ) : null}
      <p className="micro" style={{ margin: "0.35rem 0 0" }}>
        空欄は「変更しない」。実績はエアレジ（週次レポート）からの自動取り込みが基本です。
      </p>
    </section>
  );
}
