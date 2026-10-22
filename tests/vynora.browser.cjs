const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const base = process.env.PREVIEW_URL || "http://127.0.0.1:8766/";
const output = process.env.QA_OUTPUT_DIR || "/tmp/encore-vynora-qa";
const mockApi = `
window.__players = [];
window.YT = {
  PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  Player: class {
    constructor(id, options) {
      this.events = options.events;
      this.video = options.videoId;
      this.state = -1;
      this.time = 0;
      this.calls = [];
      const iframe = document.createElement("iframe");
      iframe.id = id;
      iframe.title = "YouTube test player";
      iframe.src = "about:blank";
      iframe.style.cssText = "width:100%;height:100%;border:0;background:black";
      document.getElementById(id).replaceWith(iframe);
      window.__players.push(this);
      setTimeout(() => this.events.onReady({ target: this }), 0);
    }
    emit(state) { this.state = state; this.events.onStateChange({ data: state, target: this }); }
    cueVideoById(id) { this.calls.push("cue"); this.video = id; this.time = 0; this.emit(5); }
    loadVideoById(id) { this.calls.push("load"); this.video = id; this.time = 0; this.emit(1); }
    playVideo() { this.emit(1); }
    pauseVideo() { this.emit(2); }
    stopVideo() { this.emit(-1); }
    getPlayerState() { return this.state; }
    getVideoData() { return { video_id: this.video }; }
    getCurrentTime() { return this.time; }
    seekTo(time) { this.time = time; }
    mute() { this.muted = true; }
    unMute() { this.muted = false; }
  }
};
window.onYouTubeIframeAPIReady();
`;

