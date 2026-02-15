(function initLinkClickContentScript() {
  if (window.__linkClickContentScriptReady) {
    return;
  }
  window.__linkClickContentScriptReady = true;

  const ROOT_ID = 'linkclick-overlay-root';
  const STYLE_ID = 'linkclick-overlay-style';

  function appendWhenDomReady(node, toHead = false) {
    const parent = toHead
      ? (document.head || document.documentElement)
      : (document.body || document.documentElement);

    if (parent) {
      parent.appendChild(node);
      return;
    }

    const onReady = () => {
      const retryParent = toHead
        ? (document.head || document.documentElement)
        : (document.body || document.documentElement);
      if (retryParent && !node.isConnected) {
        retryParent.appendChild(node);
      }
    };
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      appendWhenDomReady(root, false);
    } else if (!root.isConnected) {
      appendWhenDomReady(root, false);
    }
    root.style.display = 'none';
    return root;
  }

  function showRoot() {
    const root = ensureRoot();
    root.style.display = 'block';
    return root;
  }

  function hideRoot() {
    const root = ensureRoot();
    root.style.display = 'none';
    root.innerHTML = '';
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        pointer-events: none;
      }
      #${ROOT_ID} .linkclick-card {
        width: 340px;
        max-width: calc(100vw - 24px);
        background: #ffffff;
        border: 1px solid #d1d5db;
        border-left: 4px solid #2563eb;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
        padding: 14px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #111827;
        pointer-events: auto;
      }
      #${ROOT_ID} .title {
        font-weight: 700;
        color: #1d4ed8;
        font-size: 14px;
        margin: 0 0 8px 0;
      }
      #${ROOT_ID} .score {
        font-size: 24px;
        font-weight: 700;
        margin: 0 0 8px 0;
      }
      #${ROOT_ID} .risk {
        font-size: 13px;
        font-weight: 700;
        margin: 0 0 6px 0;
      }
      #${ROOT_ID} .reason {
        font-size: 12px;
        line-height: 1.4;
        color: #374151;
        margin: 0;
      }
      #${ROOT_ID} .safe { border-left-color: #16a34a; }
      #${ROOT_ID} .suspicious { border-left-color: #d97706; }
      #${ROOT_ID} .danger { border-left-color: #dc2626; }
      #${ROOT_ID} .unknown { border-left-color: #6b7280; }
      #${ROOT_ID} .loading-text {
        font-size: 13px;
        color: #4b5563;
        margin-top: 10px;
      }
      #${ROOT_ID} .loading-shell {
        min-height: 120px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }
      #${ROOT_ID} .loading-dot {
        width: 52px;
        height: 52px;
        border-radius: 9999px;
        border: 4px solid #000000;
        border-top-color: transparent;
        background: transparent;
        animation: linkclick-spin 0.9s linear infinite;
      }
      @keyframes linkclick-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    appendWhenDomReady(style, true);
  }

  function verdictScore(verdict) {
    if (verdict === 'SAFE') return 9;
    if (verdict === 'SUSPICIOUS') return 4;
    if (verdict === 'DANGER') return 1;
    return 5;
  }

  function computedRiskScore(payload) {
    if (payload && typeof payload.risk_score === 'number') {
      return Math.max(0, Math.min(10, Math.round(payload.risk_score)));
    }
    return verdictScore(payload && payload.verdict);
  }

  function verdictLabel(verdict) {
    if (verdict === 'SAFE') return 'Low Risk';
    if (verdict === 'SUSPICIOUS') return 'Medium Risk';
    if (verdict === 'DANGER') return 'High Risk';
    return 'Unknown Risk';
  }

  function verdictClass(verdict) {
    if (verdict === 'SAFE') return 'safe';
    if (verdict === 'SUSPICIOUS') return 'suspicious';
    if (verdict === 'DANGER') return 'danger';
    return 'unknown';
  }

  function renderLoading() {
    ensureStyles();
    const root = showRoot();
    root.innerHTML = `
      <div class="linkclick-card">
        <p class="title">LinkClick</p>
        <div class="loading-shell">
          <div class="loading-dot"></div>
          <p class="loading-text">Scanning link...</p>
        </div>
      </div>
    `;
  }

  function renderResult(payload) {
    ensureStyles();
    const root = showRoot();
    const score = computedRiskScore(payload);
    const reason = payload && payload.reason ? payload.reason : 'No details available.';
    const verdict = payload && payload.verdict ? payload.verdict : 'UNKNOWN';
    const risk = verdictLabel(verdict);
    const klass = verdictClass(verdict);

    root.innerHTML = `
      <div class="linkclick-card ${klass}">
        <p class="title">LinkClick</p>
        <p class="score">Risk Score: ${score}/10</p>
        <p class="risk">${risk} (${verdict})</p>
        <p class="reason">${reason}</p>
      </div>
    `;

    window.clearTimeout(window.__linkClickDismissTimer);
    window.__linkClickDismissTimer = window.setTimeout(() => {
      hideRoot();
    }, 12000);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    sendResponse({ status: 'ok' });

    if (message && message.type === 'VERIFICATION_START') {
      renderLoading();
    } else if (message && message.type === 'VERIFICATION_RESULT') {
      renderResult(message.payload || null);
    }
    return true;
  });

  hideRoot();
  console.log('LinkClick content script ready');
})();
