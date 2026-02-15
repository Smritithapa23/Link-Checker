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
BACKBOARD_API_BASE = "https://app.backboard.io/api"
BACKBOARD_ASSISTANT_NAME = "LinkClick Security Analyzer"
BACKBOARD_ASSISTANT_SYSTEM_PROMPT = (
    "You are a URL security classifier. Return only strict JSON with verdict, risk_score, and reason."
)
BACKBOARD_DEFAULT_PROVIDER = "openai"
BACKBOARD_DEFAULT_MODEL = "gpt-4o"

_feed_cache: list[str] = []
_feed_cache_at = 0.0
_gemini_cooldown_until = 0.0
_memory_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_valkey_client = None
_inflight_scans: dict[str, float] = {}
INFLIGHT_SCAN_TTL_SECONDS = 20
_provider_latency_seconds: dict[str, float] = {"gemini": 1.8, "backboard": 1.2}
_backboard_assistant_id: str | None = None
_backboard_model_provider: str | None = None
_backboard_model_name: str | None = None
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
        # .env should be source of truth for local runs.
        os.environ[key] = value


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


def get_float_env(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except Exception:
        return default


def update_provider_latency(provider: str, elapsed_seconds: float) -> None:
    previous = _provider_latency_seconds.get(provider, elapsed_seconds)
    # Exponential moving average to estimate next-call latency.
    _provider_latency_seconds[provider] = (0.7 * previous) + (0.3 * max(0.05, elapsed_seconds))


def estimated_latency(provider: str) -> float:
    return _provider_latency_seconds.get(provider, 1.5)


def choose_provider_order(
    has_gemini: bool,
    has_backboard: bool,
    gemini_available_now: bool,
    total_budget_seconds: float,
) -> list[str]:
    providers: list[str] = []
    if has_gemini:
        providers.append("gemini")
    if has_backboard:
        providers.append("backboard")

    if not (has_gemini and has_backboard):
        return providers

    gemini_projected_slow = estimated_latency("gemini") > (total_budget_seconds * 0.55)
    if (not gemini_available_now) or gemini_projected_slow:
        return ["backboard", "gemini"]
    return ["gemini", "backboard"]


def open_backboard_request(req: urllib.request.Request, timeout_seconds: float):
    try:
        return urllib.request.urlopen(req, timeout=timeout_seconds, context=SSL_CONTEXT)
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", None)
        if isinstance(reason, ssl.SSLCertVerificationError):
            print("[Shield] Backboard TLS chain verify failed. Retrying with relaxed TLS verification.")
            insecure_context = ssl._create_unverified_context()
            return urllib.request.urlopen(req, timeout=timeout_seconds, context=insecure_context)
        raise


def _backboard_headers(api_key: str, json_content: bool = True) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "X-API-Key": api_key,
    }
    if json_content:
        headers["Content-Type"] = "application/json"
    return headers


def _backboard_json_request(
    path: str,
    api_key: str,
    timeout_seconds: float,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
) -> dict[str, Any] | list[Any]:
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        f"{BACKBOARD_API_BASE}{path}",
        data=data,
        headers=_backboard_headers(api_key, json_content=True),
        method=method,
    )
    with open_backboard_request(req, timeout_seconds=timeout_seconds) as response:
        raw = response.read().decode("utf-8", errors="ignore")
    if not raw.strip():
        return {}
    return json.loads(raw)


def _build_multipart_form(fields: dict[str, str]) -> tuple[bytes, str]:
    boundary = f"----linkclick-{int(time.time() * 1000)}"
    parts: list[str] = []
    for key, value in fields.items():
        parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{key}"\r\n\r\n'
            f"{value}\r\n"
        )
    parts.append(f"--{boundary}--\r\n")
    return "".join(parts).encode("utf-8"), boundary


