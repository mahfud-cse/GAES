# GAES v0.22.2

Status: statically verified; production UAT remains required.

## Replaced implementations

- Firebase Admin is pinned to `13.7.0`, resolving the Netlify `jose`/CommonJS runtime failure.
- API errors now preserve the actual Netlify function message and HTTP fallback.
- Add/import user and lounge synchronization notices now use explicit success, warning, and failure states.
- Boarding-pass parsing uses IATA BCBP fixed fields instead of a sample-specific pattern.
- Unknown decoded symbols preserve the raw value and report that the boarding-pass format is not recognized.
- Camera decoding supports QR Code, Code 128, PDF417, Aztec, Data Matrix, Code 39, EAN-13, and EAN-8 with `TRY_HARDER` enabled.
- Camera tracks are stopped after success, close, failure, or component unmount.
- Scanner, Excel, and PDF libraries load only when their features are used.
- The camera guide marks the full preview area and does not act as a rectangular scan restriction.

## Verification completed

- `npm ci` completed from the committed lockfile.
- `npm ls firebase-admin jwks-rsa jose` resolved to `13.7.0`, `3.2.2`, and `4.15.9`.
- `npx next build` passed, including TypeScript and static page generation.
- Parser smoke checks passed for IATA BCBP, labelled input, and unknown payload.

## UAT still required

- Test real boarding passes on representative Android and iOS devices in portrait and landscape.
- Test horizontal/vertical 1D codes and square QR/2D codes under low light.
- Test create user, import user, and source-lounge synchronization against Netlify production functions.
