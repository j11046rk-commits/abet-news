"""
RSS/Web検索でAI関連ニュースを収集する
"""
import feedparser
import re
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from html import unescape


_HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
    )
}
_OG_IMAGE_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\']og:image(?::secure_url)?["\'][^>]+content=["\']([^"\']+)',
    re.IGNORECASE,
)
_TWITTER_IMAGE_RE = re.compile(
    r'<meta[^>]+name=["\']twitter:image[^"\']*["\'][^>]+content=["\']([^"\']+)',
    re.IGNORECASE,
)


def _from_feed_entry(entry) -> str | None:
    """RSS feed entry に直接ぶら下がっている画像URLを優先で拾う"""
    for media in entry.get("media_thumbnail", []) or []:
        url = media.get("url")
        if url:
            return url
    for media in entry.get("media_content", []) or []:
        url = media.get("url")
        if url:
            return url
    for enc in entry.get("enclosures", []) or []:
        if (enc.get("type") or "").startswith("image/"):
            url = enc.get("href") or enc.get("url")
            if url:
                return url
    return None


def _from_article_page(url: str) -> str | None:
    """記事URLにアクセスし HTML 先頭の og:image / twitter:image を抽出"""
    if not url:
        return None
    try:
        r = requests.get(url, headers=_HTTP_HEADERS, timeout=6, allow_redirects=True)
        if r.status_code != 200:
            return None
        head = r.text[:60000]
        m = _OG_IMAGE_RE.search(head) or _TWITTER_IMAGE_RE.search(head)
        if m:
            return unescape(m.group(1))
    except Exception:
        return None
    return None


def fetch_image_url(article: dict, raw_entry=None) -> str | None:
    """1記事ぶんの画像URLを取得 (feed優先 → 記事ページから og:image)"""
    if raw_entry is not None:
        url = _from_feed_entry(raw_entry)
        if url:
            return url
    return _from_article_page(article.get("link", ""))


# 日本語AI関連RSS
RSS_FEEDS_JP = [
    "https://www.itmedia.co.jp/news/subtop/aiplus/index.rdf",
    "https://rss.itmedia.co.jp/rss/2.0/aiplus.xml",
    "https://gigazine.net/news/rss_2.0/",
]

# 英語AI関連RSS
RSS_FEEDS_EN = [
    "https://techcrunch.com/category/artificial-intelligence/feed/",
    "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    "https://venturebeat.com/category/ai/feed/",
]

AI_KEYWORDS_JP = [
    "AI", "人工知能", "生成AI", "LLM", "ChatGPT", "Claude", "Gemini",
    "OpenAI", "Anthropic", "DeepSeek", "エージェント", "機械学習",
    "リスキリング", "DX", "GPT", "助成金"
]

AI_KEYWORDS_EN = [
    "AI", "artificial intelligence", "LLM", "GPT", "ChatGPT", "Claude",
    "Anthropic", "OpenAI", "DeepSeek", "Gemini", "agent", "machine learning"
]


def strip_html(text: str) -> str:
    """HTMLタグを除去"""
    text = re.sub(r"<[^>]+>", "", text or "")
    return unescape(text).strip()


def is_ai_related(title: str, summary: str, lang: str) -> bool:
    """AIに関連する記事か判定"""
    text = (title + " " + summary).lower()
    keywords = AI_KEYWORDS_JP if lang == "jp" else AI_KEYWORDS_EN
    return any(kw.lower() in text for kw in keywords)


def fetch_recent_articles(hours: int = 36) -> list[dict]:
    """直近N時間以内のAI関連記事を集める。各記事の image_url も並列で取得。"""
    articles: list[dict] = []
    raw_entries: list = []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    def _ingest(feed_url: str, lang: str, top_n: int):
        try:
            feed = feedparser.parse(feed_url)
            for entry in feed.entries[:top_n]:
                pub = entry.get("published_parsed") or entry.get("updated_parsed")
                if pub:
                    pub_dt = datetime(*pub[:6], tzinfo=timezone.utc)
                    if pub_dt < cutoff:
                        continue
                title = strip_html(entry.get("title", ""))
                summary = strip_html(entry.get("summary", ""))[:500]
                if not is_ai_related(title, summary, lang):
                    continue
                articles.append({
                    "title": title,
                    "summary": summary,
                    "link": entry.get("link", ""),
                    "source": feed.feed.get("title", feed_url),
                    "lang": lang,
                    "published": pub_dt.isoformat() if pub else "",
                    "image_url": None,
                })
                raw_entries.append(entry)
        except Exception as e:
            print(f"Failed to fetch {feed_url}: {e}")

    for url in RSS_FEEDS_JP:
        _ingest(url, "jp", 30)
    for url in RSS_FEEDS_EN:
        _ingest(url, "en", 20)

    if articles:
        with ThreadPoolExecutor(max_workers=10) as ex:
            future_to_idx = {
                ex.submit(fetch_image_url, art, entry): i
                for i, (art, entry) in enumerate(zip(articles, raw_entries))
            }
            for fut in as_completed(future_to_idx):
                i = future_to_idx[fut]
                try:
                    articles[i]["image_url"] = fut.result()
                except Exception:
                    articles[i]["image_url"] = None

    img_count = sum(1 for a in articles if a.get("image_url"))
    print(f"Collected {len(articles)} AI-related articles ({img_count} with images)")
    return articles


if __name__ == "__main__":
    arts = fetch_recent_articles()
    for a in arts[:5]:
        print(f"- [{a['lang']}] {a['title']}")
