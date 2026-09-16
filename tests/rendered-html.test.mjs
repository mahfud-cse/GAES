import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("renders the application sign-in page", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<title>Garuda Access Entitlement System<\/title>/i);
  assert.match(html, /Garuda Access Entitlement System/i);
  assert.match(html, /garuda-wing\.svg/i);
  assert.doesNotMatch(html, /akun pengujian|data lokal|prototype/i);
});

test("keeps dashboard drill-down and operational controls", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /Portal Management/);
  assert.match(source, /Dashboard Manager/);
  assert.match(source, /Top 10 BO by Lounge Visitors/);
  assert.match(source, /Import Passenger Volume/);
  assert.match(source, /Translation Manager/);
  assert.match(source, /DonutChart/);
  assert.match(source, /Average Cost \/ Visitor/);
  assert.match(source, /dashboard-detail/);
  assert.match(source, /Lounge Visitor Trend/);
  assert.match(source, /Penumpang sudah ditambahkan sebagai pengguna layanan lounge/);
  assert.match(source, /Import Passenger List/);
  assert.match(source, /Total hanya menghitung visitor Accepted sesuai filter aktif/);
  assert.match(source, /flightTab === "Irregularity"/);
  assert.doesNotMatch(source, /flightTab === "Irregularity \/ Exception"/);
});
