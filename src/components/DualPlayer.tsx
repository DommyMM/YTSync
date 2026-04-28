"use client";

import { useEffect, useRef, useState } from "react";

type SyncStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

type PlayerLike = {
  destroy: () => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  getVolume: () => number;
  isMuted: () => boolean;
  mute: () => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  setVolume: (volume: number) => void;
  unMute: () => void;
  setPlaybackQuality?: (quality: string) => void;
};

type PlayerEvent = {
  data?: number;
  target: PlayerLike;
};

type YTNamespace = {
  Player: new (
    elementId: string,
    config: {
      events?: {
        onError?: (event: { data: number }) => void;
        onReady?: (event: PlayerEvent) => void;
        onStateChange?: (event: PlayerEvent) => void;
      };
      playerVars?: Record<string, number | string>;
      videoId: string;
    },
  ) => PlayerLike;
  PlayerState: {
    BUFFERING: number;
    CUED: number;
    ENDED: number;
    PAUSED: number;
    PLAYING: number;
    UNSTARTED: number;
  };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    __ytIframeApiPromise?: Promise<void>;
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface DualPlayerProps {
  enVideoId: string;
  jpVideoId: string;
}

const DEFAULT_VOLUME = 100;
const DRIFT_SNAP_SECONDS = 0.3;
const SYNC_INTERVAL_MS = 250;

function loadYoutubeApi() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.YT?.Player) {
    return Promise.resolve();
  }

  if (!window.__ytIframeApiPromise) {
    window.__ytIframeApiPromise = new Promise<void>((resolve) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[src="https://www.youtube.com/iframe_api"]',
      );

      if (!existingScript) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(script);
      }

      window.onYouTubeIframeAPIReady = () => resolve();
    });
  }

  return window.__ytIframeApiPromise;
}

