"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { checkIn, checkOut } from "@/app/(app)/checkin/actions";
import { PURPOSES, type ReservationPurpose } from "@/lib/types";

/**
 * チェックインはどのタブからでも押せるよう、マストヘッド（sticky）に置く。
 *
 * 押すと、予約と同じ用途と人数を聞く。TOPで知りたいのは「誰がいるか」だけでなく
 * 「いま何人いて、何をしているか」なので、入る一手のうちに済ませてしまう。
 * チェックアウトは聞くことが無いので、そのまま閉じる。
 */
export default function CheckInButton({
  isIn,
  current,
}: {
  isIn: boolean;
  /** 滞在中なら、いま入っている内容。開いたときの初期値にする。 */
  current?: { purposes: ReservationPurpose[]; headcount: number; memo: string | null } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // シートは body 直下へ出す。マストヘッドは sticky で独自の重なり文脈を作るため、
  // その中に置くと z-index をいくら上げても下部タブに潜ってしまう。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [purposes, setPurposes] = useState<ReservationPurpose[]>(
    current?.purposes?.length ? current.purposes : ["poker"],
  );
  const [headcount, setHeadcount] = useState(current?.headcount ?? 1);
  const [memo, setMemo] = useState(current?.memo ?? "");

  async function press() {
    if (isIn) {
      setBusy(true);
      await checkOut();
      setBusy(false);
      router.refresh();
      return;
    }
    setError(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await checkIn({ purposes, headcount, memo });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOpen(false);
    router.refresh();
  }

  function toggle(p: ReservationPurpose) {
    setPurposes((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  return (
    <>
      <button
        className={`btn btn-sm${isIn ? "" : " btn-primary"}`}
        onClick={press}
        disabled={busy}
        aria-pressed={isIn}
      >
        {busy ? "…" : isIn ? "チェックアウト" : "チェックイン"}
      </button>

      {open && mounted
        ? createPortal(
            <div className="cisheet" role="dialog" aria-modal="true" aria-label="チェックイン">
          <div className="cisheet__back" onClick={() => setOpen(false)} />
          <form className="cisheet__panel surface" onSubmit={submit}>
            <p className="label">チェックイン</p>

            <fieldset className="rform__set">
              <legend className="field-label">何をしますか（複数選べます）</legend>
              <div className="rform__purposes">
                {PURPOSES.map((p) => (
                  <label key={p.value} className="check">
                    <input
                      type="checkbox"
                      checked={purposes.includes(p.value)}
                      onChange={() => toggle(p.value)}
                    />
                    <span>{p.ja}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="rform__row2">
              <div>
                <label className="field-label" htmlFor="ci-head">
                  人数（自分を含む）
                </label>
                <input
                  id="ci-head"
                  type="number"
                  min={1}
                  max={30}
                  className="field field-num"
                  value={headcount}
                  onChange={(e) => setHeadcount(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="ci-memo">
                  ひとこと（任意）
                </label>
                <input
                  id="ci-memo"
                  className="field"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="ゲスト2名"
                />
              </div>
            </div>

            {error ? <p className="err">{error}</p> : null}

            <div className="rform__actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "…" : "入る"}
              </button>
              <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
                やめる
              </button>
            </div>
          </form>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
