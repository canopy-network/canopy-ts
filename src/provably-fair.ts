/**
 * Provably fair verification utilities for canopy casino games.
 *
 * These functions allow clients to independently verify game outcomes
 * after the server seed has been revealed (on seed rotation or cashout).
 */

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * Verifies that a server seed matches its previously committed hash.
 */
export function verifyCommitment(serverSeed: string, hash: string): boolean {
  const computed = bytesToHex(sha256(new TextEncoder().encode(serverSeed)));
  return computed === hash;
}

/**
 * Computes the raw HMAC-SHA256 bytes for the given seed pair and nonce.
 * This is the core primitive — game-specific mappers interpret the output.
 */
export function computeHMAC(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Uint8Array {
  const message = `${clientSeed}:${nonce}`;
  return hmac(
    sha256,
    new TextEncoder().encode(serverSeed),
    new TextEncoder().encode(message)
  );
}

/**
 * Computes a dice roll in the range [0, 9999] from the given seeds and nonce.
 *
 * Uses rejection sampling over successive 4-byte HMAC windows to eliminate
 * modulo bias. A naive `uint32 % 10000` is biased because 2^32 (4 294 967 296)
 * is not evenly divisible by 10000 — values 0–7295 appear once more often than
 * values 7296–9999, giving the house a hidden systematic edge on those outcomes.
 *
 * Rejection threshold: 4 294 960 000 (= floor(2^32 / 10000) * 10000).
 * Values at or above the threshold are discarded and the next 4-byte window is
 * tried. In practice fewer than 2 iterations are needed on average.
 */
export function computeDiceRoll(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): number {
  const h = computeHMAC(serverSeed, clientSeed, nonce);
  const RANGE = 10000;
  const THRESHOLD = Math.floor(0x100000000 / RANGE) * RANGE; // 4_294_960_000
  for (let offset = 0; offset + 4 <= h.length; offset += 4) {
    const view = new DataView(h.buffer, h.byteOffset + offset, 4);
    const raw = view.getUint32(0, false); // big-endian
    if (raw < THRESHOLD) return raw % RANGE;
  }
  // Fallback (astronomically unlikely): use modulo on last window
  const view = new DataView(h.buffer, h.byteOffset, 4);
  return view.getUint32(0, false) % RANGE;
}

/**
 * Verifies that a dice roll matches the expected value for the given seeds.
 */
export function verifyDiceRoll(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  expectedRoll: number
): boolean {
  return computeDiceRoll(serverSeed, clientSeed, nonce) === expectedRoll;
}

/**
 * Computes the crash point for a rocket round.
 * Uses HMAC-SHA256(serverSeed, nonce) with 3% house edge.
 * Result is clamped to [1.01, 100.0].
 */
export function computeCrashPoint(
  serverSeed: string,
  nonce: number
): number {
  const h = computeHMAC(serverSeed, "", nonce);
  const hex8 = bytesToHex(h).slice(0, 8);
  const result = parseInt(hex8, 16) >>> 0; // unsigned 32-bit

  if (result % 33 === 0) return 1.0;

  const houseEdge = 0.03;
  const e = 0x100000000;
  let crashPoint = ((1 - houseEdge) * e) / (result + 1);
  crashPoint = Math.floor(crashPoint * 100) / 100;
  if (crashPoint < 1.01) crashPoint = 1.01;
  if (crashPoint > 100.0) crashPoint = 100.0;
  return crashPoint;
}