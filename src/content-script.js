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
      addStyles();
    } else {
      setTimeout(waitForEditingSurface, 500);
    }
  }

  VimMode.onModeChange((mode) => updateCursorOverlay(mode));
  document.addEventListener("selectionchange", () =>
    updateCursorOverlay(VimMode.getMode()),
  );
  document.addEventListener(
    "scroll",
    () => updateCursorOverlay(VimMode.getMode()),
    true,
  );

  function attachListeners() {
    // Capture phase so we intercept before Word's own handlers
    document.addEventListener("keydown", handleKeydown, true);
  }

  function handleKeydown(event) {
    const mode = VimMode.getMode();

    console.log(
      "[vim-for-word] keydown fired:",
      event.key,
      "mode:",
      VimMode.getMode(),
    );

    const s = window.getSelection();
    console.log(
      "[keydown]",
      event.key,
      "paraid:",
      s.focusNode?.parentElement
        ?.closest("p.Paragraph")
        ?.getAttribute("paraid"),
      "text:",
      JSON.stringify(s.focusNode?.textContent?.slice(0, 40)),
      "offset:",
      s.focusOffset,
    );

    // ESC always returns to Normal mode
    if (event.key === "Escape") {
      console.log("[vim-for-word] ESC -> NORMAL");
      VimMode.setMode("NORMAL");
      return;
    }

    if (mode === "INSERT") {
      // let everything through untouched in Insert mode
      return;
    }

    if (mode === "NORMAL") {
      const handled = handleNormalModeKey(event);
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }

  function handleNormalModeKey(event) {
    switch (event.key) {
      case "h":
        moveCharacterBackward();
        return true;
      case "l":
        moveCharacterForward();
        return true;
      case "j":
        let forwardResult = moveLineForward();
        if (!forwardResult) {
          // Give Word a moment to render newly-scrolled-in content, then retry once.
          setTimeout(() => {
            console.log("retrying moveLineForward");
            moveLineForward();
          }, 500);
        }
        return true;
      case "k":
        let result = moveLineBackward();
        if (!result) {
          // Give Word a moment to render newly-scrolled-in content, then retry once.
          setTimeout(() => {
            console.log("retrying moveLineBackward");
            moveLineBackward();
          }, 500);
        }
        return true;
      case "x":
        deleteCharacter();
        return true;
      case "a":
        moveCharacterForward();
        VimMode.setMode("INSERT");
        return true;
      case "u":
        document.execCommand("undo");
        return true;
      case "r":
        if (event.ctrlKey) {
          document.execCommand("redo");
          return true;
        }
      case "i":
        VimMode.setMode("INSERT");
        return true; // swallow the 'i' itself so it's not typed
      default:
        return true; // not handled, don't preventDefault
    }
  }

  waitForEditingSurface();
})();
