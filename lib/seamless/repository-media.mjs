import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { imageBytes } from "./operations.mjs";

const fail = (code, status = 400) => {
  throw Object.assign(new Error(code), { code, status });
};

export async function readRepositoryPhoto(folder, file, {
  directory = path.join(process.cwd(), "private/staff-enrollment"),
} = {}) {
  if (
    typeof folder !== "string" || typeof file !== "string" ||
    folder.length > 200 || file.length > 120 ||
    (folder && !folder.split("/").every(part => /^[\p{L}\p{N}_ -]+$/u.test(part))) ||
    !/^[\p{L}\p{N}_ .()-]+\.(?:jpe?g|png|webp)$/iu.test(file) ||
    file.includes("..") || file !== file.trim()
  ) fail("INVALID_REPOSITORY_PATH");
  try {
    const root = await realpath(directory);
    let target = root;
    for (const part of [...(folder ? folder.split("/") : []), file]) {
      target = path.join(target, part);
      if ((await lstat(target)).isSymbolicLink()) fail("INVALID_REPOSITORY_PATH");
    }
    const resolved = await realpath(target);
    if (!resolved.startsWith(root + path.sep)) fail("INVALID_REPOSITORY_PATH");
    const info = await lstat(resolved);
    if (!info.isFile()) fail("INVALID_REPOSITORY_PATH");
    if (info.size > 1000000) fail("PHOTO_TOO_LARGE", 413);
    const data = await readFile(resolved);
    // Recheck after reading as well as before allocating the response.
    if (data.length > 1000000) fail("PHOTO_TOO_LARGE", 413);
    const ext = path.extname(file).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return imageBytes(`data:${mime};base64,${data.toString("base64")}`);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) fail("REPOSITORY_PHOTO_NOT_FOUND", 404);
    if (!error.code || !["INVALID_REPOSITORY_PATH", "PHOTO_TOO_LARGE", "INVALID_PHOTO"].includes(error.code)) {
      throw Object.assign(new Error("REPOSITORY_READ_FAILED"), { code: "REPOSITORY_READ_FAILED", status: 503, stage: "repository-read" });
    }
    throw error;
  }
}
