import { afterEach, describe, expect, it, vi } from "vitest";
import { PortalTransport } from "../transport.js";

type MessageListener = (event: MessageEvent) => void;

function installWindow() {
  let listener: MessageListener | null = null;
  const fakeWindow = {
    addEventListener: vi.fn((type: string, cb: MessageListener) => {
      if (type === "message") listener = cb;
    }),
    removeEventListener: vi.fn((type: string, cb: MessageListener) => {
      if (type === "message" && listener === cb) listener = null;
    }),
    parent: { postMessage: vi.fn() },
    location: { origin: "https://plugin.example" },
  };
  vi.stubGlobal("window", fakeWindow);
  return {
    listener: () => {
      if (!listener) throw new Error("message listener was not registered");
      return listener;
    },
    fakeWindow,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PortalTransport", () => {
  it("ignores messages from unexpected origins", () => {
    const { listener } = installWindow();
    const transport = new PortalTransport("https://parent.example");
    const onOpen = vi.fn();
    const onMessage = vi.fn();
    transport.onOpen = onOpen;
    transport.onMessage = onMessage;

    transport.connect();
    listener()({ origin: "https://evil.example", data: { type: "ws:open" } } as MessageEvent);
    listener()({
      origin: "https://evil.example",
      data: { type: "ws:message", payload: { ok: false } },
    } as MessageEvent);

    expect(transport.connected).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("accepts messages from the configured parent origin", () => {
    const { listener } = installWindow();
    const transport = new PortalTransport("https://parent.example");
    const onOpen = vi.fn();
    const onMessage = vi.fn();
    transport.onOpen = onOpen;
    transport.onMessage = onMessage;

    transport.connect();
    listener()({ origin: "https://parent.example", data: { type: "ws:open" } } as MessageEvent);
    listener()({
      origin: "https://parent.example",
      data: { type: "ws:message", payload: { ok: true } },
    } as MessageEvent);

    expect(transport.connected).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ ok: true });
  });
});