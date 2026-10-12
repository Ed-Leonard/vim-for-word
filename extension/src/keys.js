// Normal/visual mode key handling. Never grabs the keyboard: it swallows the page's
// keydown, then asks the native host to inject real key events.
//
// Grammar:  [count] [operator] [count] (target | operator-again)
// Multi-key entries in the tables are space-joined ("g g", "i w").
const api = globalThis.browser ?? globalThis.chrome;

// Things that move the cursor. Valid bare, after an operator, and in VISUAL.
const MOTIONS = {
  h: { keys: ["Left"], counted: true },
  j: { keys: ["Down"], counted: true },
  k: { keys: ["Up"], counted: true },
  l: { keys: ["Right"], counted: true },
  w: { keys: ["WordRight"], counted: true },
  b: { keys: ["WordLeft"], counted: true },
  "Shift+$": { keys: ["End"] },
  0: { keys: ["Home"] },
  "Shift+G": { keys: ["EndOfPage"] },
  "g g": { keys: ["StartOfPage"] },
  "Ctrl+]": { keys: ["DownParagraph"], counted: true, tolerates: ["Ctrl"] },
  "Ctrl+[": { keys: ["UpParagraph"], counted: true, tolerates: ["Ctrl"] },
};

// Things that select a region around the cursor. Valid only after an operator or in VISUAL.
const TEXT_OBJECTS = {
  "a w": { select: ["Right", "WordLeft", "Shift+WordRight"] },
  "i w": { select: ["Right", "WordLeft", "Shift+WordRight"] }, // approximation: host can't see text
  "i p": { select: ["Up", "Shift+Down"] }, // needs paragraph keys on the host
  "a p": { select: ["Up", "Shift+Down"] },
};

// Standalone NORMAL-mode commands that don't compose.
const COMMANDS = {
  x: { keys: ["Delete"], counted: true },
  u: { keys: ["Undo"], counted: true },
  "Ctrl+r": { keys: ["Redo"], counted: true, tolerates: ["Ctrl"] },
  p: { keys: ["Paste"], counted: true },
  "Ctrl+]": { keys: ["DownParagraph"], counted: true, tolerates: ["Ctrl"] },
  "Ctrl+[": { keys: ["UpParagraph"], counted: true, tolerates: ["Ctrl"] },
  a: { keys: ["Right"], mode: "INSERT" },
  "Shift+A": { keys: ["End"], mode: "INSERT" },
  s: { keys: ["Delete"], mode: "INSERT" },
  i: { keys: [], mode: "INSERT" },
  "Shift+I": { keys: ["Home"], mode: "INSERT" },
  o: { keys: ["End", "Enter"], mode: "INSERT" },
  "Shift+O": { keys: ["Home", "Enter", "Up"], mode: "INSERT" },
  v: { keys: ["Right"], shift: true, mode: "VISUAL" },
};

// Standalone VISUAL-mode commands (they act on the current selection).
const VISUAL_COMMANDS = {
  x: { keys: ["Cut"], mode: "NORMAL" },
  d: { keys: ["Cut"], mode: "NORMAL" },
  c: { keys: ["Cut"], mode: "INSERT" },
  s: { keys: ["Cut"], mode: "INSERT" },
  v: { keys: [], mode: "NORMAL", collapse: true },
  y: { keys: ["Copy"], mode: "NORMAL", collapse: "start" },
  u: { keys: ["Undo"], counted: true },
  "Ctrl+r": { keys: ["Redo"], counted: true, tolerates: ["Ctrl"] },
};

// Things that act on a selection. Wait for a target (or themselves: yy, dd, cc).
const OPERATORS = {
  y: { keys: ["Copy"], collapse: "start" },
  d: { keys: ["Cut"] },
  c: { keys: ["Cut"], mode: "INSERT" },
};

const TARGETS = { ...MOTIONS, ...TEXT_OBJECTS };

