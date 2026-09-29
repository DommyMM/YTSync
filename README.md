# YTSync

Private app for watching Wuthering Waves uploads with the English picture and the Japanese voice track. Deploys to Vercel as is. Needs `YT_KEY` (YouTube Data API v3 key) in `.env` locally and in the Vercel project env.

## Matching

Pasting an English link asks `/api/match` for the Japanese upload. It ranks the JP channel's uploads posted within a day of the English one: same length (±2 s) wins, ties go to the closest posting time, and if nothing matches on length the closest length wins. Upload position isn't used because the channels post different extras, so positions drift apart. Titles aren't comparable across languages. The runners-up are listed under the fields, and pasting a Japanese link overrides the match.

## Playback

The English embed is visible and muted, and a hidden Japanese embed follows its clock (`src/components/DualPlayer.tsx`).

- Nothing plays on its own. Both embeds play muted to their first frame, pause at 0 so each is buffered, and wait behind a Play button.
- Play starts both from the same click, so the browser lets the voice start with sound.
- The English player leads. Pausing or buffering it pauses the voice, and when it plays again the voice seeks only if it's off by more than 0.3 s.
- Drift is corrected by seeking the Japanese player, only after the gap holds for about a second, since reported times jitter over postMessage. Drift isn't counted while the voice buffers, because seeking would restart its load.
- The voice offset applies live. Positive plays the voice later.
- If the browser still blocks the voice, Resync starts it from a click.
