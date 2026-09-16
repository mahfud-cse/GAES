import type { MembershipConnector, VerificationContext, VerificationResult } from "../../types/integration";

export class MockMembershipConnector implements MembershipConnector {
  async verify(context: VerificationContext): Promise<VerificationResult> {
    const eligible = Boolean(context.reference.trim()) && !context.reference.toUpperCase().startsWith("INVALID");
    return {
      eligible,
      decisionCode: eligible ? "ELIGIBLE" : "REFERENCE_NOT_ELIGIBLE",
      message: eligible ? "Membership reference is eligible." : "Membership reference is not eligible.",
      evidenceRequired: !eligible,
      sourceReference: `MOCK-${context.productCode}-${context.visitorId}`,
      verifiedAt: new Date().toISOString(),
    };
  }
}

export class LiveMembershipConnector implements MembershipConnector {
  constructor(private readonly endpoint: string, private readonly accessToken: string) {}

  async verify(context: VerificationContext): Promise<VerificationResult> {
    const response = await fetch(`${this.endpoint}/v1/membership/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.accessToken}` },
      body: JSON.stringify(context),
    });
    if (!response.ok) throw new Error(`Membership API failed with HTTP ${response.status}`);
    return response.json() as Promise<VerificationResult>;
  }
}
