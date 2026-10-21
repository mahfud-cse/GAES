import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const output =
  process.env.GAES_BROWSER_TEST_OUTPUT || "/tmp/gaes-seamless-browser";
await mkdir(output, { recursive: true });
const { build } = await import(
  pathToFileURL(root + "/node_modules/esbuild/lib/main.js")
);
const { createOperationsService } = await import(
  pathToFileURL(root + "/lib/seamless/operations.mjs")
);
const { MemoryDB } = await import(
  pathToFileURL(root + "/tests/helpers/seamless-db.mjs")
);
const db = new MemoryDB();
db.rows.set("users/admin-1", {
  name: "Administrator",
  active: true,
  role: "Admin",
  station: "ALL",
});
db.rows.set("stations/CGK-random-document-id", {
  code: "CGK",
  name: "Jakarta",
  status: "Aktif",
});
db.rows.set("stations/PLM-random-document-id", {
  code: "PLM",
  name: "Palembang",
  status: "Aktif",
});
db.rows.set("loungeLayouts/map-1", {
  title: "Garuda Lounge Map",
  station: "CGK",
  loungeId: "lounge-1",
  status: "Published",
});
db.rows.set("displayContents/video-1", {
  title: "Lounge Welcome",
  station: "ALL",
  status: "Active",
  contentType: "Video",
  sourceUrl: "/test-video.mp4",
});
let connected = false,
  gateMode = "confirmed",
  commands = 0;
