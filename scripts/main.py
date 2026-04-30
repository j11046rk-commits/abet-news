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
from post_line import post_to_line


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
TEMPLATES_DIR = os.path.join(PROJECT_ROOT, "templates")
ASSETS_DIR = os.path.join(PROJECT_ROOT, "assets")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "output")


def _enrich_with_images(edited: dict, articles: list[dict]) -> dict:
    """Claudeが返した source_index を使って各セクションに image_url を埋める"""
    def _get_url(idx):
        try:
            i = int(idx)
            if 1 <= i <= len(articles):
                return articles[i - 1].get("image_url")
        except (TypeError, ValueError):
            pass
        return None

    edited["lead"]["image_url"] = _get_url(edited.get("lead", {}).get("source_index"))
    for m in edited.get("mid", []):
        m["image_url"] = _get_url(m.get("source_index"))
    return edited


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
    edited = _enrich_with_images(edited, articles)
    subsidy = get_subsidy_topic()

    # ③ PDF生成
    print("\n[3/5] PDF生成中...")
    pdf_path, png_path = render_pdf(
        edited=edited,
        subsidy=subsidy,
        output_path=output_path,
        today=today,
        template_dir=TEMPLATES_DIR,
        assets_dir=ASSETS_DIR,
    )

    headline = f"{edited['lead']['headline_main']} / {edited['lead']['headline_sub']}"
    summary = edited['lead']['subhead']
    date_display = today.strftime("%Y年%-m月%-d日")

    # ④ Lark投稿
    print("\n[4/5] Lark投稿中...")
    try:
        post_to_lark(
            pdf_path=pdf_path,
            headline=headline,
            summary=summary,
            date_str=date_display,
        )
    except Exception as e:
        print(f"Lark post failed (continuing): {e}")

    # ⑤ LINE投稿
    print("\n[5/5] LINE投稿中...")
    try:
        post_to_line(
            pdf_path=pdf_path,
            png_path=png_path,
            headline=headline,
            summary=summary,
            date_str=date_display,
            release_tag=f"news-{date_filename}",
        )
    except Exception as e:
        print(f"LINE post failed (continuing): {e}")

    print("\n✓ Done.")


if __name__ == "__main__":
    main()
