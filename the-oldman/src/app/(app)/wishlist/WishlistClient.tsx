"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createWishlistItem, deleteWishlistItem, setWishlistBought } from "./actions";
import { yen } from "@/lib/money";
import type { WishlistItemView } from "@/lib/types";

/**
 * ほしい物リスト。
 *
 * 承認も予算枠も作らない。6人しかいないので、並べて眺めて話せば済む。
 * 画面が担うのは「思いついたときに書き留められる」ことだけ。
 */
export default function WishlistClient({
  items,
  names,
}: {
  items: WishlistItemView[];
  names: Record<string, string>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const wanted = items.filter((i) => !i.bought_at);
  const bought = items.filter((i) => i.bought_at);
  const total = wanted.reduce((s, i) => s + (i.amount_yen ?? 0), 0);

  function close() {
    setOpen(false);
    setPreview(null);
    formRef.current?.reset();
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await createWishlistItem(new FormData(e.currentTarget));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    close();
    router.refresh();
  }

  async function toggle(i: WishlistItemView) {
    setBusy(true);
    const res = await setWishlistBought(i.id, !i.bought_at);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await deleteWishlistItem(id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  return (
    <>
      <div className="rule">
        <span className="label">Wanted — {wanted.length}</span>
        {total > 0 ? <span className="micro amount adv__total">{yen(total)}</span> : null}
      </div>

      {error ? <p className="err">{error}</p> : null}

      {open ? (
        <form className="surface rform" onSubmit={submit} ref={formRef}>
          <div className="rform__row2">
            <div>
              <label className="field-label" htmlFor="w-title">
                名称
              </label>
              <input id="w-title" name="title" className="field" required placeholder="チップケース" />
            </div>
            <div>
              <label className="field-label" htmlFor="w-amt">
                金額（任意）
              </label>
              <input
                id="w-amt"
                name="amount"
                className="field field-num"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="w-note">
              備考（任意）
            </label>
            <input id="w-note" name="note" className="field" placeholder="URL やサイズなど" />
          </div>

          <div>
            <label className="field-label" htmlFor="w-img">
              画像（任意）
            </label>
            <input
              id="w-img"
              name="image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="field wish__file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
            {preview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={preview} alt="" className="wish__preview" />
            ) : (
              <p className="micro">商品ページのスクリーンショットでも構いません。5MBまで。</p>
            )}
          </div>

          <div className="rform__actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "保存中" : "追加する"}
            </button>
            <button type="button" className="btn" onClick={close} disabled={busy}>
              やめる
            </button>
          </div>
        </form>
      ) : (
        <button className="btn block" onClick={() => setOpen(true)}>
          ほしい物を追加
        </button>
      )}

      {items.length === 0 ? (
        <p className="empty">まだ何もありません。</p>
      ) : (
        <ul className="wish">
          {[...wanted, ...bought].map((i) => (
            <li key={i.id} className={`wish__item${i.bought_at ? " is-done" : ""}`}>
              {i.image_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={i.image_url} alt="" className="wish__thumb" loading="lazy" />
              ) : (
                <span className="wish__thumb is-empty" aria-hidden />
              )}

              <span className="wish__body">
                <span className="wish__title">{i.title}</span>
                {i.note ? <span className="micro wish__note">{i.note}</span> : null}
                <span className="micro wish__by">{names[i.created_by] ?? "—"}</span>
              </span>

              <span className="wish__right">
                <span className="wish__amt amount">{i.amount_yen ? yen(i.amount_yen) : "—"}</span>
                <label className="adv__check">
                  <input
                    type="checkbox"
                    checked={Boolean(i.bought_at)}
                    disabled={busy}
                    onChange={() => toggle(i)}
                  />
                  <span className="adv__box" aria-hidden />
                  <span className="micro">購入済</span>
                </label>
                <button
                  className="btn btn-sm btn-danger"
                  disabled={busy}
                  onClick={() => remove(i.id)}
                >
                  削除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
