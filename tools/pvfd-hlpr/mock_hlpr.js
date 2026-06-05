#!/usr/bin/env node
// Mock HLPR server for Windows/macOS-side PVFD testing.
//
// Streams synthetic protocol-v1 frames at 30 Hz so the PVFD theme's HLPR
// bridge can be exercised end-to-end without a real PipeWire stack. Run on
// the same machine as Spotify; spoof the Linux UA in DevTools so PVFD enters
// the HLPR path, then click PULSE -> Yes.
//
// Usage:
//   npm i ws
//   node mock_hlpr.js                 # default port 17455
//   node mock_hlpr.js --port 17455
//   node mock_hlpr.js --bad-protocol  # simulate version-mismatch path
//
// The synthetic spectrum is a moving sweep + a slow LFO on the low bands, so
// the logo bars and glow visibly animate.

const { WebSocketServer } = require("ws");

const args = process.argv.slice(2);
let port = Number(process.env.PVFD_HLPR_PORT || 17455);
let badProtocol = false;
for (let i = 0; i < args.length; i++) {
  if ((args[i] === "--port" || args[i] === "-p") && args[i + 1]) {
    port = Number(args[++i]);
  } else if (args[i] === "--bad-protocol") {
    badProtocol = true;
  }
}

const FFT_SIZE = 2048;
const BIN_COUNT = FFT_SIZE / 2;
const FRAME_MS = 33;
const PROTOCOL_VERSION = badProtocol ? 99 : 1;

const wss = new WebSocketServer({ host: "127.0.0.1", port });
wss.on("listening", () => {
  console.log(`[mock-hlpr] listening on ws://127.0.0.1:${port} (protocol v${PROTOCOL_VERSION}${badProtocol ? " — INTENTIONAL MISMATCH" : ""})`);
});
wss.on("error", (err) => {
  console.error("[mock-hlpr] server error:", err.message);
});

wss.on("connection", (ws, req) => {
  const peer = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
  console.log(`[mock-hlpr] client connected: ${peer}`);
  ws.send(JSON.stringify({
    type: "hello",
    version: "0.1.0-mock",
    protocol: PROTOCOL_VERSION,
    sampleRate: 48000,
    fftSize: FFT_SIZE,
    binCount: BIN_COUNT,
    minDb: -100,
    maxDb: -30,
    mock: true,
  }));

  const start = Date.now();
  const buf = Buffer.alloc(BIN_COUNT);

  const timer = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    const t = (Date.now() - start) / 1000;
    const sweepCenter = ((Math.sin(t * 0.6) + 1) * 0.5) * BIN_COUNT;
    const lfo = 0.5 + 0.5 * Math.sin(t * 4.0); // bass pulse
    for (let i = 0; i < BIN_COUNT; i++) {
      const dist = Math.abs(i - sweepCenter) / 60;
      const sweep = Math.exp(-dist * dist) * 220;
      const lowBump = i < 40 ? lfo * 200 * Math.exp(-i / 25) : 0;
      const noise = Math.random() * 18;
      const value = Math.max(0, Math.min(255, Math.round(sweep + lowBump + noise + 15)));
      buf[i] = value;
    }
    ws.send(buf);
  }, FRAME_MS);

  ws.on("close", () => {
    clearInterval(timer);
    console.log(`[mock-hlpr] client disconnected: ${peer}`);
  });
  ws.on("error", (err) => {
    console.warn(`[mock-hlpr] client error: ${err.message}`);
  });
});

process.on("SIGINT", () => {
  console.log("\n[mock-hlpr] shutting down");
  wss.close(() => process.exit(0));
});
