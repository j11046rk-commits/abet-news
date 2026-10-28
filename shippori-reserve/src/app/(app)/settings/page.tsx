import { Fragment } from "react";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import { requireProfile } from "@/lib/auth";
import { can, ROLE_LABEL, TOTAL_SEATS } from "@/lib/constants";
import { getCourses, getSeatUnits, getSettings } from "@/lib/queries";
import { minutesToLabel } from "@/lib/time";
import { freeeConfigured, freeeStatus } from "@/lib/freee";

export const dynamic = "force-dynamic";

/**
 * S11 設定。
 * Phase 1 では店舗の既定値は「見えること」までにしてある。
 * 画面から書き換えられるようにするのは、運用が固まってからでよい（設計 §S11）。
 */
/** freee連携から戻ったときの一言（?freee=…） */
const FREEE_MSG: Record<string, string> = {
  ok: "freeeと連携し、直近90日の勤怠を取り込みました。",
  synced: "勤怠を取り込み直しました。",
  connected_nosync: "連携はできましたが、勤怠の取り込みに失敗しました。少し待って「今すぐ取り込む」を押してください。",
  error: "freeeとの連携・取り込みに失敗しました。時間をおいてもう一度お試しください。",
  badstate: "連携の手続きが途中で切れました。もう一度「freeeと連携」からやり直してください。",
  forbidden: "この操作はオーナー・店長だけができます。",
  noconfig: "freeeのアプリ情報（FREEE_CLIENT_ID / FREEE_CLIENT_SECRET）がまだ設定されていません。",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ freee?: string }>;
}) {
  const me = await requireProfile();
  const sp = await searchParams;
  const manageFreee = can(me.role, "settings.write");
  const freee = manageFreee ? await freeeStatus() : null;
  const freeeMsg = sp.freee ? (FREEE_MSG[sp.freee] ?? null) : null;
  const [settings, courses, seats] = await Promise.all([
    getSettings(),
    getCourses(),
    getSeatUnits(),
  ]);

  const stay = Number(settings.default_stay_min) || 120;
  const openMin = Number(settings.default_open_min) || 1080;
  const eventCapacity = Number(settings.default_event_capacity) || 60;

  return (
    <>
      <header className="appbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-face-96.png" alt="しっぽり亭" width={96} height={96} className="appbar__logo" />
        <div className="appbar__title">設定</div>
        <div className="appbar__spacer" />
        <span className="appbar__sub">
          {me.display_name}（{ROLE_LABEL[me.role]}）
        </span>
      </header>

      <div className="wrap stack">
        <h2 className="section-title">店舗の既定値</h2>
        <section className="card">
          <dl className="kv">
            <dt>営業時間</dt>
            <dd>
              日〜木 {minutesToLabel(openMin)}〜24:00 ／ 金・土 {minutesToLabel(openMin)}〜25:00
            </dd>
            <dt>定休日</dt>
            <dd>火曜</dd>
            <dt>標準滞在時間</dt>
            <dd>{stay}分</dd>
            <dt>イベント既定定員</dt>
            <dd>{eventCapacity}名</dd>
            <dt>席数</dt>
            <dd>{TOTAL_SEATS}席</dd>
          </dl>
          <p className="micro" style={{ marginTop: "0.6rem" }}>
            変更は Supabase の settings テーブルから行えます。画面からの編集は Phase 2 以降に入れます。
          </p>
        </section>

        <h2 className="section-title">席</h2>
        <section className="card">
          <dl className="kv">
            {seats.map((s) => (
              <Fragment key={s.id}>
                <dt>{s.code}</dt>
                <dd>
                  {s.name}・{s.capacity}名{s.is_shared ? "（相席可）" : ""}
                </dd>
              </Fragment>
            ))}
          </dl>
        </section>

        <h2 className="section-title">コース</h2>
        <section className="card">
          <dl className="kv">
            {courses.map((c) => (
              <Fragment key={c.id}>
                <dt>{c.price_yen ? `${c.price_yen.toLocaleString()}円` : "—"}</dt>
                <dd>
                  {c.name}
                  {c.note ? <span className="micro"> — {c.note}</span> : null}
                </dd>
              </Fragment>
            ))}
          </dl>
        </section>

        <h2 className="section-title">タブレット</h2>
        <div className="card">
          <a href="/board" className="btn" style={{ width: "100%", textAlign: "center" }}>
            席ボードを開く（レジ横タブレット用）
          </a>
          <p className="micro" style={{ marginTop: "0.5rem" }}>
            飛び込みのお客様をワンタップで記録すると、ネット予約の空席がリアルタイムで正確になります。
            新しいネット予約が入ると音つきでお知らせします。
          </p>
        </div>

        {/* 人時売上の材料（全員の労働時間）を freee人事労務 から取り込む（店主要望 2026-10-28） */}
        {freee ? (
          <>
            <h2 className="section-title">freee人事労務（人時売上）</h2>
            <section className="card stack">
              {freeeMsg ? <p className="notice">{freeeMsg}</p> : null}
              {freee.connected ? (
                <dl className="kv">
                  <dt>連携先</dt>
                  <dd>{freee.companyName ?? "—"}</dd>
                  <dt>最終取り込み</dt>
                  <dd>
                    {freee.lastSyncAt
                      ? new Date(freee.lastSyncAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
                      : "まだ"}
                  </dd>
                  {freee.lastError ? (
                    <>
                      <dt>エラー</dt>
                      <dd className="err">{freee.lastError}</dd>
                    </>
                  ) : null}
                </dl>
              ) : (
                <p className="micro">
                  freee人事労務の勤怠（出退勤）から全員の労働時間を毎朝取り込み、暦と売上タブに
                  「人時売上（店内の売上÷労働時間）」を出します。
                </p>
              )}
              {freeeConfigured() ? (
                <a className="btn btn-block" href="/api/freee/connect">
                  {freee.connected ? "freeeと連携し直す" : "freeeと連携"}
                </a>
              ) : (
                <p className="micro">freeeのアプリ登録（FREEE_CLIENT_ID / FREEE_CLIENT_SECRET）がまだです。</p>
              )}
              {freee.connected ? (
                <form method="post" action="/api/freee/sync">
                  <button type="submit" className="btn btn-block">
                    今すぐ取り込む（直近40日）
                  </button>
                </form>
              ) : null}
            </section>
          </>
        ) : null}

        <h2 className="section-title">アカウント</h2>
        <section className="stack">
          {can(me.role, "account.write") ? (
            <Link className="btn btn-block" href="/settings/accounts">
              スタッフのアカウント管理
            </Link>
          ) : null}
          <Link className="btn btn-block" href="/password">
            自分のパスワードを変更
          </Link>
          <LogoutButton />
        </section>

        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
