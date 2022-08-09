import fs from "fs-extra";
import {
  updateSnapshotContents,
  needsSnapshotUpdate,
} from "../convert/patterns";

/**
 * Updates snapshot files containing RLL components with
 * paths pointing to *.js files.
 */
export const updateSnapshotFile = async (filePath: string) => {
  const fileText = await fs.readFile(filePath, "utf-8");

  // Avoid unnecessary write to files that don't need updates
  if (!needsSnapshotUpdate(fileText)) {
    return;
  }

  await fs.writeFile(filePath, updateSnapshotContents(fileText));
};
