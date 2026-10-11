// The survival run: the bot starts with nothing in a normal world and works its way up to
// a finished farmhouse (chop, craft tools, mine stone, dig sand, smelt glass, build).
//
//   npm run survival              runs it and prints every step
//   npm run survival -- --build-only   hands over the materials and only builds (for
//                                      testing the last step without 15 minutes of chopping)
//   npm run survival -- --record       also films it: docs/survival.webm (a 30x timelapse),
//                                      docs/survival.gif and docs/survival.png (the house)
//
// The plan comes from src/plans/survival.ts for now (scripted, not AI yet). The world is
// seed 8675309: oak and birch, stone and sand within ~30 blocks of spawn (see scout.ts).
import { createAgentBot } from '../src/bot.ts';
import { runPlan } from '../src/plans/run.ts';
import { survivalPlan } from '../src/plans/survival.ts';
import { woodsNearby } from '../src/skills/wood.ts';
import { startServer, sleep, VERSION } from '../test/scenario/harness.ts';
import { mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { openViewer, startTimelapse, type ViewerPage } from './record.ts';
import { normalWorldFolder } from './scout.ts';

const PORT = 25622;
const VIEWER_PORT = 3008;
const OUT = path.resolve(import.meta.dirname, '..', 'docs');
export const SEED = '8675309';

async function main() {
  const server = await startServer(PORT, normalWorldFolder('.survival-server', SEED, PORT));
  try {
    const bot = createAgentBot({ host: 'localhost', port: PORT, version: VERSION, username: 'Steve_AI', owners: [] });
    await new Promise<void>((resolve) => bot.once('spawn', () => resolve()));
    for (const command of ['time set 1000', 'gamerule doDaylightCycle false', 'weather clear', 'gamerule doWeatherCycle false']) {
      server.command(command);
    }
    await sleep(5000); // chunks around spawn
    await bot.waitForChunksToLoad();

    const woods = woodsNearby(bot);
    const inventory = new Map(bot.inventory.items().map((item) => [item.name, item.count]));
    let steps = survivalPlan('farmhouse', inventory, undefined, woods);
    if (process.argv.includes('--build-only')) {
      // roughly what the run has in its pockets when it gets to the build
      const kit = { cobblestone: 64, oak_log: 64, birch_planks: 64, oak_planks: 64, oak_stairs: 128, glass_pane: 16, torch: 8, oak_door: 2, crafting_table: 1, furnace: 1, chest: 1 };
      for (const [item, count] of Object.entries(kit)) server.command(`give Steve_AI ${item} ${count}`);
      await sleep(2000);
      steps = steps.slice(-1);
    }
    console.log(`woods around: ${woods.join(', ')}; ${steps.length} steps`);

    const record = process.argv.includes('--record');
    let viewer: ViewerPage | undefined;
    let timelapse: ReturnType<typeof startTimelapse> | undefined;
    if (record) {
      mkdirSync(OUT, { recursive: true });
      viewer = await openViewer(bot, {
        port: VIEWER_PORT,
        title: 'minecraft-ai-agent',
        subtitle: 'starts with empty pockets in a normal world and works its way up to a house',
      });
      await sleep(6000); // chunks and textures
      // a frame every 20 s for the GIF: a 25 min run at every 10 s came out at 14 MB
      // a run that gets stuck shouldn't replace the last good recording, so it films to a
      // side file and only takes the real names once the house is up
      timelapse = startTimelapse(viewer.page, bot, { file: path.join(OUT, 'survival-run.webm'), gifEvery: 30 });
    }

    const started = Date.now();
    const log = (text: string) => {
      console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${text}`);
      bot.emit('agent_log' as never, text as never); // the viewer panel
    };
    const ctx = { bot, signal: new AbortController().signal, log };
    let result = await runPlan(ctx, steps);
    // the fuel for the furnace comes out of the same planks and logs the house needs, so it
    // can get to the build a few short; a fresh plan from what it has fills the gap (the
    // same thing the AI planner will do with any failed step)
    // each round can come up a few blocks short again (a crafting table made of the wall planks...)
    for (let round = 1; !result.ok && round <= 4; round++) {
      const have = new Map<string, number>();
      for (const item of bot.inventory.items()) have.set(item.name, (have.get(item.name) ?? 0) + item.count);
      log(`step ${result.failed.index + 1} failed (${result.failed.error}), planning again from what I have`);
      result = await runPlan(ctx, survivalPlan('farmhouse', have, undefined, woods));
    }
    const minutes = ((Date.now() - started) / 60000).toFixed(1);
    if (result.ok) console.log(`Done in ${minutes} min.`);
    else console.log(`Stopped at step ${result.failed.index + 1} (${result.failed.step.skill}) after ${minutes} min: ${result.failed.error}`);
    if (viewer && timelapse) {
      bot.chat(result.ok ? 'Done! Come take a look.' : 'I got stuck, see the log.');
      // the build step says where the house is (its corner): circle it instead of the bot
      const at = /at (-?\d+) (-?\d+) (-?\d+)/.exec(result.results.at(-1) ?? '');
      if (result.ok && at) {
        const [x, y, z] = at.slice(1).map(Number) as [number, number, number];
        await viewer.page.evaluate((p) => ((window as any).__orbit = p), { x: x + 4.5, y: y + 3, z: z + 2.5 });
        timelapse.realTime();
        await sleep(15000); // a lap around the finished house
      } else await sleep(8000);
      const name = result.ok ? 'survival' : 'survival-failed';
      await viewer.page.screenshot({ path: path.join(OUT, `${name}.png`) });
      const { shots } = await timelapse.stop(path.join(OUT, `${name}.gif`));
      renameSync(path.join(OUT, 'survival-run.webm'), path.join(OUT, `${name}.webm`));
      console.log(`Saved docs/${name}.webm, .gif and .png (${shots} frames)`);
      await viewer.browser.close();
    }
    // what it had when it stopped, for figuring out why
    console.log(`inventory: ${bot.inventory.items().map((i) => `${i.count} ${i.name}`).join(', ')}`);
    bot.quit();
  } finally {
    await server.stop();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
