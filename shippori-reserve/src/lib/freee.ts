import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sumByDate, workMinutesOf, type FreeeWorkRecord } from "@/lib/labor";
import {
  employeeDayCost,
  lateNightMinutes,
  payrollTotal,
  type AllowanceRule,
  type EmployeeMonth,
  type PayRule,
} from "@/lib/labor-cost";
import { deriveBusinessDay } from "@/lib/queries";

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
/**
 * freee に登録した戻り先URLと一字一句同じ文字列。許可画面へ送るときと、
 * コードをトークンに替えるときの両方で同じものを使わないと invalid_grant になる。
 * アクセスされたホスト名から組み立てると、経路によって文字列がずれ得るので決め打ちにする。
 */
export const FREEE_REDIRECT_URI =
  process.env.FREEE_REDIRECT_URI ?? `https://yoyaku.shipporitei.jp${FREEE_REDIRECT_PATH}`;

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
  if (!res.ok) {
    // freee が返すエラーの種類（invalid_client・invalid_grant など）だけを残す。鍵の中身は含まれない
    const body = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
    throw new Error(`freee token ${res.status} ${body.error ?? ""} ${body.error_description ?? ""}`.trim());
  }
  return (await res.json()) as TokenResponse;
}

/*
 * ★一人ずつの給与は、保存しない・画面に出さない（店主指示 2026-11-02：各スタッフの給与が他のスタッフに見えないこと）。
 *
 * 2026-11-09 店主指示「全体の合計なら出していい。人件費も毎日リアルタイムで。個人の人件費はちゃんと隠して」により、
 * 給与の設定（基本給・手当・社会保険）と給与明細も読む。ただし読んだ値はこのファイルの中で
 * 「日ごとの店全体の合計」「月の店全体の合計」に足し上げるためだけに使い、一人ずつの額・時給はどこにも保存しない・ログにも出さない。
 *
 * 呼んでよい freee の口を、ここで決め打ちにする（一覧に無い口は呼ばれない）。
 */
const ALLOWED_PATHS = [
  /^\/users\/me$/,
  /^\/companies\/\d+\/employees\?/,
  /^\/employees\/\d+\/work_record_summaries\/\d{4}\/\d{1,2}\?/,
  /^\/employees\/\d+\/basic_pay_rule\?/,
  /^\/employees\/\d+\/allowance_rules\?/,
  /^\/employees\/\d+\/health_insurance_rule\?/,
  /^\/employees\/\d+\/welfare_pension_insurance_rule\?/,
  /^\/salaries\/employee_payroll_statements\?/,
];

async function apiGet<T>(path: string, accessToken: string): Promise<T> {
  if (!ALLOWED_PATHS.some((re) => re.test(path))) {
    throw new Error(`freee の許可していない口は呼びません: ${path.split("?")[0]}`);
  }
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { errors?: { type?: string }[]; message?: string };
    const why = body.errors?.[0]?.type ?? body.message ?? "";
    throw new Error(`freee GET ${path.split("?")[0].replace(/\d+/g, "#")} ${res.status} ${why}`.trim());
  }
  return (await res.json()) as T;
}

const expiresAt = (sec: number) => new Date(Date.now() + (sec - 120) * 1000).toISOString();

