// Vim-style relative line numbers (like `set relativenumber`).
//
// Hookups (unchanged):
//   1. Append LINE_NUMBER_CSS to the template string in addStyles().
//   2. Call watchLineNumbers() wherever you call watchWordCount().
//      It returns a dispose function if you ever want to tear it down.
//
// Depends on getCaretRect(node, offset) from your existing code.

const ROOT_ID = "PagesContainer";

// Optional: if auto-detection of the scrolling area picks the wrong element
// (numbers still show over the ribbon/status bar), put a selector here.
const VIEW_SELECTOR = null; // e.g. "#WACViewPanel"

// Subtrees ignored when building lines. Use debugLineNumbers() to find what
// the phantom "extra line" at the bottom of each page really is, then add a
// selector for it here (headers, footers, page numbers, etc.).
// Page adornment = the page-number label in the right margin (was the phantom line).
// Headers/footers are already skipped when empty because Word marks them aria-hidden;
// add ", .Header, .Footer" if you also want to ignore headers/footers that contain text.
const EXCLUDE_SELECTOR =
  '[aria-hidden="true"], .ClientPaginationPageAdornmentContainer';

// Ignore text nodes that are only zero-width characters or plain collapsible
// whitespace. A lone &nbsp; DOES count: Word renders empty paragraphs as an EOP
// span containing one, and those are real lines you can move onto with j/k.
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
  if (VIEW_SELECTOR) return document.querySelector(VIEW_SELECTOR);
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

// Collect *visual* lines (what j/k step over) whose rects overlap `view`
// (the vertical window to measure; may be taller than the screen).
function collectVisualLines(root, view) {
  const rects = [];
  const range = document.createRange();

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
    }
  );

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    // No checkVisibility() here: Word's DOM text is often opacity:0 / box-less while its
    // geometry is exactly where the text is drawn (canvas-painted paragraphs). Text that is
    // really absent has no client rects and is skipped below.
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.height === 0 || r.width === 0) continue;
      if (r.bottom < view.top || r.top > view.bottom) continue;
      rects.push({ top: r.top, bottom: r.bottom, left: r.left, src: el });
    }
  }

  rects.sort((a, b) => a.top - b.top || a.left - b.left);

  // Merge rects on the same line. A rect joins the previous line if its vertical
  // midpoint falls inside that line's band (robust to mixed font sizes).
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

// Vertical midpoint of the caret in viewport coordinates (may be off-screen), or null.
function getCaretY(sel) {
  let c = getCaretRect(sel.focusNode, sel.focusOffset);
  if (!c || (c.top === 0 && c.bottom === 0)) {
    // Empty paragraphs give a zero rect; fall back to the containing element.
    const el =
      sel.focusNode.nodeType === Node.ELEMENT_NODE
        ? sel.focusNode
        : sel.focusNode.parentElement;
    c = el?.getBoundingClientRect();
  }
  if (!c || (c.top === 0 && c.bottom === 0)) return null; // detached / unloaded
  return (c.top + c.bottom) / 2;
}

// Index of the line containing y, or -1.
function cursorLineIndex(lines, y) {
  if (!lines.length || y == null) return -1;
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

// Max distance (px) between caret and viewport we are willing to measure. Lines in
// between are measured so numbers stay exact after scrolling away from the caret.
const MAX_CARET_SPAN = 12000;

function renderLineNumbers() {
  const el = ensureGutter();
  const hide = () => {
    if (el.style.display !== "none") el.style.display = "none";
    lastSig = "";
  };

  if (!lineNumbersOn) return hide();
  const root = getRoot();
  if (!root) return hide();

  // Caret must be inside the document (not the ribbon, a search box, etc.).
  const sel = getSelection();
  if (!sel.focusNode || !root.contains(sel.focusNode)) return hide();

  const view = getViewRect(root);
  if (!view) return hide();

  const caretY = getCaretY(sel);
  if (caretY == null) return hide();

  // Measure from the viewport out to the caret, so the caret can be off-screen.
  const span = {
    top: Math.min(view.top, caretY - 4),
    bottom: Math.max(view.bottom, caretY + 4),
  };
  if (span.bottom - span.top > MAX_CARET_SPAN) return hide();

  const lines = collectVisualLines(root, span);
  const cur = cursorLineIndex(lines, caretY);
  if (cur < 0) return hide();

  // Only lines inside the viewport get a number drawn.
  const shown = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].bottom > view.top && lines[i].top < view.bottom) shown.push(i);
  }
  if (!shown.length) return hide();

  // Skip all DOM writes if nothing visible changed.
  let sig = `${view.top}|${view.left}|${view.bottom}`;
  let minLeft = Infinity;
  for (const i of shown) {
    const l = lines[i];
    sig += `|${Math.round(l.top)},${Math.round(l.bottom)},${Math.abs(i - cur)}`;
    if (l.left < minLeft) minLeft = l.left;
  }
  if (sig === lastSig && el.style.display === "block") return;
  lastSig = sig;

  el.style.cssText =
    `display:block;top:${view.top}px;left:${view.left}px;` +
    `height:${view.bottom - view.top}px;` +
    `width:${Math.max(32, minLeft - view.left - 8)}px`;

  // Reuse a pool of divs instead of rebuilding the DOM every frame.
  while (el.children.length < shown.length) {
    el.appendChild(document.createElement("div"));
  }
  while (el.children.length > shown.length) el.lastChild.remove();

  shown.forEach((li, k) => {
    const d = el.children[k];
    const l = lines[li];
    const text = String(Math.abs(li - cur));
    if (d.textContent !== text) d.textContent = text;
    const cls = li === cur ? "current" : "";
    if (d.className !== cls) d.className = cls;
    d.style.top = `${l.top - view.top}px`; // relative to the clipped gutter
    d.style.lineHeight = `${l.bottom - l.top}px`;
  });
}

