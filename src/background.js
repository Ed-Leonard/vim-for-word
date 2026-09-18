let port = browser.runtime.connectNative("com.typo.vimword");

port.onMessage.addListener((response) => {
  console.log("[vim-for-word] native host says:", response);
});

port.onDisconnect.addListener(() => {
  console.log(
    "[vim-for-word] native host disconnected",
    browser.runtime.lastError,
  );
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "synthKey") {
    port.postMessage({ key: msg.key, action: msg.action });
  }
});
