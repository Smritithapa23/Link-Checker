import { verifyUrlWithAI } from './services/geminiService';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const isMissingReceiverError = (message: string) =>
  message.includes('Receiving end does not exist') ||
  message.includes('Could not establish connection');

const isNonInjectablePageError = (message: string) =>
  message.includes('Cannot access contents of the page') ||
  message.includes('The extensions gallery cannot be scripted') ||
  message.includes('chrome://') ||
  message.includes('No tab with id');

const sendMessageToTab = (tabId: number, message: unknown, frameId?: number): Promise<void> =>
  new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, frameId !== undefined ? { frameId } : undefined, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve();
    });
  });

// Helper to handle connection to the page content script
const safeSendMessage = async (tabId: number, message: unknown, retries = 4, frameId?: number) => {
  for (let i = 0; i < retries; i++) {
    try {
      await sendMessageToTab(tabId, message, frameId);
      return;
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      if (isNonInjectablePageError(errorMessage)) {
        throw new Error(`Unable to message this page: ${errorMessage}`);
      }

      if (i === 0) {
        console.info("Content script missing. Injecting now...");
        const target: chrome.scripting.InjectionTarget =
          frameId !== undefined ? { tabId, frameIds: [frameId] } : { tabId };

        await chrome.scripting.executeScript({
          target,
          files: ['content.js']
        }).catch((e: unknown) => console.error("Injection failed:", e));
      }

      if (!isMissingReceiverError(errorMessage)) {
        throw new Error(`Failed to send message: ${errorMessage}`);
      }

      if (i === retries - 1) {
        console.error(`Attempt ${i + 1} failed (${errorMessage}).`);
      }
      await sleep(300 * (i + 1));
    }
  }
  console.error("❌ All retries failed. The content script is not responding.");
  throw new Error('Content script is not responding after retries.');
};

// Initialize the context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "verify-link-shield",
    title: "Verify with LinkClick",
    contexts: ["link"]
  });
});

// Handle the click
chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
  if (info.menuItemId === "verify-link-shield" && info.linkUrl && tab?.id) {
    if (!tab.url || !(tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
      console.warn(`Skipping unsupported tab URL: ${tab.url ?? 'unknown'}`);
      return;
    }

    const url = info.linkUrl;
    const frameId = typeof info.frameId === 'number' ? info.frameId : undefined;

    try {
      await safeSendMessage(tab.id, { type: 'VERIFICATION_START' }, 4, frameId);
      
      const result = await verifyUrlWithAI(url);
      
      await safeSendMessage(tab.id, { 
        type: 'VERIFICATION_RESULT', 
        payload: result 
      }, 4, frameId);
    } catch (err) {
      console.error("Shield Verification Failed:", err);
    }
  }
});
