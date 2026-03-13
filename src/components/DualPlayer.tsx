"use client";

import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type SyncStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

type PlayerLike = {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getVolume: () => number;
  isMuted: () => boolean;
  mute: () => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  setVolume: (volume: number) => void;
  unMute: () => void;
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
const DEFAULT_OFFSET_MS = 0;

function clampTime(value: number) {
  return Math.max(0, value);
}

function formatClock(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const minutes = Math.floor(safeValue / 60);
  const seconds = Math.floor(safeValue % 60);

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

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
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const enPlayerRef = useRef<PlayerLike | null>(null);
  const jpPlayerRef = useRef<PlayerLike | null>(null);
  const syncFrameRef = useRef<number | null>(null);
  const controlsTimeoutRef = useRef<number | null>(null);
  const readyStateRef = useRef({ en: false, jp: false });
  const restoreRef = useRef({ time: 0, wasPlaying: false });
  const playRef = useRef<() => void>(() => {});
  const currentTimeRef = useRef(0);
  const statusRef = useRef<SyncStatus>("idle");

  const [status, setStatus] = useState<SyncStatus>("idle");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [offsetMs, setOffsetMs] = useState(DEFAULT_OFFSET_MS);
  const [driftMs, setDriftMs] = useState(0);
  const [error, setError] = useState("");
  const [nativeControlsEnabled, setNativeControlsEnabled] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const destroyPlayers = useCallback(() => {
    try {
      enPlayerRef.current?.destroy();
    } catch {}
    try {
      jpPlayerRef.current?.destroy();
    } catch {}

    enPlayerRef.current = null;
    jpPlayerRef.current = null;
  }, []);

  const stopSyncLoop = useCallback(() => {
    if (syncFrameRef.current !== null) {
      cancelAnimationFrame(syncFrameRef.current);
      syncFrameRef.current = null;
    }
  }, []);

  const targetJpTime = useCallback((enTime: number) => {
    return clampTime(enTime + offsetMs / 1000);
  }, [offsetMs]);

  const clearControlsTimer = useCallback(() => {
    if (controlsTimeoutRef.current !== null) {
      window.clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
  }, []);

  const pulseControls = useCallback((keepVisible = false) => {
    setControlsVisible(true);
    clearControlsTimer();

    if (!isFullscreen || keepVisible || statusRef.current !== "playing") {
      return;
    }

    controlsTimeoutRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 1800);
  }, [clearControlsTimer, isFullscreen]);

  useEffect(() => {
    let cancelled = false;

    const syncRestoreTime = (time: number) => {
      return clampTime(time + offsetMs / 1000);
    };

    const maybeSetReady = () => {
      if (readyStateRef.current.en && readyStateRef.current.jp) {
        setStatus("ready");
        setCurrentTime(restoreRef.current.time);

        if (restoreRef.current.wasPlaying) {
          restoreRef.current.wasPlaying = false;
          window.setTimeout(() => {
            playRef.current();
          }, 0);
        }
      }
    };

    async function initPlayers() {
      restoreRef.current = {
        time: enPlayerRef.current?.getCurrentTime() ?? currentTimeRef.current,
        wasPlaying: statusRef.current === "playing",
      };

      setStatus("loading");
      setError("");
      setCurrentTime(restoreRef.current.time);
      setDuration(0);
      setDriftMs(0);
      readyStateRef.current = { en: false, jp: false };

      stopSyncLoop();
      destroyPlayers();

      await loadYoutubeApi();
      if (cancelled || !window.YT) {
        return;
      }

      enPlayerRef.current = new window.YT.Player("en-frame", {
        videoId: enVideoId,
        playerVars: {
          controls: nativeControlsEnabled ? 1 : 0,
          disablekb: nativeControlsEnabled ? 0 : 1,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onError: () => {
            setError("The English player failed to initialize.");
            setStatus("error");
          },
          onReady: ({ target }) => {
            target.mute();
            if (restoreRef.current.time > 0) {
              target.seekTo(restoreRef.current.time, true);
            }
            readyStateRef.current.en = true;
            setDuration(target.getDuration());
            maybeSetReady();
          },
          onStateChange: ({ data }) => {
            if (!window.YT) {
              return;
            }

            if (data === window.YT.PlayerState.PAUSED) {
              jpPlayerRef.current?.pauseVideo();
              stopSyncLoop();
              setStatus("paused");
              pulseControls(true);
            }

            if (data === window.YT.PlayerState.ENDED) {
              jpPlayerRef.current?.pauseVideo();
              stopSyncLoop();
              setStatus("ready");
              setCurrentTime(enPlayerRef.current?.getDuration() ?? 0);
              pulseControls(true);
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
            setError("The Japanese player failed to initialize.");
            setStatus("error");
          },
          onReady: ({ target }) => {
            target.setVolume(DEFAULT_VOLUME);
            target.unMute();
            if (restoreRef.current.time > 0) {
              target.seekTo(syncRestoreTime(restoreRef.current.time), true);
            }
            readyStateRef.current.jp = true;
            maybeSetReady();
          },
        },
      });
    }

    void initPlayers();

    return () => {
      cancelled = true;
      stopSyncLoop();
      destroyPlayers();
    };
  }, [destroyPlayers, enVideoId, jpVideoId, nativeControlsEnabled, offsetMs, pulseControls, stopSyncLoop]);

  useEffect(() => {
    jpPlayerRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = document.fullscreenElement === playerShellRef.current;
      setIsFullscreen(active);
      setControlsVisible(true);

      if (active) {
        playerShellRef.current?.focus();
        if (statusRef.current === "playing") {
          window.setTimeout(() => {
            pulseControls();
          }, 0);
        }
      } else {
        clearControlsTimer();
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [clearControlsTimer, pulseControls]);

  const startSyncLoop = useCallback(() => {
    stopSyncLoop();

    const loop = () => {
      const enPlayer = enPlayerRef.current;
      const jpPlayer = jpPlayerRef.current;

      if (!enPlayer || !jpPlayer || !window.YT) {
        return;
      }

      const enTime = enPlayer.getCurrentTime();
      const desiredJpTime = targetJpTime(enTime);
      const liveJpTime = jpPlayer.getCurrentTime();
      const driftSeconds = desiredJpTime - liveJpTime;

      setCurrentTime(enTime);
      setDriftMs(Math.round(driftSeconds * 1000));

      if (Math.abs(driftSeconds) > 0.28) {
        jpPlayer.seekTo(desiredJpTime, true);
      }

      if (jpPlayer.getPlayerState() !== window.YT.PlayerState.PLAYING) {
        jpPlayer.playVideo();
      }

      if (jpPlayer.isMuted() || jpPlayer.getVolume() !== volume) {
        jpPlayer.unMute();
        jpPlayer.setVolume(volume);
      }

      if (enPlayer.getPlayerState() === window.YT.PlayerState.PLAYING) {
        syncFrameRef.current = requestAnimationFrame(loop);
      }
    };

    syncFrameRef.current = requestAnimationFrame(loop);
  }, [stopSyncLoop, targetJpTime, volume]);

  const play = useCallback(() => {
    const enPlayer = enPlayerRef.current;
    const jpPlayer = jpPlayerRef.current;

    if (!enPlayer || !jpPlayer) {
      return;
    }

    const enTime = enPlayer.getCurrentTime();
    jpPlayer.seekTo(targetJpTime(enTime), true);
    jpPlayer.setVolume(volume);
    enPlayer.mute();
    jpPlayer.unMute();
    jpPlayer.playVideo();
    enPlayer.playVideo();

    window.setTimeout(() => {
      jpPlayer.unMute();
      jpPlayer.setVolume(volume);
      jpPlayer.playVideo();
      jpPlayer.seekTo(targetJpTime(enPlayer.getCurrentTime()), true);
    }, 160);

    setStatus("playing");
    startSyncLoop();
    pulseControls();
  }, [pulseControls, startSyncLoop, targetJpTime, volume]);

  useEffect(() => {
    playRef.current = play;
  }, [play]);

  function pause() {
    enPlayerRef.current?.pauseVideo();
    jpPlayerRef.current?.pauseVideo();
    stopSyncLoop();
    setStatus("paused");
    pulseControls(true);
  }

  function seek(nextTime: number) {
    const clampedTime = clampTime(nextTime);
    enPlayerRef.current?.seekTo(clampedTime, true);
    jpPlayerRef.current?.seekTo(targetJpTime(clampedTime), true);
    setCurrentTime(clampedTime);
    pulseControls(true);
  }

  function resetSync() {
    const enTime = enPlayerRef.current?.getCurrentTime() ?? 0;
    jpPlayerRef.current?.seekTo(targetJpTime(enTime), true);
    setDriftMs(0);
    pulseControls(true);
  }

  async function toggleFullscreen() {
    const shell = playerShellRef.current;
    if (!shell) {
      return;
    }

    if (document.fullscreenElement === shell) {
      await document.exitFullscreen();
      return;
    }

    await shell.requestFullscreen();
    shell.focus();
  }

  function togglePlayback() {
    if (isPlaying) {
      pause();
      return;
    }

    play();
  }

  function handleShellKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement) {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
      pulseControls(true);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      seek((enPlayerRef.current?.getCurrentTime() ?? currentTime) - 5);
      pulseControls(true);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      seek((enPlayerRef.current?.getCurrentTime() ?? currentTime) + 5);
      pulseControls(true);
      return;
    }

    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      void toggleFullscreen();
      pulseControls(true);
      return;
    }

    if (event.key === "Escape" && document.fullscreenElement === playerShellRef.current) {
      event.preventDefault();
      void document.exitFullscreen();
    }
  }

  const isReady = status !== "idle" && status !== "loading" && status !== "error";
  const isPlaying = status === "playing";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div
        ref={playerShellRef}
        className={`relative ${isFullscreen ? "fixed inset-0 z-50 bg-black" : "space-y-4"}`}
        onDoubleClick={() => {
          void toggleFullscreen();
        }}
        onMouseMove={() => pulseControls()}
        onPointerDown={() => pulseControls(true)}
        onKeyDown={handleShellKeyDown}
        tabIndex={0}
      >
        <div
          className={`relative overflow-hidden bg-black shadow-[var(--shadow)] ${
            isFullscreen
              ? "h-full w-full"
              : "rounded-[1.5rem] border border-white/8"
          }`}
        >
          <div className={`${isFullscreen ? "h-full" : "aspect-video"} w-full`}>
            <div className="h-full w-full" id="en-frame" />
          </div>

          {!nativeControlsEnabled ? (
            <div aria-hidden="true" className="absolute inset-0 z-10" />
          ) : null}

          <div
            className={`pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3 transition duration-200 ${
              !isFullscreen || controlsVisible
                ? "opacity-100"
                : "translate-y-2 opacity-0"
            }`}
          >
            <span className="rounded-full border border-white/10 bg-black/55 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.22em] text-white/80 backdrop-blur">
              {nativeControlsEnabled ? "Native controls on" : "EN video muted"}
            </span>
            <span className="rounded-full border border-accent/20 bg-accent-soft px-3 py-1 font-mono text-[11px] uppercase tracking-[0.22em] text-accent backdrop-blur">
              JP audio live
            </span>
          </div>

          {status === "loading" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-sm">
              <div className="rounded-full border border-white/10 bg-black/50 px-4 py-2 font-mono text-xs uppercase tracking-[0.28em] text-white/75">
                Loading embeds
              </div>
            </div>
          ) : null}
          <div
            className={`${
              isFullscreen
                ? "absolute inset-x-0 bottom-0 z-20 mx-4 mb-4"
                : "relative mt-4"
            } transition duration-200 ${
              !isFullscreen || controlsVisible
                ? "translate-y-0 opacity-100"
                : "translate-y-4 opacity-0"
            }`}
          >
        <div
          className={`rounded-[1.5rem] border border-white/8 bg-black/55 p-4 backdrop-blur-md ${
            isFullscreen ? "shadow-[var(--shadow)]" : "bg-black/20"
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="inline-flex min-h-11 min-w-28 items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
              disabled={!isReady}
              onClick={togglePlayback}
              type="button"
            >
              {isPlaying ? "Pause" : "Play both"}
            </button>

            <button
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 px-4 py-2 text-sm text-white transition hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:text-white/40"
              disabled={!isReady}
              onClick={resetSync}
              type="button"
            >
              Re-sync JP
            </button>

            <button
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 px-4 py-2 text-sm text-white transition hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:text-white/40"
              disabled={!isReady}
              onClick={() => setNativeControlsEnabled((value) => !value)}
              type="button"
            >
              {nativeControlsEnabled ? "Lock Video Clicks" : "Native CC"}
            </button>

            <button
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 px-4 py-2 text-sm text-white transition hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:text-white/40"
              disabled={!isReady}
              onClick={() => {
                void toggleFullscreen();
                pulseControls(true);
              }}
              type="button"
            >
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </button>

            <div className="ml-auto flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-2 font-mono text-xs uppercase tracking-[0.2em] text-muted">
              <span>Status</span>
              <span className="text-white">{status}</span>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <input
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[var(--accent)]"
              max={duration || 1}
              min={0}
              onChange={(event) => seek(Number(event.target.value))}
              step={0.05}
              type="range"
              value={Math.min(currentTime, duration || 1)}
            />
            <div className="flex items-center justify-between font-mono text-xs uppercase tracking-[0.18em] text-muted">
              <span>{formatClock(currentTime)}</span>
              <span>{formatClock(duration)}</span>
            </div>
          </div>
        </div>
          </div>
        </div>
      </div>

      <aside
        className={`space-y-4 rounded-[1.5rem] border border-white/8 bg-black/20 p-4 ${
          isFullscreen ? "hidden" : ""
        }`}
      >
        <div className="space-y-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-muted">
              JP volume
            </p>
            <div className="mt-3 flex items-center gap-3">
              <input
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[var(--accent)]"
                max={100}
                min={0}
                onChange={(event) => {
                  const nextVolume = Number(event.target.value);
                  setVolume(nextVolume);
                  jpPlayerRef.current?.setVolume(nextVolume);
                }}
                type="range"
                value={volume}
              />
              <span className="w-12 text-right font-mono text-sm text-white">
                {volume}%
              </span>
            </div>
          </div>

          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-muted">
              JP offset
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-white transition hover:border-white/20 hover:bg-white/5"
                onClick={() => setOffsetMs((value) => value - 100)}
                type="button"
              >
                -100ms
              </button>
              <div className="flex items-center justify-center rounded-2xl bg-white/5 px-3 py-2 font-mono text-sm text-accent">
                {offsetMs > 0 ? "+" : ""}
                {offsetMs}ms
              </div>
              <button
                className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-white transition hover:border-white/20 hover:bg-white/5"
                onClick={() => setOffsetMs((value) => value + 100)}
                type="button"
              >
                +100ms
              </button>
            </div>
            <p className="mt-2 text-xs leading-6 text-muted">
              Positive values push the JP audio later. Negative values pull it
              earlier.
            </p>
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-muted">
              Live drift
            </p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {driftMs > 0 ? "+" : ""}
              {driftMs}ms
            </p>
            <p className="mt-2 text-xs leading-6 text-muted">
              If drift exceeds roughly 280ms, the hidden JP player gets snapped
              back to the target timeline.
            </p>
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-xs leading-6 text-muted">
            Subtitles are not forced on anymore. Click{" "}
            <span className="text-white">Native CC</span> when you want
            YouTube&apos;s own caption toggle, then click{" "}
            <span className="text-white">Lock Video Clicks</span> to return to
            the app-only controls.
          </div>

          {error ? (
            <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm text-red-100">
              {error}
            </div>
          ) : null}
        </div>
      </aside>

      <div className="fixed left-[-9999px] top-0 h-[225px] w-[400px] overflow-hidden opacity-[0.01]">
        <div id="jp-frame" />
      </div>
    </div>
  );
}
