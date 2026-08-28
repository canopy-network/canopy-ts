/**
 * Chain liveness: polls the node's height and the connected account's balance.
 *
 * Canopy has no push transport here, so the UI polls. A rising height is what tells the user the
 * chain is actually producing blocks rather than sitting dead behind a reachable port.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../lib/config.js";
import { describeError, getAccount, getHeight } from "../lib/guestbook.js";

export interface ChainState {
  height: number | null;
  /** True once a second poll has observed a higher height — the chain is demonstrably live. */
  producingBlocks: boolean;
  balance: number | null;
  error: string | null;
  refresh(): void;
}

export function useChain(address: string | null): ChainState {
  const [height, setHeight] = useState<number | null>(null);
  const [producingBlocks, setProducingBlocks] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const lastHeight = useRef<number | null>(null);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const next = await getHeight();
        if (cancelled) return;
        if (lastHeight.current !== null && next > lastHeight.current) setProducingBlocks(true);
        lastHeight.current = next;
        setHeight(next);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setProducingBlocks(false);
        setError(describeError(e));
      }

      if (address) {
        try {
          const info = await getAccount(address);
          if (!cancelled) setBalance(info.amount);
        } catch {
          // a balance we could not read is not worth replacing a live height error with
          if (!cancelled) setBalance(null);
        }
      } else if (!cancelled) {
        setBalance(null);
      }
    }

    void poll();
    const timer = setInterval(poll, config.pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [address, tick]);

  return { height, producingBlocks, balance, error, refresh };
}
