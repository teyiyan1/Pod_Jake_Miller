const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined),
    headless: true
  });
  const output = "/tmp/encore-water-qa";
  fs.mkdirSync(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://www.youtube.com/**", route => route.abort());
    await page.addInitScript(() => {
      const draw = WebGLRenderingContext.prototype.drawArrays;
      window.waterFrames = 0;
      WebGLRenderingContext.prototype.drawArrays = function (...args) {
        if (this.canvas.classList.contains("artist-water")) window.waterFrames++;
        return draw.apply(this, args);
      };
    });
    await page.goto("http://127.0.0.1:8766/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".artist-wall.has-water");
    assert.equal(await page.locator(".artist-tile").count(), 12);
    assert.equal(await page.locator(".artist-daylight").evaluateAll(nodes => nodes.every(node => getComputedStyle(node).display === "none")), true);
    assert.equal(await page.locator(".artist-caption").evaluateAll(nodes => nodes.every(node => getComputedStyle(node).opacity === "1")), true);
    const first = await page.screenshot();
    await page.mouse.move(700, 360);
    await page.mouse.move(840, 440, { steps: 8 });
    await page.waitForTimeout(700);
    const moving = await page.screenshot({ path: `${output}/desktop.png` });
    assert.equal(first.equals(moving), false, "the water surface actually animates");
    await page.locator("#enter-jake").click();
    await page.waitForFunction(() => document.documentElement.dataset.view === "room" && !document.documentElement.dataset.transitioning);
    assert.equal(await page.locator(".artist-wall").evaluate(node => node.classList.contains("has-water")), false);
    const framesInRoom = await page.evaluate(() => waterFrames);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => waterFrames), framesInRoom, "water rendering stops inside a room");
    await page.locator(".room-back").click();
    await page.waitForSelector(".artist-wall.has-water");
    await page.waitForFunction(() => !document.documentElement.dataset.transitioning);
    await page.locator("#artist-sound").click();
    await page.waitForFunction(() => !document.querySelector("#artist-wall-audio").paused);
    assert.equal(await page.locator(".artist-daylight").evaluateAll(nodes => nodes.every(node => getComputedStyle(node).display === "none")), true, "sound does not restore the old lighting");
    await page.locator("#artist-sound").click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector(".artist-water").width < 800);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${output}/mobile.png` });
    await page.locator(".artist-ariana").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/mobile-bottom.png` });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => !document.querySelector(".artist-wall").classList.contains("has-water"));
    const framesReduced = await page.evaluate(() => waterFrames);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => waterFrames), framesReduced, "reduced motion stops rendering");
    assert.equal(await page.locator("#enter-jake img").evaluate(node => getComputedStyle(node).opacity), "1");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForSelector(".artist-wall.has-water");
    await page.evaluate(() => document.querySelector(".artist-water").getContext("webgl").getExtension("WEBGL_lose_context").loseContext());
    await page.waitForFunction(() => !document.querySelector(".artist-wall").classList.contains("has-water"));
    assert.equal(await page.locator("#enter-jake img").evaluate(node => getComputedStyle(node).opacity), "1", "context loss restores original photos");
    await page.locator("#enter-jake").click();
    await page.waitForFunction(() => document.documentElement.dataset.view === "room" && !document.documentElement.dataset.transitioning);
    assert.deepEqual(errors, []);
    console.log("PASS: animated desktop mosaic, sharp captions, hidden lighting with music, room navigation and pause/resume, mobile resize and scroll, reduced motion, context-loss fallback. Screenshots: " + output);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
