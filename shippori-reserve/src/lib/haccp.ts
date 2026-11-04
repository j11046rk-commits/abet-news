/*
 * 衛生管理（HACCPの考え方を取り入れた衛生管理）の中身の決めごと。
 *
 * 画面・サーバー・テストの全部がここを見る。DB にも Next にも依存しない
 * （node --test でそのまま読めるように import を持たない）。
 *
 * 参考にしたもの（出典はこのファイルの CANDIDATES と LEGAL_DUTIES に個別に書く）
 *   ・HACCPの考え方を取り入れた衛生管理のための手引書（小規模な一般飲食店事業者向け）
 *     公益社団法人日本食品衛生協会 作成・厚生労働省 確認
 *   ・食品衛生法 第51条、施行規則 第66条の2・別表第17・別表第18
 *   ・大量調理施設衛生管理マニュアル（厚生労働省）…大量調理施設向けの基準。小規模店では「参考」
 *   ・厚生労働省「アニサキスによる食中毒を予防しましょう」
 *
 * ★ここに書いてある数値は「設定候補」でしかない。計画に入るのは、
 *   責任者が画面で「この候補を使う」を押したときだけ。保存できる日数（使用期限）は候補も出さない。
 */

// ── 基本の型 ─────────────────────────────────────────────

/** 記録するタイミング */
export type Timing = "pre" | "during" | "close";
export const TIMINGS: Timing[] = ["pre", "during", "close"];
export const TIMING_LABEL: Record<Timing, string> = {
  pre: "営業前",
  during: "調理中・納品時",
  close: "営業終了時",
};

/** 良好／問題あり／該当なし。未入力は「行が無い」ことで表す（既定値で埋めない） */
export type CheckResult = "ok" | "ng" | "na";
export const RESULT_LABEL: Record<CheckResult, string> = { ok: "良好", ng: "問題あり", na: "該当なし" };

/** 計画の各項目が何に基づくか（法令の義務・手引書の例・店舗独自を混ぜない） */
export type Basis = "guide" | "store";
export const BASIS_LABEL: Record<Basis, string> = {
  guide: "手引書の項目（方法は手引書の例をもとに店舗で決める）",
  store: "店舗で追加した項目",
};

/** 法令で求められていること（項目の中身ではなく「やること」の枠） */
export const LEGAL_DUTIES: { text: string; source: string }[] = [
  {
    text: "HACCPに沿った衛生管理（小規模な飲食店は「HACCPの考え方を取り入れた衛生管理」）を行うこと",
    source: "食品衛生法 第51条／同法施行規則 第66条の2・別表第18",
  },
  {
    text: "一般的な衛生管理（施設・設備の衛生、そ族・昆虫対策、廃棄物、食品の取扱い、従業員の衛生など）を行うこと",
    source: "食品衛生法施行規則 別表第17",
  },
  {
    text: "衛生管理計画を作り、従業員に周知し、計画に沿って実施・確認・記録し、記録を保存し、定期的に振り返って見直すこと",
    source: "食品衛生法施行規則 別表第18（手引書のStep1〜4）",
  },
];

// ── 一般衛生管理 ──────────────────────────────────────────

export type GeneralKey =
  | "receiving"
  | "fridge"
  | "cross"
  | "utensil"
  | "toilet"
  | "health"
  | "handwash"
  | "kitchen";

export type GeneralItem = {
  key: GeneralKey;
  no: string;
  label: string;
  basis: Basis;
  enabled: boolean;
  /** いつ（記録するタイミング）。冷蔵庫・冷凍庫は設備ごとに決めるので、ここは使わない */
  timings: Timing[];
  /** 誰が */
  who: string;
  /** どのように確認するか */
  how: string;
  /** 問題があったときの対応 */
  onProblem: string;
  /** 「該当なし」を選べるか（納品が無い日など） */
  allowNA: boolean;
  /** 入力欄の下に出す一言 */
  hint?: string;
};

/**
 * 初期の下書きに入れる一般衛生管理の項目。
 * ★作業量は最低限（店主指定 2026-11-04）：記録は「営業終了時に1日1回」にまとめてある。
 * how / onProblem は手引書の記載例をもとにした「たたき台」。誰が（who）は空のまま——
 * 店の実態を知っている人が入れるまで計画は確定できない。
 */
