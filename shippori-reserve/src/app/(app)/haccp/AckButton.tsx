"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ackPlan } from "./actions";

/** スタッフ本人が「計画を読みました」を付ける */
export default function AckButton({ planId }: { planId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await ackPlan(planId);
            if (!r.ok) setErr(r.error);
            else router.refresh();
          })
        }
      >
        読みました
      </button>
      {err ? <span className="err">{err}</span> : null}
    </>
  );
}
