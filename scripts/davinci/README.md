# DaVinci Resolve scoreboard overlays

Renders the SpectoStream player overlay (scoreboard, scorer/card chips, summary)
as transparent 1920x1080 PNGs for post-production editing in DaVinci Resolve.

- `overlay-render.html` — standalone overlay page; state is set via query
  parameters (full list in the comment at the top of the file). Transparent
  background, fixed 1920x1080 canvas, no network dependencies.
- `render-overlay.sh` — renders one state to a PNG via headless Chrome:

```bash
# Edit BASE in the script first (team names + kit colors), then:
./render-overlay.sh 'hg=0&ag=0&clock=00:00&period=1' 0-0.png
./render-overlay.sh 'hg=1&ag=0&clock=07:13&scorers=L. Modrić' 1-0.png
./render-overlay.sh 'summary=1&hg=2&ag=1&board=0' end.png
```

Resolve workflow: import PNGs → video track 2 above the match footage → blade
(Cmd+B) at each goal and swap in the next state. If text edges look dark:
right-click the PNG → Change Alpha Mode → Straight. Raise Preferences → User →
Editing → Standard still duration. Timeline must be 1920x1080.

The overlay is a static copy of the SpectoStream player look
(`wwwroot/player/player.js` upstream); if the player design changes, this file
does not follow automatically.

## Running match clock (Text+ expression)

Render the board states with `clock=` (hides the static clock), then add a live
counter in Resolve: Effects → Titles → **Text+** on a track above the board,
trimmed to the half. Right-click the **Styled Text** field in the Inspector →
**Expression**, paste:

```
:fps = comp:GetPrefs("Comp.FrameFormat.Rate"); t = floor(time/fps); Text(string.format("%02d:%02d", floor(t/60), t%60))
```

Second half (counts 12:00 → 24:00): same, with `t = floor(time/fps) + 720;`.

`time` starts at 0 at the head of the Text+ clip, so align the clip start with
the half's kickoff frame; cut the clip and bump the offset constant to skip
pauses. To mimic the board chip: Shading tab → Select Element 2 (Background),
dark fill (12,17,26 @ 88%), extend H/V, round the corners.
