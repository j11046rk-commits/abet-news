"""
Anthropic APIを使って収集した記事を新聞風に編集する
"""
import json
import os
from anthropic import Anthropic


# A4 1ページに収めるための文字数上限。テンプレCSSと連動。
LIMITS = {
    "lead_body_total": 400,   # 一面本文4段落の合計
    "lead_body_each": 100,    # 一面本文1段落
    "mid_body_each": 120,     # 中段3記事の本文
    "brief_body_each": 88,    # 短信4本の本文
    "column_body_total": 320, # 天声AI語の合計
    "column_body_each": 110,  # 天声AI語1段落
}


SYSTEM_PROMPT = """あなたはA-BET新聞のベテラン編集者です。
A-BET新聞は株式会社A-BET（建設業)が社内向けに発行するAIニュース日刊紙です。
購読者は経営層・管理部門の社員で、AIの動向を業務判断に活かしたいと考えています。

【編集方針】
- 事実に忠実に、誇張せず
- 業界用語は最小限の説明を添える
- 中小企業・建設業の視点で「自社にどう関係するか」が伝わると良い
- 数字・固有名詞・日付は正確に
- 客観的な新聞文体（〜という、〜とされる、〜と発表した）

【避けること】
- 「すごい」「画期的」など主観形容詞
- 個人攻撃、政治的偏向
- 推測・憶測の混入
- 文末の「〜！」など軽い表現

【文字数厳守】指定された文字数を1字でも超えないこと。短くても可、超過は不可。
A4 1ページに収まる紙面設計のため、文字数オーバーは即不採用となる。
"""


def _validate_lengths(edited: dict) -> list[str]:
    """編集結果の文字数を検査し、超過項目のリストを返す"""
    errors = []
    lead_body = edited.get("lead", {}).get("body", [])
    if isinstance(lead_body, list):
        total = sum(len(p) for p in lead_body)
        if total > LIMITS["lead_body_total"]:
            errors.append(f"lead.body合計={total}字 (上限{LIMITS['lead_body_total']})")
        for i, p in enumerate(lead_body):
            if len(p) > LIMITS["lead_body_each"]:
                errors.append(f"lead.body[{i}]={len(p)}字 (上限{LIMITS['lead_body_each']})")
    for i, m in enumerate(edited.get("mid", [])):
        body_len = len(m.get("body", ""))
        if body_len > LIMITS["mid_body_each"]:
            errors.append(f"mid[{i}].body={body_len}字 (上限{LIMITS['mid_body_each']})")
    for i, b in enumerate(edited.get("briefs", [])):
        body_len = len(b.get("body", ""))
        if body_len > LIMITS["brief_body_each"]:
            errors.append(f"briefs[{i}].body={body_len}字 (上限{LIMITS['brief_body_each']})")
    col_body = edited.get("column", {}).get("body", [])
    if isinstance(col_body, list):
        total = sum(len(p) for p in col_body)
        if total > LIMITS["column_body_total"]:
            errors.append(f"column.body合計={total}字 (上限{LIMITS['column_body_total']})")
        for i, p in enumerate(col_body):
            if len(p) > LIMITS["column_body_each"]:
                errors.append(f"column.body[{i}]={len(p)}字 (上限{LIMITS['column_body_each']})")
    return errors


def _extract_json(text: str) -> str:
    """Claude応答のテキストからJSON本体を抽出する"""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    return text


