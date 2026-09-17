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
  document.addEventListener("selectionchange", () =>
    updateCursorOverlay(VimMode.getMode()),
  );
  document.addEventListener(
    "scroll",
    () => updateCursorOverlay(VimMode.getMode()),
    true,
  );
  addStyles();

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
    let handled = true;

    switch (event.key) {
      case "h": {
        const settle = () => updateCursorOverlay(VimMode.getMode());
        if (!moveBackward("character", settle)) {
          setTimeout(() => {
            moveBackward("character", settle);
          }, 500);
        }
        break;
      }
      case "l": {
        const settle = () => updateCursorOverlay(VimMode.getMode());
        if (!moveForward("character", settle)) {
          setTimeout(() => {
            moveForward("character", settle);
          }, 500);
        }
        break;
      }
      case "j": {
        const settle = () => updateCursorOverlay(VimMode.getMode());
        if (!moveForward("line", settle)) {
          setTimeout(() => moveForward("line", settle), 500);
        }
        break;
      }
      case "k": {
        const settle = () => updateCursorOverlay(VimMode.getMode());
        if (!moveBackward("line", settle)) {
          setTimeout(() => moveBackward("line", settle), 500);
        }
        break;
      }
      case "w": {
        const settle = () => updateCursorOverlay(VimMode.getMode());
        if (!moveForward("word", settle)) {
          setTimeout(() => moveForward("word", settle), 500);
        }
        break;
      }
      case "b": {
        const settle = () => updateCursorOverlay(VimMode.getMode());
        if (!moveBackward("word", settle)) {
          setTimeout(() => moveBackward("word", settle), 500);
        }
        break;
      }
      case "x":
        deleteCharacter();
        break;

      case "a":
        moveForward("character", () => {
          updateCursorOverlay(VimMode.getMode());
        });
        VimMode.setMode("INSERT");
        break;
      case "u":
        document.execCommand("undo");
        break;
      case "r":
        if (event.ctrlKey) document.execCommand("redo");
        break;
      case "i":
        VimMode.setMode("INSERT");
        break;
      default:
        handled = true;
    }

    if (handled) updateCursorOverlay(VimMode.getMode());
    return handled;
  }

  waitForEditingSurface();
})();
