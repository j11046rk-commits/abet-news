"""
編集された記事データをHTMLテンプレートに流し込み、PDFを生成する
"""
import os
from datetime import datetime
from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML, CSS


# auto-fitで段階的に試すフォントスケール (1ページに収まるまで)
AUTOFIT_SCALES = [1.0, 0.96, 0.92, 0.88, 0.85]


def _autofit_pdf(html: HTML, output_path: str) -> int:
    """1ページに収まるまでフォントを段階縮小して試行。最終的なpage数を返す。"""
    for scale in AUTOFIT_SCALES:
        if scale == 1.0:
            doc = html.render()
        else:
            scale_pct = int(scale * 100)
            adjustment_css = CSS(string=f"""
                html, body {{ font-size: {8.3 * scale:.2f}pt !important; line-height: 1.4 !important; }}
                .lead-headline {{ font-size: {26 * scale:.1f}pt !important; }}
                .lead-photo img {{ height: {34 * scale:.1f}mm !important; }}
                .mid-photo {{ height: {13 * scale:.1f}mm !important; }}
            """)
            doc = html.render(stylesheets=[adjustment_css])
        if len(doc.pages) <= 1:
            if scale != 1.0:
                print(f"  auto-fit: scaled to {int(scale * 100)}% to fit single page")
            doc.write_pdf(output_path)
            return len(doc.pages)
    # 最後の手段(85%)でもダメだった場合
    doc.write_pdf(output_path)
    print(f"  WARNING: auto-fit failed at min scale 85%, page count={len(doc.pages)}")
    return len(doc.pages)


def render_pdf(edited: dict, subsidy: dict, output_path: str, today: datetime,
               template_dir: str = "templates", assets_dir: str = "assets"):
    """テンプレートをレンダリングしてPDF出力"""

    env = Environment(loader=FileSystemLoader(template_dir))
    template = env.get_template("newspaper.html.j2")

    # 日本語の曜日
    weekdays = ["月", "火", "水", "木", "金", "土", "日"]
    weekday = weekdays[today.weekday()]

    # 令和年計算 (2019/5/1〜)
    reiwa_year = today.year - 2018

    # 一面の写真と中段3記事のサムネイルは、カテゴリでアイコン選択
    # asset側にあらかじめ photo_lead.svg, photo_microsoft.svg, photo_agent.svg, photo_law.svg などを置く
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
        "edition_no": "001",  # TODO: 連番管理
        "lead": edited["lead"],
        "mid": edited["mid"],
        "briefs": edited["briefs"],
        "column": edited["column"],
        "subsidy": subsidy,
        "logo_path": os.path.abspath(os.path.join(assets_dir, "logo.jpeg")),
        "lead_photo_path": os.path.abspath(os.path.join(assets_dir, "photo_lead.svg")),
        "assets_dir": os.path.abspath(assets_dir),
    }

    html_str = template.render(**context)

    # デバッグ用にHTML保存
    with open(output_path.replace(".pdf", ".html"), "w", encoding="utf-8") as f:
        f.write(html_str)

    html = HTML(string=html_str, base_url=os.path.abspath(assets_dir))
    pages = _autofit_pdf(html, output_path)
    print(f"PDF generated: {output_path} (pages={pages})")

    png_path = output_path.replace(".pdf", "_page1.png")
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(output_path)
        pix = doc.load_page(0).get_pixmap(dpi=150)
        pix.save(png_path)
        doc.close()
        print(f"PNG (page 1) generated: {png_path}")
    except Exception as e:
        print(f"WARNING: PNG generation failed: {e}")
        png_path = None

    return output_path, png_path
