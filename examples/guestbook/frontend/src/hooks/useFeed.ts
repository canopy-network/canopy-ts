/**
 * The guestbook feed, polled from the plugin's RPC server.
 */
import { useCallback, useEffect, useState } from "react";
import { config } from "../lib/config.js";
import { describeError, getPosts, type Post } from "../lib/guestbook.js";

export interface FeedState {
  posts: Post[];
  loading: boolean;
  error: string | null;
  refresh(): void;
}

export function useFeed(limit = 50): FeedState {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const next = await getPosts(limit);
        if (cancelled) return;
        setPosts(next);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(describeError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void poll();
    const timer = setInterval(poll, config.pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [limit, tick]);

  return { posts, loading, error, refresh };
}
