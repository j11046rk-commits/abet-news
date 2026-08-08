import Link from "next/link";
import { notFound } from "next/navigation";
import BackButton from "@/components/BackButton";
import DateJa from "@/components/DateJa";
import ReservationForm from "@/components/ReservationForm";
import StatusPanel from "@/components/StatusPanel";
import { SourceBadge } from "@/components/Badges";
import { requireProfile } from "@/lib/auth";
import { can, SOURCE_LABEL } from "@/lib/constants";
import {
  getCourses,
  getDailySummary,
  getProfileNames,
  getReservation,
  getSeatOccupancies,
  getSeatUnits,
  getSeatUsage,
  getStayMinutes,
} from "@/lib/queries";
import { fmt, startLabel } from "@/lib/time";
import { updateReservation } from "../actions";

export const dynamic = "force-dynamic";

/** S5 予約詳細・編集・状態遷移 */
export default async function ReservationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireProfile();
  const { id } = await params;

  const reservation = await getReservation(id);
  if (!reservation) notFound();

  const [day, usage, occupancies, stayMin, courses, seatUnits, names] = await Promise.all([
    getDailySummary(reservation.biz_date),
    getSeatUsage(reservation.biz_date, reservation.id),
    getSeatOccupancies(reservation.biz_date, reservation.id),
    getStayMinutes(),
    getCourses(),
    getSeatUnits(),
    getProfileNames(),
  ]);

  const editable = can(me.role, "reservation.write");
  const course = courses.find((c) => c.id === reservation.course_id);

  return (
    <>
      <header className="appbar">
        <BackButton fallback={`/?m=${reservation.biz_date.slice(0, 7)}`} />
        <div>
          <div className="appbar__title">{reservation.reference}</div>
          <div className="appbar__sub">
            <DateJa date={reservation.biz_date} long /> {startLabel(reservation)}
          </div>
        </div>
      </header>

      <div className="wrap stack">
        <section className="card">
          <div className="row" style={{ flexWrap: "wrap", marginBottom: "0.6rem" }}>
            <SourceBadge source={reservation.source} />
            {reservation.status === "cancelled" ? (
              <span className="badge badge--cancelled">キャンセル</span>
            ) : null}
          </div>

          <dl className="kv">
            <dt>お名前</dt>
            <dd>
              {reservation.customer_name} 様
              {reservation.customer_kana ? (
                <span className="muted">（{reservation.customer_kana}）</span>
              ) : null}
            </dd>

            <dt>人数</dt>
            <dd>{reservation.party_size} 名</dd>

            <dt>電話</dt>
            <dd>
              {reservation.phone ? (
                <a href={`tel:${reservation.phone.replace(/-/g, "")}`}>{reservation.phone}</a>
              ) : (
                <span className="muted">未入力</span>
              )}
            </dd>

            <dt>流入元</dt>
            <dd>
              {SOURCE_LABEL[reservation.source]}
              {reservation.source_profile_id
                ? `（${names.get(reservation.source_profile_id) ?? "—"}）`
                : ""}
            </dd>

            <dt>席</dt>
            <dd>{reservation.seat_note ?? <span className="muted">未定</span>}</dd>

            <dt>コース</dt>
            <dd>
              {course ? course.name : <span className="muted">指定なし</span>}
              {reservation.drink_plan ? "・飲み放題あり" : ""}
            </dd>

            {reservation.allergy ? (
              <>
                <dt>アレルギー</dt>
                <dd>{reservation.allergy}</dd>
              </>
            ) : null}

            {reservation.memo ? (
              <>
                <dt>メモ</dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{reservation.memo}</dd>
              </>
            ) : null}

            {reservation.cancel_reason ? (
              <>
                <dt>キャンセル理由</dt>
                <dd>{reservation.cancel_reason}</dd>
              </>
            ) : null}

            <dt>登録</dt>
            <dd className="micro">
              {reservation.created_by ? (names.get(reservation.created_by) ?? "—") : "—"} ／{" "}
              {fmt(reservation.created_at, "M月d日 HH:mm")}
            </dd>

            <dt>最終更新</dt>
            <dd className="micro">
              {reservation.updated_by ? (names.get(reservation.updated_by) ?? "—") : "—"} ／{" "}
              {fmt(reservation.updated_at, "M月d日 HH:mm")}
            </dd>
          </dl>
        </section>

        {editable ? (
          <>
            <StatusPanel
              id={reservation.id}
              cancelled={reservation.status === "cancelled"}
              cancelReason={reservation.cancel_reason}
            />

            <h2 className="section-title">内容を変更する</h2>
            <ReservationForm
              reservation={reservation}
              initialDay={day}
              initialUsage={usage}
              initialOccupancies={occupancies}
              stayMin={stayMin}
              defaultDate={reservation.biz_date}
              courses={courses}
              seatUnits={seatUnits}
              onSubmit={updateReservation.bind(null, reservation.id)}
            />
          </>
        ) : (
          <p className="micro">閲覧のみの権限です。内容の変更はできません。</p>
        )}

        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
