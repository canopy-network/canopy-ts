import { config, shortAddress } from "../lib/config.js";

interface Props {
  height: number | null;
  producingBlocks: boolean;
  chainError: string | null;
  postCount: number;
}

/** Top strip: is the chain alive, at what height, and how big is the guestbook. */
export function StatusBar({ height, producingBlocks, chainError, postCount }: Props) {
  const live = chainError === null && height !== null;
  const label = chainError
    ? "Node unreachable"
    : height === null
      ? "Connecting…"
      : producingBlocks
        ? "Producing blocks"
        : "Connected";

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/70">
      <span className="flex items-center gap-2 font-medium">
        <span
          className={[
            "inline-block h-2.5 w-2.5 rounded-full",
            chainError ? "bg-red-500" : live ? "bg-canopy-light" : "bg-amber-400",
            producingBlocks && !chainError ? "animate-pulse" : "",
          ].join(" ")}
          aria-hidden
        />
        {label}
      </span>
      <span className="text-slate-500 dark:text-slate-400">
        Height <span className="font-mono text-slate-800 dark:text-slate-200">{height ?? "—"}</span>
      </span>
      <span className="text-slate-500 dark:text-slate-400">
        Posts <span className="font-mono text-slate-800 dark:text-slate-200">{postCount}</span>
      </span>
      <span className="ml-auto font-mono text-xs text-slate-400" title={config.rpcUrl}>
        {shortAddress(config.rpcUrl.replace(/^https?:\/\//, ""))}
      </span>
    </div>
  );
}
