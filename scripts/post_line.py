"""
LINE Messaging APIにグループ宛てで配信する。

LINEはbot側からPDFを直接送る仕組みが無いため、
- PDFと1ページ目のPNGを catbox.moe に匿名アップして公開URLを得る
- LINEには画像メッセージ(サムネイル)とテキストメッセージ(見出し+PDFリンク)を送る

環境変数:
- LINE_CHANNEL_ACCESS_TOKEN (long-lived)
- LINE_GROUP_ID (Cで始まる33文字)
未設定の場合は何もせずスキップ。
"""
import os
import requests


LINE_PUSH_API = "https://api.line.me/v2/bot/message/push"

# 公開アップロード先。先頭から順に試し、失敗したら次に fallback。
UPLOAD_PROVIDERS = [
    {"name": "0x0.st", "url": "https://0x0.st", "field": "file", "data": {}},
    {"name": "catbox", "url": "https://catbox.moe/user/api.php", "field": "fileToUpload",
     "data": {"reqtype": "fileupload"}},
]
UPLOAD_USER_AGENT = "abet-news/1.0 (+https://github.com/j11046rk-commits/abet-news)"


def _upload_to_public(file_path: str) -> str:
    """複数の公開アップローダを順に試して公開URLを得る"""
    last_err = None
    for prov in UPLOAD_PROVIDERS:
        try:
            with open(file_path, "rb") as f:
                r = requests.post(
                    prov["url"],
                    data=prov["data"],
                    files={prov["field"]: (os.path.basename(file_path), f)},
                    headers={"User-Agent": UPLOAD_USER_AGENT},
                    timeout=120,
                )
            r.raise_for_status()
            link = r.text.strip()
            if link.startswith("http"):
                print(f"  uploaded via {prov['name']}: {link}")
                return link
            last_err = f"{prov['name']}: unexpected response: {link[:200]}"
        except Exception as e:
            last_err = f"{prov['name']}: {e}"
        print(f"  upload failed → {last_err}")
    raise RuntimeError(f"All upload providers failed. Last error: {last_err}")


def _push_messages(token: str, group_id: str, messages: list) -> dict:
    r = requests.post(
        LINE_PUSH_API,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"to": group_id, "messages": messages},
        timeout=30,
    )
    print(f"LINE push: {r.status_code} {r.text[:300]}")
    r.raise_for_status()
    return r.json() if r.text else {}


def post_to_line(pdf_path: str, png_path: str | None,
                 headline: str, summary: str, date_str: str):
    """環境変数が揃っていれば LINEグループに配信"""
    token = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN")
    group_id = os.environ.get("LINE_GROUP_ID")
    if not (token and group_id):
        print("No LINE credentials configured. Skipping LINE post.")
        return

    print("Uploading files to public storage ...")
    pdf_url = _upload_to_public(pdf_path)
    print(f"  PDF URL: {pdf_url}")
    png_url = None
    if png_path and os.path.exists(png_path):
        try:
            png_url = _upload_to_public(png_path)
            print(f"  PNG URL: {png_url}")
        except Exception as e:
            print(f"  WARNING: PNG upload failed: {e}")

    text_lines = [
        f"📰 A-BET新聞 {date_str}",
        "",
        f"【本日の一面】{headline}",
        "",
        summary,
        "",
        f"🔗 PDF: {pdf_url}",
    ]
    text_body = "\n".join(text_lines)[:4900]  # LINE text の上限は5000字

    messages: list = []
    if png_url:
        messages.append({
            "type": "image",
            "originalContentUrl": png_url,
            "previewImageUrl": png_url,
        })
    messages.append({"type": "text", "text": text_body})

    _push_messages(token, group_id, messages)