// ---------- Cursor follows scroll (like nvim `scrolloff=999`) ----------
// When the user scrolls with the wheel / touch / scrollbar, the caret is moved to the
// line at FOLLOW_ANCHOR of the viewport (0.5 = centre). Scrolling caused by typing or
// by Word itself is ignored, because only user scroll gestures arm it.
let followScroll = false;
const FOLLOW_ANCHOR = 0.5;

// How the caret is moved:
//   "selection": DOM Selection API (collapse/extend). Cleanest, try this first.
//   "click":     dispatch synthetic mouse events at the target point. Use this if Word
//                Online ignores the DOM selection and the caret doesn't visibly move.
// If your j/k code already has a way of moving the caret that works, call that from
// moveCaretToPoint() instead.
const MOVE_METHOD = "selection";

let userScrollUntil = 0;
let scrollbarDrag = false;
let desiredX = null; // vim's "curswant": keep the same column across a scroll gesture
let lastFollowAt = 0;

function toggleScrollFollow() {
  followScroll = !followScroll;
  desiredX = null;
  return followScroll;
}

// Call this from your own scroll commands (e.g. a Ctrl-D / Ctrl-U implementation).
function noteUserScroll() {
  userScrollUntil = performance.now() + 250;
}

function caretFromPoint(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r && { node: r.startContainer, offset: r.startOffset };
}

function clickAt(x, y, extend) {
  const target = document.elementFromPoint(x, y);
  if (!target) return;
  const base = {
    bubbles: true, cancelable: true, composed: true, view: window,
    clientX: x, clientY: y, button: 0, shiftKey: extend,
  };
  target.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
  target.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
  target.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
}

function moveCaretToPoint(root, x, y, extend) {
  if (MOVE_METHOD === "click") return clickAt(x, y, extend);

  const pos = caretFromPoint(x, y);
  if (!pos || !root.contains(pos.node)) return;
  const owner = pos.node.nodeType === Node.ELEMENT_NODE ? pos.node : pos.node.parentElement;
  if (owner?.closest(EXCLUDE_SELECTOR)) return; // never land in headers/adornments
  const sel = getSelection();
  if (extend) sel.extend(pos.node, pos.offset); // keep the anchor in visual mode
  else sel.collapse(pos.node, pos.offset);
}

function followCaretToAnchor() {
  const root = getRoot();
  if (!root) return;
  const sel = getSelection();
  if (!sel.focusNode || !root.contains(sel.focusNode)) return;
  const view = getViewRect(root);
  if (!view) return;

  const lines = collectVisualLines(root, view);
  if (!lines.length) return;

  const targetY = view.top + (view.bottom - view.top) * FOLLOW_ANCHOR;
  let line = lines[0];
  let bestD = Infinity;
  for (const l of lines) {
    const d = Math.abs((l.top + l.bottom) / 2 - targetY);
    if (d < bestD) {
      bestD = d;
      line = l;
    }
  }

  // Already on the target line: nothing to do.
  const caretY = getCaretY(sel);
  if (caretY != null && caretY >= line.top && caretY <= line.bottom) return;

  const now = performance.now();
  if (desiredX == null || now - lastFollowAt > 400) {
    const c = getCaretRect(sel.focusNode, sel.focusOffset);
    desiredX = c && (c.left || c.right) ? c.left : line.left;
  }
  lastFollowAt = now;

  moveCaretToPoint(root, desiredX, (line.top + line.bottom) / 2, !sel.isCollapsed);
}


function watchLineNumbers() {
  let queued = false;
  let observed = null;
  let followPending = false;

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
      if (followPending) {
        followPending = false;
        followCaretToAnchor();
      }
      renderLineNumbers();
    });
  };

  // Scroll doesn't bubble, so listen in capture, but only react to the
  // document's own scroller instead of every scrollable thing on the page.
  const onScroll = (e) => {
    const r = getRoot();
    // Any scroller that contains the document (or the document itself).
    if (!r || (e.target.contains && e.target.contains(r))) {
      if (followScroll && (scrollbarDrag || performance.now() < userScrollUntil)) {
        followPending = true;
      }
      schedule();
    }
  };

  // Only user-initiated scrolling arms "cursor follows scroll".
  const onPointerDown = (e) => {
    if (
      scrollEl &&
      e.target === scrollEl &&
      e.clientX > scrollEl.getBoundingClientRect().left + scrollEl.clientWidth
    ) {
      scrollbarDrag = true; // grabbed the scrollbar
    }
  };
  const onPointerUp = () => {
    scrollbarDrag = false;
  };
  const arm = { capture: true, passive: true };
  window.addEventListener("wheel", noteUserScroll, arm);
  window.addEventListener("touchmove", noteUserScroll, arm);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);

  document.addEventListener("selectionchange", schedule);
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", schedule);
  schedule();

  return () => {
    document.removeEventListener("selectionchange", schedule);
    window.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", schedule);
    window.removeEventListener("wheel", noteUserScroll, { capture: true });
    window.removeEventListener("touchmove", noteUserScroll, { capture: true });
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerUp, true);
    mo.disconnect();
    gutterEl?.remove();
  };
}