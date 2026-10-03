import { chromium } from "playwright";
import fs from "node:fs";

const outDir = "/opt/cursor/artifacts";
fs.mkdirSync(outDir, { recursive: true });

const url =
  "http://127.0.0.1:5173/citycut-export/?lat=-37.8136&lon=144.9631&km=1&view=iso-se";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(180_000);

await page.goto(url, { waitUntil: "networkidle" });
await page.locator("button.create-fab").click();
await Promise.race([
  page.waitForSelector(".model", { state: "visible" }),
  page.waitForSelector(".stage-error", { state: "visible" }).then(async () => {
    const err = await page.locator(".stage-error").textContent();
    throw new Error(err || "Model build failed");
  }),
]);
await page.waitForFunction(
  () => !document.body.textContent?.includes("Reading the map"),
  null,
  { timeout: 180_000 },
);
await page.waitForTimeout(2000);

await page.getByRole("button", { name: "Drawing", exact: true }).click();
await page.getByRole("tab", { name: "3D model" }).click();
await page.getByRole("button", { name: "Perspective" }).click();
await page.waitForTimeout(1500);

await page.getByRole("button", { name: "Buildings", exact: true }).click();
await page.waitForTimeout(1000);

const toggle = page.locator("button", { hasText: "Better heights" });
if ((await toggle.count()) === 0) {
  await page.screenshot({ path: `${outDir}/debug-no-toggle.png`, fullPage: true });
  throw new Error("Better heights toggle not found");
}
async function setBetterHeights(on) {
  await page.evaluate((enabled) => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Better heights"),
    );
    if (!btn) throw new Error("toggle missing");
    const pressed = btn.getAttribute("aria-pressed") === "true";
    if (pressed !== enabled) btn.click();
  }, on);
}
await setBetterHeights(false);
await page.waitForTimeout(2000);
await page.locator(".viewport canvas").screenshot({ path: `${outDir}/heights-fix-before.png` });

await setBetterHeights(true);
await page.waitForFunction(
  () => {
    const note = [...document.querySelectorAll(".legend-note")].some((el) =>
      /use City of Melbourne extrusion heights/.test(el.textContent ?? ""),
    );
    return note;
  },
  null,
  { timeout: 60_000 },
);
await page.waitForTimeout(1500);
const note = await page.locator(".legend-note").allTextContents();
await page.locator(".viewport canvas").screenshot({ path: `${outDir}/heights-fix-after.png` });

await page.locator(".stage-attrib").screenshot({ path: `${outDir}/heights-credit-footer.png` });
await page.locator(".drawer-panel.buildings, .drawer--buildings").first().screenshot({
  path: `${outDir}/heights-perf-panel.png`,
}).catch(() => page.locator(".drawer").first().screenshot({ path: `${outDir}/heights-perf-panel.png` }));
await page.screenshot({ path: `${outDir}/heights-perf-after.png` });

console.log(
  JSON.stringify({
    notes: note,
    before: `${outDir}/heights-fix-before.png`,
    after: `${outDir}/heights-fix-after.png`,
    footer: `${outDir}/heights-credit-footer.png`,
  }),
);
await browser.close();
