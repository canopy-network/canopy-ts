/**
 * Browser-backed keystore storage for WalletManager.
 *
 * WalletManager takes an injectable `KeystoreStorage`, which is what lets the wallet live entirely
 * in the browser with no backend. Entries stored here hold the ENCRYPTED private key plus its
 * salt — never the plaintext key — so a password is still required to sign anything.
 */
import type { ParsedKeystoreEntry } from "@canopynetwork/canopy-ts/keystore";

const STORAGE_KEY = "canopy-guestbook.keystore.v1";

/** Reads never throw: a browser with storage disabled behaves as an empty keystore. */
function readAll(): ParsedKeystoreEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ParsedKeystoreEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: ParsedKeystoreEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    // a full or disabled localStorage must not take the app down mid-signup; the wallet stays
    // usable for this session, it just will not survive a reload
    console.warn("could not persist the keystore to localStorage", error);
  }
}

/** A KeystoreStorage backed by localStorage, keyed by address. */
export const localKeystoreStorage = {
  load(): ParsedKeystoreEntry[] {
    return readAll();
  },
  save(entry: ParsedKeystoreEntry): void {
    const others = readAll().filter(
      (e) => e.address.toLowerCase() !== entry.address.toLowerCase(),
    );
    writeAll([...others, entry]);
  },
  remove(address: string): void {
    writeAll(readAll().filter((e) => e.address.toLowerCase() !== address.toLowerCase()));
  },
};

/** Every locally stored account, for the account picker. */
export function listStoredEntries(): ParsedKeystoreEntry[] {
  return readAll();
}
