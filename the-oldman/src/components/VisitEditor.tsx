"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { deleteCheckIn, updateCheckIn } from "@/app/(app)/checkin/actions";
import { PURPOSES, type CheckIn, type ReservationPurpose } from "@/lib/types";

/**
 * 記録し終えた滞在を直す一枚。
 *
 * 押し忘れも押し間違いも必ず起きるし、朝10時の自動締めは「本当は何時に帰ったか」
 * を知らない。だから、あとから直せる場所を用意する。
 *
 * 直せるのは自分の記録だけ。何時にいたかは本人しか知らない。
 */

/** datetime-local は JST の壁時計を入れる。ISO はUTCなので変換して渡す。 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 3600_000);
  return jst.toISOString().slice(0, 16);
}

/** 壁時計（JST）を ISO に戻す。 */
function fromLocalInput(v: string): string {
  return new Date(`${v}:00+09:00`).toISOString();
}

export default function VisitEditor({
  visit,
  onClose,
}: {
  visit: CheckIn;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // シートは body 直下へ出す（sticky なマストヘッドの重なり文脈を抜けるため）。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [inAt, setInAt] = useState(toLocalInput(visit.checked_in_at));
  const [outAt, setOutAt] = useState(
    visit.checked_out_at ? toLocalInput(visit.checked_out_at) : "",
  );
  const [purposes, setPurposes] = useState<ReservationPurpose[]>(
    visit.purposes?.length ? visit.purposes : ["poker"],
  );
  const [headcount, setHeadcount] = useState(visit.headcount ?? 1);
  const [memo, setMemo] = useState(visit.memo ?? "");

  function toggle(p: ReservationPurpose) {
    setPurposes((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await updateCheckIn(visit.id, {
      checkedInAt: fromLocalInput(inAt),
      checkedOutAt: outAt ? fromLocalInput(outAt) : null,
      purposes,
      headcount,
      memo,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await deleteCheckIn(visit.id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    router.refresh();
  }

  if (!mounted) return null;

  return createPortal(
    <div className="cisheet" role="dialog" aria-modal="true" aria-label="滞在の記録を直す">
      <div className="cisheet__back" onClick={onClose} />
      <form className="cisheet__panel surface" onSubmit={save}>
        <p className="label">滞在の記録</p>

        <div className="rform__row2">
          <div>
            <label className="field-label" htmlFor="v-in">
              入った時刻
            </label>
            <input
              id="v-in"
              type="datetime-local"
              className="field field-num"
              value={inAt}
              onChange={(e) => setInAt(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="v-out">
              出た時刻
            </label>
            <input
              id="v-out"
              type="datetime-local"
              className="field field-num"
              value={outAt}
              onChange={(e) => setOutAt(e.target.value)}
            />
            <p className="micro">空のままなら滞在中の扱いです。</p>
          </div>
        </div>

        <fieldset className="rform__set">
          <legend className="field-label">何をしていましたか</legend>
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
            <label className="field-label" htmlFor="v-head">
              人数
            </label>
            <input
              id="v-head"
              type="number"
              min={1}
              max={30}
              className="field field-num"
              value={headcount}
              onChange={(e) => setHeadcount(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="v-memo">
              ひとこと（任意）
            </label>
            <input
              id="v-memo"
              className="field"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
        </div>

        {error ? <p className="err">{error}</p> : null}

        <div className="rform__actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "…" : "更新する"}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            やめる
          </button>
          <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
            削除
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
