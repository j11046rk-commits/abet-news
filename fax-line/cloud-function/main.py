"""FAX の PDF を LINE で表示できる PNG に変換して公開 URL を返す。

pdf.co の置き換え。Cloud Run functions (第2世代) にデプロイして使う。
FAX 数件/日の規模なら Cloud Run の無料枠に収まるため実質 0 円で動く。

入力  POST / {"pdf_base64": "...", "name": "0328_001.pdf"}
出力  200   {"urls": [...], "url": "...", "pages": 2}
"""

import base64
import datetime
import os
import uuid

import fitz  # PyMuPDF
import functions_framework
from google.cloud import storage

BUCKET = os.environ["BUCKET"]
API_KEY = os.environ.get("API_KEY", "")
DPI = int(os.environ.get("DPI", "150"))
MAX_PAGES = int(os.environ.get("MAX_PAGES", "4"))
# 横長ページを縦に回す。FAX は縦向き前提の機器が多く、横長で届くと
# スマホで読めないため既定で有効。不要なら環境変数で 0 にする。
ROTATE_LANDSCAPE = os.environ.get("ROTATE_LANDSCAPE", "1") == "1"

_storage = storage.Client()


def _render(pdf_bytes):
    """PDF の各ページを PNG のバイト列にする。"""
    pages = []
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        for index, page in enumerate(doc):
            if index >= MAX_PAGES:
                break
            if ROTATE_LANDSCAPE:
                box = page.rect
                if box.width > box.height:
                    # set_rotation は PDF 本来の回転に加算されるため、
                    # 既存の回転を踏まえた絶対値で指定する。
                    page.set_rotation((page.rotation + 90) % 360)
            pages.append(page.get_pixmap(dpi=DPI).tobytes("png"))
    return pages


def _upload(png_bytes, prefix, index):
    blob = _storage.bucket(BUCKET).blob(f"{prefix}/{index + 1}.png")
    blob.upload_from_string(png_bytes, content_type="image/png")
    return f"https://storage.googleapis.com/{BUCKET}/{blob.name}"


@functions_framework.http
def convert(request):
    if API_KEY and request.headers.get("X-API-Key") != API_KEY:
        return {"error": "unauthorized"}, 401

    payload = request.get_json(silent=True) or {}
    encoded = payload.get("pdf_base64")
    if not encoded:
        return {"error": "pdf_base64 is required"}, 400

    try:
        pdf_bytes = base64.b64decode(encoded)
    except Exception:
        return {"error": "pdf_base64 is not valid base64"}, 400

    try:
        pages = _render(pdf_bytes)
    except Exception as exc:  # 壊れた PDF は 422 で返し、呼び出し側で握りつぶせるようにする
        return {"error": f"could not render pdf: {exc}"}, 422

    if not pages:
        return {"error": "pdf has no pages"}, 422

    # 日付で区切り、ランダムな ID を挟む。バケットは公開読み取りなので
    # URL を推測できないことが保護になる (SETUP.md の「保存先」参照)。
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d")
    prefix = f"{stamp}/{uuid.uuid4().hex}"
    urls = [_upload(png, prefix, i) for i, png in enumerate(pages)]

    return {"urls": urls, "url": urls[0], "pages": len(urls)}
