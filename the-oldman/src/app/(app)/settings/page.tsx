import type { Metadata } from "next";
import SettingsForm from "./SettingsForm";
import { requireOwner } from "@/lib/auth";
import { getSettings } from "@/lib/queries";

export const metadata: Metadata = { title: "設定 — The Oldman" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireOwner();
  const settings = await getSettings();

  return (
    <>
      <header className="page">
        <h1 className="display">設定</h1>
        <p className="dim page__lead">オーナーのみ変更できます。</p>
      </header>

      <div className="rule">
        <span className="label">Facility</span>
      </div>

      <SettingsForm settings={settings} />

      <div className="rule">
        <span className="label">Timezone</span>
      </div>

      <p className="dim">
        Asia/Tokyo に固定しています。日付・時刻の表示と集計はすべて日本時間です。
      </p>
    </>
  );
}
