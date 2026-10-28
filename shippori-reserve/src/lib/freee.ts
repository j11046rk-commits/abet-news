import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sumByDate, type FreeeWorkRecord } from "@/lib/labor";

/*
 * freee人事労務 との連携（店主要望 2026-10-28：人時売上を出したい）。
 *
 * 流れ:
 *   設定画面の「freeeと連携」→ freee のログイン画面で許可 → /api/freee/callback に戻る
 *   → トークンを integration_tokens に保存 → 直近の勤怠を取り込む
 *   以後は毎朝の定期実行（/api/cron/labor）が前日までの分を取り込み直す。
 *
 * 鍵の置き場所:
 *   FREEE_CLIENT_ID / FREEE_CLIENT_SECRET … Vercel の環境変数（freee のアプリ登録で発行）
 *   アクセストークン・リフレッシュトークン … integration_tokens（RLSで画面からは読めない）
 *
 * ★freee のリフレッシュトークンは使うたびに新しいものに替わる（古いものは無効）。
 *   新しい方を保存し損ねると連携が切れるので、更新は「古いものと一致したときだけ書く」
 *   形にして、同時に2回更新が走っても片方が後から最新を読み直せるようにしてある。
 */

const AUTH_URL = "https://accounts.secure.freee.co.jp/public_api/authorize";
const TOKEN_URL = "https://accounts.secure.freee.co.jp/public_api/token";
const API = "https://api.freee.co.jp/hr/api/v1";
const PROVIDER = "freee_hr";

export const FREEE_REDIRECT_PATH = "/api/freee/callback";

export const freeeConfigured = (): boolean =>
  Boolean(process.env.FREEE_CLIENT_ID && process.env.FREEE_CLIENT_SECRET);

export function freeeAuthorizeUrl(redirectUri: string, state: string): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", process.env.FREEE_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  // 事業所を選ばせる（freee に複数の事業所がある場合に備える）
  u.searchParams.set("prompt", "select_company");
  return u.toString();
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  company_id?: number | null;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.FREEE_CLIENT_ID ?? "",
      client_secret: process.env.FREEE_CLIENT_SECRET ?? "",
      ...body,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`freee token ${res.status}`);
  return (await res.json()) as TokenResponse;
}

async function apiGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`freee GET ${path.split("?")[0]} ${res.status}`);
  return (await res.json()) as T;
}

const expiresAt = (sec: number) => new Date(Date.now() + (sec - 120) * 1000).toISOString();

/** 認可コードを受け取って連携を保存する（callback から呼ぶ） */
export async function connectFreee(code: string, redirectUri: string): Promise<void> {
  const tok = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });

  // 事業所。トークンに付いていればそれ、無ければ所属する事業所の最初の1つ
  const me = await apiGet<{ companies: { id: number; name: string }[] }>("/users/me", tok.access_token);
  const company =
    me.companies.find((c) => c.id === tok.company_id) ?? (me.companies.length === 1 ? me.companies[0] : null);
  if (!company) throw new Error("freee の事業所を決められませんでした");

  const admin = createAdminClient();
  const { error } = await admin.from("integration_tokens").upsert({
    provider: PROVIDER,
    refresh_token: tok.refresh_token,
    access_token: tok.access_token,
    access_expires_at: expiresAt(tok.expires_in),
    company_id: company.id,
    company_name: company.name,
    connected_at: new Date().toISOString(),
    last_error: null,
  });
  if (error) throw new Error(`連携の保存に失敗: ${error.message}`);
}

type TokenRow = {
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | null;
  company_id: number | null;
  company_name: string | null;
  last_sync_at: string | null;
  last_error: string | null;
};

/** 連携の状態（設定画面の表示用。トークンそのものは返さない） */
export async function freeeStatus(): Promise<{
  connected: boolean;
  companyName: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integration_tokens")
    .select("company_name, last_sync_at, last_error")
    .eq("provider", PROVIDER)
    .maybeSingle<Pick<TokenRow, "company_name" | "last_sync_at" | "last_error">>();
  return {
    connected: data != null,
    companyName: data?.company_name ?? null,
    lastSyncAt: data?.last_sync_at ?? null,
    lastError: data?.last_error ?? null,
  };
}

