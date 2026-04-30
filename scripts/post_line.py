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
CATBOX_API = "https://catbox.moe/user/api.php"


def _upload_to_catbox(file_path: str) -> str:
    """匿名で catbox.moe にアップロード、公開URLを返す"""
    with open(file_path, "rb") as f:
        r = requests.post(
            CATBOX_API,
            data={"reqtype": "fileupload"},
            files={"fileToUpload": (os.path.basename(file_path), f)},
            timeout=120,
        )
    r.raise_for_status()
    url = r.text.strip()
    if not url.startswith("http"):
        raise RuntimeError(f"catbox upload returned unexpected response: {url[:200]}")
    return url


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

    print("Uploading files to catbox.moe ...")
    pdf_url = _upload_to_catbox(pdf_path)
    print(f"  PDF URL: {pdf_url}")
    png_url = None
    if png_path and os.path.exists(png_path):
        try:
            png_url = _upload_to_catbox(png_path)
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
