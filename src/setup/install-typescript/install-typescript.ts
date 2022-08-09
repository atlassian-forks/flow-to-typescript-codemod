// Install the appropriate TypeScript in the current directory.
import path from "path";
import { exec } from "child_process";
import { existsSync } from "fs";
import { logger } from "../../runner/logger";

// This TS version should match with version of "typescript" in the root `package.json` file.
const TS_VERSION = "^4.7.4";

/**
 * Install a fixed version of typescript
 */
export function installTypescript() {
  return new Promise((resolve, reject) => {
    if (!existsSync(path.join(process.cwd(), "package.json"))) {
      throw new Error("Must run this in a directory with a package.json");
    }

    exec(`yarn add --dev typescript@${TS_VERSION}`, (err, stdout) => {
      if (err) {
        logger.error("Real Err:", err);
        return reject(err);
      }

      resolve(stdout);
    });
  });
}
