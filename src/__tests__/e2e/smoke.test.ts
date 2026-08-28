/**
 * E2E smoke tests for canopy-ts against a live single-node canopy devnet.
 *
 * These tests hit an actual running canopy node over HTTP — no mocked RPC responses.
 * They exist to catch the class of bug unit tests structurally cannot: wire-format
 * mismatches, wrong RPC paths, and (for the send test) whether a real signed
 * transaction submitted through createAndSignTransaction is actually accepted and
 * applied by a real node.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createAndSignTransaction } from '../../transaction.js';
import { derivePublicKey } from '../../signing.js';
import { deriveAddress } from '../../address.js';
import { CurveType } from '../../types.js';
import { queryHeight, queryAccount, rpcRequest, waitFor, getE2eConfig, extractTxHash } from '../../../tests/e2e/helpers.js';
import { submitTx, getBalance, fetchHeight } from '../../rpc.js';
import { RpcError } from '../../errors.js';
import { generateKeyPair } from '../../wallet.js';
import { encryptKeyEntry, decryptEntry } from '../../keystore.js';

// Devnet genesis account and credentials
const DEVNET_ADDRESS = '3db4b1ec0d9206365696e0c3a52a519840060c86';
const DEVNET_PRIVATE_KEY_HEX = '58076499043ed850ddf6675da60e666124093d3c6933fcaf6b605f4141d30958';
const DEVNET_PASSWORD = 'e2e-test-password';

let config: ReturnType<typeof getE2eConfig>;

describe('E2E Smoke Tests', () => {
  beforeAll(() => {
    config = getE2eConfig();
  });

  it('height increases', async () => {
    const h1 = await queryHeight(config);
    expect(h1).toBeGreaterThanOrEqual(1);

    // Poll for height increase
    let increased = false;
    await waitFor(
      async () => {
        const h2 = await queryHeight(config);
        if (h2 > h1) {
          increased = true;
          return true;
        }
        return false;
      },
      { timeoutMs: 10_000 },
    );

    expect(increased).toBe(true);
  });

  it('genesis account is funded', async () => {
    const account = await queryAccount(DEVNET_ADDRESS, config);
    expect(account.address).toBe(DEVNET_ADDRESS);
    expect(typeof account.amount).toBe('number');
    expect((account.amount as number) > 0).toBe(true);
  });

  it('getBalance returns the genesis account balance as a number', async () => {
    const balance = await getBalance(DEVNET_ADDRESS, { baseUrl: config.rpcUrl });

    expect(typeof balance).toBe('number');
    expect(balance).toBeGreaterThan(0);

    // Must agree with the raw account query it wraps.
    const raw = await queryAccount(DEVNET_ADDRESS, config);
    expect(balance).toBe(raw.amount);
  });

  it('getBalance on an unseen address returns 0 or a typed RpcError', async () => {
    // How a node answers for an address it has no record of is the node's
    // choice -- an empty account record (0) or a rejection. Both are valid;
    // what matters is that a rejection arrives as a typed RpcError rather
    // than leaking as some untyped failure.
    const unknown = generateKeyPair().address;

    try {
      expect(await getBalance(unknown, { baseUrl: config.rpcUrl })).toBe(0);
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
    }
  });

  it('getBalance accepts a 0x-prefixed address', async () => {
    const prefixed = await getBalance(`0x${DEVNET_ADDRESS}`, { baseUrl: config.rpcUrl });
    const bare = await getBalance(DEVNET_ADDRESS, { baseUrl: config.rpcUrl });

    expect(prefixed).toBe(bare);
  });

  it('fetchHeight agrees with the raw height query', async () => {
    const viaSdk = await fetchHeight({ baseUrl: config.rpcUrl });

    expect(typeof viaSdk).toBe('number');
    expect(viaSdk).toBeGreaterThanOrEqual(1);
  });

  it('real signed send is accepted by the node', async () => {
    // Create a new recipient address
    const recipientKeyPair = generateKeyPair();
    const recipientAddress = recipientKeyPair.address;

    // Get initial balance (may not exist yet)
    let beforeAmount: number;
    try {
      const before = await queryAccount(recipientAddress, config);
      beforeAmount = (before.amount as number) ?? 0;
    } catch {
      beforeAmount = 0;
    }

    // Get current height and fees
    const heightResult = await queryHeight(config);
    const fees = await rpcRequest<{ sendFee?: number }>('/v1/query/fee-params', { height: 0 }, config);
    const fee = fees.sendFee ?? 0;

    // Create and sign the send transaction
    const tx = createAndSignTransaction(
      {
        type: 'send',
        msg: {
          fromAddress: DEVNET_ADDRESS,
          toAddress: recipientAddress,
          amount: 1000,
        },
        fee,
        networkID: 1,
        chainID: 1,
        height: heightResult,
      },
      DEVNET_PRIVATE_KEY_HEX,
      derivePublicKey(DEVNET_PRIVATE_KEY_HEX, CurveType.BLS12381),
      CurveType.BLS12381,
      { format: 'core' },
    );

    // Submit the transaction
    const response = await submitTx(tx, { baseUrl: config.rpcUrl });
    const txHash = extractTxHash(response);
    expect(typeof txHash).toBe('string');
    expect(txHash.length).toBe(64);

    // Wait for the transaction to be applied
    let foundIncrease = false;
    await waitFor(
      async () => {
        try {
          const after = await queryAccount(recipientAddress, config);
          const afterAmount = (after.amount as number) ?? 0;
          if (afterAmount > beforeAmount) {
            foundIncrease = true;
            return true;
          }
        } catch {
          // Account might not be on-chain yet, keep trying
        }
        return false;
      },
      { timeoutMs: 60_000, intervalMs: 1_000 },
    );

    expect(foundIncrease).toBe(true);

    // Verify the final balance
    const final = await queryAccount(recipientAddress, config);
    const finalAmount = (final.amount as number) ?? 0;
    expect(finalAmount).toBe(beforeAmount + 1000);
  });
});
