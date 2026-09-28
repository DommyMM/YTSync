/** Prefilled pair: Hsin showcase, EN picture and JP voice */
export const EXAMPLE = { enId: "a3zMk49qpwI", jpId: "L1nJ56KZjlM" };

/** JP upload that could pair with the EN video */
export type Candidate = {
  id: string;
  title: string;
  /** Seconds the JP upload went live after the EN one, negative if before */
  publishGap: number;
  /** JP length minus EN length, in seconds */
  lengthDiff: number;
};

/** Matcher response. Candidates are best first */
export type Match = { enTitle: string; candidates: Candidate[] };

export function isVideoId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{11}$/.test(value);
}

/** Video ID from a bare ID or YouTube URL, "" for anything else */
export function extractVideoId(input: string): string {
  const value = input.trim();
  if (isVideoId(value)) return value;
  try {
    const url = new URL(value);
    let id: string | null | undefined;
    if (url.hostname === "youtu.be") id = url.pathname.split("/")[1];
    else if (
      ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
    )
      id =
        url.pathname === "/watch"
          ? url.searchParams.get("v")
          : url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/)?.[1];
    return isVideoId(id) ? id : "";
  } catch {
    return "";
  }
}

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export const thumbUrl = (id: string, size: "mqdefault" | "maxresdefault") =>
  `https://i.ytimg.com/vi/${id}/${size}.jpg`;
