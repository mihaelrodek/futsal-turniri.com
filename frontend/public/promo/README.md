# Promo clip (home page hero)

`zamuda_primavita_highlights.mp4` - the sample recording on the "buy a
recording" slide. That exact name is what `PROMO_VIDEO_SRC` in
`src/pages/TournamentsPage.tsx` points at.

Anything in `public/` is copied to the site root as-is, so the file is served
at `/promo/zamuda_primavita_highlights.mp4` by the edge container, not the API.

## Encoding rules for whatever replaces it

It autoplays, muted and looping, on the home page, so it is downloaded by every
visitor who reaches that slide. Two hard requirements:

- **H.264 (`avc1`), 8-bit, in an .mp4.** The camera original was HEVC 10-bit,
  which Safari plays and Chrome/Firefox mostly do not - it would have been a
  blank box for most visitors.
- **`+faststart`.** Puts the index at the head of the file so playback can
  begin before the whole thing has downloaded.

The current file: 1:59, 1280x720, ~790 kb/s video + 96 kb/s audio, 13 MB - down
from a 106 MB HEVC original, with no visible loss at the size it is played.

Re-encode with:

```sh
ffmpeg -i original.mp4 -vf "scale=1280:-2" \
  -c:v libx264 -crf 29 -preset slow -profile:v high -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags +faststart \
  zamuda_primavita_highlights.mp4
```

Lower `-crf` for more quality (26 ~ 19 MB), higher one or `scale=960:-2` for
less (crf 30 ~ 6 MB). GitHub rejects any single file over 100 MB.

To turn the clip off entirely, set `PROMO_VIDEO_SRC = ""` - the slide then falls
back to the faux package cards instead of showing a black box.
