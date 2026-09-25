import assert from "node:assert/strict";
import test from "node:test";

import {
  deduplicateLounges,
  isSynchronizedRecord,
  isoDate,
  numberValue,
  normalizeFlight,
  normalizeLounge,
  normalizePassengerVolume,
  normalizeStation,
  normalizeVisitor,
  timeValue,
} from "../lib/data-normalization.ts";
import { parseBoardingPass } from "../lib/boarding-pass.ts";

test("normalizes spreadsheet dates, times, and Indonesian currency", () => {
  assert.equal(isoDate("20/09/2026"), "2026-09-20");
  assert.equal(isoDate(46301), "2026-10-06");
  assert.equal(isoDate("2026-99-99"), "");
  assert.equal(timeValue(0.5), "12:00");
  assert.equal(numberValue("Rp 1.250.000"), 1_250_000);
});

test("accepts a valid flight and rejects an incomplete row", () => {
  assert.deepEqual(
    normalizeFlight({
      Date: "2026-09-20",
      Flight: "GA 204",
      From: "cgk",
      To: "jog",
      STD: "08:30",
      ETD: "08:45",
      Capacity: "12C 150Y",
    }),
    {
      id: "flight-2026-09-20-GA204-CGK-JOG",
      date: "2026-09-20",
      flight: "GA204",
      origin: "CGK",
      destination: "JOG",
      std: "08:30",
      etd: "08:45",
      capacity: "12C 150Y",
      status: "Scheduled",
      updatedBy: "System",
      updatedAt: "—",
    },
  );
  assert.equal(normalizeFlight({ Date: "", Flight: "GA204" }), null);
});

test("normalizes flight-level passenger volume with First, Business, and Economy", () => {
  const row = normalizePassengerVolume({
    Date: "2026-09-24",
    Flight: "GA 204",
    From: "cgk",
    To: "jog",
    "Flight Status": "departed",
    capacityF: 8,
    capacityC: 26,
    capacityY: 267,
    passengerF: 0,
    passengerC: 18,
    passengerY: 201,
  });
  assert.equal(row?.id, "pax-2026-09-24-ga204-cgk-jog");
  assert.equal(row?.status, "DEPARTED");
  assert.equal(row?.totalPassengers, 219);
  assert.equal(normalizePassengerVolume({ Date: "", Flight: "GA204" }), null);
});

test("skips corrupt visitor documents instead of exposing them to the page", () => {
  assert.equal(
    normalizeVisitor({ id: "bad", name: "A", flight: "GA204" }),
    null,
  );
  assert.equal(
    normalizeVisitor({
      id: "ok",
      name: "Passenger",
      flight: "GA204",
      travelDate: "2026-09-20",
      airport: "CGK",
    })?.airport,
    "CGK",
  );
});

test("parses arbitrary IATA BCBP and labelled QR payloads", () => {
  const labelled = parseBoardingPass(
    "name=DOE/JOHN;flight=GA204;route=CGK-JOG;seq=001;cabin=Y;Y",
  );
  assert.equal(labelled.recognized, true);
  assert.equal(labelled.flight, "GA204");
  assert.equal(labelled.eligible, "Y");

  const unknown = parseBoardingPass("ANOTHER-UNSUPPORTED-CODE");
  assert.equal(unknown.recognized, false);
});

test("recognizes legacy synchronized lounge metadata and deduplicates its card", () => {
  const legacy = normalizeLounge({
    id: "legacy-lounge",
    airport: "CGK",
    name: "Blue Sky Lounge",
    type: "Lounge",
    sourceProject: "ground-experience-portal",
    sourceStatus: "SOURCE_NOT_FOUND",
  });
  const synced = normalizeLounge({
    id: "sync-lounge-current",
    airport: "CGK",
    name: "Blue Sky Lounge",
    type: "Lounge",
    dataOrigin: "SYNC",
    readOnly: true,
    sourceRecordId: "1001",
    pricePeriods: [
      {
        id: "period-1",
        start: "2026-01-01",
        end: "2026-12-31",
        currency: "IDR",
        price: 120000,
      },
    ],
  });

  assert.equal(legacy?.dataOrigin, "SYNC");
  assert.equal(legacy?.readOnly, true);
  const result = deduplicateLounges([legacy, synced].filter(Boolean));
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "sync-lounge-current");
  assert.equal(result[0].dataOrigin, "SYNC");
  assert.equal(result[0].pricePeriods.length, 1);
});

test("keeps every synchronized station read-only, including legacy metadata", () => {
  for (const metadata of [
    { dataOrigin: "SYNC" },
    { readOnly: true },
    { sourceProject: "ground-experience-portal" },
    { sourceRecordId: "airport-cgk" },
    { sourcePath: "portalData/airports/records/airport-cgk" },
    { sourceStatus: "SOURCE_NOT_FOUND" },
  ]) {
    const station = normalizeStation({
      code: "CGK",
      name: "Soekarno-Hatta",
      ...metadata,
    });
    assert.equal(station?.dataOrigin, "SYNC");
    assert.equal(station?.readOnly, true);
    assert.equal(isSynchronizedRecord(station), true);
  }

  const manual = normalizeStation({ code: "DPS", name: "I Gusti Ngurah Rai" });
  assert.equal(manual?.dataOrigin, "MANUAL");
  assert.equal(manual?.readOnly, false);
  assert.equal(isSynchronizedRecord(manual), false);
});
