"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { shrinkImage } from "@/lib/image";
import { fmtYen } from "@/lib/sales";
import {
  CATEGORY_LABEL,
  DOC_KIND_LABEL,
  LOSS_REASON_LABEL,
  purchaseEx,
  totalMismatch,
  type CostCategory,
  type DocKind,
  type LossReason,
  type Purchase,
  type PurchaseDraft,
} from "@/lib/cost";
import type { Loss } from "@/lib/cost-data";
import { addLoss, deleteLoss, deletePurchase, discardPhoto, readPurchasePhoto, savePurchase } from "./actions";

type P = {
  ym: string;
  today: string;
  canWrite: boolean;
  aiReady: boolean;
  purchases: Purchase[];
  losses: Loss[];
  photos: Record<string, string>;
  warnIds: string[];
};

const CATS: CostCategory[] = ["food", "drink", "supplies", "other"];
const KINDS: DocKind[] = ["receipt", "slip", "invoice"];
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

type FormState = {
  id?: string;
  doc_kind: DocKind;
  vendor: string;
  book_date: string;
  period_from: string;
  period_to: string;
  amounts: Record<CostCategory, string>;
  total_in: string;
  memo: string;
  photo_path: string | null;
  ai_read: boolean;
  note: string;
  /** 撮ったばかりの写真（この端末の中だけの表示用） */
  preview?: string;
};

const blank = (today: string, photo: string | null = null): FormState => ({
  doc_kind: "receipt",
  vendor: "",
  book_date: today,
  period_from: "",
  period_to: "",
  amounts: { food: "", drink: "", supplies: "", other: "" },
  total_in: "",
  memo: "",
  photo_path: photo,
  ai_read: false,
  note: "",
});

const fromDraft = (d: PurchaseDraft, photo: string): FormState => ({
  doc_kind: d.doc_kind,
  vendor: d.vendor,
  book_date: d.book_date,
  period_from: d.period_from ?? "",
  period_to: d.period_to ?? "",
  amounts: {
    food: d.food_ex ? String(d.food_ex) : "",
    drink: d.drink_ex ? String(d.drink_ex) : "",
    supplies: d.supplies_ex ? String(d.supplies_ex) : "",
    other: d.other_ex ? String(d.other_ex) : "",
  },
  total_in: d.total_in != null ? String(d.total_in) : "",
  memo: "",
  photo_path: photo,
  ai_read: true,
  note: d.note,
});

const fromRow = (p: Purchase): FormState => ({
  id: p.id,
  doc_kind: p.doc_kind,
  vendor: p.vendor,
  book_date: p.book_date,
  period_from: p.period_from ?? "",
  period_to: p.period_to ?? "",
  amounts: {
    food: p.food_ex ? String(p.food_ex) : "",
    drink: p.drink_ex ? String(p.drink_ex) : "",
    supplies: p.supplies_ex ? String(p.supplies_ex) : "",
    other: p.other_ex ? String(p.other_ex) : "",
  },
  total_in: p.total_in != null ? String(p.total_in) : "",
  memo: p.memo ?? "",
  photo_path: p.photo_path ?? null,
  ai_read: !!p.ai_read,
  note: "",
});

/** 全角数字・カンマ・円記号を許して整数に。空欄は0 */
const toYen = (s: string): number | null => {
  const t = s.normalize("NFKC").replace(/[,¥円\s]/g, "");
  if (t === "") return 0;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
};

