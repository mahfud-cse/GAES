import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the application metadata and sign-in source", async () => {
  const [layout, page] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /Garuda Access Entitlement System/i);
  assert.match(page, /garuda-indonesia-logo\.(?:png|svg)/i);
  assert.match(page, /sign[ -]?in/i);
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
