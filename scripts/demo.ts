// Records the demo video: the bot builds a cottage while a camera circles around it.
//
//   npm run demo          writes docs/demo.webm, docs/demo.gif (a timelapse) and docs/screenshot.png
//
// It runs its own server in a throwaway world (a flat world whose ground is at y = 0:
// prismarine-viewer doesn't draw anything below y = 0), gives the bot the materials,
// opens the 3D viewer in Edge or Chrome with Playwright and records the page.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createAgentBot, runSkill } from '../src/bot.ts';
import { startViewer } from '../src/viewer.ts';
import { startServer, sleep, waitFor, VERSION } from '../test/scenario/harness.ts';
import { writeGif } from './gif.ts';
import { SERVER_FOLDER } from './server.ts';
import { SERVER_PROPERTIES } from './setup-server.ts';

const PORT = 25620;
const VIEWER_PORT = 3007;
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs');
const CORNER = { x: -3, y: 1, z: 0 }; // where the cottage goes (7 x 5)
const CENTER = { x: CORNER.x + 3.5, y: CORNER.y + 2.5, z: CORNER.z + 2.5 };

// same server, different world: ground at y = 0 instead of y = -61
function prepareFolder() {
  if (!existsSync(path.join(SERVER_FOLDER, 'eula.txt'))) throw new Error('Run npm run server:setup first.');
  const folder = path.join(ROOT, '.demo-server');
  mkdirSync(folder, { recursive: true });
  for (const file of ['server.jar', 'eula.txt']) copyFileSync(path.join(SERVER_FOLDER, file), path.join(folder, file));
  const properties = {
    ...SERVER_PROPERTIES,
    'server-port': String(PORT),
    'generator-settings': JSON.stringify({
      layers: [
        { block: 'minecraft:bedrock', height: 1 },
        { block: 'minecraft:stone', height: 60 },
        { block: 'minecraft:dirt', height: 3 },
        { block: 'minecraft:grass_block', height: 1 },
      ],
      biome: 'minecraft:plains',
    }),
  };
  writeFileSync(path.join(folder, 'server.properties'), Object.entries(properties).map(([k, v]) => `${k}=${v}`).join('\n'));
  return folder;
}

// runs in the page before the viewer: takes over its camera and adds the log panel
function pageSetup({ center }: { center: { x: number; y: number; z: number } }) {
  const w = window as unknown as Record<string, any>;
  let three: any;
  Object.defineProperty(w, 'THREE', {
    configurable: true,
    get: () => three,
    set(value) {
      three = value;
      const base = value.Camera.prototype.updateMatrixWorld;
      // the viewer's orbit controls move the camera every frame; this runs right after
      value.PerspectiveCamera.prototype.updateMatrixWorld = function (force: boolean) {
        if (!this.__busy && w.__start) {
          this.__busy = true;
          const t = (performance.now() - w.__start) / 1000;
          const angle = -0.6 + t * 0.09;
          const radius = 17 - 3 * Math.sin(t * 0.05);
          const height = 7 + 2 * Math.sin(t * 0.07);
          this.position.set(center.x + Math.cos(angle) * radius, center.y + height, center.z + Math.sin(angle) * radius);
          this.lookAt(center.x, center.y, center.z);
          this.__busy = false;
        }
        return base.call(this, force);
      };
    },
  });

  addEventListener('DOMContentLoaded', () => {
    const panel = document.createElement('div');
    panel.innerHTML = `
      <div style="font:600 22px/1.2 system-ui;margin-bottom:4px">minecraft-ai-agent</div>
      <div style="font:14px system-ui;opacity:.8;margin-bottom:10px">a bot building a cottage on its own: no human controls</div>
      <div id="log" style="font:13px/1.45 ui-monospace,Consolas,monospace"></div>`;
    Object.assign(panel.style, {
      position: 'fixed', left: '20px', top: '20px', width: '400px', padding: '16px 18px', color: '#fff',
      background: 'rgba(15,18,24,.72)', borderRadius: '12px', zIndex: 10, backdropFilter: 'blur(4px)',
    });
    document.body.appendChild(panel);
    const log = panel.querySelector('#log')!;
    const events = new EventSource('/events');
    events.onmessage = (e) => {
      const line = document.createElement('div');
      line.textContent = '> ' + JSON.parse(e.data);
      log.appendChild(line);
      while (log.childNodes.length > 9) log.removeChild(log.firstChild!);
    };
  });
}

