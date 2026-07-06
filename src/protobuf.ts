import protobuf from "protobufjs";
import { hexToBytes } from "@noble/hashes/utils.js";

function assertUint64Field(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function shouldOmit(value: any): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string" && value === "") return true;
  if (value instanceof Uint8Array && value.length === 0) return true;
  if (typeof value === "number" && value === 0) return true;
  if (typeof value === "boolean" && !value) return true;
  return Array.isArray(value) && value.length === 0;
}

const root = protobuf.Root.fromJSON({
  nested: {
    types: {
      nested: {
        Transaction: {
          fields: {
            message_type: { type: "string", id: 1 },
            msg: { type: "google.protobuf.Any", id: 2 },
            signature: { type: "Signature", id: 3 },
            created_height: { type: "uint64", id: 4 },
            time: { type: "uint64", id: 5 },
            fee: { type: "uint64", id: 6 },
            memo: { type: "string", id: 7 },
            network_id: { type: "uint64", id: 8 },
            chain_id: { type: "uint64", id: 9 },
          },
        },
        Signature: {
          fields: {
            public_key: { type: "bytes", id: 1 },
            signature: { type: "bytes", id: 2 },
          },
        },
        MessageSend: {
          fields: {
            from_address: { type: "bytes", id: 1 },
            to_address: { type: "bytes", id: 2 },
            amount: { type: "uint64", id: 3 },
          },
        },
      },
    },
    google: {
      nested: {
        protobuf: {
          nested: {
            Any: {
              fields: {
                type_url: { type: "string", id: 1 },
                value: { type: "bytes", id: 2 },
              },
            },
          },
        },
      },
    },
  },
});

const Transaction = root.lookupType("types.Transaction");
const MsgSend = root.lookupType("types.MessageSend");

// Message type registry: tx type -> { typeName, encoder }
const MESSAGE_REGISTRY: Record<
  string,
  { typeName: string; encode: (msg: any) => Uint8Array }
> = {
  send: {
    typeName: "types.MessageSend",
    encode: (msg) =>
      MsgSend.encode(
        MsgSend.create({
          from_address: hexToBytes(msg.fromAddress),
          to_address: hexToBytes(msg.toAddress),
          amount: assertUint64Field("amount", msg.amount),
        })
      ).finish(),
  },
};

/**
 * Register a custom message type for plugin transactions.
 * Call this at app startup to add plugin-specific message types.
 */
export function registerMessageType(
  txType: string,
  typeName: string,
  encode: (msg: any) => Uint8Array
) {
  MESSAGE_REGISTRY[txType] = { typeName, encode };
}

const encoderCache = new Map<string, protobuf.Type>();

/**
 * Helper to define a protobuf message type and return an encoder.
 * Provide a stable typeName to enable caching — recommended for all call sites.
 * If omitted, a fingerprint of the field definitions is used as the cache key.
 */
export function createProtobufEncoder(
  fields: Record<string, { type: string; id: number; rule?: string; options?: any }>,
  typeName?: string
): protobuf.Type {
  const key = typeName ?? JSON.stringify(Object.entries(fields).sort());
  const cached = encoderCache.get(key);
  if (cached) return cached;
  const name = typeName ?? "DynamicMsg_" + encoderCache.size;
  const msgType = new protobuf.Type(name);
  for (const [fieldName, field] of Object.entries(fields)) {
    msgType.add(new protobuf.Field(fieldName, field.id, field.type, field.rule, undefined, field.options));
  }
  root.add(msgType);
  encoderCache.set(key, msgType);
  return msgType;
}

/**
 * Get canonical sign bytes for a transaction (protobuf-encoded, no signature).
 * Must match Go's crypto.GetSignBytes() exactly.
 */
export function getSignBytesProtobuf(tx: {
  type: string;
  msg: any;
  time: number;
  createdHeight: number;
  fee: number;
  memo?: string;
  networkID: number;
  chainID: number;
}): Uint8Array {
  const entry = MESSAGE_REGISTRY[tx.type];
  if (!entry) throw new Error(`Unknown message type: ${tx.type}`);

  const msgBytes = entry.encode(tx.msg);
  const anyMsg = {
    type_url: `type.googleapis.com/${entry.typeName}`,
    value: msgBytes,
  };

  const transactionData: any = {
    message_type: tx.type,
    msg: anyMsg,
    signature: null,
    created_height: tx.createdHeight,
    time: tx.time,
    fee: tx.fee,
    network_id: tx.networkID,
    chain_id: tx.chainID,
  };

  if (!shouldOmit(tx.memo)) {
    transactionData.memo = tx.memo;
  }

  return Transaction.encode(Transaction.create(transactionData)).finish();
}

/**
 * Encode a message to protobuf bytes + get its type URL.
 * Used for building the msgTypeUrl/msgBytes tx format.
 */
export function encodeMessage(
  txType: string,
  msg: any
): { typeUrl: string; msgBytes: Uint8Array } {
  const entry = MESSAGE_REGISTRY[txType];
  if (!entry) throw new Error(`Unknown message type: ${txType}`);

  return {
    typeUrl: `type.googleapis.com/${entry.typeName}`,
    msgBytes: entry.encode(msg),
  };
}
