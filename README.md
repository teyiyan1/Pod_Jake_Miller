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

The header's link button opens a per-track YouTube source editor. Valid YouTube URLs or video IDs are stored only in the current browser. The lyrics button opens locally imported, per-track LRC/TXT text. Both the existing selected-track and lyrics storage keys are retained.

For browser regression checks, run `npm install` and `npm run test:browser` while the preview server is running. These checks mock the YouTube API and validate controls, source association, search, lyric persistence and desktop/mobile layout; they do not verify real video availability or full-song playback. The script uses installed Chrome on macOS or `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when provided.

The setlist is reconstructed from cached artist/catalog data and the retained screen captures. Check it against the original before treating its order as canonical. Only `Parties` has a retained, previously verified video ID and original listening note. Other video IDs and note copy were deliberately left blank rather than guessed.

The page does not download, extract, proxy, or host copyrighted music. The known YouTube embed uses the official player. Imported LRC/TXT text is displayed locally and is not bundled into the project.
