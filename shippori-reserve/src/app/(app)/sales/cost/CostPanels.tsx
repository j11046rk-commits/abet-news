"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { shrinkImage } from "@/lib/image";
import { createClient } from "@/lib/supabase/client";
import { fmtYen } from "@/lib/sales";
import {
  CATEGORY_LABEL,
  COST_BUCKET,
  DOC_KIND_LABEL,
  isPdfPath,
  LOSS_REASON_LABEL,
  lossTotal,
  purchaseEx,
  totalMismatch,
  type CostCategory,
  type DocKind,
  type LossReason,
  type Purchase,
} from "@/lib/cost";
import type { Loss } from "@/lib/cost-data";
import {
  addLoss,
  addPurchasePdf,
  addPurchasePhotos,
  confirmLoss,
  confirmPurchase,
  deleteLoss,
  deletePurchase,
  moveCategory,
  pdfUploadTicket,
  savePurchase,
  updateLoss,
} from "./actions";
import LossCapture from "./LossCapture";

type P = {
  ym: string;
  today: string;
  canWrite: boolean;
  purchases: Purchase[];
  losses: Loss[];
  photos: Record<string, string>;
  warnIds: string[];
  /** ロスを撮る枠を出す（スタッフも・今月だけ） */
  lossOn: boolean;
  /** 上の数字（サーバー側で作った要約） */
  summary?: ReactNode;
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
};

const blank = (today: string): FormState => ({
  doc_kind: "receipt",
  vendor: "",
  book_date: today,
  period_from: "",
  period_to: "",
  amounts: { food: "", drink: "", supplies: "", other: "" },
  total_in: "",
  memo: "",
  photo_path: null,
  ai_read: false,
  note: "",
});

const fromRow = (p: Purchase): FormState => ({
  id: p.id,
  doc_kind: p.doc_kind,
  vendor: p.status === "pending" || p.vendor === "（読み取れず）" ? "" : (p.vendor ?? ""),
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
  note: p.ai_note ?? "",
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
  const unconfirmed = p.purchases.filter((x) => x.status === "unconfirmed").length;
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false);
  const shown = p.purchases.filter((x) => !onlyUnconfirmed || x.status === "unconfirmed");
  return (
    <>
      {/* 撮る：仕入とロスの2つの大きいボタン */}
      {p.canWrite || p.lossOn ? (
        <section className={`snap${p.canWrite && p.lossOn ? "" : " snap--one"}`} aria-label="撮る" id="upload">
          {p.canWrite ? <Capture {...p} onManual={() => setForm(blank(p.today))} /> : null}
          {p.lossOn ? <LossCapture /> : null}
        </section>
      ) : null}
      {p.canWrite && form && !form.id ? (
        <PurchaseForm key="new" init={form} onClose={() => setForm(null)} />
      ) : null}

      {p.summary}

      <div className="list-head">
        <h2 className="section-title">📦 仕入 {p.purchases.length}件</h2>
        {unconfirmed ? (
          <div className="seg seg--sm" role="group" aria-label="表示">
            <button type="button" className="seg__btn" aria-pressed={!onlyUnconfirmed} onClick={() => setOnlyUnconfirmed(false)}>
              全部
            </button>
            <button type="button" className="seg__btn" aria-pressed={onlyUnconfirmed} onClick={() => setOnlyUnconfirmed(true)}>
              未確認 {unconfirmed}
            </button>
          </div>
        ) : null}
      </div>
      {unconfirmed && p.canWrite ? (
        <p className="check-hint">
          写真と見比べて <b>📅日付</b> <b>¥合計</b> <b>🎨色</b> が合えば <b className="check-hint__ok">✓</b>
        </p>
      ) : null}
      {p.purchases.length === 0 ? <p className="micro">まだありません</p> : null}
      <ul className="cost-list">
        {shown.map((x) =>
          form?.id === x.id ? (
            <li key={x.id}>
              <PurchaseForm init={form} photoUrl={x.photo_path ? p.photos[x.photo_path] : undefined} onClose={() => setForm(null)} />
            </li>
          ) : (
            <PurchaseRow
              key={x.id}
              p={x}
              warn={p.warnIds.includes(x.id)}
              photoUrl={x.photo_path ? p.photos[x.photo_path] : undefined}
              canWrite={p.canWrite}
              onEdit={() => setForm(fromRow(x))}
            />
          ),
        )}
      </ul>

      <LossSection {...p} />
    </>
  );
}

