const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const NativeAudio = window.Audio;
      window.__audios = [];
      window.Audio = class extends NativeAudio {
        constructor(...args) { super(...args); window.__audios.push(this); }
      };
    });
    await page.goto("http://127.0.0.1:8766/#artists", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#artist-sound span").textContent === "Sound on");
    await page.locator("#artist-sound").click();
    await page.waitForFunction(() => __audios[0].currentTime > .3 && !__audios[0].paused);
    assert.equal(await page.evaluate(() => __audios[0].loop), true);
    assert.equal(await page.evaluate(() => __audios[0].volume), .18);
    await page.evaluate(() => { __audios[0].currentTime = __audios[0].duration - .2; });
    await page.waitForFunction(() => __audios[0].currentTime < 2 && !__audios[0].paused);
    await page.locator("#enter-jake").click();
    await page.waitForFunction(() => __audios[0].volume < .17);
    await page.waitForFunction(() => __audios[0].paused && !document.documentElement.dataset.transitioning);
    await page.locator(".room-back").click();
    await page.waitForFunction(() => !__audios[0].paused && !document.documentElement.dataset.transitioning);
    await page.locator("#artist-sound").click();
    assert.equal(await page.evaluate(() => __audios[0].paused), true);
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(await page.evaluate(() => __audios[0].paused), true, "off preference survives refresh");
    await page.locator("#artist-sound").click();
    await page.waitForFunction(() => !__audios[0].paused);
    await page.locator("#enter-jake").click();
    await page.locator("#queue-open").click();
    await page.locator("#queue-list button").first().click();
    await page.waitForFunction(() => localAudio && !localAudio.paused && localAudio.currentTime > .3);
    await page.locator(".room-back").click();
    await page.waitForFunction(() => !document.documentElement.dataset.transitioning);
    assert.equal(await page.evaluate(() => __audios[0].paused), true, "intro stays silent while room song plays");
    assert.equal(await page.locator("#artist-sound").isDisabled(), true);
    await page.locator("#return-room").click();
    await page.locator("#play-toggle").click();
    await page.locator(".room-back").click();
    await page.waitForFunction(() => !__audios[0].paused && !document.documentElement.dataset.transitioning);
    await page.locator("#artist-sound").click();
    console.log("PASS: actual official preview plays and loops; low volume; transition fade; resume; remembered off preference; no overlap with room audio.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
