const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined),
    headless: true
  });
  const output = "/tmp/encore-artist-wall-qa";
  fs.mkdirSync(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://www.youtube.com/**", route => route.abort());
    await page.goto("http://127.0.0.1:8766/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => [...document.querySelectorAll(".artist-tile img")].every(img => img.complete && img.naturalWidth > 0));
    assert.equal(await page.locator(".artist-tile").count(), 12);
    assert.equal(await page.locator(".artist-tile:disabled").count(), 11);
    assert.equal(await page.locator(".listening-room").isVisible(), false);
    await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
    await page.locator("#enter-jake").click();
    await page.waitForFunction(() => document.documentElement.dataset.view === "room");
    assert.equal(await page.locator(".listening-room").isVisible(), true);
    await page.locator("#queue-open").click();
    await page.locator("#queue-list button").first().click();
    await page.waitForFunction(() => localAudio && !localAudio.paused && localAudio.currentTime > .3);
    await page.locator("#play-toggle").click();
    await page.waitForFunction(() => localAudio.paused);
    await page.locator("#play-toggle").click();
    await page.waitForFunction(() => !localAudio.paused);
    await page.waitForFunction(() => document.querySelector("#play-toggle").getAttribute("aria-pressed") === "true");
    assert.equal(await page.locator("#play-toggle").getAttribute("aria-pressed"), "true");
    await page.locator(".room-back").click();
    await page.waitForFunction(() => document.documentElement.dataset.view === "artists");
    assert.equal(await page.evaluate(() => localAudio.paused), false, "returning to artists keeps music playing");
    await page.keyboard.press("Space");
    assert.equal(await page.evaluate(() => localAudio.paused), false, "wall keyboard does not operate hidden player");
    await page.locator("#return-room").click();
    await page.waitForFunction(() => document.documentElement.dataset.view === "room");
    await page.locator("#play-toggle").click();
    await page.waitForFunction(() => localAudio.paused);
    await page.screenshot({ path: `${output}/room.png`, fullPage: true });
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(await page.locator(".listening-room").isVisible(), true, "room deep link survives refresh");
    await page.locator(".room-back").click();
    await page.waitForFunction(() => document.documentElement.dataset.view === "artists");
    await page.goBack();
    await page.waitForFunction(() => document.documentElement.dataset.view === "room");
    await page.goForward();
    await page.waitForFunction(() => document.documentElement.dataset.view === "artists");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => !document.documentElement.dataset.transitioning);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
    await page.locator("#enter-jake").click();
    await page.waitForFunction(() => document.documentElement.dataset.view === "room");
    assert.equal(await page.locator(".room-back").isVisible(), true);
    await page.locator(".room-back").click();
    await page.waitForFunction(() => !document.documentElement.dataset.transitioning);
    await page.locator("#enter-jake").click();
    await page.waitForFunction(() => document.documentElement.dataset.transitioning === "true");
    await page.goBack();
    await page.waitForFunction(() => !document.documentElement.dataset.transitioning);
    assert.equal(await page.locator("html").getAttribute("data-view"), "artists", "back during ripple cancels safely");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#enter-jake").click();
    await page.waitForFunction(() => document.documentElement.dataset.view === "room");
    assert.equal(await page.locator(".room-transition").isVisible(), false, "reduced motion bypasses ripple");
    assert.equal(await page.locator(".listening-room").evaluate(e => e.inert), false);
    assert.deepEqual(errors, []);
    console.log("PASS: twelve photos; Jake room entry; real local audio; return while playing; keyboard isolation; refresh and history; mobile layout. Screenshots: " + output);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
