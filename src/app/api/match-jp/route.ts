import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.YT_KEY;
const MAX_RECENT_VIDEOS = 100;

const CHANNELS = {
  en: {
    channelId: "UC0Bi5KMcECRVYis5Gb_ZYZQ",
    handle: "@WutheringWaves",
  },
  jp: {
    channelId: "UCGc93NguHRwzv1Rw9MyIcxQ",
    handle: "@wutheringwaves3352",
  },
} as const;

type PlaylistVideo = {
  id: string;
  publishedAt: string;
  title: string;
};

type VideoDuration = {
  duration: string;
};

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "Missing YT_KEY in the server environment." },
      { status: 500 },
    );
  }

  const enVideoId = request.nextUrl.searchParams.get("enVideoId");

  if (!enVideoId) {
    return NextResponse.json(
      { error: "No English video ID was provided." },
      { status: 400 },
    );
  }

  try {
    const [enVideos, jpVideos] = await Promise.all([
      getPlaylistVideos(toUploadsPlaylist(CHANNELS.en.channelId), MAX_RECENT_VIDEOS),
      getPlaylistVideos(toUploadsPlaylist(CHANNELS.jp.channelId), MAX_RECENT_VIDEOS),
    ]);

    const position = enVideos.findIndex((video) => video.id === enVideoId);

    if (position === -1) {
      return NextResponse.json(
        {
          error: `That EN video was not found in the most recent ${MAX_RECENT_VIDEOS} uploads for ${CHANNELS.en.handle}.`,
        },
        { status: 404 },
      );
    }

    const jpMatch = jpVideos[position];
    if (!jpMatch) {
      return NextResponse.json(
        {
          error: `The JP channel does not have a video at position ${position + 1}.`,
        },
        { status: 404 },
      );
    }

    const [enDetails, jpDetails] = await Promise.all([
      getVideoDetails(enVideoId),
      getVideoDetails(jpMatch.id),
    ]);

    const enDuration = formatDuration(enDetails.duration);
    const jpDuration = formatDuration(jpDetails.duration);

    return NextResponse.json({
      durationMatches: enDuration === jpDuration,
      enDuration,
      enTitle: enVideos[position].title,
      jpDuration,
      jpTitle: jpMatch.title,
      jpVideoId: jpMatch.id,
      position: position + 1,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "The matcher request failed.",
      },
      { status: 500 },
    );
  }
}

function toUploadsPlaylist(channelId: string) {
  return channelId.replace(/^UC/, "UU");
}

async function getPlaylistVideos(
  playlistId: string,
  maxResults: number,
): Promise<PlaylistVideo[]> {
  const videos: PlaylistVideo[] = [];
  let pageToken = "";

  while (videos.length < maxResults) {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("maxResults", String(Math.min(50, maxResults - videos.length)));
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("key", API_KEY!);

    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const data = await youtubeGet<{
      items?: Array<{
        snippet?: {
          publishedAt?: string;
          resourceId?: {
            videoId?: string;
          };
          title?: string;
        };
      }>;
      nextPageToken?: string;
    }>(url);

    if (!data.items?.length) {
      break;
    }

    for (const item of data.items) {
      const videoId = item.snippet?.resourceId?.videoId;
      if (!videoId) {
        continue;
      }

      videos.push({
        id: videoId,
        publishedAt: item.snippet?.publishedAt ?? "",
        title: item.snippet?.title ?? "Untitled video",
      });
    }

    pageToken = data.nextPageToken ?? "";
    if (!pageToken) {
      break;
    }
  }

  return videos;
}

async function getVideoDetails(videoId: string): Promise<VideoDuration> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "contentDetails");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", API_KEY!);

  const data = await youtubeGet<{
    items?: Array<{
      contentDetails?: {
        duration?: string;
      };
    }>;
  }>(url);

  return {
    duration: data.items?.[0]?.contentDetails?.duration ?? "PT0S",
  };
}

async function youtubeGet<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
  });

  const payload = (await response.json()) as T & {
    error?: {
      message?: string;
    };
  };

  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? "YouTube returned an unexpected response.",
    );
  }

  return payload;
}

function formatDuration(isoDuration: string): string {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);

  if (!match) {
    return isoDuration;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
