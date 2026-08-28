/**
 * Wallet state for the guestbook.
 *
 * Keys are generated in the browser, encrypted with the user's password, and persisted to
 * localStorage. The decrypted private key exists only in this hook's memory, only while the wallet
 * is unlocked, and is never written to storage, logged, or rendered.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { WalletManager } from "@canopynetwork/canopy-ts/wallet-manager";
import { encryptKeyEntry } from "@canopynetwork/canopy-ts/keystore";
import { CurveType, deriveAddress, derivePublicKey } from "@canopynetwork/canopy-ts/crypto";
import type { ParsedKeystoreEntry } from "@canopynetwork/canopy-ts/keystore";
import { listStoredEntries, localKeystoreStorage } from "../lib/storage.js";
import type { Signer } from "../lib/guestbook.js";

export interface StoredAccount {
  address: string;
  nickname: string;
}

export interface WalletState {
  accounts: StoredAccount[];
  /** The unlocked signer, or null while locked. Holds the private key in memory only. */
  signer: Signer | null;
  busy: boolean;
  error: string | null;
  createWallet(nickname: string, password: string): Promise<void>;
  importPrivateKey(privateKeyHex: string, nickname: string, password: string): Promise<void>;
  unlock(address: string, password: string): Promise<void>;
  lock(): void;
  forget(address: string): void;
  clearError(): void;
}

function toStoredAccount(entry: ParsedKeystoreEntry): StoredAccount {
  return { address: entry.address, nickname: entry.nickname || entry.address.slice(0, 8) };
}

export function useWallet(): WalletState {
  // WalletManager is constructed once and given the localStorage adapter. We deliberately do not
  // call loadAccounts(), which would also query the node's ADMIN RPC keystore — this dApp is
  // browser-only and has no business reaching for a node operator's keys.
  const manager = useMemo(() => new WalletManager({ storage: localKeystoreStorage }), []);
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // seed the manager's in-memory cache from storage so unlock() can find the entries
  useEffect(() => {
    const entries = listStoredEntries();
    for (const entry of entries) manager.importEntry(entry);
    setAccounts(entries.map(toStoredAccount));
  }, [manager]);

  const refresh = useCallback(() => {
    setAccounts(listStoredEntries().map(toStoredAccount));
  }, []);

  /** Run an async wallet action with shared busy/error handling. */
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const createWallet = useCallback(
    (nickname: string, password: string) =>
      run(async () => {
        if (!password) throw new Error("Choose a password — it encrypts the key in this browser.");
        const unlocked = await manager.createWallet(nickname || "guestbook", password);
        setSigner(unlocked);
        refresh();
      }),
    [manager, refresh, run],
  );

  const importPrivateKey = useCallback(
    (privateKeyHex: string, nickname: string, password: string) =>
      run(async () => {
        if (!password) throw new Error("Choose a password — it encrypts the key in this browser.");
        const key = privateKeyHex.trim().replace(/^0x/i, "").toLowerCase();
        // generateKeyPair() produces ed25519, and that is what this app imports: a 32-byte seed
        if (!/^[0-9a-f]{64}$/.test(key)) {
          throw new Error("Expected a 64-character hex ed25519 private key.");
        }
        const publicKeyHex = derivePublicKey(key, CurveType.ED25519);
        const address = deriveAddress(publicKeyHex, CurveType.ED25519);
        const entry = await encryptKeyEntry(
          { privateKeyHex: key, publicKeyHex, address, curveType: CurveType.ED25519, nickname },
          password,
        );
        manager.importEntry(entry);
        setSigner({ address, publicKeyHex, privateKeyHex: key, curveType: CurveType.ED25519 });
        refresh();
      }),
    [manager, refresh, run],
  );

  const unlock = useCallback(
    (address: string, password: string) =>
      run(async () => {
        const unlocked = await manager.unlock(address, password);
        setSigner(unlocked);
      }),
    [manager, run],
  );

  const lock = useCallback(() => {
    setSigner(null);
    setError(null);
  }, []);

  const forget = useCallback(
    (address: string) => {
      localKeystoreStorage.remove(address);
      if (signer?.address.toLowerCase() === address.toLowerCase()) setSigner(null);
      refresh();
    },
    [refresh, signer],
  );

  const clearError = useCallback(() => setError(null), []);

  return { accounts, signer, busy, error, createWallet, importPrivateKey, unlock, lock, forget, clearError };
}
