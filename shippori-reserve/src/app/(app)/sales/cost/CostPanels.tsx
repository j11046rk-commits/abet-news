"use client";

import { useRef, useState, useTransition } from "react";
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
  STATUS_LABEL,
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
  pdfUploadTicket,
  savePurchase,
  updateLoss,
} from "./actions";

type P = {
  ym: string;
  today: string;
  canWrite: boolean;
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
  return (
    <>
      {p.canWrite ? (
        form ? (
          <PurchaseForm
            key={form.id ?? "new"}
            init={form}
            photoUrl={form.photo_path ? p.photos[form.photo_path] : undefined}
            onClose={() => setForm(null)}
          />
        ) : (
          <Capture {...p} onManual={() => setForm(blank(p.today))} />
        )
      ) : null}

      <h2 className="section-title">
        仕入（{p.purchases.length}件{unconfirmed ? `・うち未確認 ${unconfirmed}` : ""}）
      </h2>
      <div className="cat-chips" aria-label="区分の色">
        <span className="cat-chip cat-chip--food">食材<span className="cat-chip__kind">原価</span></span>
        <span className="cat-chip cat-chip--drink">酒・飲料<span className="cat-chip__kind">原価</span></span>
        <span className="cat-chip cat-chip--supplies">消耗品<span className="cat-chip__kind">経費</span></span>
        <span className="cat-chip cat-chip--other">その他<span className="cat-chip__kind">経費</span></span>
      </div>
      {unconfirmed ? (
        <button type="button" className={`btn btn-sm${onlyUnconfirmed ? " btn-primary" : ""}`} onClick={() => setOnlyUnconfirmed(!onlyUnconfirmed)}>
          {onlyUnconfirmed ? "すべて表示する" : `未確認だけ見る（${unconfirmed}件）`}
        </button>
      ) : null}
      {p.purchases.length === 0 ? <p className="micro">この月の仕入はまだありません。</p> : null}
      <ul className="cost-list">
        {p.purchases.filter((x) => !onlyUnconfirmed || x.status === "unconfirmed").map((x) => (
          <PurchaseRow
            key={x.id}
            p={x}
            warn={p.warnIds.includes(x.id)}
            photoUrl={x.photo_path ? p.photos[x.photo_path] : undefined}
            canWrite={p.canWrite}
            onEdit={() => {
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

// ── 撮る（撮るだけ。読むのは毎朝の定期実行）────────────────────────

function Capture(p: P & { onManual: () => void }) {
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
        setMsg(`${added}枚を保存しました。明朝、AIが読んで金額を入れます（未確認として並びます）。`);
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
        setMsg(`PDFを${added}つ保存しました。明朝AIが読み、書類1枚ずつに分けて金額を入れます。`);
        router.refresh();
      }
    } finally {
      setBusy(null);
      if (pdf.current) pdf.current.value = "";
    }
  };

  return (
    <section className="card stack" aria-label="仕入を入れる" id="upload" style={{ scrollMarginTop: "4rem" }}>
      <button type="button" className="btn btn-primary btn-block" disabled={!!busy} onClick={() => cam.current?.click()}>
        {busy ?? "📷 納品書・レシートを撮る"}
      </button>
      <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => lib.current?.click()}>
          保存した写真から選ぶ（まとめて可）
        </button>
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => pdf.current?.click()}>
          PDFを選ぶ（スキャンした請求書など）
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={!!busy} onClick={p.onManual}>
          写真なしで手で入れる
        </button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden aria-label="書類を撮る" onChange={(e) => onFiles(e.target.files)} />
      <input ref={lib} type="file" accept="image/*" multiple hidden aria-label="写真を選ぶ" onChange={(e) => onFiles(e.target.files)} />
      <input ref={pdf} type="file" accept="application/pdf,.pdf" multiple hidden aria-label="PDFを選ぶ" onChange={(e) => onPdfs(e.target.files)} />
      <p className="micro">
        撮るだけでOK。毎朝AIがまとめて読み、金額が入ります。写真と見比べて「確認した」を押してください。
        PDFは1つに何枚入っていても大丈夫です（1つ20MBまで）。
      </p>
      {msg ? <p className="notice micro">{msg}</p> : null}
      {err ? <p className="err">{err}</p> : null}
    </section>
  );
}

// ── 確認して保存 ───────────────────────────────────────────────

function PurchaseForm({ init, photoUrl, onClose }: { init: FormState; photoUrl?: string; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<FormState>(init);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const localUrl = photoUrl;

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
    <section className="card stack cost-form" aria-label="仕入の確認">
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

function PurchaseRow({ p, warn, photoUrl, canWrite, onEdit }: { p: Purchase; warn: boolean; photoUrl?: string; canWrite: boolean; onEdit: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const parts = CATS.filter((c) => p[`${c}_ex` as const] !== 0).map((c) => `${CATEGORY_LABEL[c]} ${fmtYen(p[`${c}_ex` as const])}`);
  const status = p.status ?? "confirmed";
  const name = p.vendor ?? "撮った写真";
  const del = () => {
    if (!window.confirm(`${name}（${md(p.book_date)}）を消しますか？写真も消えます。`)) return;
    start(async () => {
      const r = await deletePurchase(p.id);
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });
  };
  const confirm = () =>
    start(async () => {
      const r = await confirmPurchase(p.id);
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });
  const fromRakuten = (p.memo ?? "").startsWith("楽天 注文番号");
  return (
    <li className={`cost-row${warn ? " cost-row--warn" : ""} cost-row--${status}`}>
      <div className="cost-row__main">
        <span className="cost-row__date">{md(p.book_date)}</span>
        <span className="cost-row__vendor">
          {warn ? "⚠ " : ""}
          {status === "pending" ? (isPdfPath(p.photo_path) ? "送ったPDF" : "撮った写真") : p.vendor}
          {status === "pending" ? null : <span className="micro">　{fromRakuten ? "楽天の注文メール" : DOC_KIND_LABEL[p.doc_kind]}</span>}
          {status !== "confirmed" ? <span className={`cost-pill cost-pill--${status}`}>{STATUS_LABEL[status]}</span> : <span className="cost-pill cost-pill--confirmed">✓ 確認済み</span>}
        </span>
        <span className="cost-row__amt">
          {status === "pending" ? "—" : p.total_in != null ? fmtYen(p.total_in) : fmtYen(purchaseEx(p))}
          {status !== "pending" ? <span className="micro cost-row__amtsub">{p.total_in != null ? `税込（税抜 ${fmtYen(purchaseEx(p))}）` : "税抜"}</span> : null}
        </span>
      </div>
      {status === "pending" ? (
        <div className="micro">明朝AIが読みます（{md(p.book_date)}に撮影）。急ぐときは「手で入れる」。</div>
      ) : (
        <div className="cat-chips" aria-label="区分">
          {CATS.filter((c) => p[`${c}_ex` as const] !== 0).map((c) => (
            <span key={c} className={`cat-chip cat-chip--${c}`}>
              {CATEGORY_LABEL[c]}
              <strong>{fmtYen(p[`${c}_ex` as const])}</strong>
              <span className="cat-chip__kind">{c === "food" || c === "drink" ? "原価" : "経費"}</span>
            </span>
          ))}
        </div>
      )}
      {status === "unconfirmed" ? (
        <div className="confirm-box">
          <p className="confirm-box__title">{photoUrl ? "写真と見比べて、次の3つが合っていればOK" : "次の3つが合っていればOK"}</p>
          <ol className="confirm-box__list">
            <li>
              日付 <strong>{md(p.book_date)}</strong>・業者 <strong>{p.vendor}</strong>
            </li>
            <li>
              合計 <strong>{p.total_in != null ? `${fmtYen(p.total_in)}（税込）` : `${fmtYen(purchaseEx(p))}（税抜）`}</strong>
            </li>
            <li>色の区分：食材・酒飲料は<strong>原価</strong>、消耗品・その他は<strong>経費</strong>に入る</li>
          </ol>
          {p.ai_note ? <p className="micro cost-row__note">AIから：{p.ai_note}</p> : null}
          {canWrite ? (
            <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
              <button type="button" className="btn btn-primary confirm-btn" disabled={pending} onClick={confirm}>
                ✓ 合っている（確認した）
              </button>
              <button type="button" className="btn btn-sm" onClick={onEdit}>
                違う → 直す
              </button>
              {photoUrl ? (
                <a className="btn btn-sm btn-ghost" href={photoUrl} target="_blank" rel="noreferrer">
                  {isPdfPath(p.photo_path) ? "PDFを見る" : "写真を見る"}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {p.memo && !fromRakuten ? <div className="micro">{p.memo}</div> : null}
      {status !== "unconfirmed" ? (
        <div className="row" style={{ gap: "1rem" }}>
          {photoUrl ? (
            <a className="linklike" href={photoUrl} target="_blank" rel="noreferrer">
              {isPdfPath(p.photo_path) ? "PDF" : "写真"}
            </a>
          ) : null}
          {canWrite ? (
            <>
              <button type="button" className="linklike" onClick={onEdit}>
                {status === "pending" ? "手で入れる" : "直す"}
              </button>
              <button type="button" className="linklike" disabled={pending} onClick={del}>
                消す
              </button>
            </>
          ) : null}
        </div>
      ) : canWrite ? (
        <button type="button" className="linklike micro" disabled={pending} onClick={del} style={{ alignSelf: "flex-start" }}>
          消す
        </button>
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
  const waiting = p.losses.filter((l) => l.status === "pending").length;

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
      <h2 className="section-title">
        ロス（廃棄・まかない）{p.losses.length}件・{fmtYen(total)}
        {waiting ? <span className="micro">　うち読み取り待ち {waiting}</span> : null}
      </h2>
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
            ＋ 写真なしで手で記録
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

  return (
    <li className={`cost-row cost-row--${status}`}>
      <div className="cost-row__main">
        <span className="cost-row__date">{md(l.biz_date)}</span>
        <span className="cost-row__vendor">
          {name}
          {l.reason && status !== "pending" ? <span className="micro">　{LOSS_REASON_LABEL[l.reason]}</span> : null}
          {status !== "confirmed" ? <span className={`cost-pill cost-pill--${status}`}>{STATUS_LABEL[status]}</span> : null}
        </span>
        <span className="cost-row__amt">{status === "pending" || l.amount_ex == null ? "—" : fmtYen(l.amount_ex)}</span>
      </div>
      {l.memo ? <div className="micro">{l.memo}</div> : null}
      {status === "pending" ? <div className="micro">明朝AIが品名と金額の目安を入れます。</div> : null}
      {status === "unconfirmed" && l.ai_note ? <div className="micro cost-row__note">AIから：{l.ai_note}</div> : null}
      {edit ? (
        <div className="stack">
          <LossFields f={edit} setF={(x) => setEdit({ ...edit, ...x })} />
          <div className="row">
            <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={saveEdit}>
              保存
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEdit(null)}>
              閉じる
            </button>
          </div>
        </div>
      ) : null}
      <div className="row" style={{ gap: "1rem" }}>
        {photoUrl ? (
          <a className="linklike" href={photoUrl} target="_blank" rel="noreferrer">
            写真
          </a>
        ) : null}
        {canWrite ? (
          <>
            {status === "unconfirmed" ? (
              <button type="button" className="btn btn-primary btn-sm confirm-btn" disabled={pending} onClick={() => run(() => confirmLoss(l.id))}>
                ✓ 合っている（確認した）
              </button>
            ) : null}
            {!edit ? (
              <button
                type="button"
                className="linklike"
                onClick={() =>
                  setEdit({
                    item: status === "pending" || l.item === "（読み取れず）" ? "" : (l.item ?? ""),
                    amount: l.amount_ex != null && status !== "pending" ? String(l.amount_ex) : "",
                    reason: l.reason ?? "expired",
                    memo: l.memo ?? "",
                  })
                }
              >
                {status === "pending" ? "手で入れる" : "直す"}
              </button>
            ) : null}
            <button
              type="button"
              className="linklike"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(`${name} の記録を消しますか？`)) return;
                run(() => deleteLoss(l.id));
              }}
            >
              消す
            </button>
          </>
        ) : null}
      </div>
      {err ? <p className="err">{err}</p> : null}
    </li>
  );
}
