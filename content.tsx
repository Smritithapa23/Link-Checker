import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Store the root outside so we don't re-create it every time a message arrives
let root: ReactDOM.Root | null = null;

function mountOverlay(isOverlay: boolean) {
  const overlayRootId = 'shield-tech-overlay-root';
  let container = document.getElementById(overlayRootId);

  if (!container) {
    container = document.createElement('div');
    container.id = overlayRootId;
    // Removed pointer-events: none so buttons work
    container.style.cssText = "position:fixed; top:0; right:0; z-index:999999;";
    document.body.appendChild(container);
  }

  if (!root) {
    root = ReactDOM.createRoot(container);
  }
  
  root.render(<App isOverlay={isOverlay} />);
}

// 🎧 THE FIX: Immediate Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("👂 Content Script heard:", message.type);
  
  // 1. Immediately acknowledge to stop the "Retry failed" error
  sendResponse({ status: "ok" });

  // 2. Ensure the UI is actually mounted
  mountOverlay(true);

  // Note: Your App.tsx also has a listener inside useEffect. 
  // This global one ensures the "Receiving end" exists even if React is slow.
  return true; 
});

// Optional: Auto-mount on load if not on an extension page
if (window.location.protocol !== 'chrome-extension:') {
  mountOverlay(true);
}