"use client";

import { useRef, useState } from "react";
import DualPlayer, { Bars } from "@/components/DualPlayer";
import {
  extractVideoId,
  thumbUrl,
  watchUrl,
  type Candidate,
  type Match,
} from "@/lib/youtube";

const OFFSET_LIMIT = 5000;
const OFFSET_STEP = 50;

const clampOffset = (ms: number) =>
  Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, Math.round(ms) || 0));

function gap(seconds: number) {
  const s = Math.abs(seconds);
  return s < 60
    ? `${s} s`
    : s < 3600
      ? `${Math.round(s / 60)} min`
      : `${Math.round(s / 3600)} h`;
}

function lengthNote(diff: number) {
  return diff === 0
    ? "same length"
    : `${Math.abs(diff)} s ${diff > 0 ? "longer" : "shorter"}`;
}

export default function Home() {
  const [enUrl, setEnUrl] = useState("");
  const [jpUrl, setJpUrl] = useState("");
  const [pair, setPair] = useState<{ en: string; jp: string } | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState("");
  const [offset, setOffset] = useState(0);
  const [volume, setVolume] = useState(100);
  const pending = useRef<AbortController | null>(null);
  const enId = extractVideoId(enUrl);
  const jpId = extractVideoId(jpUrl);

  async function findMatch(id: string) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setMatching(true);
    setMatchError("");
    setMatch(null);
    setPair(null);
    setJpUrl("");
    try {
      const response = await fetch(`/api/match?en=${id}`, {
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const best: Candidate = result.candidates[0];
      setMatch(result);
      setJpUrl(watchUrl(best.id));
      setPair({ en: id, jp: best.id });
    } catch (err) {
      if (controller.signal.aborted) return;
      setMatchError(
        `${err instanceof Error && err.message ? err.message : "Match failed."} Paste the Japanese link.`,
      );
    } finally {
      if (!controller.signal.aborted) setMatching(false);
    }
  }

  function pickJp(id: string) {
    setJpUrl(watchUrl(id));
    if (enId) setPair({ en: enId, jp: id });
  }

  const current = match?.candidates.find((c) => c.id === pair?.jp);
  const others = match?.candidates.filter((c) => c.id !== pair?.jp) ?? [];

  return (
    <main className="shell">
      <header className="masthead">
        <Bars />
        <span className="wordmark">YTSync</span>
      </header>

      <section className="bay" aria-label="Sources">
        <div className="source is-picture">
          <span className="glyph" lang="ja" aria-hidden="true">
            映
          </span>
          <label htmlFor="en-url">English picture</label>
          <input
            id="en-url"
            value={enUrl}
            onChange={(event) => {
              setEnUrl(event.target.value);
              const id = extractVideoId(event.target.value);
              if (id && id !== pair?.en) void findMatch(id);
            }}
            spellCheck={false}
            autoComplete="off"
            placeholder="Paste a YouTube link"
          />
          <SourceThumb id={enId} />
        </div>

        <div className="source is-voice">
          <span className="glyph" lang="ja" aria-hidden="true">
            音
          </span>
          <label htmlFor="jp-url">Japanese voice</label>
          <input
            id="jp-url"
            value={jpUrl}
            onChange={(event) => {
              setJpUrl(event.target.value);
              const id = extractVideoId(event.target.value);
              if (id && enId) setPair({ en: enId, jp: id });
            }}
            spellCheck={false}
            autoComplete="off"
            placeholder={matching ? "Matching" : "Found from the English link"}
          />
          <SourceThumb id={jpId} voice />
          {matchError ? (
            <p className="note is-error" role="alert">
              {matchError}
            </p>
          ) : current ? (
            <p
              className={`note ${Math.abs(current.lengthDiff) > 2 ? "is-error" : ""}`}
            >
              Matched by posting time: {gap(current.publishGap)} apart,{" "}
              {lengthNote(current.lengthDiff)}.
            </p>
          ) : null}
        </div>
      </section>

      <section className="theater" aria-label="Player">
        {pair ? (
          <DualPlayer
            key={`${pair.en}-${pair.jp}`}
            enId={pair.en}
            jpId={pair.jp}
            offsetMs={offset}
            volume={volume}
          />
        ) : (
          <div className="stage">
            <div className="curtain">
              {enId ? (
                <div
                  className="poster"
                  style={{
                    backgroundImage: `url(${thumbUrl(enId, "maxresdefault")})`,
                  }}
                />
              ) : null}
              <p className="curtain-note" role="status">
                {matching ? <Bars live /> : null}
                {matching
                  ? "Finding the Japanese upload"
                  : enId
                    ? "Paste the Japanese link to pair it"
                    : "Paste an English upload link to find its Japanese voice"}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="mixer" aria-label="Voice controls">
        <div className="control">
          <label htmlFor="volume">Voice volume</label>
          <div className="volume-row">
            <input
              id="volume"
              className="volume"
              type="range"
              min={0}
              max={100}
              value={volume}
              style={{ "--fill": `${volume}%` } as React.CSSProperties}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
            <output htmlFor="volume">{volume}</output>
          </div>
        </div>

        <div className="control">
          <label htmlFor="offset">Voice offset</label>
          <div className="offset">
            <button
              type="button"
              aria-label={`Play the voice ${OFFSET_STEP} ms earlier`}
              disabled={offset <= -OFFSET_LIMIT}
              onClick={() => setOffset((ms) => clampOffset(ms - OFFSET_STEP))}
            >
              −
            </button>
            <span className="offset-value">
              <input
                id="offset"
                type="number"
                min={-OFFSET_LIMIT}
                max={OFFSET_LIMIT}
                step={OFFSET_STEP}
                value={offset}
                onChange={(event) =>
                  setOffset(clampOffset(Number(event.target.value)))
                }
              />
              ms
            </span>
            <button
              type="button"
              aria-label={`Play the voice ${OFFSET_STEP} ms later`}
              disabled={offset >= OFFSET_LIMIT}
              onClick={() => setOffset((ms) => clampOffset(ms + OFFSET_STEP))}
            >
              +
            </button>
            {offset !== 0 ? (
              <button
                className="text-button"
                type="button"
                onClick={() => setOffset(0)}
              >
                Reset
              </button>
            ) : null}
          </div>
          <p className="hint">
            {offset === 0
              ? "Positive plays the voice later, negative earlier."
              : `Voice plays ${Math.abs(offset)} ms ${offset > 0 ? "later" : "earlier"}.`}
          </p>
        </div>
      </section>

      {others.length ? (
        <section className="others" aria-labelledby="others-title">
          <h2 id="others-title">Other Japanese uploads that day</h2>
          <div className="others-grid">
            {others.map((c) => (
              <button
                key={c.id}
                type="button"
                className="other"
                onClick={() => pickJp(c.id)}
              >
                <span
                  className="thumb"
                  style={{
                    backgroundImage: `url(${thumbUrl(c.id, "mqdefault")})`,
                  }}
                />
                <span className="other-title">{c.title}</span>
                <small>
                  {gap(c.publishGap)} apart, {lengthNote(c.lengthDiff)}
                </small>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

/** Thumbnail proving the link parsed. The voice one is dimmed since only its sound is used */
function SourceThumb({ id, voice = false }: { id: string; voice?: boolean }) {
  if (!id) return <span className="thumb" aria-hidden="true" />;
  return (
    <a
      className="thumb"
      href={watchUrl(id)}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open the ${voice ? "Japanese" : "English"} upload on YouTube`}
      style={{ backgroundImage: `url(${thumbUrl(id, "mqdefault")})` }}
    />
  );
}
