import { createCheckout } from "../checkouts.js";
import { loadConfig } from "../config.js";
import { openStore } from "../db.js";
import { getPaths } from "../paths.js";

export interface CheckoutCommandOptions {
  branch?: string;
  name?: string;
  path?: string;
}

export async function checkoutCommand(
  repo: string,
  opts: CheckoutCommandOptions,
): Promise<void> {
  const paths = getPaths();
  const config = await loadConfig(paths);
  const store = openStore(paths);

  const result = await createCheckout({
    store,
    paths,
    config,
    repoArg: repo,
    branch: opts.branch,
    name: opts.name,
    targetPath: opts.path,
  });

  console.log(`Checked out ${result.record.repo} as ${result.name}`);
  console.log(`Path   ${result.record.path}`);
  console.log(`Branch ${result.record.currentBranch ?? result.record.branch}`);
  console.log(`Origin ${result.record.remoteUrl ?? "local mirror"}`);
}
