(function () {
  console.log("[vim-for-word] content script loaded on", window.location.href);

  // Word's editing surface — confirmed from DOM inspection
  const EDITING_SURFACE_SELECTOR = "#PagesContainer";

  let editingSurface = null;

  // Word Online loads asynchronously, so poll for the editing surface
  function waitForEditingSurface() {
    editingSurface = document.querySelector(EDITING_SURFACE_SELECTOR);
    if (editingSurface) {
      console.log("[vim-for-word] found editing surface", editingSurface);
      attachListeners();
    } else {
      setTimeout(waitForEditingSurface, 500);
    }
  }

  VimMode.onModeChange((mode) => updateCursorOverlay(mode));

  addStyles();

  function attachListeners() {
    // Capture phase so we intercept before Word's own handlers
    document.addEventListener("selectionchange", () =>
      updateCursorOverlay(VimMode.getMode()),
    );
    document.addEventListener(
      "scroll",
      () => updateCursorOverlay(VimMode.getMode()),
      true,
    );
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("keyup", handleKeyup, true);
  }

  waitForEditingSurface();
})();
