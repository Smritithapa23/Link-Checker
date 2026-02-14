chrome.runtime.onInstalled.addListener(() => {
    chrome.action.setBadgeText({
      text: "OFF",
    });
  });

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "checkLink",
      title: "Check Link",
      contexts: ["link"]
    });
  });

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "checkLink") {
      const linkUrl = info.linkUrl;
      console.log("Checking URL: ", linkUrl);
    }
  });

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading') {
      chrome.tabs.sendMessage(tabId, { action: 'checkPage' });
    }
  });


