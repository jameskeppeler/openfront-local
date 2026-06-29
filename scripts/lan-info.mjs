#!/usr/bin/env node
// Prints a "share this URL" banner for LAN multiplayer, then (once the dev
// server is up) opens the host's browser straight to the LAN address so the
// in-game share link is correct. Run alongside `npm run dev:host` — see the
// `lan` npm script.

import { exec } from "node:child_process";
import { networkInterfaces } from "node:os";

const PORT = Number(process.env.LAN_PORT ?? 9000);

function lanAddresses() {
  const out = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      const isIpv4 = iface.family === "IPv4" || iface.family === 4;
      if (isIpv4 && !iface.internal) out.push(iface.address);
    }
  }
  const rank = (ip) =>
    ip.startsWith("192.168.")
      ? 0
      : ip.startsWith("10.")
        ? 1
        : ip.startsWith("172.")
          ? 2
          : 3;
  return out.sort((a, b) => rank(a) - rank(b));
}

function banner(urls) {
  const lines = [
    "",
    "  ╔══════════════════════════════════════════════════════════╗",
    "  ║                OpenFront — LAN multiplayer                ║",
    "  ╚══════════════════════════════════════════════════════════╝",
    "",
  ];
  if (urls.length === 0) {
    lines.push(
      "  No LAN address detected. Connect to Wi-Fi/Ethernet and restart.",
      `  You can still play locally at http://localhost:${PORT}`,
    );
  } else {
    lines.push("  Tell friends on the same Wi-Fi / network to open:");
    lines.push("");
    for (const url of urls) lines.push(`      [36m${url}[0m`);
    lines.push("");
    lines.push(
      "  Then click “LAN Game” → “Host” to start a lobby (add AI bots),",
    );
    lines.push("  and share the lobby link the host screen shows.");
  }
  lines.push("");
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? `open "${url}"`
      : platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function waitForServer(url, attempts = 120) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok || res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

const addrs = lanAddresses();
const urls = addrs.map((ip) => `http://${ip}:${PORT}`);
banner(urls);

if (process.env.SKIP_BROWSER_OPEN !== "true") {
  const localUrl = `http://localhost:${PORT}`;
  const target = urls[0] ?? localUrl;
  waitForServer(localUrl).then((up) => {
    if (up) openBrowser(target);
  });
}
