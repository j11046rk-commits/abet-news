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

type Eq = { id: string; name: string; auto: boolean; kind: string; maxC: number | null; minC: number | null };

/** 全角・半角のかっこ等の違いは同じ名前として扱う（SwitchBotは「冷蔵庫①(キッチン)」、計画は「冷蔵庫①（キッチン）」） */
const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
const hm = (iso: string) => new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });

/**
 * 温度計の一覧。スマホで6台がひと目で見えるよう、1台1行に詰める（店主指定 2026-11-08）。
 * 置いた場所の選択は普段使わないので「場所を変える」を押したときだけ出す。
 */
export default function SensorList({ views, equipment }: { views: SensorView[]; equipment: Eq[] }) {
  const taken = new Map(views.filter((x) => x.equipmentId).map((x) => [x.equipmentId!, x.deviceName]));
  return (
    <ul className="sb-list">
      {views.map((v) => (
        <SensorRow key={v.deviceId} v={v} equipment={equipment} taken={taken} />
      ))}
    </ul>
  );
}

function SensorRow({ v, equipment, taken }: { v: SensorView; equipment: Eq[]; taken: Map<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(!v.registered);
  const eq = v.equipmentId ? equipment.find((e) => e.id === v.equipmentId) ?? null : null;
  const out =
    eq && v.temp != null ? (eq.maxC != null && v.temp > eq.maxC) || (eq.minC != null && v.temp < eq.minC) : false;
  const limit = eq ? [eq.maxC != null ? `${eq.maxC}℃以下` : "", eq.minC != null ? `${eq.minC}℃以上` : ""].filter(Boolean).join("・") : "";
  const place = !v.registered ? "未設定" : eq ? eq.name : "参考に見るだけ";
  const value = v.registered ? (v.equipmentId ?? "watch") : "";

  const change = (val: string) =>
    start(async () => {
      setErr(null);
      const r =
        val === ""
          ? v.registered
            ? await removeSensor(v.deviceId)
            : { ok: true as const }
          : await setSensor({ deviceId: v.deviceId, deviceName: v.deviceName, deviceType: v.deviceType, equipmentId: val === "watch" ? null : val });
      if (!r.ok) setErr(r.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });

  return (
    <li className={`sb-row${out ? " sb-row--ng" : ""}${!v.registered ? " sb-row--off" : ""}`}>
      <div className="sb-row__main">
        <div className="sb-row__left">
          <span className="sb-row__name">{v.deviceName}</span>
          <span className="sb-row__meta">
            {eq && norm(eq.name) !== norm(v.deviceName) ? `${eq.name}・` : !eq ? `${place}・` : ""}
            {limit ? `基準${limit}` : ""}
            {v.battery != null ? `・電池${v.battery}%` : ""}
            {v.lastSavedAt ? `・記録${hm(v.lastSavedAt)}` : ""}
            {!v.cloud ? "・⚠クラウドオフ" : ""}
          </span>
        </div>
        <span className="sb-row__temp">{v.temp != null ? `${v.temp}℃` : "—"}</span>
      </div>
      {v.error ? <p className="err sb-row__err">{v.error}</p> : null}
      {open ? (
        <div className="sb-row__edit">
          <select aria-label={`${v.deviceName}を置いた場所`} className="field" value={value} disabled={pending} onChange={(e) => change(e.target.value)}>
            <option value="">使わない</option>
            <option value="watch">参考に見るだけ（記録しない）</option>
            {equipment.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.auto ? "" : "（計画では手入力）"}
                {taken.has(e.id) && taken.get(e.id) !== v.deviceName ? `（いま：${taken.get(e.id)}）` : ""}
              </option>
            ))}
          </select>
          {v.registered ? (
            <button type="button" className="linklike micro" onClick={() => setOpen(false)}>
              閉じる
            </button>
          ) : null}
        </div>
      ) : (
        <button type="button" className="linklike sb-row__change" onClick={() => setOpen(true)}>
          場所を変える
        </button>
      )}
      {err ? <p className="err">{err}</p> : null}
    </li>
  );
}
