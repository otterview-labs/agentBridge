// Run after installing android/tests dependencies: node tools/generate-icons.cjs.
// The app SVG is the source for Android vectors and all PNG launcher densities.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../android/tests/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'android/app/src/main/assets');
const res = path.join(root, 'android/app/src/main/res');
const source = fs.readFileSync(path.join(assets, 'brand-mark.svg'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setContent(source);
    const background = await page.locator('#background').getAttribute('fill');
    const paths = await page.locator('#mark path').evaluateAll(nodes =>
      nodes.map(node => ({ fill: node.getAttribute('fill'), d: node.getAttribute('d') })));
    const vector = (body) => `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n${body}\n</vector>\n`;
    const layers = (mono = false) => paths.map(p => `    <path android:fillColor="${mono ? '#FFFFFF' : p.fill}" android:pathData="${p.d}" />`).join('\n');
    fs.writeFileSync(path.join(res, 'drawable/ic_launcher_foreground.xml'), vector(layers()));
    fs.writeFileSync(path.join(res, 'drawable/ic_launcher_monochrome.xml'), vector(layers(true)));
    fs.writeFileSync(path.join(res, 'drawable/ic_launcher.xml'), vector(
      `    <path android:fillColor="${background}" android:pathData="M0 0H108V108H0Z" />\n    <group android:pivotX="54" android:pivotY="54" android:scaleX="1.25" android:scaleY="1.25">\n${layers()}\n    </group>`));
    fs.writeFileSync(path.join(res, 'values/colors.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${background}</color>\n</resources>\n`);
    async function render(size, filename, round = false) {
      await page.setViewportSize({ width: size, height: size });
      const svg = round ? source.replace('rx="25"', 'rx="54"') : source;
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
      await page.screenshot({ path: filename, omitBackground: true });
    }
    for (const [density, size] of Object.entries({mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192})) {
      await render(size, path.join(res, `mipmap-${density}/ic_launcher.png`));
      await render(size, path.join(res, `mipmap-${density}/ic_launcher_round.png`), true);
    }
    await render(512, path.join(root, 'docs/screenshots/icon.png'));
    console.log('Generated Android adaptive/monochrome/legacy vectors, 10 launcher PNGs and README icon.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
