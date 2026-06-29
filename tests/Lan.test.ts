import { describe, expect, it } from "vitest";
import { isLanHost, isLoopbackHost } from "../src/client/Lan";

describe("isLoopbackHost", () => {
  it("matches loopback names", () => {
    for (const h of ["localhost", "127.0.0.1", "::1", "[::1]", "LOCALHOST"]) {
      expect(isLoopbackHost(h)).toBe(true);
    }
  });

  it("rejects non-loopback", () => {
    for (const h of ["192.168.1.5", "example.com", "10.0.0.1"]) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });
});

describe("isLanHost", () => {
  it("treats private IPv4 ranges as LAN", () => {
    for (const h of [
      "192.168.1.42",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.1",
      "169.254.1.1",
      "127.0.0.1",
    ]) {
      expect(isLanHost(h)).toBe(true);
    }
  });

  it("treats mDNS and bare hostnames as LAN", () => {
    expect(isLanHost("my-laptop.local")).toBe(true);
    expect(isLanHost("my-laptop")).toBe(true);
    expect(isLanHost("localhost")).toBe(true);
  });

  it("does not treat public addresses as LAN", () => {
    for (const h of [
      "openfront.io",
      "api.openfront.io",
      "8.8.8.8",
      "172.32.0.1", // just outside the 172.16-31 private block
      "172.15.0.1",
      "11.0.0.1",
    ]) {
      expect(isLanHost(h)).toBe(false);
    }
  });
});
