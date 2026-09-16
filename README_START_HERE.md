# Garuda Lounge Access v0.20.0 — Start Here

## Product outputs

1. **Windows Portable** is for offline UAT. Extract the ZIP and run `START_OFFLINE_TEST.bat`.
2. **Developer Source and Static Build** is for Tim IT development, integration, security hardening, and production deployment.
3. **Website Test** is the controlled online UAT surface.

## Development

Use the `source` folder. Do not edit compiled JavaScript in `static-build/assets`.

```text
npm install
npm run build
```

Integration contracts and readiness notes are available in `docs/API_INTEGRATION_GUIDE.md`, `docs/API_INTEGRATION_REQUIREMENT.md`, and `source/config/integration-registry.ts`.

## Important production gaps

The package is a functional frontend prototype and IT-ready baseline. Production still requires corporate authentication, server-side authorization, database persistence, secure evidence storage, API gateway configuration, monitoring, backup, retention enforcement, and real integrations for Flight Schedule, Passenger List/DCS, membership, EMD, payment, and partner airlines.

## Version rule

Use the UAT scenarios and issue register to consolidate findings. Publish Website Test, Windows Portable, and Developer Package from the same approved source version.
