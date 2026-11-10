import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  site: process.env.SITE_URL ?? "https://fluenthaze.github.io",
  base: process.env.SITE_BASE_PATH ?? "/BranchNote/",
  output: "static",
  trailingSlash: "always",
  integrations: [react()],
  i18n: {
    defaultLocale: "zh-CN",
    locales: ["zh-CN", "zh-TW", "en", "ja", "ko"],
    routing: { prefixDefaultLocale: true },
  },
  devToolbar: { enabled: false },
});
