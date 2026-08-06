"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateSettings } from "./actions";
import { parseYen, yen } from "@/lib/money";
import type { Settings } from "@/lib/types";

export default function SettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [facilityName, setFacilityName] = useState(settings.facility_name);
  const [target, setTarget] = useState(settings.monthly_target_yen);
  const [ownerCount, setOwnerCount] = useState(settings.owner_count);
  const [rakeRule, setRakeRule] = useState(settings.rake_rule ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await updateSettings({
      facilityName,
      monthlyTargetYen: target,
      ownerCount,
      rakeRule,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setFlash("保存しました");
    router.refresh();
  }

  return (
    <form className="rform" onSubmit={submit}>
      <div>
        <label className="field-label" htmlFor="st-name">
          施設名
        </label>
        <input
          id="st-name"
          className="field"
          value={facilityName}
          onChange={(e) => setFacilityName(e.target.value)}
          required
        />
      </div>

      <div className="rform__row2">
        <div>
          <label className="field-label" htmlFor="st-target">
            月次目標額
          </label>
          <input
            id="st-target"
            className="field field-num"
            inputMode="numeric"
            pattern="[0-9]*"
            value={target === 0 ? "" : String(target)}
            onChange={(e) => setTarget(Math.max(0, parseYen(e.target.value)))}
            required
          />
          <p className="micro amount">{yen(target)}</p>
        </div>
        <div>
          <label className="field-label" htmlFor="st-owners">
            オーナー人数
          </label>
          <input
            id="st-owners"
            type="number"
            min={1}
            max={30}
            className="field field-num"
            value={ownerCount}
            onChange={(e) => setOwnerCount(Math.max(1, Number(e.target.value) || 1))}
          />
          <p className="micro">不足額の分担に使います。</p>
        </div>
      </div>

      <div>
        <label className="field-label" htmlFor="st-rake">
          レーキルール
        </label>
        <textarea
          id="st-rake"
          className="field"
          value={rakeRule}
          onChange={(e) => setRakeRule(e.target.value)}
          placeholder="キャッシュゲームはポット5%（上限 ¥1,000）。"
        />
      </div>

      {error ? <p className="err">{error}</p> : null}
      {flash ? <p className="notice">{flash}</p> : null}

      <div className="rform__actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "保存中" : "保存する"}
        </button>
      </div>
    </form>
  );
}
