export type ConnectorMode = "mock" | "live";

export type VerificationContext = {
  visitorId: string;
  productCode: string;
  reference: string;
  passengerName: string;
  flightNumber: string;
  dateOfTravel: string;
  station: string;
  organizationScope?: string;
};

export type VerificationResult = {
  eligible: boolean;
  decisionCode: string;
  message: string;
  tier?: string;
  payer?: string;
  evidenceRequired?: boolean;
  sourceReference?: string;
  verifiedAt: string;
};

export interface MembershipConnector {
  verify(context: VerificationContext): Promise<VerificationResult>;
}

export interface FlightScheduleConnector {
  findFlight(input: { flightNumber: string; dateOfTravel: string; station: string }): Promise<{ found: boolean; origin?: string; destination?: string; std?: string; etd?: string; status?: string }>;
}

export interface PassengerListConnector {
  findPassenger(input: { passengerName: string; flightNumber: string; dateOfTravel: string; sequence?: string }): Promise<{ found: boolean; seatNumber?: string; sourceReference?: string }>;
}
