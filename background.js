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
      console.log("Checking this URL:", info.linkUrl);
      alert("Checking link: " + info.linkUrl);
    }
  });


