type Row = Record<string, unknown>;

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
  return {
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
  };
}

export function normalizeLoungeCapacity(row: Row) {
  const loungeId = text(row.loungeId ?? row["Lounge ID"]);
  const effectiveFrom = isoDate(
    row.effectiveFrom ?? row["Berlaku Mulai"],
  );
  const capacity = numberValue(row.capacity ?? row["Kapasitas Lounge"]);
  if (!loungeId || !effectiveFrom || capacity <= 0) return null;
  return {
    id:
      text(row.id) ||
      `capacity-${loungeId}-${effectiveFrom}`,
    loungeId,
    capacity: Math.floor(capacity),
    effectiveFrom,
    reason: text(row.reason ?? row["Alasan Perubahan"], "Update kapasitas"),
    updatedBy: text(row.updatedBy, "System"),
    updatedAt: text(row.updatedAt, ""),
  };
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
  return {
    code,
    name,
    timeZone: text(row.timeZone, "Asia/Jakarta"),
    utcLabel: text(row.utcLabel, "UTC+7"),
    status: text(row.status, "Aktif"),
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