export function generalTemplate(): GeneralItem[] {
  return [
    {
      key: "receiving",
      no: "①",
      label: "原材料の受入の確認",
      basis: "guide",
      enabled: true,
      timings: ["close"],
      who: "",
      how: "納品時に、外観・におい・包装の状態・表示（期限）・保存温度（冷蔵品・冷凍品）を確認する",
      onProblem: "返品し、交換してもらう。使用しない。仕入先に連絡する",
      allowNA: true,
      hint: "納品が無い日は「該当なし」",
    },
    {
      key: "fridge",
      no: "②",
      label: "冷蔵庫・冷凍庫の温度の確認",
      basis: "guide",
      enabled: true,
      timings: [],
      who: "",
      how: "庫内温度計で温度を測り、数値を記録する",
      onProblem: "異常の原因を確認し、設定温度を調整する。食品の状態に応じて使用しない／廃棄する。故障の場合は修理を依頼する",
      allowNA: false,
    },
    {
      key: "cross",
      no: "③-1",
      label: "交差汚染・二次汚染の防止",
      basis: "guide",
      enabled: true,
      timings: ["close"],
      who: "",
      how: "冷蔵庫内で生の肉・魚介類と、そのまま食べる食品を分けて保管しているか、まな板・包丁などを用途別に使い分けているかを確認する",
      onProblem: "生肉等の汚れが付いた食品は加熱して使うか廃棄する。器具は洗浄・消毒する",
      allowNA: false,
    },
    {
      key: "utensil",
      no: "③-2",
      label: "器具等の洗浄・消毒・殺菌",
      basis: "guide",
      enabled: true,
      timings: ["close"],
      who: "",
      how: "使用の都度、包丁・まな板・ふきん・調理器具を洗浄し、必要に応じて消毒する",
      onProblem: "使用時に汚れや洗剤が残っていたら、再度洗浄・消毒する",
      allowNA: false,
    },
    {
      key: "toilet",
      no: "③-3",
      label: "トイレの洗浄・消毒",
      basis: "guide",
      enabled: true,
      timings: ["close"],
      who: "",
      how: "便座・水洗レバー・手すり・ドアノブなどを清掃・消毒する",
      onProblem: "汚れていたら、再度清掃・消毒する。使用中に汚れた場合も同様",
      allowNA: false,
    },
    {
      key: "health",
      no: "④-1",
      label: "従業員の健康管理・衛生的な作業着の着用など",
      basis: "guide",
      enabled: true,
      timings: ["close"],
      who: "",
      how: "作業前に、体調（下痢・嘔吐・発熱など）、手の傷の有無、着衣・身だしなみを確認する",
      onProblem: "体調不良の人は調理作業に従事させない。手に傷があれば耐水性絆創膏を付けた上で手袋を着用する。汚れた作業着は交換する",
      allowNA: false,
      hint: "症状の詳しい内容は書かない（「体調不良のため調理から外した」程度で）",
    },
    {
      key: "handwash",
      no: "④-2",
      label: "手洗いの実施",
      basis: "guide",
      enabled: true,
      timings: ["close"],
      who: "",
      how: "トイレの後、調理施設に入る前、盛付けの前、作業内容変更時、生肉や生魚を扱った後、金銭を触った後、清掃を行った後に手を洗う。石けん・ペーパータオル・消毒液の補充を確認する",
      onProblem: "作業中に従業員が必要なタイミングで手を洗っていないことを確認した場合には、すぐに手洗いを行わせる",
      allowNA: false,
    },
    {
      key: "kitchen",
      no: "⑤",
      label: "厨房・廃棄物・害虫対策",
      basis: "store",
      // 手引書の7項目には無い店舗の追加分。作業を増やさないため最初は外しておく（店主指定 2026-11-04）
      enabled: false,
      timings: ["close"],
      who: "",
      how: "床・排水口の汚れ、生ごみの処理・ふた、ゴキブリ・ネズミ等の発生の有無を確認する",
      onProblem: "汚れは清掃する。害虫等を見つけたら駆除し、発生場所の清掃と侵入経路の確認をする。必要なら専門業者に依頼する",
      allowNA: false,
    },
  ];
}

// ── 設備（冷蔵庫・冷凍庫）─────────────────────────────────────

