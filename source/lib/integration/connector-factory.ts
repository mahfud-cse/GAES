import { integrationRegistry, type IntegrationKey } from "../../config/integration-registry";
import { LiveMembershipConnector, MockMembershipConnector } from "./membership-connector";

export function createMembershipConnector(key: Extract<IntegrationKey, "garudaMiles" | "emd" | "partnerAirline">) {
  const registration = integrationRegistry.find((item) => item.key === key);
  if (!registration || registration.mode === "mock") return new MockMembershipConnector();
  const endpoint = process.env[registration.serverEnvironmentKey];
  const accessToken = process.env.MEMBERSHIP_API_ACCESS_TOKEN;
  if (!endpoint || !accessToken) throw new Error(`Missing server configuration for ${key}`);
  return new LiveMembershipConnector(endpoint, accessToken);
}
