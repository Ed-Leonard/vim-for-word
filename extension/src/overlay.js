// Everything needed to render block cursor in normal mode
function addStyles() {
  const modeStyle = document.createElement("style");
  modeStyle.textContent = `
    html.vim-normal-mode #PagesContainer,
    html.vim-normal-mode body {
      caret-color: transparent !important;
    }

    #vim-block-cursor {
      position: fixed;
      display: none;
      pointer-events: none;
      background: white;
      mix-blend-mode: difference;
      z-index: 999999;
      animation: vim-blink 1.5s steps(1) infinite;
    }

    @keyframes vim-blink {
      0%, 55% { opacity: 1; }
      56%, 100% { opacity: 0; }
    }

    /* Solid while selecting, like Vim */
    #vim-block-cursor.visual { animation: none; opacity: 1; }

    #vim-line-numbers {
      position: fixed;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      user-select: none;
      z-index: 999998;
      color: white;
      mix-blend-mode: difference;
      font: 12px monospace;
      text-align: right;
    }

    #vim-line-numbers span { position: absolute; opacity: 0.55; }
    #vim-line-numbers span.current { opacity: 1; font-weight: bold; }

    @media (prefers-reduced-motion: reduce) {
      #vim-block-cursor { animation: none; }
    }
  `;
  document.documentElement.appendChild(modeStyle);
}

function ensureCursorOverlay() {
  let el = document.getElementById("vim-block-cursor");
  if (!el) {
    el = document.createElement("div");
    el.id = "vim-block-cursor";
    document.documentElement.appendChild(el);
  }
  return el;
}

let lineNumberSurface = null;
let lineNumberEl = null;
let lineGeometryDirty = true;
let renderedLines = [];
let visibleLineLabels = [];

function invalidateLineNumbers() {
  lineGeometryDirty = true;
  updateCursorOverlay(VimMode.getMode());
}

function watchLineNumbers(surface) {
  lineNumberSurface = surface;
  lineNumberEl = document.createElement("div");
  lineNumberEl.id = "vim-line-numbers";
  lineNumberEl.setAttribute("aria-hidden", "true");
  document.documentElement.appendChild(lineNumberEl);
  new MutationObserver(invalidateLineNumbers).observe(surface, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  new ResizeObserver(invalidateLineNumbers).observe(surface);
  window.addEventListener("resize", invalidateLineNumbers);
}

function updateLineNumbers(caretRect) {
  if (!lineNumberSurface) return;
  const selection = window.getSelection();
  if (!caretRect || !lineNumberSurface.contains(selection?.focusNode)) {
    lineNumberEl.style.display = "none";
    return;
  }

  if (lineGeometryDirty) {
    const rects = [];
    const walker = document.createTreeWalker(
      lineNumberSurface,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.length) {
        range.selectNodeContents(node);
      } else if (node.nodeName === "BR") {
        range.selectNode(node);
      } else if (node.nodeName === "P" && !node.hasChildNodes()) {
        rects.push(node.getBoundingClientRect());
        continue;
      } else {
        continue;
      }
      rects.push(...range.getClientRects());
    }
    rects.sort((a, b) => a.top - b.top || a.left - b.left);
    renderedLines = [];
    let left = Infinity;
    for (const rect of rects) {
      if (rect.height <= 0) continue;
      left = Math.min(left, rect.left);
      const previous = renderedLines[renderedLines.length - 1];
      // Inline formatting can produce several overlapping rectangles for one row.
      if (previous && rect.top < previous.bottom - 1) {
        previous.bottom = Math.max(previous.bottom, rect.bottom);
      } else {
        renderedLines.push({ top: rect.top, bottom: rect.bottom });
      }
    }

    let clipTop = 0;
    let clipBottom = window.innerHeight;
    for (
      let parent = lineNumberSurface.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (getComputedStyle(parent).overflowY !== "visible") {
        const rect = parent.getBoundingClientRect();
        clipTop = Math.max(clipTop, rect.top);
        clipBottom = Math.min(clipBottom, rect.bottom);
      }
    }
    visibleLineLabels = [];
    const fragment = document.createDocumentFragment();
    const width = Math.min(48, Math.max(0, left - 8));
    if (width >= 16) {
      renderedLines.forEach((line, index) => {
        if (line.top < clipTop || line.bottom > clipBottom) return;
        const el = document.createElement("span");
        Object.assign(el.style, {
          left: `${left - width - 8}px`,
          top: `${line.top}px`,
          width: `${width}px`,
          lineHeight: `${line.bottom - line.top}px`,
        });
        fragment.appendChild(el);
        visibleLineLabels.push({ el, index });
      });
    }
    lineNumberEl.replaceChildren(fragment);
    lineGeometryDirty = false;
  }

  const center = (caretRect.top + caretRect.bottom) / 2;
  let low = 0;
  let high = renderedLines.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (renderedLines[mid].bottom <= center) low = mid + 1;
    else high = mid;
  }
  const current = Math.min(low, renderedLines.length - 1);
  for (const { el, index } of visibleLineLabels) {
    const label = String(
      index === current ? index + 1 : Math.abs(index - current),
    );
    if (el.textContent !== label) el.textContent = label;
    el.classList.toggle("current", index === current);
  }
  lineNumberEl.style.display = "block";
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
      if (rect)
        return {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          height: rect.height,
        };
    }

    // Upstream bias: measure the character BEFORE the caret.
    if (!biasDownstream && offset > 0) {
      const r = document.createRange();
      r.setStart(node, offset - 1);
      r.setEnd(node, offset);
      const rect = r.getClientRects()[0];
      if (rect)
        return {
          top: rect.top,
          left: rect.right,
          bottom: rect.bottom,
          height: rect.height,
        };
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
  const rect = rects[0] || range.getBoundingClientRect();
  if (rect?.height > 0) return rect;

  // Empty paragraphs and BR positions have no collapsed range rectangle.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const child = node.childNodes[offset] ?? node.childNodes[offset - 1];
    if (child) {
      range.selectNode(child);
      const rects = range.getClientRects();
      const rect = node.childNodes[offset] ? rects[0] : rects[rects.length - 1];
      if (rect?.height > 0) {
        return {
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          left: node.childNodes[offset] ? rect.left : rect.right,
        };
      }
    }
    const rect = node.getBoundingClientRect();
    if (rect.height > 0) return rect;
  }
  return null;
}

