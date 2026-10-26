# Jake Miller Encore

This is an editable reconstruction of the Encore listening-room page. The original source directory was a temporary Codex file-preview folder and is no longer present. This project was recreated from retained screenshots, task notes, and cached Apple Music catalog metadata; it is not a byte-for-byte recovery of the deleted source.

## Run

The homepage now opens a twelve-artist mosaic, including Jhené Aiko, Laufey, Fujii Kaze, Drake and Ariana Grande. Jake Miller is the first available room; the other eleven artists are marked as coming soon. Select Jake Miller to open the existing player, or use `/#jake-miller` directly. The room's top-left link returns to the wall without interrupting music. Browser Back/Forward also navigates between these views. Artist photos are bundled locally, with sources in `artwork/artists/SOURCES.md`.

Run `npm run test:artists` against the local server to verify desktop/mobile navigation and local audio playback.

The artist wall loops the first 40 seconds (0:00–0:40) of the user's supplied video as local opening music at 18% volume. The extracted AAC audio is bundled at `audio/artist-wall-accompaniment-40s.m4a`, without the video. `Sound on` starts it if browser autoplay is blocked; `Sound off` persists across reloads. Entering a room fades it out over 850 ms. Returning resumes it only when enabled and no room song is playing. Background tabs pause the opening music. This audio no longer depends on an external preview service. `node tests/artist-music.browser.cjs` checks playback, looping, fade, preferences and room-audio exclusion.

Room navigation includes an original WebGL water-refraction transition over the bundled Jake Miller photo (1.45 seconds entering, 0.78 seconds returning). It runs only during navigation, preserves playback, and skips animation for reduced-motion preferences. A static tinted-photo crossfade is used if WebGL is unavailable. Direct room links load immediately. Visual direction references Mist's fog/water treatment; no Mist source code or assets are included.

Open a terminal in this folder and run:

```sh
npm run serve
```

Then open `http://127.0.0.1:8766/`.

## Local MP3 playback

Tracks with an `audioUrl` in `data/tracks.js` play the matching local MP3 first. This does not require YouTube access, an Apple Music subscription or Apple developer credentials. The existing play/pause, previous/next, shuffle, repeat, mute and timed lyrics controls use the local audio player. The queue marks these tracks with **本地音频**. A local file load failure offers a retry; it does not silently switch to a different recording.

Forty-three songs are available as local MP3s. The first batch added A Million Ways To Miss You, Answers, Back to the Start, Lucky Me, Momentum, No Return, Rumors, Spark, Still Dancing and Waiting On August. Its 11 supplied files contained two byte-identical copies of Rumors, so only one was copied. A second batch from the user's `jake miller` folder added 15 MINUTES, Better Me Better You, Drinkin About You, I Wish You Didn't Love Me, LAST TEXT, NIKES, OCEAN AWAY and Palm Blvd. A third batch from `Jake miller2` added A Million Lives, Automatic, Dazed and Confused (feat. Travie McCoy), Good Thing, Selfish Girls and Wait for You. A fourth batch from Downloads added ROSS AND RACHEL and Steven. The Girl That's Underneath by Jake Miller & Jabbar Hakeem has 102 timestamped bilingual lyric lines in its supplied MP3; the player displays only its English lines. The fifth batch from `Jake miller 3` added 14 tracks, including 13 songs from the requested 27-song list and I Know The Feeling. Each new MP3 includes timed bilingual lyrics and embedded artwork; the project stores the English lyric timeline and displays English only. The library contains 44 songs in total: all 27 songs from the reference list are now visible in the pictured order, and the other 17 remain hidden from the player without removing their metadata, MP3s or artwork. The hidden songs can be restored by removing their `hiddenFromSetlist` flag in `data/tracks.js`. The sixth import batch added Blame It On You and First Flight Home with English-only timed lyrics and embedded artwork. Source files are preserved. Import details and hashes are recorded in `research/local-audio-import.json`, `research/local-audio-import-batch-5.json` and `research/local-audio-import-batch-6.json`.

Audio files live in `audio/<track-id>.mp3` and are included in Git, so they travel with a clone. The 43 bundled MP3s play through the local server, which supports byte-range requests; this includes locally available songs that are currently hidden. The remaining track without a local file, Parties, uses its official YouTube source and still depends on that service's availability.

## Apple Music playback

