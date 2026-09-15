// Simple mode state machine: NORMAL, INSERT, VISUAL
const VimMode = (() => {
  let currentMode = "NORMAL";
  const listeners = [];

  function setMode(mode) {
    if (mode === currentMode) return;
    currentMode = mode;
    listeners.forEach((fn) => fn(currentMode));
    document.documentElement.classList.toggle(
      "vim-normal-mode",
      mode === "NORMAL",
    );
    console.log("[vim-for-word] mode ->", currentMode);
  }

  function getMode() {
    return currentMode;
  }

  function onModeChange(fn) {
    listeners.push(fn);
  }

  return { setMode, getMode, onModeChange };
})();
