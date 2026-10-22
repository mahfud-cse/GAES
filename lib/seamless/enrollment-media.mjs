import { createHash } from "node:crypto";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const repositoryPath = value => /^staff-enrollment\/[^/]+\/[^/]+\/repo-[a-f0-9]{32}$/.test(value);
const fail = (code, status = 409) => {
  throw Object.assign(new Error(code), { code, status });
};
const preview = image => `data:${image.contentType};base64,${image.bytes.toString("base64")}`;

// Repository records contain provenance only; image bytes remain in the private
// deployed repository. Firebase Storage is only used by the storage adapter.
export function createEnrollmentMedia({ storage, readRepository, records }) {
  const reference = async key => {
    let value;
    try { value = await records.get(digest(key)); }
    catch { fail("REPOSITORY_REFERENCE_FAILED", 503); }
    if (!value || value.source !== "repository" || value.path !== key)
      fail("INVALID_PHOTO", 400);
    const image = await readRepository(value.folder, value.file);
    if (digest(image.bytes) !== value.sha256 || image.contentType !== value.contentType)
      fail("REPOSITORY_PHOTO_CHANGED");
    return { value, image };
  };
  return {
    ...storage,
    async importRepository({ folder, file, path, meta }) {
      if (!repositoryPath(path)) fail("INVALID_PHOTO", 400);
      const image = await readRepository(folder, file);
      const value = { source: "repository", path, folder, file,
        uid: meta.uid, owner: meta.owner, pose: meta.pose,
        sha256: digest(image.bytes), contentType: image.contentType,
        createdAt: new Date().toISOString() };
      try { await records.put(digest(path), value); }
      catch { fail("REPOSITORY_REFERENCE_FAILED", 503); }
      return { preview: preview(image) };
    },
    async validate(path) {
      if (!repositoryPath(path)) return storage.validate(path);
      const { value } = await reference(path);
      return { uid: value.uid, owner: value.owner, pose: value.pose };
    },
    async read(path) {
      return repositoryPath(path) ? (await reference(path)).image : storage.read(path);
    },
    async readUrl(path) {
      return repositoryPath(path) ? preview((await reference(path)).image) : storage.readUrl(path);
    },
  };
}
