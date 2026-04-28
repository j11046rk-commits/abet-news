"""
A-BET新聞 メイン実行スクリプト
GitHub Actionsから呼ばれる
"""
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from collect_news import fetch_recent_articles
from edit_articles import select_and_edit_articles, get_subsidy_topic
from render_pdf import render_pdf
from post_lark import post_to_lark


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
TEMPLATES_DIR = os.path.join(PROJECT_ROOT, "templates")
ASSETS_DIR = os.path.join(PROJECT_ROOT, "assets")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "output")


def main():
    today = datetime.now(ZoneInfo("Asia/Tokyo"))
    today_str = today.strftime("%Y-%m-%d")
    date_filename = today.strftime("%Y%m%d")
    output_path = os.path.join(OUTPUT_DIR, f"A-BET新聞_{date_filename}.pdf")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"=== A-BET新聞 {today_str} ===")

    # ① ニュース収集
    print("\n[1/4] ニュース収集中...")
    articles = fetch_recent_articles(hours=36)
    if len(articles) < 5:
        print(f"WARNING: Only {len(articles)} articles found. Quality may be low.")

    # ② 編集（Anthropic API）
    print("\n[2/4] 記事編集中...")
    edited = select_and_edit_articles(articles, today_str)
    subsidy = get_subsidy_topic()

    # ③ PDF生成
    print("\n[3/4] PDF生成中...")
    render_pdf(
        edited=edited,
        subsidy=subsidy,
        output_path=output_path,
        today=today,
        template_dir=TEMPLATES_DIR,
        assets_dir=ASSETS_DIR,
    )

    # ④ Lark投稿
    print("\n[4/4] Lark投稿中...")
    headline = f"{edited['lead']['headline_main']} / {edited['lead']['headline_sub']}"
    summary = edited['lead']['subhead']
    post_to_lark(
        pdf_path=output_path,
        headline=headline,
        summary=summary,
        date_str=today.strftime("%Y年%-m月%-d日"),
    )

    print("\n✓ Done.")


if __name__ == "__main__":
    main()
