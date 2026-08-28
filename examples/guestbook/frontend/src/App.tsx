import { useEffect, useState } from "react";
import { useWallet } from "./hooks/useWallet.js";
import { useChain } from "./hooks/useChain.js";
import { useFeed } from "./hooks/useFeed.js";
import { WalletPanel } from "./components/WalletPanel.js";
import { ComposePost } from "./components/ComposePost.js";
import { Feed } from "./components/Feed.js";
import { StatusBar } from "./components/StatusBar.js";
import { getPostFee, registerGuestbookMessages } from "./lib/guestbook.js";

// Teach the SDK about post_message once, before anything tries to sign one.
registerGuestbookMessages();

export default function App() {
  const wallet = useWallet();
  const chain = useChain(wallet.signer?.address ?? null);
  const feed = useFeed(50);
  const [fee, setFee] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPostFee().then((f) => {
      if (!cancelled) setFee(f);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Canopy Guestbook</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            An append-only feed living in a Canopy appchain's own state. Signed in your browser,
            written by a Go plugin, kept forever.
          </p>
        </header>

        <div className="mb-6">
          <StatusBar
            height={chain.height}
            producingBlocks={chain.producingBlocks}
            chainError={chain.error}
            postCount={feed.posts.length}
          />
        </div>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start">
          <main className="order-2 min-w-0 space-y-6 md:order-1">
            <ComposePost
              signer={wallet.signer}
              height={chain.height}
              onSubmitted={() => {
                feed.refresh();
                chain.refresh();
              }}
            />
            <Feed
              posts={feed.posts}
              loading={feed.loading}
              error={feed.error}
              selfAddress={wallet.signer?.address ?? null}
            />
          </main>

          <aside className="order-1 min-w-0 md:order-2 md:sticky md:top-8">
            <WalletPanel wallet={wallet} balance={chain.balance} fee={fee} />
          </aside>
        </div>

        <footer className="mt-12 border-t border-slate-200 pt-6 text-xs text-slate-400 dark:border-slate-800">
          Built with{" "}
          <a
            href="https://github.com/canopy-network/canopy-ts"
            className="underline underline-offset-2 hover:text-slate-600 dark:hover:text-slate-300"
          >
            @canopynetwork/canopy-ts
          </a>
          . No backend — the browser signs and broadcasts directly to the node.
        </footer>
      </div>
    </div>
  );
}
