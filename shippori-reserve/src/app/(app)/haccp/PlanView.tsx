import {
  BASIS_LABEL,
  EQUIPMENT_KIND_LABEL,
  GROUP_LABEL,
  LEGAL_DUTIES,
  STEP_LABEL,
  TIMING_LABEL,
  stepsFor,
  variantLabel,
  type CcGroup,
  type MenuPlan,
  type PlanContent,
  type StepKey,
} from "@/lib/haccp";

/** 計画の中身を読むための表示（画面と印刷で共通。書き換えはしない） */
export default function PlanView({ content }: { content: PlanContent }) {
  const groups = (["g1", "g2", "g3"] as CcGroup[]).filter((g) => content.menus.some((m) => m.group === g));
  return (
    <div className="pv">
      <h3>法令で求められていること</h3>
      <ul className="pv-list">
        {LEGAL_DUTIES.map((d) => (
          <li key={d.text}>
            {d.text}
            <span className="pv-src">（{d.source}）</span>
          </li>
        ))}
      </ul>

      <h3>一般衛生管理</h3>
      <table className="pv-table">
        <thead>
          <tr>
            <th>項目</th>
            <th>いつ</th>
            <th>誰が</th>
            <th>どのように</th>
            <th>問題があったとき</th>
          </tr>
        </thead>
        <tbody>
          {content.general
            .filter((g) => g.enabled)
            .map((g) => (
              <tr key={g.key}>
                <td>
                  {g.no} {g.label}
                  <div className="pv-src">{BASIS_LABEL[g.basis]}</div>
                </td>
                <td>{g.key === "fridge" ? "設備ごと（下表）" : g.timings.map((t) => TIMING_LABEL[t]).join("・")}</td>
                <td>{g.who}</td>
                <td>{g.how}</td>
                <td>{g.onProblem}</td>
              </tr>
            ))}
        </tbody>
      </table>

      <h3>冷蔵庫・冷凍庫</h3>
      <table className="pv-table">
        <thead>
          <tr>
            <th>設備</th>
            <th>種類</th>
            <th>基準</th>
            <th>測るとき</th>
            <th>基準の根拠</th>
          </tr>
        </thead>
        <tbody>
          {content.equipment.map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td>
              <td>{EQUIPMENT_KIND_LABEL[e.kind]}</td>
              <td>
                {[e.maxC != null ? `${e.maxC}℃以下` : "", e.minC != null ? `${e.minC}℃以上` : ""].filter(Boolean).join("・")}
              </td>
              <td>{e.timings.map((t) => TIMING_LABEL[t]).join("・")}</td>
              <td>{e.basis}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>重要管理（メニュー別）</h3>
      {groups.map((g) => (
        <div key={g} className="pv-group">
          <h4>{GROUP_LABEL[g]}</h4>
          <p className="pv-src">
            日々の確認：{content.cc[g].timings.map((t) => TIMING_LABEL[t]).join("・")}／{content.cc[g].who}／{content.cc[g].how}
            ／問題があったとき：{content.cc[g].onProblem}
          </p>
          <table className="pv-table">
            <thead>
              <tr>
                <th>料理名・工程</th>
                <th>主な危害要因</th>
                <th>管理基準</th>
                <th>確認方法・頻度</th>
                <th>保存方法・使用期限</th>
                <th>基準を満たさないとき</th>
              </tr>
            </thead>
            <tbody>
              {content.menus
                .filter((m) => m.group === g)
                .map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.name}
                      <div className="pv-src">{variantLabel(g, m.variant)}</div>
                    </td>
                    <td>{m.hazards}</td>
                    <td>{criteriaText(m)}</td>
                    <td>
                      {m.method}
                      <div className="pv-src">{m.frequency}</div>
                    </td>
                    <td>
                      {m.storage}
                      {m.useByRule ? <div className="pv-src">使用期限：{m.useByRule}（店舗で決めた期限）</div> : null}
                    </td>
                    <td>{m.onFail}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function criteriaText(m: MenuPlan): string {
  const c = m.criteria;
  const steps: StepKey[] = m.group ? stepsFor(m.group, m.variant) : [];
  const parts = steps.map((s) => {
    if (s === "heat" || s === "reheat") {
      const h = c[s];
      if (!h) return `${STEP_LABEL[s]}：未設定`;
      return `${STEP_LABEL[s]}：${h.mode === "visual" ? h.visual : `中心${h.minC}℃以上・${h.holdSec}秒以上`}`;
    }
    if (s === "cool") return `冷却：${c.cool?.withinMin ?? "?"}分以内に${c.cool?.targetC ?? "?"}℃以下`;
    if (s === "chill") return `冷蔵：${c.chill?.maxC ?? "?"}℃以下`;
    if (s === "hotHold") return `高温保管：${c.hotHold?.minC ?? "?"}℃以上`;
    return "";
  });
  if (m.special.rawSeafood && m.special.rawControl) parts.push(`生食用魚介類：${m.special.rawControl}`);
  if (m.special.lowTemp && m.special.lowTempBasis) parts.push(`低温調理の根拠：${m.special.lowTempBasis}`);
  return parts.join("／");
}
