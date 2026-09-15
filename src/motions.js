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

function setCursorAt(element, offset = 0) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNode = walker.nextNode();
  if (!textNode) return false;

  const range = document.createRange();
  range.setStart(textNode, Math.min(offset, textNode.textContent.length));
  range.collapse(true);

  const selection = window.getSelection();
  if (!selection) return false;

  selection.removeAllRanges();
  selection.addRange(range);

  // Verify Word actually adopted this position; only poke if it didn't.
  requestAnimationFrame(() => {
    const s = window.getSelection();
    if (s.focusNode !== textNode || s.focusOffset !== range.startOffset) {
      pokeCursorSync();
    }
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

function jumpToPrevParagraphEndByIndex(pIndex, paragraphs) {
  for (let i = pIndex - 1; i >= 0; i--) {
    const lastNode = findLastContentNode(paragraphs[i]);
    if (lastNode) {
      console.log(
        "jumpToPrevParagraphEndByIndex: landing in paragraph",
        i,
        paragraphs[i].getAttribute("paraid"),
      );
      return setCursorAt(lastNode.parentElement, lastNode.textContent.length);
    }
    console.log(
      "jumpToPrevParagraphEndByIndex: paragraph",
      i,
      "has no real content, skipping",
    );
  }
  console.log(
    "jumpToPrevParagraphEndByIndex: no valid paragraph above — attempting to trigger render",
  );
  return triggerRenderUpward();
}

function jumpToNextParagraphStartByIndex(pIndex, paragraphs) {
  for (let i = pIndex + 1; i < paragraphs.length; i++) {
    const firstNode = findFirstContentNode(paragraphs[i]);
    if (firstNode) {
      const result = setCursorAt(firstNode.parentElement, 0);
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

function handleParagraphBoundary(direction, fromNode) {
  const paragraphs = getAllParagraphs();
  const pIndex = findParagraphForNode(fromNode, paragraphs);

  console.log(
    "boundary check — fromNode:",
    JSON.stringify(fromNode?.textContent?.slice(0, 40)),
  );
  console.log(
    "boundary check — fromNode paraid:",
    fromNode?.parentElement?.closest("p.Paragraph")?.getAttribute("paraid"),
  );
  console.log(
    "boundary check — resolved pIndex:",
    pIndex,
    "of",
    paragraphs.length,
  );
  console.log(
    "boundary check — paragraph at pIndex:",
    paragraphs[pIndex]?.getAttribute("paraid"),
    paragraphs[pIndex]?.textContent?.slice(0, 40),
  );

  if (pIndex === -1) return false;

  return direction === "forward"
    ? jumpToNextParagraphStartByIndex(pIndex, paragraphs)
    : jumpToPrevParagraphEndByIndex(pIndex, paragraphs);
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

function moveCharacterForward() {
  const sel = window.getSelection();
  if (!sel.focusNode) return false;

  if (isStuckAtEOP(sel.focusNode, sel.focusOffset)) {
    const paragraphs = getAllParagraphs();
    const pIndex = findParagraphForNode(sel.focusNode, paragraphs);
    if (pIndex === -1) return false;

    console.log(
      "EOP node parent paraid:",
      sel.focusNode.parentElement
        ?.closest("p.Paragraph")
        ?.getAttribute("paraid"),
    );
    console.log(
      "pIndex:",
      pIndex,
      "paraid:",
      paragraphs[pIndex]?.getAttribute("paraid"),
      JSON.stringify(paragraphs[pIndex]?.textContent?.slice(0, 30)),
    );
    console.log(
      "pIndex+1:",
      paragraphs[pIndex + 1]?.getAttribute("paraid"),
      JSON.stringify(paragraphs[pIndex + 1]?.textContent?.slice(0, 30)),
    );
    console.log(
      "pIndex+2:",
      paragraphs[pIndex + 2]?.getAttribute("paraid"),
      JSON.stringify(paragraphs[pIndex + 2]?.textContent?.slice(0, 30)),
    );

    return jumpToNextParagraphStartByIndex(pIndex, paragraphs);
  }

  const beforeNode = sel.focusNode;
  const beforeOffset = sel.focusOffset;
  sel.modify("move", "right", "character");
  const moved =
    sel.focusNode !== beforeNode || sel.focusOffset !== beforeOffset;

  if (moved) {
    // Check again: did that single move land us AT the EOP (not past it)?
    // If so, treat this keystroke as "at boundary" and jump immediately,
    // rather than requiring a second identical keypress to notice we're stuck.
    if (isStuckAtEOP(sel.focusNode, sel.focusOffset)) {
      const paragraphs = getAllParagraphs();
      const pIndex = findParagraphForNode(sel.focusNode, paragraphs);
      if (pIndex !== -1)
        return jumpToNextParagraphStartByIndex(pIndex, paragraphs);
    }
    return true;
  }

  return false;
}

function moveCharacterBackward() {
  const result = moveCursor(["move", "backward", "character"]);
  if (result.moved) return true;
  return handleParagraphBoundary(
    "backward",
    result.beforeNode,
    result.beforeOffset,
  );
}

function moveLineForward() {
  const sel = window.getSelection();
  if (!sel.focusNode) return false;

  const beforeNode = sel.focusNode;
  const beforeOffset = sel.focusOffset;

  sel.modify("move", "forward", "line");
  const moved =
    sel.focusNode !== beforeNode || sel.focusOffset !== beforeOffset;

  if (moved && isStuckAtEOP(sel.focusNode, sel.focusOffset)) {
    const paragraphs = getAllParagraphs();
    const pIndex = findParagraphForNode(sel.focusNode, paragraphs);
    if (pIndex === -1) return true;

    jumpToNextParagraphStartByIndex(pIndex, paragraphs);
  }

  if (moved) return true;

  const paragraphs = getAllParagraphs();
  const pIndex = findParagraphForNode(beforeNode, paragraphs);
  if (pIndex === -1) return false;
  return jumpToNextParagraphStartByIndex(pIndex, paragraphs);
}

function moveLineBackward() {
  const result = moveCursor(["move", "backward", "line"]);
  if (result.moved) return true;
  return handleParagraphBoundary(
    "backward",
    result.beforeNode,
    result.beforeOffset,
  );
}

function deleteCharacter() {
  const sel = window.getSelection();
  if (!sel.focusNode) return false;
  document.execCommand("forwardDelete", false);
  return true;
}
