import {
  demoIdentity,
  demoPassenger,
  simulateGate,
  liveAdapters,
  withDeadline,
} from "./adapters.mjs";
export const OPERATOR_ROLES = [
  "Super Admin",
  "Admin",
  "BO Admin",
  "Lounge Officer",
  "Lounge Manager",
];
export const ADMIN_ROLES = ["Super Admin", "Admin"];
export const STAFF_ROLES = ["BO Admin", "Lounge Officer", "Lounge Manager"];
export function accessError(status, message) {
  return Object.assign(new Error(message), { status });
}
export function requirePermission(actor, admin = false) {
  if (
    !actor?.decoded?.uid ||
    actor.profile?.active !== true ||
    !(admin ? ADMIN_ROLES : OPERATOR_ROLES).includes(actor.profile.role) ||
    actor.profile.mustChangePassword === true
  )
    throw accessError(403, "Akses Seamless tidak diizinkan untuk akun ini.");
}
export function assertLocation(actor, lounge) {
  if (
    !lounge ||
    lounge.status !== "Aktif" ||
    lounge.sourceStatus === "SOURCE_NOT_FOUND"
  )
    throw accessError(409, "Lounge aktif tidak tersedia.");
  if (
    !ADMIN_ROLES.includes(actor.profile.role) &&
    actor.profile.station !== lounge.airport
  )
    throw accessError(403, "Lokasi di luar station akun.");
  if (
    ["Lounge Officer", "Lounge Manager"].includes(actor.profile.role) &&
    (!actor.profile.loungeId || actor.profile.loungeId !== lounge.id)
  )
    throw accessError(403, "Lokasi di luar penugasan lounge.");
}
export async function evaluateVerification({
  mode,
  fixture,
  location,
  staff,
  identityAdapter,
  passengerAdapter,
}) {
  const result = {
    mode,
    category: fixture?.category || "Unknown",
    maskedIdentifier: fixture
      ? `DEMO-***${fixture.id.slice(-4).toUpperCase()}`
      : "—",
    identity: "UNCHECKED",
    authorization: "UNCHECKED",
    decision: "NOT_ELIGIBLE",
    reason: "",
    states: ["IDLE"],
  };
  const reject = (reason) => ({
    ...result,
    reason,
    states: [...result.states, "NOT_ELIGIBLE"],
  });
  if (mode === "LIVE" && !liveAdapters.configured)
    return reject("LIVE_NOT_CONFIGURED");
  if (mode !== "DEMO" || !fixture) return reject("INVALID_SCENARIO");
  result.states.push("CAPTURED");
  let identity;
  try {
    identity = await withDeadline((signal) =>
      identityAdapter
        ? identityAdapter(fixture, { signal })
        : demoIdentity(fixture),
    );
  } catch {
    return reject("VERIFICATION_SERVICE_UNAVAILABLE");
  }
  if (identity?.available !== true)
    return reject("VERIFICATION_SERVICE_UNAVAILABLE");
  if (
    identity.captured !== true ||
    typeof identity.matched !== "boolean" ||
    !["Passenger", "Staff"].includes(identity.category)
  )
    return reject("INVALID_PROVIDER_RESPONSE");
  if (!identity.matched) {
    result.identity = "IDENTITY_NOT_FOUND";
    result.states.push("IDENTITY_NOT_FOUND");
    return reject("FACE_NOT_RECOGNIZED");
  }
  if (
    !identity.referenceId ||
    identity.referenceId !== fixture.id ||
    identity.category !== fixture.category
  )
    return reject("INVALID_PROVIDER_RESPONSE");
  result.identity = "IDENTITY_MATCHED";
  result.states.push("IDENTITY_MATCHED");
  if (fixture.category === "Passenger") {
    let passenger;
    try {
      passenger = await withDeadline((signal) =>
        passengerAdapter
          ? passengerAdapter(fixture, location, { signal })
          : demoPassenger(fixture, location),
      );
    } catch {
      return reject("PASSENGER_SERVICE_UNAVAILABLE");
    }
    if (passenger?.available !== true)
      return reject("PASSENGER_SERVICE_UNAVAILABLE");
    if (!passenger.record) return reject("PASSENGER_RECORD_UNAVAILABLE");
    const e = passenger.entitlement;
    if (
      passenger.record.referenceId !== fixture.id ||
      !e ||
      !["ELIGIBLE", "NOT_ELIGIBLE"].includes(e.decision) ||
      !Number.isFinite(e.validUntil)
    )
      return reject("INVALID_PROVIDER_RESPONSE");
    result.states.push("ENTITLEMENT_CHECKED");
    result.authorization = "NOT_ELIGIBLE";
    if (
      e.decision !== "ELIGIBLE" ||
      e.validUntil <= Date.now() ||
      e.station !== location.station ||
      e.loungeId !== location.loungeId ||
      e.policy !== "DEMO_ONLY"
    )
      return reject("ENTITLEMENT_INVALID");
  } else {
    const s = staff || {
      active: fixture.authorization !== "inactive",
      role:
        fixture.authorization === "role" ? "Report Viewer" : "Lounge Officer",
      station:
        fixture.authorization === "location" ? "OTHER" : location.station,
      seamlessDemo: {
        active: true,
        enrollmentStatus:
          fixture.authorization === "unenrolled" ? "Pending" : "Enrolled",
        loungeIds: [location.loungeId],
      },
    };
    result.states.push("AUTHORIZATION_CHECKED");
    result.authorization = "NOT_ELIGIBLE";
    if (s.active !== true || s.seamlessDemo?.active !== true)
      return reject("STAFF_INACTIVE");
    if (s.seamlessDemo.enrollmentStatus !== "Enrolled")
      return reject("ENROLLMENT_INCOMPLETE");
    if (
      !STAFF_ROLES.includes(s.role) ||
      s.station !== location.station ||
      !s.seamlessDemo.loungeIds?.includes(location.loungeId)
    )
      return reject("STAFF_AUTHORIZATION_INVALID");
  }
  result.authorization = "ELIGIBLE";
  result.decision = "ELIGIBLE";
  result.states.push("ELIGIBLE");
  return result;
}
export { simulateGate };
