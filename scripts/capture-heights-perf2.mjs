/**
 * 1024×600 viewport canvas, perspective camera after iso-se load — matches heights-fix-after flow.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const outDir = "/opt/cursor/artifacts";
fs.mkdirSync(outDir, { recursive: true });

const url =
  "http://127.0.0.1:5173/citycut-export/?lat=-37.8136&lon=144.9631&km=1&view=iso-se";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
page.setDefaultTimeout(180_000);

await page.goto(url, { waitUntil: "networkidle" });
await page.locator("button.create-fab").click();
await Promise.race([
  page.waitForSelector(".model", { state: "visible" }),
  page.waitForSelector(".stage-error", { state: "visible" }).then(async () => {
    throw new Error((await page.locator(".stage-error").textContent()) || "Model build failed");
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
await page.waitForTimeout(2000);

const camBefore = await page.evaluate(() => {
  const canvas = document.querySelector(".viewport canvas");
  if (!canvas) return null;
  return {
    elevation: canvas.dataset.camElevation,
    bearing: canvas.dataset.camBearing,
    axisAngle: canvas.dataset.camAxisAngle,
    kind: canvas.dataset.camKind,
  };
});

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

await setBetterHeights(true);
await page.waitForFunction(
  () =>
    [...document.querySelectorAll(".legend-note")].some((el) =>
      /use City of Melbourne extrusion heights/.test(el.textContent ?? ""),
    ),
  null,
  { timeout: 90_000 },
);
await page.waitForTimeout(1500);

await page.locator(".viewport canvas").screenshot({ path: `${outDir}/heights-perf-after2.png` });

const note = await page.locator(".legend-note").allTextContents();
console.log(JSON.stringify({ camBefore, notes: note, out: `${outDir}/heights-perf-after2.png` }));
await browser.close();