// ── 撮る（撮るだけ。読むのは毎朝の定期実行）────────────────────────

function Capture(p: { onManual: () => void }) {
  const router = useRouter();
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  const pdf = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onFiles = async (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length === 0) return;
    setErr(null);
    setMsg(null);
    let added = 0;
    try {
      // 細かい字を読むので、チラシより大きめ（長辺2400px）に縮める。5枚ずつ送る（1回の送信量の上限のため）
      for (let i = 0; i < files.length; i += 5) {
        setBusy(`送信中… ${i}/${files.length}枚`);
        const fd = new FormData();
        for (const f of files.slice(i, i + 5)) fd.append("file", await shrinkImage(f, 2400, 0.85));
        const r = await addPurchasePhotos(fd);
        if (!r.ok) {
          setErr(added ? `${added}枚は保存しました。${r.error}` : r.error);
          break;
        }
        added += r.added ?? 0;
      }
      if (added) {
        setMsg(`${added}枚 保存（明朝AIが読みます）`);
        router.refresh();
      }
    } catch {
      setErr(`送れませんでした${added ? `（${added}枚は保存済み）` : ""}。電波の良いところでもう一度お試しください。`);
    } finally {
      setBusy(null);
      if (cam.current) cam.current.value = "";
      if (lib.current) lib.current.value = "";
    }
  };

  // スキャンしたPDF：大きいのでブラウザから置き場へ直接送る（サーバーには置き場所だけ知らせる）
  const onPdfs = async (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length === 0) return;
    setErr(null);
    setMsg(null);
    let added = 0;
    try {
      for (const [i, f] of files.entries()) {
        setBusy(`PDFを送信中… ${i + 1}/${files.length}`);
        if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
          setErr(`${f.name} はPDFではありません。`);
          break;
        }
        const t = await pdfUploadTicket(f.size);
        if (!t.ok) {
          setErr(`${f.name}：${t.error}`);
          break;
        }
        const { error } = await createClient().storage.from(COST_BUCKET).uploadToSignedUrl(t.path, t.token, f, { contentType: "application/pdf" });
        if (error) {
          setErr(`${f.name} を送れませんでした。電波の良いところでもう一度お試しください。`);
          break;
        }
        const r = await addPurchasePdf(t.path);
        if (!r.ok) {
          setErr(`${f.name}：${r.error}`);
          break;
        }
        added += 1;
      }
      if (added) {
        setMsg(`PDF ${added}つ 保存（明朝AIが読みます）`);
        router.refresh();
      }
    } finally {
      setBusy(null);
      if (pdf.current) pdf.current.value = "";
    }
  };

  return (
    <div className="snap__col">
      <button type="button" className="snap__tile" disabled={!!busy} onClick={() => cam.current?.click()}>
        <span className="snap__icon" aria-hidden>📷</span>
        <span className="snap__name">{busy ? "送信中…" : "仕入"}</span>
        <span className="snap__sub">納品書・レシート</span>
      </button>
      <div className="snap__more">
        <button type="button" disabled={!!busy} onClick={() => lib.current?.click()} aria-label="保存した写真から選ぶ">
          🖼 写真
        </button>
        <button type="button" disabled={!!busy} onClick={() => pdf.current?.click()} aria-label="PDFを選ぶ">
          📄 PDF
        </button>
        <button type="button" disabled={!!busy} onClick={p.onManual} aria-label="写真なしで手で入れる">
          ✏️ 手入力
        </button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden aria-label="書類を撮る" onChange={(e) => onFiles(e.target.files)} />
      <input ref={lib} type="file" accept="image/*" multiple hidden aria-label="写真を選ぶ" onChange={(e) => onFiles(e.target.files)} />
      <input ref={pdf} type="file" accept="application/pdf,.pdf" multiple hidden aria-label="PDFを選ぶ" onChange={(e) => onPdfs(e.target.files)} />
      {msg ? <p className="snap__msg">✓ {msg}</p> : null}
      {err ? <p className="err">{err}</p> : null}
    </div>
  );
}

