import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can, ROLE_LABEL } from "@/lib/constants";
import { getAllProfiles } from "@/lib/queries";
import { todayBizDate } from "@/lib/time";
import { planIssues } from "@/lib/haccp";
import { getAcks, getNotices, getPlans } from "@/lib/haccp-data";
import { mdhm } from "@/lib/haccp-time";
import HaccpTabs from "../HaccpTabs";
import PlanView from "../PlanView";
import PlanEditor from "../PlanEditor";
import AckButton from "../AckButton";
import { CreateDraftButton, NoticeForm } from "./PlanActions";

export const dynamic = "force-dynamic";

/**
 * 衛生管理計画：いま使っている版・下書き・版の履歴・スタッフへの周知。
 * ?v=版番号 で過去の版を読む。
 */
export default async function PlanPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const me = await requirePermission("haccp.record");
  const sp = await searchParams;
  const canManage = can(me.role, "haccp.manage");
  const canApprove = can(me.role, "haccp.approve");
  const [plans, profiles] = await Promise.all([getPlans(), getAllProfiles()]);
  const names = new Map(profiles.map((p) => [p.id, p.display_name]));
  const today = todayBizDate();
  const current = plans.find((p) => p.status === "approved") ?? null;
  const draft = plans.find((p) => p.status === "draft") ?? null;
  const picked = sp.v ? plans.find((p) => String(p.version) === sp.v && p.status !== "draft") ?? null : null;
  const shown = picked ?? current;
  const [notices, acks] = shown ? await Promise.all([getNotices([shown.id]), getAcks([shown.id])]) : [[], []];
  const ackSet = new Map(acks.map((a) => [a.profile_id, a.acked_at]));
  const staff = profiles.filter((p) => p.is_active && (p.role === "owner" || p.role === "manager" || p.role === "staff"));
  const shownIssues = shown ? planIssues(shown, shown.content) : [];

  return (
    <>
      <header className="appbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-face-96.png" alt="しっぽり亭" width={96} height={96} className="appbar__logo" />
        <div className="appbar__title">衛生管理計画</div>
        <div className="appbar__spacer" />
        {shown ? (
          <Link className="btn btn-sm" href={`/haccp/print?type=plan&v=${shown.version}`}>印刷・PDF</Link>
        ) : null}
      </header>
      <HaccpTabs current="plan" canManage={canManage} />

      <div className="wrap stack">
        {!current && !draft ? (
          <section className="notice notice-strong">
            まだ衛生管理計画がありません。
            {canManage
              ? "下書きを作ると、手引書の項目（一般衛生管理）だけが入った状態で始まります。誰が担当するか・冷蔵庫の台数・メニューは、店の実態に合わせて入れてください。"
              : "店長・オーナーが計画を作ると、ここで読めるようになります。"}
            {canManage ? <div style={{ marginTop: "0.6rem" }}><CreateDraftButton label="計画の下書きを作る" /></div> : null}
          </section>
        ) : null}

        {shown ? (
          <section className="card stack">
            <div className="row" style={{ flexWrap: "wrap" }}>
              <span className={`hc-pill ${shown.status === "approved" ? "hc-pill--ok" : ""}`}>
                第{shown.version}版・{shown.status === "approved" ? "運用中" : "過去の版"}
              </span>
              {shown.status === "approved" && shown.effective_from && shown.effective_from > today ? (
                <span className="hc-pill hc-pill--todo">{shown.effective_from} から適用</span>
              ) : null}
            </div>
            <dl className="kv">
              <dt>店舗</dt><dd>{shown.store_name}</dd>
              <dt>食品衛生責任者</dt><dd>{shown.hygiene_manager}</dd>
              <dt>計画作成者</dt><dd>{shown.author_name}</dd>
              <dt>承認者</dt><dd>{names.get(shown.approved_by ?? "") ?? "?"}（{mdhm(shown.approved_at)}）</dd>
              <dt>適用開始日</dt><dd>{shown.effective_from}</dd>
              {shown.change_reason ? (<><dt>変更理由</dt><dd>{shown.change_reason}</dd></>) : null}
            </dl>
            {shownIssues.length > 0 ? (
              <p className="err">この版には未設定の項目が{shownIssues.length}件あります。</p>
            ) : null}
            <p className="micro">
              この画面の計画は書類として整えたものです。保健所の確認や認証を受けたことを示すものではありません。
            </p>
          </section>
        ) : null}

        {shown ? (
          <section className="card stack">
            <h2 className="section-title" style={{ margin: 0 }}>スタッフへの周知</h2>
            {notices.length === 0 ? <p className="err">まだ周知の記録がありません。</p> : null}
            {notices.map((n) => (
              <div key={n.id} className="micro">
                {n.noticed_on}　{n.method}{n.note ? `（${n.note}）` : ""}　記録：{names.get(n.recorded_by ?? "") ?? "?"}
              </div>
            ))}
            {canManage && shown.status === "approved" ? <NoticeForm planId={shown.id} today={today} /> : null}
            <h3 className="field-label" style={{ marginTop: "0.6rem" }}>読んだ確認（本人が押す）</h3>
            <ul className="hc-acks">
              {staff.map((p) => (
                <li key={p.id}>
                  {ackSet.has(p.id) ? "✓" : "・"} {p.display_name}
                  <span className="micro">（{ROLE_LABEL[p.role]}）{ackSet.has(p.id) ? ` ${mdhm(ackSet.get(p.id))}` : " 未確認"}</span>
                </li>
              ))}
            </ul>
            {shown.status === "approved" && !ackSet.has(me.id) ? <AckButton planId={shown.id} /> : null}
          </section>
        ) : null}

        {shown ? <PlanView content={shown.content} /> : null}

        {plans.filter((p) => p.status !== "draft").length > 1 ? (
          <section className="card stack">
            <h2 className="section-title" style={{ margin: 0 }}>版の履歴</h2>
            {plans
              .filter((p) => p.status !== "draft")
              .map((p) => (
                <Link key={p.id} href={`/haccp/plan?v=${p.version}`} className="micro">
                  第{p.version}版　{p.effective_from} から　{p.status === "approved" ? "運用中" : "置き換え済み"}　{p.change_reason ?? ""}
                </Link>
              ))}
          </section>
        ) : null}

        {canManage && current && !draft ? (
          <section className="card stack">
            <h2 className="section-title" style={{ margin: 0 }}>計画を見直す</h2>
            <p className="micro">
              メニューや設備を変えたとき、振り返りで見直しが必要になったときは、新しい版の下書きを作ります。
              今の版はそのまま残り、過去の記録は当時の版で判定されたままです。
            </p>
            <CreateDraftButton label="今の版をもとに下書きを作る" />
          </section>
        ) : null}

        {draft ? (
          canManage ? (
            <PlanEditor
              key={draft.id + draft.updated_at}
              draft={draft}
              canApprove={canApprove}
              hasApproved={!!current}
            />
          ) : (
            <section className="notice">計画の見直し（第{draft.version}版の下書き）が進んでいます。</section>
          )
        ) : null}
      </div>
      <div style={{ height: "4rem" }} />
    </>
  );
}
