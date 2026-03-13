# YTSync

Private Next.js app for watching Wuthering Waves uploads with the English video
on screen and the Japanese upload providing audio underneath.

## Setup

1. Install dependencies.
2. Copy `.env.example` to `.env`.
3. Set `YT_KEY` to a YouTube Data API v3 key.
4. Run `npm run dev`.

## How it works

- The app reads the English channel uploads playlist.
- It finds the selected EN video by position.
- It takes the video in the same position from the JP uploads playlist.
- It verifies duration and then starts both embeds together.

## Scripts

- `npm run dev`
- `npm run lint`
- `npm run build`
