# Jake Miller Encore

This is an editable reconstruction of the Encore listening-room page. The original source directory was a temporary Codex file-preview folder and is no longer present. This project was recreated from retained screenshots, task notes, and cached Apple Music catalog metadata; it is not a byte-for-byte recovery of the deleted source.

## Run

Open a terminal in this folder and run:

```sh
npm run serve
```

Then open `http://127.0.0.1:8766/`.

## Local MP3 playback

Tracks with an `audioUrl` in `data/tracks.js` play the matching local MP3 first. This does not require YouTube access, an Apple Music subscription or Apple developer credentials. The existing play/pause, previous/next, shuffle, repeat, mute and timed lyrics controls use the local audio player. The queue marks these tracks with **本地音频**. A local file load failure offers a retry; it does not silently switch to a different recording.

Twenty-six songs were imported on October 22, 2026. The first batch added A Million Ways To Miss You, Answers, Back to the Start, Lucky Me, Momentum, No Return, Rumors, Spark, Still Dancing and Waiting On August. Its 11 supplied files contained two byte-identical copies of Rumors, so only one was copied. A second batch from the user's `jake miller` folder added 15 MINUTES, Better Me Better You, Drinkin About You, I Wish You Didn't Love Me, LAST TEXT, NIKES, OCEAN AWAY and Palm Blvd. A third batch from `Jake miller2` added A Million Lives, Automatic, Dazed and Confused (feat. Travie McCoy), Good Thing, Selfish Girls and Wait for You. A fourth batch from Downloads added ROSS AND RACHEL and Steven. All source files are preserved. The mappings, file hashes and metadata are recorded in `research/local-audio-import.json`.

Audio files live in `audio/<track-id>.mp3` and are included in Git, so they travel with a clone. The 26 bundled MP3s play through the local server, which supports byte-range requests. The remaining track without a local file, Parties, uses its official YouTube source and still depends on that service's availability.

## Apple Music playback

For tracks without local audio, the player prefers Apple Music when MusicKit is configured and authorized, and falls back to the official YouTube player when Apple Music is not configured or cannot play a selected catalog item. All 27 tracks have Apple Music catalog IDs in `data/tracks.js`; catalog availability can still vary by the subscriber's storefront.

An Apple Music subscription alone is not enough to configure MusicKit. In the Apple Developer account, register a Media ID with MusicKit enabled and create a Media Services private key. Copy `.env.example` to `.env`, fill in the Team ID and Key ID, and put the downloaded `.p8` private key at the ignored `secrets/` path shown in the example. Keep the private key out of Git and out of browser code. The local Node server signs a short-lived ES256 developer token and serves it only through `/api/apple-music-token` while binding to `127.0.0.1`.

Restart `npm run serve` after editing `.env`. On the page, choose **Connect Apple Music** and approve MusicKit access. The central play button then requests the selected song from Apple Music. If the developer credentials have not been configured, YouTube remains the available source; Apple Music can only be verified after valid credentials are supplied and the user authorizes the site.

## Source files

- `index.html`: page structure and dialogs
- `styles.css`: responsive layout and Cover Flow presentation
- `app.js`: local audio, Apple Music and YouTube playback, carousel, and lyric import
- `ambient.js`: cached artwork color sampling and playback-driven visual state
- `data/tracks.js`: editable 27-track setlist and Apple Music artwork metadata
- `vendor/lucide.min.js`: locally bundled Lucide icons (license in `vendor/LICENSE`)

## Vynora UI

The current interface adapts the user's downloaded Vynora (Community) Make source: black iPod header, inset search, Cover Flow transforms, reflected covers, track metadata and large playback controls. The source archive was inspected at `../Vynora_Make_Source`. The previous Encore source is backed up at `../Jake_Miller_Encore-before-vynora-20261022.zip`.

The central playback button uses a local MP3 when available, then Apple MusicKit Web when configured, or the official YouTube IFrame player. YouTube uses one hidden iframe and there is no additional background iframe. Playback starts only following an explicit user action; the app does not claim music is playing until the active player reports it. Unknown or blocked video sources are not silently replaced.

The main control requests playback or pause through the active in-page provider; it never opens a source editor or an external page. The YouTube region remains hidden, with no reserved layout space, during idle, playback and error states on all screen sizes. Playback intent is tracked separately from DOM visibility. The center album cover and its reflection remain visible; failures appear in the existing playback status. Hiding the iframe does not turn it into a separate audio service or change video availability.

