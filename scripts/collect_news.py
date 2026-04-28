"""
RSS/Web検索でAI関連ニュースを収集する
"""
import feedparser
import re
from datetime import datetime, timedelta, timezone
from html import unescape


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
    """直近N時間以内のAI関連記事を集める"""
    articles = []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    for url in RSS_FEEDS_JP:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:30]:
                pub = entry.get("published_parsed") or entry.get("updated_parsed")
                if pub:
                    pub_dt = datetime(*pub[:6], tzinfo=timezone.utc)
                    if pub_dt < cutoff:
                        continue
                title = strip_html(entry.get("title", ""))
                summary = strip_html(entry.get("summary", ""))[:500]
                if not is_ai_related(title, summary, "jp"):
                    continue
                articles.append({
                    "title": title,
                    "summary": summary,
                    "link": entry.get("link", ""),
                    "source": feed.feed.get("title", url),
                    "lang": "jp",
                    "published": pub_dt.isoformat() if pub else "",
                })
        except Exception as e:
            print(f"Failed to fetch {url}: {e}")

    for url in RSS_FEEDS_EN:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:20]:
                pub = entry.get("published_parsed") or entry.get("updated_parsed")
                if pub:
                    pub_dt = datetime(*pub[:6], tzinfo=timezone.utc)
                    if pub_dt < cutoff:
                        continue
                title = strip_html(entry.get("title", ""))
                summary = strip_html(entry.get("summary", ""))[:500]
                if not is_ai_related(title, summary, "en"):
                    continue
                articles.append({
                    "title": title,
                    "summary": summary,
                    "link": entry.get("link", ""),
                    "source": feed.feed.get("title", url),
                    "lang": "en",
                    "published": pub_dt.isoformat() if pub else "",
                })
        except Exception as e:
            print(f"Failed to fetch {url}: {e}")

    print(f"Collected {len(articles)} AI-related articles")
    return articles


if __name__ == "__main__":
    arts = fetch_recent_articles()
    for a in arts[:5]:
        print(f"- [{a['lang']}] {a['title']}")
