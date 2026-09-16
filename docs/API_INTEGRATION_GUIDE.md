# API Integration Guide

## Files Tim IT normally changes

1. `config/integration-registry.ts` — change a connector from `mock` to `live` and confirm its fallback.
2. `.env` on the server — set endpoint URLs and secrets based on `.env.example`. Do not commit this file.
3. `lib/integration/*-connector.ts` — map the corporate API request and response to the common connector contract.
4. `types/integration.ts` — extend the common contract only when the business data model genuinely changes.

The page must call a connector, not a partner API directly. This keeps credentials server-side and lets a new membership, bank, or airline use the same verification workflow.

## Verification sequence

Input visitor data → select product/entitlement → call `verify()` → receive eligible/not eligible plus decision code → route to final verifier. A non-eligible result is declined by default. Exceptional operational entry requires Lounge Manager approval and evidence, while the assigned verifier still decides final billing.

## Adding a company or membership

Create the product/agreement and effective-dated eligibility rule in Master Data. Assign the verifier organization, reference fields, tier/product, station scope, payer/price, companion rule, and evidence requirement. Tim IT then registers or reuses a connector. A separate trigger file is only needed when the new provider has a different API protocol; otherwise its configuration can reuse the common connector.

## Flight and passenger data

The prototype uses mock/manual/CSV data. Production requires server-side connectors to Flight Schedule and Passenger List/DCS. Until available, use the mapped CSV/XLSX fallback with preview, validation, duplicate checks, and an error report.
