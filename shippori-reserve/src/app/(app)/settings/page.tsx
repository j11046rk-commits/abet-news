import { Fragment } from "react";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import { requireProfile } from "@/lib/auth";
import { can, ROLE_LABEL, TOTAL_SEATS } from "@/lib/constants";
import { getCourses, getLaborStatus, getSeatUnits, getSettings } from "@/lib/queries";
import { minutesToLabel } from "@/lib/time";
import { freeeStatus } from "@/lib/freee";

export const dynamic = "force-dynamic";

/**
 * S11 設定。
 * Phase 1 では店舗の既定値は「見えること」までにしてある。
 * 画面から書き換えられるようにするのは、運用が固まってからでよい（設計 §S11）。
 */

const FREEE_MSG: Record<string, string> = {
  connected: "freee とつながりました。労働時間と人件費を取り込みました。",
  synced: "取り込みました。",
  noconfig: "freee のアプリの鍵（FREEE_CLIENT_ID / FREEE_CLIENT_SECRET）が Vercel に入っていません。",
  forbidden: "この操作はオーナー・店長だけです。",
  error: "freee との連携・取り込みでエラーになりました。",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ freee?: string; why?: string }> }) {
  const me = await requireProfile();
  const sp = await searchParams;
  // オーナー・店長だけに見せる欄（人時売上の取り込み状況・HPのダッシュボード）
  const manageFreee = can(me.role, "settings.write");
  const [laborStatus, freee] = manageFreee ? await Promise.all([getLaborStatus(), freeeStatus()]) : [null, null];
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
        {/* 評価（店長・オーナーだけ・店主指定 2026-11-09）：店舗評価の推移・昇給・目標・⭐の交換 */}
        {me.role === "owner" || me.role === "manager" ? (
          <>
            <h2 className="section-title">評価</h2>
            <div className="card">
              <Link href="/settings/eval" className="btn" style={{ width: "100%", textAlign: "center" }}>
                評価を開く（店舗評価・昇給・⭐の交換）
              </Link>
              <p className="micro" style={{ marginTop: "0.5rem" }}>店長とオーナーだけに見えます。</p>
            </div>
          </>
        ) : null}

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

        {/* HPのアクセス管理ダッシュボードへの入口（店主要望 2026-11-02）。
            2026-11-04〜 合言葉をやめ、このアプリにログインしている人なら誰でも見られる（/hp-dashboard） */}
        <h2 className="section-title">ホームページ</h2>
        <div className="card">
          <a href="/hp-dashboard" className="btn" style={{ width: "100%", textAlign: "center" }}>
            アクセス管理ダッシュボードを開く
          </a>
          <p className="micro" style={{ marginTop: "0.5rem" }}>
            ホームページの訪問数・どこから来たか・押されたボタン、ネット予約の集計が見られます（直近28日・1時間ごとに更新）。
            合言葉は要りません。
          </p>
        </div>

        {/* 口コミのお願い（2026-11-07）。LINEで届くのはLINEつきの予約だけなので、店内でも同じお願いをする */}
        <h2 className="section-title">口コミのお願い</h2>
        <div className="card stack">
          <a href="/review-qr" className="btn" style={{ width: "100%", textAlign: "center" }}>
            会計のときに見せるQRを出す
          </a>
          <a href="/review-qr/print" className="btn" style={{ width: "100%", textAlign: "center" }}>
            卓・レジに置くカードを印刷する（名刺サイズ9枚）
          </a>
          <p className="micro">
            Googleマップの口コミページにつながるQRです。席ボードの「口コミQR」からも出せます。
            どのお客様にも同じように「よろしければ」と見せてください。割引やサービスと引き換えにするのは禁止です（Googleのルール）。
          </p>
        </div>

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

        {/* 人時売上の材料（全員の労働時間の合計）。店のMac（週次レポート）が freee人事労務 から
            毎日取り込んで /api/labor/ingest へ送る（2026-11-02〜）。ここでは届いている状況だけ見せる */}
        {laborStatus ? (
          <>
            <h2 className="section-title">労働時間・人件費（freee人事労務）</h2>
            <section className="card stack">
              {sp.freee && FREEE_MSG[sp.freee] ? (
                <p className={sp.freee === "connected" || sp.freee === "synced" ? "notice micro" : "err"}>
                  {FREEE_MSG[sp.freee]}
                  {sp.why ? `（${sp.why}）` : ""}
                </p>
              ) : null}
              <dl className="kv">
                <dt>アプリとfreee</dt>
                <dd>{freee?.connected ? `つながっています（${freee.companyName ?? ""}）` : "まだつないでいません"}</dd>
                {freee?.lastSyncAt ? (
                  <>
                    <dt>最後の取り込み</dt>
                    <dd>{new Date(freee.lastSyncAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</dd>
                  </>
                ) : null}
                <dt>労働時間の最新の日</dt>
                <dd>{laborStatus.latest ?? "まだ届いていません"}（{laborStatus.days}日ぶん）</dd>
              </dl>
              {freee?.lastError ? <p className="err micro">{freee.lastError}</p> : null}
              {me.role === "owner" ? (
                <a href="/api/freee/connect" className="btn" style={{ width: "100%", textAlign: "center" }}>
                  {freee?.connected ? "freeeとつなぎ直す" : "freeeと連携する（オーナー）"}
                </a>
              ) : null}
              {freee?.connected ? (
                <form method="post" action="/api/freee/sync">
                  <button type="submit" className="btn btn-sm">
                    今すぐ取り込む（直近40日）
                  </button>
                </form>
              ) : null}
              <p className="micro">
                毎朝、前日までの勤怠と給与の設定から「その日の人件費の合計」を計算して残します（2026-11-09〜）。
                一人ずつの時間・時給・給与は計算の中でだけ使い、アプリには保存しません。日ごとの人件費は店長・オーナーだけが見られます。
                給与が確定した月は、給与明細の合計（総支給額＋会社負担の社会保険など・役員を除く）が月の実際の人件費になります。
                連携はfreeeで給与まで見られるオーナーのアカウントで行ってください。
              </p>
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
