const { test, expect } = require("@playwright/test");

const viewports = [
  { name: "small-phone", width: 320, height: 568 },
  { name: "android-phone", width: 360, height: 800 },
  { name: "iphone-compact", width: 390, height: 844 },
  { name: "iphone-reference", width: 402, height: 874 },
  { name: "large-phone", width: 430, height: 932 },
  { name: "compact-landscape", width: 568, height: 320 },
  { name: "iphone-landscape", width: 844, height: 390 },
  { name: "large-landscape", width: 932, height: 430 },
  { name: "desktop", width: 1280, height: 800 }
];

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("keeps the complete calculator inside the reported viewport", async ({ page }) => {
      const consoleProblems = [];
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") consoleProblems.push(message.text());
      });
      await page.goto("/");
      await expect(page).toHaveTitle("Zeitrechner");
      await expect(page.getByRole("button", { name: "Alles löschen" })).toBeVisible();

      const layout = await page.evaluate(() => {
        const app = document.getElementById("app").getBoundingClientRect();
        const controls = [...document.querySelectorAll("button")].filter((button) => !button.closest("dialog"));
        const outOfBounds = controls.filter((control) => {
          const rect = control.getBoundingClientRect();
          return rect.left < app.left - 1 || rect.right > app.right + 1 || rect.top < app.top - 1 || rect.bottom > app.bottom + 1;
        }).map((control) => control.getAttribute("aria-label") || control.textContent.trim());
        const lastRow = [...document.querySelectorAll("#pad button")].slice(-3).map((button) => {
          const rect = button.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        });
        return {
          innerWidth,
          innerHeight,
          clientWidth: document.documentElement.clientWidth,
          clientHeight: document.documentElement.clientHeight,
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          app: { top: app.top, right: app.right, bottom: app.bottom, left: app.left, width: app.width, height: app.height },
          outOfBounds,
          lastRow
        };
      });

      expect(layout.outOfBounds).toEqual([]);
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
      expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 1);
      expect(layout.app.top).toBeGreaterThanOrEqual(-1);
      expect(layout.app.bottom).toBeLessThanOrEqual(layout.innerHeight + 1);
      expect(layout.app.height).toBeGreaterThanOrEqual(layout.innerHeight - 1);
      expect(Math.max(...layout.lastRow.map((row) => row.bottom))).toBeLessThanOrEqual(layout.app.bottom + 1);
      expect(consoleProblems).toEqual([]);
    });
  });
}

test.describe("calculator interactions", () => {
  test.use({ viewport: { width: 402, height: 874 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto("/");
  });

  test("calculates negative times consistently", async ({ page }) => {
    for (const name of ["4", "5", "Subtrahieren", "1", "3", "0", "Ergebnis"]) {
      await page.getByRole("button", { name, exact: true }).click();
    }
    await expect(page.getByRole("status", { name: "Summe", exact: true })).toHaveText("−0:45");
    await expect(page.getByLabel("Aktuelle Eingabe: −0:45")).toHaveText("−0:45");
  });

  test("shows and recovers from division by zero", async ({ page }) => {
    for (const name of ["1", "Dividieren", "0", "Ergebnis"]) {
      await page.getByRole("button", { name, exact: true }).click();
    }
    await expect(page.getByText("Nicht definiert", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "7", exact: true }).click();
    await expect(page.getByLabel("Aktuelle Eingabe: 0:07")).toHaveText("0:07");
  });

  test("keeps calculator keyboard commands out of the modal dialog", async ({ page }) => {
    await page.getByRole("button", { name: "1", exact: true }).click();
    await page.getByRole("button", { name: "2", exact: true }).click();
    await page.getByRole("button", { name: "Informationen und Einstellungen" }).click();
    const dialog = page.getByRole("dialog", { name: "Zeitrechner" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Delete");
    await expect(page.getByLabel("Aktuelle Eingabe: 0:12")).toHaveText("0:12");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Informationen und Einstellungen" })).toBeFocused();
  });

  test("switches modes with accessible pressed state", async ({ page }) => {
    const time = page.getByRole("button", { name: "Zeit", exact: true });
    const number = page.getByRole("button", { name: "Rechner", exact: true });
    await expect(time).toHaveAttribute("aria-pressed", "true");
    await number.click();
    await expect(number).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Dezimaltrennzeichen" })).toBeVisible();
  });

  test("allows browser zoom and remains usable with enlarged root text", async ({ page }) => {
    const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewportMeta).not.toContain("user-scalable=no");
    expect(viewportMeta).not.toContain("maximum-scale");
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await expect(page.getByRole("button", { name: "Alles löschen" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ergebnis" })).toBeVisible();
  });

  test("exposes diagnostics only through the query flag", async ({ page }) => {
    await expect(page.getByRole("dialog", { name: "Layout-Diagnose" })).toHaveCount(0);
    await page.goto("/?diagnostics=1");
    const dialog = page.getByRole("dialog", { name: "Layout-Diagnose" });
    await expect(dialog).toBeVisible();
    const report = JSON.parse(await dialog.locator("pre").textContent());
    expect(report).toHaveProperty("displayMode");
    expect(report).toHaveProperty("visualViewport");
    expect(report).toHaveProperty("safeArea.bottom");
    expect(report).toHaveProperty("build");
    expect(report).toHaveProperty("serviceWorker.status");
    expect(report).toHaveProperty("serviceWorker.version");
  });
});