export default function CostPanels(p: P) {
  const [form, setForm] = useState<FormState | null>(null);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  return (
    <>
      {p.canWrite ? (
        form ? (
          <PurchaseForm
            key={form.id ?? form.photo_path ?? "new"}
            init={form}
            photoUrl={form.photo_path ? p.photos[form.photo_path] : undefined}
            aiMsg={aiMsg}
            onClose={() => {
              setForm(null);
              setAiMsg(null);
            }}
          />
        ) : (
          <Capture
            {...p}
            onRead={(f, msg) => {
              setForm(f);
              setAiMsg(msg);
            }}
          />
        )
      ) : null}

      <h2 className="section-title">仕入（{p.purchases.length}件）</h2>
      {p.purchases.length === 0 ? <p className="micro">この月の仕入はまだありません。</p> : null}
      <ul className="cost-list">
        {p.purchases.map((x) => (
          <PurchaseRow
            key={x.id}
            p={x}
            warn={p.warnIds.includes(x.id)}
            photoUrl={x.photo_path ? p.photos[x.photo_path] : undefined}
            canWrite={p.canWrite}
            onEdit={() => {
              setAiMsg(null);
              setForm(fromRow(x));
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        ))}
      </ul>

      <LossSection {...p} />
    </>
  );
}

// ── 撮る ─────────────────────────────────────────────────────

function Capture(p: P & { onRead: (f: FormState, msg: string | null) => void }) {
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      // 細かい字を読ませるので、チラシより大きめ（長辺2400px）に縮める
      const small = await shrinkImage(file, 2400, 0.85);
      const fd = new FormData();
      fd.set("file", small);
      const r = await readPurchasePhoto(fd);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      const preview = URL.createObjectURL(small);
      if (r.draft) {
        p.onRead({ ...fromDraft(r.draft, r.photoPath), preview }, "AIが読みました。写真と見比べて、違うところだけ直して保存してください。");
      } else {
        const why =
          r.ai === "nokey"
            ? "AIの読み取りはまだ準備中です（鍵の設定待ち）。写真は保存したので、金額を手で入れてください。"
            : "AIが読み取れませんでした。写真は保存したので、金額を手で入れてください。";
        p.onRead({ ...blank(p.today, r.photoPath), preview }, why);
      }
    } catch {
      setErr("送れませんでした。電波の良いところでもう一度お試しください。");
    } finally {
      setBusy(false);
      if (cam.current) cam.current.value = "";
      if (lib.current) lib.current.value = "";
    }
  };

  return (
    <section className="card stack" aria-label="仕入を入れる">
      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => cam.current?.click()}>
        {busy ? "読み取り中…（10秒ほど）" : "📷 納品書・請求書・レシートを撮る"}
      </button>
      <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => lib.current?.click()}>
          保存した写真から選ぶ
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => p.onRead(blank(p.today), null)}>
          写真なしで手で入れる
        </button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden aria-label="書類を撮る" onChange={(e) => onFile(e.target.files?.[0])} />
      <input ref={lib} type="file" accept="image/*" hidden aria-label="写真を選ぶ" onChange={(e) => onFile(e.target.files?.[0])} />
      {!p.aiReady ? <p className="micro">※ AIの読み取りは準備中です。いまは写真を残して金額を手で入れる形になります。</p> : null}
      {err ? <p className="err">{err}</p> : null}
    </section>
  );
}

// ── 確認して保存 ───────────────────────────────────────────────