// ── 確認して保存 ───────────────────────────────────────────────

function PurchaseForm({ init, photoUrl, onClose }: { init: FormState; photoUrl?: string; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<FormState>(init);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const localUrl = photoUrl;
  // 一覧の行の場所で開く。開いた欄の頭が見えるように合わせる（ページの上には飛ばない）
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    if (init.id) box.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [init.id]);

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


  return (
    <section ref={box} className="card stack cost-form" aria-label="仕入の確認" style={{ scrollMarginTop: "5rem" }}>
      <h2 className="section-title">{f.id ? "仕入を直す" : "仕入を手で入れる"}</h2>
      {f.note ? <p className="notice notice-strong micro">AIからの確認：{f.note}</p> : null}
      {localUrl && isPdfPath(f.photo_path) ? (
        <a href={localUrl} target="_blank" rel="noreferrer" className="btn btn-sm">
          📄 PDFを開いて見比べる
        </a>
      ) : localUrl ? (
        <a href={localUrl} target="_blank" rel="noreferrer" className="cost-photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={localUrl} alt="書類の写真" />
        </a>
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
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={onClose}>
          やめる
        </button>
      </div>
      {err ? <p className="err">{err}</p> : null}
    </section>
  );
}

// ── 一覧の1行 ─────────────────────────────────────────────────

const kindOf = (c: CostCategory) => (c === "food" || c === "drink" ? "原価" : "経費");

/** 区分の色チップ（金額は税抜） */
function CatChips({ p }: { p: Purchase }) {
  return (
    <div className="cat-chips">
      {CATS.filter((c) => p[`${c}_ex` as const] !== 0).map((c) => (
        <span key={c} className={`cat-chip cat-chip--${c}`}>
          {CATEGORY_LABEL[c]}
          <strong>{fmtYen(p[`${c}_ex` as const])}</strong>
          <span className="cat-chip__kind">{kindOf(c)}</span>
        </span>
      ))}
    </div>
  );
}

function PurchaseRow({ p, warn, photoUrl, canWrite, onEdit }: { p: Purchase; warn: boolean; photoUrl?: string; canWrite: boolean; onEdit: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const status = p.status ?? "confirmed";
  const used = CATS.filter((c) => p[`${c}_ex` as const] !== 0);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setErr(null);
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "保存できませんでした。");
      else {
        setFixing(false);
        router.refresh();
      }
    });
  const name = status === "pending" ? (isPdfPath(p.photo_path) ? "送ったPDF" : "撮った写真") : (p.vendor ?? "");
  const del = () => {
    if (!window.confirm(`${name}（${md(p.book_date)}）を消しますか？`)) return;
    run(() => deletePurchase(p.id));
  };

  return (
    <li className={`cost-row cost-row--${status}${warn ? " cost-row--warn" : ""}`}>
      <div className="cost-row__main">
        <span className="cost-row__date">{md(p.book_date)}</span>
        <span className="cost-row__vendor cost-row__vendor--one">
          {warn ? "⚠ " : ""}
          {status === "pending" ? "📷 " : ""}
          {name}
        </span>
        <span className="cost-row__amt">
          {status === "pending" ? <span className="cost-row__wait">明朝AI</span> : fmtYen(p.total_in ?? purchaseEx(p))}
          {status === "confirmed" ? <span className="cost-row__ok" aria-label="確認済み">✓</span> : null}
        </span>
      </div>
      <div className="cost-row__line">
        {status !== "pending" ? <CatChips p={p} /> : <span />}
        {canWrite && !fixing && status !== "unconfirmed" ? (
          <span className="icon-acts">
            {photoUrl ? (
              <a className="icon-btn" href={photoUrl} target="_blank" rel="noreferrer" aria-label={isPdfPath(p.photo_path) ? "PDFを見る" : "写真を見る"}>
                {isPdfPath(p.photo_path) ? "📄" : "🖼"}
              </a>
            ) : null}
            <button type="button" className="icon-btn" onClick={() => setFixing(true)} aria-label="直す">
              ✏️
            </button>
          </span>
        ) : null}
      </div>
      {status === "unconfirmed" && p.ai_note ? <p className="cost-row__ai">💬 {p.ai_note}</p> : null}

      {canWrite && fixing ? (
        <div className="fix" role="group" aria-label="直す">
          {status !== "pending" ? (
            <>
              <span className="fix__label">🎨 区分を変える</span>
              {used.map((c) => (
                <div key={c} className="cat-fix__line">
                  <span className={`cat-chip cat-chip--${c}`}>
                    {CATEGORY_LABEL[c]}
                    <strong>{fmtYen(p[`${c}_ex` as const])}</strong>
                  </span>
                  <span aria-hidden>→</span>
                  {CATS.filter((t) => t !== c).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`cat-chip cat-chip--${t} cat-chip--btn`}
                      disabled={pending}
                      onClick={() => run(() => moveCategory(p.id, c, t))}
                      aria-label={`${CATEGORY_LABEL[c]}を${CATEGORY_LABEL[t]}にする`}
                    >
                      {CATEGORY_LABEL[t]}
                    </button>
                  ))}
                </div>
              ))}
            </>
          ) : null}
          <div className="fix__acts">
            <button type="button" className="btn btn-sm" onClick={onEdit}>
              ✏️ {status === "pending" ? "手で入れる" : "日付・金額"}
            </button>
            <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={del}>
              🗑 消す
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFixing(false)}>
              閉じる
            </button>
          </div>
        </div>
      ) : canWrite && status === "unconfirmed" ? (
        <div className="cost-row__acts">
          <button type="button" className="btn btn-primary ok-btn" disabled={pending} onClick={() => run(() => confirmPurchase(p.id))}>
            ✓ OK
          </button>
          <button type="button" className="btn" onClick={() => setFixing(true)}>
            ✏️ 直す
          </button>
          {photoUrl ? (
            <a className="btn btn-sm btn-ghost" href={photoUrl} target="_blank" rel="noreferrer" aria-label={isPdfPath(p.photo_path) ? "PDFを見る" : "写真を見る"}>
              {isPdfPath(p.photo_path) ? "📄" : "🖼"}
            </a>
          ) : null}
        </div>
      ) : !canWrite && photoUrl ? (
        <a className="linklike micro" href={photoUrl} target="_blank" rel="noreferrer">
          {isPdfPath(p.photo_path) ? "📄 PDF" : "🖼 写真"}
        </a>
      ) : null}
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
  const total = lossTotal(p.losses);

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
      const r = await addLoss(fd);
      if (!r.ok) setErr(r.error);
      else {
        setF({ ...f, item: "", amount: "", memo: "" });
        setOpen(false);
        router.refresh();
      }
    });

  return (
    <>
      <div className="list-head">
        <h2 className="section-title">🗑 ロス {p.losses.length}件</h2>
        <span className="list-head__sum">{fmtYen(total)}</span>
      </div>
      <ul className="cost-list">
        {p.losses.map((l) => (
          <LossRow key={l.id} l={l} photoUrl={l.photo_path ? p.photos[l.photo_path] : undefined} canWrite={p.canWrite} />
        ))}
      </ul>
      {p.canWrite ? (
        open ? (
          <section className="card stack" aria-label="ロスを記録">
            <label className="field-label" htmlFor="lf-date">日付</label>
            <input id="lf-date" className="field" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            <LossFields f={f} setF={(x) => setF({ ...f, ...x })} />
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
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
            ✏️ 写真なしで記録
          </button>
        )
      ) : null}
    </>
  );
}

