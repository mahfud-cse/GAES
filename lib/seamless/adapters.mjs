// Internal adapter contract only. No vendor endpoint/protocol is assumed.
export async function withDeadline(operation, milliseconds = 3000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("SERVICE_TIMEOUT"));
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function demoIdentity(fixture) {
  if (fixture.identity === "timeout")
    return { available: false, captured: true, matched: false };
  if (fixture.identity === "invalid") return { available: true };
  return {
    available: true,
    captured: true,
    matched: fixture.identity === "matched",
    referenceId: fixture.identity === "matched" ? fixture.id : null,
    liveness: "SIMULATED",
    category: fixture.category,
  };
}

export function demoPassenger(fixture, location) {
  if (fixture.authorization === "timeout") return { available: false };
  if (fixture.authorization === "missing")
    return { available: true, record: null };
  // Fictional entitlement attestation; never mapped to real visitors or billing.
  return {
    available: true,
    record: { referenceId: fixture.id },
    entitlement: {
      decision: fixture.authorization === "valid" ? "ELIGIBLE" : "NOT_ELIGIBLE",
      station: location.station,
      loungeId: location.loungeId,
      policy: "DEMO_ONLY",
      validUntil: fixture.authorization === "expired" ? 0 : Date.now() + 60000,
    },
  };
}

export function simulateGate({ eligible, behavior, deviceId, loungeId }) {
  if (!eligible)
    return {
      state: "NOT_REQUESTED",
      commandIssued: false,
      simulated: true,
      physicalOpenConfirmed: false,
      trace: [],
    };
  const base = {
    simulated: true,
    physicalOpenConfirmed: false,
    deviceId,
    loungeId,
  };
  if (behavior === "offline")
    return {
      ...base,
      state: "DEVICE_UNAVAILABLE",
      commandIssued: false,
      trace: ["DEVICE_UNAVAILABLE"],
    };
  const trace = ["ACCESS_COMMAND_REQUESTED"];
  if (behavior === "wrong-device")
    return {
      ...base,
      state: "ACK_REJECTED",
      commandIssued: true,
      trace: [...trace, "ACK_REJECTED"],
    };
  if (behavior === "timeout")
    return {
      ...base,
      state: "COMMAND_TIMEOUT",
      commandIssued: true,
      trace: [...trace, "COMMAND_TIMEOUT"],
    };
  trace.push("COMMAND_ACCEPTED");
  if (behavior === "accepted")
    return { ...base, state: "COMMAND_ACCEPTED", commandIssued: true, trace };
  if (behavior === "fault")
    return {
      ...base,
      state: "GATE_FAULT",
      commandIssued: true,
      trace: [...trace, "GATE_FAULT"],
    };
  return {
    ...base,
    state: "SIMULATED_OPEN_CONFIRMED",
    commandIssued: true,
    trace: [...trace, "SIMULATED_OPEN_CONFIRMED", "SIMULATED_CLOSED"],
    resetState: "SIMULATED_CLOSED",
  };
}

// Fail closed until approved providers, policy mapping, and hardware contracts
// are implemented server-side. Environment variables alone never enable live.
export const liveAdapters = Object.freeze({
  configured: false,
  reason: "LIVE_NOT_CONFIGURED",
});
