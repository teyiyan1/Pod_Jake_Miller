const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const candidates = require("../research/video-candidates.json");
const start = Number(process.argv[2] || 0);
const end = Number(process.argv[3] || candidates.length);
const destination = path.join(__dirname, `../research/video-playback-${start}-${end}.json`);

async function metadata(videoId) {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return { httpStatus: response.status };
    const value = await response.json();
    return { httpStatus: response.status, title: value.title, author: value.author_name, authorUrl: value.author_url };
  } catch (error) {
    return { error: error.message };
  }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined),
    headless: true
  });
  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await page.goto("http://127.0.0.1:8766/tests/fixtures/video-audit.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.audit?.ready, null, { timeout: 30000 });
    await page.waitForFunction(() => audit.error !== null || auditPlayer.getPlayerState() === 5, null, { timeout: 16000 });
    if (await page.evaluate(() => audit.error === null)) {
      await page.locator("#play").click();
      await page.waitForFunction(() => audit.error !== null || (
        auditPlayer.getPlayerState() === 1 && auditPlayer.getCurrentTime() >= 1.5
      ), null, { timeout: 18000 }).catch(() => {});
    }
    const control = await page.evaluate(() => ({
      error: audit.error,
      state: auditPlayer.getPlayerState(),
      currentTime: auditPlayer.getCurrentTime()
    }));
    if (control.state !== 1 || control.currentTime < 1.5 || control.error !== null) {
      const frame = page.frames().find(value => value.url().includes("youtube.com/embed/"));
      const restriction = await frame?.evaluate(() => {
        const value = document.querySelector("#movie_player")?.getPlayerResponse?.()?.playabilityStatus;
        return value ? { status: value.status, reason: value.reason } : null;
      }).catch(() => null);
      const diagnostic = {
        checkedAt: new Date().toISOString(),
        status: "control-playback-blocked",
        controlVideoId: "oCkufmjcy3I",
        playerApiError: control.error,
        playabilityStatus: restriction?.status || "UNCONFIRMED",
        reason: restriction?.reason || "Known control video did not advance",
        scope: "Bulk playback checks stopped. This result does not establish per-video owner restrictions."
      };
      fs.writeFileSync(path.join(__dirname, "../research/playback-environment.json"), JSON.stringify(diagnostic, null, 2) + "\n");
      throw new Error(`Control playback unavailable; bulk verification stopped: ${diagnostic.reason}`);
    }
    await page.evaluate(() => auditPlayer.pauseVideo());
    for (let index = start; index < end; index++) {
      const item = candidates[index];
      const record = { trackId: item.trackId, title: item.title, checkedAt: new Date().toISOString(), attempts: [] };
      for (const candidate of item.candidates) {
        const attempt = { ...candidate, metadata: await metadata(candidate.videoId) };
        if (attempt.metadata.httpStatus && attempt.metadata.httpStatus !== 200) {
          attempt.status = "metadata-unavailable";
          record.attempts.push(attempt);
          continue;
        }
        await page.locator("#video-id").fill(candidate.videoId);
        await page.locator("#load").click();
        try {
          await page.waitForFunction(() => audit.error !== null || (auditPlayer.getPlayerState() === 5 && auditPlayer.getVideoData()?.video_id === audit.requestedId), null, { timeout: 16000 });
          const error = await page.evaluate(() => audit.error);
          if (error === null) {
            await page.locator("#play").click();
            await page.waitForFunction(() => audit.error !== null || (
              auditPlayer.getPlayerState() === 1 &&
              auditPlayer.getCurrentTime() >= 1.5 &&
              auditPlayer.getVideoData()?.video_id === audit.requestedId
            ), null, { timeout: 18000 });
          }
        } catch (error) {
          attempt.timeout = error.message.split("\n")[0];
        }
        attempt.playback = await page.evaluate(() => ({
          videoId: auditPlayer.getVideoData()?.video_id,
          title: auditPlayer.getVideoData()?.title,
          state: auditPlayer.getPlayerState(),
          error: audit.error,
          currentTime: auditPlayer.getCurrentTime(),
          duration: auditPlayer.getDuration(),
          states: audit.states
        }));
        attempt.status = attempt.playback.error !== null ? "embed-error"
          : attempt.playback.state === 1 && attempt.playback.currentTime >= 1.5 &&
            attempt.playback.videoId === candidate.videoId ? "playback-verified" : "unconfirmed";
        await page.evaluate(() => auditPlayer.pauseVideo());
        record.attempts.push(attempt);
        console.log(`${index + 1}. ${item.title} | ${candidate.videoId} | ${attempt.status} | error=${attempt.playback.error} | time=${attempt.playback.currentTime.toFixed(2)} | duration=${attempt.playback.duration}`);
        fs.writeFileSync(destination, JSON.stringify([...results, record], null, 2) + "\n");
        if (attempt.status === "playback-verified") {
          record.selectedVideoId = candidate.videoId;
          break;
        }
      }
      record.status = record.selectedVideoId ? "playback-verified"
        : record.attempts.some(attempt => attempt.status === "embed-error") ? "player-api-error"
        : item.candidates.length ? "unconfirmed" : "no-approved-match";
      results.push(record);
      fs.writeFileSync(destination, JSON.stringify(results, null, 2) + "\n");
      if (!item.candidates.length) console.log(`${index + 1}. ${item.title} | no approved match`);
    }
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
