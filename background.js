chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "checkLink",
      title: "Check Link",
      contexts: ["link"]
    });
  });