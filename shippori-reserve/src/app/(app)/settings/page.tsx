import { Fragment } from "react";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import { requireProfile } from "@/lib/auth";
import { can, ROLE_LABEL, TOTAL_SEATS } from "@/lib/constants";
import { getCourses, getSeatUnits, getSettings } from "@/lib/queries";
import { minutesToLabel } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * S11 設定。
 * Phase 1 では店舗の既定値は「見えること」までにしてある。
 * 画面から書き換えられるようにするのは、運用が固まってからでよい（設計 §S11）。
 */
export default async function SettingsPage() {
  const me = await requireProfile();
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
        <img src="/logo-face.png" alt="しっぽり亭" className="appbar__logo" />
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
