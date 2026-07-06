import { hexToBytes } from "@noble/hashes/utils.js";
import { signMessage } from "./signing.js";
import { CurveType } from "./types.js";
import { TransportError } from "./errors.js";

export interface GameTransport {
  connect(): void;
  disconnect(): void;
  send(msg: object): void;
  sendBinary(data: ArrayBuffer): void;
  onMessage: ((msg: unknown) => void) | null;
  onBinary: ((data: ArrayBuffer) => void) | null;
  onOpen: (() => void) | null;
  onClose: (() => void) | null;
  readonly connected: boolean;
}

export interface DirectTransportConfig {
  publicKeyHex: string;
  privateKeyHex: string;
  curveType: CurveType;
  wsUrl?: string;
  /** Initial reconnect backoff in ms (doubles each attempt). Default 1000. */
  reconnectBaseDelayMs?: number;
  /** Upper bound on reconnect backoff in ms. Default 30000. */
  reconnectMaxDelayMs?: number;
}

export class DirectTransport implements GameTransport {
  onMessage: ((msg: unknown) => void) | null = null;
  onBinary: ((data: ArrayBuffer) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;

  private _connected = false;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number;
  private shouldReconnect = false;
  private authenticated = false;

  private readonly publicKeyHex: string;
  private readonly privateKeyHex: string;
  private readonly curveType: CurveType;
  private readonly wsUrl: string;
  private readonly reconnectBaseDelay: number;
  private readonly reconnectMaxDelay: number;

  constructor(config: DirectTransportConfig) {
    this.publicKeyHex = config.publicKeyHex;
    this.privateKeyHex = config.privateKeyHex;
    this.curveType = config.curveType;
    this.wsUrl = config.wsUrl ?? "ws://localhost:36660/ws";
    this.reconnectBaseDelay = config.reconnectBaseDelayMs ?? 1000;
    this.reconnectMaxDelay = config.reconnectMaxDelayMs ?? 30000;
    this.reconnectDelay = this.reconnectBaseDelay;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.openSocket();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(msg: object): void {
    if (!this.ws || !this._connected) {
      throw new TransportError("WebSocket not connected");
    }
    this.ws.send(JSON.stringify(msg));
  }

  sendBinary(data: ArrayBuffer): void {
    if (!this.ws || !this._connected) {
      throw new TransportError("WebSocket not connected");
    }
    this.ws.send(data);
  }

  private openSocket(): void {
    const ws = new WebSocket(this.wsUrl);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.authenticated = false;

    ws.onopen = () => {
      // Reset backoff on successful connection
      this.reconnectDelay = this.reconnectBaseDelay;
    };

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        this.onBinary?.(event.data);
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        return;
      }

      // Note: the plugin WS server (sdk/go/ws/ws.go) does not implement
      // challenge-response auth. This block is dead code in the current plugin
      // context but is retained for forward compatibility.
      if (
        !this.authenticated &&
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as Record<string, unknown>).type === "challenge"
      ) {
        const nonce = (parsed as Record<string, unknown>).nonce;
        if (typeof nonce !== "string") return;
        const nonceBytes = hexToBytes(nonce);
        const signatureHex = signMessage(
          nonceBytes,
          this.privateKeyHex,
          this.curveType,
        );
        ws.send(
          JSON.stringify({
            type: "response",
            public_key: this.publicKeyHex,
            signature: signatureHex,
          }),
        );
        // Do not call markConnected() here — wait for server confirmation.
        return;
      }

      if (
        !this.authenticated &&
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as Record<string, unknown>).type === "authenticated"
      ) {
        this.markConnected();
        return;
      }

      // Server didn't require auth — mark connected on first data message
      // (preserves backward compat with servers that don't do auth).
      if (!this.authenticated) {
        this.markConnected();
      }

      this.onMessage?.(parsed);
    };

    ws.onclose = () => {
      const wasConnected = this._connected;
      this._connected = false;
      this.authenticated = false;
      if (wasConnected) {
        this.onClose?.();
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires after onerror, reconnect handled there
    };
  }

  private markConnected(): void {
    this.authenticated = true;
    this._connected = true;
    this.onOpen?.();
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    // jitter: ±20% of current delay to spread reconnect storms
    const jitter = this.reconnectDelay * 0.2 * (2 * Math.random() - 1);
    const delay = Math.round(this.reconnectDelay + jitter);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.reconnectMaxDelay);
  }
}

export class PortalTransport implements GameTransport {
  onMessage: ((msg: any) => void) | null = null;
  onBinary: ((data: ArrayBuffer) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;

  private _connected = false;
  private listener: ((event: MessageEvent) => void) | null = null;
  private readonly parentOrigin: string;

  constructor(parentOrigin = window.location.origin) {
    this.parentOrigin = parentOrigin;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    this.listener = (event: MessageEvent) => {
      if (this.parentOrigin !== "*" && event.origin !== this.parentOrigin) return;
      const data = event.data;
      if (!data || typeof data.type !== "string") return;

      switch (data.type) {
        case "ws:message":
          this.onMessage?.(data.payload);
          break;
        case "ws:binary":
          this.onBinary?.(data.payload);
          break;
        case "ws:open":
          this._connected = true;
          this.onOpen?.();
          break;
        case "ws:close":
          this._connected = false;
          this.onClose?.();
          break;
      }
    };
    window.addEventListener("message", this.listener);
    window.parent.postMessage({ type: "ws:ready" }, this.parentOrigin);
  }

  disconnect(): void {
    window.parent.postMessage({ type: "ws:close" }, this.parentOrigin);
    if (this.listener) {
      window.removeEventListener("message", this.listener);
      this.listener = null;
    }
    this._connected = false;
  }

  send(msg: object): void {
    window.parent.postMessage({ type: "ws:send", payload: msg }, this.parentOrigin);
  }

  sendBinary(data: ArrayBuffer): void {
    window.parent.postMessage({ type: "ws:send-binary", payload: data }, this.parentOrigin);
  }
}

export function createTransport(
  signer?: DirectTransportConfig,
  parentOrigin?: string,
): GameTransport {
  if (typeof window !== "undefined" && window.parent !== window) {
    return new PortalTransport(parentOrigin);
  }
  if (!signer) {
    throw new TransportError(
      "DirectTransportConfig is required when not running inside an iframe",
    );
  }
  return new DirectTransport(signer);
}
