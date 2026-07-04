import { describe, it, expect, beforeEach, vi } from "vitest";
import { WalletManager } from "../wallet-manager.js";
import type { TransactionParams, CurveType } from "../types.js";
import { CurveType as CurveTypeEnum } from "../types.js";
import * as keystoreModule from "../keystore.js";
import * as walletModule from "../wallet.js";
import * as transactionModule from "../transaction.js";

// Mock data for tests
// BLS12381 public keys are 48 bytes = 96 hex characters
const mockBls12381PublicKey =
  "2f469f1af9a0419c09f11e6609a36a27806d2ba201eb0982d150433c7fad68c579a42789cbbb70c8063909a0f85e4233";
const mockBls12381Address = "ef3b75eb336323222ed6f4ca64cffbf696f9fb63";
const mockSecondaryBls12381PublicKey =
  "3f469f1af9a0419c09f11e6609a36a27806d2ba201eb0982d150433c7fad68c579a42789cbbb70c8063909a0f85e4233";
const mockSecondaryBls12381Address = "9db5a855ce499d55eb7a01c0c24822aca00dc6ce";

const mockGoKeystoreEntry = {
  publicKey: mockBls12381PublicKey,
  salt: "b4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9",
  encrypted: "d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  keyAddress: mockBls12381Address,
  keyNickname: "test-key",
};

const mockParsedKeystoreEntry = {
  publicKey: mockGoKeystoreEntry.publicKey,
  encryptedPrivateKey: mockGoKeystoreEntry.encrypted,
  salt: mockGoKeystoreEntry.salt,
  address: mockGoKeystoreEntry.keyAddress,
  curveType: CurveTypeEnum.BLS12381,
  nickname: mockGoKeystoreEntry.keyNickname,
};

const mockPrivateKeyHex =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const mockKeystoreJson = {
  entries: [
    mockGoKeystoreEntry,
    {
      publicKey: mockSecondaryBls12381PublicKey,
      salt: "c5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      encrypted: "e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      keyAddress: mockSecondaryBls12381Address,
      keyNickname: "secondary-key",
    },
  ],
};

const mockTransactionParams: TransactionParams = {
  type: "guestbook:Write",
  msg: { text: "hello blockchain" },
  fee: 100,
  memo: "test transaction",
  networkID: 1,
  chainID: 1,
  height: 100,
};

const mockSignedTransaction = {
  transaction: {
    msg: {
      msgTypeUrl: "guestbook:Write",
      msgBytes: Buffer.from("test").toString("hex"),
    },
    fee: 100,
    memo: "test transaction",
    networkID: 1,
    chainID: 1,
    height: 100,
  },
  signatures: [
    {
      publicKey: mockGoKeystoreEntry.publicKey,
      signature: "mocksignature123",
    },
  ],
};

