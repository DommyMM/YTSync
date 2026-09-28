"use client";

import { useEffect, useRef, useState } from "react";

type Player = {
  destroy(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  isMuted(): boolean;
  mute(): void;
  unMute(): void;
  pauseVideo(): void;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  setVolume(volume: number): void;
};
type PlayerEvents = {
  onReady?(): void;
  onStateChange?(event: { data: number }): void;
  onPlaybackRateChange?(event: { data: number }): void;
  onError?(event: { data: number }): void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        host: HTMLElement,
        config: {
          videoId: string;
          width?: string;
          height?: string;
          playerVars?: Record<string, number>;
          events?: PlayerEvents;
        },
      ) => Player;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;
const ENDED = 0;

const TICK_MS = 250;
// Reported times arrive over postMessage and jitter, so only a gap held for STRIKES ticks triggers a seek
const DRIFT_LIMIT_S = 0.3;
const STRIKES = 4;
// Both players report stale times for a moment after a seek
const SETTLE_MS = 1500;
// Ticks the JP player may sit idle while EN plays before it counts as autoplay-blocked
const BLOCKED_TICKS = 8;
const HOLD_TIMEOUT_MS = 5000;

let apiReady: Promise<void> | undefined;
function loadApi() {
  apiReady ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve();
    window.onYouTubeIframeAPIReady = () => resolve();
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.append(script);
  });
  return apiReady;
}

type Status =
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "waiting"
  | "blocked"
  | "error";

/**
 * Visible EN embed with a hidden JP embed slaved to its clock
 * - offsetMs: positive plays the JP voice later
 * - volume: JP volume, 0 to 100. The EN player stays muted
 */
