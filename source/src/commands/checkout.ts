import { createCheckout } from "../checkouts.js";
import { loadConfig } from "../config.js";
import { openStore } from "../db.js";
import { getPaths } from "../paths.js";

export interface CheckoutCommandOptions {
  branch?: string;
  name?: string;
  path?: string;
  env?: string;
  envOverwrite?: boolean;
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
    environmentProfile: opts.env,
    environmentOverwrite: opts.envOverwrite,
  });

  console.log(`Checked out ${result.record.repo} as ${result.name}`);
  console.log(`Path   ${result.record.path}`);
  console.log(`Branch ${result.record.currentBranch ?? result.record.branch}`);
  console.log(`Origin ${result.record.remoteUrl ?? "local mirror"}`);
  if (result.environmentRestore) {
    console.log(
      `Env    restored ${result.environmentRestore.restored.length} file(s) from ` +
        `"${result.environmentRestore.manifest.profile}"`,
    );
    if (result.environmentRestore.unchanged.length) {
      console.log(`Env    ${result.environmentRestore.unchanged.length} file(s) already matched`);
    }
    for (const refused of result.environmentRestore.refused) {
      console.log(`Env    refused ${refused.path}: ${refused.reason}`);
    }
    if (result.environmentRestore.refused.length) process.exitCode = 1;
  }
}