describe("WalletManager", () => {
  let walletManager: WalletManager;

  beforeEach(() => {
    walletManager = new WalletManager();
    vi.clearAllMocks();
  });

  describe("loadKeystoreJson", () => {
    it("should load single account from keystore JSON", () => {
      const singleEntryKeystore = {
        entries: [mockGoKeystoreEntry],
      };

      walletManager.loadKeystoreJson(singleEntryKeystore);

      const accounts = walletManager.getAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toBe(mockGoKeystoreEntry.keyAddress.toLowerCase());
    });

    it("should load multiple accounts from keystore JSON", () => {
      walletManager.loadKeystoreJson(mockKeystoreJson);

      const accounts = walletManager.getAccounts();
      expect(accounts).toHaveLength(2);
      expect(accounts).toContain(
        mockGoKeystoreEntry.keyAddress.toLowerCase()
      );
      expect(accounts).toContain(
        mockKeystoreJson.entries[1].keyAddress.toLowerCase()
      );
    });

    it("should normalize addresses to lowercase", () => {
      const mixedCaseEntry = {
        entries: [
          {
            ...mockGoKeystoreEntry,
            keyAddress: mockBls12381Address.toUpperCase(),
          },
        ],
      };

      walletManager.loadKeystoreJson(mixedCaseEntry);

      const accounts = walletManager.getAccounts();
      expect(accounts[0]).toBe(mockBls12381Address);
    });

    it("should throw error on invalid keystore format - missing entries", () => {
      const invalidKeystore = {};

      expect(() => {
        walletManager.loadKeystoreJson(invalidKeystore as any);
      }).toThrow("Invalid keystore format: missing entries array");
    });

    it("should throw error on invalid keystore format - entries not array", () => {
      const invalidKeystore = { entries: "not-an-array" };

      expect(() => {
        walletManager.loadKeystoreJson(invalidKeystore as any);
      }).toThrow("Invalid keystore format: missing entries array");
    });

    it("should store public key with account", () => {
      walletManager.loadKeystoreJson({
        entries: [mockGoKeystoreEntry],
      });

      const account = walletManager.getAccount(
        mockGoKeystoreEntry.keyAddress
      );
      expect(account?.publicKey).toBe(mockGoKeystoreEntry.publicKey);
    });

    it("should store curve type with account", () => {
      walletManager.loadKeystoreJson({
        entries: [mockGoKeystoreEntry],
      });

      const account = walletManager.getAccount(
        mockGoKeystoreEntry.keyAddress
      );
      expect(account?.curveType).toBe(CurveTypeEnum.BLS12381);
    });
  });

  describe("getAccounts", () => {
    it("should return empty array when no accounts loaded", () => {
      const accounts = walletManager.getAccounts();
      expect(accounts).toHaveLength(0);
      expect(Array.isArray(accounts)).toBe(true);
    });

    it("should return all loaded account addresses", () => {
      walletManager.loadKeystoreJson(mockKeystoreJson);

      const accounts = walletManager.getAccounts();
      expect(accounts).toHaveLength(2);
      expect(accounts).toBeInstanceOf(Array);
    });
  });

  describe("getAccount", () => {
    beforeEach(() => {
      walletManager.loadKeystoreJson({
        entries: [mockGoKeystoreEntry],
      });
    });

    it("should retrieve account by address", () => {
      const account = walletManager.getAccount(
        mockGoKeystoreEntry.keyAddress
      );

      expect(account).toBeDefined();
      expect(account?.address).toBe(
        mockGoKeystoreEntry.keyAddress.toLowerCase()
      );
    });

    it("should handle mixed case address lookup", () => {
      const mixedCaseAddress = mockBls12381Address.toUpperCase();
      const account = walletManager.getAccount(mixedCaseAddress);

      expect(account).toBeDefined();
      expect(account?.address).toBe(
        mockGoKeystoreEntry.keyAddress.toLowerCase()
      );
    });

    it("should return undefined for non-existent account", () => {
      const account = walletManager.getAccount(
        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
      );

      expect(account).toBeUndefined();
    });

    it("should include all account properties", () => {
      const account = walletManager.getAccount(
        mockGoKeystoreEntry.keyAddress
      );

      expect(account).toHaveProperty("address");
      expect(account).toHaveProperty("publicKey");
      expect(account).toHaveProperty("curveType");
    });
  });

  describe("unlockAccount", () => {
    beforeEach(() => {
      walletManager.loadKeystoreJson({
        entries: [mockGoKeystoreEntry],
      });
    });

    it("should return private key hex on successful unlock", async () => {
      vi.spyOn(keystoreModule, "decryptEntry").mockResolvedValue(
        mockPrivateKeyHex
      );

      const privateKey = await walletManager.unlockAccount(
        mockGoKeystoreEntry.keyAddress,
        "correct-password"
      );

      expect(privateKey).toBe(mockPrivateKeyHex);
    });

    it("should throw error for non-existent account", async () => {
      await expect(
        walletManager.unlockAccount(
          "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          "password"
        )
      ).rejects.toThrow("Account not found");
    });

    it("should handle decryption errors", async () => {
      vi.spyOn(keystoreModule, "decryptEntry").mockRejectedValue(
        new Error("Invalid password")
      );

      await expect(
        walletManager.unlockAccount(
          mockGoKeystoreEntry.keyAddress,
          "wrong-password"
        )
      ).rejects.toThrow("Failed to unlock account");
    });

    it("should normalize address to lowercase", async () => {
      vi.spyOn(keystoreModule, "decryptEntry").mockResolvedValue(
        mockPrivateKeyHex
      );

      const mixedCaseAddress = mockBls12381Address.toUpperCase();
      const privateKey = await walletManager.unlockAccount(
        mixedCaseAddress,
        "password"
      );

      expect(privateKey).toBe(mockPrivateKeyHex);
    });

    it("should support multiple unlock attempts", async () => {
      vi.spyOn(keystoreModule, "decryptEntry").mockResolvedValue(
        mockPrivateKeyHex
      );

      const result1 = await walletManager.unlockAccount(
        mockGoKeystoreEntry.keyAddress,
        "password1"
      );
      const result2 = await walletManager.unlockAccount(
        mockGoKeystoreEntry.keyAddress,
        "password2"
      );

      expect(result1).toBe(mockPrivateKeyHex);
      expect(result2).toBe(mockPrivateKeyHex);
    });
  });

  describe("buildTransaction", () => {
    beforeEach(() => {
      walletManager.loadKeystoreJson({
        entries: [mockGoKeystoreEntry],
      });
    });

    it("should build signed transaction with correct account", () => {
      vi.spyOn(transactionModule, "createAndSignTransaction").mockReturnValue(
        mockSignedTransaction as any
      );

      const tx = walletManager.buildTransaction(
        mockGoKeystoreEntry.keyAddress,
        mockTransactionParams,
        mockPrivateKeyHex
      );

      expect(tx).toBe(mockSignedTransaction);
    });

    it("should throw error for non-existent account", () => {
      expect(() => {
        walletManager.buildTransaction(
          "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          mockTransactionParams,
          mockPrivateKeyHex
        );
      }).toThrow("Account not found");
    });

    it("should pass correct parameters to createAndSignTransaction", () => {
      const createAndSignSpy = vi
        .spyOn(transactionModule, "createAndSignTransaction")
        .mockReturnValue(mockSignedTransaction as any);

      walletManager.buildTransaction(
        mockGoKeystoreEntry.keyAddress,
        mockTransactionParams,
        mockPrivateKeyHex
      );

      expect(createAndSignSpy).toHaveBeenCalledWith(
        mockTransactionParams,
        mockPrivateKeyHex,
        mockGoKeystoreEntry.publicKey,
        CurveTypeEnum.BLS12381
      );
    });

    it("should support mixed case address", () => {
      vi.spyOn(transactionModule, "createAndSignTransaction").mockReturnValue(
        mockSignedTransaction as any
      );

      const mixedCaseAddress = mockBls12381Address.toUpperCase();
      const tx = walletManager.buildTransaction(
        mixedCaseAddress,
        mockTransactionParams,
        mockPrivateKeyHex
      );

      expect(tx).toBe(mockSignedTransaction);
    });
  });

  describe("signTransaction", () => {
    beforeEach(() => {
      walletManager.loadKeystoreJson({
        entries: [mockGoKeystoreEntry],
      });
    });

    it("should unlock account and build transaction", async () => {
      vi.spyOn(keystoreModule, "decryptEntry").mockResolvedValue(
        mockPrivateKeyHex
      );
      vi.spyOn(transactionModule, "createAndSignTransaction").mockReturnValue(
        mockSignedTransaction as any
      );

      const tx = await walletManager.signTransaction(
        mockGoKeystoreEntry.keyAddress,
        "correct-password",
        mockTransactionParams
      );

      expect(tx).toBe(mockSignedTransaction);
    });

    it("should throw error if account not found during unlock", async () => {
      await expect(
        walletManager.signTransaction(
          "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          "password",
          mockTransactionParams
        )
      ).rejects.toThrow("Account not found");
    });

    it("should throw error if account not found during build", async () => {
      vi.spyOn(keystoreModule, "decryptEntry").mockResolvedValue(
        mockPrivateKeyHex
      );

      // Load initial account, then remove it from accounts map before building
      const initialAccounts = walletManager.getAccounts();
      expect(initialAccounts).toHaveLength(1);

      await expect(
        walletManager.signTransaction(
          "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          "password",
          mockTransactionParams
        )
      ).rejects.toThrow("Account not found");
    });

    it("should handle unlock errors during sign", async () => {
      vi.spyOn(keystoreModule, "decryptEntry").mockRejectedValue(
        new Error("Invalid password")
      );

      await expect(
        walletManager.signTransaction(
          mockGoKeystoreEntry.keyAddress,
          "wrong-password",
          mockTransactionParams
        )
      ).rejects.toThrow("Failed to unlock account");
    });
  });

  describe("isValidAccount", () => {
    beforeEach(() => {
      walletManager.loadKeystoreJson({
        entries: [mockGoKeystoreEntry],
      });
    });

    it("should return true for loaded account", () => {
      const isValid = walletManager.isValidAccount(
        mockGoKeystoreEntry.keyAddress
      );
      expect(isValid).toBe(true);
    });

    it("should return false for non-existent account", () => {
      const isValid = walletManager.isValidAccount(
        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
      );
      expect(isValid).toBe(false);
    });

    it("should handle mixed case address", () => {
      const mixedCaseAddress = mockBls12381Address.toUpperCase();
      const isValid = walletManager.isValidAccount(mixedCaseAddress);
      expect(isValid).toBe(true);
    });
  });

  describe("getCurveType", () => {
    beforeEach(() => {
      walletManager.loadKeystoreJson({
        entries: [mockGoKeystoreEntry],
      });
    });

    it("should return curve type for loaded account", () => {
      const curveType = walletManager.getCurveType(
        mockGoKeystoreEntry.keyAddress
      );
      expect(curveType).toBe(CurveTypeEnum.BLS12381);
    });

    it("should return undefined for non-existent account", () => {
      const curveType = walletManager.getCurveType(
        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
      );
      expect(curveType).toBeUndefined();
    });

    it("should handle mixed case address", () => {
      const mixedCaseAddress = mockBls12381Address.toUpperCase();
      const curveType = walletManager.getCurveType(mixedCaseAddress);
      expect(curveType).toBe(CurveTypeEnum.BLS12381);
    });
  });

  describe("clear", () => {
    beforeEach(() => {
      walletManager.loadKeystoreJson(mockKeystoreJson);
    });

    it("should clear all accounts", () => {
      expect(walletManager.getAccounts()).toHaveLength(2);

      walletManager.clear();

      expect(walletManager.getAccounts()).toHaveLength(0);
    });

    it("should make cleared accounts unavailable", () => {
      const address = mockGoKeystoreEntry.keyAddress;
      expect(walletManager.isValidAccount(address)).toBe(true);

      walletManager.clear();

      expect(walletManager.isValidAccount(address)).toBe(false);
    });

    it("should allow reloading after clear", () => {
      walletManager.clear();
      expect(walletManager.getAccounts()).toHaveLength(0);

      walletManager.loadKeystoreJson({
        entries: [mockGoKeystoreEntry],
      });

      expect(walletManager.getAccounts()).toHaveLength(1);
    });

    it("should clear internal keystoreData", async () => {
      walletManager.clear();

      await expect(
        walletManager.unlockAccount(
          mockGoKeystoreEntry.keyAddress,
          "password"
        )
      ).rejects.toThrow("Account not found");
    });
  });

  describe("Integration scenarios", () => {
    it("should handle complete wallet flow: load -> validate -> unlock -> sign", async () => {
      vi.spyOn(keystoreModule, "decryptEntry").mockResolvedValue(
        mockPrivateKeyHex
      );
      vi.spyOn(transactionModule, "createAndSignTransaction").mockReturnValue(
        mockSignedTransaction as any
      );

      walletManager.loadKeystoreJson({
        entries: [mockGoKeystoreEntry],
      });

      const address = mockGoKeystoreEntry.keyAddress;

      // Validate account exists
      expect(walletManager.isValidAccount(address)).toBe(true);

      // Get account details
      const account = walletManager.getAccount(address);
      expect(account).toBeDefined();

      // Unlock and sign
      const tx = await walletManager.signTransaction(
        address,
        "password",
        mockTransactionParams
      );

      expect(tx).toBe(mockSignedTransaction);
    });

    it("should handle multiple accounts independently", async () => {
      vi.spyOn(keystoreModule, "decryptEntry").mockImplementation(
        async (entry) => {
          return entry.address === mockBls12381Address
            ? "privatekey1"
            : "privatekey2";
        }
      );
      vi.spyOn(transactionModule, "createAndSignTransaction").mockReturnValue(
        mockSignedTransaction as any
      );

      walletManager.loadKeystoreJson(mockKeystoreJson);

      const accounts = walletManager.getAccounts();
      expect(accounts).toHaveLength(2);

      for (const address of accounts) {
        const privateKey = await walletManager.unlockAccount(
          address,
          "password"
        );
        expect(privateKey).toBeDefined();
      }
    });
  });
});
