"use client";

import { FormEvent, useMemo, useState } from "react";
import DualPlayer from "@/components/DualPlayer";

type MatchResult = {
  durationMatches: boolean;
  enDuration: string;
  enTitle: string;
  jpDuration: string;
  jpTitle: string;
  jpVideoId: string;
  position: number;
};

function extractVideoId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);

    if (url.hostname === "youtu.be") {
      return url.pathname.replace("/", "").slice(0, 11);
    }

    const directId = url.searchParams.get("v");
    if (directId) {
      return directId.slice(0, 11);
    }

    const embedMatch = url.pathname.match(/\/(embed|shorts)\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) {
      return embedMatch[2];
    }
  } catch {
    return "";
  }

  return "";
}

export default function Home() {
  const [enUrl, setEnUrl] = useState("");
  const [manualJpUrl, setManualJpUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [match, setMatch] = useState<MatchResult | null>(null);

  const enVideoId = useMemo(() => extractVideoId(enUrl), [enUrl]);
  const manualJpVideoId = useMemo(() => extractVideoId(manualJpUrl), [manualJpUrl]);
  const activeJpVideoId = manualJpVideoId || match?.jpVideoId || "";

  async function findMatch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!enVideoId) {
      setError("Paste a valid English YouTube URL first.");
      return;
    }

    setIsLoading(true);
    setError("");
    setMatch(null);

    try {
      const response = await fetch(
        `/api/match-jp?enVideoId=${encodeURIComponent(enVideoId)}`,
      );
      const data = (await response.json()) as MatchResult & { error?: string };

      if (!response.ok || data.error) {
        setError(data.error ?? "Unable to find the JP match.");
        return;
      }

      setMatch(data);
    } catch {
      setError("Unable to reach the matcher route.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="relative overflow-hidden rounded-[2rem] border border-border bg-surface p-6 shadow-[var(--shadow)] backdrop-blur-xl sm:p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(118,228,195,0.16),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(246,193,119,0.14),transparent_34%)]" />
          <div className="relative space-y-6">
            <div className="space-y-3">
              <span className="inline-flex rounded-full border border-accent/30 bg-accent-soft px-3 py-1 font-mono text-[11px] uppercase tracking-[0.3em] text-accent">
                Private dual-audio player
              </span>
              <div className="space-y-3">
                <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                  English video on screen, Japanese audio underneath.
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-muted sm:text-base">
                  Paste the EN upload, match the same position from the JP
                  channel, then run both embeds with the EN track muted.
                </p>
              </div>
            </div>

            <form className="space-y-4" onSubmit={findMatch}>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-white">
                  English YouTube URL
                </span>
                <input
                  className="w-full rounded-2xl border border-white/10 bg-surface-strong px-4 py-3 text-sm text-white outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
                  onChange={(event) => {
                    setEnUrl(event.target.value);
                    setMatch(null);
                    setError("");
                  }}
                  placeholder="https://www.youtube.com/watch?v=aMAJhkp0hlc"
                  spellCheck={false}
                  value={enUrl}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-white">
                    Optional JP override
                  </span>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-surface-strong px-4 py-3 text-sm text-white outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
                    onChange={(event) => setManualJpUrl(event.target.value)}
                    placeholder="Paste a JP link only if the auto-match is wrong"
                    spellCheck={false}
                    value={manualJpUrl}
                  />
                </label>

                <button
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/45"
                  disabled={!enVideoId || isLoading}
                  type="submit"
                >
                  {isLoading ? "Matching..." : "Find JP Match"}
                </button>
              </div>
            </form>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                  Strategy
                </p>
                <p className="mt-2 text-sm text-white">
                  Match by upload position instead of title.
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                  Verify
                </p>
                <p className="mt-2 text-sm text-white">
                  Cross-check duration before playback starts.
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                  Tune
                </p>
                <p className="mt-2 text-sm text-white">
                  Nudge JP offset if a trailer needs manual correction.
                </p>
              </div>
            </div>
          </div>
        </div>

        <aside className="rounded-[2rem] border border-border bg-surface p-6 shadow-[var(--shadow)] backdrop-blur-xl sm:p-8">
          <div className="space-y-5">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                Locked channels
              </p>
              <div className="mt-3 space-y-3 text-sm text-slate-200">
                <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                  <p className="font-medium text-white">@WutheringWaves</p>
                  <p className="mt-1 text-muted">
                    Visible player, captions on, muted.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                  <p className="font-medium text-white">@wutheringwaves3352</p>
                  <p className="mt-1 text-muted">
                    Hidden player, JP audio only.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                Current state
              </p>
              <div className="mt-3 space-y-2 text-sm">
                <p className="text-white">
                  EN video ID:{" "}
                  <span className="font-mono text-accent">
                    {enVideoId || "waiting"}
                  </span>
                </p>
                <p className="text-white">
                  JP source:{" "}
                  <span className="font-mono text-accent">
                    {manualJpVideoId || match?.jpVideoId || "waiting"}
                  </span>
                </p>
              </div>
            </div>

            {error ? (
              <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm text-red-100">
                {error}
              </div>
            ) : null}

            {match ? (
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
                    Position {match.position}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.24em] ${
                      match.durationMatches
                        ? "bg-accent-soft text-accent"
                        : "bg-warn/15 text-warn"
                    }`}
                  >
                    {match.durationMatches
                      ? "Duration match"
                      : `${match.enDuration} vs ${match.jpDuration}`}
                  </span>
                </div>
                <div className="mt-4 space-y-3 text-sm">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
                      EN
                    </p>
                    <p className="mt-1 text-white">{match.enTitle}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
                      JP
                    </p>
                    <p className="mt-1 text-white">{match.jpTitle}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 p-4 text-sm text-muted">
                Run the matcher once and the player panel below will become
                active.
              </div>
            )}
          </div>
        </aside>
      </section>

      <section className="rounded-[2rem] border border-border bg-surface p-4 shadow-[var(--shadow)] backdrop-blur-xl sm:p-5">
        {enVideoId && activeJpVideoId ? (
          <DualPlayer enVideoId={enVideoId} jpVideoId={activeJpVideoId} />
        ) : (
          <div className="flex min-h-[26rem] flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-white/10 bg-black/15 px-6 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">
              Player standby
            </p>
            <h2 className="mt-4 text-2xl font-semibold text-white">
              Paste the EN link and resolve the JP match.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-muted">
              The visible player stays English-only. The JP video sits offscreen
              and only provides audio.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
