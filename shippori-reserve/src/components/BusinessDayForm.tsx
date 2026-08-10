"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EVENT_CLOSE_MIN, EVENT_OPEN_MIN } from "@/lib/constants";
import { fmtBytes, shrinkImage } from "@/lib/image";
import { minutesToLabel } from "@/lib/time";
import type { BusinessDay } from "@/lib/types";
import type { BusinessDayInput, DayResult, FlyerResult } from "@/app/(app)/calendar/actions";

/** Vercel が受け取れるリクエストの大きさに収まる範囲。画像は縮めてから送るので普通は届かない */
const FLYER_MAX_BYTES = 4 * 1024 * 1024;

const OPEN_CHOICES = [1020, 1050, 1080, 1110, 1140]; // 17:00〜19:00
const CLOSE_CHOICES = [1380, 1440, 1470, 1500, 1560]; // 23:00〜26:00

export default function BusinessDayForm({
  day,
  guestCount,
  defaultCapacity,
  onSubmit,
  onUploadFlyer,
}: {
  day: BusinessDay;
  guestCount: number;
  defaultCapacity: number;
  onSubmit: (input: BusinessDayInput) => Promise<DayResult>;
  onUploadFlyer: (fd: FormData) => Promise<FlyerResult>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"normal" | "event">(day.mode);
  const [isBusy, setIsBusy] = useState(day.is_busy);
  const [isClosed, setIsClosed] = useState(day.is_closed);
  const [eventName, setEventName] = useState(day.event_name ?? "");
  const [capacity, setCapacity] = useState<number>(day.event_capacity ?? defaultCapacity);
  const [openMin, setOpenMin] = useState(day.open_min);
  const [closeMin, setCloseMin] = useState(day.close_min);
  const [note, setNote] = useState(day.note ?? "");
  const [flyerUrl, setFlyerUrl] = useState(day.flyer_url ?? "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const switchingToEvent = mode === "event" && day.mode === "normal" && guestCount > 0;

  /**
   * イベント営業は 18:00〜24:00 が既定（店主指定）。切り替えたときに時間も入れ替える。
   * 通常営業に戻したら、その日の元の時間（金土は25:00まで）に戻す。
   */
  function pickMode(next: "normal" | "event") {
    setMode(next);
    if (next === "event") {
      setOpenMin(EVENT_OPEN_MIN);
      setCloseMin(EVENT_CLOSE_MIN);
    } else {
      setOpenMin(day.open_min);
      setCloseMin(day.close_min);
    }
  }

  /**
   * チラシを選んだらすぐ預かる。保存ボタンを押す前に、載る絵を確かめられるように。
   * 何があっても「アップロード中…」のまま固まらないよう、必ず finally で戻す。
   */
  async function pickFlyer(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    setError(null);
    setSaved(false);
    setUploading(true);
    try {
      // スマホの写真は数MBある。送る前に縮めて、通信も待ち時間も軽くする
      const sending = await shrinkImage(file);
      if (sending.size > FLYER_MAX_BYTES) {
        setError(
          `ファイルが大きすぎます（${fmtBytes(sending.size)}）。もう少し小さい画像をお試しください。`,
        );
        return;
      }
      const fd = new FormData();
      fd.set("file", sending);
      fd.set("date", day.biz_date);
      const res = await onUploadFlyer(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFlyerUrl(res.url);
    } catch {
      setError("アップロードできませんでした。電波の良いところでもう一度お試しください。");
    } finally {
      setUploading(false);
      // 同じ写真をもう一度選び直せるように、選択欄は空に戻す
      input.value = "";
    }
  }

  function submit() {
    setError(null);
    setSaved(false);
    if (mode === "event" && !flyerUrl) {
      setError("イベント営業の日はチラシの画像（またはPDF）が必要です。");
      return;
    }
    startTransition(async () => {
      try {
        const res = await onSubmit({
          biz_date: day.biz_date,
          mode,
          is_busy: isBusy,
          is_closed: isClosed,
          event_name: eventName,
          event_capacity: mode === "event" ? capacity : null,
          open_min: openMin,
          close_min: closeMin,
          flyer_url: flyerUrl || null,
          note,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setSaved(true);
        router.refresh();
      } catch {
        // 通信が切れた・再デプロイ直後などで、押しても何も起きないように見えるのを防ぐ
        setError("保存できませんでした。通信環境をご確認のうえ、もう一度お試しください。");
      }
    });
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <label className="field-label">営業モード</label>
        <div className="seg">
          <button
            type="button"
            className="seg__btn"
            aria-pressed={mode === "normal"}
            onClick={() => pickMode("normal")}
          >
            通常営業（しっぽり）
          </button>
          <button
            type="button"
            className="seg__btn"
            aria-pressed={mode === "event"}
            onClick={() => pickMode("event")}
          >
            イベント営業（ビアホール）
          </button>
        </div>
        <p className="micro" style={{ marginTop: "0.4rem" }}>
          {mode === "normal"
            ? "席ごとに管理します。"
            : "相席前提。席は管理せず、定員（総受け入れ人数）だけを見ます。"}
        </p>
      </div>

      {mode === "event" ? (
        <>
          <div>
            <label className="field-label" htmlFor="event_name">
              イベント名
            </label>
            <input
              id="event_name"
              className="field"
              placeholder="例：夏のビアホール"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="capacity">
              定員（総受け入れ人数）<span className="req">必須</span>
            </label>
            <input
              id="capacity"
              type="number"
              inputMode="numeric"
              min={1}
              max={300}
              className="field"
              value={capacity}
              onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
            />
            <p className="micro" style={{ marginTop: "0.35rem" }}>
              現在この日には {guestCount} 名の予約が入っています。
            </p>
          </div>

          <div>
            <label className="field-label" htmlFor="flyer">
              チラシ<span className="req">必須</span>
            </label>
            <p className="micro" style={{ marginBottom: "0.4rem" }}>
              予約ページでお客様に見せます。イベントの内容・料金がわかる画像（写真でも可）か
              PDFを選んでください。
            </p>
            <input
              id="flyer"
              className="field"
              type="file"
              accept="image/*,application/pdf"
              disabled={uploading}
              onChange={(e) => pickFlyer(e.currentTarget)}
            />
            {uploading ? <p className="micro">アップロード中…</p> : null}
            {flyerUrl ? (
              <div className="flyer-preview">
                {/\.pdf(\?|$)/i.test(flyerUrl) ? (
                  <a href={flyerUrl} target="_blank" rel="noreferrer">
                    登録済みのチラシ（PDF）を開く
                  </a>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={flyerUrl} alt="登録済みのチラシ" />
                )}
                <button type="button" className="btn btn-sm" onClick={() => setFlyerUrl("")}>
                  取り消す
                </button>
              </div>
            ) : (
              <p className="micro" style={{ color: "var(--seal)" }}>
                まだチラシが登録されていません。
              </p>
            )}
          </div>

          <p className="notice">
            イベント営業の日は、ネット予約を<b>前日まで</b>で締め切ります（当日はお電話のみ）。
            お客様には予約時にチラシを見せ、通常営業とメニュー・価格が違うことへの同意をいただきます。
          </p>

          {switchingToEvent ? (
            <p className="notice notice-strong">
              この日にはすでに {guestCount} 名の予約があります。イベント営業に切り替えると、
              席の欄は使われなくなります（予約そのものは残ります。通常営業に戻せば元どおりです）。
            </p>
          ) : null}
        </>
      ) : null}

      <label className="switch">
        <span>
          繁忙日にする
          <span className="micro" style={{ display: "block" }}>
            席割り当てルール（Phase 2）が参照します
          </span>
        </span>
        <input type="checkbox" checked={isBusy} onChange={(e) => setIsBusy(e.target.checked)} />
      </label>

      <label className="switch">
        <span>
          休業にする
          <span className="micro" style={{ display: "block" }}>
            火曜は既定で休業です
          </span>
        </span>
        <input
          type="checkbox"
          checked={isClosed}
          onChange={(e) => setIsClosed(e.target.checked)}
        />
      </label>

      <div>
        <label className="field-label">営業時間</label>
        <div className="row" style={{ gap: "0.5rem" }}>
          <select
            className="field"
            value={openMin}
            onChange={(e) => setOpenMin(Number(e.target.value))}
            aria-label="開店時刻"
          >
            {OPEN_CHOICES.map((m) => (
              <option key={m} value={m}>
                {minutesToLabel(m)}
              </option>
            ))}
          </select>
          <span className="muted">〜</span>
          <select
            className="field"
            value={closeMin}
            onChange={(e) => setCloseMin(Number(e.target.value))}
            aria-label="閉店時刻"
          >
            {CLOSE_CHOICES.map((m) => (
              <option key={m} value={m}>
                {minutesToLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <p className="micro" style={{ marginTop: "0.35rem" }}>
          既定は 日〜木 18:00〜24:00 ／ 金・土 18:00〜25:00。25:00 は翌日の 1:00 のことです。
        </p>
      </div>

      <div>
        <label className="field-label" htmlFor="note">
          備考（任意）
        </label>
        <input
          id="note"
          className="field"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error ? <p className="err">{error}</p> : null}

      <button type="submit" className="btn btn-primary btn-block" disabled={pending || uploading}>
        {uploading ? "アップロード中" : pending ? "保存中" : saved ? "保存しました" : "保存する"}
      </button>
    </form>
  );
}
