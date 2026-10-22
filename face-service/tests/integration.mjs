import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createSelfHostedProvider } from "../../lib/seamless/self-hosted.mjs";
import { createOperationsService } from "../../lib/seamless/operations.mjs";
import { MemoryDB } from "../../tests/helpers/seamless-db.mjs";
const root = new URL("../", import.meta.url).pathname,
  key = randomBytes(32).toString("hex"),
  port = Number(process.env.GAES_FACE_TEST_PORT || 18765),
  url = `http://127.0.0.1:${port}`,
  state = await mkdtemp(path.join(tmpdir(), "gaes-face-"));
const server = spawn(
  process.env.PYTHON_BIN || "python3",
  [root + "server.py"],
  {
    cwd: root,
    env: {
      ...process.env,
      GAES_FACE_SERVICE_KEY: key,
      GAES_FACE_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      GAES_FACE_DATA_DIR: state,
      GAES_FACE_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let error = "";
server.stderr.on("data", (b) => (error += b.toString()));
try {
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try {
      const r = await fetch(url + "/health", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: "{}",
      });
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, error);
  const unauthorized = await fetch(url + "/health", {
    method: "POST",
    body: "{}",
  });
  assert.equal(unauthorized.status, 401);
  const raw = await readFile(process.env.GAES_FACE_TEST_IMAGE),
    data = "data:image/jpeg;base64," + raw.toString("base64");
  const media = {
    read: async () => ({ bytes: raw, contentType: "image/jpeg" }),
  };
  const provider = createSelfHostedProvider({
    media,
    env: { GAES_FACE_SERVICE_URL: url, GAES_FACE_SERVICE_KEY: key },
  });
  assert.ok(await provider.health());
  assert.equal((await provider.detect({ capture: data })).faceCount, 1);
  const enrolled = await provider.enroll({
    subjectKey: "officer-1",
    photos: [{ path: "private-test-photo" }],
  });
  assert.ok(enrolled.verified);
  const db = new MemoryDB();
  db.rows.get("users/officer-1").seamlessStaff = {
    name: "Staff Test",
    unit: "Lounge",
    employeeNumber: "GA001",
    station: "CGK",
    loungeIds: ["lounge-1"],
    status: "Active",
    active: true,
    referenceId: enrolled.referenceId,
    updatedAt: "version-1",
  };
  const { createHash } = await import("node:crypto");
  db.rows.set(
    "seamlessEmployeeNumbers/" +
      createHash("sha256").update("GA001").digest("hex"),
    { uid: "officer-1" },
  );
  const handle = createOperationsService({
    database: () => db,
    authenticate: async () => ({
      decoded: { uid: "admin-1" },
      profile: db.rows.get("users/admin-1"),
    }),
    audit: (tx, d, _, r) => tx.set(d.collection("auditLogs").doc(), r),
    media,
    provider,
  });
  const call = (x) =>
    handle(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify(x),
      }),
    );
  const { sessionId } = await call({
    action: "claim",
    category: "Staff",
    credential: "GA001",
    consent: true,
    loungeId: "lounge-1",
  });
  const result = await call({
    action: "verify-one-to-one",
    sessionId,
    requestId: "actual-engine-test",
    capture: data,
  });
  assert.equal(result.faceMatched, true);
  assert.equal(result.livenessPassed, false);
  assert.equal(result.gate, "NotRequested");
  assert.equal(result.decision, "Rejected");
  console.log(
    "PASS real local HTTP engine auth, detection, enrollment, Node provider, scoped 1:1 session and face comparison",
  );
  console.log(
    "PASS liveness is NOT claimed: matched face alone never issues a gate command",
  );
} finally {
  server.kill();
}
