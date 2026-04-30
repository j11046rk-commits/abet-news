"""
LINE Messaging APIにグループ宛てで配信する。

LINEはbot側からPDFを直接送る仕組みが無いため、
- PDFと1ページ目のPNGを公開URLにアップ
  (優先順位: GitHub Releases → 0x0.st → catbox.moe)
- LINEには画像メッセージ(サムネイル)とテキストメッセージ(見出し+PDFリンク)を送る

環境変数:
- LINE_CHANNEL_ACCESS_TOKEN (long-lived)
- LINE_GROUP_ID (Cで始まる33文字)
- GITHUB_TOKEN, GH_REPOSITORY (Actions実行時に自動付与、Release作成に使用)
未設定の場合は何もせずスキップ。
"""
import mimetypes
import os
import requests


LINE_PUSH_API = "https://api.line.me/v2/bot/message/push"

# Fallback の公開アップロード先 (GitHub Releases が使えない時のみ)
UPLOAD_PROVIDERS = [
    {"name": "0x0.st", "url": "https://0x0.st", "field": "file", "data": {}},
    {"name": "catbox", "url": "https://catbox.moe/user/api.php", "field": "fileToUpload",
     "data": {"reqtype": "fileupload"}},
]
UPLOAD_USER_AGENT = "abet-news/1.0 (+https://github.com/j11046rk-commits/abet-news)"


def _upload_to_github_release(file_path: str, tag: str) -> str:
    """GitHub Releases にアップロードして browser_download_url を返す。
    既に同名アセットがあれば事前削除して再アップロード。
    """
    token = os.environ["GITHUB_TOKEN"]
    repo = os.environ["GH_REPOSITORY"]
    name = os.path.basename(file_path)
    api = f"https://api.github.com/repos/{repo}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}

    # 既存タグがあれば取得、無ければ作成
    r = requests.get(f"{api}/releases/tags/{tag}", headers=headers, timeout=20)
    if r.status_code == 200:
        release = r.json()
    else:
        r = requests.post(
            f"{api}/releases", headers=headers, timeout=30,
            json={"tag_name": tag, "name": f"A-BET News {tag}", "draft": False, "prerelease": False},
        )
        r.raise_for_status()
        release = r.json()

    # 同名アセットを削除 (再アップロードのため)
    for asset in release.get("assets", []):
        if asset["name"] == name:
            requests.delete(asset["url"], headers=headers, timeout=20)

    # アップロード
    upload_url = release["upload_url"].split("{")[0]
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    with open(file_path, "rb") as f:
        body = f.read()
    r = requests.post(
        f"{upload_url}?name={name}",
        headers={**headers, "Content-Type": ctype},
        data=body,
        timeout=120,
    )
    r.raise_for_status()
    return r.json()["browser_download_url"]


def _upload_anonymous(file_path: str) -> str:
    """匿名公開アップローダを順に試して公開URLを得る"""
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


def _upload_to_public(file_path: str, tag: str | None) -> str:
    """GitHub Releases を優先、ダメなら匿名アップローダにフォールバック"""
    if tag and os.environ.get("GITHUB_TOKEN") and os.environ.get("GH_REPOSITORY"):
        try:
            url = _upload_to_github_release(file_path, tag)
            print(f"  uploaded to GitHub Release ({tag}): {url}")
            return url
        except Exception as e:
            print(f"  GitHub Release upload failed → {e}")
    return _upload_anonymous(file_path)


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
                 headline: str, summary: str, date_str: str,
                 release_tag: str | None = None):
    """環境変数が揃っていれば LINEグループに配信"""
    token = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN")
    group_id = os.environ.get("LINE_GROUP_ID")
    if not (token and group_id):
        print("No LINE credentials configured. Skipping LINE post.")
        return

    print("Uploading files to public storage ...")
    pdf_url = _upload_to_public(pdf_path, release_tag)
    print(f"  PDF URL: {pdf_url}")
    png_url = None
    if png_path and os.path.exists(png_path):
        try:
            png_url = _upload_to_public(png_path, release_tag)
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
