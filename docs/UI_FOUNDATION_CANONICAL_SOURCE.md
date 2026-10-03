# UI Foundation — Canonical Source

## Active application

The root application is the only active source used for development, testing, and Netlify deployment:

- `app/`
- `lib/`
- root `package.json`
- root `netlify.toml`

`source/` and `static-build/` are legacy snapshots. They are not build inputs and must not receive new UI changes. They remain in the package for now so removal can be handled as a separate, explicit cleanup.

## Foundation rules

- Global design tokens and shared element defaults live in `app/globals.css`.
- New colors, spacing, radii, typography, control heights, shadows, and z-index values should use the tokens declared in the single `:root` block.
- Buttons inherit one shared base. Component selectors should define only their semantic variant or layout.
- Do not add `!important`. Resolve cascade conflicts through source order, component boundaries, or narrowly scoped selectors.
- Dialogs must remain constrained by both viewport width and dynamic viewport height (`dvh`) and provide 44px mobile action targets.

## Build guard

`npm test` runs logic tests, UI foundation tests, linting, and the production Next.js build. Netlify runs the same command, so deployment cannot bypass these checks.
