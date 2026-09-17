function jumpForwardPastBoundary(fromNode, onSettled, offset = 0) {
  const paragraphs = getAllParagraphs();
  const pIndex = findParagraphForNode(fromNode, paragraphs);
  if (pIndex === -1) return false;
  return jumpToNextParagraphStartByIndex(pIndex, paragraphs, onSettled, offset);
}

function jumpBackwardPastBoundary(fromNode, onSettled) {
  const prev = findPreviousContentTextNode(fromNode);
  if (prev) return setCursorAt(prev, prev.textContent.length, onSettled);
  return triggerRenderUpward(fromNode);
}

function walkToX(direction, targetX, onSettled, maxSteps = 1000) {
  const sel = window.getSelection();
  if (targetX == null) {
    onSettled?.();
    return true;
  }

  let rect = getCaretRect(sel.focusNode, sel.focusOffset);
  if (!rect) {
    onSettled?.();
    return true;
  }

  const lineY = rect.top;
  let bestDelta = Math.abs(rect.left - targetX);
  let bestNode = sel.focusNode,
    bestOffset = sel.focusOffset;

  for (let i = 0; i < maxSteps; i++) {
    const beforeNode = sel.focusNode,
      beforeOffset = sel.focusOffset;
    console.log(beforeNode);
    sel.modify("move", direction, "character");

    const moved =
      sel.focusNode !== beforeNode || sel.focusOffset !== beforeOffset;
    if (!moved) break; // hit end of paragraph/document — stop, keep best so far

    const next = getCaretRect(sel.focusNode, sel.focusOffset);
    if (!next) break;

    // Wrapped onto a different visual line before reaching targetX —
    // that means this paragraph's first/last line is shorter than targetX.
    // Back off to the best position found on the original line and stop.
    if (Math.abs(next.top - lineY) > 1) {
      setCursorAt(bestNode, bestOffset, onSettled);
      return true;
    }

    const delta = Math.abs(next.left - targetX);
    if (delta <= bestDelta) {
      bestDelta = delta;
      bestNode = sel.focusNode;
      bestOffset = sel.focusOffset;
    } else {
      // We've started moving away from targetX — overshot, previous step was closest
      break;
    }
  }

  setCursorAt(bestNode, bestOffset, onSettled);
  return true;
}

function moveForward(granularity, onSettled) {
  const sel = window.getSelection();
  if (!sel.focusNode) return false;

  if (isStuckAtEOP(sel.focusNode, sel.focusOffset)) {
    const rect = getCaretRect(sel.focusNode, sel.focusOffset);
    const targetX = rect ? rect.left : null;
    return jumpForwardPastBoundary(
      sel.focusNode,
      () => {
        walkToX("forward", targetX, onSettled);
      },
      sel.focusOffset,
    );
  }

  const beforeNode = sel.focusNode;
  const beforeOffset = sel.focusOffset;
  const beforeRect = getCaretRect(beforeNode, beforeOffset, true);

  sel.modify("move", "forward", granularity);

  const moved =
    sel.focusNode !== beforeNode || sel.focusOffset !== beforeOffset;

  if (moved) {
    if (isStuckAtEOP(sel.focusNode, sel.focusOffset)) {
      const afterRect = getCaretRect(sel.focusNode, sel.focusOffset, true);
      const sameLine =
        beforeRect && afterRect && Math.abs(afterRect.top - beforeRect.top) < 1;
      const targetX = beforeRect ? beforeRect.left : null;

      if (sameLine) {
        // No real line change happened — this is the original "stuck" case.
        return jumpForwardPastBoundary(
          sel.focusNode,
          () => {
            walkToX("forward", targetX, onSettled);
          },
          beforeOffset,
        );
      }

      // The move DID advance a line, it just landed on the marker instead
      // of real content. Don't skip this line — step back into it.
      return landOnLastContentOfParagraph(sel.focusNode, targetX, onSettled);
    }

    onSettled?.();
    return true;
  }

  const targetX = beforeRect ? beforeRect.left : null;
  return jumpForwardPastBoundary(beforeNode, () => {
    walkToX("forward", targetX, onSettled);
  });
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
