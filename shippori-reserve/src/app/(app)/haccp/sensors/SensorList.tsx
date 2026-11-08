"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeSensor, setSensor } from "./actions";

export type SensorView = {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  cloud: boolean;
  equipmentId: string | null;
  registered: boolean;
  temp: number | null;
  battery: number | null;
  error: string | null;
  lastSavedAt: string | null;
};

const hmd = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function SensorList({ views, equipment }: { views: SensorView[]; equipment: { id: string; name: string; auto: boolean }[] }) {
  return (
    <ul className="sb-list">
      {views.map((v) => (
        <SensorRow key={v.deviceId} v={v} equipment={equipment} taken={new Map(views.filter((x) => x.equipmentId && x.deviceId !== v.deviceId).map((x) => [x.equipmentId!, x.deviceName]))} />
      ))}
    </ul>
  );
}

function SensorRow({ v, equipment, taken }: { v: SensorView; equipment: { id: string; name: string; auto: boolean }[]; taken: Map<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const value = v.registered ? (v.equipmentId ?? "watch") : "";

  const change = (val: string) =>
    start(async () => {
      setErr(null);
      setSaved(false);
      if (val === "") {
        if (v.registered) {
          const r = await removeSensor(v.deviceId);
          if (!r.ok) setErr(r.error);
        }
      } else {
        const r = await setSensor({ deviceId: v.deviceId, deviceName: v.deviceName, deviceType: v.deviceType, equipmentId: val === "watch" ? null : val });
        if (!r.ok) setErr(r.error);
      }
      setSaved(true);
      router.refresh();
    });

  return (
    <li className="sb-row">
      <div className="sb-row__head">
        <span className="sb-row__name">
          {v.deviceName}
          <span className="micro">　{v.deviceType}</span>
        </span>
        <span className="sb-row__temp">{v.temp != null ? `${v.temp}℃` : "—"}</span>
      </div>
      <div className="micro">
        {v.battery != null ? `電池 ${v.battery}%` : ""}
        {v.lastSavedAt ? `　最後に記録：${hmd(v.lastSavedAt)}` : v.registered ? "　まだ記録なし（30分以内に始まります）" : ""}
        {!v.cloud ? "　⚠ クラウドサービスがオフ" : ""}
      </div>
      {v.error ? <p className="err">{v.error}</p> : null}
      <label className="field-label" htmlFor={`sb-${v.deviceId}`}>
        置いた場所
      </label>
      <select id={`sb-${v.deviceId}`} className="field" value={value} disabled={pending} onChange={(e) => change(e.target.value)}>
        <option value="">使わない</option>
        <option value="watch">参考に見るだけ（記録しない）</option>
        {equipment.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
            {e.auto ? "" : "（計画では手入力）"}
            {taken.has(e.id) ? `（いま：${taken.get(e.id)}）` : ""}
          </option>
        ))}
      </select>
      {saved && !err ? <p className="micro">保存しました</p> : null}
      {err ? <p className="err">{err}</p> : null}
    </li>
  );
}
