"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createWishlistItem,
  deleteWishlistItem,
  setWishlistBought,
  updateWishlistItem,
} from "./actions";
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
  /** null = 閉じている / "new" = 追加 / 行 = その行を直す */
  const [open, setOpen] = useState<"new" | WishlistItemView | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  /** 直すときに、いま付いている画像を外したか。 */
  const [dropImage, setDropImage] = useState(false);
  /** タップで開いた拡大表示。サムネイルは56pxしかなく、中身が読めないため。 */
  const [zoom, setZoom] = useState<WishlistItemView | null>(null);

  const editing = open !== "new" ? open : null;
  const wanted = items.filter((i) => !i.bought_at);
  const bought = items.filter((i) => i.bought_at);
  const total = wanted.reduce((s, i) => s + (i.amount_yen ?? 0), 0);

  function close() {
    setOpen(null);
    setPreview(null);
    setStage(null);
    setDropImage(false);
    formRef.current?.reset();
  }

  function edit(i: WishlistItemView) {
    setError(null);
    setPreview(null);
    setDropImage(false);
    setOpen(i);
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
      const common = {
        title: String(form.get("title") ?? ""),
        amountYen: raw ? Number(raw) : null,
        note: String(form.get("note") ?? ""),
      };
      const res = editing
        ? await updateWishlistItem(editing.id, {
            ...common,
            // 上げ直したならその新しいパス、外したなら null、どちらでもなければ触らない
            imagePath: uploaded ?? (dropImage ? null : undefined),
          })
        : await createWishlistItem({ ...common, imagePath: uploaded });

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
        // 直すときは行ごとに別のフォームとして作り直す。前の行の値が残らないようにする。
        <form className="surface rform" onSubmit={submit} ref={formRef} key={editing?.id ?? "new"}>
          <div className="rform__row2">
            <div>
              <label className="field-label" htmlFor="w-title">
                名称
              </label>
              <input
                id="w-title"
                name="title"
                className="field"
                required
                placeholder="チップケース"
                defaultValue={editing?.title ?? ""}
              />
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
                defaultValue={editing?.amount_yen ?? ""}
              />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="w-note">
              備考（任意）
            </label>
            <input
              id="w-note"
              name="note"
              className="field"
              placeholder="URL やサイズなど"
              defaultValue={editing?.note ?? ""}
            />
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
                if (f) setDropImage(false);
              }}
            />
            {preview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={preview} alt="" className="wish__preview" />
            ) : editing?.image_url && !dropImage ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={editing.image_url} alt="" className="wish__preview" />
                <button type="button" className="btn btn-sm" onClick={() => setDropImage(true)}>
                  画像を外す
                </button>
              </>
            ) : (
              <p className="micro">
                {dropImage
                  ? "保存すると画像は外れます。"
                  : "商品ページのスクリーンショットでも構いません。送る前に縮めます。"}
              </p>
            )}
          </div>

          <div className="rform__actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? (stage ?? "保存中") : editing ? "保存する" : "追加する"}
            </button>
            <button type="button" className="btn" onClick={close} disabled={busy}>
              やめる
            </button>
          </div>
        </form>
      ) : (
        <button className="btn block" onClick={() => setOpen("new")}>
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
                <span className="wish__ops">
                  {/* 直せるのは自分が挙げたものだけ。他人の言い分は書き換えない。 */}
                  {i.created_by === meId ? (
                    <button className="btn btn-sm" disabled={busy} onClick={() => edit(i)}>
                      編集
                    </button>
                  ) : null}
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={busy}
                    onClick={() => remove(i.id)}
                  >
                    削除
                  </button>
                </span>
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
