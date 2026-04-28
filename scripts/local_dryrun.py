"""
ローカル検証用ランナー。WeasyPrintを使わずHTMLレンダリングまでで完走する。
PDF生成はGitHub Actions側で確認。Lark投稿はスキップ。

キャッシュ動作:
- 当日の編集結果(Anthropic API出力)を output/edited_cache_YYYYMMDD.json に保存。
- 次回以降キャッシュがあれば再利用してAPIコールを節約(CSS調整ループ向け)。
- 強制再取得は --refresh フラグで。
"""
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
from jinja2 import Environment, FileSystemLoader

from collect_news import fetch_recent_articles
from edit_articles import select_and_edit_articles, get_subsidy_topic


PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATES_DIR = os.path.join(PROJECT_ROOT, "templates")
ASSETS_DIR = os.path.join(PROJECT_ROOT, "assets")
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")


def main():
    today = datetime.now(ZoneInfo("Asia/Tokyo"))
    today_str = today.strftime("%Y-%m-%d")
    date_filename = today.strftime("%Y%m%d")
    output_html = os.path.join(OUTPUT_DIR, f"A-BET新聞_{date_filename}_preview.html")
    cache_path = os.path.join(OUTPUT_DIR, f"edited_cache_{date_filename}.json")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    refresh = "--refresh" in sys.argv

    print(f"=== A-BET新聞 ローカルドライラン {today_str} ===")

    if not refresh and os.path.exists(cache_path):
        print(f"\n[1-2/3] キャッシュから編集結果を読み込み: {os.path.basename(cache_path)}")
        print("        (--refresh でAPI再取得)")
        with open(cache_path, "r", encoding="utf-8") as f:
            edited = json.load(f)
    else:
        print("\n[1/3] ニュース収集中...")
        articles = fetch_recent_articles(hours=36)
        if len(articles) < 3:
            print(f"WARNING: Only {len(articles)} articles. Check RSS connectivity.")

        print("\n[2/3] 記事編集中 (Anthropic API)...")
        edited = select_and_edit_articles(articles, today_str)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(edited, f, ensure_ascii=False, indent=2)
        print(f"        キャッシュ保存: {os.path.basename(cache_path)}")

    subsidy = get_subsidy_topic()

    print("\n[3/3] HTMLレンダリング中...")
    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR))
    template = env.get_template("newspaper.html.j2")

    weekdays = ["月", "火", "水", "木", "金", "土", "日"]
    weekday = weekdays[today.weekday()]
    reiwa_year = today.year - 2018

    category_icon_map = {
        "国内動向": "photo_microsoft.svg",
        "エージェントAI": "photo_agent.svg",
        "法務リスク": "photo_law.svg",
        "産業AI": "photo_industry.svg",
        "モデル動向": "photo_model.svg",
    }
    for m in edited.get("mid", []):
        m["icon"] = category_icon_map.get(m["category"], "photo_default.svg")

    context = {
        "today": today.strftime("%Y年%-m月%-d日"),
        "reiwa": f"令和{reiwa_year}年 {weekday}曜日",
        "edition_no": "001",
        "lead": edited["lead"],
        "mid": edited["mid"],
        "briefs": edited["briefs"],
        "column": edited["column"],
        "subsidy": subsidy,
        "logo_path": os.path.join(ASSETS_DIR, "logo.jpeg"),
        "lead_photo_path": os.path.join(ASSETS_DIR, "photo_lead.svg"),
        "assets_dir": ASSETS_DIR,
    }

    html_str = template.render(**context)

    base_href = "file://" + ASSETS_DIR.rstrip("/") + "/"
    if "<head>" in html_str:
        html_str = html_str.replace("<head>", f'<head>\n<base href="{base_href}">', 1)
    else:
        html_str = f'<base href="{base_href}">\n' + html_str

    with open(output_html, "w", encoding="utf-8") as f:
        f.write(html_str)

    print(f"\n✓ HTML preview generated: {output_html}")
    print(f"  ブラウザで開く: open '{output_html}'")
    print("  (PDFはGitHub Actions側で生成・確認)")


if __name__ == "__main__":
    main()
