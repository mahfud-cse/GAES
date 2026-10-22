import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOperationsService } from "../lib/seamless/operations.mjs";
import { createEnrollmentMedia } from "../lib/seamless/enrollment-media.mjs";
import { readRepositoryPhoto } from "../lib/seamless/repository-media.mjs";
import { createSelfHostedProvider } from "../lib/seamless/self-hosted.mjs";
import { MemoryDB } from "./helpers/seamless-db.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAIAAAABc2X6AAAAeUlEQVR4nO3PQQ3AMADEsKItuKLcaxjuEUsBEJ9zX6v9ATAwMDAwMHCm/QEwMDAwMDBwpv0BMDAwMDAwcKb9ATAwMDAwMHCm/QEwMDAwMDBwpv0BMDAwMDAwcKb9ATAwMDAwMHCm/QEwMDAwMDBwpv0BMDAwMDDw3wfPaJGHPhVyEgAAAABJRU5ErkJggg==", "base64");
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "gaes-repo-flow-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "CGK"));
  const file = path.join(directory, "CGK", "Staff photo.png");
  await writeFile(file, png);
  const records = new Map(), objects = new Map();
  let storageCalls = 0, offline = true, recordFailure = false;
  const check = () => { storageCalls++; if (offline) throw new Error("STORAGE_NOT_CONNECTED"); };
  const make = () => createEnrollmentMedia({
    storage: {
      save: async (key, image, meta) => { check(); objects.set(key, { image, meta }); },
      read: async key => { check(); return objects.get(key).image; },
      validate: async key => { check(); return objects.get(key).meta; },
      readUrl: async () => { check(); return "storage-preview"; },
    },
    readRepository: (folder, name) => readRepositoryPhoto(folder, name, { directory }),
    records: {
      put: async (key, value) => { if (recordFailure) throw new Error("db denied"); records.set(key, structuredClone(value)); },
      get: async key => records.get(key),
    },
  });
  const media = make(), db = new MemoryDB();
  db.rows.set("stations/CGK", { code: "CGK", status: "Aktif" });
  const provider = createSelfHostedProvider({ media,
    env: { GAES_FACE_SERVICE_URL: "https://test-engine.invalid", GAES_FACE_SERVICE_KEY: "k".repeat(40) },
    fetcher: async (url, init) => {
      assert.equal(new URL(url).pathname, "/enroll");
      const input = JSON.parse(init.body);
      assert.equal(input.photos[0], "data:image/png;base64," + png.toString("base64"));
      return new Response(JSON.stringify({ verified: true, referenceId: "single-reference" }), { status: 200 });
    },
  });
  const handler = createOperationsService({ media, provider, database: () => db,
    authenticate: async () => ({ decoded: { uid: "admin-1" }, profile: db.rows.get("users/admin-1") }),
    audit: (tx, d, _, row) => tx.set(d.collection("auditLogs").doc(), row),
  });
  const call = input => handler(new Request("http://localhost", { method: "POST", body: JSON.stringify(input) }));
  const { uid } = await call({ action: "registry-save", name: "Demo Staff", unit: "Lounge", employeeNumber: "GA111", station: "CGK", loungeIds: ["lounge-1"], consent: true, identityConfirmed: true });
  return { media, make, call, uid, records, file, db,
    calls: () => storageCalls, enableStorage: () => { offline = false; },
    failRecords: () => { recordFailure = true; },
    pick: () => call({ action: "registry-photo-repository", uid, folder: "CGK", file: "Staff photo.png", consent: true }),
  };
}

test("repository import, preview, submission and engine enrollment need zero Storage calls", async t => {
  const f = await fixture(t), result = await f.pick();
  assert.match(result.photo.path, /\/repo-[a-f0-9]{32}$/);
  assert.equal(result.preview, "data:image/png;base64," + png.toString("base64"));
  await f.call({ action: "registry-enrollment-save", uid: f.uid, photos: [result.photo], consent: true });
  assert.equal((await f.call({ action: "registry-photo", uid: f.uid })).url, result.preview);
  await f.call({ action: "registry-approve", uid: f.uid, identityConfirmed: true });
  assert.equal(f.calls(), 0);
  const serialized = JSON.stringify([...f.records.values()]);
  assert.doesNotMatch(serialized, /"bytes"|data:image|iVBORw0/);
});

test("repository references survive a new media adapter instance", async t => {
  const f = await fixture(t), result = await f.pick();
  assert.deepEqual((await f.make().read(result.photo.path)).bytes, png);
  assert.equal(f.calls(), 0);
});