function prefixesOf(table) {
  return new Set(
    Object.keys(table).flatMap((k) => {
      const parts = k.split(" ");
      return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join(" "));
    }),
  );
}
const MOTION_PREFIXES = prefixesOf(MOTIONS);
const TARGET_PREFIXES = prefixesOf(TARGETS);

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);
const REPEAT_DELAY = 400;
const REPEAT_RATE = 40;

let buf = fresh(); // the in-progress command: { count, op, opCount, seq }
let hold = null;
let pending = null; // { run }: a command waiting for physical modifiers to be released
const swallowed = new Set();

function fresh() {
  return { count: "", op: null, opCount: "", seq: [] };
}

function swallow(event) {
  event.preventDefault();
  event.stopPropagation();
}

function swallowKey(event) {
  swallow(event);
  swallowed.add(event.code);
}

function stopHold() {
  if (!hold) return;
  clearTimeout(hold.delayTimer);
  clearInterval(hold.repeatTimer);
  hold = null;
}

function startHold(code, cmd, firstRun) {
  stopHold();
  const h = { code, delayTimer: null, repeatTimer: null, busy: true };
  const finished = () => {
    h.busy = false;
  };
  firstRun.then(finished, finished);
  const repeat = () => {
    if (hold !== h || h.busy) return;
    h.busy = true;
    runCommand(cmd, 1).then(finished, finished);
  };
  h.delayTimer = setTimeout(() => {
    repeat();
    h.repeatTimer = setInterval(repeat, REPEAT_RATE);
  }, REPEAT_DELAY);
  hold = h;
}

function clearPending() {
  pending = null;
}

async function send(keys, n, shift) {
  const r = await api.runtime.sendMessage({
    type: "synthKey",
    keys,
    count: n,
    shift,
  });
  if (r && !r.ok) console.warn("[vimword]", r.error);
}

async function collapseSelection(to = "end") {
  await send([to === "start" ? "Left" : "Right"], 1, false);
}

function getKeyCombo(event) {
  const modifiers = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");
  modifiers.push(event.key);
  return modifiers.join("+");
}

function modsDown(event, tolerated = []) {
  const ok = (m) => tolerated.includes(m);
  const shiftMatters = VimMode.getMode() !== "VISUAL"; // visual motions add Shift anyway
  return (
    (event.ctrlKey && !ok("Ctrl")) ||
    (event.altKey && !ok("Alt")) ||
    (event.metaKey && !ok("Meta")) ||
    (shiftMatters && event.shiftKey && !ok("Shift"))
  );
}

async function runCommand(cmd, n = 1) {
  if (cmd.keys.length) await send(cmd.keys, cmd.counted ? n : 1, !!cmd.shift);
  if (cmd.mode) VimMode.setMode(cmd.mode);
  if (cmd.collapse)
    await collapseSelection(cmd.collapse === true ? "end" : cmd.collapse);
  updateCursorOverlay(VimMode.getMode());
}

// A bare motion or text object. In VISUAL mode motions extend the selection.
async function runMotion(target, n = 1) {
  if (target.select) {
    await send(target.select, 1, false);
  } else {
    const shift = VimMode.getMode() === "VISUAL";
    await send(target.keys, target.counted ? n : 1, shift);
  }
  updateCursorOverlay(VimMode.getMode());
}

// The key list that selects whatever the target covers.
function selectionFor(target, n) {
  if (target.linewise) return ["Home", ...Array(n).fill("Shift+Down")];
  if (target.select) return target.select;
  const reps = target.counted ? n : 1;
  return Array(reps)
    .fill(target.keys.map((k) => "Shift+" + k))
    .flat();
}

// Select, then Copy/Cut: one message, so it is atomic on the host side.
async function runOperator(opKey, target, n) {
  const op = OPERATORS[opKey];
  await send([...selectionFor(target, n), ...op.keys], 1, false);
  if (op.mode) VimMode.setMode(op.mode);
  if (op.collapse) await collapseSelection(op.collapse);
  updateCursorOverlay(VimMode.getMode());
}