export type EquipmentKind = "fridge" | "freezer" | "other";
export const EQUIPMENT_KIND_LABEL: Record<EquipmentKind, string> = {
  fridge: "冷蔵庫",
  freezer: "冷凍庫",
  other: "その他（ショーケース等）",
};

export type Equipment = {
  id: string;
  name: string;
  kind: EquipmentKind;
  /** 上限（この温度以下）。null＝未設定 */
  maxC: number | null;
  /** 下限（必要なときだけ） */
  minC: number | null;
  timings: Timing[];
  /** 基準の根拠（候補から選んだ場合はその出典が入る） */
  basis: string;
  /**
   * 温度を温度計（SwitchBot）で自動記録する設備（店主指定 2026-11-04：温度の手入力はしない）。
   * 毎日の入力項目には出さない。記録は自動計測が入れる
   */
  auto?: boolean;
};

// ── メニュー別の重要管理 ─────────────────────────────────────

export type CcGroup = "g1" | "g2" | "g3";
export const GROUP_LABEL: Record<CcGroup, string> = {
  g1: "第1グループ（加熱しない・冷たいまま提供）",
  g2: "第2グループ（加熱して提供）",
  g3: "第3グループ（加熱後に冷却）",
};
export const GROUP_SHORT: Record<CcGroup, string> = { g1: "第1", g2: "第2", g3: "第3" };

export type StepKey = "heat" | "cool" | "chill" | "hotHold" | "reheat";
export const STEP_LABEL: Record<StepKey, string> = {
  heat: "加熱",
  cool: "冷却",
  chill: "冷蔵保管",
  hotHold: "高温保管",
  reheat: "再加熱",
};

/** 調理工程の区分。分類は料理名ではなく、この工程で決める */
export const VARIANTS: Record<CcGroup, { value: string; label: string; steps: StepKey[] }[]> = {
  g1: [{ value: "cold", label: "冷蔵品を冷たいまま提供", steps: ["chill"] }],
  g2: [
    { value: "hot", label: "加熱してすぐ提供", steps: ["heat"] },
    { value: "hot_hold", label: "加熱後、高温で保管して提供", steps: ["heat", "hotHold"] },
  ],
  g3: [
    { value: "reheat", label: "加熱→冷却→再加熱して提供", steps: ["heat", "cool", "chill", "reheat"] },
    { value: "cold", label: "加熱→冷却→冷たいまま提供", steps: ["heat", "cool", "chill"] },
  ],
};

export function stepsFor(group: CcGroup | "", variant: string): StepKey[] {
  if (!group) return [];
  return VARIANTS[group].find((v) => v.value === variant)?.steps ?? [];
}

export function variantLabel(group: CcGroup, variant: string): string {
  return VARIANTS[group].find((v) => v.value === variant)?.label ?? "（工程未設定）";
}

/** 測って数値で見るか、見た目などで確かめるか（手引書の第2グループは見た目での確認が例） */
export type CheckMode = "measure" | "visual";

export type StepCriteria = {
  heat?: { mode: CheckMode; minC: number | null; holdSec: number | null; visual: string };
  cool?: { targetC: number | null; withinMin: number | null };
  chill?: { maxC: number | null };
  hotHold?: { minC: number | null };
  reheat?: { mode: CheckMode; minC: number | null; holdSec: number | null; visual: string };
};

export type MenuPlan = {
  id: string;
  name: string;
  group: CcGroup | "";
  variant: string;
  /** 主な危害要因 */
  hazards: string;
  criteria: StepCriteria;
  /** 確認方法 */
  method: string;
  /** 確認頻度 */
  frequency: string;
  /** 保存方法 */
  storage: string;
  /** 店舗で決めた使用期限（例：「調理日の翌日の営業終了まで」）。候補は出さない */
  useByRule: string;
  /** 基準を満たさなかった場合の対応 */
  onFail: string;
  /** 料理・仕込み単位の記録を付けるか */
  batchRecord: boolean;
  /** 一般的な条件を一律に当てはめない料理 */
  special: {
    rawSeafood: boolean; // 生食用の魚介類（アニサキス等）
    bivalve: boolean; // 二枚貝など（ノロウイルス）
    lowTemp: boolean; // 低温調理
    /** 生食用魚介類の管理方法（目視確認・冷凍条件など） */
    rawControl: string;
    /** 低温調理の条件の根拠（検証した条件・参照資料） */
    lowTempBasis: string;
  };
};

