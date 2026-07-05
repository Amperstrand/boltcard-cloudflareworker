import { chromium, type FullConfig } from "@playwright/test";

async function globalSetup(config: FullConfig) {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || "https://boltcardpoc.psbt.me";
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${baseURL}/operator/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="pin"]').fill("1234");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/operator/pos**", { timeout: 15000 });

  await page.context().storageState({ path: "test-results/.auth/operator.json" });
  await browser.close();
}

export default globalSetup;
