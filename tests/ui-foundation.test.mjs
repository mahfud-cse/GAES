import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("keeps one canonical UI foundation without specificity overrides", async () => {
  const css = await read("../app/globals.css");
  assert.equal((css.match(/:root\s*\{/g) ?? []).length, 1);
  assert.doesNotMatch(css, /!important/);
  assert.doesNotMatch(css, /width\s*:\s*minmax\(/);
  assert.match(css, /--font-ui:/);
  assert.match(css, /--control-height:/);
  assert.match(css, /--touch-target:/);
  assert.match(css, /--z-modal:/);
});

test("keeps shared buttons and mobile-safe modal constraints", async () => {
  const css = await read("../app/globals.css");
  assert.match(css, /button,\s*\n\.uploadButton\s*\{/);
  assert.match(css, /max-height:\s*calc\(100dvh - 24px\)/);
  assert.match(css, /\.modalActions > button,[\s\S]*?min-height:\s*var\(--touch-target\)/);
  assert.match(css, /\.modal \.form,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("uses the root Next.js application for local and Netlify builds", async () => {
  const [packageJson, netlify] = await Promise.all([
    read("../package.json").then(JSON.parse),
    read("../netlify.toml"),
  ]);

  assert.equal(packageJson.scripts.dev, "next dev");
  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(packageJson.scripts.start, "next start");
  assert.equal(packageJson.scripts.test, "npm run test:logic && npm run test:ui && npm run lint && npm run build");
  assert.match(netlify, /command\s*=\s*"npm test"/);
  assert.doesNotMatch(netlify, /source\/|static-build\/|vinext|vite/);
});
