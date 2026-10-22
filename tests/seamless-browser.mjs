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
let faceCount = 0,
  liveness = false;
let connected = false,
  gateMode = "confirmed",
  commands = 0;
let photoSaveFails = false, detectionFails = false;
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
  detect: async () => { if (detectionFails) throw new Error("SERVICE_UNAVAILABLE"); return { faceCount }; },
  verifyOneToOne: async (s) => ({
    matched: true,
    livenessPassed: liveness,
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
    save: async (path, image, meta) => { if (photoSaveFails) throw new Error(typeof photoSaveFails === "string" ? photoSaveFails : "STORAGE_NOT_CONNECTED"); return objects.set(path, { image, meta }); },
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
        res.end(JSON.stringify({ error: e.code || e.message, requestId: "c34ab082-2514-4525-889d-028f44eaa251" }));
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
  await page
    .getByRole("heading", { name: "Pengaturan layar lounge" })
    .waitFor();
  await page
    .getByRole("button", { name: "Aktivitas Akses", exact: true })
    .click();
  await page
    .getByText("Belum ada lokasi yang dipilih.", { exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".sa-panel h2").textContent(),
    "Aktivitas akses",
  );
  pass(
    "activity opens without an inherited lounge or misleading location heading",
  );
  await page
    .getByRole("button", { name: "Operasional & Layar Lounge", exact: true })
    .click();
  await page.getByLabel("Station", { exact: true }).selectOption("CGK");
  await page.getByLabel("Lounge", { exact: true }).selectOption("lounge-1");
  await page.getByRole("button", { name: "Buka layar lounge" }).waitFor();
  await page.getByLabel("Video saat layar siaga").selectOption("video-1");
  await page.getByLabel("Denah lounge").selectOption("map-1");
  await page.getByLabel("Orientasi layar").selectOption("portrait");
  await page.getByRole("button", { name: "Simpan pengaturan" }).click();
  await page.getByText("Pengaturan layar disimpan.").waitFor();
  pass(
    "master station/lounge, library video, published map and portrait preference save successfully",
  );
  await page.screenshot({
    path: output + "/seamless-v3-operations.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    const nav = document.createElement("nav");
    nav.className = "subTabs facilityTabs";
    nav.id = "reference-nav";
    nav.innerHTML = "<button>Reference</button>";
    document.body.appendChild(nav);
  });
  const properties = (el) => {
    const c = getComputedStyle(el);
    return {
      radius: c.borderRadius,
      font: c.fontSize,
      padding: c.padding,
      background: c.backgroundColor,
      color: c.color,
    };
  };
  const reference = page.locator("#reference-nav button"),
    tab = page.getByRole("button", { name: "Registrasi Petugas", exact: true });
  assert.deepEqual(
    await tab.evaluate(properties),
    await reference.evaluate(properties),
  );
  await tab.hover();
  await page.waitForTimeout(300);
  const tabHover = await tab.evaluate(properties);
  await reference.hover();
  await page.waitForTimeout(300);
  assert.deepEqual(tabHover, await reference.evaluate(properties));
  await page.locator("#reference-nav").evaluate((el) => el.remove());
  pass(
    "navigation uses the portal facility tab shape, typography and hover colors",
  );
  await page.getByRole("button", { name: "Buka layar lounge" }).click();
  const display = page.getByRole("dialog");
  const bounds = await display.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    };
  });
  assert.equal(bounds.top, 0);
  assert.equal(await page.locator("#root").getAttribute("inert"), "");
  assert.equal(bounds.left, 0);
  assert.equal(bounds.width, bounds.viewportWidth);
  assert.equal(bounds.height, bounds.viewportHeight);
  await display.locator("video").first().waitFor({ state: "attached" });
  assert.equal(await display.locator("input,select,button").count(), 0);
  assert.equal(await display.getAttribute("data-orientation"), "portrait");
  await page.screenshot({
    path: output + "/seamless-v3-display-portrait.png",
    fullPage: true,
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".sa-live-camera video")?.srcObject?.active ===
      true,
  );
  await display.getByText("Verifikasi wajah belum tersedia. Petugas kami siap membantu.").waitFor();
  assert.equal(await display.getAttribute("data-phase"), "camera");
  assert.equal(await display.locator(".sa-display-idle").count(), 0);
  assert.equal(await display.locator(".sa-live-camera").evaluate(el => getComputedStyle(el).opacity), "1");
  pass("disconnected engine keeps the live camera visible with an honest service message, never a false welcome/idle state");
  connected = true;
  await display.locator(".sa-idle-video").waitFor({ timeout: 16000 });
  faceCount = 1;
  await display.getByText("Silakan lakukan check-in atau tunjukkan kartu kepada petugas.").waitFor({ timeout: 8000 });
  assert.equal(await display.getAttribute("data-phase"), "camera");
  assert.equal(commands, 0);
  pass("engine recovers without reopening display; a detected face reveals camera and check-in guidance when no identity session exists");
  detectionFails = true;
  await display.getByText("Verifikasi belum tersedia. Silakan hubungi petugas.").waitFor({ timeout: 8000 });
  assert.equal(await display.getAttribute("data-phase"), "camera");
  pass("face detection failure shows the live camera and assistance message, not a welcome screen");
  detectionFails = false;
  faceCount = 0;
  await display.locator(".sa-idle-video").waitFor({ timeout: 8000 });
  assert.ok(
    await display
      .locator(".sa-idle-video")
      .evaluate((v) => v.loop && v.autoplay && v.muted),
  );
  pass(
    "display opens directly with camera standby and idle advertising; no guest buttons, login form or category input",
  );
  await page.keyboard.press("Escape");
  connected = false;
  await page.getByLabel("Orientasi layar").selectOption("landscape");
  await page.getByRole("button", { name: "Buka layar lounge" }).click();
  assert.equal(
    await page.getByRole("dialog").getAttribute("data-orientation"),
    "landscape",
  );
  await page.keyboard.press("Escape");
  pass(
    "both display orientations are available and operator Escape exits cleanly",
  );
  await page
    .getByRole("button", { name: "Registrasi Petugas", exact: true })
    .click();
  await page.getByLabel("Station", { exact: true }).selectOption("CGK");
  assert.ok(
    (
      await page
        .getByLabel("Akun petugas (opsional)", { exact: true })
        .locator("option")
        .allTextContents()
    ).some((s) => s.includes("Ayu Pratiwi")),
  );
  await page.getByLabel("Nama lengkap").fill("Station Staff");
  await page.getByLabel("Nomor pegawai", { exact: true }).fill("GA999");
  await page.getByLabel("Unit kerja").fill("Station Operations");
  await page.getByLabel("Lokasi penugasan").selectOption("lounge-1");
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await page
    .getByRole("button", { name: "Simpan registrasi", exact: true })
    .click();
  await page.getByText("Registrasi tersimpan.", { exact: false }).waitFor();
  pass(
    "registration works without a portal account and optional lookup contains existing master users",
  );
  const sample = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 80;
    c.height = 80;
    c.getContext("2d").fillRect(0, 0, 80, 80);
    return c.toDataURL("image/png");
  });
  await page.getByLabel("Petugas menyetujui penggunaan foto untuk verifikasi wajah.", { exact: true }).uncheck();
  assert.equal(await page.locator("input[type=file]").isDisabled(), true);
  await page.getByText("Centang persetujuan di atas untuk mengunggah foto atau menggunakan kamera.").waitFor();
  await page.getByLabel("Petugas menyetujui penggunaan foto untuk verifikasi wajah.", { exact: true }).check();
  await page.locator("input[type=file]").setInputFiles({name: "large.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(1000001)});
  await page.getByRole("alert").filter({hasText: "Ukuran foto terlalu besar"}).waitFor();
  assert.equal(await page.getByRole("button", {name: "Simpan dan ajukan verifikasi", exact: true}).isDisabled(), true);
  pass("photo consent is explained beside upload; oversized photos show precise local error and cannot be submitted");
  photoSaveFails = "STORAGE_PERMISSION_DENIED";
  await page.locator("input[type=file]").setInputFiles({name: "retry.png", mimeType: "image/png", buffer: Buffer.from(sample.split(",")[1], "base64")});
  await page.getByRole("alert").filter({hasText: "Server tidak memiliki izin"}).waitFor();
  assert.match(await page.getByRole("alert").textContent(), /Referensi: c34ab082-2514-4525-889d-028f44eaa251/);
  await page.locator(".sa-photo-preview").waitFor();
  assert.equal(await page.getByRole("button", {name: "Simpan dan ajukan verifikasi", exact: true}).isDisabled(), true);
  photoSaveFails = false;
  pass("storage failure retains local preview, explains that the photo is unsaved, blocks submission and permits retry");
  await page.locator("input[type=file]").setInputFiles({
    name: "test.png",
    mimeType: "image/png",
    buffer: Buffer.from(sample.split(",")[1], "base64"),
  });
  await page.getByText("Foto tersimpan. Ajukan verifikasi untuk melanjutkan.").waitFor();
  await page
    .getByRole("button", { name: "Simpan dan ajukan verifikasi", exact: true })
    .click();
  await page.getByText("Pengajuan terkirim.", { exact: false }).waitFor();
  pass(
    "photo attachment stores and submits enrollment for an independent staff record",
  );
  await page
    .getByRole("button", { name: "Ambil foto", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Aktifkan kamera", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ambil foto", exact: true })
    .last()
    .click();
  await page.getByText("Foto tersimpan. Ajukan verifikasi untuk melanjutkan.").waitFor();
  pass("staff camera source captures and stores a photo");
  await page
    .getByRole("button", { name: "Buat tautan pendaftaran", exact: true })
    .click();
  const link = await page
    .getByLabel("Tautan pendaftaran", { exact: true })
    .inputValue();
  assert.match(link, /#registry:[a-f0-9]{64}$/);
  const self = await context.newPage();
  self.on("pageerror", (e) => errors.push(e.message));
  await self.goto(link);
  await self.getByText("Station Staff", { exact: true }).waitFor();
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
  await self.close();
  pass("guided self enrollment works for staff without a portal login");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: output + "/seamless-v3-staff-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  pass("registration and photo controls fit a 390px viewport");
  connected = true;
  await page
    .getByRole("button", { name: "Operasional & Layar Lounge", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Periksa koneksi", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Pengaturan layar lounge" })
    .waitFor();
  await page
    .getByRole("button", { name: "Registrasi Petugas", exact: true })
    .click();
  await page
    .getByLabel("Petugas terdaftar")
    .selectOption({ label: "Station Staff · GA999 · CGK" });
  await page.getByRole("checkbox").nth(0).check();
  await page
    .getByRole("button", { name: "Setujui dan aktifkan", exact: true })
    .click();
  await page.getByText("Pendaftaran wajah aktif. Siapkan sesi verifikasi untuk mencoba pencocokan wajah.").waitFor();
  await page
    .getByRole("button", { name: "Operasional & Layar Lounge", exact: true })
    .click();
  await page.locator("summary").click();
  await page.getByLabel("Nomor pegawai", { exact: true }).fill("GA999");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Siapkan sesi untuk layar", exact: true })
    .click();
  await page.getByText("Sesi identitas siap.", { exact: false }).waitFor();
  faceCount = 0;
  await page.getByRole("button", { name: "Buka layar lounge" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".sa-live-camera video")?.srcObject?.active ===
      true,
  );
  faceCount = 1;
  await page
    .getByRole("heading", { name: "Wajah sesuai referensi", exact: true })
    .waitFor({ timeout: 18000 });
  assert.equal(commands, 0);
  assert.equal(
    await page.getByRole("dialog").getByText("GA999", { exact: true }).count(),
    0,
  );
  pass(
    "prepared 1:1 identity is processed automatically on face presence; no display interaction and no gate command without liveness",
  );
  faceCount = 0;
  await page.waitForFunction(
    () => document.querySelector(".sa-display")?.dataset.phase === "idle",
    {},
    { timeout: 18000 },
  );
  await page.keyboard.press("Escape");
  pass("result clears and advertising returns automatically");
  await page.locator("#app-language").click();
  await page
    .getByRole("button", { name: "Staff Registration", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Staff registration and face enrollment" })
    .waitFor();
  await page.getByLabel("Staff account (optional)", { exact: true }).waitFor();
  pass(
    "ID/EN covers revised registration, account optionality and display controls",
  );
  await page.locator("#app-language").click();
  await page
    .getByRole("button", { name: "Aktivitas Akses", exact: true })
    .click();
  await page.getByLabel("Station aktivitas").selectOption("CGK");
  await page.getByLabel("Lounge aktivitas").selectOption("lounge-1");
  await page
    .getByRole("cell", { name: "Wajah sesuai referensi", exact: true })
    .waitFor();
  await page.getByLabel("Cari aktivitas").fill("not-found");
  await page.getByText("Belum ada aktivitas sesuai pilihan.").waitFor();
  pass(
    "activity loads only after explicit location selection, displays matching status and filters correctly",
  );
  assert.deepEqual(errors, []);
  pass("zero uncaught browser runtime errors");
  await writeFile(
    output + "/seamless-v3-browser-results.json",
    JSON.stringify(
      {
        passed: checks,
        errors,
        scope:
          "Actual React and operations/registry services; in-memory Auth/Firestore/Storage and face/gate behavior doubles. Real-model inference tested separately.",
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.log("PAGE ERRORS", errors);
  await writeFile(output + "/seamless-v3-debug.html", await page.content());
  await page.screenshot({
    path: output + "/seamless-v3-debug.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
  server.close();
}
