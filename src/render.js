function getCharacterRectAtCursor() {
  const sel = window.getSelection();
  if (!sel.focusNode) return null;

  let node = sel.focusNode,
    offset = sel.focusOffset;

  // If we're a text node but at its end, hop to the next text node in doc order
  if (node.nodeType === Node.TEXT_NODE && offset >= node.textContent.length) {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    walker.currentNode = node;
    const next = walker.nextNode();
    if (!next || next.textContent.length === 0) return null; // true EOL/EOF
    node = next;
    offset = 0;
  }

  if (node.nodeType !== Node.TEXT_NODE) return null;

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
	  background:white;
	  opacity:1;
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

    el.style.display = "block";
    el.style.left = `${charRect.left}px`;
    el.style.top = `${charRect.top}px`;
    el.style.width = `${charRect.width || 12}px`; // fallback width at EOL where there's no next char
    el.style.height = `${charRect.height}px`;
  });
}
