"use client";

import { useEffect, useRef, useState } from "react";
import { thumbUrl } from "@/lib/youtube";

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
// Priming gives up after this so a browser that refuses muted playback still gets a Play button
const PRIME_TIMEOUT_MS = 8000;
// Drift the meter spans on each side of center
const METER_RANGE_MS = 500;
const IN_SYNC_MS = 80;

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
  | "priming"
  | "ready"
  | "playing"
  | "paused"
  | "blocked"
  | "error";

/**
 * Visible EN embed with a hidden JP embed slaved to its clock. Both prebuffer muted and wait for Play
 * - Key it by the pair, since state isn't reset when the IDs change
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
  const startRef = useRef<() => void>(() => {});
  const jpRef = useRef<Player | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [started, setStarted] = useState(false);
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
    let primed = 0;
    let begun = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let primeTimer: ReturnType<typeof setTimeout> | undefined;
    let settleUntil = 0;
    let strikes = 0;
    let idleTicks = 0;
    let smoothed = 0;

    const live = () => readyCount === 2 && begun && !cancelled;
    const target = () => Math.max(0, en!.getCurrentTime() - offsetRef.current / 1000);

    function snap() {
      jp!.seekTo(target(), true);
      settleUntil = performance.now() + SETTLE_MS;
      strikes = 0;
      smoothed = 0;
    }

    function follow() {
      if (Math.abs(jp!.getCurrentTime() - target()) > DRIFT_LIMIT_S) snap();
      jp!.playVideo();
      idleTicks = 0;
      setStatus("playing");
    }

    function tick() {
      if (!live() || en!.getPlayerState() !== PLAYING) return;
      // YouTube's own volume control on EN would double the audio
      if (!en!.isMuted()) en!.mute();
      const jpState = jp!.getPlayerState();
      if (jpState !== PLAYING && jpState !== BUFFERING) {
        if (idleTicks < BLOCKED_TICKS) jp!.playVideo();
        if (++idleTicks === BLOCKED_TICKS) setStatus("blocked");
        return;
      }
      if (idleTicks >= BLOCKED_TICKS) setStatus("playing");
      idleTicks = 0;
      // Seeking a buffering player restarts its load, so drift only counts once it plays
      if (jpState === BUFFERING) return;
      const drift = jp!.getCurrentTime() - target();
      smoothed = smoothed * 0.7 + drift * 0.3;
      setDriftMs(Math.round(smoothed * 1000));
      if (performance.now() < settleUntil) return;
      strikes = Math.abs(drift) > DRIFT_LIMIT_S ? strikes + 1 : 0;
      if (strikes >= STRIKES) snap();
    }

    function finishPriming() {
      clearTimeout(primeTimer);
      if (cancelled || begun) return;
      en!.pauseVideo();
      jp!.pauseVideo();
      en!.seekTo(0, true);
      jp!.seekTo(0, true);
      setStatus("ready");
    }

    // Muted play until the first frame, then pause at 0, so both streams are buffered before Play
    function primer(player: () => Player) {
      let done = false;
      return ({ data }: { data: number }) => {
        if (done || data !== PLAYING) return;
        done = true;
        player().pauseVideo();
        if (++primed === 2) finishPriming();
      };
    }

    const primeEn = primer(() => en!);
    const primeJp = primer(() => jp!);

    function onEnState(event: { data: number }) {
      if (!begun) return primeEn(event);
      if (!live()) return;
      const { data } = event;
      if (data === PLAYING) follow();
      else if (data === PAUSED || data === BUFFERING) {
        jp!.pauseVideo();
        if (data === PAUSED) setStatus("paused");
      } else if (data === ENDED) {
        jp!.pauseVideo();
        setStatus("paused");
      }
    }

    function onJpState(event: { data: number }) {
      if (!begun) primeJp(event);
    }

    function onReady() {
      if (++readyCount < 2 || cancelled) return;
      en!.mute();
      jp!.mute();
      jp!.setVolume(volumeRef.current);
      jpRef.current = jp;
      resyncRef.current = () => {
        if (!live() || en!.getPlayerState() !== PLAYING) return;
        snap();
        follow();
      };
      startRef.current = () => {
        if (cancelled || readyCount < 2 || begun) return;
        clearTimeout(primeTimer);
        begun = true;
        setStarted(true);
        jp!.unMute();
        jp!.setVolume(volumeRef.current);
        // Seeking without need would throw away the prebuffered start
        if (Math.abs(jp!.getCurrentTime() - target()) > DRIFT_LIMIT_S) snap();
        // Both calls run inside the Play click so the browser lets the voice start with sound
        en!.playVideo();
        jp!.playVideo();
      };
      timer = setInterval(tick, TICK_MS);
      setStatus("priming");
      primeTimer = setTimeout(finishPriming, PRIME_TIMEOUT_MS);
      en!.playVideo();
      jp!.playVideo();
    }

    function onError(which: string) {
      return ({ data }: { data: number }) => {
        if (cancelled) return;
        clearTimeout(primeTimer);
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
      clearTimeout(primeTimer);
      document.removeEventListener("visibilitychange", onVisible);
      resyncRef.current = () => {};
      startRef.current = () => {};
      jpRef.current = null;
      en?.destroy();
      jp?.destroy();
    };
  }, [enId, jpId]);

  const inSync = Math.abs(driftMs) < IN_SYNC_MS;
  const message = {
    loading: "Loading both uploads",
    priming: "Buffering the picture and the voice",
    ready: "Ready. Both tracks are buffered.",
    playing: inSync
      ? "In sync"
      : `Voice ${Math.abs(driftMs)} ms ${driftMs > 0 ? "ahead" : "behind"}`,
    paused: "Paused",
    blocked: "The browser held back the voice. Press Resync.",
    error,
  }[status];
  const measuring = status === "playing";
  const needle = Math.max(-1, Math.min(1, driftMs / METER_RANGE_MS)) * 50;

  return (
    <>
      <div className="stage">
        <div className="screen" ref={enMount} />
        <div
          className={`curtain ${started ? "is-lifted" : ""}`}
          aria-hidden={started}
        >
          <div
            className="poster"
            style={{ backgroundImage: `url(${thumbUrl(enId, "maxresdefault")})` }}
          />
          {status === "error" ? (
            <p className="curtain-note is-error" role="alert">
              {error}
            </p>
          ) : status === "ready" ? (
            <button
              type="button"
              className="play"
              onClick={() => startRef.current()}
              disabled={started}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5.5v13l10.5-6.5z" />
              </svg>
              Play
            </button>
          ) : (
            <p className="curtain-note" role="status">
              <Bars live />
              {message}
            </p>
          )}
        </div>
      </div>

      <div
        className={`meter ${measuring ? "is-live" : ""} ${measuring && inSync ? "is-synced" : ""} ${status === "error" || status === "blocked" ? "is-error" : ""}`}
      >
        <p role="status" className="meter-status">
          {started ? message : "Sync starts on Play"}
        </p>
        <div className="meter-track" aria-hidden="true">
          <span className="meter-zero" />
          <span
            className="meter-needle"
            style={{ transform: `translateX(${measuring ? needle : 0}cqw)` }}
          />
        </div>
        <button
          className="text-button"
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

/** Four level bars, the app's mark. Live ones bounce while something loads */
export function Bars({ live = false }: { live?: boolean }) {
  return (
    <span className={`bars ${live ? "is-live" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
