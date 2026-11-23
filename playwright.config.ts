import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  workers: 4,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4180",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.READER_BROWSER_CHANNEL,
        launchOptions: {
          executablePath: process.env.READER_BROWSER_EXECUTABLE,
        },
        viewport: { width: 1366, height: 830 },
      },
    },
    {
      name: "phone",
      use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command:
      "npm run build && npm run preview -- --host 127.0.0.1 --port 4180 --strictPort",
    url: "http://127.0.0.1:4180",
    reuseExistingServer: false,
  },
});
