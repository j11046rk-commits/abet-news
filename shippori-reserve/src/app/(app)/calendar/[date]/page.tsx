import Link from "next/link";
import { notFound } from "next/navigation";
import BusinessDayForm from "@/components/BusinessDayForm";
import DateJa from "@/components/DateJa";
import SalesDayForm from "@/components/SalesDayForm";
import { requireProfile } from "@/lib/auth";
import { can } from "@/lib/constants";
import {
  getBusinessDay,
  getDailySummary,
  getDefaultEventCapacity,
  getSalesDay,
} from "@/lib/queries";
import { saveBusinessDay, uploadFlyer } from "../actions";

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

  const [day, summary, defaultCapacity, sales] = await Promise.all([
    getBusinessDay(date),
    getDailySummary(date),
    getDefaultEventCapacity(),
    getSalesDay(date),
  ]);

  const editable = can(me.role, "businessday.write");

  return (
    <>
      <header className="appbar">
        <Link className="btn btn-sm" href={`/?m=${date.slice(0, 7)}`}>
          ‹ カレンダー
        </Link>
        <div>
          <div className="appbar__title">
            <DateJa date={date} long />
          </div>
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
            <Link className="btn btn-sm" href={`/day/${date}`}>
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
            onUploadFlyer={uploadFlyer}
          />
        ) : (
          <p className="micro">営業日を変更する権限がありません。</p>
        )}

        {can(me.role, "sales.write") ? <SalesDayForm key={date} date={date} sales={sales} /> : null}

        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
