type Row = Record<string, unknown>;

/**
 * Treat every record carrying source-system metadata as synchronized. This is
 * intentionally broader than checking `readOnly` alone so a partial/legacy
 * sync record can never become editable in the UI.
 */
export function isSynchronizedRecord(row: Row | null | undefined) {
  if (!row) return false;
  return (
    upper(row.dataOrigin) === "SYNC" ||
    row.readOnly === true ||
    Boolean(
      text(row.sourceProject) ||
        text(row.sourceRecordId) ||
        text(row.sourcePath) ||
        text(row.sourceIdentityKey) ||
        text(row.sourceStatus),
    )
  );
}

export const text = (value: unknown, fallback = "") =>
  value == null ? fallback : String(value).trim();

export const upper = (value: unknown, fallback = "") =>
  text(value, fallback).toUpperCase();

export const numberValue = (value: unknown, fallback = 0) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value).replace(/[^0-9,.-]/g, "");
  const normalized =
    raw.includes(",") && raw.includes(".")
      ? raw.replace(/\./g, "").replace(",", ".")
      : /^-?\d{1,3}(\.\d{3})+$/.test(raw)
        ? raw.replace(/\./g, "")
        : raw.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function isoDate(value: unknown, fallback = "") {
  if (!value) return fallback;
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  if (
    typeof value === "object" &&
    value &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return isoDate((value as { toDate: () => Date }).toDate(), fallback);
  }
  if (typeof value === "number" && value > 0) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + Math.round(value) * 86400000)
      .toISOString()
      .slice(0, 10);
  }
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw))
    return validIsoDate(raw) ? raw : fallback;
  const local = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (local) {
    const result = `${local[3]}-${local[2]}-${local[1]}`;
    const date = new Date(`${result}T00:00:00Z`);
    return Number.isNaN(date.getTime()) || !validIsoDate(result)
      ? fallback
      : result;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? fallback
    : parsed.toISOString().slice(0, 10);
}