def _ensure_backboard_model_selection(api_key: str, timeout_seconds: float) -> tuple[str, str]:
    global _backboard_model_provider, _backboard_model_name
    if _backboard_model_provider and _backboard_model_name:
        return _backboard_model_provider, _backboard_model_name

    provider = BACKBOARD_DEFAULT_PROVIDER
    model = BACKBOARD_DEFAULT_MODEL
    try:
        models_response = _backboard_json_request(
            "/models?limit=1",
            api_key=api_key,
            timeout_seconds=timeout_seconds,
            method="GET",
        )
        models = []
        if isinstance(models_response, dict):
            maybe_models = models_response.get("models")
            if isinstance(maybe_models, list):
                models = maybe_models
        elif isinstance(models_response, list):
            models = models_response

        if models and isinstance(models[0], dict):
            provider = str(models[0].get("provider") or provider)
            model = str(models[0].get("model_name") or models[0].get("name") or model)
    except Exception:
        pass

    _backboard_model_provider = provider
    _backboard_model_name = model
    return provider, model


def _ensure_backboard_assistant(api_key: str, timeout_seconds: float) -> str:
    global _backboard_assistant_id
    if _backboard_assistant_id:
        return _backboard_assistant_id

    created = _backboard_json_request(
        "/assistants",
        api_key=api_key,
        timeout_seconds=timeout_seconds,
        method="POST",
        payload={
            "name": BACKBOARD_ASSISTANT_NAME,
            "description": BACKBOARD_ASSISTANT_SYSTEM_PROMPT,
        },
    )
    if isinstance(created, dict):
        assistant_id = created.get("assistant_id")
        if isinstance(assistant_id, str) and assistant_id:
            _backboard_assistant_id = assistant_id
            return assistant_id

    raise RuntimeError("Backboard did not return assistant_id")


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
    feed_timeout_seconds = get_float_env("PHISH_FEED_TIMEOUT_SECONDS", 1.25)
    with urllib.request.urlopen(req, timeout=feed_timeout_seconds, context=SSL_CONTEXT) as response:
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


def call_gemini(
    target_url: str,
    api_key: str,
    recent_known_phish: list[str],
    timeout_seconds: float,
) -> dict[str, Any]:
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

    with urllib.request.urlopen(req, timeout=timeout_seconds, context=SSL_CONTEXT) as response:
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


