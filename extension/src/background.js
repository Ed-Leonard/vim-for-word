// Bridges content scripts <-> native host. Works in Firefox (MV2) and Chrome (MV3).
const api = globalThis.browser ?? globalThis.chrome;
const HOST = "com.typo.vimword";

let port = null;
let nextId = 0;
const waiting = new Map(); // id -> sendResponse

function failAll(error) {
  for (const respond of waiting.values()) respond({ ok: false, error });
  waiting.clear();
}

function connect() {
  const p = api.runtime.connectNative(HOST);
  port = p;

  p.onMessage.addListener((response) => {
    const respond = waiting.get(response.id);
    if (respond) {
      waiting.delete(response.id);
      respond(response);
    }
  });

  p.onDisconnect.addListener(() => {
    const err =
      p.error?.message ?? api.runtime.lastError?.message ?? "native host disconnected";
    console.warn("[vimword]", err);
    if (port === p) port = null; // next command reconnects
    failAll(err);
  });
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "synthKey") return;
  if (!port) connect();
  const id = nextId++;
  waiting.set(id, sendResponse);
  try {
    port.postMessage({ id, keys: msg.keys, count: msg.count, shift: msg.shift });
  } catch (ex) {
    waiting.delete(id);
    sendResponse({ ok: false, error: String(ex) });
  }
  return true; // keep the channel open for the async reply (needed for Chrome)
});

connect(); // start the host eagerly so the virtual device exists before the first key