function schedule(run, event, tolerated) {
  if (modsDown(event, tolerated)) {
    pending = { run, tolerates: tolerated };
    return false;
  }
  run();
  return true;
}

function feed(event, mode) {
  const combo = getKeyCombo(event);
  const inSeq = buf.seq.length > 0;
  const plain =
    !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
  const countKey = buf.op ? "opCount" : "count";

  // Count digits. "0" is a motion unless a count is already started.
  if (
    plain &&
    !inSeq &&
    /^[0-9]$/.test(event.key) &&
    (event.key !== "0" || buf[countKey])
  ) {
    buf[countKey] += event.key;
    return { status: "pending" };
  }

  // Operator (NORMAL only; in VISUAL, d/y/c are standalone commands on the selection).
  if (
    mode === "NORMAL" &&
    !buf.op &&
    !inSeq &&
    Object.hasOwn(OPERATORS, combo)
  ) {
    buf.op = combo;
    return { status: "pending" };
  }

  const n = (Number(buf.count) || 1) * (Number(buf.opCount) || 1);
  const op = buf.op;
  const key = [...buf.seq, combo].join(" ");

  if (op && !inSeq && combo === op) {
    buf = fresh();
    const ran = schedule(
      () => runOperator(op, { linewise: true }, n),
      event,
      target.tolerates,
    );
    return { status: "done", ran };
  }

  const useTargets = op || mode === "VISUAL";
  const target = (useTargets ? TARGETS : MOTIONS)[key];
  if (target) {
    buf = fresh();
    const ran = schedule(
      () => (op ? runOperator(op, target, n) : runMotion(target, n)),
      event,
      target.tolerates,
    );
    const motion = !op && target.counted ? target : null;
    return { status: "done", ran, motion };
  }

  if ((useTargets ? TARGET_PREFIXES : MOTION_PREFIXES).has(key)) {
    buf.seq.push(combo);
    return { status: "pending" };
  }

  if (op || inSeq) {
    buf = fresh();
    return { status: "cancel" };
  }
  return { status: "none", n };
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    const wasVisual = VimMode.getMode() === "VISUAL";
    stopHold();
    clearPending();
    buf = fresh();
    VimMode.setMode("NORMAL");
    updateCursorOverlay("NORMAL");
    if (wasVisual) collapseSelection("end");
    return;
  }

  const mode = VimMode.getMode();
  if (mode !== "NORMAL" && mode !== "VISUAL") return;
  if (MODIFIER_KEYS.has(event.key)) return; // bare modifier presses never cancel anything

  if (event.repeat && swallowed.has(event.code)) {
    swallow(event);
    return;
  }

  const r = feed(event, mode);

  if (r.status !== "none") {
    swallowKey(event);
    if (r.status === "done" && r.ran && r.motion) {
      startHold(event.code, () => runMotion(r.motion, 1));
    }
    updateCursorOverlay(VimMode.getMode());
    return;
  }

  // Standalone command, with the count that feed() accumulated.
  const cmd = (mode === "VISUAL" ? VISUAL_COMMANDS : COMMANDS)[
    getKeyCombo(event)
  ];
  buf = fresh();
  if (cmd) {
    swallowKey(event);
    const n = r.n;
    if (modsDown(event, cmd.tolerates)) {
      pending = { run: () => runCommand(cmd, n) };
    } else {
      const firstRun = runCommand(cmd, n);
      if (cmd.counted) startHold(event.code, cmd, firstRun);
    }
  }
  updateCursorOverlay(VimMode.getMode());
}

function handleKeyup(event) {
  if (swallowed.delete(event.code)) swallow(event);
  if (hold && event.code === hold.code) stopHold();

  if (pending && !modsDown(event)) {
    const { run } = pending;
    pending = null;
    run();
    updateCursorOverlay(VimMode.getMode());
  }
}