export default function DualPlayer({
  enVideoId,
  jpVideoId,
}: DualPlayerProps) {
  const enPlayerRef = useRef<PlayerLike | null>(null);
  const jpPlayerRef = useRef<PlayerLike | null>(null);
  const syncIntervalRef = useRef<number | null>(null);
  const volumeRef = useRef(DEFAULT_VOLUME);
  const enReadyRef = useRef(false);
  const jpReadyRef = useRef(false);

  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [driftMs, setDriftMs] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    volumeRef.current = volume;
    try {
      jpPlayerRef.current?.setVolume(volume);
    } catch {}
  }, [volume]);

  useEffect(() => {
    let cancelled = false;
    enReadyRef.current = false;
    jpReadyRef.current = false;
    setStatus("loading");
    setError("");
    setDriftMs(0);

    const stopSyncLoop = () => {
      if (syncIntervalRef.current !== null) {
        window.clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };

    const syncTick = () => {
      const en = enPlayerRef.current;
      const jp = jpPlayerRef.current;
      if (!en || !jp || !window.YT) return;
      if (!enReadyRef.current || !jpReadyRef.current) return;

      let enState: number;
      let enTime: number;
      let jpTime: number;
      try {
        enState = en.getPlayerState();
        enTime = en.getCurrentTime();
        jpTime = jp.getCurrentTime();
      } catch {
        return;
      }

      const drift = enTime - jpTime;
      setDriftMs(Math.round(drift * 1000));

      if (enState === window.YT.PlayerState.PLAYING) {
        if (Math.abs(drift) > DRIFT_SNAP_SECONDS) {
          jp.seekTo(enTime, true);
        }
        if (jp.getPlayerState() !== window.YT.PlayerState.PLAYING) {
          jp.playVideo();
        }
        if (jp.isMuted()) {
          jp.unMute();
        }
        if (jp.getVolume() !== volumeRef.current) {
          jp.setVolume(volumeRef.current);
        }
      }
    };

    const ensureSyncLoop = () => {
      if (syncIntervalRef.current !== null) return;
      syncIntervalRef.current = window.setInterval(syncTick, SYNC_INTERVAL_MS);
    };

    async function initPlayers() {
      await loadYoutubeApi();
      if (cancelled || !window.YT) return;

      enPlayerRef.current = new window.YT.Player("en-frame", {
        videoId: enVideoId,
        playerVars: {
          controls: 1,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          vq: "hd1080",
        },
        events: {
          onError: () => {
            if (cancelled) return;
            setError("The English player failed to initialize.");
            setStatus("error");
          },
          onReady: ({ target }) => {
            if (cancelled) return;
            target.mute();
            try {
              target.setPlaybackQuality?.("hd1080");
            } catch {}
            enReadyRef.current = true;
            if (jpReadyRef.current) {
              setStatus("ready");
            }
          },
          onStateChange: ({ data }) => {
            if (cancelled || !window.YT) return;
            const en = enPlayerRef.current;
            const jp = jpPlayerRef.current;
            if (!en || !jp) return;

            if (data === window.YT.PlayerState.PLAYING) {
              try {
                jp.seekTo(en.getCurrentTime(), true);
                jp.unMute();
                jp.setVolume(volumeRef.current);
                jp.playVideo();
              } catch {}
              setStatus("playing");
              ensureSyncLoop();
            } else if (data === window.YT.PlayerState.PAUSED) {
              try {
                jp.pauseVideo();
              } catch {}
              setStatus("paused");
            } else if (data === window.YT.PlayerState.ENDED) {
              try {
                jp.pauseVideo();
              } catch {}
              setStatus("ready");
              stopSyncLoop();
            } else if (data === window.YT.PlayerState.BUFFERING) {
              try {
                if (jp.getPlayerState() === window.YT.PlayerState.PLAYING) {
                  jp.pauseVideo();
                }
              } catch {}
            }
          },
        },
      });

      jpPlayerRef.current = new window.YT.Player("jp-frame", {
        videoId: jpVideoId,
        playerVars: {
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onError: () => {
            if (cancelled) return;
            setError("The Japanese player failed to initialize.");
            setStatus("error");
          },
          onReady: ({ target }) => {
            if (cancelled) return;
            target.setVolume(volumeRef.current);
            target.unMute();
            jpReadyRef.current = true;
            if (enReadyRef.current) {
              setStatus("ready");
            }
          },
        },
      });
    }

    const handleVisibility = () => {
      if (document.hidden) return;
      const en = enPlayerRef.current;
      const jp = jpPlayerRef.current;
      if (!en || !jp || !window.YT) return;
      if (!enReadyRef.current || !jpReadyRef.current) return;
      try {
        if (en.getPlayerState() === window.YT.PlayerState.PLAYING) {
          jp.seekTo(en.getCurrentTime(), true);
          jp.playVideo();
        }
      } catch {}
    };

    document.addEventListener("visibilitychange", handleVisibility);

    void initPlayers();

    return () => {
      cancelled = true;
      stopSyncLoop();
      document.removeEventListener("visibilitychange", handleVisibility);
      try {
        enPlayerRef.current?.destroy();
      } catch {}
      try {
        jpPlayerRef.current?.destroy();
      } catch {}
      enPlayerRef.current = null;
      jpPlayerRef.current = null;
    };
  }, [enVideoId, jpVideoId]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-[1.5rem] border border-white/8 bg-black shadow-[var(--shadow)]">
          <div className="aspect-video w-full">
            <div className="h-full w-full" id="en-frame" />
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3">
            <span className="rounded-full border border-white/10 bg-black/55 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.22em] text-white/80 backdrop-blur">
              EN video muted
            </span>
            <span className="rounded-full border border-accent/20 bg-accent-soft px-3 py-1 font-mono text-[11px] uppercase tracking-[0.22em] text-accent backdrop-blur">
              JP audio mirrors
            </span>
          </div>

          {status === "loading" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-sm">
              <div className="rounded-full border border-white/10 bg-black/50 px-4 py-2 font-mono text-xs uppercase tracking-[0.28em] text-white/75">
                Loading embeds
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <aside className="space-y-4 rounded-[1.5rem] border border-white/8 bg-black/20 p-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-muted">
            JP volume
          </p>
          <div className="mt-3 flex items-center gap-3">
            <input
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[var(--accent)]"
              max={100}
              min={0}
              onChange={(event) => setVolume(Number(event.target.value))}
              type="range"
              value={volume}
            />
            <span className="w-12 text-right font-mono text-sm text-white">
              {volume}%
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-muted">
            Status
          </p>
          <p className="mt-2 font-mono text-sm text-white">{status}</p>
          <p className="mt-1 font-mono text-xs text-muted">
            drift {driftMs > 0 ? "+" : ""}
            {driftMs}ms
          </p>
        </div>

        <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-xs leading-6 text-muted">
          Use the EN player&apos;s own controls (play, pause, seek, fullscreen,
          captions). The JP track follows EN&apos;s timeline 1:1 — the two
          uploads are assumed to be the same video in different dubs.
        </div>

        {error ? (
          <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm text-red-100">
            {error}
          </div>
        ) : null}
      </aside>

      <div className="fixed left-[-9999px] top-0 h-[225px] w-[400px] overflow-hidden opacity-[0.01]">
        <div id="jp-frame" />
      </div>
    </div>
  );
}
