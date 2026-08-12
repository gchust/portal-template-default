import { devices, defineConfig } from "@playwright/test";

const fixtureURL = "http://127.0.0.1:4174/e2e/react-grab-g01/";

export default defineConfig({
  testDir: ".",
  testMatch: ["react-grab.contract.ts", "source-benchmark.spec.ts", "user-workflow.spec.ts"],
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "../../../test-results/react-grab-g01",
  use: {
    baseURL: fixtureURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "pnpm exec vite --config vite.config.ts --host 127.0.0.1 --port 4174 --strictPort --mode e2e",
    url: fixtureURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
