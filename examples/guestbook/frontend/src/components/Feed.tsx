import { shortAddress } from "../lib/config.js";
import type { Post } from "../lib/guestbook.js";
import { Notice } from "./Notice.js";

interface Props {
  posts: Post[];
  loading: boolean;
  error: string | null;
  /** The unlocked address, so the user's own entries can be marked. */
  selfAddress: string | null;
}

/** The guestbook feed, newest first. */
export function Feed({ posts, loading, error, selfAddress }: Props) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Guestbook
      </h2>

      {error && <Notice tone="error">{error}</Notice>}

      {loading && posts.length === 0 && !error && (
        <p className="py-8 text-center text-sm text-slate-400">Loading the feed…</p>
      )}

      {!loading && posts.length === 0 && !error && (
        <p className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400 dark:border-slate-700">
          Nothing here yet. Be the first to sign it.
        </p>
      )}

      <ol className="space-y-3">
        {posts.map((post) => {
          const mine = selfAddress?.toLowerCase() === post.authorAddress.toLowerCase();
          return (
            <li
              key={post.id}
              className={[
                "rounded-xl border bg-white p-4 shadow-sm transition dark:bg-slate-900",
                mine
                  ? "border-canopy-light/50 ring-1 ring-canopy-light/20"
                  : "border-slate-200 dark:border-slate-700",
              ].join(" ")}
            >
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-relaxed text-slate-800 dark:text-slate-100">
                {post.content}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                <span className="font-mono" title={post.authorAddress}>
                  {shortAddress(post.authorAddress)}
                </span>
                {mine && (
                  <span className="rounded-full bg-canopy-light/10 px-2 py-0.5 font-medium text-canopy-dark dark:text-canopy-light">
                    you
                  </span>
                )}
                <span className="ml-auto font-mono">#{post.id}</span>
                <span className="font-mono">block {post.height}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
