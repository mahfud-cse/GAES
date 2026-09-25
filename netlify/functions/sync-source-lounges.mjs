import { createHash } from "node:crypto";
import {
  failure,
  json,
  requireUser,
  sourceDb,
  targetDb,
} from "./_firebase-admin.mjs";

const SOURCE_PROJECT = "ground-experience-portal";
const text = (value, fallback = "") => String(value ?? fallback).trim();
const upper = (value, fallback = "") => text(value, fallback).toUpperCase();
const number = (value) => {
  const parsed = Number(String(value ?? 0).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const isoDate = (value) => {
  const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
};
const normalizedKey = (value) =>
  text(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const stableId = (prefix, value) =>
  `${prefix}-${createHash("sha1").update(value).digest("hex").slice(0, 20)}`;

function activeSourceRecord(row) {
  const status = upper(row.documentStatus || row.status || "VALID");
  return ["VALID", "ACTIVE", "AKTIF"].includes(status);
}

function stationTime(code, row) {
  const supplied = text(
    row.timeZone || row.timezone || row.ianaTimeZone || row.time_zone,
  );
  if (supplied) return supplied;
  if (["AMQ", "BIK", "DJJ", "MKW", "SOQ", "TIM"].includes(code))
    return "Asia/Jayapura";
  if (["BPN", "DPS", "KOE", "LOP", "MDC", "UPG"].includes(code))
    return "Asia/Makassar";
  return "Asia/Jakarta";
}

function utcLabel(timeZone, row) {
  const supplied = text(row.utcLabel || row.utc || row.UTC);
  if (supplied) return supplied;
  if (timeZone === "Asia/Jayapura") return "UTC+9";
  if (timeZone === "Asia/Makassar") return "UTC+8";
  return "UTC+7";
}

async function firstAvailableCollection(db, configuredPath, defaults) {
  const paths = configuredPath ? [configuredPath] : defaults;
  for (const path of paths) {
    const snapshot = await db.collection(path.replace(/^\/+|\/+$/g, "")).get();
    if (!snapshot.empty) return { path, snapshot };
  }
  return { path: paths[0], snapshot: null };
}

export default async (request) => {
  try {
    if (request.method !== "POST")
      return json(405, { error: "Method not allowed." });

    const actor = await requireUser(request, ["Super Admin", "Admin"]);
    const source = sourceDb();
    const db = targetDb();
    const now = new Date();
    const syncedAt = now.toISOString();
    const today = syncedAt.slice(0, 10);
    const writer = db.bulkWriter();

    const loungeSource = await firstAvailableCollection(
      source,
      process.env.SOURCE_FIREBASE_LOUNGES_PATH,
      ["portalData/lounges/records"],
    );
    const stationSource = await firstAvailableCollection(
      source,
      process.env.SOURCE_FIREBASE_STATIONS_PATH,
      [
        "portalData/airports/records",
        "portalData/stations/records",
        "portalData/network-stations/records",
      ],
    );

    const existingLoungesSnapshot = await db
      .collection("lounges")
      .where("sourceProject", "==", SOURCE_PROJECT)
      .get();
    const existingLounges = new Map(
      existingLoungesSnapshot.docs.map((item) => [item.id, item.data()]),
    );
    const activeLoungeIds = new Set();
    const groupedLounges = new Map();
    let loungesSkipped = 0;

    for (const item of loungeSource.snapshot?.docs || []) {
      const row = item.data();
      const airport = upper(row.airport || row.station || row.stationCode);
      const name = text(row.name || row.loungeName || row.providerName);
      const type = text(
        row.serviceType || row.serviceCategory || row.type,
        "Lounge",
      );
      if (!/^[A-Z]{3}$/.test(airport) || !name) {
        loungesSkipped += 1;
        continue;
      }
      const identityKey = `${airport}|${normalizedKey(name)}|${normalizedKey(type)}`;
      const rows = groupedLounges.get(identityKey) || [];
      rows.push({ item, row, airport, name, type });
      groupedLounges.set(identityKey, rows);
    }

    for (const [identityKey, rows] of groupedLounges) {
      const id = stableId("sync-lounge", identityKey);
      activeLoungeIds.add(id);
      const previous = existingLounges.get(id) || {};
      const sourceRecordIds = new Set(rows.map(({ item }) => item.id));
      const currentPeriods = rows.map(({ item, row }) => {
        const valid = activeSourceRecord(row);
        return {
          id: `source-${item.id}`,
          agreementId: text(
            row.documentKey || row.documentNumber || row.agreementId,
            item.id,
          ),
          agreementType: text(
            row.documentType || row.agreementType,
            "Perjanjian",
          ),
          documentNumber: text(row.documentNumber || row.agreementNumber),
          currency: upper(row.currency, "IDR"),
          price: number(row.pricePerPax ?? row.price),
          start: isoDate(row.startDate || row.start),
          end: isoDate(row.endDate || row.end),
          status: valid ? "Aktif" : "Nonaktif",
          sourceRecordId: item.id,
          sourceStatus: "ACTIVE",
        };
      });
      const missingPeriods = Array.isArray(previous.pricePeriods)
        ? previous.pricePeriods
            .filter(
              (period) =>
                period.sourceRecordId &&
                !sourceRecordIds.has(period.sourceRecordId),
            )
            .map((period) => ({
              ...period,
              status: "Nonaktif",
              sourceStatus: "SOURCE_NOT_FOUND",
            }))
        : [];
      const pricePeriods = [...currentPeriods, ...missingPeriods].sort((a, b) =>
        String(a.start).localeCompare(String(b.start)),
      );
      const applicable = pricePeriods
        .filter(
          (period) =>
            period.status === "Aktif" &&
            period.start &&
            period.end &&
            period.start <= today &&
            period.end >= today,
        )
        .sort((a, b) => b.start.localeCompare(a.start))[0];
      const latest = pricePeriods
        .filter((period) => period.status === "Aktif")
        .sort((a, b) => b.start.localeCompare(a.start))[0];
      const selected = applicable || latest || pricePeriods.at(-1);
      const newestRow = [...rows].sort((a, b) =>
        isoDate(b.row.startDate || b.row.start).localeCompare(
          isoDate(a.row.startDate || a.row.start),
        ),
      )[0];
      const active = rows.some(({ row }) => activeSourceRecord(row));

      writer.set(
        db.collection("lounges").doc(id),
        {
          id,
          airport: newestRow.airport,
          name: newestRow.name,
          type: newestRow.type,
          currency: selected?.currency || "IDR",
          price: selected?.price || 0,
          start:
            pricePeriods
              .map((period) => period.start)
              .filter(Boolean)
              .sort()[0] || "",
          end:
            pricePeriods
              .map((period) => period.end)
              .filter(Boolean)
              .sort()
              .at(-1) || "",
          status: active ? "Aktif" : "Nonaktif",
          region: text(newestRow.row.region),
          pic: text(newestRow.row.pic),
          capacity: number(newestRow.row.capacity || previous.capacity || 0),
          capacityEffectiveFrom: isoDate(
            newestRow.row.capacityEffectiveFrom ||
              previous.capacityEffectiveFrom,
          ),
          capacityHistory: previous.capacityHistory || [],
          pricePeriods,
          dataOrigin: "SYNC",
          readOnly: true,
          sourceProject: SOURCE_PROJECT,
          sourceRecordId: newestRow.item.id,
          sourceRecordIds: [...sourceRecordIds],
          sourceIdentityKey: identityKey,
          sourcePath: loungeSource.path,
          sourceStatus: "ACTIVE",
          lastSyncedAt: syncedAt,
          syncedBy: actor.decoded.uid,
        },
        { merge: true },
      );
    }

    if (loungeSource.snapshot) {
      for (const item of existingLoungesSnapshot.docs) {
        if (activeLoungeIds.has(item.id)) continue;
        writer.set(
          item.ref,
          {
            status: "Nonaktif",
            readOnly: true,
            sourceStatus: "SOURCE_NOT_FOUND",
            lastSyncedAt: syncedAt,
            syncedBy: actor.decoded.uid,
          },
          { merge: true },
        );
      }
    }

    let stationsImported = 0;
    let stationsSkipped = 0;
    let stationsDeactivated = 0;
    if (stationSource.snapshot) {
      const existingStationsSnapshot = await db
        .collection("stations")
        .where("sourceProject", "==", SOURCE_PROJECT)
        .get();
      const activeStationCodes = new Set();

      for (const item of stationSource.snapshot.docs) {
        const row = item.data();
        const code = upper(
          row.code ||
            row.id ||
            row.airport ||
            row.station ||
            row.iata ||
            row.iataCode,
        );
        const name = text(
          row.name || row.stationName || row.airportName || row.city,
        );
        if (!/^[A-Z]{3}$/.test(code) || !name) {
          stationsSkipped += 1;
          continue;
        }
        const timeZone = stationTime(code, row);
        activeStationCodes.add(code);
        writer.set(
          db.collection("stations").doc(code),
          {
            code,
            name,
            timeZone,
            utcLabel: utcLabel(timeZone, row),
            status: activeSourceRecord(row) ? "Aktif" : "Nonaktif",
            dataOrigin: "SYNC",
            readOnly: true,
            sourceProject: SOURCE_PROJECT,
            sourceRecordId: item.id,
            sourcePath: `${stationSource.path}/${item.id}`,
            sourceStatus: "ACTIVE",
            lastSyncedAt: syncedAt,
            syncedBy: actor.decoded.uid,
          },
          { merge: true },
        );
        stationsImported += 1;
      }

      for (const item of existingStationsSnapshot.docs) {
        if (activeStationCodes.has(item.id)) continue;
        writer.set(
          item.ref,
          {
            status: "Nonaktif",
            readOnly: true,
            sourceStatus: "SOURCE_NOT_FOUND",
            lastSyncedAt: syncedAt,
            syncedBy: actor.decoded.uid,
          },
          { merge: true },
        );
        stationsDeactivated += 1;
      }
    }

    await writer.close();
    const result = {
      imported: groupedLounges.size,
      skipped: loungesSkipped,
      deactivated: loungeSource.snapshot
        ? [...existingLounges.keys()].filter((id) => !activeLoungeIds.has(id))
            .length
        : 0,
      stationsImported,
      stationsSkipped,
      stationsDeactivated,
      loungeSourcePath: loungeSource.snapshot ? loungeSource.path : "",
      stationSourcePath: stationSource.snapshot ? stationSource.path : "",
    };
    await db.collection("integrationRuns").add({
      integration: "source-lounges-and-stations",
      ...result,
      status: "SUCCESS",
      createdAt: now,
      actorId: actor.decoded.uid,
    });
    return json(200, result);
  } catch (error) {
    return failure(error);
  }
};