def select_and_edit_articles(articles: list[dict], today_str: str) -> dict:
    """記事リストから新聞1面分を選んで編集。文字数超過時は最大2回まで再生成。"""
    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    articles_text = "\n\n".join([
        f"[記事{i+1}] ({a['lang']}) {a['title']}\n出典: {a['source']}\n要約: {a['summary'][:300]}\nURL: {a['link']}"
        for i, a in enumerate(articles[:40])
    ])

    base_user_prompt = f"""本日({today_str})のA-BET新聞 第1面を編集してください。

以下の{len(articles[:40])}本の候補記事から、重要なものを選んで新聞風に再構成してください。

【候補記事】
{articles_text}

【出力形式】必ずこのJSONフォーマットで返してください。説明文は不要、JSONのみ。

{{
  "lead": {{
    "tag": "本日の一面",
    "headline_main": "メイン見出し（16〜20字、2行に分けても可）",
    "headline_sub": "サブ見出し（25〜30字）",
    "subhead": "リード文(40〜60字)",
    "meta": "速報 / カテゴリ名",
    "date_note": "発表日(例: 2026.04.24発表)",
    "caption": "写真キャプション(40〜60字、想像で書く)",
    "body": ["段落1(75〜95字)", "段落2(75〜95字)", "段落3(75〜95字)", "段落4(75〜95字)"]
  }},
  "mid": [
    {{
      "category": "国内動向",
      "headline": "見出し(13〜15字)",
      "subhead": "サブ(15〜20字)",
      "body": "本文(95〜115字、1段落)"
    }},
    {{ "category": "エージェントAI", "headline": "...", "subhead": "...", "body": "..." }},
    {{ "category": "法務リスク", "headline": "...", "subhead": "...", "body": "..." }}
  ],
  "briefs": [
    {{ "headline": "短信1見出し(15字以内)", "body": "本文(75〜85字)" }},
    {{ "headline": "短信2見出し(15字以内)", "body": "本文(75〜85字)" }},
    {{ "headline": "短信3見出し(15字以内)", "body": "本文(75〜85字)" }},
    {{ "headline": "短信4見出し(15字以内)", "body": "本文(75〜85字)" }}
  ],
  "column": {{
    "title": "天 声 A I 語",
    "body": ["段落1(85〜105字)", "段落2(85〜105字)", "段落3(85〜105字)"],
    "signature": "── A-BET編集室"
  }}
}}

【重要】
- 一面トップは最重要ニュース1本
- 中段3本はカテゴリ別に重要記事を選ぶ。カテゴリは「国内動向/エージェントAI/法務リスク/産業AI/モデル動向」から選択
- 短信4本は中段に入らなかった注目ニュース
- 天声AI語は朝日「天声人語」風の短いコラム。当日のトピックから1つ取り、人間味のある考察を加える
- 全文日本語で
- 各項目の文字数上限は厳守。1字でも超えれば不採用となる
"""

    user_prompt = base_user_prompt
    edited = None
    last_errors: list[str] = []
    for attempt in range(3):
        response = client.messages.create(
            model="claude-opus-4-5",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = _extract_json(response.content[0].text)
        edited = json.loads(text)
        last_errors = _validate_lengths(edited)
        if not last_errors:
            break
        print(f"  [retry {attempt+1}/2] 文字数超過: {last_errors[:5]}{' ...' if len(last_errors) > 5 else ''}")
        user_prompt = (
            base_user_prompt
            + "\n\n【再生成指示】前回の出力は以下の文字数超過がありました。各上限を厳守して全体を短く再生成してください。:\n"
            + "\n".join(f"- {e}" for e in last_errors)
        )

    if last_errors:
        print(f"  WARNING: 3回試しても文字数超過が残った: {last_errors}")
    print(f"Edited articles: lead='{edited['lead']['headline_main'][:30]}...'")
    return edited


def get_subsidy_topic() -> dict:
    """今週の助成金トピックを返す（固定 or APIで動的生成）"""
    # 試作版は固定。本番化時は週次でClaude APIで生成・キャッシュも可
    return {
        "title": "◆ 今週の助成金 ◆",
        "headline": "事業展開等リスキリング支援コース",
        "alert": "★ 令和8年度が最終年度 ★",
        "points": [
            ("助成率:", "経費 最大75%(中小)"),
            ("賃金助成:", "1,000円/人時(改正後)"),
            ("対象:", "DX・AI・GX関連の研修"),
            ("新設(R8.4.8):", "設備投資加算50%"),
            ("拡充(R8.3.2):", "人事・人材育成計画に基づく訓練も対象に"),
            ("計画届:", "訓練開始の6〜1か月前"),
        ]
    }
