// Everything needed to render block cursor in normal mode
function addStyles() {
  const modeStyle = document.createElement("style");
  modeStyle.textContent = `
  html.vim-normal-mode #PagesContainer,
  html.vim-normal-mode body {
    caret-color: transparent !important;
  }
`;
  document.documentElement.appendChild(modeStyle);
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

function getCaretRect(node, offset, biasDownstream = true) {
  if (node.nodeType === Node.TEXT_NODE) {
    const len = node.textContent.length;

    // Downstream bias: measure the character AFTER the caret. This resolves
    // to the line the caret is about to move into/through, not the line
    // whatever preceded it wrapped from.
    if (biasDownstream && offset < len) {
      const r = document.createRange();
      r.setStart(node, offset);
      r.setEnd(node, offset + 1);
      const rect = r.getClientRects()[0];
      if (rect) return { top: rect.top, left: rect.left, bottom: rect.bottom };
    }

    // Upstream bias: measure the character BEFORE the caret.
    if (!biasDownstream && offset > 0) {
      const r = document.createRange();
      r.setStart(node, offset - 1);
      r.setEnd(node, offset);
      const rect = r.getClientRects()[0];
      if (rect) return { top: rect.top, left: rect.right, bottom: rect.bottom };
    }
  }

  // Fallback: collapsed range (works fine away from wrap boundaries,
  // and for non-text nodes / empty text nodes).
  const range = document.createRange();
  try {
    range.setStart(node, offset);
    range.setEnd(node, offset);
  } catch {
    return null;
  }
  const rects = range.getClientRects();
  return rects[0] || range.getBoundingClientRect() || null;
}

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

function updateCursorOverlay(mode) {
  requestAnimationFrame(() => {
    const el = ensureCursorOverlay();
    if (mode !== "NORMAL" && mode !== "VISUAL") {
      el.style.display = "none";
      return;
    }

    const charRect =
      getCharacterRectAtCursor() ?? getCaretRect(document.activeElement, 0); // fall back to thin rect at EOL

    el.style.display = "block";
    el.style.left = `${charRect.left}px`;
    el.style.top = `${charRect.top}px`;
    el.style.width = `${charRect.width || 12}px`; // fallback width at EOL where there's no next char
    el.style.height = `${charRect.height}px`;
  });
}

let statusEl = null;
let modeEl = null;
let countEl = null;
let wordCount = null;

function updateStatusLine(mode = VimMode.getMode()) {
  if (!statusEl) {
    statusEl = document.createElement("div");
    statusEl.id = "vimword-status";
    Object.assign(statusEl.style, {
      position: "fixed",
      left: "0",
      right: "0",
      bottom: "24px",
      display: "flex",
      justifyContent: "space-between",
      padding: "2px 12px",
      font: "12px/1.6 monospace",
      color: "#fff",
      zIndex: "2147483647",
      pointerEvents: "none",
    });
    modeEl = document.createElement("span");
    countEl = document.createElement("span");
    statusEl.append(modeEl, countEl);
  }
  if (!statusEl.isConnected) document.documentElement.appendChild(statusEl);

  modeEl.textContent = `-- ${mode} --`;
  countEl.textContent = wordCount ? `${wordCount} words` : "";
  statusEl.style.background =
    mode === "INSERT" ? "#1b6e3c" : mode === "VISUAL" ? "#9a5b13" : "#1f3b63";
}

function readWordCount() {
  const el = document.getElementById("ShowWordCountDialog");
  if (!el) return null;
  const raw = el.getAttribute("label") ?? el.textContent ?? "";
  const m = raw.match(/\d[\d,]*/); // handles "1,234" and "1,234 words"
  return m ? m[0] : null;
}

function watchWordCount() {
  setInterval(() => {
    const c = readWordCount();
    if (c !== wordCount) {
      wordCount = c;
      updateStatusLine();
    }
  }, 1000);
}
