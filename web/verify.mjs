import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer';
import { existsSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DOCS = '/Users/shinjia/Project/kiro-office/docs';

// 1. spawn vite preview on built dist (deterministic, no watcher needed)
const server = spawn('npx', ['vite', 'preview', '--port', '5280', '--strictPort'], {
  cwd: '/Users/shinjia/Project/kiro-office/web',
  stdio: ['ignore', 'pipe', 'pipe'],
});
let up = false;
server.stdout.on('data', (d) => { if (/5280/.test(d.toString())) up = true; process.stdout.write('[vite] ' + d); });
server.stderr.on('data', (d) => process.stdout.write('[vite-err] ' + d));

async function waitUp() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:5280/'); if (r.ok) return true; } catch {}
    await sleep(250);
  }
  return false;
}

const ok = await waitUp();
console.log('server up:', ok, 'flag:', up);

const browser = await puppeteer.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => { logs.push(`[pageerror] ${e.message}`); });

await page.goto('http://127.0.0.1:5280/', { waitUntil: 'networkidle0', timeout: 60000 });
// wait for GLTF models + composer to settle
await sleep(6000);

await page.screenshot({ path: `${DOCS}/office-rebuild-main.png` });
// measure floor width fraction of canvas
const frac = await page.evaluate(() => {
  const o = window.__office;
  return o ? o.debugFloorWidthFraction() : null;
});
console.log('FLOOR_WIDTH_FRACTION=', frac);


// zoom ~2.0 framing lobby + founder: dispatch wheel to zoom, then pan.
await page.evaluate(() => {
  const c = document.getElementById('office');
  // zoom in via repeated wheel-up over the canvas
  for (let i = 0; i < 18; i++) {
    c.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
  }
});
await sleep(1500);
// pan toward lobby/founder (front rows, lower on screen) via drag
await page.mouse.move(800, 400);
await page.mouse.down();
await page.mouse.move(800, 620, { steps: 10 });
await page.mouse.up();
await sleep(1500);
await page.screenshot({ path: `${DOCS}/office-rebuild-zoom.png` });

console.log('=== CONSOLE LOG DUMP START ===');
for (const l of logs) console.log(l);
console.log('=== CONSOLE LOG DUMP END ===');

const overlapErrors = logs.filter((l) => l.includes('[layout] overlap')).length;
console.log('OVERLAP_ERRORS=', overlapErrors);

await browser.close();
server.kill('SIGKILL');
process.exit(0);
