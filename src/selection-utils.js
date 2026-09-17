function isZeroWidthBoundaryNode(node) {
  if (!node) return false;
  const isZeroWidth = node.textContent === "\u200B" || node.textContent === "";
  const parent = node.parentElement;
  const inContentControl =
    parent?.classList.contains("ContentControlBoundarySink") ||
    parent?.closest(".ContentControl");
  return isZeroWidth && !!inContentControl;
}

function escapeContentControlBackward(node) {
  // Find the ContentControl wrapper and step to whatever precedes it in doc order
  const controlEl = node.parentElement?.closest(".ContentControl");
  if (!controlEl) return false;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  walker.currentNode = controlEl;
  // walk backward: TreeWalker has no previous-in-document built-in from an element,
  // so collect text nodes up to controlEl and take the last one before it
  const allText = [];
  const full = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = full.nextNode())) {
    if (controlEl.contains(n)) break;
    if (n.textContent.length > 0) allText.push(n);
  }
  const prev = allText[allText.length - 1];
  if (!prev) return false;
  return setCursorAt(prev, prev.textContent.length);
}

function getAllParagraphs() {
  const paragraphs = [...document.querySelectorAll("p.Paragraph")];
  const seen = new Set();
  const deduped = paragraphs.filter((p) => {
    const id = p.getAttribute("paraid");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return deduped.sort(
    (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
  );
}

function findParagraphForNode(node, paragraphs) {
  if (!node) return -1;
  const element =
    node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element) return -1;
  return paragraphs.findIndex((paragraph) => paragraph.contains(element));
}

function getParagraphTextNodes(paragraphEl) {
  const walker = document.createTreeWalker(paragraphEl, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.length > 0) nodes.push(n);
  }
  return nodes;
}

function pokeCursorSync() {
  document.execCommand("insertText", false, "x");
  document.execCommand("delete");
}

function setCursorAt(textNode, offset = 0, onSettled) {
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return false;
  const clampedOffset = Math.min(offset, textNode.textContent.length);
  const range = document.createRange();
  range.setStart(textNode, clampedOffset);
  range.collapse(true);

  const selection = window.getSelection();
  if (!selection) return false;

  selection.removeAllRanges();
  selection.addRange(range);

  requestAnimationFrame(() => {
    const s = window.getSelection();
    if (s.focusNode !== textNode || s.focusOffset !== clampedOffset) {
      pokeCursorSync();
    }
    onSettled?.(); // always fire once we actually know the final state
  });

  return true;
}

function findLastContentNode(paragraphEl) {
  const nodes = getParagraphTextNodes(paragraphEl).filter(
    (n) =>
      !n.parentElement?.closest(".EOP") &&
      !n.parentElement?.closest('[aria-hidden="true"]'),
  );
  return nodes.length > 0 ? nodes[nodes.length - 1] : null;
}

function findFirstContentNode(paragraphEl) {
  const nodes = getParagraphTextNodes(paragraphEl).filter(
    (n) =>
      !n.parentElement?.closest(".EOP") &&
      !n.parentElement?.closest('[aria-hidden="true"]'),
  );
  return nodes.length > 0 ? nodes[0] : null;
}

function landOnLastContentOfParagraph(markerNode, targetX, onSettled) {
  const paragraphs = getAllParagraphs();
  const pIndex = findParagraphForNode(markerNode, paragraphs);
  if (pIndex === -1) {
    onSettled?.();
    return true;
  }

  const lastNode = findLastContentNode(paragraphs[pIndex]);
  if (lastNode) {
    return setCursorAt(lastNode, lastNode.textContent.length, () => {
      walkToX("backward", targetX, onSettled);
    });
  }

  // No real content — this is a genuinely empty paragraph/line, and resting
  // on the marker IS the correct behavior (an empty line is a valid stop).
  // Do NOT jump forward here, or blank lines become unreachable.
  onSettled?.();
  return true;
}

function jumpToPrevParagraphEndByIndex(pIndex, paragraphs, onSettled) {
  for (let i = pIndex - 1; i >= 0; i--) {
    const lastNode = findLastContentNode(paragraphs[i]);
    if (lastNode) {
      console.log(lastNode);
      return setCursorAt(lastNode, lastNode.textContent.length, onSettled);
    }
  }
  return triggerRenderUpward();
}

function jumpToNextParagraphStartByIndex(
  pIndex,
  paragraphs,
  onSettled,
  offset = 0,
) {
  for (let i = pIndex + 1; i < paragraphs.length; i++) {
    const firstNode = findFirstContentNode(paragraphs[i]);
    if (firstNode) {
      const result = setCursorAt(firstNode, offset, onSettled);
      return result;
    }
  }
  return false;
}

function triggerRenderUpward() {
  const paragraphs = getAllParagraphs();
  if (paragraphs.length === 0) return false;

  const topParagraph = paragraphs[0];
  // Scroll it toward the middle/top of the viewport to encourage
  // Word to mount content above it.
  topParagraph.scrollIntoView({ block: "start", behavior: "instant" });

  return false; // caller should retry the motion after a short delay
}

function handleParagraphBoundary(direction, fromNode, onSettled) {
  const paragraphs = getAllParagraphs();
  const pIndex = findParagraphForNode(fromNode, paragraphs);

  if (pIndex === -1) return false;

  return direction === "forward"
    ? jumpToNextParagraphStartByIndex(pIndex, paragraphs, onSettled)
    : jumpToPrevParagraphEndByIndex(pIndex, paragraphs, onSettled);
}

function moveCursor(command) {
  const sel = window.getSelection();
  if (!sel.focusNode) return false;

  const beforeNode = sel.focusNode;
  const beforeOffset = sel.focusOffset;

  sel.modify(...command);

  const moved =
    sel.focusNode !== beforeNode || sel.focusOffset !== beforeOffset;
  return { moved, beforeNode, beforeOffset };
}

function isStuckAtEOP(node, offset) {
  const parent = node?.parentElement;
  return !!(
    parent?.classList.contains("EOP") &&
    offset === (node.textContent?.length ?? 0)
  );
}

function isOnHiddenMarkerNode(node) {
  const parent = node?.parentElement;
  return !!(parent?.closest(".EOP") || parent?.closest('[aria-hidden="true"]'));
}