export default function DualPlayer({
  enId,
  jpId,
  offsetMs,
  volume,
}: {
  enId: string;
  jpId: string;
  offsetMs: number;
  volume: number;
}) {
  const enMount = useRef<HTMLDivElement>(null);
  const jpMount = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(offsetMs);
  const volumeRef = useRef(volume);
  const resyncRef = useRef<() => void>(() => {});
  const jpRef = useRef<Player | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [driftMs, setDriftMs] = useState(0);

  useEffect(() => {
    offsetRef.current = offsetMs;
    resyncRef.current();
  }, [offsetMs]);

  useEffect(() => {
    volumeRef.current = volume;
    jpRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    let cancelled = false;
    let en: Player | null = null;
    let jp: Player | null = null;
    let readyCount = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let settleUntil = 0;
    let strikes = 0;
    let idleTicks = 0;
    let smoothed = 0;
    // EN is paused by us while JP buffers, and its PAUSED event must not pause JP
    let holding = false;
    // EN resumes after a hold, and its PLAYING event must not seek JP again
    let resuming = false;
    setStatus("loading");
    setError("");

    const ready = () => readyCount === 2 && !cancelled;
    const target = () => Math.max(0, en!.getCurrentTime() - offsetRef.current / 1000);

    function snap() {
      jp!.seekTo(target(), true);
      settleUntil = performance.now() + SETTLE_MS;
      strikes = 0;
    }

    function release() {
      clearTimeout(holdTimer);
      if (!holding) return;
      holding = false;
      resuming = true;
      en!.playVideo();
    }

    function tick() {
      if (!ready() || en!.getPlayerState() !== PLAYING) return;
      // YouTube's own volume control on EN would double the audio
      if (!en!.isMuted()) en!.mute();
      if (jp!.isMuted()) jp!.unMute();
      const jpState = jp!.getPlayerState();
      if (jpState !== PLAYING && jpState !== BUFFERING) {
        jp!.playVideo();
        if (++idleTicks === BLOCKED_TICKS) setStatus("blocked");
        return;
      }
      if (idleTicks >= BLOCKED_TICKS) setStatus("playing");
      idleTicks = 0;
      const drift = jp!.getCurrentTime() - target();
      smoothed = smoothed * 0.7 + drift * 0.3;
      setDriftMs(Math.round(smoothed * 1000));
      if (performance.now() < settleUntil) return;
      strikes = Math.abs(drift) > DRIFT_LIMIT_S ? strikes + 1 : 0;
      if (strikes >= STRIKES) snap();
    }

    function onEnState({ data }: { data: number }) {
      if (!ready()) return;
      if (data === PLAYING) {
        if (resuming) {
          resuming = false;
          settleUntil = performance.now() + SETTLE_MS;
        } else snap();
        jp!.playVideo();
        idleTicks = 0;
        setStatus("playing");
      } else if (data === PAUSED && !holding) {
        jp!.pauseVideo();
        setStatus("paused");
      } else if (data === BUFFERING) {
        jp!.pauseVideo();
      } else if (data === ENDED) {
        jp!.pauseVideo();
        setStatus("ready");
      }
    }

    function onJpState({ data }: { data: number }) {
      if (!ready()) return;
      if (data === BUFFERING && en!.getPlayerState() === PLAYING) {
        holding = true;
        en!.pauseVideo();
        setStatus("waiting");
        holdTimer = setTimeout(release, HOLD_TIMEOUT_MS);
      } else if (data === PLAYING) release();
    }

    function onReady() {
      if (++readyCount < 2 || cancelled) return;
      en!.mute();
      jp!.unMute();
      jp!.setVolume(volumeRef.current);
      jpRef.current = jp;
      resyncRef.current = () => {
        if (!ready() || en!.getPlayerState() !== PLAYING) return;
        snap();
        jp!.playVideo();
        idleTicks = 0;
        setStatus("playing");
      };
      timer = setInterval(tick, TICK_MS);
      setStatus("ready");
    }

    function onError(which: string) {
      return ({ data }: { data: number }) => {
        if (cancelled) return;
        // 101 and 150 mean the uploader disabled embedding
        setError(
          data === 101 || data === 150
            ? `The ${which} upload can't be embedded.`
            : `YouTube couldn't load the ${which} upload.`,
        );
        setStatus("error");
      };
    }

    function onVisible() {
      if (!document.hidden) resyncRef.current();
    }

    void loadApi().then(() => {
      if (cancelled || !window.YT || !enMount.current || !jpMount.current) return;
      const enHost = document.createElement("div");
      const jpHost = document.createElement("div");
      enMount.current.replaceChildren(enHost);
      jpMount.current.replaceChildren(jpHost);
      en = new window.YT.Player(enHost, {
        videoId: enId,
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, rel: 0 },
        events: {
          onReady,
          onStateChange: onEnState,
          onPlaybackRateChange: ({ data }) => jp?.setPlaybackRate(data),
          onError: onError("English"),
        },
      });
      jp = new window.YT.Player(jpHost, {
        videoId: jpId,
        // Tiny frame so YouTube streams the lowest picture quality
        width: "200",
        height: "113",
        playerVars: { controls: 0, disablekb: 1, playsinline: 1 },
        events: {
          onReady,
          onStateChange: onJpState,
          onError: onError("Japanese"),
        },
      });
    });
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(holdTimer);
      document.removeEventListener("visibilitychange", onVisible);
      resyncRef.current = () => {};
      jpRef.current = null;
      en?.destroy();
      jp?.destroy();
    };
  }, [enId, jpId]);

  const message = {
    loading: "Loading players",
    ready: "Press play on the video",
    playing:
      Math.abs(driftMs) < 80
        ? "In sync"
        : `Voice ${Math.abs(driftMs)} ms ${driftMs > 0 ? "ahead" : "behind"}`,
    paused: "Paused",
    waiting: "Waiting for the Japanese audio to buffer",
    blocked: "The browser held back the Japanese audio. Press Resync.",
    error,
  }[status];

  return (
    <>
      <div className="screen" ref={enMount} />
      <div className="status">
        <span
          className={`dot ${status === "playing" ? "is-ready" : ""} ${status === "loading" || status === "waiting" ? "is-busy" : ""} ${status === "error" || status === "blocked" ? "is-error" : ""}`}
        />
        <span role="status">{message}</span>
        <button
          className="text-button resync"
          type="button"
          disabled={status !== "playing" && status !== "blocked"}
          onClick={() => {
            if (status === "blocked") setStatus("playing");
            resyncRef.current();
          }}
        >
          Resync
        </button>
      </div>
      <div className="offscreen" ref={jpMount} aria-hidden="true" />
    </>
  );
}
