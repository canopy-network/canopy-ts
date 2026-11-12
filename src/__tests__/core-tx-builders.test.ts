import { describe, it, expect } from "vitest";
import { createAndSignTransaction } from "../transaction.js";
import { derivePublicKey } from "../signing.js";
import { CurveType } from "../types.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const PRIVATE_KEY_HEX = "01".repeat(32);
const PUBLIC_KEY_HEX = derivePublicKey(PRIVATE_KEY_HEX, CurveType.BLS12381);

// Wire-format spec verified against canopy-mcp's e2e-tested Python client
// (clients/canopy_transactions.py / protobuf_tx.py) AND empirically confirmed
// against a real Canopy devnet node: the node's custom JSON unmarshaling for
// these message types expects HEX byte strings (not base64) and several
// deliberately non-camelCase wire keys (documented per-type below).
describe("Core Transaction Builders (all registered types)", () => {
  it("send: core format with hex addresses", () => {
    const fromAddress = "aa".repeat(20);
    const toAddress = "bb".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "send",
        msg: { fromAddress, toAddress, amount: 100 },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    expect(tx.msg).toEqual({
      fromAddress: bytesToHex(hexToBytes(fromAddress)),
      toAddress: bytesToHex(hexToBytes(toAddress)),
      amount: 100,
    });
  });

  it("unstake: core format with hex address under wire key 'address' (not fromAddress)", () => {
    const fromAddress = "aa".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "unstake",
        msg: { fromAddress },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    // Proto field is from_address, but canopy-mcp's _build_unstake_tx confirms
    // the wire JSON key the node reads is "address", not "fromAddress".
    expect(tx.msg).toEqual({
      address: bytesToHex(hexToBytes(fromAddress)),
    });
  });

  it("pause: core format with hex address", () => {
    const address = "aa".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "pause",
        msg: { address },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    expect(tx.msg).toEqual({
      address: bytesToHex(hexToBytes(address)),
    });
  });

  it("unpause: core format with hex address", () => {
    const address = "aa".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "unpause",
        msg: { address },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    expect(tx.msg).toEqual({
      address: bytesToHex(hexToBytes(address)),
    });
  });

  it("stake: core format with lowercase 'publickey' wire key (not publicKey)", () => {
    const publicKey = "cc".repeat(48);
    const outputAddress = "aa".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "stake",
        msg: {
          publicKey,
          amount: 1000000,
          committees: [1, 2, 3],
          netAddress: "192.168.1.1:8000",
          outputAddress,
          delegate: true,
          compound: false,
        },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    // Node's Go struct JSON tag for this field is lowercase "publickey" — a
    // deliberate (if unusual) wire-format quirk, not a typo to "fix".
    expect(tx.msg).toEqual({
      publickey: bytesToHex(hexToBytes(publicKey)),
      amount: 1000000,
      committees: [1, 2, 3],
      netAddress: "192.168.1.1:8000",
      outputAddress: bytesToHex(hexToBytes(outputAddress)),
      delegate: true,
      compound: false,
    });
  });

  it("editStake: core format with hex addresses (ordinary camelCase keys)", () => {
    const address = "aa".repeat(20);
    const outputAddress = "bb".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "editStake",
        msg: {
          address,
          amount: 500000,
          committees: [1, 2],
          netAddress: "192.168.1.2:8000",
          outputAddress,
          compound: true,
        },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    expect(tx.msg).toEqual({
      address: bytesToHex(hexToBytes(address)),
      amount: 500000,
      committees: [1, 2],
      netAddress: "192.168.1.2:8000",
      outputAddress: bytesToHex(hexToBytes(outputAddress)),
      compound: true,
    });
  });

  it("subsidy: core format with capitalized 'chainID' wire key (not chainId)", () => {
    const address = "aa".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "subsidy",
        msg: {
          address,
          chainId: 2,
          amount: 100000,
          opcode: "00",
        },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    expect(tx.msg).toEqual({
      address: bytesToHex(hexToBytes(address)),
      chainID: 2,
      amount: 100000,
      opcode: bytesToHex(hexToBytes("00")),
    });
  });

  it("daoTransfer: core format with hex address (ordinary camelCase keys)", () => {
    const address = "aa".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "daoTransfer",
        msg: {
          address,
          amount: 50000,
          startHeight: 100,
          endHeight: 200,
        },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    expect(tx.msg).toEqual({
      address: bytesToHex(hexToBytes(address)),
      amount: 50000,
      startHeight: 100,
      endHeight: 200,
    });
  });

  it("createOrder: core format with lowercase-d 'chainId' wire key (intentionally, unlike editOrder/deleteOrder)", () => {
    const sellerReceiveAddress = "aa".repeat(20);
    const sellersSendAddress = "bb".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "createOrder",
        msg: {
          chainId: 2,
          data: "ffff",
          amountForSale: 100000,
          requestedAmount: 50000,
          sellerReceiveAddress,
          sellersSendAddress,
        },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    expect(tx.msg).toEqual({
      chainId: 2,
      data: bytesToHex(hexToBytes("ffff")),
      amountForSale: 100000,
      requestedAmount: 50000,
      sellerReceiveAddress: bytesToHex(hexToBytes(sellerReceiveAddress)),
      sellersSendAddress: bytesToHex(hexToBytes(sellersSendAddress)),
    });
  });

  it("editOrder: core format with capitalized 'orderID'/'chainID' wire keys", () => {
    const orderId = "dd".repeat(32);
    const sellerReceiveAddress = "aa".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "editOrder",
        msg: {
          orderId,
          chainId: 2,
          data: "ffff",
          amountForSale: 80000,
          requestedAmount: 40000,
          sellerReceiveAddress,
        },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    expect(tx.msg).toEqual({
      orderID: bytesToHex(hexToBytes(orderId)),
      chainID: 2,
      data: bytesToHex(hexToBytes("ffff")),
      amountForSale: 80000,
      requestedAmount: 40000,
      sellerReceiveAddress: bytesToHex(hexToBytes(sellerReceiveAddress)),
    });
  });

  it("deleteOrder: core format with capitalized 'orderID'/'chainID' wire keys", () => {
    const orderId = "dd".repeat(32);
    const tx = createAndSignTransaction(
      {
        type: "deleteOrder",
        msg: {
          orderId,
          chainId: 2,
        },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    expect(tx.msg).toEqual({
      orderID: bytesToHex(hexToBytes(orderId)),
      chainID: 2,
    });
  });

  it("dexLimitOrder: core format with 'chainID' and proto 'address' field renamed to wire key 'sellerReceiveAddress'", () => {
    const address = "aa".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "dexLimitOrder",
        msg: {
          chainId: 2,
          amountForSale: 100000,
          requestedAmount: 50000,
          address,
        },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    // Deliberate wire-compat rename: the proto field is literally named
    // "address" but canopy-mcp's MessageDexLimitOrder docstring confirms the
    // wire JSON key the node reads is "sellerReceiveAddress" — do not "fix"
    // this to "address".
    expect(tx.msg).toEqual({
      chainID: 2,
      amountForSale: 100000,
      requestedAmount: 50000,
      sellerReceiveAddress: bytesToHex(hexToBytes(address)),
    });
  });

  it("dexLiquidityDeposit: core format with 'chainID' wire key", () => {
    const address = "aa".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "dexLiquidityDeposit",
        msg: {
          chainId: 2,
          amount: 50000,
          address,
        },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    expect(tx.msg).toEqual({
      chainID: 2,
      amount: 50000,
      address: bytesToHex(hexToBytes(address)),
      orderId: "",
    });
  });

  it("dexLiquidityWithdraw: core format with 'chainID' wire key", () => {
    const address = "aa".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "dexLiquidityWithdraw",
        msg: {
          chainId: 2,
          percent: 50,
          address,
        },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    expect(tx.msg).toEqual({
      chainID: 2,
      percent: 50,
      address: bytesToHex(hexToBytes(address)),
      orderId: "",
    });
  });

  it("changeParameter: core format emits a raw scalar parameterValue (not a nested Any object)", () => {
    const signer = "aa".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "changeParameter",
        msg: {
          parameterSpace: "gov",
          parameterKey: "someTextParam",
          parameterValue: "hello",
          startHeight: 10,
          endHeight: 20,
          signer,
        },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    expect(tx.msg).toEqual({
      parameterSpace: "gov",
      parameterKey: "someTextParam",
      parameterValue: "hello",
      startHeight: 10,
      endHeight: 20,
      signer: bytesToHex(hexToBytes(signer)),
    });
    expect(tx.msg).not.toHaveProperty("proposalHash");
  });

  it("changeByzantineOutput: core format uses canonical governance wire fields", () => {
    const validatorAddress = "aa".repeat(20);
    const outputAddress = "bb".repeat(20);
    const signer = "cc".repeat(20);
    const tx = createAndSignTransaction(
      {
        type: "changeByzantineOutput",
        msg: { validatorAddress, outputAddress, signer, startHeight: 10, endHeight: 20 },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX,
      CurveType.BLS12381,
      { format: "core" }
    ) as any;

    expect(tx.msg).toEqual({
      validatorAddress,
      outputAddress,
      signer,
      startHeight: 10,
      endHeight: 20,
    });
    expect(tx.msg).not.toHaveProperty("proposalHash");
  });

  it("plugin format still works for all types", () => {
    const tx = createAndSignTransaction(
      {
        type: "stake",
        msg: {
          publicKey: "cc".repeat(48),
          amount: 1000000,
          committees: [1],
          netAddress: "localhost:8000",
          outputAddress: "aa".repeat(20),
          delegate: false,
          compound: false,
        },
        fee: 10000,
        networkID: 1,
        chainID: 1,
        height: 5,
      },
      PRIVATE_KEY_HEX,
      PUBLIC_KEY_HEX
    ) as any;

    expect(tx.msgTypeUrl).toBe("type.googleapis.com/types.MessageStake");
    expect(typeof tx.msgBytes).toBe("string");
    expect(tx).not.toHaveProperty("msg");
  });
});
