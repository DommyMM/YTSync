"use client";

import { useRef, useState } from "react";
import DualPlayer from "@/components/DualPlayer";
import {
  EXAMPLE,
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

function Bars() {
  return (
    <span className="bars" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export default function Home() {
  const [enUrl, setEnUrl] = useState(watchUrl(EXAMPLE.enId));
  const [jpUrl, setJpUrl] = useState(watchUrl(EXAMPLE.jpId));
  const [pair, setPair] = useState<{ en: string; jp: string } | null>({
    en: EXAMPLE.enId,
    jp: EXAMPLE.jpId,
  });
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

      <div className="studio">
        <section className="screening" aria-label="Player">
          {pair ? (
            <DualPlayer
              enId={pair.en}
              jpId={pair.jp}
              offsetMs={offset}
              volume={volume}
            />
          ) : (
            <>
              <div className="screen is-empty">
                {enId ? (
                  <div
                    className="poster"
                    style={{
                      backgroundImage: `url(${thumbUrl(enId, "maxresdefault")})`,
                    }}
                  />
                ) : null}
              </div>
              <div className="status">
                <span className={`dot ${matching ? "is-busy" : ""}`} />
                <span role="status">
                  {matching
                    ? "Finding the Japanese upload"
                    : enId
                      ? "Paste the Japanese link"
                      : "Paste an English link"}
                </span>
              </div>
            </>
          )}
        </section>

        <aside className="panel">
          <div className="source">
            <label htmlFor="en-url">English picture</label>
            <SourceThumb id={enId} />
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
              placeholder="YouTube link"
            />
          </div>
          <div className="source is-voice">
            <label htmlFor="jp-url">Japanese voice</label>
            <SourceThumb id={jpId} voice />
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
              placeholder={matching ? "Matching" : "YouTube link"}
            />
          </div>

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

          {others.length ? (
            <div className="others">
              <p className="field-label">Other Japanese uploads that day</p>
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
                  <span>
                    {c.title}
                    <small>
                      {gap(c.publishGap)} apart, {lengthNote(c.lengthDiff)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <label className="field-label" htmlFor="volume">
            Voice volume
          </label>
          <input
            id="volume"
            className="volume"
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />

          <label className="field-label" htmlFor="offset">
            Voice offset
          </label>
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
        </aside>
      </div>
    </main>
  );
}

/** Thumbnail proving the link parsed. The voice one is greyed since only its sound is used */
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
    >
      {voice ? <Bars /> : null}
    </a>
  );
}
