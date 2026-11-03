import NetBooking from "@/components/NetBooking";
import { listNetCourses } from "@/lib/public-booking";

// コースの一覧（期間内のもの）を毎回読む（期間が終われば自然に消える）
export const dynamic = "force-dynamic";

export default async function NetBookingPage() {
  const courses = await listNetCourses();
  return <NetBooking courses={courses} />;
}