function getCharacterRectAtCursor() {
  const sel = window.getSelection();
  if (!sel.focusNode) return null;

  const node = sel.focusNode,
    offset = sel.focusOffset;

  // At EOL, use the collapsed caret instead of jumping to the next paragraph.
  if (node.nodeType === Node.TEXT_NODE && offset >= node.textContent.length) {
    return null;
  }

  if (node.nodeType !== Node.TEXT_NODE) return null;

  const range = document.createRange();
  range.setStart(node, offset);
  range.setEnd(node, offset + 1);
  const rect = range.getBoundingClientRect();
  return rect.width > 0 ? rect : null;
}

let cursorFramePending = false;
let cursorMode = "NORMAL";

function updateCursorOverlay(mode) {
  cursorMode = mode;
  if (cursorFramePending) return;
  cursorFramePending = true;
  requestAnimationFrame(() => {
    cursorFramePending = false;
    const mode = cursorMode;
    const el = ensureCursorOverlay();
    if (mode !== "NORMAL" && mode !== "VISUAL") {
      el.style.display = "none";
      if (lineNumberEl) lineNumberEl.style.display = "none";
      return;
    }

    const selection = window.getSelection();
    const charRect =
      getCharacterRectAtCursor() ??
      (selection?.focusNode
        ? getCaretRect(selection.focusNode, selection.focusOffset)
        : null);
    updateLineNumbers(charRect);
    if (!charRect) {
      el.style.display = "none";
      return;
    }

    el.style.display = "block";
    el.style.left = `${charRect.left}px`;
    el.style.top = `${charRect.top}px`;
    el.style.width = `${charRect.width || 12}px`; // fallback width at EOL where there's no next char
    el.style.height = `${charRect.height}px`;

    el.classList.toggle("visual", mode === "VISUAL");

    // Restart the blink without a synchronous layout read.
    for (const animation of el.getAnimations()) animation.currentTime = 0;
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
    mode === "INSERT" ? "#3CB26B" : mode === "VISUAL" ? "#BE8543" : "#537DB7";
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
