import type { ConnectorMode } from "../types/integration";

export type IntegrationKey = "flightSchedule" | "passengerList" | "garudaMiles" | "emd" | "partnerAirline" | "payment" | "evidence" | "notification";

export type IntegrationRegistration = {
  key: IntegrationKey;
  mode: ConnectorMode;
  serverEnvironmentKey: string;
  fallback: string;
};

export const integrationRegistry: IntegrationRegistration[] = [
  { key: "flightSchedule", mode: "mock", serverEnvironmentKey: "FLIGHT_SCHEDULE_API_BASE_URL", fallback: "CSV/XLSX import and manual flight" },
  { key: "passengerList", mode: "mock", serverEnvironmentKey: "PASSENGER_LIST_API_BASE_URL", fallback: "Mapped CSV/XLSX import with validation preview" },
  { key: "garudaMiles", mode: "mock", serverEnvironmentKey: "GARUDAMILES_API_BASE_URL", fallback: "HO Ancillary manual verification with evidence" },
  { key: "emd", mode: "mock", serverEnvironmentKey: "EMD_API_BASE_URL", fallback: "HO Ancillary manual verification" },
  { key: "partnerAirline", mode: "mock", serverEnvironmentKey: "PARTNER_AIRLINE_API_BASE_URL", fallback: "Scoped airline verifier" },
  { key: "payment", mode: "mock", serverEnvironmentKey: "PAYMENT_API_BASE_URL", fallback: "Receipt evidence" },
  { key: "evidence", mode: "mock", serverEnvironmentKey: "EVIDENCE_STORAGE_API_BASE_URL", fallback: "Metadata-only prototype" },
  { key: "notification", mode: "mock", serverEnvironmentKey: "NOTIFICATION_API_BASE_URL", fallback: "In-app notification" },
];
