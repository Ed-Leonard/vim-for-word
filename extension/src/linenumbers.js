// Vim-style relative line numbers (like `set relativenumber`).
//
// Drop this next to your other overlay code. Two small hookups:
//   1. Append LINE_NUMBER_CSS to the template string in addStyles().
//   2. Call watchLineNumbers() wherever you call watchWordCount().
// Nothing else needs to change: it listens for selectionchange/scroll/resize itself.

let lineNumbersOn = true;

function toggleLineNumbers() {
  lineNumbersOn = !lineNumbersOn;
  renderLineNumbers();
}

const LINE_NUMBER_CSS = `
  #vim-line-numbers {
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    overflow: hidden;
    pointer-events: none;
    z-index: 999998;
    color: white;
    mix-blend-mode: difference; /* readable on light and dark pages, like the block cursor */
    font: 14px monospace;
  }
  #vim-line-numbers div {
    position: absolute;
    right: 0;
    padding-right: 8px;
    white-space: nowrap;
    opacity: 0.6;
  }
  #vim-line-numbers div.current {
    opacity: 1;
    font-weight: bold;
  }
`;

let gutterEl = null;

function ensureGutter() {
  if (!gutterEl) {
    gutterEl = document.createElement("div");
    gutterEl.id = "vim-line-numbers";
  }
  if (!gutterEl.isConnected) document.documentElement.appendChild(gutterEl);
  return gutterEl;
}

// Rebuild the visible *visual* lines from text rects. A visual line is what j/k step over,
// so the relative numbers line up with counts like 5j.
function collectVisualLines() {
  const root = document.getElementById("PagesContainer");
  if (!root) return [];

  const rects = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const vh = window.innerHeight;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue || !isRealText(node)) continue;
    range.selectNodeContents(node);
    // One rect per line fragment, so a wrapped text node yields several.
    for (const r of range.getClientRects()) {
      if (r.height === 0 || r.bottom < 0 || r.top > vh) continue;
      rects.push(r);
    }
  }

  rects.sort((a, b) => a.top - b.top || a.left - b.left);

  // Merge rects that overlap vertically into one line. Overlap (not equal tops) is used
  // because runs with different font sizes have different tops/heights on the same line.
  const lines = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    if (last) {
      const overlap =
        Math.min(last.bottom, r.bottom) - Math.max(last.top, r.top);
      const smaller = Math.min(last.bottom - last.top, r.height);
      if (overlap > smaller * 0.5) {
        last.top = Math.min(last.top, r.top);
        last.bottom = Math.max(last.bottom, r.bottom);
        last.left = Math.min(last.left, r.left);
        continue;
      }
    }
    lines.push({ top: r.top, bottom: r.bottom, left: r.left });
  }
  return lines;
}

const styleCache = new WeakMap();

function isRealText(node) {
  const el = node.parentElement;
  if (!el) return false;
  if (el.closest('[aria-hidden="true"]')) return false;

  let ok = styleCache.get(el);
  if (ok === undefined) {
    const cs = getComputedStyle(el);
    ok =
      cs.display !== "none" &&
      cs.visibility !== "hidden" &&
      Number(cs.opacity) !== 0;
    styleCache.set(el, ok);
  }
  return ok;
}

// Index of the line the caret is on, or -1 if it isn't on screen.
function cursorLineIndex(lines) {
  const sel = window.getSelection();
  if (!sel.focusNode || !lines.length) return -1;

  let c = getCaretRect(sel.focusNode, sel.focusOffset);
  if (!c || (c.top === 0 && c.bottom === 0)) {
    // Empty paragraphs give a zero rect; use the containing element instead.
    const el =
      sel.focusNode.nodeType === Node.ELEMENT_NODE
        ? sel.focusNode
        : sel.focusNode.parentElement;
    c = el?.getBoundingClientRect();
  }
  if (!c) return -1;

  const y = (c.top + c.bottom) / 2;
  let best = -1;
  let bestDist = Infinity;
  lines.forEach((l, i) => {
    const d = y < l.top ? l.top - y : y > l.bottom ? y - l.bottom : 0;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return bestDist <= 10 ? best : -1; // caret scrolled out of view: show nothing
}

function renderLineNumbers() {
  const el = ensureGutter();
  if (!lineNumbersOn) {
    el.style.display = "none";
    return;
  }

  const lines = collectVisualLines();
  const cur = cursorLineIndex(lines);
  if (cur < 0) {
    el.style.display = "none";
    return;
  }

  el.style.display = "block";
  const edge = Math.min(...lines.map((l) => l.left)) - 8;
  el.style.width = `${Math.max(32, edge)}px`;

  // Reuse a pool of divs instead of rebuilding the DOM every frame.
  while (el.children.length < lines.length) {
    el.appendChild(document.createElement("div"));
  }
  while (el.children.length > lines.length) el.lastChild.remove();

  lines.forEach((l, i) => {
    const d = el.children[i];
    d.textContent = Math.abs(i - cur);
    d.className = i === cur ? "current" : "";
    d.style.top = `${l.top}px`;
    d.style.lineHeight = `${l.bottom - l.top}px`;
  });
}

function watchLineNumbers() {
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      renderLineNumbers();
    });
  };

  document.addEventListener("selectionchange", schedule);
  // Word Online scrolls an inner container; scroll doesn't bubble, so listen in capture.
  window.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule);
  schedule();
}
