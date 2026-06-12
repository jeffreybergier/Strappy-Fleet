import fs from "node:fs";
import path from "node:path";
import type { StrappyConfig } from "./config.js";
import type { Paths } from "./paths.js";

/**
 * Resolve the disposable checkout root. In this workspace, /repo/checkouts is
 * the intended shared location; elsewhere, fall back to STRAPPY_HOME/checkouts.
 */
export function resolveCheckoutRoot(paths: Paths, config: StrappyConfig): string {
  const env = process.env.STRAPPY_CHECKOUT_ROOT?.trim();
  if (env) return path.resolve(env);

  const configured = config.checkoutRoot?.trim();
  if (configured) return path.resolve(configured);

  if (fs.existsSync("/repo")) return "/repo/checkouts";
  return paths.checkouts;
}