/** グループごとの日々の確認（手引書の「重要管理の実施記録」に当たる） */
export type CcDaily = { timings: Timing[]; who: string; how: string; onProblem: string };

export type PlanContent = {
  general: GeneralItem[];
  equipment: Equipment[];
  menus: MenuPlan[];
  cc: Record<CcGroup, CcDaily>;
};

export function newPlanContent(): PlanContent {
  return {
    general: generalTemplate(),
    equipment: [],
    menus: [],
    cc: {
      g1: {
        timings: ["close"],
        who: "",
        how: "冷蔵庫から出したらすぐに提供する。冷蔵庫の温度を確認する",
        onProblem: "",
      },
      g2: {
        timings: ["close"],
        who: "",
        how: "火の強さや時間、焼き上がりの色、中心部の肉汁の色、弾力などで加熱を確認する",
        onProblem: "",
      },
      g3: {
        timings: ["close"],
        who: "",
        how: "加熱後は速やかに冷却し、冷蔵で保管する。再加熱するものは中心部まで十分に加熱する",
        onProblem: "",
      },
    },
  };
}

/** 新しいメニュー。仕込みごとの記録は付けない（必要な料理だけオンにする）のが既定 */
export function newMenu(id: string): MenuPlan {
  return {
    id,
    name: "",
    group: "",
    variant: "",
    hazards: "",
    criteria: {},
    method: "",
    frequency: "",
    storage: "",
    useByRule: "",
    onFail: "",
    batchRecord: false,
    special: { rawSeafood: false, bivalve: false, lowTemp: false, rawControl: "", lowTempBasis: "" },
  };
}

/** 工程に合わせて、空の基準欄を用意する（値は入れない） */
export function blankCriteria(steps: StepKey[], prev: StepCriteria = {}): StepCriteria {
  const c: StepCriteria = {};
  for (const s of steps) {
    if (s === "heat") c.heat = prev.heat ?? { mode: "measure", minC: null, holdSec: null, visual: "" };
    if (s === "reheat") c.reheat = prev.reheat ?? { mode: "measure", minC: null, holdSec: null, visual: "" };
    if (s === "cool") c.cool = prev.cool ?? { targetC: null, withinMin: null };
    if (s === "chill") c.chill = prev.chill ?? { maxC: null };
    if (s === "hotHold") c.hotHold = prev.hotHold ?? { minC: null };
  }
  return c;
}

// ── 設定候補（公式資料で確認できる基準の例）──────────────────────────

export type CandidateTarget =
  | "fridge"
  | "freezer"
  | "heat"
  | "heat_bivalve"
  | "cool"
  | "hot_hold"
  | "reheat"
  | "raw_fish_chill"
  | "anisakis";

export type Candidate = {
  id: string;
  target: CandidateTarget;
  label: string;
  /** 「この候補を使う」で入る値 */
  apply: { maxC?: number; minC?: number; holdSec?: number; targetC?: number; withinMin?: number };
  source: string;
  /** 法令の基準か、手引書の例か、参考（大量調理施設向けなど）か */
  kind: "law" | "guide" | "reference";
  caution?: string;
};

export const CANDIDATE_KIND_LABEL: Record<Candidate["kind"], string> = {
  law: "法令の基準",
  guide: "手引書の例",
  reference: "参考（他の施設向けの基準）",
};

