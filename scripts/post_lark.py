"""
Larkに毎朝の新聞を投稿する。

優先順位:
1. Open API (LARK_APP_ID + LARK_APP_SECRET + LARK_CHAT_ID): リッチカード+PDF本体を投稿
2. Webhook (LARK_WEBHOOK_URL): テキストカードのみ (Webhookはファイル添付不可)
3. いずれも未設定: 投稿スキップ

LARK_DOMAIN で国際版/中国版を切替 (デフォルト国際版 open.larksuite.com)。
"""
import json
import os
import requests


def _domain() -> str:
    return os.environ.get("LARK_DOMAIN", "").strip() or "open.larksuite.com"


def send_lark_text(webhook_url: str, headline: str, summary: str, date_str: str):
    """Webhookにテキストカードを送る (PDF添付不可)"""
    payload = {
        "msg_type": "interactive",
        "card": _build_card(headline, summary, date_str, with_pdf_note=False),
    }
    r = requests.post(webhook_url, json=payload, timeout=15)
    print(f"Lark webhook: {r.status_code} {r.text[:200]}")
    r.raise_for_status()
    return r.json()


def _build_card(headline: str, summary: str, date_str: str, with_pdf_note: bool) -> dict:
    elements = [
        {"tag": "div", "text": {"tag": "lark_md", "content": f"**本日の一面**\n\n{headline}"}},
        {"tag": "div", "text": {"tag": "lark_md", "content": f"_{summary}_"}},
        {"tag": "hr"},
    ]
    if with_pdf_note:
        elements.append({"tag": "note", "elements": [
            {"tag": "plain_text", "content": "本日のPDFは続けて送信されます"}
        ]})
    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "template": "purple",
            "title": {"tag": "plain_text", "content": f"📰 A-BET新聞 {date_str}"},
        },
        "elements": elements,
    }


def _get_tenant_token(app_id: str, app_secret: str) -> str:
    url = f"https://{_domain()}/open-apis/auth/v3/tenant_access_token/internal"
    r = requests.post(url, json={"app_id": app_id, "app_secret": app_secret}, timeout=15)
    r.raise_for_status()
    data = r.json()
    token = data.get("tenant_access_token")
    if not token:
        raise RuntimeError(f"Lark tenant_access_token retrieval failed: {data}")
    return token


def _send_card_via_open_api(token: str, chat_id: str, headline: str, summary: str, date_str: str):
    url = f"https://{_domain()}/open-apis/im/v1/messages?receive_id_type=chat_id"
    payload = {
        "receive_id": chat_id,
        "msg_type": "interactive",
        "content": json.dumps(_build_card(headline, summary, date_str, with_pdf_note=True)),
    }
    r = requests.post(url, headers={"Authorization": f"Bearer {token}"},
                      json=payload, timeout=15)
    print(f"Lark card: {r.status_code}")
    r.raise_for_status()
    return r.json()


def _upload_pdf(token: str, pdf_path: str, file_name: str) -> str:
    url = f"https://{_domain()}/open-apis/im/v1/files"
    with open(pdf_path, "rb") as f:
        files = {"file": (file_name, f, "application/pdf")}
        data = {"file_type": "pdf", "file_name": file_name}
        r = requests.post(url, headers={"Authorization": f"Bearer {token}"},
                          files=files, data=data, timeout=60)
    r.raise_for_status()
    file_key = r.json()["data"]["file_key"]
    print(f"Lark file uploaded: file_key={file_key}")
    return file_key


def _send_file_message(token: str, chat_id: str, file_key: str):
    url = f"https://{_domain()}/open-apis/im/v1/messages?receive_id_type=chat_id"
    payload = {
        "receive_id": chat_id,
        "msg_type": "file",
        "content": json.dumps({"file_key": file_key}),
    }
    r = requests.post(url, headers={"Authorization": f"Bearer {token}"},
                      json=payload, timeout=15)
    print(f"Lark file message: {r.status_code}")
    r.raise_for_status()
    return r.json()


def send_lark_file(app_id: str, app_secret: str, chat_id: str,
                   pdf_path: str, file_name: str,
                   headline: str = "", summary: str = "", date_str: str = ""):
    """Open API経由でリッチカード→PDF本体の順に送信"""
    token = _get_tenant_token(app_id, app_secret)
    if headline:
        _send_card_via_open_api(token, chat_id, headline, summary, date_str)
    file_key = _upload_pdf(token, pdf_path, file_name)
    return _send_file_message(token, chat_id, file_key)


def post_to_lark(pdf_path: str, headline: str, summary: str, date_str: str):
    """環境変数を見て、Open API方式 or Webhook方式で送信"""
    file_name = os.path.basename(pdf_path)
    open_api_ready = all(
        os.environ.get(k) for k in ("LARK_APP_ID", "LARK_APP_SECRET", "LARK_CHAT_ID")
    )

    if open_api_ready:
        send_lark_file(
            app_id=os.environ["LARK_APP_ID"],
            app_secret=os.environ["LARK_APP_SECRET"],
            chat_id=os.environ["LARK_CHAT_ID"],
            pdf_path=pdf_path,
            file_name=file_name,
            headline=headline,
            summary=summary,
            date_str=date_str,
        )
    elif os.environ.get("LARK_WEBHOOK_URL"):
        send_lark_text(
            webhook_url=os.environ["LARK_WEBHOOK_URL"],
            headline=headline,
            summary=summary,
            date_str=date_str,
        )
    else:
        print("No Lark credentials configured. Skipping post.")
