// Records the demo video: the bot builds a farmhouse while a camera circles around it.
//
//   npm run demo          writes docs/demo.webm, docs/demo.gif (a timelapse) and docs/screenshot.png
//
// It runs its own server in a throwaway world (a flat world whose ground is at y = 0:
// prismarine-viewer doesn't draw anything below y = 0), gives the bot the materials,
// opens the 3D viewer in Edge or Chrome with Playwright and records the page.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgentBot, runSkill } from '../src/bot.ts';
import { startServer, sleep, waitFor, VERSION } from '../test/scenario/harness.ts';
import { writeGif } from './gif.ts';
import { openViewer } from './record.ts';
import { SERVER_FOLDER } from './server.ts';
import { SERVER_PROPERTIES } from './setup-server.ts';

const PORT = 25620;
const VIEWER_PORT = 3007;
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs');
const CORNER = { x: -4, y: 1, z: 0 }; // where the farmhouse goes (9 x 5)
const CENTER = { x: CORNER.x + 4.5, y: CORNER.y + 3, z: CORNER.z + 2.5 };

// what the farmhouse takes (see materialsNeeded in src/skills/build.ts)
const MATERIALS: [string, number][] = [
  ['cobblestone', 31], ['oak_planks', 21], ['spruce_stairs', 64], ['spruce_stairs', 3], ['birch_planks', 32],
  ['oak_log', 31], ['glass_pane', 10], ['spruce_planks', 10], ['torch', 3], ['crafting_table', 1],
  ['furnace', 1], ['chest', 1], ['spruce_door', 1],
];

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
    // flower patches spread several blocks, so they start well away from the house
    for (const [x, z] of [[-16, -6], [17, 9], [-12, 16], [10, -15], [18, -4], [-18, 8]]) {
      server.command(`place feature minecraft:flower_plain ${x} 1 ${z}`);
    }
    for (const [item, count] of MATERIALS) server.command(`give Steve_AI minecraft:${item} ${count}`);
    await waitFor(() => bot.inventory.items().length >= 12, 'the materials', 20_000);

    const { browser, context, page } = await openViewer(bot, {
      port: VIEWER_PORT,
      center: CENTER,
      video: tmpVideo,
      title: 'minecraft-ai-agent',
      subtitle: 'a bot building a farmhouse on its own, block by block: no human controls',
    });
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
    const result = await runSkill(bot, 'build', { structure: 'farmhouse', ...CORNER });
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
