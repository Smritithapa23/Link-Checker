from __future__ import annotations

import json
import os
import re
import ssl
import time
import traceback
import hashlib
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl

try:
    import certifi
except Exception:  # pragma: no cover
    certifi = None
try:
    import redis
except Exception:  # pragma: no cover
    redis = None

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace "*" with your extension ID
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    url: HttpUrl


PHISH_FEED_URL = "https://phish.co.za/latest/phishing-links-ACTIVE.txt"
PHISH_FEED_TTL_SECONDS = 600
PHISH_FEED_SAMPLE_SIZE = 25

_feed_cache: list[str] = []
_feed_cache_at = 0.0
_gemini_cooldown_until = 0.0
_memory_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_valkey_client = None
_inflight_scans: dict[str, float] = {}
INFLIGHT_SCAN_TTL_SECONDS = 20
SSL_CONTEXT = (
    ssl.create_default_context(cafile=certifi.where())
    if certifi is not None
    else ssl.create_default_context()
)


def load_dotenv_file(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        return

    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key, value)


def extract_json(text: str) -> dict[str, str]:
    cleaned = text.strip()

    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, re.DOTALL)
    if fenced:
        cleaned = fenced.group(1)

    if not cleaned.startswith("{"):
        first = cleaned.find("{")
        last = cleaned.rfind("}")
        if first != -1 and last != -1 and first < last:
            cleaned = cleaned[first : last + 1]

    return json.loads(cleaned)


def fallback_verdict(target_url: str, reason: str = "Unable to complete AI verification.") -> dict[str, Any]:
    return {"url": target_url, "verdict": "UNKNOWN", "reason": reason, "risk_score": 5}


def cache_key_for_url(target_url: str) -> str:
    valkey_prefix = os.getenv("VALKEY_PREFIX", "shield:url:")
    normalized = target_url.strip().lower().rstrip("/")
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"{valkey_prefix}{digest}"


def init_valkey_client() -> None:
    global _valkey_client

    valkey_url = os.getenv("VALKEY_URL", "").strip()
    if not valkey_url or redis is None:
        _valkey_client = None
        return

    try:
        client = redis.from_url(valkey_url, decode_responses=True)
        client.ping()
        _valkey_client = client
        print("[Shield] Valkey cache connected.")
    except Exception as exc:
        _valkey_client = None
        print(f"[Shield] Valkey unavailable, using memory cache: {exc}")


def get_cached_verdict(target_url: str) -> dict[str, Any] | None:
    key = cache_key_for_url(target_url)
    now = time.time()

    if _valkey_client is not None:
        try:
            cached = _valkey_client.get(key)
            if cached:
                parsed = json.loads(cached)
                if isinstance(parsed, dict):
                    return parsed
        except Exception:
            pass

    memory_item = _memory_cache.get(key)
    if memory_item is None:
        return None

    expires_at, value = memory_item
    if expires_at <= now:
        _memory_cache.pop(key, None)
        return None
    return value


def set_cached_verdict(target_url: str, value: dict[str, Any], ttl_seconds: int | None = None) -> None:
    effective_ttl = ttl_seconds or int(os.getenv("SHIELD_CACHE_TTL_SECONDS", "1800"))
    key = cache_key_for_url(target_url)
    if _valkey_client is not None:
        try:
            _valkey_client.setex(key, effective_ttl, json.dumps(value))
            return
        except Exception:
            pass

    _memory_cache[key] = (time.time() + effective_ttl, value)


def parse_retry_after_seconds(retry_after: str | None) -> int:
    if not retry_after:
        return 60
    try:
        value = int(retry_after.strip())
        return max(value, 30)
    except Exception:
        return 60