export const CANDIDATES: Candidate[] = [
  {
    id: "fridge10",
    target: "fridge",
    label: "冷蔵 10℃以下",
    apply: { maxC: 10 },
    source: "食品衛生法に基づく食品別の保存基準（食肉・生食用鮮魚介類など多くの冷蔵品が10℃以下）",
    kind: "law",
    caution: "食品によってはもっと低い温度が定められています（例：生食用かき等）。入れる食品に合わせて決めてください。",
  },
  {
    id: "freezer15",
    target: "freezer",
    label: "冷凍 −15℃以下",
    apply: { maxC: -15 },
    source: "食品衛生法に基づく保存基準（冷凍食品・冷凍食肉などは−15℃以下）",
    kind: "law",
    caution: "これは一般的な冷凍保管の温度です。アニサキス対策の冷凍条件（−20℃以下で24時間以上）とは別のものです。",
  },
  {
    id: "rawfish10",
    target: "raw_fish_chill",
    label: "生食用鮮魚介類 10℃以下",
    apply: { maxC: 10 },
    source: "食品衛生法に基づく生食用鮮魚介類の保存基準",
    kind: "law",
  },
  {
    id: "heat75",
    target: "heat",
    label: "中心温度 75℃で1分以上",
    apply: { minC: 75, holdSec: 60 },
    source: "大量調理施設衛生管理マニュアル（厚生労働省）",
    kind: "reference",
    caution: "二枚貝など・低温調理には当てはめません。手引書の第2グループは、見た目（焼き色・肉汁の色・弾力）での確認が例です。",
  },
  {
    id: "heat85",
    target: "heat_bivalve",
    label: "二枚貝など：中心温度 85〜90℃で90秒以上",
    apply: { minC: 85, holdSec: 90 },
    source: "大量調理施設衛生管理マニュアル（厚生労働省・ノロウイルス汚染のおそれのある食品）",
    kind: "reference",
  },
  {
    id: "cool30",
    target: "cool",
    label: "30分以内に中心温度20℃付近まで冷却",
    apply: { targetC: 20, withinMin: 30 },
    source: "大量調理施設衛生管理マニュアル（厚生労働省）",
    kind: "reference",
    caution: "同じ資料に「60分以内に10℃付近」の例もあります。小分け・氷水などの冷却方法とあわせて決めてください。",
  },
  {
    id: "cool60",
    target: "cool",
    label: "60分以内に中心温度10℃付近まで冷却",
    apply: { targetC: 10, withinMin: 60 },
    source: "大量調理施設衛生管理マニュアル（厚生労働省）",
    kind: "reference",
  },
  {
    id: "hothold65",
    target: "hot_hold",
    label: "高温保管 65℃以上",
    apply: { minC: 65 },
    source: "大量調理施設衛生管理マニュアル（厚生労働省・調理後の食品は10℃以下又は65℃以上で管理）",
    kind: "reference",
  },
  {
    id: "reheat75",
    target: "reheat",
    label: "再加熱 中心温度 75℃で1分以上",
    apply: { minC: 75, holdSec: 60 },
    source: "大量調理施設衛生管理マニュアル（厚生労働省）の加熱の基準を再加熱に準用する例",
    kind: "reference",
    caution: "再加熱は、冷却・保管が計画どおりだった食品に行うものです。冷却不良や期限切れの食品を再加熱で使えるようにするものではありません。",
  },
  {
    id: "anisakis",
    target: "anisakis",
    label: "アニサキス対策：−20℃以下で24時間以上冷凍、または目視で確認して除去",
    apply: {},
    source: "厚生労働省「アニサキスによる食中毒を予防しましょう」（加熱なら70℃以上、または60℃で1分）",
    kind: "reference",
    caution: "一般の冷凍庫（−15℃以下）で保管しただけでは、この条件を満たすとは限りません。",
  },
];

export const candidatesFor = (t: CandidateTarget): Candidate[] => CANDIDATES.filter((c) => c.target === t);

/** 料理の例（表示だけ。メニューとして登録はしない） */
export const MENU_EXAMPLES: { group: CcGroup; text: string }[] = [
  { group: "g1", text: "刺身・冷奴・サラダなど（冷蔵品を加熱せずに提供する料理）" },
  { group: "g2", text: "焼き魚・焼き鳥・唐揚げ・だし巻きなど（加熱してすぐ提供する料理）" },
  { group: "g3", text: "煮物・カレー・スープ・ポテトサラダなど（加熱後に冷やして保存する料理）" },
];

// ── 計画の確定に足りないもの ──────────────────────────────────

export type PlanHeader = {
  store_name: string | null;
  hygiene_manager: string | null;
  author_name: string | null;
  effective_from: string | null;
};

const blank = (s: string | null | undefined) => !s || !s.trim();
const nn = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n);

/**
 * 計画を確定（承認）する前に埋まっていないといけないもの。
 * 1つでも残っていれば「運用準備完了」とは表示しない。
 */