async function main() {
  const folder = prepareFolder();
  const server = await startServer(PORT, folder);
  const tmpVideo = mkdtempSync(path.join(os.tmpdir(), 'mc-demo-'));
  try {
    const bot = createAgentBot({ host: 'localhost', port: PORT, version: VERSION, username: 'Steve_AI', owners: [] });
    await new Promise<void>((resolve) => bot.once('spawn', () => resolve()));
    for (const command of ['time set 1000', 'gamerule doDaylightCycle false', 'weather clear', 'gamerule doWeatherCycle false']) {
      server.command(command);
    }
    server.command(`tp Steve_AI ${CENTER.x} 1 ${CORNER.z - 5}`);
    // some scenery around the build site
    // far enough out that they never get between the camera and the house
    const trees = [[-24, -10], [-26, 6], [-18, 20], [22, -14], [26, 2], [20, 19], [3, -25], [-6, 27], [-21, -22], [14, 26]];
    for (const [x, z] of trees) server.command(`place feature minecraft:oak ${x} 1 ${z}`);
    for (const [x, z] of [[-9, -3], [9, 9], [-7, 10], [7, -9], [12, -2], [-12, 4]]) {
      server.command(`place feature minecraft:flower_plain ${x} 1 ${z}`);
    }
    for (const [item, count] of [['oak_log', 32], ['oak_planks', 64], ['oak_stairs', 64], ['glass_pane', 6], ['oak_door', 1]] as const) {
      server.command(`give Steve_AI minecraft:${item} ${count}`);
    }
    await waitFor(() => bot.inventory.items().length >= 5, 'the materials', 20_000);

    await startViewer(bot, { port: VIEWER_PORT, viewDistance: 5 });
    const browser = await chromium.launch({ channel: process.env.DEMO_BROWSER ?? 'msedge' });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: tmpVideo, size: { width: 1280, height: 720 } },
    });
    const page = await context.newPage();
    await page.addInitScript(pageSetup, { center: CENTER });
    await page.goto(`http://localhost:${VIEWER_PORT}`);
    await page.evaluate(() => ((window as any).__start = performance.now()));
    await sleep(6000); // chunks and textures

    // a frame every couple of seconds for the GIF, while the video records in real time
    const frames: Buffer[] = [];
    let capturing = true;
    const capture = (async () => {
      while (capturing) {
        frames.push(await page.screenshot({ type: 'png' }));
        await sleep(2000);
      }
    })();

    const started = Date.now();
    const result = await runSkill(bot, 'build', { structure: 'cottage', ...CORNER });
    console.log(`${result} (${Math.round((Date.now() - started) / 1000)}s)`);
    bot.chat('Done! Come take a look.');
    await sleep(8000);
    capturing = false;
    await capture;
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'screenshot.png') });
    // the finished house stays on screen a little longer at the end of the loop
    writeGif([...frames, ...Array(6).fill(frames.at(-1)!)], path.join(OUT, 'demo.gif'));
    console.log(`Saved docs/demo.gif (${frames.length} frames)`);

    await context.close(); // writes the video
    await browser.close();
    const video = readdirSync(tmpVideo).find((f) => f.endsWith('.webm'));
    if (!video) throw new Error('Playwright did not write a video');
    renameSync(path.join(tmpVideo, video), path.join(OUT, 'demo.webm'));
    console.log('Saved docs/demo.webm');
    bot.quit();
  } finally {
    await server.stop();
    rmSync(tmpVideo, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