type LossForm = { item: string; amount: string; reason: LossReason; memo: string };

function LossFields({ f, setF }: { f: LossForm; setF: (x: Partial<LossForm>) => void }) {
  return (
    <>
      <label className="field-label" htmlFor="lf-item">ロスにしたもの</label>
      <input id="lf-item" className="field" value={f.item} onChange={(e) => setF({ item: e.target.value })} placeholder="例：ぶり 半身" />
      <label className="field-label" htmlFor="lf-amount">金額（仕入値の目安・税抜・円）</label>
      <input id="lf-amount" className="field" inputMode="numeric" value={f.amount} onChange={(e) => setF({ amount: e.target.value })} />
      <span className="field-label">理由</span>
      <div className="chips">
        {(Object.keys(LOSS_REASON_LABEL) as LossReason[]).map((r) => (
          <button key={r} type="button" className="chip" aria-pressed={f.reason === r} onClick={() => setF({ reason: r })}>
            {LOSS_REASON_LABEL[r]}
          </button>
        ))}
      </div>
      <label className="field-label" htmlFor="lf-memo">メモ</label>
      <input id="lf-memo" className="field" value={f.memo} onChange={(e) => setF({ memo: e.target.value })} placeholder="任意（例：仕込み量を減らす）" />
    </>
  );
}