async function selectFromQueue(page, index) {
  await page.locator("#queue-open").click();
  await page.locator("#queue-list button").nth(index).click();
  await page.waitForTimeout(450);
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined),
    headless: true
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://www.youtube.com/iframe_api", route =>
      route.fulfill({ contentType: "application/javascript", body: mockApi }));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__players?.length === 1);
    await page.waitForTimeout(200);
    assert.equal(await page.locator(".cover-card").count(), 27);
    const frame = await page.locator("#youtube-player").boundingBox();
    assert.ok(frame.width >= 200 && frame.height >= 200, "player remains visible and at least 200px square");
    assert.equal(await page.locator("iframe").count(), 1, "only one playback source");
    assert.equal(await page.locator("#play-toggle").getAttribute("aria-pressed"), "false");
    await page.locator("#play-toggle").click();
    assert.equal(await page.locator("#playback-state").textContent(), "Now Playing");
    await page.locator("#play-toggle").click();
    assert.equal(await page.locator("#playback-state").textContent(), "Paused");
    await page.locator("#repeat-toggle").click();
    await page.evaluate(() => window.__players[0].emit(0));
    assert.equal(await page.locator("#track-title").textContent(), "Parties");
    assert.equal(await page.locator("#playback-state").textContent(), "Now Playing");
    await page.locator("#repeat-toggle").click();

    const side = await page.locator('.cover-card[data-index="8"] .cover-face').boundingBox();
    await page.mouse.click(side.x + side.width - 10, side.y + side.height / 2);
    await page.waitForTimeout(450);
    assert.equal(await page.locator("#track-title").textContent(), "Wait for You");
    assert.equal(await page.locator("#play-toggle").isDisabled(), true);
    await page.locator("#source-open").click();
    await page.locator("#video-url").fill("https://example.com/watch?v=tEsTvId_001");
    await page.locator("#source-form").evaluate(form => form.requestSubmit());
    assert.match(await page.locator("#source-error").textContent(), /valid YouTube/);
    await page.locator("#video-url").fill("https://youtu.be/tEsTvId_001");
    await page.locator("#source-form").evaluate(form => form.requestSubmit());
    assert.equal(await page.locator("#source-dialog").evaluate(el => el.open), false);
    assert.equal(await page.locator("#play-toggle").isDisabled(), false);
    await page.locator("#play-toggle").click();
    assert.equal(await page.locator("#playback-state").textContent(), "Now Playing");
    await page.locator("#volume-toggle").click();
    assert.equal(await page.evaluate(() => window.__players[0].muted), true);

    await page.locator("#track-search").fill("rumors");
    assert.equal(await page.locator("#track-title").textContent(), "Rumors");
    assert.equal(await page.locator(".cover-card:not(.is-hidden)").count(), 2);
    await page.locator("#track-search").fill("does-not-exist");
    assert.equal(await page.locator("#search-empty").isVisible(), true);
    assert.equal(await page.locator(".cover-card:not(.is-hidden)").count(), 0);
    await page.locator("#search-clear").click();
    assert.equal(await page.locator("#search-empty").isVisible(), false);
    const callCount = await page.evaluate(() => window.__players[0].calls.length);
    await selectFromQueue(page, 7);
    assert.deepEqual(await page.evaluate(count => window.__players[0].calls.slice(count), callCount), ["load"]);
    await page.locator("#track-search").blur();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#track-title").textContent(), "Wait for You");
    const deck = await page.locator("#deck").boundingBox();
    await page.mouse.move(deck.x + deck.width / 2, deck.y + deck.height / 2);
    await page.mouse.down();
    await page.mouse.move(deck.x + deck.width / 2 - 100, deck.y + deck.height / 2, { steps: 10 });
    assert.equal(await page.locator("#deck").evaluate(el => el.classList.contains("is-dragging")), true);
    await page.mouse.up();
    await page.waitForTimeout(450);
    assert.equal(await page.locator("#track-title").textContent(), "NIKES");

    await selectFromQueue(page, 8);
    await page.locator("#lyrics-open").click();
    await page.locator("#lyrics-import").setInputFiles({
      name: "Wait for You.lrc",
      mimeType: "text/plain",
      buffer: Buffer.from("[00:00.00]QA sample first line\n[00:04.00]QA sample second line")
    });
    await page.waitForFunction(() => document.querySelectorAll(".lyrics-line").length === 2);
    await page.evaluate(() => { window.__players[0].time = 5; });
    await page.waitForTimeout(550);
    assert.equal(await page.locator(".lyrics-line.is-active").textContent(), "QA sample second line");
    await page.locator('[data-close="lyrics-dialog"]').click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__players?.length === 1);
    assert.equal(await page.locator("#track-title").textContent(), "Wait for You");
    assert.equal(await page.locator(".lyrics-line").count(), 2);
    assert.equal(await page.locator("#video-external").getAttribute("href"), "https://www.youtube.com/watch?v=tEsTvId_001");
    await page.locator("#source-open").click();
    await page.locator("#source-reset").click();
    for (const [width, height] of [[1440,1000], [1920,1080], [390,844], [320,780]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(500);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no ${width}px horizontal overflow`);
      const box = await page.locator("#youtube-player").boundingBox();
      assert.ok(box.width >= 200 && box.height >= 200);
      const geometry = await page.evaluate(() => {
        const center = document.querySelector(".cover-card.is-active .cover-face").getBoundingClientRect();
        const next = document.querySelector('.cover-card[data-index="9"] .cover-face').getBoundingClientRect();
        return { center: center.width, side: next.width };
      });
      assert.ok(geometry.center > geometry.side * 1.4, "center cover has genuine perspective size contrast");
      await page.screenshot({ path: path.join(output, `vynora-${width}.png`), fullPage: true });
    }
    await selectFromQueue(page, 0);
    const layout = await page.evaluate(() => ({
      captionBottom: document.querySelector(".track-caption").getBoundingClientRect().bottom,
      controlsTop: document.querySelector(".player-bar").getBoundingClientRect().top
    }));
    assert.ok(layout.captionBottom <= layout.controlsTop, "long titles do not overlap playback controls");
    await selectFromQueue(page, 7);
    await page.evaluate(() => window.__players[0].events.onError({ data: 150 }));
    assert.equal(await page.locator("#play-toggle").isDisabled(), true);
    assert.equal(await page.locator("#video-empty").isVisible(), true);
    assert.equal(await page.locator("#playback-state").textContent(), "Video unavailable");
    await page.locator("#control-next").click();
    await page.evaluate(() => window.__players[0].events.onError({ data: 150 }));
    assert.equal(await page.locator("#video-empty-title").textContent(), "No video linked to this track");
    assert.deepEqual(errors, []);
    console.log("PASS: visible single player, real-state controls, loop, side click, source validation/persistence, search/empty/clear, keyboard/drag, per-track LRC/persistence, desktop/mobile geometry");
    console.log(`Screenshots: ${output}`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
