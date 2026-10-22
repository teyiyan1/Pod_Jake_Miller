const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const tracks = require("../data/tracks.js");

const start = Number(process.argv[2] || 0);
const end = Number(process.argv[3] || tracks.length);
const mode = process.env.YOUTUBE_QUERY_MODE || "official";
const directory = path.join(__dirname, "../research");
const output = path.join(directory, `youtube-search-${mode}-${start}-${end}.json`);

(async () => {
  fs.mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined),
    headless: true
  });
  const records = [];
  try {
    const page = await browser.newPage();
    for (let index = start; index < end; index++) {
      const track = tracks[index];
      const title = track.title.replace(/\s*\(feat\..*?\)/i, "");
      const query = mode === "official" ? `${track.artist} "${title}" official audio` : `${track.artist} ${title}`;
      const searchUrl = mode === "channel"
        ? `https://www.youtube.com/@jakemiller/search?query=${encodeURIComponent(title)}`
        : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      const record = { trackId: track.id, title: track.title, artist: track.artist, query, searchUrl, checkedAt: new Date().toISOString() };
      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForFunction(() => window.ytInitialData, null, { timeout: 15000 });
        record.results = await page.evaluate(() => {
          const videos = [];
          const seen = new Set();
          const text = value => value?.simpleText || value?.runs?.map(run => run.text).join("") || "";
          function visit(value) {
            if (!value || typeof value !== "object") return;
            if (value.videoRenderer) {
              const video = value.videoRenderer;
              if (video.videoId && !seen.has(video.videoId)) {
                seen.add(video.videoId);
                const owner = video.ownerText?.runs?.[0];
                videos.push({
                  videoId: video.videoId,
                  title: text(video.title),
                  channel: text(video.ownerText),
                  channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId || "",
                  channelPath: owner?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || "",
                  duration: text(video.lengthText),
                  badges: (video.ownerBadges || []).map(badge => ({
                    type: badge.metadataBadgeRenderer?.style,
                    label: badge.metadataBadgeRenderer?.tooltip
                  })),
                  url: `https://www.youtube.com/watch?v=${video.videoId}`
                });
              }
            }
            for (const nested of Object.values(value)) {
              if (Array.isArray(nested)) nested.forEach(visit);
              else if (nested && typeof nested === "object") visit(nested);
            }
          }
          visit(window.ytInitialData);
          return videos.slice(0, 25);
        });
        console.log(`${index + 1}. ${track.title}: ${JSON.stringify(record.results.slice(0, 5).map(video => ({ id: video.videoId, title: video.title, by: video.channel })))}`);
      } catch (error) {
        record.error = error.message;
        console.log(`${index + 1}. ${track.title}: ${record.error}`);
      }
      records.push(record);
      fs.writeFileSync(output, JSON.stringify(records, null, 2) + "\n");
    }
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