/** 有効なアクセストークン。切れていれば更新して保存する */
async function accessToken(): Promise<{ token: string; companyId: number }> {
  const admin = createAdminClient();
  const read = async () => {
    const { data, error } = await admin
      .from("integration_tokens")
      .select("refresh_token, access_token, access_expires_at, company_id")
      .eq("provider", PROVIDER)
      .maybeSingle<TokenRow>();
    if (error) throw new Error(`連携の読み込みに失敗: ${error.message}`);
    if (!data || data.company_id == null) throw new Error("freee と連携していません");
    return data;
  };

  const row = await read();
  const fresh = (r: TokenRow) =>
    r.access_token && r.access_expires_at && Date.parse(r.access_expires_at) > Date.now();
  if (fresh(row)) return { token: row.access_token!, companyId: row.company_id! };

  try {
    const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: row.refresh_token });
    // 古いリフレッシュトークンのままの行だけ書き換える（同時更新の取り違えを防ぐ）
    await admin
      .from("integration_tokens")
      .update({
        refresh_token: tok.refresh_token,
        access_token: tok.access_token,
        access_expires_at: expiresAt(tok.expires_in),
      })
      .eq("provider", PROVIDER)
      .eq("refresh_token", row.refresh_token);
    return { token: tok.access_token, companyId: row.company_id! };
  } catch (e) {
    // 別の実行が先に更新していたら、そちらのトークンを使う
    const again = await read();
    if (again.refresh_token !== row.refresh_token && fresh(again)) {
      return { token: again.access_token!, companyId: again.company_id! };
    }
    throw e;
  }
}

type Employee = { id: number; entry_date: string | null; retire_date: string | null };

/** 期間に在籍していた従業員（退職者も含めて引き、期間で絞る） */
async function employeesIn(token: string, companyId: number, from: string, to: string): Promise<Employee[]> {
  const all: Employee[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await apiGet<Employee[]>(
      `/companies/${companyId}/employees?limit=100&offset=${offset}&with_no_payroll_calculation=true`,
      token,
    );
    all.push(...page);
    if (page.length < 100) break;
  }
  return all.filter((e) => (!e.entry_date || e.entry_date <= to) && (!e.retire_date || e.retire_date >= from));
}

/** "2026-10" に月を足す */
const addMonth = (ym: string, n: number): string => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/**
 * 期間の勤怠を取り込んで labor_daily に入れる。
 *
 * freee の月次サマリは「給与の支払い月」で引く仕組みなので（締め日・翌月払いで
 * 勤務した月とずれる）、期間の月から2か月先までを引き、日付で絞る。
 */
export async function syncLabor(from: string, to: string): Promise<{ days: number }> {
  const admin = createAdminClient();
  try {
    const { token, companyId } = await accessToken();
    const employees = await employeesIn(token, companyId, from, to);

    const months: string[] = [];
    for (let ym = from.slice(0, 7); ym <= addMonth(to.slice(0, 7), 2); ym = addMonth(ym, 1)) months.push(ym);

    const perEmployee: FreeeWorkRecord[][] = [];
    for (const e of employees) {
      const records: FreeeWorkRecord[] = [];
      for (const ym of months) {
        const [y, m] = ym.split("-");
        try {
          const s = await apiGet<{ work_records?: FreeeWorkRecord[] }>(
            `/employees/${e.id}/work_record_summaries/${y}/${Number(m)}?company_id=${companyId}&work_records=true`,
            token,
          );
          records.push(...(s.work_records ?? []));
        } catch {
          // その月にまだ勤怠が無い・対象外の従業員は飛ばす
        }
      }
      perEmployee.push(records);
    }

    const sums = sumByDate(perEmployee, from, to);
    const rows = [...sums].map(([biz_date, v]) => ({
      biz_date,
      work_min: v.workMin,
      headcount: v.headcount,
      fetched_at: new Date().toISOString(),
    }));
    if (rows.length > 0) {
      const { error } = await admin.from("labor_daily").upsert(rows);
      if (error) throw new Error(`labor_daily の保存に失敗: ${error.message}`);
    }
    await admin
      .from("integration_tokens")
      .update({ last_sync_at: new Date().toISOString(), last_error: null })
      .eq("provider", PROVIDER);
    return { days: rows.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("integration_tokens").update({ last_error: msg.slice(0, 300) }).eq("provider", PROVIDER);
    throw e;
  }
}