function LossRow({ l, photoUrl, canWrite }: { l: Loss; photoUrl?: string; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<LossForm | null>(null);
  const status = l.status ?? "confirmed";
  const name = status === "pending" ? "撮った写真" : (l.item ?? "");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setErr(null);
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "保存できませんでした。");
      else {
        setEdit(null);
        router.refresh();
      }
    });

  const saveEdit = () => {
    if (!edit) return;
    const amount = toYen(edit.amount);
    if (amount == null || edit.amount.trim() === "") {
      setErr("金額は数字で入れてください。");
      return;
    }
    run(() => updateLoss({ id: l.id, item: edit.item, amount_ex: amount, reason: edit.reason, memo: edit.memo }));
  };

  const openEdit = () =>
    setEdit({
      item: status === "pending" || l.item === "（読み取れず）" ? "" : (l.item ?? ""),
      amount: l.amount_ex != null && status !== "pending" ? String(l.amount_ex) : "",
      reason: l.reason ?? "expired",
      memo: l.memo ?? "",
    });

  return (
    <li className={`cost-row cost-row--${status}`}>
      <div className="cost-row__main">
        <span className="cost-row__date">{md(l.biz_date)}</span>
        <span className="cost-row__vendor cost-row__vendor--one">
          {status === "pending" ? "📷 " : ""}
          {name}
        </span>
        <span className="cost-row__amt">
          {status === "pending" || l.amount_ex == null ? <span className="cost-row__wait">明朝AI</span> : fmtYen(l.amount_ex)}
          {status === "confirmed" ? <span className="cost-row__ok" aria-label="確認済み">✓</span> : null}
        </span>
      </div>
      <div className="cost-row__line">
        <div className="cat-chips">
          {l.reason && status !== "pending" ? <span className="cat-chip cat-chip--loss">{LOSS_REASON_LABEL[l.reason]}</span> : null}
          {l.memo && l.memo !== l.item ? <span className="micro">{l.memo}</span> : null}
        </div>
        {canWrite && !edit && status !== "unconfirmed" ? (
          <span className="icon-acts">
            {photoUrl ? (
              <a className="icon-btn" href={photoUrl} target="_blank" rel="noreferrer" aria-label="写真を見る">
                🖼
              </a>
            ) : null}
            <button type="button" className="icon-btn" onClick={openEdit} aria-label={status === "pending" ? "手で入れる" : "直す"}>
              ✏️
            </button>
          </span>
        ) : null}
      </div>
      {status === "unconfirmed" && l.ai_note ? <p className="cost-row__ai">💬 {l.ai_note}</p> : null}
      {edit ? (
        <div className="stack">
          <LossFields f={edit} setF={(x) => setEdit({ ...edit, ...x })} />
          <div className="fix__acts">
            <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={saveEdit}>
              保存
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(`${name} の記録を消しますか？`)) return;
                run(() => deleteLoss(l.id));
              }}
            >
              🗑 消す
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEdit(null)}>
              閉じる
            </button>
          </div>
        </div>
      ) : canWrite && status === "unconfirmed" ? (
        <div className="cost-row__acts">
          <button type="button" className="btn btn-primary ok-btn" disabled={pending} onClick={() => run(() => confirmLoss(l.id))}>
            ✓ OK
          </button>
          <button type="button" className="btn" onClick={openEdit}>
            ✏️ 直す
          </button>
          {photoUrl ? (
            <a className="btn btn-sm btn-ghost" href={photoUrl} target="_blank" rel="noreferrer" aria-label="写真を見る">
              🖼
            </a>
          ) : null}
        </div>
      ) : !canWrite && photoUrl ? (
        <a className="linklike micro" href={photoUrl} target="_blank" rel="noreferrer">
          🖼 写真
        </a>
      ) : null}
      {err ? <p className="err">{err}</p> : null}
    </li>
  );
}
