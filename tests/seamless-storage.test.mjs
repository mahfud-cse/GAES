import test from "node:test";
import assert from "node:assert/strict";
import { createStorageMedia, storageBucketName, storageFailure } from "../lib/seamless/storage-media.mjs";
import { safeOperationCodes } from "../lib/seamless/operations.mjs";

test("normalizes existing bucket configuration without guessing or creating a bucket", () => {
  assert.equal(storageBucketName({ FIREBASE_STORAGE_BUCKET: " gs://existing-bucket.firebasestorage.app/ " }), "existing-bucket.firebasestorage.app");
  assert.equal(storageBucketName({ FIREBASE_STORAGE_BUCKET: " ", NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "existing-bucket.appspot.com" }), "existing-bucket.appspot.com");
  assert.throws(() => storageBucketName({}), { code: "STORAGE_NOT_CONNECTED" });
  for (const value of ["https://example.com/bucket", "bucket/folder", "../bucket"]) {
    assert.throws(() => storageBucketName({ FIREBASE_STORAGE_BUCKET: value }), { code: "STORAGE_CONFIG_INVALID" });
  }
});

for (const [source, expected] of [
  [{ code: 403 }, "STORAGE_PERMISSION_DENIED"],
  [{ code: 401 }, "STORAGE_CREDENTIAL_INVALID"],
  [{ code: 404 }, "STORAGE_BUCKET_NOT_FOUND"],
  [{ code: 400 }, "STORAGE_CONFIG_INVALID"],
  [{ code: 429 }, "STORAGE_QUOTA_EXCEEDED"],
  [{ code: 403, errors: [{ reason: "accountDisabled" }] }, "STORAGE_PROJECT_BLOCKED"],
  [{ code: 403, errors: [{ reason: "accessNotConfigured" }] }, "STORAGE_API_DISABLED"],
  [{ code: "storage/invalid-credential" }, "STORAGE_CREDENTIAL_INVALID"],
  [{ code: "storage/invalid-argument" }, "STORAGE_CONFIG_INVALID"],
  [{ code: "ETIMEDOUT" }, "STORAGE_OPERATION_FAILED"],
]) {
  test(`maps backend storage failure ${JSON.stringify(source)} to ${expected}`, async () => {
    const media = createStorageMedia({ getBucket: () => ({ file: () => ({ save: async () => {
      throw Object.assign(new Error("private-URL-and-secret-should-never-leak"), source);
    } }) }) });
    await assert.rejects(media.save("private-photo", { bytes: Buffer.from("image"), contentType: "image/jpeg" }, {}), error => {
      assert.equal(error.code, expected);
      assert.equal(error.stage, "storage-save");
      assert.equal(error.status, 503); // Must not refresh browser login for backend credentials.
      assert.doesNotMatch(JSON.stringify(error) + error.message + error.stack, /private-URL-and-secret/);
      assert.ok(safeOperationCodes.has(expected));
      return true;
    });
  });
}

test("keeps write 404 distinct from a missing stored photo", () => {
  assert.equal(storageFailure({ code: 404 }, "storage-read").code, "STORAGE_PHOTO_NOT_FOUND");
});

test("success preserves private save options, bytes, metadata and repository import", async () => {
  const bytes = Buffer.from("photo-bytes");
  let options;
  const file = {
    save: async (data, value) => { assert.deepEqual(data, bytes); options = value; },
    getMetadata: async () => [{ contentType: "image/png", metadata: { uid: "staff", owner: "admin", pose: "front" } }],
    download: async () => [bytes],
    getSignedUrl: async value => { assert.equal(value.action, "read"); assert.ok(value.expires > Date.now()); return ["private-preview"]; },
  };
  const media = createStorageMedia({ getBucket: () => ({ file: () => file }), repository: async () => ({ bytes, contentType: "image/png" }) });
  await media.save("staff-enrollment/staff/admin/photo", { bytes, contentType: "image/png" }, { uid: "staff", owner: "admin", pose: "front" });
  assert.equal(options.resumable, false);
  assert.equal(options.timeout, 15000);
  assert.equal(options.metadata.cacheControl, "private, no-store");
  assert.deepEqual((await media.read("photo")).bytes, bytes);
  assert.deepEqual(await media.validate("photo"), { uid: "staff", owner: "admin", pose: "front" });
  assert.equal(await media.readUrl("photo"), "private-preview");
  assert.deepEqual((await media.repository("CGK", "photo.png")).bytes, bytes);
});

test("catches configuration errors raised while selecting the bucket", async () => {
  const media = createStorageMedia({ getBucket: () => { throw Object.assign(new Error("missing"), { code: "STORAGE_NOT_CONNECTED" }); } });
  await assert.rejects(media.save("photo", {}, {}), { code: "STORAGE_NOT_CONNECTED", stage: "storage-save" });
});