test("a changed repository file is rejected before submission or enrollment", async t => {
  const f = await fixture(t), result = await f.pick();
  await writeFile(f.file, Buffer.concat([png, Buffer.from([1])]));
  await assert.rejects(f.call({ action: "registry-enrollment-save", uid: f.uid, photos: [result.photo], consent: true }), { code: "REPOSITORY_PHOTO_CHANGED" });
  assert.equal(f.calls(), 0);
});

test("repository selection still requires explicit consent", async t => {
  const f = await fixture(t);
  await assert.rejects(f.call({ action: "registry-photo-repository", uid: f.uid, folder: "CGK", file: "Staff photo.png" }), { code: "CONSENT_REQUIRED" });
  assert.equal(f.records.size, 0);
});

test("fabricated or differently owned references cannot be submitted", async t => {
  const f = await fixture(t), result = await f.pick();
  for (const photo of [
    { ...result.photo, path: result.photo.path.replace("/admin-1/", "/another-owner/") },
    { ...result.photo, path: result.photo.path.replace(/repo-.+$/, "repo-" + "0".repeat(32)) },
  ]) await assert.rejects(f.call({ action: "registry-enrollment-save", uid: f.uid, photos: [photo], consent: true }), { code: "INVALID_PHOTO" });
  assert.equal(f.calls(), 0);
});

test("uploads still require Storage, while repository remains independent", async t => {
  const f = await fixture(t);
  await assert.rejects(f.call({ action: "registry-photo-upload", uid: f.uid, data: "data:image/png;base64," + png.toString("base64"), consent: true }), /STORAGE_NOT_CONNECTED/);
  const before = f.calls();
  await f.pick();
  assert.equal(f.calls(), before);
});

test("existing Storage photos remain readable after enabling Storage", async t => {
  const f = await fixture(t);
  f.enableStorage();
  const result = await f.call({ action: "registry-photo-upload", uid: f.uid, data: "data:image/png;base64," + png.toString("base64"), consent: true });
  await f.call({ action: "registry-enrollment-save", uid: f.uid, photos: [result.photo], consent: true });
  assert.equal((await f.call({ action: "registry-photo", uid: f.uid })).url, "storage-preview");
  assert.ok(f.calls() > 0);
});

test("failed reference metadata persistence is explicit and never uses Storage", async t => {
  const f = await fixture(t);
  f.failRecords();
  await assert.rejects(f.pick(), { code: "REPOSITORY_REFERENCE_FAILED" });
  assert.equal(f.calls(), 0);
});

test("browser demo returns one consented scoped reference without activating staff access", async t => {
  const f = await fixture(t), imported = await f.pick();
  await f.call({action:"registry-enrollment-save",uid:f.uid,photos:[imported.photo],consent:true});
  const result = await f.call({action:"registry-browser-reference",uid:f.uid,loungeId:"lounge-1",consent:true});
  assert.equal(result.mode,"BROWSER_DEMO");
  assert.equal(result.displayName,"Demo Staff");
  assert.equal(result.photo,"data:image/png;base64,"+png.toString("base64"));
  assert.ok(Date.parse(result.expiresAt)>Date.now());
  assert.ok(Date.parse(result.expiresAt)<=Date.now()+600000);
  assert.equal(f.db.rows.get("seamlessStaffProfiles/"+f.uid).seamlessStaff.status,"PendingReview");
  assert.equal(f.calls(),0);
});

test("browser reference rejects missing consent and another lounge", async t => {
  const f = await fixture(t), imported = await f.pick();
  await f.call({action:"registry-enrollment-save",uid:f.uid,photos:[imported.photo],consent:true});
  await assert.rejects(f.call({action:"registry-browser-reference",uid:f.uid,loungeId:"lounge-1"}),{code:"CONSENT_REQUIRED"});
  await assert.rejects(f.call({action:"registry-browser-reference",uid:f.uid,loungeId:"other-lounge",consent:true}),{code:"STAFF_SCOPE_INVALID"});
  assert.equal(f.calls(),0);
});

test("browser demo cannot expose an unsubmitted or revoked staff photo", async t => {
  const f = await fixture(t);
  await assert.rejects(f.call({action:"registry-browser-reference",uid:f.uid,loungeId:"lounge-1",consent:true}),{code:"PHOTO_REQUIRED"});
  const imported=await f.pick();
  await f.call({action:"registry-enrollment-save",uid:f.uid,photos:[imported.photo],consent:true});
  await f.call({action:"registry-deactivate",uid:f.uid});
  await assert.rejects(f.call({action:"registry-browser-reference",uid:f.uid,loungeId:"lounge-1",consent:true}),{code:"PHOTO_REQUIRED"});
});
