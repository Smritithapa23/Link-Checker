GHBanner
Run Locally

Prerequisites

Node.js
Python 3.10+
FastAPI + Uvicorn (pip install fastapi uvicorn)
Setup

Install frontend dependencies: npm install
Put your Gemini key in /Users/smriti/Personal_Git/version1/.env: GEMINI_API_KEY=your_key_here Optional Valkey (Vultr) cache: VALKEY_URL=redis://:<password>@<host>:<port>/0 VALKEY_PREFIX=shield:url: SHIELD_CACHE_TTL_SECONDS=1800 If using Valkey, install client: pip install redis
Start the backend API from /Users/smriti/Personal_Git/version1: uvicorn main:app --reload --host 127.0.0.1 --port 8000
In another terminal, build or run the extension frontend: npm run build (for Chrome extension dist) or npm run dev (for local web dev)
The extension calls http://127.0.0.1:8000/analyze, and main.py now loads GEMINI_API_KEY from .env.