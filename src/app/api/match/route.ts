import { NextRequest, NextResponse } from "next/server";
import { isVideoId, type Candidate, type Match } from "@/lib/youtube";

const API = "https://www.googleapis.com/youtube/v3";
const JP_UPLOADS = "UUGc93NguHRwzv1Rw9MyIcxQ";
// Pairs go live within minutes of each other, a day also covers late JP uploads
const WINDOW_S = 24 * 3600;
// Length tolerance, since the same cut can differ by a second between encodes
const SAME_LENGTH_S = 2;
const MAX_PAGES = 40;

type Video = {
  id: string;
  snippet: { title: string; publishedAt: string };
  contentDetails: { duration: string };
};
type PlaylistPage = {
  items: { contentDetails: { videoId: string; videoPublishedAt?: string } }[];
  nextPageToken?: string;
};

async function youtube<T>(path: string, params: Record<string, string>) {
  const url = new URL(`${API}/${path}`);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  url.searchParams.set("key", process.env.YT_KEY ?? "");
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error?.message ?? `YouTube API ${response.status}`);
  return body as T;
}

/** ISO 8601 duration like PT4M49S to seconds */
function seconds(duration: string) {
  const [, h = 0, m = 0, s = 0] =
    /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(duration) ?? [];
  return +h * 3600 + +m * 60 + +s;
}

const epoch = (iso?: string) => Date.parse(iso ?? "") / 1000;

/** Rank JP uploads posted within a day of the EN one */
export async function GET(request: NextRequest) {
  const enId = request.nextUrl.searchParams.get("en");
  if (!isVideoId(enId))
    return NextResponse.json({ error: "Not a video ID." }, { status: 400 });
  if (!process.env.YT_KEY)
    return NextResponse.json({ error: "YT_KEY is not set." }, { status: 500 });

  try {
    const {
      items: [en],
    } = await youtube<{ items: Video[] }>("videos", {
      part: "snippet,contentDetails",
      id: enId,
    });
    if (!en)
      return NextResponse.json(
        { error: "That video is private or doesn't exist." },
        { status: 404 },
      );
    const enTime = epoch(en.snippet.publishedAt);
    const enLength = seconds(en.contentDetails.duration);

    // Upload order drifts between channels, so match on time instead of position
    const nearby: string[] = [];
    let pageToken = "";
    for (let page = 0; page < MAX_PAGES; page++) {
      const list = await youtube<PlaylistPage>("playlistItems", {
        part: "contentDetails",
        playlistId: JP_UPLOADS,
        maxResults: "50",
        ...(pageToken && { pageToken }),
      });
      for (const { contentDetails } of list.items)
        if (Math.abs(epoch(contentDetails.videoPublishedAt) - enTime) <= WINDOW_S)
          nearby.push(contentDetails.videoId);
      // Uploads are newest first, so a page ending before the window ends the search
      const oldest = epoch(list.items.at(-1)?.contentDetails.videoPublishedAt);
      if (oldest < enTime - WINDOW_S || !list.nextPageToken) break;
      pageToken = list.nextPageToken;
    }
    if (!nearby.length)
      return NextResponse.json(
        { error: "No Japanese upload within a day of this one." },
        { status: 404 },
      );

    const { items } = await youtube<{ items: Video[] }>("videos", {
      part: "snippet,contentDetails",
      id: nearby.slice(0, 50).join(","),
    });
    const offLength = (c: Candidate) =>
      Number(Math.abs(c.lengthDiff) > SAME_LENGTH_S);
    const candidates = items
      .map(
        (video): Candidate => ({
          id: video.id,
          title: video.snippet.title,
          publishGap: Math.round(epoch(video.snippet.publishedAt) - enTime),
          lengthDiff: seconds(video.contentDetails.duration) - enLength,
        }),
      )
      // Same-length uploads by posting time, the rest by closest length since a longer dub beats a nearby short
      .sort(
        (a, b) =>
          offLength(a) - offLength(b) ||
          (offLength(a)
            ? Math.abs(a.lengthDiff) - Math.abs(b.lengthDiff)
            : Math.abs(a.publishGap) - Math.abs(b.publishGap)),
      )
      .slice(0, 4);

    const match: Match = { enTitle: en.snippet.title, candidates };
    // Short cache since the JP upload may not be live yet
    return NextResponse.json(match, {
      headers: { "Cache-Control": "public, s-maxage=3600" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Match failed." },
      { status: 502 },
    );
  }
}
