import type { Metadata } from "next";
import AccountAdmin from "./AccountAdmin";
import ExclusiveHoursTable from "./ExclusiveHoursTable";
import { requireProfile } from "@/lib/auth";
import { getExclusiveHours, getPlayers, getPlayerStats, getProfiles } from "@/lib/queries";
import { fmtDate, fmtYm, nowJst } from "@/lib/time";
import { yen } from "@/lib/money";

export const metadata: Metadata = { title: "メンバー — The Oldman" };
export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const [me, profiles, players, stats, hours] = await Promise.all([
    requireProfile(),
    getProfiles(),
    getPlayers(),
    getPlayerStats(),
    getExclusiveHours(),
  ]);

  const now = nowJst();
  const thisMonth = fmtYm(now);
  const thisYear = fmtDate(now).slice(0, 4);

  const owners = profiles.filter((p) => p.role === "owner");
  const playerByProfile = new Map(players.filter((p) => p.profile_id).map((p) => [p.profile_id!, p]));

  const guests = players.filter((p) => !p.profile_id);

  return (
    <>
      <header className="page">
        <h1 className="display">メンバー</h1>
      </header>

      <div className="rule">
        <span className="label">Owners — {owners.length}</span>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>名前</th>
            <th className="ta-r">出資額</th>
            <th className="ta-r">参加</th>
            <th className="ta-r">直近</th>
          </tr>
        </thead>
        <tbody>
          {owners.map((o) => {
            const pl = playerByProfile.get(o.id);
            const st = pl ? stats.get(pl.id) : undefined;
            return (
              <tr key={o.id}>
                <td>
                  {o.display_name}
                  {o.id === me.id ? <span className="micro"> — あなた</span> : null}
                </td>
                <td className="ta-r amount">{yen(o.investment_yen)}</td>
                <td className="ta-r amount">{st?.count ?? 0}</td>
                <td className="ta-r amount">{st?.last ? fmtDate(st.last) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ExclusiveHoursTable
        profiles={profiles.map((p) => ({ id: p.id, name: p.display_name }))}
        rows={hours}
        thisMonth={thisMonth}
        thisYear={thisYear}
      />

      <div className="rule">
        <span className="label">Players — {players.length}</span>
      </div>

      <p className="dim">ゲストを含む参加者マスタです。セッションの記録から自動で増えます。</p>

      <table className="table">
        <thead>
          <tr>
            <th>名前</th>
            <th className="ta-r">参加</th>
            <th className="ta-r">直近</th>
          </tr>
        </thead>
        <tbody>
          {players.length === 0 ? (
            <tr>
              <td colSpan={3} className="empty">
                まだ参加者がいません。
              </td>
            </tr>
          ) : (
            players.map((p) => {
              const st = stats.get(p.id);
              return (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    {p.profile_id ? <span className="micro"> — アカウントあり</span> : null}
                  </td>
                  <td className="ta-r amount">{st?.count ?? 0}</td>
                  <td className="ta-r amount">{st?.last ? fmtDate(st.last) : "—"}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

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
          アカウントの発行とパスワードの再発行はオーナーが行います。 ゲスト {guests.length}名。
        </p>
      )}
    </>
  );
}