def fetch_active_phishing_feed() -> list[str]:
    global _feed_cache, _feed_cache_at

    now = time.time()
    if _feed_cache and (now - _feed_cache_at) < PHISH_FEED_TTL_SECONDS:
        return _feed_cache

    req = urllib.request.Request(
        PHISH_FEED_URL,
        headers={"User-Agent": "ShieldTech-URL-Scanner/1.0"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=15, context=SSL_CONTEXT) as response:
        raw = response.read().decode("utf-8", errors="ignore")

    lines = [line.strip() for line in raw.splitlines()]
    _feed_cache = [line for line in lines if line and not line.startswith("#")]
    _feed_cache_at = now
    return _feed_cache


def normalize_hostname(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def match_known_phish(target_url: str, indicators: list[str]) -> str | None:
    target = target_url.lower().rstrip("/")
    target_host = normalize_hostname(target_url)

    for item in indicators:
        candidate = item.lower().rstrip("/")
        if not candidate:
            continue

        if candidate.startswith(("http://", "https://")):
            if target == candidate:
                return item
            candidate_host = normalize_hostname(candidate)
            if candidate_host and target_host and target_host == candidate_host:
                return item
        else:
            # Feed could contain bare hosts/domains.
            if target_host and (target_host == candidate or target_host.endswith("." + candidate)):
                return item
    return None


def build_prompt(target_url: str, recent_known_phish: list[str]) -> str:
    trends_block = "\n".join(f"- {u}" for u in recent_known_phish) if recent_known_phish else "- (none available)"
    return (
        "You are a URL security classifier. Analyze the URL below for phishing, malware, scam, "
        "credential harvesting, deceptive impersonation, typosquatting, and short-lived campaign links. "
        "Use the provided active phishing sample list as current trend context. "
        "If the URL matches or closely imitates those campaign patterns, raise risk. "
        "Return ONLY strict JSON with "
        'keys "verdict", "risk_score", and "reason". '
        '"verdict" must be one of SAFE, SUSPICIOUS, DANGER. '
        '"risk_score" must be an integer from 0 to 10 where 0 means malicious/high-risk and 10 means safe/low-risk.\n\n'
        f"URL: {target_url}\n\n"
        "Recent active phishing samples:\n"
        f"{trends_block}"
    )


def call_gemini(target_url: str, api_key: str, recent_known_phish: list[str]) -> dict[str, Any]:
    endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={api_key}"
    )
    request_body = {
        "contents": [{"parts": [{"text": build_prompt(target_url, recent_known_phish)}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }

    req = urllib.request.Request(
        endpoint,
        data=json.dumps(request_body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=30, context=SSL_CONTEXT) as response:
        payload = json.loads(response.read().decode("utf-8"))

    text = (
        payload.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )
    parsed = extract_json(text)
    verdict = str(parsed.get("verdict", "UNKNOWN")).upper()
    reason = str(parsed.get("reason", "Unable to determine safety.")).strip()
    try:
        risk_score = int(parsed.get("risk_score", 5))
    except Exception:
        risk_score = 5

    if verdict not in {"SAFE", "SUSPICIOUS", "DANGER"}:
        verdict = "UNKNOWN"
    risk_score = max(0, min(10, risk_score))

    return {"url": target_url, "verdict": verdict, "reason": reason, "risk_score": risk_score}


@app.on_event("startup")
def startup() -> None:
    load_dotenv_file(Path(__file__).resolve().parent / ".env")
    init_valkey_client()


@app.post("/analyze")
async def analyze(url_data: AnalyzeRequest) -> dict[str, Any]:
    global _gemini_cooldown_until
    target_url = str(url_data.url)
    parsed = urlparse(target_url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Only http/https URLs are supported.")

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return fallback_verdict(target_url, "Server missing GEMINI_API_KEY in .env")

    cached = get_cached_verdict(target_url)
    if cached:
        return cached

    recent_known_phish: list[str] = []
    try:
        known_indicators = fetch_active_phishing_feed()
        feed_match = match_known_phish(target_url, known_indicators)
        recent_known_phish = known_indicators[:PHISH_FEED_SAMPLE_SIZE]
        if feed_match:
            known_bad = {
                "url": target_url,
                "verdict": "DANGER",
                "reason": f"Matched active phishing indicator: {feed_match}",
                "risk_score": 0,
            }
            set_cached_verdict(target_url, known_bad, ttl_seconds=3600)
            return known_bad
    except Exception:
        # Continue without feed context if the list is temporarily unreachable.
        recent_known_phish = []

    now = time.time()
    if now < _gemini_cooldown_until:
        wait_seconds = int(_gemini_cooldown_until - now)
        cooldown_response = fallback_verdict(
            target_url,
            f"Gemini rate-limited. Try again in {wait_seconds}s.",
        )
        set_cached_verdict(target_url, cooldown_response, ttl_seconds=max(5, min(wait_seconds, 60)))
        return cooldown_response

    inflight_since = _inflight_scans.get(target_url)
    if inflight_since and (now - inflight_since) < INFLIGHT_SCAN_TTL_SECONDS:
        in_progress_response = fallback_verdict(
            target_url,
            "Scan already in progress. Retry in 2s.",
        )
        set_cached_verdict(target_url, in_progress_response, ttl_seconds=2)
        return in_progress_response

    _inflight_scans[target_url] = time.time()
    try:
        result = call_gemini(target_url, api_key, recent_known_phish)
        set_cached_verdict(target_url, result)
        return result
    except urllib.error.HTTPError as http_error:
        error_body = ""
        try:
            error_body = http_error.read().decode("utf-8", errors="ignore")[:300]
        except Exception:
            error_body = ""
        print(f"[Shield] Gemini HTTP error {http_error.code} for {target_url}. body={error_body}")
        if http_error.code == 429:
            retry_seconds = parse_retry_after_seconds(http_error.headers.get("Retry-After"))
            _gemini_cooldown_until = time.time() + retry_seconds
            rate_limited = fallback_verdict(target_url, f"Gemini HTTP 429 (rate limit). Retry in {retry_seconds}s.")
            set_cached_verdict(target_url, rate_limited, ttl_seconds=max(5, min(retry_seconds, 120)))
            return rate_limited
        return fallback_verdict(target_url, f"Gemini HTTP error: {http_error.code}")
    except Exception as exc:
        traceback.print_exc()
        return fallback_verdict(
            target_url,
            f"Security gateway error while contacting Gemini: {type(exc).__name__}: {str(exc)[:180]}",
        )
    finally:
        _inflight_scans.pop(target_url, None)
