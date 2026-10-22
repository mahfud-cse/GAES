import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readRepositoryPhoto } from "../lib/seamless/repository-media.mjs";
import { safeOperationCodes } from "../lib/seamless/operations.mjs";

// Valid, generated 80x80 PNG with no personal content.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAIAAAABc2X6AAAAeUlEQVR4nO3PQQ3AMADEsKItuKLcaxjuEUsBEJ9zX6v9ATAwMDAwMHCm/QEwMDAwMDBwpv0BMDAwMDAwcKb9ATAwMDAwMHCm/QEwMDAwMDBwpv0BMDAwMDAwcKb9ATAwMDAwMHCm/QEwMDAwMDBwpv0BMDAwMDDw3wfPaJGHPhVyEgAAAABJRU5ErkJggg==", "base64");
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "gaes-repository-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "CGK"));
  return { directory, read: (folder, file) => readRepositoryPhoto(folder, file, { directory }) };
}

test("imports the reported filename with spaces byte-for-byte", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, "CGK", "Foto Mahfud 3 x4.png"), png);
  const result = await f.read("CGK", "Foto Mahfud 3 x4.png");
  assert.equal(result.contentType, "image/png");
  assert.deepEqual(result.bytes, png);
});

test("imports Unicode names, nested folders and uppercase extensions", async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.directory, "CGK", "Unit Layanan"));
  await writeFile(path.join(f.directory, "CGK", "Unit Layanan", "Foto José (1).PNG"), png);
  assert.deepEqual((await f.read("CGK/Unit Layanan", "Foto José (1).PNG")).bytes, png);
});

test("imports a photo directly beneath the configured root", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, "staff.png"), png);
  assert.deepEqual((await f.read("", "staff.png")).bytes, png);
});

test("missing file and case mismatch return a public deployment-aware 404", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, "CGK", "Staff.png"), png);
  await assert.rejects(f.read("CGK", "staff.png"), { code: "REPOSITORY_PHOTO_NOT_FOUND", status: 404 });
  assert.ok(safeOperationCodes.has("REPOSITORY_PHOTO_NOT_FOUND"));
});

test("missing bundled root returns the same useful 404", async t => {
  const f = await fixture(t);
  await assert.rejects(readRepositoryPhoto("CGK", "staff.png", { directory: path.join(f.directory, "absent") }), { code: "REPOSITORY_PHOTO_NOT_FOUND", status: 404 });
});

test("rejects traversal, absolute paths, separators and unsupported extensions", async t => {
  const f = await fixture(t);
  for (const [folder, file] of [["../", "staff.png"], ["/CGK", "staff.png"], ["CGK//", "staff.png"], ["CGK", "../staff.png"], ["CGK", "sub/staff.png"], ["CGK", "sub\\staff.png"], ["CGK", "staff.svg"], ["CGK", "staff..png"], ["CGK", "staff.png "]]) {
    await assert.rejects(f.read(folder, file), { code: "INVALID_REPOSITORY_PATH", status: 400 });
  }
});

test("rejects symbolic links for files and folders", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, "staff.png"), png);
  await symlink(path.join(f.directory, "staff.png"), path.join(f.directory, "CGK", "linked.png"));
  await symlink(path.join(f.directory, "CGK"), path.join(f.directory, "linked-folder"));
  await assert.rejects(f.read("CGK", "linked.png"), { code: "INVALID_REPOSITORY_PATH" });
  await assert.rejects(f.read("linked-folder", "linked.png"), { code: "INVALID_REPOSITORY_PATH" });
});

test("rejects oversized photos with the specific size error", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, "CGK", "large.png"), Buffer.alloc(1000001));
  await assert.rejects(f.read("CGK", "large.png"), { code: "PHOTO_TOO_LARGE", status: 413 });
});

test("rejects a non-image renamed as PNG", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, "CGK", "invalid.png"), Buffer.alloc(200));
  await assert.rejects(f.read("CGK", "invalid.png"), { code: "INVALID_PHOTO", status: 400 });
});

test("rejects directories masquerading as image files", async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.directory, "CGK", "directory.png"));
  await assert.rejects(f.read("CGK", "directory.png"), { code: "INVALID_REPOSITORY_PATH", status: 400 });
});
