function getCharacterRectAtCursor() {
  const sel = window.getSelection();
  if (!sel.focusNode || sel.focusNode.nodeType !== Node.TEXT_NODE) return null;
  const node = sel.focusNode,
    offset = sel.focusOffset;
  if (offset >= node.textContent.length) return null; // end of text node — no next char to cover
  const range = document.createRange();
  range.setStart(node, offset);
  range.setEnd(node, offset + 1);
  const rect = range.getBoundingClientRect();
  return rect.width > 0 ? rect : null;
}

function ensureCursorOverlay() {
  let el = document.getElementById("vim-block-cursor");
  if (!el) {
    el = document.createElement("div");
    el.id = "vim-block-cursor";
    el.style.cssText = `
	  position:fixed;
	  pointer-events:none;
	  background:#ffffff;
	  mix-blend-mode:difference;
	  z-index:999999;
	  display:none;
	`;
    document.documentElement.appendChild(el);
  }
  return el;
}

function updateCursorOverlay(mode) {
  requestAnimationFrame(() => {
    const el = ensureCursorOverlay();
    if (mode !== "NORMAL") {
      el.style.display = "none";
      return;
    }

    const charRect = getCharacterRectAtCursor() ?? getCaretRect(); // fall back to thin rect at EOL
    if (!charRect) {
      el.style.display = "none";
      return;
    }

    el.style.display = "block";
    el.style.left = `${charRect.left}px`;
    el.style.top = `${charRect.top}px`;
    el.style.width = `${charRect.width || 8}px`; // fallback width at EOL where there's no next char
    el.style.height = `${charRect.height}px`;
  });
}
