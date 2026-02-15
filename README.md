# LinkClick

LinkClick is a Chrome extension that lets you right-click any link and request an AI-driven risk rating before opening it.

## What It Does

- Adds a context menu action: `Verify with LinkClick`
- Sends the selected URL to a local FastAPI backend
- Returns:
  - `Rating: 1-10` (`1 = high risk`, `10 = low risk`)
  - explanation/reason text
- Uses Gemini first with Backboard fallback, plus optional Valkey caching

## Project Layout

- `background.ts`: extension background worker + context menu flow
- `content.js`: in-page right-click result popup UI
- `App.tsx`: extension popup (toolbar icon UI)
- `main.py`: backend API (`/analyze`) + provider fallback (Gemini -> Backboard) + cache logic
- `public/manifest.json`: Chrome extension manifest

## Prerequisites

- Node.js 18+
- Python 3.10+
- Chrome (or Chromium-based browser)
- Gemini API key (and optional Backboard API key for fallback)

Optional:
- Valkey (local) for caching

## Setup

### One-time setup (copy/paste)

```bash
cd /Users/smriti/Personal_Git/pp
npm install
python3 -m pip install fastapi uvicorn redis certifi
```

### 1. Install frontend deps

```bash
npm install
```

### 2. Install Python deps

```bash
pip install fastapi uvicorn redis certifi
```

### 3. Configure environment

Create/update `/Users/smriti/Personal_Git/pp/.env`:

```env
GEMINI_API_KEY=your_gemini_api_key
BACKBOARD_API_KEY=your_backboard_api_key

# Optional local Valkey cache
VALKEY_URL=redis://127.0.0.1:6379/0
VALKEY_PREFIX=linkclick:url:
SHIELD_CACHE_TTL_SECONDS=1800

# Optional provider timing (keeps scans responsive)
ANALYZE_BUDGET_SECONDS=6.5
GEMINI_TIMEOUT_SECONDS=2.0
BACKBOARD_TIMEOUT_SECONDS=6.0
MIN_PROVIDER_TIMEOUT_SECONDS=0.8
PHISH_FEED_TIMEOUT_SECONDS=1.25
```

### 4. (Optional) Start local Valkey

```bash
brew install valkey
brew services start valkey
valkey-cli ping
```

Expected output:

```text
PONG
```

## Run

### Start everything (copy/paste)

Terminal 1 (backend):

```bash
cd /Users/smriti/Personal_Git/pp
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Terminal 2 (build extension):

```bash
cd /Users/smriti/Personal_Git/pp
npm run build
```

### 1. Start backend API

From project root:

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### 2. Build extension

```bash
npm run build
```

### 3. Load extension in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `/Users/smriti/Personal_Git/pp/dist`

### 4. Use LinkClick

1. Open any webpage
2. Right-click a link
3. Click `Verify with LinkClick`
4. Read rating + reason popup

## Icon

Extension icon is set to:

- `public/gemini_logo.png`

And referenced in manifest icons/action icons.

## Common Issues

### `Backend timeout/unreachable`

Backend is not running or blocked.

- Verify `uvicorn` is running on `127.0.0.1:8000`
- Reload extension after backend starts

### `Gemini HTTP error: 429`

Gemini rate limit/quota exceeded.

- Wait for cooldown and retry
- Check Gemini plan/quota/billing
- Valkey helps reduce repeated calls but cannot bypass quota limits

### Local network permission prompt

Chrome may ask permission because extension calls local backend (`127.0.0.1`).
Allowing this is required for backend-powered scanning.

## Notes

- Right-click flow is the primary behavior.
- Auto page-load blocking is not part of current behavior.
- Toggle ON/OFF is available in the extension popup and controls right-click scan execution.