export function planIssues(h: PlanHeader, c: PlanContent): string[] {
  const out: string[] = [];
  if (blank(h.store_name)) out.push("店舗名が未設定です");
  if (blank(h.hygiene_manager)) out.push("食品衛生責任者が未設定です");
  if (blank(h.author_name)) out.push("計画作成者が未設定です");
  if (!h.effective_from) out.push("適用開始日が未設定です");

  for (const g of c.general) {
    if (!g.enabled) continue;
    const name = `${g.no} ${g.label}`;
    if (blank(g.how)) out.push(`${name}：確認方法が未設定です`);
    if (blank(g.onProblem)) out.push(`${name}：問題があったときの対応が未設定です`);
    if (g.key !== "fridge" && g.timings.length === 0) out.push(`${name}：記録するタイミングが未設定です`);
  }

  const cold = c.equipment.filter((e) => e.kind === "fridge" || e.kind === "freezer");
  if (cold.length === 0) out.push("冷蔵庫・冷凍庫が1台も登録されていません");
  for (const e of c.equipment) {
    const name = blank(e.name) ? "名前のない設備" : e.name;
    if (blank(e.name)) out.push("設備の名前が未設定です");
    if (!nn(e.maxC) && !nn(e.minC)) out.push(`${name}：温度の基準が未設定です`);
    if (!e.auto && e.timings.length === 0) out.push(`${name}：測るタイミングが未設定です`);
  }

  const groups = new Set<CcGroup>();
  for (const m of c.menus) {
    const name = blank(m.name) ? "名前のないメニュー" : m.name;
    if (blank(m.name)) out.push("メニューの料理名が未設定です");
    if (!m.group) {
      out.push(`${name}：調理工程のグループが未設定です`);
      continue;
    }
    groups.add(m.group);
    const steps = stepsFor(m.group, m.variant);
    if (steps.length === 0) out.push(`${name}：調理工程（提供のしかた）が未設定です`);
    if (blank(m.method)) out.push(`${name}：確認方法が未設定です`);
    const cr = m.criteria;
    // 温度などの管理基準は「仕込みごとの記録を付ける」料理だけ必須（手引書の基本は1日1回の○×）
    if (m.batchRecord) {
      if (m.group === "g3" && blank(m.useByRule)) out.push(`${name}：店舗で決めた使用期限が未設定です`);
      for (const s of steps) {
        if (s === "heat" || s === "reheat") {
          const h = cr[s];
          const ok = h && (h.mode === "visual" ? !blank(h.visual) : nn(h.minC) && nn(h.holdSec));
          if (!ok) out.push(`${name}：${STEP_LABEL[s]}の管理基準が未設定です`);
        }
        if (s === "cool" && !(nn(cr.cool?.targetC) && nn(cr.cool?.withinMin)))
          out.push(`${name}：冷却の管理基準（到達温度・時間）が未設定です`);
        if (s === "chill" && !nn(cr.chill?.maxC)) out.push(`${name}：冷蔵保管の温度が未設定です`);
        if (s === "hotHold" && !nn(cr.hotHold?.minC)) out.push(`${name}：高温保管の温度が未設定です`);
      }
    }
    if (m.special.bivalve && cr.heat?.mode === "measure" && nn(cr.heat.minC) && (cr.heat.minC! < 85 || (cr.heat.holdSec ?? 0) < 90))
      out.push(`${name}：二枚貝などに一般的な加熱条件を当てはめています（候補は85〜90℃・90秒以上）`);
    if (m.special.bivalve && cr.heat?.mode === "visual")
      out.push(`${name}：二枚貝などは見た目だけでなく、中心温度で確認する基準を決めてください`);
    if (m.special.lowTemp && blank(m.special.lowTempBasis))
      out.push(`${name}：低温調理の条件の根拠が未設定です（一般的な加熱条件は一律に当てはめません）`);
    if (m.special.rawSeafood && blank(m.special.rawControl))
      out.push(`${name}：生食用魚介類の管理方法（アニサキス対策など）が未設定です`);
  }
  for (const g of groups) {
    const d = c.cc[g];
    if (d.timings.length === 0) out.push(`${GROUP_LABEL[g]}の日々の確認：タイミングが未設定です`);
    if (blank(d.how)) out.push(`${GROUP_LABEL[g]}の日々の確認：確認方法が未設定です`);
  }
  if (c.menus.length === 0) out.push("重要管理のメニューが1つも登録されていません");
  return out;
}

// ── 1日に記録すること ───────────────────────────────────────

export type RequiredCheck = {
  key: string;
  timing: Timing;
  kind: "gen" | "eq" | "cc";
  label: string;
  /** 一般衛生管理の項目・設備・グループ */
  ref: string;
  allowNA: boolean;
  /** 温度を数値で入れる項目か */
  temp: boolean;
};

