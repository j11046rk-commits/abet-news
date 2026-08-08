import Link from "next/link";
import { notFound } from "next/navigation";
import BusinessDayForm from "@/components/BusinessDayForm";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";
import { getBusinessDay, getDailySummary, getDefaultEventCapacity } from "@/lib/queries";
import { fmtDateJa } from "@/lib/time";
import { saveBusinessDay } from "../actions";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** S7 営業日設定。「その日をどう営業するか」を決める、このシステムの分岐点。 */
export default async function BusinessDayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const me = await requireProfile();
  const { date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const [day, summary, defaultCapacity] = await Promise.all([
    getBusinessDay(date),
    getDailySummary(date),
    getDefaultEventCapacity(),
  ]);

  const editable = can(me.role, "businessday.write");

  return (
    <>
      <header className="appbar">
        <Link className="btn btn-sm" href={`/calendar?m=${date.slice(0, 7)}`}>
          ‹ 暦
        </Link>
        <div>
          <div className="appbar__title">{fmtDateJa(date)}</div>
          <div className="appbar__sub">営業日の設定</div>
        </div>
      </header>

      <div className="wrap stack">
        <section className="summary">
          <div className="summary__item">
            <span className="summary__num">{summary.reservation_count}</span>
            <span className="summary__label">予約</span>
          </div>
          <div className="summary__item">
            <span className="summary__num">{summary.guest_count}</span>
            <span className="summary__label">名</span>
          </div>
          <div className="summary__item">
            <Link className="btn btn-sm" href={`/?d=${date}`}>
              この日の予約を見る
            </Link>
          </div>
        </section>

        {editable ? (
          <BusinessDayForm
            day={day}
            guestCount={summary.guest_count}
            defaultCapacity={defaultCapacity}
            onSubmit={saveBusinessDay}
          />
        ) : (
          <p className="micro">営業日を変更する権限がありません。</p>
        )}

        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
