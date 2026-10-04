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
  assert.match(
    css,
    /\.modalActions > button,[\s\S]*?min-height:\s*var\(--touch-target\)/,
  );
  assert.match(
    css,
    /\.modal \.form,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
});

test("rejects teal UI colors, including the sign-in surface", async () => {
  const css = await read("../app/globals.css");
  const colors = css.match(/#[0-9a-f]{3,8}\b/gi) ?? [];

  for (const color of colors) {
    let hex = color.slice(1);
    if (hex.length === 3 || hex.length === 4)
      hex = [...hex].map((digit) => digit + digit).join("");
    const [red, green, blue] = [0, 2, 4].map((offset) =>
      Number.parseInt(hex.slice(offset, offset + 2), 16),
    );
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    let hue = 0;
    if (maximum !== minimum) {
      if (maximum === red)
        hue = (60 * ((green - blue) / (maximum - minimum)) + 360) % 360;
      else if (maximum === green)
        hue = 60 * ((blue - red) / (maximum - minimum) + 2);
      else hue = 60 * ((red - green) / (maximum - minimum) + 4);
    }
    const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
    assert.ok(
      hue < 175 || hue > 205 || saturation <= 0.03,
      `prohibited teal color ${color} remains in the active stylesheet`,
    );
  }

  assert.match(css, /\.loginPage\s*\{[\s\S]*?#062b5ce8[\s\S]*?#0b3e75cc/);
});

test("keeps interactive panel content readable on navy states", async () => {
  const css = await read("../app/globals.css");
  assert.match(
    css,
    /\.dashboardKpis > button:hover,[\s\S]*?background:\s*var\(--color-navy-900\);[\s\S]*?color:\s*#fff;/,
  );
  assert.match(
    css,
    /\.dashboardKpis[\s\S]*?> button:is\([\s\S]*?\.accountList[\s\S]*?button:is\([\s\S]*?color:\s*inherit;/,
  );
});

test("keeps bilingual rendering symmetric and responsive to UI changes", async () => {
  const page = await read("../app/page.tsx");
  assert.match(page, /"Memulihkan sesi\.\.\.":\s*"Restoring session\.\.\."/);
  assert.match(page, /"Lupa password\?":\s*"Forgot password\?"/);
  assert.match(page, /className="loginLanguageToggle"/);
  assert.match(page, /tr\("Masuk", "Sign In"\)/);
  assert.match(
    page,
    /"DATA PENUMPANG PER FLIGHT":\s*"FLIGHT-LEVEL PASSENGER DATA"/,
  );
  assert.match(page, /Object\.entries\(interfaceTranslations\)\.map/);
  assert.match(page, /attributes:\s*true/);
  assert.match(page, /characterData:\s*true/);
  assert.match(
    page,
    /attributeFilter:\s*\["placeholder", "aria-label", "title"\]/,
  );
});

test("uses the root Next.js application for local and Netlify builds", async () => {
  const [packageJson, netlify] = await Promise.all([
    read("../package.json").then(JSON.parse),
    read("../netlify.toml"),
  ]);

  assert.equal(packageJson.scripts.dev, "next dev");
  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(packageJson.scripts.start, "next start");
  assert.equal(
    packageJson.scripts.test,
    "npm run test:logic && npm run test:ui && npm run lint && npm run build",
  );
  assert.match(netlify, /command\s*=\s*"npm test"/);
  assert.doesNotMatch(netlify, /source\/|static-build\/|vinext|vite/);
});
