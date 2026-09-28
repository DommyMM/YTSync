# YTSync

Private app for watching Wuthering Waves uploads with the English picture and the Japanese voice track. Deploys to Vercel as is. Needs `YT_KEY` (YouTube Data API v3 key) in `.env` locally and in the Vercel project env.

## Matching

Pasting an English link asks `/api/match` for the Japanese upload. It ranks the JP channel's uploads posted within a day of the English one: same length (±2 s) wins, ties go to the closest posting time, and if nothing matches on length the closest length wins. Upload position isn't used because the channels post different extras, so positions drift apart. Titles aren't comparable across languages. The runners-up are listed under the fields, and pasting a Japanese link overrides the match.

## Playback

The English embed is visible and muted, and a hidden Japanese embed follows its clock (`src/components/DualPlayer.tsx`).

- Drift is corrected by seeking the Japanese player, only after the gap holds for about a second, since reported times jitter over postMessage.
- When the Japanese player buffers, the English one pauses until it catches up.
- The voice offset applies live. Positive plays the voice later.
- If the browser blocks the Japanese audio from autoplaying, Resync starts it from a click.
