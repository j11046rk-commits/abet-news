"""
LarkのカスタムボットWebhookに、PDFを直接アップロードする方法は無いため、
- テキストメッセージで本日の見出しと「PDFは添付参照」を送る
- PDFは別途、Lark Open APIでアップロード→file_keyを取得→送信、の流れ

シンプル版: Webhookでメッセージだけ送る + PDFファイルパスをチャットに記載
完全版: Lark Open APIを使ってファイル送信

ここでは試作なのでまずWebhookでテキスト+ファイル送信のシンプル版を実装。
"""
import json
import os
import requests


def send_lark_text(webhook_url: str, headline: str, summary: str, date_str: str):
    """Webhookにテキストメッセージを送る"""
    payload = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "template": "purple",
                "title": {
                    "tag": "plain_text",
                    "content": f"📰 A-BET新聞 {date_str}"
                }
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": f"**本日の一面**\n\n{headline}"
                    }
                },
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": f"_{summary}_"
                    }
                },
                {"tag": "hr"},
                {
                    "tag": "note",
                    "elements": [
                        {"tag": "plain_text", "content": "本日のPDFは別途送信されます"}
                    ]
                }
            ]
        }
    }
    r = requests.post(webhook_url, json=payload, timeout=15)
    print(f"Lark webhook: {r.status_code} {r.text[:200]}")
    r.raise_for_status()
    return r.json()


def send_lark_file(app_id: str, app_secret: str, chat_id: str, pdf_path: str, file_name: str):
    """Lark Open APIでPDFファイルを送信"""
    # 1. tenant_access_token 取得
    tok_url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    tok_resp = requests.post(tok_url, json={
        "app_id": app_id,
        "app_secret": app_secret,
    }, timeout=15)
    tok_resp.raise_for_status()
    token = tok_resp.json()["tenant_access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. ファイルアップロード
    upload_url = "https://open.feishu.cn/open-apis/im/v1/files"
    with open(pdf_path, "rb") as f:
        files = {"file": (file_name, f, "application/pdf")}
        data = {
            "file_type": "pdf",
            "file_name": file_name,
        }
        upload_resp = requests.post(upload_url, headers=headers, files=files, data=data, timeout=60)
    upload_resp.raise_for_status()
    file_key = upload_resp.json()["data"]["file_key"]
    print(f"File uploaded: file_key={file_key}")

    # 3. メッセージ送信
    send_url = "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id"
    send_resp = requests.post(send_url, headers=headers, json={
        "receive_id": chat_id,
        "msg_type": "file",
        "content": json.dumps({"file_key": file_key}),
    }, timeout=15)
    send_resp.raise_for_status()
    print(f"Message sent: {send_resp.json()}")
    return send_resp.json()


def post_to_lark(pdf_path: str, headline: str, summary: str, date_str: str):
    """環境変数を見て、Webhook方式 or Open API方式で送信"""
    file_name = os.path.basename(pdf_path)

    # Open API方式が優先（PDFをそのまま送れる）
    if os.environ.get("LARK_APP_ID") and os.environ.get("LARK_CHAT_ID"):
        send_lark_file(
            app_id=os.environ["LARK_APP_ID"],
            app_secret=os.environ["LARK_APP_SECRET"],
            chat_id=os.environ["LARK_CHAT_ID"],
            pdf_path=pdf_path,
            file_name=file_name,
        )
    elif os.environ.get("LARK_WEBHOOK_URL"):
        # Webhook方式（テキストのみ、PDF添付不可）
        send_lark_text(
            webhook_url=os.environ["LARK_WEBHOOK_URL"],
            headline=headline,
            summary=summary,
            date_str=date_str,
        )
    else:
        print("No Lark credentials configured. Skipping post.")
