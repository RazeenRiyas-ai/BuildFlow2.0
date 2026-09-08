// Minimal fake of the `socket.io-client` default export surface realtime-client.ts actually uses
// (`io`, and the small subset of the Socket instance API: on/off/emit/connect/disconnect/connected).
// Lets tests drive connect/connect_error events deterministically with zero real network I/O and
// without adding a test framework or a real socket.io server as a dependency.

class FakeSocket {
  constructor(url, opts) {
    this.url = url;
    this.opts = opts;
    this.connected = false;
    this._listeners = new Map();
    this._emitted = [];
    this.connectCallCount = 0;
    this.disconnectCallCount = 0;
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return this;
  }

  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
    return this;
  }

  emit(event, ...args) {
    this._emitted.push({ event, args });
    return this;
  }

  connect() {
    this.connectCallCount++;
    return this;
  }

  disconnect() {
    this.disconnectCallCount++;
    this.connected = false;
    return this;
  }

  // Test-only: fires a fake server-originated event to every registered listener, simulating
  // Socket.io's own dispatch — this is how tests simulate 'connect' / 'connect_error' / 'disconnect'.
  __trigger(event, ...args) {
    if (event === 'connect') this.connected = true;
    if (event === 'disconnect') this.connected = false;
    for (const handler of [...(this._listeners.get(event) ?? [])]) handler(...args);
  }

  __listenerCount(event) {
    return this._listeners.get(event)?.size ?? 0;
  }
}

// realtime-client.ts imports `Socket` alongside `io` purely as a TypeScript type (`Socket | null`).
// Node's native type-stripping only erases type ANNOTATIONS, not import bindings — it doesn't do
// full analysis to know this identifier is type-only — so the import statement still expects a
// real runtime export named `Socket` to exist, even though nothing ever calls it as a value here.
export class Socket {}

let sockets = [];

export function io(url, opts) {
  const socket = new FakeSocket(url, opts);
  sockets.push(socket);
  return socket;
}

export function __getCreatedSockets() {
  return sockets;
}

export function __getLastSocket() {
  return sockets[sockets.length - 1];
}

export function __resetSocketIoMock() {
  sockets = [];
}
