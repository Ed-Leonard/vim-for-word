function jumpForwardPastBoundary(fromNode, onSettled) {
  const paragraphs = getAllParagraphs();
  const pIndex = findParagraphForNode(fromNode, paragraphs);
  if (pIndex === -1) return false;
  return jumpToNextParagraphStartByIndex(pIndex, paragraphs, onSettled);
}

function jumpBackwardPastBoundary(fromNode, onSettled) {
  const prev = findPreviousContentTextNode(fromNode);
  if (prev) return setCursorAt(prev, prev.textContent.length, onSettled);
  return triggerRenderUpward(fromNode);
}

function moveForward(granularity, onSettled) {
  const sel = window.getSelection();
  if (!sel.focusNode) return false;

  // Already sitting at a boundary marker, waiting to cross it
  if (isStuckAtEOP(sel.focusNode, sel.focusOffset)) {
    return jumpForwardPastBoundary(sel.focusNode, onSettled);
  }

  const beforeNode = sel.focusNode;
  const beforeOffset = sel.focusOffset;

  sel.modify("move", "forward", granularity);

  const moved =
    sel.focusNode !== beforeNode || sel.focusOffset !== beforeOffset;

  if (moved) {
    // Landed exactly at a boundary after this move — cross it now rather than
    // requiring a second identical keypress to notice we're stuck.
    if (isStuckAtEOP(sel.focusNode, sel.focusOffset)) {
      return jumpForwardPastBoundary(sel.focusNode, onSettled);
    }
    onSettled?.();
    return true;
  }

  // Didn't move at all — try to cross from where we started
  return jumpForwardPastBoundary(beforeNode, onSettled);
}

function moveBackward(granularity, onSettled) {
  const sel = window.getSelection();
  if (!sel.focusNode) return false;

  const beforeNode = sel.focusNode;
  const beforeOffset = sel.focusOffset;

  sel.modify("move", "backward", granularity);

  const moved =
    sel.focusNode !== beforeNode || sel.focusOffset !== beforeOffset;

  if (!moved) {
    // Truly stuck — start of paragraph (or document).
    return handleParagraphBoundary("backward", beforeNode, onSettled);
  }

  if (isZeroWidthBoundaryNode(sel.focusNode)) {
    return escapeContentControlBackward(sel.focusNode)
      ? (onSettled?.(), true)
      : false;
  }

  // Moved, but did we land on an invisible marker node rather than real content?
  if (isOnHiddenMarkerNode(sel.focusNode)) {
    const paragraphs = getAllParagraphs();
    const pIndex = findParagraphForNode(sel.focusNode, paragraphs);
    if (pIndex === -1) {
      onSettled?.();
      return true; // can't resolve further, accept where we are
    }

    const lastNode = findLastContentNode(paragraphs[pIndex]);
    if (lastNode) {
      return setCursorAt(lastNode, lastNode.textContent.length, onSettled);
    }
    return jumpToPrevParagraphEndByIndex(pIndex, paragraphs, onSettled);
  }

  onSettled?.();
  return true;
}

function deleteCharacter() {
  const sel = window.getSelection();
  if (!sel.focusNode) return false;
  sel.modify();
  document.execCommand("forwardDelete", false);
  return true;
}