function PurchaseForm({ init, photoUrl, aiMsg, onClose }: { init: FormState; photoUrl?: string; aiMsg: string | null; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<FormState>(init);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const localUrl = init.preview ?? photoUrl;

  const amounts = Object.fromEntries(CATS.map((c) => [c, toYen(f.amounts[c])])) as Record<CostCategory, number | null>;
  const totalIn = f.total_in.trim() === "" ? null : toYen(f.total_in);
  const allOk = CATS.every((c) => amounts[c] != null) && (f.total_in.trim() === "" || totalIn != null);
  const mismatch = allOk
    ? totalMismatch({ food_ex: amounts.food!, drink_ex: amounts.drink!, supplies_ex: amounts.supplies!, other_ex: amounts.other!, total_in: totalIn })
    : null;
  const exSum = allOk ? CATS.reduce((a, c) => a + amounts[c]!, 0) : null;

  const save = () =>
    start(async () => {
      setErr(null);
      if (!allOk) {
        setErr("金額は数字で入れてください（空欄は0）。");
        return;
      }
      const r = await savePurchase({
        id: f.id,
        book_date: f.book_date,
        vendor: f.vendor,
        doc_kind: f.doc_kind,
        food_ex: amounts.food!,
        drink_ex: amounts.drink!,
        supplies_ex: amounts.supplies!,
        other_ex: amounts.other!,
        total_in: totalIn,
        period_from: f.period_from || null,
        period_to: f.period_to || null,
        memo: f.memo,
        photo_path: f.photo_path,
        ai_read: f.ai_read,
      });
      if (!r.ok) setErr(r.error);
      else {
        onClose();
        router.refresh();
      }
    });

  const cancel = () =>
    start(async () => {
      // 新しく撮った写真を保存せずにやめたら、写真も片付ける
      if (!f.id && f.photo_path) await discardPhoto(f.photo_path);
      onClose();
    });

  return (
    <section className="card stack cost-form" aria-label="仕入の確認">
      <h2 className="section-title">{f.id ? "仕入を直す" : "仕入の確認"}</h2>
      {aiMsg ? <p className="notice micro">{aiMsg}</p> : null}
      {f.note ? <p className="notice notice-strong micro">AIからの確認：{f.note}</p> : null}
      {localUrl ? (
        <a href={localUrl} target="_blank" rel="noreferrer" className="cost-photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={localUrl} alt="書類の写真" />
        </a>
      ) : f.photo_path ? (
        <p className="micro">📎 写真は保存済み（保存後に一覧から見られます）</p>
      ) : null}

      <span className="field-label">書類の種類</span>
      <div className="seg">
        {KINDS.map((k) => (
          <button key={k} type="button" className="seg__btn" aria-pressed={f.doc_kind === k} onClick={() => setF({ ...f, doc_kind: k })}>
            {DOC_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <label className="field-label" htmlFor="cf-vendor">業者・お店</label>
      <input id="cf-vendor" className="field" value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} placeholder="例：業務スーパー新居浜店" />

      <label className="field-label" htmlFor="cf-date">{f.doc_kind === "invoice" ? "計上日（締め日）" : "納品日・購入日"}</label>
      <input id="cf-date" className="field" type="date" value={f.book_date} onChange={(e) => setF({ ...f, book_date: e.target.value })} />
      {f.doc_kind === "invoice" ? (
        <div className="row">
          <input aria-label="請求の期間（はじめ）" className="field" type="date" value={f.period_from} onChange={(e) => setF({ ...f, period_from: e.target.value })} />
          <span>〜</span>
          <input aria-label="請求の期間（おわり）" className="field" type="date" value={f.period_to} onChange={(e) => setF({ ...f, period_to: e.target.value })} />
        </div>
      ) : null}

      <span className="field-label">金額（税抜・円）</span>
      <div className="cost-amounts">
        {CATS.map((c) => (
          <label key={c} className="cost-amount">
            <span>{CATEGORY_LABEL[c]}</span>
            <input
              className="field"
              inputMode="numeric"
              aria-label={`${CATEGORY_LABEL[c]}（税抜）`}
              value={f.amounts[c]}
              onChange={(e) => setF({ ...f, amounts: { ...f.amounts, [c]: e.target.value } })}
              placeholder="0"
            />
          </label>
        ))}
      </div>
      <p className="micro">原価率に入るのは 食材 と 酒・飲料。消耗品（洗剤・ラップ・割り箸など）は別に数えます。値引き・返品はマイナスで。</p>

      <label className="field-label" htmlFor="cf-total">書類の合計（税込・照合用）</label>
      <input id="cf-total" className="field" inputMode="numeric" value={f.total_in} onChange={(e) => setF({ ...f, total_in: e.target.value })} placeholder="空欄でも保存できます" />
      {exSum != null ? <p className="micro">税抜の合計 {fmtYen(exSum)}</p> : null}
      {mismatch != null ? (
        <p className="err">書類の合計と、区分ごとの金額が {fmtYen(Math.abs(mismatch))} ずれています。読み違いがないか写真と見比べてください（このまま保存もできます）。</p>
      ) : null}

      <label className="field-label" htmlFor="cf-memo">メモ</label>
      <input id="cf-memo" className="field" value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="任意" />

      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
          保存
        </button>
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={cancel}>
          やめる
        </button>
      </div>
      {err ? <p className="err">{err}</p> : null}
    </section>
  );
}

// ── 一覧の1行 ─────────────────────────────────────────────────

function PurchaseRow({ p, warn, photoUrl, canWrite, onEdit }: { p: Purchase; warn: boolean; photoUrl?: string; canWrite: boolean; onEdit: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const parts = CATS.filter((c) => p[`${c}_ex` as const] !== 0).map((c) => `${CATEGORY_LABEL[c]} ${fmtYen(p[`${c}_ex` as const])}`);
  const del = () => {
    if (!window.confirm(`${p.vendor}（${md(p.book_date)}）を消しますか？写真も消えます。`)) return;
    start(async () => {
      const r = await deletePurchase(p.id);
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });
  };
  return (
    <li className={`cost-row${warn ? " cost-row--warn" : ""}`}>
      <div className="cost-row__main">
        <span className="cost-row__date">{md(p.book_date)}</span>
        <span className="cost-row__vendor">
          {warn ? "⚠ " : ""}
          {p.vendor}
          <span className="micro">　{DOC_KIND_LABEL[p.doc_kind]}</span>
        </span>
        <span className="cost-row__amt">{fmtYen(purchaseEx(p))}</span>
      </div>
      <div className="micro">
        {parts.join("・")}
        {p.memo ? `　${p.memo}` : ""}
      </div>
      <div className="row" style={{ gap: "1rem" }}>
        {photoUrl ? (
          <a className="linklike" href={photoUrl} target="_blank" rel="noreferrer">
            写真
          </a>
        ) : null}
        {canWrite ? (
          <>
            <button type="button" className="linklike" onClick={onEdit}>
              直す
            </button>
            <button type="button" className="linklike" disabled={pending} onClick={del}>
              消す
            </button>
          </>
        ) : null}
      </div>
      {err ? <p className="err">{err}</p> : null}
    </li>
  );
}

// ── ロス ─────────────────────────────────────────────────────

function LossSection(p: P) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ date: p.today.slice(0, 7) === p.ym ? p.today : `${p.ym}-01`, item: "", amount: "", reason: "expired" as LossReason, memo: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const total = p.losses.reduce((a, l) => a + l.amount_ex, 0);

  const save = () =>
    start(async () => {
      setErr(null);
      const amount = toYen(f.amount);
      if (amount == null) {
        setErr("金額は数字で入れてください。");
        return;
      }
      const fd = new FormData();
      fd.set("date", f.date);
      fd.set("item", f.item);
      fd.set("amount", String(amount));
      fd.set("reason", f.reason);
      fd.set("memo", f.memo);
      const file = fileRef.current?.files?.[0];
      if (file) fd.set("file", await shrinkImage(file, 1600, 0.8));
      const r = await addLoss(fd);
      if (!r.ok) setErr(r.error);
      else {
        setF({ ...f, item: "", amount: "", memo: "" });
        if (fileRef.current) fileRef.current.value = "";
        setOpen(false);
        router.refresh();
      }
    });

  return (
    <>
      <h2 className="section-title">
        ロス（捨てたもの）{p.losses.length}件・{fmtYen(total)}
      </h2>
      {p.canWrite ? (
        open ? (
          <section className="card stack" aria-label="ロスを記録">
            <label className="field-label" htmlFor="lf-date">日付</label>
            <input id="lf-date" className="field" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            <label className="field-label" htmlFor="lf-item">捨てたもの</label>
            <input id="lf-item" className="field" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} placeholder="例：ぶり 半身" />
            <label className="field-label" htmlFor="lf-amount">金額（仕入値の目安・税抜・円）</label>
            <input id="lf-amount" className="field" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            <span className="field-label">理由</span>
            <div className="chips">
              {(Object.keys(LOSS_REASON_LABEL) as LossReason[]).map((r) => (
                <button key={r} type="button" className="chip" aria-pressed={f.reason === r} onClick={() => setF({ ...f, reason: r })}>
                  {LOSS_REASON_LABEL[r]}
                </button>
              ))}
            </div>
            <label className="field-label" htmlFor="lf-memo">メモ</label>
            <input id="lf-memo" className="field" value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="任意（例：仕込み量を減らす）" />
            <label className="field-label" htmlFor="lf-photo">写真（任意）</label>
            <input id="lf-photo" ref={fileRef} type="file" accept="image/*" />
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
                記録
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                閉じる
              </button>
            </div>
            {err ? <p className="err">{err}</p> : null}
          </section>
        ) : (
          <button type="button" className="btn btn-block" onClick={() => setOpen(true)}>
            ＋ 捨てたものを記録
          </button>
        )
      ) : null}
      <ul className="cost-list">
        {p.losses.map((l) => (
          <LossRow key={l.id} l={l} photoUrl={l.photo_path ? p.photos[l.photo_path] : undefined} canWrite={p.canWrite} />
        ))}
      </ul>
    </>
  );
}

function LossRow({ l, photoUrl, canWrite }: { l: Loss; photoUrl?: string; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <li className="cost-row">
      <div className="cost-row__main">
        <span className="cost-row__date">{md(l.biz_date)}</span>
        <span className="cost-row__vendor">
          {l.item}
          <span className="micro">　{LOSS_REASON_LABEL[l.reason]}</span>
        </span>
        <span className="cost-row__amt">{fmtYen(l.amount_ex)}</span>
      </div>
      {l.memo ? <div className="micro">{l.memo}</div> : null}
      <div className="row" style={{ gap: "1rem" }}>
        {photoUrl ? (
          <a className="linklike" href={photoUrl} target="_blank" rel="noreferrer">
            写真
          </a>
        ) : null}
        {canWrite ? (
          <button
            type="button"
            className="linklike"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`${l.item} の記録を消しますか？`)) return;
              start(async () => {
                await deleteLoss(l.id);
                router.refresh();
              });
            }}
          >
            消す
          </button>
        ) : null}
      </div>
    </li>
  );
}
