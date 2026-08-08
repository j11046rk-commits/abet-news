import BackButton from "@/components/BackButton";
import ReservationForm from "@/components/ReservationForm";
import { requirePermission } from "@/lib/auth";
import { getCourses, getDailySummary, getSeatUnits, getSeatUsage } from "@/lib/queries";
import { todayBizDate } from "@/lib/time";
import { createReservation } from "../actions";

export const dynamic = "force-dynamic";

/**
 * S4 予約登録。
 * 電話を受けながら、通話中に入力し終えるのが要件。入力順は電話で聞く順に並べてある。
 */
export default async function NewReservationPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  await requirePermission("reservation.write");

  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? "") ? sp.d! : todayBizDate();

  const [day, usage, courses, seatUnits] = await Promise.all([
    getDailySummary(date),
    getSeatUsage(date),
    getCourses(),
    getSeatUnits(),
  ]);

  return (
    <>
      <header className="appbar">
        <BackButton fallback={`/day/${date}`} />
        <div className="appbar__title">予約を登録</div>
      </header>

      <div className="wrap">
        <ReservationForm
          initialDay={day}
          initialUsage={usage}
          defaultDate={date}
          courses={courses}
          seatUnits={seatUnits}
          onSubmit={createReservation}
        />
        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}