/**
 * その日に記録すること。includeAuto=false（既定）は人が入れるものだけ＝毎日の画面と「記録完了」の判定。
 * 帳票（温度の記録）は includeAuto=true で自動記録の設備も並べる。
 */
export function requiredChecks(c: PlanContent, includeAuto = false): RequiredCheck[] {
  const out: RequiredCheck[] = [];
  for (const t of TIMINGS) {
    for (const g of c.general) {
      if (!g.enabled || g.key === "fridge" || !g.timings.includes(t)) continue;
      out.push({ key: `gen:${g.key}:${t}`, timing: t, kind: "gen", label: `${g.no} ${g.label}`, ref: g.key, allowNA: g.allowNA, temp: false });
    }
    if (c.general.find((g) => g.key === "fridge")?.enabled !== false) {
      for (const e of c.equipment) {
        if (e.auto && !includeAuto) continue;
        const ts = e.auto ? (["close"] as Timing[]) : e.timings;
        if (!ts.includes(t)) continue;
        out.push({ key: `eq:${e.id}:${t}`, timing: t, kind: "eq", label: e.name, ref: e.id, allowNA: true, temp: true });
      }
    }
    for (const g of ["g1", "g2", "g3"] as CcGroup[]) {
      if (!c.menus.some((m) => m.group === g)) continue;
      if (!c.cc[g].timings.includes(t)) continue;
      out.push({ key: `cc:${g}:${t}`, timing: t, kind: "cc", label: `重要管理 ${GROUP_LABEL[g]}`, ref: g, allowNA: true, temp: false });
    }
  }
  return out;
}

// ── 判定 ───────────────────────────────────────────────

/** 設備の温度が基準の範囲内か。基準が無ければ null（判定しない） */
export function judgeTemp(e: Pick<Equipment, "maxC" | "minC">, t: number): "ok" | "ng" | null {
  if (!nn(e.maxC) && !nn(e.minC)) return null;
  if (nn(e.maxC) && t > e.maxC!) return "ng";
  if (nn(e.minC) && t < e.minC!) return "ng";
  return "ok";
}

export type StepValues = {
  heat?: { tempC?: number | null; at?: string | null; holdSec?: number | null; ok?: boolean | null };
  cool?: { startAt?: string | null; endAt?: string | null; endTempC?: number | null };
  chill?: { tempC?: number | null; at?: string | null };
  hotHold?: { tempC?: number | null; at?: string | null };
  reheat?: { tempC?: number | null; at?: string | null; holdSec?: number | null; ok?: boolean | null };
};

export type StepJudge = "ok" | "ng" | "pending";

function judgeHeatLike(
  c: { mode: CheckMode; minC: number | null; holdSec: number | null } | undefined,
  v: { tempC?: number | null; holdSec?: number | null; ok?: boolean | null } | undefined,
): StepJudge {
  if (!c) return "pending";
  if (c.mode === "visual") return v?.ok == null ? "pending" : v.ok ? "ok" : "ng";
  if (!nn(v?.tempC)) return "pending";
  if (nn(c.minC) && v!.tempC! < c.minC!) return "ng";
  if (nn(c.holdSec)) {
    if (!nn(v?.holdSec)) return "pending";
    if (v!.holdSec! < c.holdSec!) return "ng";
  }
  return "ok";
}

/** 料理・仕込み1件の判定。途中（冷却中など）は pending */
export function judgeBatch(
  steps: StepKey[],
  c: StepCriteria,
  v: StepValues,
): { judgement: StepJudge; steps: Partial<Record<StepKey, StepJudge>> } {
  const res: Partial<Record<StepKey, StepJudge>> = {};
  for (const s of steps) {
    if (s === "heat") res.heat = judgeHeatLike(c.heat, v.heat);
    if (s === "reheat") res.reheat = judgeHeatLike(c.reheat, v.reheat);
    if (s === "chill") {
      const t = v.chill?.tempC;
      res.chill = !nn(t) ? "pending" : nn(c.chill?.maxC) && t! > c.chill!.maxC! ? "ng" : "ok";
    }
    if (s === "hotHold") {
      const t = v.hotHold?.tempC;
      res.hotHold = !nn(t) ? "pending" : nn(c.hotHold?.minC) && t! < c.hotHold!.minC! ? "ng" : "ok";
    }
    if (s === "cool") {
      const x = v.cool;
      if (!x?.startAt || !x.endAt || !nn(x.endTempC)) res.cool = "pending";
      else {
        const min = (Date.parse(x.endAt) - Date.parse(x.startAt)) / 60000;
        const late = nn(c.cool?.withinMin) && min > c.cool!.withinMin!;
        const warm = nn(c.cool?.targetC) && x.endTempC! > c.cool!.targetC!;
        res.cool = min < 0 || late || warm ? "ng" : "ok";
      }
    }
  }
  const all = Object.values(res);
  const judgement: StepJudge = all.includes("ng") ? "ng" : all.length > 0 && all.every((j) => j === "ok") ? "ok" : "pending";
  return { judgement, steps: res };
}

