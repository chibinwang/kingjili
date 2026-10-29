import { expect, test } from "@playwright/test";

test("driver screen works on a phone without horizontal scroll", async ({ page }) => {
  await page.goto("/driver");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/driver");
  await expect(page.getByRole("heading", { name: "司機作業" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  await page.getByRole("button", { name: /完成送達/ }).first().click();
  await page.getByRole("button", { name: "確認送達" }).click();
  await expect(page.getByText(/已送達/).first()).toBeVisible();
  await page.screenshot({ path: "test-results/screens/mobile-driver.png", fullPage: true });
});

test("CRM fits a phone in both views", async ({ page }) => {
  await page.goto("/customers");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/customers");
  await expect(page.getByTestId("crm-cards")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  await page.getByRole("tab", { name: /列表/ }).click();
  await expect(page.getByTestId("crm-list-compact")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  await page.screenshot({ path: "test-results/screens/mobile-crm.png", fullPage: true });
});
