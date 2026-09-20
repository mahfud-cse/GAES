export type BoardingPassResult = {
  recognized: boolean;
  name: string;
  flight: string;
  route: string;
  cabin: string;
  seat: string;
  seq: string;
  ticket: string;
  julianDay: string;
  eligible: "Y" | "N";
  normalized: string;
};

function clean(raw: string) {
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

function eligibleFromTail(value: string): "Y" | "N" {
  const finalToken =
    value
      .split(/[\s|;,]+/)
      .filter(Boolean)
      .at(-1) || "";
  return /^YA*$/i.test(finalToken) ? "Y" : "N";
}

function passengerName(value: string) {
  const [surname, ...given] = value.trim().replace(/\s+/g, " ").split("/");
  return given.length ? `${given.join(" ")} ${surname}`.trim() : surname;
}

/** Parse IATA BCBP fixed fields independently from camera decoding. */
function parseIataBcbp(normalized: string): BoardingPassResult | null {
  const text = normalized.toUpperCase();
  if (!/^M\d/.test(text) || text.length < 58) return null;

  const legs = Number(text.slice(1, 2));
  const name = text.slice(2, 22).trim();
  const origin = text.slice(30, 33).trim();
  const destination = text.slice(33, 36).trim();
  const carrier = text.slice(36, 39).trim();
  const flightNumber = text.slice(39, 44).trim();
  const julianDay = text.slice(44, 47).trim();
  const cabin = text.slice(47, 48).trim();
  const seat = text.slice(48, 52).trim();
  const seq = text.slice(52, 57).trim();

  if (
    !Number.isInteger(legs) ||
    legs < 1 ||
    !/^[A-Z]{3}$/.test(origin) ||
    !/^[A-Z]{3}$/.test(destination) ||
    !/^[A-Z0-9]{2,3}$/.test(carrier) ||
    !/^\d{1,5}$/.test(flightNumber) ||
    !/^\d{3}$/.test(julianDay)
  )
    return null;

  const ticket = text.match(/2A(\d{13,14})/)?.[1] || "";
  return {
    recognized: true,
    name: passengerName(name),
    flight: `${carrier}${Number(flightNumber)}`,
    route: `${origin}–${destination}`,
    cabin,
    seat: seat.replace(/^0+/, ""),
    seq: String(Number(seq)),
    ticket,
    julianDay,
    eligible: eligibleFromTail(normalized),
    normalized,
  };
}

function parseLabelled(normalized: string): BoardingPassResult | null {
  const text = normalized.toUpperCase();
  const fields: Record<string, string> = {};
  text
    .split(/[|;,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const divider = item.search(/[:=]/);
      if (divider < 1) return;
      fields[item.slice(0, divider).toLowerCase().replace(/\s/g, "")] = item
        .slice(divider + 1)
        .trim();
    });
  const name = fields.name || fields.nama || fields.passenger || "";
  const flight = fields.flight || fields.penerbangan || "";
  const route = fields.route || fields.rute || "";
  const seq = fields.sequence || fields.seq || fields.urutan || "";
  if (!name || !flight || !route || !seq) return null;
  return {
    recognized: true,
    name,
    flight,
    route,
    cabin: fields.cabin || fields.kelas || "",
    seat: fields.seat || fields.kursi || "",
    seq,
    ticket: fields.ticket || fields.tiket || "",
    julianDay: fields.julianday || fields.dateofflight || "",
    eligible: eligibleFromTail(normalized),
    normalized,
  };
}

export function parseBoardingPass(raw: string): BoardingPassResult {
  const normalized = clean(raw);
  const parsed = parseIataBcbp(normalized) || parseLabelled(normalized);
  return (
    parsed || {
      recognized: false,
      name: "",
      flight: "",
      route: "",
      cabin: "",
      seat: "",
      seq: "",
      ticket: "",
      julianDay: "",
      eligible: eligibleFromTail(normalized),
      normalized,
    }
  );
}
