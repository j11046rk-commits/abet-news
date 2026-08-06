"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createWishlistItem, deleteWishlistItem, setWishlistBought } from "./actions";
import { extOf, shrinkImage } from "@/lib/image";
import { yen } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";
import type { WishlistItemView } from "@/lib/types";

const MAX_BYTES = 12 * 1024 * 1024;

/**
 * ほしい物リスト。
 *
 * 承認も予算枠も作らない。6人しかいないので、並べて眺めて話せば済む。
 * 画面が担うのは「思いついたときに書き留められる」ことだけ。
 */
export default function WishlistClient({
  items,
  names,
  meId,
}: {
  items: WishlistItemView[];
  names: Record<string, string>;
  /** 画像の置き場所は自分のフォルダに切る。 */
  meId: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  /** タップで開いた拡大表示。サムネイルは56pxしかなく、中身が読めないため。 */
  const [zoom, setZoom] = useState<WishlistItemView | null>(null);

  const wanted = items.filter((i) => !i.bought_at);
  const bought = items.filter((i) => i.bought_at);
  const total = wanted.reduce((s, i) => s + (i.amount_yen ?? 0), 0);

  function close() {
    setOpen(false);
    setPreview(null);
    setStage(null);
    formRef.current?.reset();
  }

  /**
   * 画像はブラウザで縮めてから、直接バケットへ上げる。
   *
   * Server Action に File を渡すと、本文上限（既定 1MB）に当たって
   * スマホの写真がそもそも通らない。通っても スマホ→サーバ→バケット と
   * 同じバイト列を2回運ぶことになる。縮めて直接送れば、その両方が消える。
   */
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);

    let uploaded: string | null = null;
    try {
      const file = form.get("image");
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_BYTES) {
          setBusy(false);
          return setError("画像が大きすぎます。");
        }

        setStage("画像を準備中");
        const small = await shrinkImage(file);

        setStage("画像を送信中");
        const supabase = createClient();
        const path = `${meId}/${crypto.randomUUID()}.${extOf(small.type)}`;
        const up = await supabase.storage
          .from("wishlist")
          .upload(path, small, { contentType: small.type, upsert: false });
        if (up.error) {
          setBusy(false);
          setStage(null);
          return setError("画像を保存できませんでした。");
        }
        uploaded = path;
      }

      setStage("保存中");
      const raw = String(form.get("amount") ?? "").replace(/[^\d]/g, "");
      const res = await createWishlistItem({
        title: String(form.get("title") ?? ""),
        amountYen: raw ? Number(raw) : null,
        note: String(form.get("note") ?? ""),
        imagePath: uploaded,
      });

      if (!res.ok) {
        // 行が作れなかったのに画像だけ残ると、誰からも辿れないゴミになる
        if (uploaded) await createClient().storage.from("wishlist").remove([uploaded]);
        setBusy(false);
        setStage(null);
        return setError(res.error);
      }

      setBusy(false);
      close();
      router.refresh();
    } catch {
      // ここで拾わないと、ボタンが「保存中」のまま二度と戻らない
      if (uploaded) await createClient().storage.from("wishlist").remove([uploaded]);
      setBusy(false);
      setStage(null);
      setError("保存できませんでした。通信の状態を確かめてもう一度お試しください。");
    }
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
              accept="image/*"
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
              <p className="micro">商品ページのスクリーンショットでも構いません。送る前に縮めます。</p>
            )}
          </div>

          <div className="rform__actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? (stage ?? "保存中") : "追加する"}
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
                <button
                  className="wish__zoombtn"
                  onClick={() => setZoom(i)}
                  aria-label={`${i.title} の画像を大きく見る`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.image_url} alt="" className="wish__thumb" loading="lazy" />
                </button>
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

      {zoom?.image_url ? (
        <Lightbox item={zoom} onClose={() => setZoom(null)} />
      ) : null}
    </>
  );
}

/**
 * 画像の拡大表示。
 *
 * サムネイルは56pxしかなく、商品ページのスクリーンショットだと何も読めない。
 * どこを押しても閉じる — 見るためだけの一枚に、閉じ方を考えさせない。
 */
function Lightbox({ item, onClose }: { item: WishlistItemView; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // 端末の戻る操作と Esc で閉じられるようにする
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.image_url ?? ""} alt={item.title} className="lightbox__img" />
      <p className="lightbox__cap micro">
        {item.title}
        {item.amount_yen ? ` · ${yen(item.amount_yen)}` : ""}
      </p>
      <button className="btn btn-sm lightbox__close" onClick={onClose}>
        閉じる
      </button>
    </div>,
    document.body,
  );
}
