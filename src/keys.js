const HOLDABLE_KEY_MAP = {
  h: "Left",
  j: "Down",
  k: "Up",
  l: "Right",
  w: "WordRight",
  b: "WordLeft",
};

const NORMAL_KEY_MAP = {
  a: () => {
    sendSynthKey("Right");
    VimMode.setMode("INSERT");
  },
  "Shift+A": () => {
    sendSynthKey("End");
    VimMode.setMode("INSERT");
  },
  s: () => {
    sendSynthKey("Delete");
    VimMode.setMode("INSERT");
  },
  i: () => VimMode.setMode("INSERT"),
  u: () => sendSynthKey("Undo"),
  x: () => sendSynthKey("Delete"),
  "Ctrl+r": () => sendSynthKey("Redo"),
  "Shift+G": () => sendSynthKey("EndOfPage"),
};

function sendSynthKey(mappedKey, action) {
  browser.runtime.sendMessage({ type: "synthKey", key: mappedKey, action });
}

function handleHoldableKeydown(event) {
  const mapped = HOLDABLE_KEY_MAP[event.key];
  if (!mapped) return false;

  sendSynthKey(mapped, "down");
  return true;
}

function handleNormalModeKey(event) {
  const key = getKeyCombo(event);

  const command = NORMAL_KEY_MAP[key];

  if (!command) {
    return false;
  }

  command();
  updateCursorOverlay(VimMode.getMode());

  return true;
}

function handleHoldableKeyup(event) {
  const mapped = HOLDABLE_KEY_MAP[event.key];
  if (!mapped) return false;

  sendSynthKey(mapped, "up");
  return true;
}

function getKeyCombo(event) {
  const modifiers = [];

  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");

  modifiers.push(event.key);

  return modifiers.join("+");
}

function handleKeydown(event) {
  const mode = VimMode.getMode();

  if (event.key === "Escape") {
    console.log("[vim-for-word] ESC -> NORMAL");
    VimMode.setMode("NORMAL");
    return;
  }

  if (mode === "INSERT") {
    return;
  }

  if (mode === "NORMAL") {
    if (handleHoldableKeydown(event)) {
      event.preventDefault();
      event.stopPropagation();
      updateCursorOverlay(VimMode.getMode());
      return;
    }

    const handled = handleNormalModeKey(event);

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }

    updateCursorOverlay(VimMode.getMode());
  }
}

function handleKeyup(event) {
  handleHoldableKeyup(event);
}
