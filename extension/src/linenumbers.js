const ROOT_ID = "PagesContainer";

// Ignore random word elements that aren't actually in document
const EXCLUDE_SELECTOR =
  '[aria-hidden="true"], .ClientPaginationPageAdornmentContainer';

// Ignore text nodes that are only zero-width characters or plain collapsible
// whitespace. A lone &nbsp; DOES count: Word renders empty paragraphs as an EOP
// span containing one
const HAS_TEXT = /[^\s\u200b-\u200d\u2060\ufeff]|\u00a0/;

let lineNumbersOn = true;
let gutterEl = null;
let rootEl = null;
let scrollEl = null;
let lastSig = "";

function toggleLineNumbers() {
  lineNumbersOn = !lineNumbersOn;
  renderLineNumbers();
}

const LINE_NUMBER_CSS = `
  #vim-line-numbers {
    position: fixed;          /* top/left/width/height are set from JS */
    overflow: hidden;         /* clips numbers to the document viewport */
    pointer-events: none;
    z-index: 999998;
    color: white;
    mix-blend-mode: difference;
    font: 14px monospace;
    contain: strict;
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

function getRoot() {
  if (!rootEl || !rootEl.isConnected) rootEl = document.getElementById(ROOT_ID);
  return rootEl;
}

function ensureGutter() {
  if (!gutterEl) {
    gutterEl = document.createElement("div");
    gutterEl.id = "vim-line-numbers";
  }
  if (!gutterEl.isConnected) document.documentElement.appendChild(gutterEl);
  return gutterEl;
}

function findScrollParent(root) {
  for (let p = root.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (
      (oy === "auto" || oy === "scroll" || oy === "overlay") &&
      p.scrollHeight > p.clientHeight
    ) {
      return p;
    }
  }
  return null;
}

// The on-screen rectangle that actually shows the document: the scroll
// container clipped to the window. Everything outside it (ribbon, status bar)
// is excluded, both for collecting lines and for drawing the gutter.
function getViewRect(root) {
  if (!scrollEl || !scrollEl.isConnected || !scrollEl.contains(root)) {
    scrollEl = findScrollParent(root);
  }
  const win = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
  if (!scrollEl) return win;
  const r = scrollEl.getBoundingClientRect();
  const view = {
    top: Math.max(r.top, win.top),
    left: Math.max(r.left, win.left),
    bottom: Math.min(r.bottom, win.bottom),
    right: Math.min(r.right, win.right),
  };
  return view.bottom > view.top ? view : null;
}

function collectVisualLines(root, view) {
  const rects = [];
  const range = document.createRange();
  const visible = new Map();

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(n) {
        if (n.nodeType === Node.TEXT_NODE) {
          return HAS_TEXT.test(n.nodeValue)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
        if (n.matches(EXCLUDE_SELECTOR)) return NodeFilter.FILTER_REJECT;
        // Prune whole off-screen subtrees (e.g. every page that isn't visible)
        // instead of measuring every text node in the document.
        const b = n.getBoundingClientRect();
        if (b.height > 0 && (b.bottom < view.top || b.top > view.bottom)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    },
  );

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    let ok = visible.get(el);
    if (ok === undefined) {
      // checkVisibility also accounts for display:none / opacity:0 on ancestors,
      // which getComputedStyle on the parent alone misses.
      ok = el.checkVisibility
        ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : true;
      visible.set(el, ok);
    }
    if (!ok) continue;

    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.height === 0 || r.width === 0) continue;
      if (r.bottom < view.top || r.top > view.bottom) continue;
      rects.push({ top: r.top, bottom: r.bottom, left: r.left, src: el });
    }
  }

  rects.sort((a, b) => a.top - b.top || a.left - b.left);

  // Merge rects on the same line. A rect joins the previous line if its vertical
  const lines = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    const mid = (r.top + r.bottom) / 2;
    if (last && mid >= last.top && mid <= last.bottom) {
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
      last.left = Math.min(last.left, r.left);
    } else {
      lines.push({ ...r });
    }
  }
  return lines;
}

// Index of the line the caret is on, or -1 if it isn't on screen.
function cursorLineIndex(lines, sel) {
  if (!lines.length) return -1;

  let c = getCaretRect(sel.focusNode, sel.focusOffset);
  if (!c || (c.top === 0 && c.bottom === 0)) {
    // Empty paragraphs give a zero rect; fall back to the containing element.
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
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const d = y < l.top ? l.top - y : y > l.bottom ? y - l.bottom : 0;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return bestDist <= 10 ? best : -1;
}

function renderLineNumbers() {
  const el = ensureGutter();
  const hide = () => {
    if (el.style.display !== "none") el.style.display = "none";
    lastSig = "";
  };

  if (!lineNumbersOn) return hide();
  const root = getRoot();
  if (!root) return hide();

  const sel = getSelection();
  if (!sel.focusNode || !root.contains(sel.focusNode)) return hide();

  const view = getViewRect(root);
  if (!view) return hide();

  const lines = collectVisualLines(root, view);
  const cur = cursorLineIndex(lines, sel);
  if (cur < 0) return hide();

  // Skip all DOM writes if nothing visible changed.
  let sig = `${view.top}|${view.left}|${view.bottom}|${cur}`;
  for (const l of lines) sig += `|${Math.round(l.top)},${Math.round(l.bottom)}`;
  if (sig === lastSig && el.style.display === "block") return;
  lastSig = sig;

  let minLeft = Infinity;
  for (const l of lines) if (l.left < minLeft) minLeft = l.left;

  el.style.cssText =
    `display:block;top:${view.top}px;left:${view.left}px;` +
    `height:${view.bottom - view.top}px;` +
    `width:${Math.max(32, minLeft - view.left - 8)}px`;

  // Reuse a pool of divs instead of rebuilding the DOM every frame.
  while (el.children.length < lines.length) {
    el.appendChild(document.createElement("div"));
  }
  while (el.children.length > lines.length) el.lastChild.remove();

  for (let i = 0; i < lines.length; i++) {
    const d = el.children[i];
    const l = lines[i];
    const text = String(Math.abs(i - cur));
    if (d.textContent !== text) d.textContent = text;
    const cls = i === cur ? "current" : "";
    if (d.className !== cls) d.className = cls;
    d.style.top = `${l.top - view.top}px`; // relative to the clipped gutter
    d.style.lineHeight = `${l.bottom - l.top}px`;
  }
}

function watchLineNumbers() {
  let queued = false;
  let observed = null;

  const mo = new MutationObserver(() => schedule());

  const attachObserver = () => {
    const root = getRoot();
    if (root && root !== observed) {
      mo.disconnect();
      mo.observe(root, { childList: true, subtree: true, characterData: true });
      observed = root;
    }
  };

  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      attachObserver();
      renderLineNumbers();
    });
  };

  // Scroll doesn't bubble, so listen in capture, but only react to the
  // document's own scroller instead of every scrollable thing on the page.
  const onScroll = (e) => {
    if (!scrollEl || e.target === scrollEl || e.target === document) schedule();
  };

  document.addEventListener("selectionchange", schedule);
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", schedule);
  schedule();

  return () => {
    document.removeEventListener("selectionchange", schedule);
    window.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", schedule);
    mo.disconnect();
    gutterEl?.remove();
  };
}