For tracks without local audio, the player prefers Apple Music when MusicKit is configured and authorized, and falls back to the official YouTube player when Apple Music is not configured or cannot play a selected catalog item. Existing catalog-backed tracks retain their Apple Music IDs in `data/tracks.js`; availability can still vary by the subscriber's storefront. The Girl That's Underneath and the 16 tracks added in the latest two import batches play from their bundled MP3s.

An Apple Music subscription alone is not enough to configure MusicKit. In the Apple Developer account, register a Media ID with MusicKit enabled and create a Media Services private key. Copy `.env.example` to `.env`, fill in the Team ID and Key ID, and put the downloaded `.p8` private key at the ignored `secrets/` path shown in the example. Keep the private key out of Git and out of browser code. The local Node server signs a short-lived ES256 developer token and serves it only through `/api/apple-music-token` while binding to `127.0.0.1`.

Restart `npm run serve` after editing `.env`. On the page, choose **Connect Apple Music** and approve MusicKit access. The central play button then requests the selected song from Apple Music. If the developer credentials have not been configured, YouTube remains the available source; Apple Music can only be verified after valid credentials are supplied and the user authorizes the site.

## Source files

- `index.html`: page structure and dialogs
- `styles.css`: responsive layout and Cover Flow presentation
- `app.js`: local audio, Apple Music and YouTube playback, carousel, and lyric import
- `ambient.js`: the shared muted Parties video and playback-driven visual state
- `data/tracks.js`: editable 44-song library, visible-setlist flags and Apple Music artwork metadata
- `data/embedded-lyrics.js`: English-only timestamped lyrics extracted from user-provided MP3 tags
- `vendor/lucide.min.js`: locally bundled Lucide icons (license in `vendor/LICENSE`)

## Vynora UI

The current interface adapts the user's downloaded Vynora (Community) Make source: black iPod header, inset search, Cover Flow transforms, reflected covers, track metadata and large playback controls. The source archive was inspected at `../Vynora_Make_Source`. The previous Encore source is backed up at `../Jake_Miller_Encore-before-vynora-20261022.zip`.

The central playback button uses a local MP3 when available, then Apple MusicKit Web when configured, or the official YouTube IFrame player. YouTube audio uses one hidden iframe; a separate muted iframe supplies the shared Parties video background. Playback starts only following an explicit user action; the app does not claim music is playing until the active player reports it. Unknown or blocked video sources are not silently replaced.

The main control requests playback or pause through the active in-page provider; it never opens a source editor or an external page. The YouTube region remains hidden, with no reserved layout space, during idle, playback and error states on all screen sizes. Playback intent is tracked separately from DOM visibility. The center album cover and its reflection remain visible; failures appear in the existing playback status. Hiding the iframe does not turn it into a separate audio service or change video availability.

The ambient background restores the original `Parties` video (`oCkufmjcy3I`) for every song, regardless of its audio provider. The oversized video, blur, brightness, contrast and dark overlay match the earlier video-background version on desktop and mobile. Playback prepares a muted inline YouTube player and starts the video after the audio provider reports playback. Pausing, dragging, hidden pages and reduced-motion settings pause the decorative player; resuming and switching songs reuse the same Parties video. The background never supplies the song audio. It requires an internet connection and available YouTube embedding; blocked or unavailable video stays on the original dark fallback rather than being replaced by drifting artwork.

Reference: the requested Figma Make `qdgzDrEORQjCH9NpzkK6Se` exposed its source-file list, but the connector could not return source bodies or a Make screenshot. The implementation follows the agreed behavior and the previously downloaded Vynora reference at `../Vynora_Make_Source`; it is not a pixel-exact verification of the new Make preview.

Missing sources and unavailable API connections have an explicitly disabled play control with a short status. A video playback error offers a manual retry through the play button, with no automatic retry loop. Clicking before the API is ready queues one playback request, canceled on connection failure or navigation to another track. Browser autoplay refusal asks for another explicit click on the central play control. None of these UI changes bypass platform restrictions or guarantee full playback.

The lyrics button opens a full-screen view, checks LRCLIB first and uses Lyrics.ovh as a fallback when no matching record is available. Returned lyrics are cached on this device. When timestamped lyrics are available, the active line follows the player's current time and scrolls into view. Imported per-track LRC/TXT files remain available, and an imported or manually saved LRC takes precedence over automatic timing.

