const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../data/tracks.js");

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
    await page.route("**/data/tracks.js*", route => route.fulfill({
      contentType: "application/javascript",
      body: `window.ENCORE_TRACKS = ${JSON.stringify(catalog.map((track, index) => index === 8
        ? { ...track, officialVideoId: "", videoVerification: undefined } : track))};`
    }));
    await page.route("https://www.youtube.com/iframe_api", route =>
      route.fulfill({ contentType: "application/javascript", body: mockApi }));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__players?.length === 1);
    await page.waitForTimeout(200);
    assert.equal(await page.locator(".cover-card").count(), 27);
    assert.equal(await page.locator("#video-frame").isVisible(), false, "no player information card before playback");
    assert.equal(await page.locator("#video-empty, .video-section").count(), 0);
    assert.equal(await page.locator("iframe").count(), 1, "only one playback source");
    assert.equal(await page.locator("#play-toggle").getAttribute("aria-pressed"), "false");
    await page.locator("#play-toggle").click();
    assert.equal(await page.locator("#playback-state").textContent(), "Now Playing");
    assert.equal(await page.locator("#youtube-player").boundingBox(), null, "playback has no visible video or reserved space");
    assert.equal(await page.locator("html").getAttribute("data-ambient-motion"), "running");
    await page.waitForFunction(() => document.querySelector("#ambient-cover").dataset.palette);
    const flow = page.locator(".ambient-layer.is-current .ambient-flow");
    const motionA = await flow.evaluate(el => getComputedStyle(el).transform);
    await page.waitForTimeout(300);
    assert.notEqual(await flow.evaluate(el => getComputedStyle(el).transform), motionA, "playing background moves");
    await page.locator("#play-toggle").click();
    assert.equal(await page.locator("#playback-state").textContent(), "Paused");
    assert.equal(await page.locator("html").getAttribute("data-ambient-motion"), "paused");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const pausedTransform = await flow.evaluate(el => getComputedStyle(el).transform);
    await page.waitForTimeout(300);
    assert.equal(await flow.evaluate(el => getComputedStyle(el).transform), pausedTransform, "paused background freezes without snapping");
    await page.locator("#repeat-toggle").click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => document.documentElement.dataset.ambientMotion === "paused");
    assert.equal(await flow.evaluate(el => getComputedStyle(el).animationName), "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => window.__players[0].emit(0));
    assert.equal(await page.locator("#track-title").textContent(), "Parties");
    assert.equal(await page.locator("#playback-state").textContent(), "Now Playing");
    await page.locator("#repeat-toggle").click();
    await page.evaluate(() => window.__players[0].emit(3));
    assert.equal(await page.locator("html").getAttribute("data-ambient-motion"), "paused", "buffering stops motion");
    await page.evaluate(() => window.__players[0].emit(1));
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await page.locator("html").getAttribute("data-ambient-motion"), "paused", "hidden page stops motion");
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await page.locator("#play-toggle").getAttribute("data-action"), "pause", "returning to page preserves playback");
    await page.locator("#play-toggle").click();

    const side = await page.locator('.cover-card[data-index="8"] .cover-face').boundingBox();
    await page.mouse.click(side.x + side.width - 10, side.y + side.height / 2);
    await page.waitForTimeout(450);
    assert.equal(await page.locator("#track-title").textContent(), "Wait for You");
    assert.equal(await page.locator("#play-toggle").isDisabled(), false);
    assert.equal(await page.locator("#play-toggle").getAttribute("data-action"), "pause");
    assert.equal(await page.locator("#video-frame").isVisible(), false);
    assert.equal(await page.locator("html").getAttribute("data-ambient-motion"), "running");
    assert.equal(await page.locator("#source-dialog").evaluate(el => el.open), false);

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
    assert.deepEqual(await page.evaluate(count => window.__players[0].calls.slice(count), callCount), ["cue", "load"]);
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
    await page.evaluate(() => {
      const audio = document.querySelector("#local-audio");
      if (audio) {
        audio.currentTime = 5;
        audio.dispatchEvent(new Event("timeupdate"));
      }
    });
    await page.waitForTimeout(550);
    assert.equal(await page.locator(".lyrics-line.is-active").textContent(), "QA sample second line");
    await page.locator('[data-close="lyrics-dialog"]').click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__players?.length === 1);
    assert.equal(await page.locator("#track-title").textContent(), "Wait for You");
    assert.equal(await page.locator(".lyrics-line").count(), 2);
    assert.match(await page.locator("#video-external").getAttribute("href"), /youtube\.com\/(watch|results)/);
    await selectFromQueue(page, 7);
    for (const [width, height] of [[1440,1000], [1920,1080], [390,844], [320,780]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(500);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no ${width}px horizontal overflow`);
      assert.equal(await page.locator("#youtube-player").boundingBox(), null, "video stays hidden on every viewport");
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
    const failedCallCount = await page.evaluate(() => window.__players[0].calls.length);
    await page.evaluate(() => window.__players[0].events.onError({ data: 150 }));
    assert.equal(await page.locator("html").getAttribute("data-ambient-motion"), "paused", "failed playback stops motion");
    assert.equal(await page.locator("#play-toggle").isDisabled(), false);
    assert.equal(await page.locator("#play-toggle").getAttribute("data-action"), "retry");
    assert.equal(await page.locator("#play-toggle").getAttribute("aria-label"), "重试播放");
    assert.equal(await page.locator("#video-frame").isVisible(), false, "errors do not reveal the video region");
    assert.match(await page.locator("#playback-state").textContent(), /YouTube/);
    const popups = [];
    page.on("popup", popup => popups.push(popup));
    assert.equal(await page.evaluate(() => window.__players[0].calls.length), failedCallCount, "no automatic retries");
    await page.locator("#play-toggle").click();
    assert.equal(await page.evaluate(() => window.__players[0].calls.length), failedCallCount + 1, "one explicit retry on click");
    assert.equal(await page.evaluate(() => window.__players[0].video), "oCkufmjcy3I");
    assert.equal(await page.locator("#playback-state").textContent(), "Now Playing");
    assert.equal(popups.length, 0, "middle play button never navigates away");
    await page.evaluate(() => window.__players[0].events.onAutoplayBlocked({}));
    assert.equal(await page.locator("#play-toggle").isEnabled(), true);
    assert.match(await page.locator("#playback-state").textContent(), /浏览器阻止/);
    await page.locator("#control-next").click();
    await page.evaluate(() => window.__players[0].events.onError({ data: 150 }));
    assert.equal(await page.locator("#playback-state").textContent(), "此歌曲暂无可用音源");
    assert.equal(await page.locator("#video-frame").isVisible(), false);
    await selectFromQueue(page, 24);
    assert.equal(await page.locator("#track-title").textContent(), "Answers");
    assert.equal(await page.locator("#video-external").getAttribute("href"), "https://www.youtube.com/watch?v=Kr1xzr_dQ4Y");
    assert.equal(await page.locator("#playback-state").textContent(), "Now Playing");
    await selectFromQueue(page, 17);
    assert.equal(await page.locator("#play-toggle").isDisabled(), true);
    assert.equal(await page.locator("#play-toggle").getAttribute("data-action"), "unavailable");
    await page.locator("#source-open").click();
    assert.match(await page.locator("#source-track").textContent(), /ROSS AND RACHEL/);
    await page.locator('[data-close="source-dialog"]').click();
    await selectFromQueue(page, 18);
    assert.equal(await page.locator("#track-title").textContent(), "Momentum");
    assert.equal(await page.locator("#play-toggle").getAttribute("data-icon"), "play");
    assert.equal(await page.locator("#play-toggle").isDisabled(), true);
    assert.equal(await page.locator("#video-frame").isVisible(), false);
    await page.screenshot({ path: path.join(output, "momentum-no-source.png"), fullPage: true });

    const failurePage = await browser.newPage();
    await failurePage.route("https://www.youtube.com/iframe_api", route => route.abort());
    await failurePage.goto(base, { waitUntil: "domcontentloaded" });
    await failurePage.waitForFunction(() => document.querySelector("#play-toggle").dataset.action === "unavailable");
    assert.equal(await failurePage.locator("#play-toggle").isEnabled(), false);
    assert.match(await failurePage.locator("#playback-state").textContent(), /无法连接 YouTube/);
    await failurePage.close();

    const timeoutPage = await browser.newPage();
    await timeoutPage.clock.install();
    await timeoutPage.route("https://www.youtube.com/iframe_api", route =>
      route.fulfill({ contentType: "application/javascript", body: "" }));
    await timeoutPage.goto(base, { waitUntil: "domcontentloaded" });
    await timeoutPage.clock.fastForward(12001);
    assert.equal(await timeoutPage.locator("#play-toggle").getAttribute("data-action"), "unavailable");
    assert.equal(await timeoutPage.locator("#play-toggle").isEnabled(), false);
    await timeoutPage.addScriptTag({ content: mockApi });
    await timeoutPage.clock.runFor(10);
    assert.equal(await timeoutPage.locator("#play-toggle").getAttribute("data-action"), "play");
    assert.equal(await timeoutPage.locator("#video-frame").isVisible(), false);
    await timeoutPage.close();

    const earlyPage = await browser.newPage();
    await earlyPage.route("https://www.youtube.com/iframe_api", route =>
      route.fulfill({ contentType: "application/javascript", body: "" }));
    await earlyPage.goto(base, { waitUntil: "domcontentloaded" });
    await earlyPage.locator("#play-toggle").click();
    assert.equal(await earlyPage.locator("#source-dialog").evaluate(el => el.open), false);
    await earlyPage.addScriptTag({ content: mockApi });
    await earlyPage.waitForFunction(() => document.querySelector("#play-toggle").dataset.action === "pause");
    assert.deepEqual(await earlyPage.evaluate(() => window.__players[0].calls), ["load"]);
    assert.equal(await earlyPage.locator("#video-frame").isVisible(), false);
    await earlyPage.close();
    assert.deepEqual(errors, []);
    console.log("PASS: hidden video with playback controls, album art retained, playback-driven ambient motion, pause/error/reduced-motion states, source persistence, search, drag, lyrics, desktop/mobile geometry");
    console.log(`Screenshots: ${output}`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
