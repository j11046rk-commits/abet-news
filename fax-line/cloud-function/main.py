"""FAX の PDF を、LINE 用の PNG か、複合機で印刷するための TIFF に変換する。

pdf.co と旧 convert-to-tiff の置き換え。Cloud Run functions (第2世代) にデプロイして使う。
FAX 数件/日の規模なら Cloud Run の無料枠に収まるため実質 0 円で動く。

LINE 表示用 (既定)
  入力  POST / {"pdf_base64": "..."}
  出力  200   {"urls": [...], "url": "...", "pages": 2}
  各ページを PNG にして公開バケットに置き、URL を返す。

印刷用
  入力  POST / {"pdf_base64": "...", "format": "tiff"}
  出力  200   {"tiff_base64": "...", "pages": 2}
  複合機のインターネット FAX 受信は PDF を処理できず、TIFF-F (1bit, MMR 圧縮,
  幅 1728px) しか受け付けない。全ページを 1 つの複数ページ TIFF にして返す。
"""

import base64
import datetime
import io
import os
import uuid

import fitz  # PyMuPDF
import functions_framework
from google.cloud import storage
from PIL import Image

BUCKET = os.environ["BUCKET"]
API_KEY = os.environ.get("API_KEY", "")
DPI = int(os.environ.get("DPI", "150"))
MAX_PAGES = int(os.environ.get("MAX_PAGES", "4"))
# 横長ページを縦に回す。FAX は縦向き前提の機器が多く、横長で届くと
# スマホで読めないため既定で有効。不要なら環境変数で 0 にする。
ROTATE_LANDSCAPE = os.environ.get("ROTATE_LANDSCAPE", "1") == "1"

# 印刷用 TIFF の寸法。G3 FAX の標準は幅 1728px、204x196dpi。
FAX_WIDTH = int(os.environ.get("FAX_WIDTH", "1728"))
FAX_DPI_X = int(os.environ.get("FAX_DPI_X", "204"))
FAX_DPI_Y = int(os.environ.get("FAX_DPI_Y", "196"))
# 白黒 2 値化のしきい値 (0-255)。文字原稿はディザより単純なしきい値の方が読みやすい。
FAX_THRESHOLD = int(os.environ.get("FAX_THRESHOLD", "160"))
FAX_MAX_PAGES = int(os.environ.get("FAX_MAX_PAGES", "30"))
# TIFF-F (RFC 2301) の既定: 0 = 白 (PhotometricInterpretation=0)、圧縮は MMR (group4)。
# 複合機が受け付けない場合は group3 (MH) に落とす。Pillow は tiffinfo の 262 を
# 渡せば自分でビットの向きを合わせるので、画素の反転は不要。
FAX_PHOTOMETRIC = int(os.environ.get("FAX_PHOTOMETRIC", "0"))
FAX_COMPRESSION = os.environ.get("FAX_COMPRESSION", "group4")

_storage = storage.Client()


def _orient(page):
    if ROTATE_LANDSCAPE and page.rect.width > page.rect.height:
        # set_rotation は PDF 本来の回転に加算されるため、
        # 既存の回転を踏まえた絶対値で指定する。
        page.set_rotation((page.rotation + 90) % 360)


def _render(pdf_bytes):
    """PDF の各ページを PNG のバイト列にする。"""
    pages = []
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        for index, page in enumerate(doc):
            if index >= MAX_PAGES:
                break
            _orient(page)
            pages.append(page.get_pixmap(dpi=DPI).tobytes("png"))
    return pages


def _render_fax_tiff(pdf_bytes):
    """全ページを FAX 規格の複数ページ TIFF (1bit, Group 4) にする。"""
    images = []
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        for index, page in enumerate(doc):
            if index >= FAX_MAX_PAGES:
                break
            _orient(page)
            # 横幅が FAX_WIDTH になる倍率。縦は FAX の縦横 dpi 比に合わせる。
            zoom_x = FAX_WIDTH / page.rect.width
            zoom_y = zoom_x * FAX_DPI_Y / FAX_DPI_X
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom_x, zoom_y), colorspace=fitz.csGRAY)
            gray = Image.frombytes("L", (pix.width, pix.height), pix.samples)
            mono = gray.point(lambda v: 255 if v > FAX_THRESHOLD else 0).convert("1")
            # 丸め誤差で幅が 1px ずれることがあるので、規定幅の白紙に貼って揃える。
            sheet = Image.new("1", (FAX_WIDTH, mono.height), 1)
            sheet.paste(mono, (0, 0))
            images.append(sheet)
    if not images:
        return None, 0
    buf = io.BytesIO()
    images[0].save(
        buf, format="TIFF", compression=FAX_COMPRESSION, dpi=(FAX_DPI_X, FAX_DPI_Y),
        tiffinfo={262: FAX_PHOTOMETRIC},
        save_all=True, append_images=images[1:],
    )
    return buf.getvalue(), len(images)


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

    want_tiff = payload.get("format") == "tiff"
    try:
        if want_tiff:
            tiff, count = _render_fax_tiff(pdf_bytes)
        else:
            pages = _render(pdf_bytes)
    except Exception as exc:  # 壊れた PDF は 422 で返し、呼び出し側で握りつぶせるようにする
        return {"error": f"could not render pdf: {exc}"}, 422

    if want_tiff:
        if not tiff:
            return {"error": "pdf has no pages"}, 422
        return {"tiff_base64": base64.b64encode(tiff).decode("ascii"), "pages": count}

    if not pages:
        return {"error": "pdf has no pages"}, 422

    # 日付で区切り、ランダムな ID を挟む。バケットは公開読み取りなので
    # URL を推測できないことが保護になる (SETUP.md の「保存先」参照)。
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d")
    prefix = f"{stamp}/{uuid.uuid4().hex}"
    urls = [_upload(png, prefix, i) for i, png in enumerate(pages)]

    return {"urls": urls, "url": urls[0], "pages": len(urls)}
