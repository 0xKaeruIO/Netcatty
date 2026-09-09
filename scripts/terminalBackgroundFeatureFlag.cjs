"use strict";

/**
 * Pack/dev-time resolver for the terminal wallpaper feature.
 *
 * `npm run pack` / `vite build` read the environment once and bake the
 * result into the renderer (`import.meta.env.VITE_TERMINAL_BACKGROUND`)
 * and `electron/generated/featureFlags.cjs`. The packaged app does not
 * re-read this env at launch.
 *
 *   NETCATTY_TERMINAL_BACKGROUND=0 npm run pack   # off
 *   NETCATTY_TERMINAL_BACKGROUND=1 npm run pack   # on (default)
 *
 * `VITE_TERMINAL_BACKGROUND` is accepted as an alias. `0` / `false` / `off`
 * disable; unset or any other value keeps the feature on.
 */

function resolveTerminalBackgroundFeatureEnabled(env = process.env) {
  const raw = env.VITE_TERMINAL_BACKGROUND ?? env.NETCATTY_TERMINAL_BACKGROUND;
  if (raw == null || String(raw).trim() === "") return true;
  const normalized = String(raw).trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "off";
}

function writeBakedTerminalBackgroundFeatureFlag(filePath, enabled) {
  const fs = require("node:fs");
  const path = require("node:path");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      '"use strict";',
      "",
      "// Baked at Vite/pack time from NETCATTY_TERMINAL_BACKGROUND. Do not edit.",
      "module.exports = {",
      `  TERMINAL_BACKGROUND_IMAGE_ENABLED: ${enabled ? "true" : "false"},`,
      "};",
      "",
    ].join("\n"),
  );
}

module.exports = {
  resolveTerminalBackgroundFeatureEnabled,
  writeBakedTerminalBackgroundFeatureFlag,
};