export function timeValue(value: unknown, fallback = "") {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  }
  if (typeof value === "number" && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const match = text(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return fallback;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

export function normalizeFlight(row: Row) {
  const date = isoDate(row.date ?? row.Date);
  const flight = upper(row.flight ?? row.Flight).replace(/\s/g, "");
  const origin = upper(row.origin ?? row.From);
  const destination = upper(row.destination ?? row.To);
  const std = timeValue(row.std ?? row.STD);
  if (
    !date ||
    !/^[A-Z0-9]{2,3}\d{1,5}$/.test(flight) ||
    !/^[A-Z]{3}$/.test(origin) ||
    !/^[A-Z]{3}$/.test(destination) ||
    !std
  )
    return null;
  const rawStatus = upper(row.status ?? row["Flight Status"] ?? "SCHEDULED");
  const allowed = [
    "SCHEDULED",
    "DELAYED",
    "RESCHEDULED",
    "POSTPONED",
    "CANCELLED",
  ];
  const status = allowed.includes(rawStatus)
    ? `${rawStatus[0]}${rawStatus.slice(1).toLowerCase()}`
    : "Scheduled";
  return {
    id: text(row.id) || `flight-${date}-${flight}-${origin}-${destination}`,
    date,
    flight,
    origin,
    destination,
    std,
    etd: timeValue(row.etd ?? row.ETD, std),
    capacity: text(row.capacity ?? row.Capacity),
    status,
    updatedBy: text(row.updatedBy, "System"),
    updatedAt: text(row.updatedAt, "—"),
  };
}

export function normalizeLounge(row: Row) {
  const airport = upper(row.airport ?? row.Airport);
  const name = text(row.name ?? row["Nama Lounge/Tenant"]);
  if (!/^[A-Z]{3}$/.test(airport) || !name) return null;
  const synchronized = isSynchronizedRecord(row);
  return {
    ...row,
    id:
      text(row.id) ||
      `lounge-${airport}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    airport,
    name,
    type: text(row.type ?? row.Tipe, "Lounge"),
    currency: upper(row.currency ?? row.Currency, "IDR"),
    price: numberValue(row.price ?? row["Harga per Pax"]),
    start: isoDate(row.start ?? row["Tanggal Mulai"]),
    end: isoDate(row.end ?? row["Tanggal Berakhir"]),
    status: text(row.status ?? row.Status, "Aktif"),
    dataOrigin: synchronized ? "SYNC" : "MANUAL",
    readOnly: synchronized,
    sourceProject: text(row.sourceProject),
    sourceRecordId: text(row.sourceRecordId),
    sourcePath: text(row.sourcePath),
    sourceIdentityKey: text(row.sourceIdentityKey),
    sourceStatus: text(row.sourceStatus),
    lastSyncedAt: text(row.lastSyncedAt),
    capacity: numberValue(row.capacity ?? row.Capacity),
    capacityEffectiveFrom: isoDate(row.capacityEffectiveFrom),
    capacityHistory: Array.isArray(row.capacityHistory)
      ? row.capacityHistory
      : [],
    pricePeriods: Array.isArray(row.pricePeriods)
      ? row.pricePeriods
          .map((period) => {
            const item = period as Record<string, unknown>;
            return {
              id: text(item.id) || crypto.randomUUID(),
              currency: upper(
                item.currency,
                upper(row.currency ?? row.Currency, "IDR"),
              ),
              price: numberValue(item.price),
              start: isoDate(item.start),
              end: isoDate(item.end),
              agreementId: text(item.agreementId),
              agreementType: text(item.agreementType),
              documentNumber: text(item.documentNumber),
              status: text(item.status, "Aktif"),
              sourceRecordId: text(item.sourceRecordId),
              sourceStatus: text(item.sourceStatus, "ACTIVE"),
            };
          })
          .filter((period) => period.start && period.end)
      : [],
  };
}

const loungeIdentity = (row: NonNullable<ReturnType<typeof normalizeLounge>>) =>
  `${row.airport}|${text(row.name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}|${text(row.type, "Lounge")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

/**
 * Prevents the same business lounge from appearing twice when a legacy/manual
 * row and its synchronized replacement are briefly present together. The
 * synchronized row wins, while unique historical price periods are retained.
 */
export function deduplicateLounges(
  rows: Array<NonNullable<ReturnType<typeof normalizeLounge>>>,
) {
  const grouped = new Map<
    string,
    NonNullable<ReturnType<typeof normalizeLounge>>
  >();

  for (const row of rows) {
    const key = loungeIdentity(row);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, row);
      continue;
    }

    const rowIsSync = row.dataOrigin === "SYNC" || row.readOnly === true;
    const currentIsSync =
      current.dataOrigin === "SYNC" || current.readOnly === true;
    const priority = (item: NonNullable<ReturnType<typeof normalizeLounge>>) =>
      (item.dataOrigin === "SYNC" || item.readOnly === true ? 10 : 0) +
      (text(item.sourceStatus) !== "SOURCE_NOT_FOUND" ? 4 : 0) +
      (text(item.id).startsWith("sync-lounge-") ? 2 : 0) +
      (item.pricePeriods?.length ? 1 : 0);
    const preferred = priority(row) > priority(current) ? row : current;
    const secondary = preferred === row ? current : row;
    const periods = new Map<string, (typeof row.pricePeriods)[number]>();

    for (const period of [
      ...(secondary.pricePeriods || []),
      ...(preferred.pricePeriods || []),
    ]) {
      const periodKey =
        text(period.sourceRecordId) ||
        text(period.id) ||
        `${period.start}|${period.end}|${period.currency}|${period.price}`;
      periods.set(periodKey, period);
    }

    grouped.set(key, {
      ...secondary,
      ...preferred,
      dataOrigin: rowIsSync || currentIsSync ? "SYNC" : "MANUAL",
      readOnly: rowIsSync || currentIsSync,
      pricePeriods: [...periods.values()].sort((a, b) =>
        a.start.localeCompare(b.start),
      ),
    });
  }

  return [...grouped.values()];
}

export function normalizeVisitor(row: Row) {
  const id = text(row.id);
  const name = text(row.name);
  const flight = upper(row.flight).replace(/\s/g, "");
  const travelDate = isoDate(row.travelDate, isoDate(row.date));
  const airport = upper(row.airport);
  if (!id || !name || !flight || !travelDate || !/^[A-Z]{3}$/.test(airport))
    return null;
  return {
    ...row,
    id,
    name,
    flight,
    date: isoDate(row.date, travelDate),
    travelDate,
    time: timeValue(row.time, "00:00"),
    airport,
    lounge: text(row.lounge),
    route: text(row.route),
    cabin: upper(row.cabin),
    seat: text(row.seat),
    seq: text(row.seq),
    ticket: text(row.ticket),
    category: text(row.category, "Lainnya"),
    reference: text(row.reference),
    currency: upper(row.currency, "IDR"),
    price: numberValue(row.price),
    boStatus: text(row.boStatus, "Pending"),
    vendorStatus: text(row.vendorStatus, "Pending"),
  };
}

export function normalizeStation(row: Row) {
  const code = upper(row.code ?? row.id);
  const name = text(row.name);
  if (!/^[A-Z]{3}$/.test(code) || !name) return null;
  const synchronized = isSynchronizedRecord(row);
  return {
    ...row,
    code,
    name,
    timeZone: text(row.timeZone, "Asia/Jakarta"),
    utcLabel: text(row.utcLabel, "UTC+7"),
    status: text(row.status, "Aktif"),
    dataOrigin: synchronized ? "SYNC" : "MANUAL",
    readOnly: synchronized,
  };
}

export function normalizeAirline(row: Row) {
  const code = upper(row.code ?? row.id);
  const name = text(row.name);
  if (!/^[A-Z0-9]{2}$/.test(code) || !name) return null;
  return {
    code,
    name,
    verifierOrganization: text(row.verifierOrganization, name),
    status: text(row.status, "Active"),
  };
}

export function normalizeAccount(row: Row) {
  const id = text(row.id);
  const username = text(row.username).toLowerCase();
  if (!id || !username) return null;
  return {
    ...row,
    id,
    username,
    name: text(row.name, username),
    email: text(row.email),
    password: "",
    role: text(row.role, "Report Viewer"),
    station: upper(row.station, "ALL"),
    scope: text(row.scope, "Configured authority"),
    organization: text(row.organization),
    verificationScopes: Array.isArray(row.verificationScopes)
      ? row.verificationScopes.map(String)
      : [],
    status: row.active === false ? "Nonaktif" : text(row.status, "Aktif"),
  };
}

export function normalizeEntitlement(row: Row) {
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name) return null;
  return {
    ...row,
    id,
    name,
    type: text(row.type, "Partnership"),
    reference: text(row.reference),
    status: text(row.status, "Aktif"),
    allowedRoles: Array.isArray(row.allowedRoles)
      ? row.allowedRoles.map(String)
      : [],
    verifierOrganization: text(row.verifierOrganization),
    eligibleTiers: text(row.eligibleTiers),
    effectiveStart: isoDate(row.effectiveStart),
    effectiveEnd: isoDate(row.effectiveEnd),
    stationScope: text(row.stationScope, "ALL"),
    payer: text(row.payer),
    priceRule: text(row.priceRule),
    companionRule: text(row.companionRule),
    apiReferenceFields: text(row.apiReferenceFields),
    version: numberValue(row.version, 1),
  };
}

export function normalizeMonitoring(row: Row) {
  const id = text(row.id);
  const period = text(row.period);
  const bo = upper(row.bo);
  if (!id || !/^\d{4}-\d{2}$/.test(period) || !bo) return null;
  return {
    ...row,
    id,
    period,
    bo,
    station: upper(row.station, bo),
    area: text(row.area, "Unassigned Area"),
    provider: text(row.provider, "Unassigned Provider"),
    businessPax: numberValue(row.businessPax),
    economyPax: numberValue(row.economyPax),
    businessLounge: numberValue(row.businessLounge),
    platinum: numberValue(row.platinum),
    elitePlus: numberValue(row.elitePlus),
    skyteam: numberValue(row.skyteam),
    partnership: numberValue(row.partnership),
    dpr: numberValue(row.dpr),
    paidAccess: numberValue(row.paidAccess),
    other: numberValue(row.other),
    unitPrice: numberValue(row.unitPrice),
    source: text(row.source, "Manual"),
  };
}

export function normalizePassengerVolume(row: Row) {
  const flightDate = isoDate(row.flightDate ?? row.Date ?? row.date);
  const flight = upper(row.flight ?? row.Flight).replace(/\s/g, "");
  const station = upper(row.station ?? row.origin ?? row.From);
  const destination = upper(row.destination ?? row.To);
  if (
    !flightDate ||
    !/^[A-Z0-9]{2,3}\d{1,5}$/.test(flight) ||
    !/^[A-Z]{3}$/.test(station) ||
    !/^[A-Z]{3}$/.test(destination)
  )
    return null;
  const status = upper(row.status ?? row["Flight Status"], "UNKNOWN");
  const passengerF = Math.max(0, numberValue(row.passengerF ?? row["F Class"]));
  const passengerC = Math.max(0, numberValue(row.passengerC ?? row["C Class"]));
  const passengerY = Math.max(0, numberValue(row.passengerY ?? row["Y Class"]));
  return {
    ...row,
    id:
      text(row.id) ||
      `pax-${flightDate}-${flight}-${station}-${destination}`.toLowerCase(),
    flightDate,
    period: flightDate.slice(0, 7),
    flight,
    station,
    origin: station,
    destination,
    time: text(row.time ?? row.Time),
    gate: text(row.gate ?? row.Gate),
    location: text(row.location ?? row.Location),
    status,
    aircraft: upper(row.aircraft ?? row.Aircraft),
    capacityF: Math.max(0, numberValue(row.capacityF)),
    capacityC: Math.max(0, numberValue(row.capacityC)),
    capacityY: Math.max(0, numberValue(row.capacityY)),
    passengerF,
    passengerC,
    passengerY,
    totalPassengers: passengerF + passengerC + passengerY,
    source: text(row.source, "BO Import"),
    sourceFile: text(row.sourceFile),
    uploadedBy: text(row.uploadedBy, "System"),
    uploadedAt: text(row.uploadedAt, "—"),
  };
}
