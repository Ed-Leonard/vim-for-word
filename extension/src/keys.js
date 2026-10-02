// Normal/visual mode key handling. Never grabs the keyboard: it swallows the page's
// keydown, then asks the native host to inject real key events.
const api = globalThis.browser ?? globalThis.chrome;

const NORMAL_KEYS = {
  h: { keys: ["Left"], counted: true },
  j: { keys: ["Down"], counted: true },
  k: { keys: ["Up"], counted: true },
  l: { keys: ["Right"], counted: true },
  w: { keys: ["WordRight"], counted: true },
  b: { keys: ["WordLeft"], counted: true },
  x: { keys: ["Delete"], counted: true },
  u: { keys: ["Undo"], counted: true },
  "Ctrl+r": { keys: ["Redo"], counted: true },
  p: { keys: ["Paste"], counted: true },

  a: { keys: ["Right"], mode: "INSERT" },
  "Shift+A": { keys: ["End"], mode: "INSERT" },
  s: { keys: ["Delete"], mode: "INSERT" },
  i: { keys: [], mode: "INSERT" },
  "Shift+I": { keys: ["Home"], mode: "INSERT" },
  o: { keys: ["End", "Enter"], mode: "INSERT" },
  "Shift+O": { keys: ["Home", "Enter", "Up"], mode: "INSERT" },
  v: { keys: [], shift: true, mode: "VISUAL" },
  "Shift+G": { keys: ["EndOfPage"] },
};

// Operators wait for a motion (or themselves: yy, dd, cc). Mode stays NORMAL meanwhile.
const OPERATORS = {
  y: { keys: ["Copy"], collapse: "start" },
  d: { keys: ["Cut"] },
  c: { keys: ["Cut"], mode: "INSERT" },
};

const MOTIONS = ["h", "j", "k", "l", "w", "b", "Shift+G"];

const VISUAL_KEYS = {
  ...Object.fromEntries(
    MOTIONS.map((k) => [k, { ...NORMAL_KEYS[k], shift: true }]),
  ),
  x: { keys: ["Cut"], mode: "NORMAL" },
  d: { keys: ["Cut"], mode: "NORMAL" },
  c: { keys: ["Cut"], mode: "INSERT" },
  s: { keys: ["Cut"], mode: "INSERT" },
  v: { keys: [], mode: "NORMAL", collapse: true },
  y: { keys: ["Copy"], mode: "NORMAL", collapse: "start" },
};

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);
const REPEAT_DELAY = 400;
const REPEAT_RATE = 40;

let count = 0;
let operator = null;
let hold = null;
let pending = null; // { run }: a command waiting for physical modifiers to be released
const swallowed = new Set();

function swallow(event) {
  event.preventDefault();
  event.stopPropagation();
}

function stopHold() {
  if (!hold) return;
  clearTimeout(hold.delayTimer);
  clearInterval(hold.repeatTimer);
  hold = null;
}

function startHold(code, cmd) {
  stopHold();
  const h = { code, delayTimer: null, repeatTimer: null };
  h.delayTimer = setTimeout(() => {
    h.repeatTimer = setInterval(() => runCommand(cmd, 1), REPEAT_RATE);
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

async function runCommand(cmd, n = 1) {
  if (cmd.keys.length) await send(cmd.keys, cmd.counted ? n : 1, !!cmd.shift);
  if (cmd.mode) VimMode.setMode(cmd.mode);
  if (cmd.collapse)
    collapseSelection(cmd.collapse === true ? "end" : cmd.collapse);
}

// Select with the motion, then Copy/Cut: one message, so it is atomic on the host side.
async function runOperator(op, motion, n) {
  const sel = motion
    ? Array(motion.counted ? n : 1)
        .fill(motion.keys.map((k) => "Shift+" + k))
        .flat()
    : ["Home", ...Array(n).fill("Shift+Down")]; // linewise: yy / dd / cc
  await send([...sel, ...OPERATORS[op].keys], 1, false);
  if (OPERATORS[op].mode) VimMode.setMode(OPERATORS[op].mode);
  if (OPERATORS[op].collapse) collapseSelection(OPERATORS[op].collapse);
  updateCursorOverlay(VimMode.getMode());
}

function modsDown(event) {
  const shiftMatters = VimMode.getMode() !== "VISUAL"; // visual motions add Shift anyway
  return (
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    (shiftMatters && event.shiftKey)
  );
}

// Injected modifiers would merge with physical ones, so wait until they are released.
function schedule(run, event) {
  if (modsDown(event)) pending = { run };
  else run();
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    const wasVisual = VimMode.getMode() === "VISUAL";
    stopHold();
    clearPending();
    operator = null;
    count = 0;
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

  const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
  if (
    plain &&
    (/^[1-9]$/.test(event.key) || (count > 0 && event.key === "0"))
  ) {
    count = count * 10 + Number(event.key);
    swallow(event);
    swallowed.add(event.code);
    return;
  }

  if (mode === "NORMAL" && operator) {
    swallow(event);
    swallowed.add(event.code);
    const op = operator;
    const n = count || 1;
    const combo = getKeyCombo(event);
    operator = null;
    count = 0;
    if (event.key === op && !modsDown(event)) {
      schedule(() => runOperator(op, null, n), event);
    } else if (MOTIONS.includes(combo)) {
      schedule(() => runOperator(op, NORMAL_KEYS[combo], n), event);
    } // anything else cancels the operator
    updateCursorOverlay(VimMode.getMode());
    return;
  }

  if (
    mode === "NORMAL" &&
    Object.hasOwn(OPERATORS, event.key) &&
    !modsDown(event)
  ) {
    swallow(event);
    swallowed.add(event.code);
    operator = event.key; // keep count for the motion (d3w)
    return;
  }

  const cmd = (mode === "VISUAL" ? VISUAL_KEYS : NORMAL_KEYS)[
    getKeyCombo(event)
  ];
  if (cmd) {
    swallow(event);
    swallowed.add(event.code);
    const n = count || 1;
    if (modsDown(event)) {
      pending = { run: () => runCommand(cmd, n) };
    } else {
      runCommand(cmd, n);
      if (cmd.counted) startHold(event.code, cmd);
    }
  }
  count = 0;
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

function getKeyCombo(event) {
  const modifiers = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");
  modifiers.push(event.key);
  return modifiers.join("+");
}

async function collapseSelection(to = "end") {
  await send([to === "start" ? "Left" : "Right"], 1, false);
}
