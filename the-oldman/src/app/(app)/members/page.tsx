import type { Metadata } from "next";
import AccountAdmin from "./AccountAdmin";
import ExclusiveHoursTable from "./ExclusiveHoursTable";
import { requireProfile } from "@/lib/auth";
import { getExclusiveHours, getProfiles } from "@/lib/queries";
import { fmtDate, fmtYm, nowJst } from "@/lib/time";
import { yen } from "@/lib/money";

export const metadata: Metadata = { title: "メンバー — The Oldman" };
export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const [me, profiles, hours] = await Promise.all([
    requireProfile(),
    getProfiles(),
    getExclusiveHours(),
  ]);

  const now = nowJst();
  const thisMonth = fmtYm(now);
  const thisYear = fmtDate(now).slice(0, 4);

  return (
    <>
      <header className="page">
        <h1 className="display">メンバー</h1>
      </header>

      <div className="rule">
        <span className="label">Members — {profiles.length}</span>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>名前</th>
            <th>ロール</th>
            <th className="ta-r">出資額</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id} className={p.is_active ? undefined : "is-off"}>
              <td>
                {p.display_name}
                {p.id === me.id ? <span className="micro"> — あなた</span> : null}
              </td>
              <td className="micro">{p.role === "owner" ? "オーナー" : "メンバー"}</td>
              <td className="ta-r amount">{yen(p.investment_yen)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ExclusiveHoursTable
        profiles={profiles.map((p) => ({ id: p.id, name: p.display_name }))}
        rows={hours}
        thisMonth={thisMonth}
        thisYear={thisYear}
      />

      {me.role === "owner" ? (
        <AccountAdmin
          accounts={profiles.map((p) => ({
            id: p.id,
            login_id: p.login_id,
            display_name: p.display_name,
            role: p.role,
            is_active: p.is_active,
            must_change_password: p.must_change_password,
            investment_yen: p.investment_yen,
          }))}
          meId={me.id}
        />
      ) : (
        <p className="micro members__foot">
          アカウントの発行とパスワードの再発行はオーナーが行います。
        </p>
      )}
    </>
  );
}
