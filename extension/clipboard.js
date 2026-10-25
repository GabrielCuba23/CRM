(() => {
  const buffer = document.querySelector("#clipboard-buffer");
  const backgroundUrl = chrome.runtime.getURL("background.mjs");
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.channel !== "nexo.clipboard.offscreen") return false;
    // runtime supplies sender identity. Neither a website nor one of its content
    // scripts may write through this document directly, even with a forged type.
    if (sender.id !== chrome.runtime.id || sender.tab || (sender.url && sender.url !== backgroundUrl)) {
      sendResponse({ ok: false });
      return false;
    }
    if (message.target !== "clipboard-document" || message.type !== "write" || typeof message.text !== "string" || message.text.length > 100000) {
      sendResponse({ ok: false });
      return false;
    }
    try {
      if (!buffer) throw Error("Missing clipboard buffer");
      // The official Chrome offscreen clipboard pattern uses a selectable
      // textarea and copy command; navigator.clipboard would require focus.
      buffer.value = message.text;
      buffer.select();
      if (document.execCommand("copy") !== true) throw Error("Copy failed");
      sendResponse({ ok: true });
    } catch {
      sendResponse({ ok: false });
    } finally {
      // Credentials or messages must not remain in the hidden document's DOM.
      if (buffer) buffer.value = "";
      document.getSelection?.()?.removeAllRanges();
    }
    return false;
  });
})();
