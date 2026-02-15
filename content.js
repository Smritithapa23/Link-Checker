
(function initShieldContentScript() {
  if (window.__shieldContentScriptReady) {
    return;
  }
  window.__shieldContentScriptReady = true;

  const ROOT_ID = 'shield-tech-overlay-root';
  const STYLE_ID = 'shield-tech-overlay-style';

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      document.body.appendChild(root);
    }
    return root;
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
        width: 420px;
        max-width: calc(100vw - 32px);
        background-color: gainsboro;
        border-radius: 8px;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
        padding: 16px;
        font-family: Arial, Helvetica, sans-serif;
        color: #111827;
        pointer-events: auto;
      }
      #${ROOT_ID} h1 {
        text-align: center;
        letter-spacing: 5px;
        margin: 0 0 10px 0;
        font-size: 26px;
      }
      #${ROOT_ID} .intro {
        text-align: center;
        font-size: 18px;
        margin: 0 0 10px 0;
      }
      #${ROOT_ID} .container {
        max-width: 250px;
        min-width: 100px;
        min-height: 36px;
        max-height: 105px;
        text-align: center;
        background-color: rgba(81, 173, 239, 0.60);
        font-size: 24px;
        margin: 10px auto 12px auto;
        padding: 6px 10px;
        border-radius: 6px;
      }
      #${ROOT_ID} .ReasonTitle {
        text-align: left;
        font-size: 20px;
        margin: 8px 0 10px 0;
      }
      #${ROOT_ID} .explain {
        min-height: 120px;
        max-height: 220px;
        overflow: auto;
        text-align: left;
        background-color: rgba(81, 173, 239, 0.60);
        font-size: 16px;
        line-height: 1.4;
        margin: 0;
        padding: 12px;
        border-radius: 6px;
        white-space: pre-wrap;
      }
    `;
    document.head.appendChild(style);
  }

  function verdictScore(verdict) {
    if (verdict === 'SAFE') return 9;
    if (verdict === 'SUSPICIOUS') return 4;
    if (verdict === 'DANGER') return 1;
    return 5;
  }

  function renderLoading() {
    ensureStyles();
    const root = ensureRoot();
    root.innerHTML = `
      <div class="linkclick-card">
        <h1><u>Link Analysis</u></h1>
        <p class="intro">From a scale of 0-10, this website's score is:</p>
        <p class="container">Scanning...</p>
        <p class="ReasonTitle"><br />Reasons:</p>
        <p class="explain">Analyzing this link now. Please wait a moment.</p>
      </div>
    `;
  }

  function renderResult(payload) {
    ensureStyles();
    const root = ensureRoot();
    const score = verdictScore(payload && payload.verdict);
    const reason = payload && payload.reason ? payload.reason : 'No details available.';
    const verdict = payload && payload.verdict ? payload.verdict : 'UNKNOWN';

    root.innerHTML = `
      <div class="linkclick-card">
        <h1><u>Link Analysis</u></h1>
        <p class="intro">From a scale of 0-10, this website's score is:</p>
        <p class="container">${score}/10 (${verdict})</p>
        <p class="ReasonTitle"><br />Reasons:</p>
        <p class="explain">${reason}</p>
      </div>
    `;

    window.clearTimeout(window.__shieldDismissTimer);
    window.__shieldDismissTimer = window.setTimeout(() => {
      if (root) {
        root.innerHTML = '';
      }
    }, 8000);
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

  console.log('LinkClick content script ready');
})();
