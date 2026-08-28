import { useState } from "react";
import { config } from "../lib/config.js";
import { countCharacters, describeError, getHeight, submitPost, validateContent } from "../lib/guestbook.js";
import type { Signer } from "../lib/guestbook.js";
import { Notice } from "./Notice.js";

interface Props {
  signer: Signer | null;
  /** Chain height at the moment of submission, used to detect confirmation. */
  height: number | null;
  onSubmitted(): void;
}

type Status =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "pending"; hash: string }
  | { kind: "confirmed"; hash: string }
  | { kind: "error"; message: string };

/** The compose box: write an entry, sign it locally, broadcast it, and watch for confirmation. */
export function ComposePost({ signer, height, onSubmitted }: Props) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const used = countCharacters(content.trim());
  const remaining = config.maxContentLength - used;
  const validationError = content.trim().length > 0 ? validateContent(content) : null;
  const busy = status.kind === "signing" || status.kind === "pending";
  const canSubmit = Boolean(signer) && used > 0 && validationError === null && !busy;

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!signer || !canSubmit) return;

    setStatus({ kind: "signing" });
    try {
      const hash = await submitPost(signer, content);
      setStatus({ kind: "pending", hash });
      setContent("");

      // The transaction is in the mempool now; it lands in one of the next blocks. Rather than
      // polling the tx index, wait for the feed to grow — that is the thing the user is watching.
      const startedAt = height ?? 0;
      const confirmed = await waitForInclusion(startedAt);
      setStatus(confirmed ? { kind: "confirmed", hash } : { kind: "pending", hash });
      onSubmitted();
    } catch (e) {
      setStatus({ kind: "error", message: describeError(e) });
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Sign the guestbook
      </h2>

      <form onSubmit={send} className="space-y-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={!signer || busy}
          rows={4}
          placeholder={signer ? "Say something permanent…" : "Unlock a wallet to post."}
          className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-900"
        />

        <div className="flex items-center gap-3">
          <span
            className={[
              "font-mono text-xs",
              remaining < 0 ? "text-red-600" : remaining <= 20 ? "text-amber-600" : "text-slate-400",
            ].join(" ")}
          >
            {remaining}
          </span>
          <button
            type="submit"
            disabled={!canSubmit}
            className="ml-auto rounded-lg bg-canopy-light px-5 py-2 text-sm font-semibold text-white transition hover:bg-canopy-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status.kind === "signing"
              ? "Signing…"
              : status.kind === "pending"
                ? "Waiting for a block…"
                : "Post"}
          </button>
        </div>

        {validationError && <Notice tone="error">{validationError}</Notice>}

        {status.kind === "pending" && (
          <Notice tone="info">
            Broadcast. Waiting for it to be included in a block…
            <TxHash hash={status.hash} />
          </Notice>
        )}
        {status.kind === "confirmed" && (
          <Notice tone="success" onDismiss={() => setStatus({ kind: "idle" })}>
            Confirmed on-chain — it is in the feed below.
            <TxHash hash={status.hash} />
          </Notice>
        )}
        {status.kind === "error" && (
          <Notice tone="error" onDismiss={() => setStatus({ kind: "idle" })}>
            {status.message}
          </Notice>
        )}
      </form>
    </section>
  );
}

function TxHash({ hash }: { hash: string }) {
  return (
    <code className="mt-1 block overflow-x-auto font-mono text-xs opacity-80">{hash}</code>
  );
}

/**
 * Wait until the chain has advanced past the height at which we submitted, which is when a
 * transaction accepted into the mempool would have had a chance to be included.
 *
 * @returns true if the chain advanced, false if it stalled long enough that we stop waiting
 */
async function waitForInclusion(submittedAtHeight: number): Promise<boolean> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    try {
      // two blocks: one to be proposed into, one to be committed
      if ((await getHeight()) > submittedAtHeight + 1) return true;
    } catch {
      // keep waiting; the poller in useChain surfaces node trouble on its own
    }
  }
  return false;
}
