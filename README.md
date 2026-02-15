<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run Locally

## Prerequisites

- Node.js
- Python 3.10+
- FastAPI + Uvicorn (`pip install fastapi uvicorn`)

## Setup

1. Install frontend dependencies:
   `npm install`
2. Put your Gemini key in `/Users/smriti/Personal_Git/version1/.env`:
   `GEMINI_API_KEY=your_key_here`
   Optional Valkey (Vultr) cache:
   `VALKEY_URL=redis://:<password>@<host>:<port>/0`
   `VALKEY_PREFIX=shield:url:`
   `SHIELD_CACHE_TTL_SECONDS=1800`
   If using Valkey, install client:
   `pip install redis`
3. Start the backend API from `/Users/smriti/Personal_Git/version1`:
   `uvicorn main:app --reload --host 127.0.0.1 --port 8000`
4. In another terminal, build or run the extension frontend:
   `npm run build` (for Chrome extension dist)
   or
   `npm run dev` (for local web dev)

The extension calls `http://127.0.0.1:8000/analyze`, and `main.py` now loads `GEMINI_API_KEY` from `.env`.