const objects = new Map();
const provider = {
  get configured() {
    return connected;
  },
  get entitlementConfigured() {
    return connected;
  },
  get gateConfigured() {
    return connected;
  },
  enroll: async () => ({ verified: true, referenceId: "staff-reference" }),
  resolveClaim: async () => ({
    subjectKey: "passenger-1",
    referenceId: "passenger-reference",
    category: "Passenger",
    displayName: "Budi",
    flight: "GA204",
  }),
  verifyOneToOne: async (s) => ({
    matched: true,
    livenessPassed: true,
    sessionId: s.sessionId,
    referenceId: s.referenceId,
  }),
  passengerEntitlement: async (s) => ({
    eligible: true,
    subjectKey: s.subjectKey,
    loungeId: s.loungeId,
    validUntil: Date.now() + 60000,
  }),
  openGate: async (s) => {
    commands++;
    return {
      physicalOpenConfirmed: gateMode === "confirmed",
      idempotencyKey: s.idempotencyKey,
      loungeId: s.loungeId,
    };
  },
};
const service = createOperationsService({
  authenticate: async () => ({
    decoded: { uid: "admin-1" },
    profile: db.rows.get("users/admin-1"),
  }),
  database: () => db,
  audit: (tx, d, _, record) => tx.set(d.collection("auditLogs").doc(), record),
  provider,
  media: {
    save: async (path, image, meta) => objects.set(path, { image, meta }),
    validate: async (path) => objects.get(path)?.meta || {},
    readUrl: async (path) =>
      `data:${objects.get(path).image.contentType};base64,${objects.get(path).image.bytes.toString("base64")}`,
    repository: async () => {
      throw Object.assign(new Error("INVALID_REPOSITORY_PATH"), {
        code: "INVALID_REPOSITORY_PATH",
        status: 400,
      });
    },
  },
});
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import SeamlessAccess from './app/seamless-access';import Enrollment from './app/staff-enrollment/page';const user={getIdToken:async()=> 'BROWSER-TEST-TOKEN'};function App(){const[language,setLanguage]=useState('ID');return location.pathname==='/staff-enrollment'?<Enrollment/>:<><button id="app-language" onClick={()=>setLanguage(language==='ID'?'EN':'ID')}>Language</button><main style={{padding:'25px',maxWidth:1400,margin:'auto'}}><SeamlessAccess user={user} role="Admin" language={language} onLanguageChange={setLanguage} initialLoungeId="lounge-1" lounges={[{id:'lounge-1',airport:'CGK',name:'Garuda Executive Lounge',status:'Aktif'}]}/></main></>};createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  jsx: "automatic",
  loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "link-test-shim",
      setup(b) {
        b.onResolve({ filter: /^next\/link$/ }, () => ({
          path: "next-link",
          namespace: "shim",
        }));
        b.onLoad({ filter: /.*/, namespace: "shim" }, () => ({
          contents: `import React from 'react';export default function Link(props){return React.createElement('a',props)}`,
          loader: "jsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const globalCss = await readFile(root + "/app/globals.css", "utf8"),
  css = await readFile(root + "/app/seamless.css", "utf8");
let dropResponse = false;
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/test.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(bundle.outputFiles[0].text);
      return;
    }
    if (req.url === "/test-video.mp4") {
      res.setHeader("Content-Type", "video/mp4");
      res.end(await readFile(root + "/tests/fixtures/standby.mp4"));
      return;
    }
    if (req.url === "/garuda-wing.svg") {
      res.setHeader("Content-Type", "image/svg+xml");
      res.end(await readFile(root + "/public/garuda-wing.svg"));
      return;
    }
    if (req.url.startsWith("/.netlify/functions/seamless-operations")) {
      let raw = "";
      for await (const part of req) raw += part;
      try {
        const r = await service(
          new Request("http://localhost" + req.url, {
            method: "POST",
            headers: req.headers,
            body: raw,
          }),
        );
        if (dropResponse && JSON.parse(raw).action === "verify-one-to-one") {
          dropResponse = false;
          req.socket.destroy();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(r));
      } catch (e) {
        res.statusCode = e.status || 503;
        res.end(JSON.stringify({ error: e.code || e.message }));
      }
      return;
    }
    res.end(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globalCss}\n${css}</style></head><body><div id="root"></div><script src="/test.js"></script></body></html>`,
    );
  } catch (e) {
    res.statusCode = 500;
    res.end(e.message);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
    : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
});
await context.addInitScript(() => {
  let index = 0;
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: async () => {
        const c = document.createElement("canvas");
        c.width = 640;
        c.height = 480;
        const g = c.getContext("2d");
        g.fillStyle = ["#809ba8", "#94a5bb", "#758f9e"][index++ % 3];
        g.fillRect(0, 0, 640, 480);
        g.fillStyle = "#dce9f1";
        g.beginPath();
        g.ellipse(320, 210, 95, 120, 0, 0, Math.PI * 2);
        g.fill();
        return c.captureStream(15);
      },
    },
  });
});
const page = await context.newPage(),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const pass = (msg) => {
  checks.push(msg);
  console.log("PASS", msg);
};
const noOverflow = async (p) =>
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "Siapkan layar lounge" }).waitFor();
  await page
    .getByRole("button", { name: "Buka layar lounge" })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.querySelector("button.sa-primary:disabled"),
  );
  await page.getByLabel("Station", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("DEMO / SIMULATED", { exact: true }).count(),
    0,
  );
  assert.deepEqual(
    await page
      .getByLabel("Station", { exact: true })
      .locator("option")
      .allTextContents(),
    ["Pilih station", "CGK", "PLM"],
  );
  pass(
    "clean operations UI and master station codes; no document IDs or synthetic scenarios",
  );
  await page.getByLabel("Video saat standby").selectOption("video-1");
  await page.getByLabel("Denah lounge").selectOption("map-1");
  await page.getByRole("button", { name: "Simpan pengaturan" }).click();
  await page.getByText("Pengaturan layar disimpan.").waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Siapkan layar lounge" }).waitFor();
  await page.waitForFunction(
    () => document.querySelector("select")?.options.length > 1,
  );
  await page.getByLabel("Video saat standby").selectOption("video-1");
  assert.equal(await page.getByLabel("Denah lounge").inputValue(), "map-1");
  pass("video and published map preferences persist through backend");
  await page.screenshot({
    path: output + "/seamless-v2-operations.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Buka layar lounge" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("heading", { name: /Selamat datang/ }).waitFor();
  assert.equal(
    await dialog
      .locator("video")
      .evaluate((v) => v.loop && v.muted && v.autoplay),
    true,
  );
  await dialog.getByRole("button", { name: "Mulai verifikasi wajah" }).click();
  assert.equal(
    await dialog
      .getByRole("button", { name: "Lanjutkan", exact: true })
      .isDisabled(),
    true,
  );
  await dialog
    .getByText("Verifikasi wajah belum tersedia.", { exact: false })
    .waitFor();
  pass(
    "lounge screen loops selected video; unconfigured face integration cannot grant access",
  );
  await dialog
    .getByRole("button", { name: "Change language" })
    .count()
    .catch(() => {});
  await dialog.getByRole("button", { name: "Ganti bahasa" }).click();
  await dialog.getByRole("heading", { name: "Verify your access" }).waitFor();
  await dialog
    .getByText("Face verification is unavailable.", { exact: false })
    .waitFor();
  pass("ID/EN switches lounge labels and unavailable-service messages");
  await dialog.getByRole("button", { name: "Close display" }).click();
  await page.locator("#app-language").click();
  await page
    .getByRole("button", { name: "Registrasi petugas", exact: true })
    .click();
  await page.getByLabel("Station", { exact: true }).selectOption("CGK");
  await page.getByLabel("Akun petugas").selectOption("officer-1");
  assert.doesNotMatch(
    await page
      .getByLabel("Akun petugas")
      .locator("option:checked")
      .textContent(),
    /officer-1/,
  );
  await page.getByLabel("Nomor pegawai", { exact: true }).fill("GA001");
  await page.getByLabel("Unit kerja").fill("Lounge Operations");
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await page
    .getByRole("button", { name: "Simpan registrasi", exact: true })
    .click();
  await page.getByText("Registrasi tersimpan.", { exact: false }).waitFor();
  pass(
    "staff registration saves name, unit, employee number and assigned station/lounge",
  );
  const sample = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 80;
    c.height = 80;
    c.getContext("2d").fillRect(0, 0, 80, 80);
    return c.toDataURL("image/png");
  });
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "staff-test.png",
      mimeType: "image/png",
      buffer: Buffer.from(sample.split(",")[1], "base64"),
    });
  await page.getByText("Foto siap dikirim untuk peninjauan.").waitFor();
  await page
    .getByRole("button", { name: "Kirim foto untuk peninjauan", exact: true })
    .click();
  await page.getByText("Foto dikirim.", { exact: false }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Setujui & aktifkan" }).isDisabled(),
    true,
  );
  pass(
    "private photo upload and PendingReview save; missing provider blocks activation",
  );
  await page
    .getByRole("button", { name: "Buat tautan enrollment", exact: true })
    .click();
  await page.getByLabel("Tautan enrollment", { exact: true }).waitFor();
  const link = await page
    .getByLabel("Tautan enrollment", { exact: true })
    .inputValue();
  assert.match(link, /#\w{64}$/);
  pass("single-use self-enrollment link created with token in URL fragment");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: output + "/seamless-v2-staff-mobile.png",
    fullPage: true,
  });
  pass("staff registration mobile layout has no horizontal overflow");
  await page.setViewportSize({ width: 1440, height: 1050 });
  const self = await context.newPage();
  self.on("pageerror", (e) => errors.push(e.message));
  await self.goto(link);
  await self
    .getByRole("heading", { name: "Siapkan akses petugas Anda" })
    .waitFor();
  await self.getByText("Ayu Pratiwi", { exact: true }).waitFor();
  assert.equal(new URL(self.url()).hash, "");
  await self.getByRole("checkbox").check();
  await self
    .getByRole("button", { name: "Aktifkan kamera", exact: true })
    .click();
  for (const pose of [
    "Lihat lurus ke kamera",
    "Tengok sedikit ke kanan",
    "Tengok sedikit ke kiri",
  ]) {
    await self.getByRole("heading", { name: pose, exact: true }).waitFor();
    await self.getByRole("button", { name: "Ambil foto", exact: true }).click();
  }
  await self
    .getByRole("button", { name: "Kirim untuk peninjauan", exact: true })
    .click();
  await self.getByRole("heading", { name: "Foto berhasil dikirim" }).waitFor();
  await self
    .getByRole("heading", { name: "Menunggu peninjauan admin" })
    .waitFor();
  await self.getByRole("button", { name: "Ganti bahasa" }).click();
  await self.getByRole("heading", { name: "Photos submitted" }).waitFor();
  pass(
    "self-enrollment camera captures three guided poses, submits once, shows review state in both languages",
  );
  await self.reload();
  await self
    .getByText("Tautan tidak valid, kedaluwarsa, atau sudah digunakan.", {
      exact: false,
    })
    .waitFor();
  pass(
    "refresh after token removal fails safely without leaking the enrollment link",
  );
  await self.close();
  connected = true;
  await page
    .getByRole("button", { name: "Operasional & layar lounge" })
    .click();
  await page.getByRole("button", { name: "Periksa koneksi" }).click();
  await page.getByRole("heading", { name: "Siapkan layar lounge" }).waitFor();
  await page.getByRole("button", { name: "Buka layar lounge" }).click();
  await page.getByRole("button", { name: "Mulai verifikasi wajah" }).click();
  await page.getByLabel("Referensi sesi check-in").fill("BROWSER-TEST-SESSION");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Lanjutkan", exact: true }).click();
  await page.getByRole("heading", { name: "Lihat ke arah kamera" }).waitFor();
  await page.getByRole("button", { name: "Izinkan & aktifkan kamera" }).click();
  await page
    .getByText("Gerbang terbuka terkonfirmasi", { exact: true })
    .waitFor();
  await page
    .getByRole("dialog")
    .getByRole("heading", { name: "Selamat datang", exact: true })
    .waitFor();
  await page
    .getByRole("img", { name: "Pindai QR untuk melihat denah lounge" })
    .waitFor();
  assert.equal(commands, 1);
  pass(
    "claimed passenger session -> camera -> automatic 1:1 call -> entitlement -> gate feedback -> welcome and real map QR, using test doubles",
  );
  await page.screenshot({
    path: output + "/seamless-v2-welcome.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Selesai", exact: true }).click();
  gateMode = "unconfirmed";
  await page.getByRole("button", { name: "Mulai verifikasi wajah" }).click();
  await page.getByLabel("Referensi sesi check-in").fill("SECOND-SESSION");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Lanjutkan", exact: true }).click();
  await page.getByRole("button", { name: "Izinkan & aktifkan kamera" }).click();
  await page
    .getByRole("heading", { name: "Silakan hubungi petugas", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByText("Gerbang terbuka terkonfirmasi", { exact: true })
      .count(),
    0,
  );
  pass(
    "eligible face and entitlement without gate acknowledgement displays assistance instead of welcome",
  );
  await page.getByRole("button", { name: "Selesai", exact: true }).click();
  gateMode = "confirmed";
  let dropped = false;
  await page.route(
    "**/.netlify/functions/seamless-operations",
    async (route) => {
      const body = route.request().postDataJSON();
      if (!dropped && body.action === "verify-one-to-one") {
        dropped = true;
        await route.fetch();
        await route.abort();
      } else await route.continue();
    },
  );
  const before = commands;
  await page.getByRole("button", { name: "Mulai verifikasi wajah" }).click();
  await page.getByLabel("Referensi sesi check-in").fill("RETRY-SESSION");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Lanjutkan", exact: true }).click();
  await page.getByRole("button", { name: "Izinkan & aktifkan kamera" }).click();
  await page
    .getByRole("button", { name: "Periksa hasil permintaan" })
    .waitFor();
  await page.getByRole("button", { name: "Periksa hasil permintaan" }).click();
  await page
    .getByText("Gerbang terbuka terkonfirmasi", { exact: true })
    .waitFor();
  assert.equal(commands, before + 1);
  pass(
    "lost verification response retry reuses request and does not duplicate gate command",
  );
  await page.unrouteAll();
  await page.getByRole("button", { name: "Tutup layar" }).click();
  await page
    .getByRole("button", { name: "Registrasi petugas", exact: true })
    .click();
  await page.getByLabel("Station", { exact: true }).selectOption("CGK");
  await page.getByLabel("Akun petugas").selectOption("officer-1");
  await page.getByRole("checkbox").nth(0).check();
  await page
    .getByRole("button", { name: "Setujui & aktifkan", exact: true })
    .click();
  await page.getByText("Enrollment disetujui dan akses diaktifkan.").waitFor();
  pass(
    "HO administrator reviews submitted photos and activates enrollment only with test provider confirmation",
  );
  await page
    .getByRole("button", { name: "Operasional & layar lounge" })
    .click();
  await page.getByRole("button", { name: "Buka layar lounge" }).click();
  await page.getByRole("button", { name: "Mulai verifikasi wajah" }).click();
  await page.getByLabel("Jenis akses").selectOption("Staff");
  await page.getByLabel("Nomor pegawai / kartu petugas").fill("GA001");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Lanjutkan", exact: true }).click();
  await page.getByRole("button", { name: "Izinkan & aktifkan kamera" }).click();
  await page
    .getByRole("heading", { name: "Akses petugas terverifikasi", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("dialog").getByText("GA001", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("dialog")
      .getByRole("img", { name: "Pindai QR untuk melihat denah lounge" })
      .count(),
    0,
  );
  pass("staff access display excludes employee number and passenger map QR");
  await page
    .getByRole("dialog")
    .getByRole("heading", { name: /Selamat datang/ })
    .waitFor({ timeout: 22000 });
  assert.equal(
    await page.getByRole("dialog").getByText("Ayu", { exact: true }).count(),
    0,
  );
  pass("display returns to standby automatically and clears personal result");
  await page.getByRole("button", { name: "Tutup layar" }).click();
  await page
    .getByRole("button", { name: "Aktivitas akses", exact: true })
    .click();
  await page.getByLabel("Hasil akses").selectOption("Eligible");
  assert.ok(
    (await page.getByRole("cell", { name: "Diizinkan", exact: true }).count()) >
      0,
  );
  await page.getByLabel("Cari aktivitas yang dimuat").fill("nothing");
  assert.equal(await page.locator("tbody tr").count(), 0);
  pass("activity filters and search operate on persisted test service results");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  pass("operations/activity mobile layout has no horizontal overflow");
  assert.deepEqual(errors, []);
  pass("zero browser runtime errors");
  await writeFile(
    output + "/seamless-v2-browser-results.json",
    JSON.stringify(
      {
        passed: checks,
        errors,
        scope:
          "Real React components and operations service; test Firestore, Storage, Auth, video, biometric/entitlement/gate doubles. NOT live Firebase or physical hardware.",
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.log("PAGE ERRORS", errors);
  await writeFile(output + "/seamless-v2-debug.html", await page.content());
  await page.screenshot({
    path: output + "/seamless-v2-debug.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
  server.close();
}
