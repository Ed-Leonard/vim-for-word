const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function load(file, globals) {
  const context = vm.createContext(globals);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../extension/src", file), "utf8"),
    context,
  );
  return context;
}

test("cursor updates coalesce and use the latest mode without reading layout", () => {
  const frames = [];
  const animation = { currentTime: 500 };
  const el = {
    style: {},
    classList: { toggle() {} },
    getAnimations: () => [animation],
    get offsetWidth() {
      assert.fail("cursor updates must not force a layout read");
    },
  };
  const context = load("overlay.js", {
    requestAnimationFrame: (fn) => frames.push(fn),
    document: { getElementById: () => el },
  });
  let measurements = 0;
  context.getCharacterRectAtCursor = () => {
    measurements++;
    return { left: 10, top: 20, width: 8, height: 16 };
  };
  context.updateCursorOverlay("NORMAL");
  context.updateCursorOverlay("VISUAL");
  context.updateCursorOverlay("INSERT");
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(el.style.display, "none");
  assert.equal(measurements, 0);
  context.updateCursorOverlay("NORMAL");
  context.updateCursorOverlay("NORMAL");
  frames.shift()();
  assert.equal(measurements, 1);
  assert.equal(el.style.left, "10px");
  assert.equal(animation.currentTime, 0);
});

test("held keys repeat at 400ms, never queue repeats, and stop on keyup", async () => {
  const requests = [];
  const timeouts = new Map();
  const intervals = new Map();
  let nextTimer = 0;
  const context = load("keys.js", {
    browser: {
      runtime: {
        sendMessage: (msg) =>
          new Promise((resolve) => requests.push({ msg, resolve })),
      },
    },
    VimMode: { getMode: () => "NORMAL" },
    updateCursorOverlay() {},
    console,
    setTimeout: (fn, ms) => {
      timeouts.set(++nextTimer, { fn, ms });
      return nextTimer;
    },
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (fn, ms) => {
      intervals.set(++nextTimer, { fn, ms });
      return nextTimer;
    },
    clearInterval: (id) => intervals.delete(id),
  });
  const event = {
    key: "j",
    code: "KeyJ",
    preventDefault() {},
    stopPropagation() {},
  };
  context.handleKeydown(event);
  assert.equal(requests.length, 1);
  requests[0].resolve({ ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  const delay = [...timeouts.values()][0];
  assert.equal(delay.ms, 400);
  delay.fn();
  assert.equal(requests.length, 2);
  const repeat = [...intervals.values()][0];
  assert.equal(repeat.ms, 40);
  repeat.fn();
  repeat.fn();
  assert.equal(requests.length, 2);
  requests[1].resolve({ ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  repeat.fn();
  assert.equal(requests.length, 3);
  context.handleKeyup(event);
  assert.equal(intervals.size, 0);
  requests[2].resolve({ ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  repeat.fn();
  assert.equal(requests.length, 3);
});

for (const [key, code, action] of [
  ["]", "BracketRight", "DownParagraph"],
  ["[", "BracketLeft", "UpParagraph"],
]) {
  test(`Ctrl+${key} dispatches before Ctrl release and starts held-key repetition`, () => {
    const requests = [];
    const timers = [];
    const context = load("keys.js", {
      browser: {
        runtime: {
          sendMessage: (msg) => {
            requests.push(msg);
            return Promise.resolve({ ok: true });
          },
        },
      },
      VimMode: { getMode: () => "NORMAL" },
      updateCursorOverlay() {},
      setTimeout: (fn, ms) => timers.push({ fn, ms }),
      clearTimeout() {},
      clearInterval() {},
      console,
    });
    const event = {
      key,
      code,
      ctrlKey: true,
      preventDefault() {},
      stopPropagation() {},
    };
    context.handleKeydown(event);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].keys[0], action);
    assert.equal(requests[0].count, 1);
    assert.equal(requests[0].shift, false);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 400);
    context.handleKeyup(event);
    context.handleKeyup({
      ...event,
      key: "Control",
      code: "ControlLeft",
      ctrlKey: false,
    });
    assert.equal(requests.length, 1);
  });
}