def call_backboard(
    target_url: str,
    api_key: str,
    recent_known_phish: list[str],
    timeout_seconds: float,
) -> dict[str, Any]:
    assistant_id = _ensure_backboard_assistant(api_key, timeout_seconds=timeout_seconds)
    provider, model_name = _ensure_backboard_model_selection(api_key, timeout_seconds=timeout_seconds)

    thread_payload = _backboard_json_request(
        f"/assistants/{assistant_id}/threads",
        api_key=api_key,
        timeout_seconds=timeout_seconds,
        method="POST",
        payload={},
    )
    if not isinstance(thread_payload, dict):
        raise RuntimeError("Backboard thread creation returned unexpected payload")

    thread_id = str(thread_payload.get("thread_id", "")).strip()
    if not thread_id:
        raise RuntimeError("Backboard thread creation missing thread_id")

    multipart_fields = {
        "content": build_prompt(target_url, recent_known_phish),
        "send_to_llm": "true",
        "memory": "off",
        "web_search": "off",
        "llm_provider": provider,
        "model_name": model_name,
    }
    body, boundary = _build_multipart_form(multipart_fields)
    req = urllib.request.Request(
        f"{BACKBOARD_API_BASE}/threads/{thread_id}/messages",
        data=body,
        headers={
            "Accept": "application/json",
            "X-API-Key": api_key,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )

    with open_backboard_request(req, timeout_seconds=timeout_seconds) as response:
        raw_body = response.read().decode("utf-8", errors="ignore")

    if not raw_body.strip():
        raise RuntimeError("Backboard returned empty message response")

    payload = json.loads(raw_body)
    if not isinstance(payload, dict):
        raise RuntimeError("Backboard returned non-object message response")

    text = str(payload.get("content", "")).strip()
    if not text:
        raise RuntimeError("Backboard message response missing content")

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
    print(f"[LinkClick] Backboard API base: {BACKBOARD_API_BASE}")


@app.post("/analyze")
async def analyze(url_data: AnalyzeRequest) -> dict[str, Any]:
    global _gemini_cooldown_until
    target_url = str(url_data.url)
    parsed = urlparse(target_url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Only http/https URLs are supported.")

    gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
    backboard_api_key = os.getenv("BACKBOARD_API_KEY", "").strip()
    if not gemini_api_key and not backboard_api_key:
        return fallback_verdict(
            target_url,
            "Server missing GEMINI_API_KEY and BACKBOARD_API_KEY in .env",
        )

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
    request_start = now
    total_budget_seconds = get_float_env("ANALYZE_BUDGET_SECONDS", 6.5)
    min_provider_timeout_seconds = get_float_env("MIN_PROVIDER_TIMEOUT_SECONDS", 0.8)
    gemini_timeout_default_seconds = get_float_env("GEMINI_TIMEOUT_SECONDS", 2.0)
    backboard_timeout_default_seconds = get_float_env("BACKBOARD_TIMEOUT_SECONDS", 6.0)

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
        provider_errors: list[str] = []
        gemini_available_now = now >= _gemini_cooldown_until
        provider_order = choose_provider_order(
            has_gemini=bool(gemini_api_key),
            has_backboard=bool(backboard_api_key),
            gemini_available_now=gemini_available_now,
            total_budget_seconds=total_budget_seconds,
        )

        for provider in provider_order:
            elapsed = time.time() - request_start
            remaining = total_budget_seconds - elapsed
            if remaining < min_provider_timeout_seconds:
                provider_errors.append("Time budget exceeded before provider call")
                break

            if provider == "gemini":
                if not gemini_api_key:
                    continue
                if time.time() < _gemini_cooldown_until:
                    wait_seconds = int(_gemini_cooldown_until - time.time())
                    provider_errors.append(f"Gemini cooling down ({wait_seconds}s)")
                    continue

                provider_timeout = max(
                    min_provider_timeout_seconds,
                    min(gemini_timeout_default_seconds, remaining),
                )
                started = time.time()
                try:
                    gemini_result = call_gemini(
                        target_url,
                        gemini_api_key,
                        recent_known_phish,
                        timeout_seconds=provider_timeout,
                    )
                    update_provider_latency("gemini", time.time() - started)
                    set_cached_verdict(target_url, gemini_result)
                    return gemini_result
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
                        provider_errors.append(f"Gemini rate-limited ({retry_seconds}s)")
                    else:
                        provider_errors.append(f"Gemini HTTP error: {http_error.code}")
                except Exception as exc:
                    traceback.print_exc()
                    provider_errors.append(
                        f"Gemini error: {type(exc).__name__}: {str(exc)[:120]}"
                    )
                continue

            if provider == "backboard":
                if not backboard_api_key:
                    continue
                provider_timeout = max(
                    min_provider_timeout_seconds,
                    min(backboard_timeout_default_seconds, remaining),
                )
                started = time.time()
                try:
                    backboard_result = call_backboard(
                        target_url,
                        backboard_api_key,
                        recent_known_phish,
                        timeout_seconds=provider_timeout,
                    )
                    update_provider_latency("backboard", time.time() - started)
                    set_cached_verdict(target_url, backboard_result)
                    return backboard_result
                except urllib.error.HTTPError as http_error:
                    error_body = ""
                    try:
                        error_body = http_error.read().decode("utf-8", errors="ignore")[:300]
                    except Exception:
                        error_body = ""
                    print(f"[Shield] Backboard HTTP error {http_error.code} for {target_url}. body={error_body}")
                    provider_errors.append(f"Backboard HTTP error: {http_error.code}")
                except Exception as exc:
                    traceback.print_exc()
                    provider_errors.append(
                        f"Backboard error: {type(exc).__name__}: {str(exc)[:120]}"
                    )

        reason = " ; ".join(provider_errors) if provider_errors else "No available AI providers."
        return fallback_verdict(target_url, reason)
    finally:
        _inflight_scans.pop(target_url, None)
