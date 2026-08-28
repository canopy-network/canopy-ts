import { useState } from "react";
import { formatCNPY, shortAddress } from "../lib/config.js";
import type { WalletState } from "../hooks/useWallet.js";
import { Notice } from "./Notice.js";

interface Props {
  wallet: WalletState;
  balance: number | null;
  fee: number | null;
}

type Mode = "create" | "import" | "unlock";

/**
 * Wallet / account section: create a key, import one, unlock, lock, and show the address and
 * balance. The private key never leaves useWallet's memory — nothing here renders or logs it.
 */
export function WalletPanel({ wallet, balance, fee }: Props) {
  const { accounts, signer, busy, error } = wallet;
  const [mode, setMode] = useState<Mode>(accounts.length > 0 ? "unlock" : "create");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [selected, setSelected] = useState(accounts[0]?.address ?? "");
  const [copied, setCopied] = useState(false);

  const activeAddress = selected || accounts[0]?.address || "";

  async function copyAddress() {
    if (!signer) return;
    try {
      await navigator.clipboard.writeText(signer.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "create") void wallet.createWallet(nickname, password).then(() => setPassword(""));
    else if (mode === "import")
      void wallet.importPrivateKey(privateKey, nickname, password).then(() => {
        setPassword("");
        setPrivateKey("");
      });
    else void wallet.unlock(activeAddress, password).then(() => setPassword(""));
  }

  if (signer) {
    const underfunded = fee !== null && balance !== null && balance < fee;
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Wallet
          </h2>
          <button
            type="button"
            onClick={wallet.lock}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Lock
          </button>
        </header>

        <button
          type="button"
          onClick={copyAddress}
          title={signer.address}
          className="block w-full truncate rounded-lg bg-slate-100 px-3 py-2 text-left font-mono text-sm text-slate-800 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          {signer.address}
        </button>
        <p className="mt-1 text-xs text-slate-400">{copied ? "Copied." : "Click to copy."}</p>

        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Balance</dt>
            <dd className="font-mono text-base text-slate-900 dark:text-slate-100">
              {balance === null ? "—" : `${formatCNPY(balance)} CNPY`}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Fee per post</dt>
            <dd className="font-mono text-base text-slate-900 dark:text-slate-100">
              {fee === null ? "—" : `${formatCNPY(fee)} CNPY`}
            </dd>
          </div>
        </dl>

        {underfunded && (
          <div className="mt-4">
            <Notice tone="info">
              This account cannot cover the fee yet. Send it some CNPY, e.g.
              <code className="mt-1 block overflow-x-auto rounded bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100">
                canopy admin tx-send &lt;funded-address&gt; {signer.address} 1000000 --password &lt;pw&gt;
              </code>
            </Notice>
          </div>
        )}

        {error && (
          <div className="mt-4">
            <Notice tone="error" onDismiss={wallet.clearError}>
              {error}
            </Notice>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Wallet
      </h2>

      <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
        {(["create", "import", "unlock"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            disabled={m === "unlock" && accounts.length === 0}
            className={[
              "flex-1 rounded-md px-3 py-1.5 font-medium capitalize transition",
              mode === m
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-800 disabled:opacity-40 disabled:hover:text-slate-500 dark:text-slate-400 dark:hover:text-slate-200",
            ].join(" ")}
          >
            {m}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-3">
        {mode === "unlock" ? (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Account
            </span>
            <select
              value={activeAddress}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              {accounts.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.nickname} — {shortAddress(a.address)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Nickname
            </span>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="guestbook"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
        )}

        {mode === "import" && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Ed25519 private key (hex)
            </span>
            <input
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="64 hex characters"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            Password
          </span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete={mode === "unlock" ? "current-password" : "new-password"}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-canopy-light px-4 py-2 text-sm font-semibold text-white transition hover:bg-canopy-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? "Working…"
            : mode === "create"
              ? "Generate key"
              : mode === "import"
                ? "Import key"
                : "Unlock"}
        </button>
      </form>

      <p className="mt-3 text-xs leading-relaxed text-slate-400">
        The key is generated in your browser, encrypted with this password, and stored in
        localStorage. It is never sent anywhere. This is a local demo chain — do not reuse a real
        key here.
      </p>

      {error && (
        <div className="mt-4">
          <Notice tone="error" onDismiss={wallet.clearError}>
            {error}
          </Notice>
        </div>
      )}
    </section>
  );
}
