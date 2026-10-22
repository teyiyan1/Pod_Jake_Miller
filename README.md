# Jake Miller Encore

This is an editable reconstruction of the Encore listening-room page. The original source directory was a temporary Codex file-preview folder and is no longer present. This project was recreated from retained screenshots, task notes, and cached Apple Music catalog metadata; it is not a byte-for-byte recovery of the deleted source.

## Run

Open a terminal in this folder and run:

```sh
npm test
npm run serve
```

Then open `http://127.0.0.1:8766/`.

## Source files

- `index.html`: page structure and dialogs
- `styles.css`: responsive layout and Cover Flow presentation
- `app.js`: YouTube playback, carousel, and lyric import
- `data/tracks.js`: editable 27-track setlist and Apple Music artwork metadata
- `vendor/lucide.min.js`: locally bundled Lucide icons (license in `vendor/LICENSE`)

## Vynora UI

The current interface adapts the user's downloaded Vynora (Community) Make source: black iPod header, inset search, Cover Flow transforms, reflected covers, track metadata and large playback controls. The source archive was inspected at `../Vynora_Make_Source`. The previous Encore source is backed up at `../Jake_Miller_Encore-before-vynora-20261022.zip`.

Unlike the reference's zero-size hidden audio player and additional background iframe, this version uses a single visible YouTube player with its own controls. Playback starts only following an explicit user action; the app does not claim music is playing until the player reports it. Unknown or blocked video sources are not silently replaced.

The main control only requests in-page playback or pause; it never opens a source editor or an external page. On playback, the single visible YouTube iframe replaces the center album cover. There is no separate YouTube information card or pending-source placeholder. Idle browsing shows artwork. The native player stays visible during playback and on playback errors, including any verification message from YouTube.

Missing sources and unavailable API connections have an explicitly disabled play control with a short status. A video playback error offers a manual retry through the play button, with no automatic retry loop. Clicking before the API is ready queues one playback request, canceled on connection failure or navigation to another track. Browser autoplay refusal leaves the native controls visible. None of these UI changes bypass platform restrictions or guarantee full playback.

The header's link button opens a per-track YouTube source editor. Valid YouTube URLs or video IDs are stored only in the current browser. The lyrics button opens locally imported, per-track LRC/TXT text. Both the existing selected-track and lyrics storage keys are retained.

For browser regression checks, run `npm install` and `npm run test:browser` while the preview server is running. These checks mock the YouTube API and validate controls, source association, search, lyric persistence and desktop/mobile layout; they do not verify real video availability or full-song playback. The script uses installed Chrome on macOS or `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when provided.

The setlist is reconstructed from cached artist/catalog data and the retained screen captures. Check it against the original before treating its order as canonical. Only `Parties` has a retained original listening note; no other note copy was invented.

## Shared Video Sources

23 of the 27 tracks now have publisher/title-confirmed YouTube IDs in `data/tracks.js`, so these associations travel with the source code rather than existing only in one browser. This includes `Answers`, linked to `Kr1xzr_dQ4Y`.

Still pending: `ROSS AND RACHEL`, `Momentum`, `Waiting On August`, and `Spark`. No unrelated video or unconfirmed third-party lyric upload is substituted for these tracks.

The current automated playback environment requested sign-in verification ("Sign in to confirm you're not a bot"), including for the previously working `Parties` control. This prevented reliable bulk runtime verification. Source matching is not a guarantee of full playback; the recorded error-150 attempts must not be interpreted as proof that every video owner disallows embedding.

After moving playback into the center cover, a separate real-browser check on October 22, 2026 successfully started `Parties` from the main button and observed player state 1 at 9.35 seconds. See `research/cover-player-smoke.json`. This is a single playback-start sample, not certification of a complete song or the whole catalog; the earlier environment failures remain relevant.

Subsequent user-reported failures for `NIKES`, `I Wish You Didn't Love Me`, and `OCEAN AWAY` were reproduced in independent Chrome while `Parties` still played. YouTube returned `UNPLAYABLE` / `This video is unavailable` for these embeds. Fresh players and the official privacy-enhanced host did not resolve the tested failures. The NIKES watch-page response still reported `OK` and `playableInEmbed: true`, so the precise platform cause remains undetermined. No reliable replacement was verified or published. See `research/reported-playback-failures-20261022.json`. These three songs remain unresolved; source association is not playback verification.

See `research/VIDEO_VERIFICATION.md` for the readable association list and `research/video-verification.json` for the per-track evidence. `scripts/discover-videos.cjs`, `scripts/build-video-candidates.cjs`, and `scripts/publish-video-links.cjs` retain the search/approval/publication workflow. `scripts/audit-videos.cjs` first verifies a known playback control and stops instead of continuing a bulk test when the platform blocks that control.

The page does not download, extract, proxy, or host copyrighted music. The known YouTube embed uses the official player. Imported LRC/TXT text is displayed locally and is not bundled into the project.