The ambient background samples each cover once on a cached 64px canvas. Three artwork colors and their positions shape the light pools; a blurred copy of the cover preserves its broad texture. Two layers crossfade on track changes, with cover-specific drift timing and subtle grain. Local MP3 playback uses a shared Web Audio context and a per-element analyser: sound energy controls brightness, bass controls light spread, and transients add brief accents. Analysis runs at about 30 updates per second only during visible, active playback; it stops on pause, buffering, dragging and reduced-motion settings. Audio graphs are disconnected when their media elements are released. Apple Music and YouTube use a slower cover-specific atmospheric animation because their audio samples are unavailable. Motion begins only after the provider reports playback. Mobile styling reduces blur and intensity; artwork sampling failures retain the original image with a neutral palette. The background uses no video and no per-frame image processing.

Reference: the requested Figma Make `qdgzDrEORQjCH9NpzkK6Se` exposed its source-file list, but the connector could not return source bodies or a Make screenshot. The implementation follows the agreed behavior and the previously downloaded Vynora reference at `../Vynora_Make_Source`; it is not a pixel-exact verification of the new Make preview.

Missing sources and unavailable API connections have an explicitly disabled play control with a short status. A video playback error offers a manual retry through the play button, with no automatic retry loop. Clicking before the API is ready queues one playback request, canceled on connection failure or navigation to another track. Browser autoplay refusal asks for another explicit click on the central play control. None of these UI changes bypass platform restrictions or guarantee full playback.

The lyrics button opens a full-screen view, looks up the selected track through LRCLIB when served from the local preview server, and caches returned text on this device. Imported per-track LRC/TXT files remain available and take precedence; timestamped LRC files keep their existing playback sync. The header's link button opens a per-track YouTube source editor. Valid YouTube URLs or video IDs are stored only in the current browser. Both the existing selected-track and lyrics storage keys are retained.

For browser regression checks, run `npm install` and `npm run test:browser` while the preview server is running. These checks mock the YouTube API and validate controls, source association, search, lyric persistence and desktop/mobile layout; they do not verify real video availability or full-song playback. The script uses installed Chrome on macOS or `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when provided.

The setlist is reconstructed from cached artist/catalog data and the retained screen captures. Check it against the original before treating its order as canonical. Only `Parties` has a retained original listening note; no other note copy was invented.

## Shared Video Sources

23 of the 27 tracks now have publisher/title-confirmed YouTube IDs in `data/tracks.js`, so these associations travel with the source code rather than existing only in one browser. This includes `Answers`, linked to `Kr1xzr_dQ4Y`.

YouTube IDs still pending: `ROSS AND RACHEL`, `Momentum`, `Waiting On August`, and `Spark`. All four now have local MP3 sources. No unrelated video or unconfirmed third-party lyric upload is substituted for these tracks.

The current automated playback environment requested sign-in verification ("Sign in to confirm you're not a bot"), including for the previously working `Parties` control. This prevented reliable bulk runtime verification. Source matching is not a guarantee of full playback; the recorded error-150 attempts must not be interpreted as proof that every video owner disallows embedding.

After moving playback into the center cover, a separate real-browser check on October 22, 2026 successfully started `Parties` from the main button and observed player state 1 at 9.35 seconds. See `research/cover-player-smoke.json`. This is a single playback-start sample, not certification of a complete song or the whole catalog; the earlier environment failures remain relevant.

Subsequent user-reported failures for `NIKES`, `I Wish You Didn't Love Me`, and `OCEAN AWAY` were reproduced in independent Chrome while `Parties` still played. YouTube returned `UNPLAYABLE` / `This video is unavailable` for these embeds. Fresh players and the official privacy-enhanced host did not resolve the tested failures. The NIKES watch-page response still reported `OK` and `playableInEmbed: true`, so the precise platform cause remains undetermined. See `research/reported-playback-failures-20261022.json`. These YouTube issues remain unresolved, but all three songs now use the user's supplied local MP3s. All 26 imported tracks were observed starting local playback in the in-app browser; `research/local-audio-playback.json` records short start samples and control checks, not full-track listening.

See `research/VIDEO_VERIFICATION.md` for the readable association list and `research/video-verification.json` for the per-track evidence. `scripts/discover-videos.cjs`, `scripts/build-video-candidates.cjs`, and `scripts/publish-video-links.cjs` retain the search/approval/publication workflow. `scripts/audit-videos.cjs` first verifies a known playback control and stops instead of continuing a bulk test when the platform blocks that control.

The page plays the supplied MP3 files bundled in `audio/`; it does not download or extract music from streaming platforms. Publicly publishing these recordings requires distribution rights. YouTube sources use the official player. Imported LRC/TXT text is displayed locally and is not bundled into the project.