/** 認可コードを受け取って連携を保存する（callback から呼ぶ） */
export async function connectFreee(code: string, redirectUri: string): Promise<void> {
  const tok = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });

  // 事業所。トークンに付いていればそれ、無ければ所属する事業所の最初の1つ
  const me = await apiGet<{ companies: { id: number; name: string }[] }>("/users/me", tok.access_token);
  // 事業所。freee で選んだもの（トークンに付く）→ 1つしか無ければそれ → 名前に「しっぽり」を含むものが1つならそれ
  const shippori = me.companies.filter((c) => c.name.includes("しっぽり"));
  const company =
    me.companies.find((c) => c.id === tok.company_id) ??
    (me.companies.length === 1 ? me.companies[0] : shippori.length === 1 ? shippori[0] : null);
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

    // 人件費（合計だけ）。失敗しても労働時間の取り込みは止めない
    let costNote: string | null = null;
    try {
      await syncLaborCost(token, companyId, employees, perEmployee, from, to);
    } catch (e) {
      costNote = `人件費：${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
    }
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
      .update({ last_sync_at: new Date().toISOString(), last_error: costNote })
      .eq("provider", PROVIDER);
    return { days: rows.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("integration_tokens").update({ last_error: msg.slice(0, 300) }).eq("provider", PROVIDER);
    throw e;
  }
}

// ── 人件費（店全体の合計だけ）──────────────────────────────────

const ymOf = (d: string) => d.slice(0, 7);
const datesIn = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
};

/** その月の営業日（休業日を除いた日）。business_days の行が無い日は曜日から */
async function businessDaysOf(ym: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const from = `${ym}-01`;
  const to = `${ym}-${String(last).padStart(2, "0")}`;
  const [{ data: rows }, { data: st }] = await Promise.all([
    admin.from("business_days").select("biz_date, is_closed").gte("biz_date", from).lte("biz_date", to),
    admin.from("settings").select("key, value"),
  ]);
  const settings = Object.fromEntries((st ?? []).map((r) => [r.key as string, r.value as unknown]));
  const closed = new Map((rows ?? []).map((r) => [r.biz_date as string, r.is_closed as boolean]));
  const out = new Set<string>();
  for (const d of datesIn(from, to)) {
    const c = closed.has(d) ? closed.get(d)! : deriveBusinessDay(d, settings).is_closed;
    if (!c) out.add(d);
  }
  return out;
}

type Statement = {
  employee_id: number;
  is_board_member?: boolean | null;
  fixed?: boolean | null;
  closing_date?: string | null;
  pay_date?: string | null;
  gross_payment_amount?: string | null;
  total_deduction_employer_share?: string | null;
};

async function payrollStatements(token: string, companyId: number, ym: string): Promise<Statement[]> {
  const [y, m] = ym.split("-");
  const out: Statement[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const r = await apiGet<{ employee_payroll_statements?: Statement[] }>(
      `/salaries/employee_payroll_statements?company_id=${companyId}&year=${y}&month=${Number(m)}&limit=100&offset=${offset}`,
      token,
    );
    const page = r.employee_payroll_statements ?? [];
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

/**
 * 日ごとの人件費の合計（labor_cost_daily）と、確定した給与の月の合計（labor_cost_monthly・source=freee）を入れる。
 * 一人ずつの値はこの関数の中の変数にしか置かない。
 */
async function syncLaborCost(
  token: string,
  companyId: number,
  employees: { id: number }[],
  perEmployee: FreeeWorkRecord[][],
  from: string,
  to: string,
): Promise<void> {
  const admin = createAdminClient();
  const months = [...new Set(datesIn(from, to).map(ymOf))];
  const q = (ym: string) => `?company_id=${companyId}&year=${ym.slice(0, 4)}&month=${Number(ym.slice(5))}`;

  // 給与明細：支払月で引く（期間の月から2か月先まで）。役員の見分けと、確定した月の合計に使う
  const payMonths: string[] = [];
  for (let ym = months[0]!; ym <= addMonth(months.at(-1)!, 2); ym = addMonth(ym, 1)) payMonths.push(ym);
  const statements: Statement[] = [];
  for (const ym of payMonths) {
    try {
      statements.push(...(await payrollStatements(token, companyId, ym)));
    } catch {
      // まだ明細の無い月は飛ばす
    }
  }
  const board = new Set(statements.filter((s) => s.is_board_member).map((s) => s.employee_id));

  // 従業員×月の給与の設定
  const setup = new Map<string, EmployeeMonth>();
  for (const e of employees) {
    if (board.has(e.id)) continue;
    for (const ym of months) {
      const get = async <T>(path: string): Promise<T | null> => {
        try {
          return await apiGet<T>(path, token);
        } catch {
          return null;
        }
      };
      const [pay, al, hi, wp] = await Promise.all([
        get<{ employee_basic_pay_rule?: PayRule }>(`/employees/${e.id}/basic_pay_rule${q(ym)}`),
        get<{ employee_allowance_rules?: AllowanceRule[] }>(`/employees/${e.id}/allowance_rules${q(ym)}`),
        get<{ employee_health_insurance_rule?: { entried?: boolean; standard_monthly_remuneration?: number | null } }>(
          `/employees/${e.id}/health_insurance_rule${q(ym)}`,
        ),
        get<{ employee_welfare_pension_insurance_rule?: { entried?: boolean; standard_monthly_remuneration?: number | null } }>(
          `/employees/${e.id}/welfare_pension_insurance_rule${q(ym)}`,
        ),
      ]);
      const h = hi?.employee_health_insurance_rule;
      const w = wp?.employee_welfare_pension_insurance_rule;
      const insured = h?.entried || w?.entried ? (h?.standard_monthly_remuneration ?? w?.standard_monthly_remuneration ?? null) : null;
      setup.set(`${e.id}|${ym}`, {
        pay: pay?.employee_basic_pay_rule ?? null,
        allowances: al?.employee_allowance_rules ?? [],
        insuredRemuneration: insured,
      });
    }
  }

  const biz = new Map<string, Set<string>>();
  for (const ym of months) biz.set(ym, await businessDaysOf(ym));

  const rows: { biz_date: string; cost_yen: number; fetched_at: string }[] = [];
  const now = new Date().toISOString();
  for (const d of datesIn(from, to)) {
    const ym = ymOf(d);
    const bdays = biz.get(ym)!;
    let total = 0;
    employees.forEach((e, i) => {
      const m = setup.get(`${e.id}|${ym}`);
      if (!m) return;
      const rec = (perEmployee[i] ?? []).find((r) => r.date === d);
      const min = rec ? workMinutesOf(rec) : 0;
      const work = rec && min > 0 ? { workMin: min, lateNightMin: lateNightMinutes(rec) } : null;
      total += employeeDayCost(m, work, bdays.has(d), bdays.size);
    });
    if (total > 0) rows.push({ biz_date: d, cost_yen: Math.round(total), fetched_at: now });
  }
  if (rows.length > 0) {
    const { error } = await admin.from("labor_cost_daily").upsert(rows);
    if (error) throw new Error(`labor_cost_daily の保存に失敗: ${error.message}`);
  }

  // 確定した給与明細の月の合計（働いた月＝締め日の月）。オーナーが手で入れた月は上書きしない
  const byMonth = new Map<string, Statement[]>();
  for (const s of statements) {
    if (!s.fixed) continue;
    const ym = (s.closing_date ?? s.pay_date ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    byMonth.set(ym, [...(byMonth.get(ym) ?? []), s]);
  }
  if (byMonth.size > 0) {
    const { data: manual } = await admin.from("labor_cost_monthly").select("ym").eq("source", "manual").in("ym", [...byMonth.keys()]);
    const keep = new Set((manual ?? []).map((r) => r.ym as string));
    const up = [...byMonth]
      .filter(([ym]) => !keep.has(ym))
      .map(([ym, ss]) => ({ ym, total_yen: payrollTotal(ss), source: "freee", updated_at: now, note: "freeeの給与明細（確定分）の合計" }));
    if (up.length > 0) {
      const { error } = await admin.from("labor_cost_monthly").upsert(up);
      if (error) throw new Error(`labor_cost_monthly の保存に失敗: ${error.message}`);
    }
  }
}