// ── 1日の状態（暦・月の一覧）───────────────────────────────────

export type DayState = "noplan" | "future" | "closed" | "complete" | "partial" | "none";
export const DAY_STATE_LABEL: Record<DayState, string> = {
  noplan: "計画なし",
  future: "これから",
  closed: "休業",
  complete: "記録完了",
  partial: "一部未完了",
  none: "未記録",
};

export type DayHaccp = {
  state: DayState;
  required: number;
  filled: number;
  /** 最初に「問題あり」だった記録の数（直しても減らない） */
  ng: number;
  /** 対応中の異常の数 */
  open: number;
  /** 未記録のアラートを出すか（過ぎた日で、記録が揃っていない） */
  alert: boolean;
};

export function dayHaccp(a: {
  date: string;
  today: string;
  hasPlan: boolean;
  isClosed: boolean;
  required: string[];
  filled: string[];
  ng: number;
  open: number;
}): DayHaccp {
  const have = new Set(a.filled);
  const filled = a.required.filter((k) => have.has(k)).length;
  const base = { required: a.required.length, filled, ng: a.ng, open: a.open };
  if (!a.hasPlan) return { state: "noplan", ...base, alert: false };
  if (a.date > a.today) return { state: "future", ...base, alert: false };
  // 休業日でも記録があれば、それはそれとして見せる（休業の扱いは変えない）
  if (a.isClosed) return { state: "closed", ...base, alert: false };
  const state: DayState =
    a.required.length > 0 && filled === a.required.length ? "complete" : filled > 0 ? "partial" : "none";
  return { state, ...base, alert: a.date < a.today && state !== "complete" };
}

/** その日に使う計画：承認済みの版のうち、適用開始日がその日以前で最も新しいもの */
export function planForDate<T extends { version: number; status: string; effective_from: string | null }>(
  plans: T[],
  date: string,
): T | null {
  return (
    plans
      .filter((p) => (p.status === "approved" || p.status === "superseded") && p.effective_from && p.effective_from <= date)
      .sort((a, b) => b.effective_from!.localeCompare(a.effective_from!) || b.version - a.version)[0] ?? null
  );
}

// ── 異常の処置 ───────────────────────────────────────────

export const DISPOSITIONS = [
  "提供中止",
  "廃棄",
  "責任者へ確認",
  "温度の再確認",
  "再加熱・再調理（計画で認めた場合のみ）",
  "冷却のやり直し（計画で認めた場合のみ）",
  "設備の点検・修理依頼",
  "清掃・消毒",
  "駆除・業者へ連絡",
  "返品・仕入先へ連絡",
  "調理担当から外す",
  "その他",
] as const;

export const INCIDENT_CATEGORY_LABEL: Record<string, string> = {
  temp: "温度逸脱",
  heating: "加熱不足",
  cooling: "冷却不良",
  pest: "害虫・ネズミ",
  hygiene: "清掃・洗浄",
  health: "従業員の健康",
  receiving: "原材料の受入",
  other: "その他",
};

// ── 日付 ───────────────────────────────────────────────

/** その日を含む週の月曜（YYYY-MM-DD） */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// ── CSV ────────────────────────────────────────────────

/**
 * Excel でそのまま開ける CSV（UTF-8・BOM付き・CRLF）。
 * 先頭が = + @ の値は式として実行されないよう ' を付ける（−18 のような負の温度はそのまま）。
 * 空欄は空欄のまま（未記録を「良好」などで埋めない）。
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v == null) return "";
    let s = String(v);
    if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-\d/.test(s))) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