`data/lyric-timings.js` adds recording-specific timestamps for **Wait for You, Momentum, Waiting On August and Spark**, aligned locally against the bundled MP3s using stable-ts and Whisper small.en. Audio was processed on this Mac. Timing records include the audio hash and lyric fingerprints, without bundling third-party lyric text. The player combines these records with cached, fetched or imported text. Word matching tolerates punctuation and line-break differences; unrelated text is rejected. Credits and acoustically absent duplicate lines are omitted, concatenated lines are separated, and long instrumental gaps clear the highlight. These machine-aligned timings can still need small listening-based corrections.

These four recordings request the full Lyrics.ovh text used during alignment. An older LRCLIB plain-text record for Wait for You omitted its first pre-chorus; cached incomplete text is refreshed automatically. Other tracks continue to prefer LRCLIB's existing synchronized lyrics.

**Parties** has no local MP3. LRCLIB record `11279170` supplies a timeline matching the approximately 170-second official audio upload `7KDksdVFGmc`; its timestamps are included as metadata. That upload played on its YouTube watch page, but the in-page player returned error 150 during verification. The original official music-video playback source is therefore retained. Its different edit has no verified matching timeline and shows ordinary text, with a clear label. The audio-version timing is enabled only for its matching video source; it must not be mistaken for verified synchronization of the music-video edit. Completing this track requires an available matching recording or timing the original video. The full lyric text must already be cached or available from a lyric service.

For other plain-text tracks, the clock button opens manual timing mode: play the track and click each line as it begins, then save in this browser. Draft progress saves automatically and resumes when the same text is reopened; finishing the song keeps the editor on that track. Out-of-order stamps must be corrected before saving. The existing selected-track, imported lyric and video storage keys are retained. Timing metadata can be rebuilt with `node scripts/build-lyric-timings.cjs <alignment-work-directory>` from local alignment outputs.

For browser regression checks, run `npm install` and `npm run test:browser` while the preview server is running. These checks mock the YouTube API and validate controls, source association, search, lyric persistence and desktop/mobile layout; they do not verify real video availability or full-song playback. The script uses installed Chrome on macOS or `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when provided.

The setlist is reconstructed from cached artist/catalog data and the retained screen captures. Check it against the original before treating its order as canonical. Only `Parties` has a retained original listening note; no other note copy was invented.

## Shared Video Sources

23 of the 28 tracks now have publisher/title-confirmed YouTube IDs in `data/tracks.js`, so these associations travel with the source code rather than existing only in one browser. This includes `Answers`, linked to `Kr1xzr_dQ4Y`.

YouTube IDs still pending: `ROSS AND RACHEL`, `Momentum`, `Waiting On August`, and `Spark`. All four now have local MP3 sources. No unrelated video or unconfirmed third-party lyric upload is substituted for these tracks.

The current automated playback environment requested sign-in verification ("Sign in to confirm you're not a bot"), including for the previously working `Parties` control. This prevented reliable bulk runtime verification. Source matching is not a guarantee of full playback; the recorded error-150 attempts must not be interpreted as proof that every video owner disallows embedding.

After moving playback into the center cover, a separate real-browser check on October 22, 2026 successfully started `Parties` from the main button and observed player state 1 at 9.35 seconds. See `research/cover-player-smoke.json`. This is a single playback-start sample, not certification of a complete song or the whole catalog; the earlier environment failures remain relevant.

Subsequent user-reported failures for `NIKES`, `I Wish You Didn't Love Me`, and `OCEAN AWAY` were reproduced in independent Chrome while `Parties` still played. YouTube returned `UNPLAYABLE` / `This video is unavailable` for these embeds. Fresh players and the official privacy-enhanced host did not resolve the tested failures. The NIKES watch-page response still reported `OK` and `playableInEmbed: true`, so the precise platform cause remains undetermined. See `research/reported-playback-failures-20261022.json`. These YouTube issues remain unresolved, but all three songs now use the user's supplied local MP3s. All 26 previously imported tracks were observed starting local playback in the in-app browser; `research/local-audio-playback.json` records short start samples and control checks, not full-track listening.

See `research/VIDEO_VERIFICATION.md` for the readable association list and `research/video-verification.json` for the per-track evidence. `scripts/discover-videos.cjs`, `scripts/build-video-candidates.cjs`, and `scripts/publish-video-links.cjs` retain the search/approval/publication workflow. `scripts/audit-videos.cjs` first verifies a known playback control and stops instead of continuing a bulk test when the platform blocks that control.

The page plays the supplied MP3 files bundled in `audio/`; it does not download or extract music from streaming platforms. Publicly publishing these recordings requires distribution rights. YouTube sources use the official player. Imported LRC/TXT text is displayed locally and is not bundled into the project.
