chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "checkLink",
      title: "Check Link",
      contexts: ["link"]
    });
  });

chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === "checkLink") {
        analyzeUrl(info.linkUrl);
    }
});

async function analyzeUrl(url) {
    console.log("Checking:", url);
    try {
        const response = await fetch('http://localhost:8000/analyze', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ url: url })
        });
        const data = await response.json();
        
        if (data.risk_level === 'high') {
            alert('WARNING: ${data.reason}');
        }
    } catch (error) {
        console.error("Server not running yet!", error);
    }
}
