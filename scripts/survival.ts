// The survival run: the bot starts with nothing in a normal world and works its way up to
// a finished farmhouse (chop, craft tools, mine stone, dig sand, smelt glass, build).
//
//   npm run survival              runs it and prints every step
//   npm run survival -- --build-only   hands over the materials and only builds (for
//                                      testing the last step without 15 minutes of chopping)
//   npm run survival -- --record       also films it: docs/survival.webm (a 30x timelapse),
//                                      docs/survival.gif and docs/survival.png (the house)
//   npm run survival -- --planner ai   the AI planner plans it (and replans every failed
//                                      step) instead of the scripted plan; each plan is
//                                      one call to the CLI in AI_CLI
//   npm run survival -- --probe        debug output when a skill sees no items
//
// By default the plan comes from src/plans/survival.ts (scripted, no AI). The world is
// seed 8675309: oak and birch, stone and sand within ~30 blocks of spawn (see scout.ts).
import { createAgentBot } from '../src/bot.ts';
import { runPlan } from '../src/plans/run.ts';
import { survivalPlan } from '../src/plans/survival.ts';
import { CliPlanner } from '../src/planner/cli.ts';
import { carryOut } from '../src/planner/index.ts';
import { worldState } from '../src/planner/state.ts';
import { woodsNearby } from '../src/skills/wood.ts';
import { startServer, sleep, VERSION } from '../test/scenario/harness.ts';
import { mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { clearestShot, openViewer, startTimelapse, type ViewerPage } from './record.ts';
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
    // op skips vanilla's spam kick: one run got "disconnect.spam" right after a burst of crafting
    for (const command of ['op Steve_AI', 'time set 1000', 'gamerule doDaylightCycle false', 'weather clear', 'gamerule doWeatherCycle false']) {
      server.command(command);
    }
    await sleep(5000); // chunks around spawn
    await bot.waitForChunksToLoad();

    const woods = woodsNearby(bot);
    const inventory = new Map(bot.inventory.items().map((item) => [item.name, item.count]));
    let steps = survivalPlan('farmhouse', inventory, undefined, woods);
    if (process.argv.includes('--build-only')) {
      // roughly what the run has in its pockets when it gets to the build (the dirt from
      // digging stairs is what levelling the site fills holes with)
      const kit = { cobblestone: 64, oak_log: 64, birch_planks: 64, oak_planks: 64, oak_stairs: 128, glass_pane: 16, torch: 8, oak_door: 2, crafting_table: 1, furnace: 1, chest: 1, dirt: 16 };
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
    // a kicked bot never finishes its skill, so without this the script just hangs
    const abort = new AbortController();
    bot.once('end', (reason) => {
      log(`disconnected (${reason}), stopping`);
      abort.abort();
    });
    if (process.argv.includes('--probe')) probeItems(bot);
    const ctx = { bot, signal: abort.signal, log };
    const useAi = process.argv[process.argv.indexOf('--planner') + 1] === 'ai';
    let result;
    if (useAi) {
      // the same loop as `!do`: plan, run, and on a failed step send the planner the error and
      // the inventory for a new plan
      const request = process.argv.includes('--build-only') ? 'build a farmhouse with what you have' : 'build a farmhouse';
      result = await carryOut(ctx, new CliPlanner(), request, () => worldState(bot), { replans: 4 });
    } else result = await runPlan(ctx, steps);
    // the fuel for the furnace comes out of the same planks and logs the house needs, so it
    // can get to the build a few short; a fresh plan from what it has fills the gap (the
    // same thing the AI planner will do with any failed step)
    // each round can come up a few blocks short again (a crafting table made of the wall planks...)
    for (let round = 1; !useAi && !result.ok && !abort.signal.aborted && round <= 4; round++) {
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
        const house = { x: x + 4.5, y: y + 3, z: z + 2.5 };
        await viewer.page.evaluate((p) => ((window as any).__orbit = p), house);
        timelapse.realTime();
        await sleep(15000); // a lap around the finished house
        // then park the camera where no tree hides the house, for docs/survival.png
        await viewer.page.evaluate((s) => ((window as any).__still = s), clearestShot(bot, house));
        await sleep(1500);
      } else await sleep(8000);
      // an AI-planned run keeps its own files, so it doesn't replace the scripted one
      const name = (useAi ? 'survival-ai' : 'survival') + (result.ok ? '' : '-failed');
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

// item probe (debug, see scripts/item-probe.ts): when a skill says it saw no items,
// compare with the raw spawn packets that really came in around that time
function probeItems(bot: ReturnType<typeof createAgentBot>) {
  const itemType = bot.registry.entitiesByName['item']!.id;
  const rawItems: { id: number; at: number; x: number; y: number; z: number }[] = [];
  let parseErrors = 0;
  bot._client.on('packet', (data: any, meta: { name: string }) => {
    if (meta.name === 'spawn_entity' && data.type === itemType) {
      rawItems.push({ id: data.entityId, at: Date.now(), x: data.x, y: data.y, z: data.z });
      if (rawItems.length > 500) rawItems.shift();
    }
  });
  (bot._client as unknown as NodeJS.EventEmitter).on('error', () => parseErrors++);
  bot.on('agent_log' as never, ((text: string) => {
    if (/out of reach|didn't take the cut|boxed in/.test(text)) {
      const feet = bot.entity.position.floored();
      const around = [-1, 0, 1, 2].map((dy) => `${dy}:${bot.blockAt(feet.offset(0, dy, 0))?.name}`).join(' ') +
        ' | sides ' + [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => `${bot.blockAt(feet.offset(dx!, 0, dz!))?.name}/${bot.blockAt(feet.offset(dx!, 1, dz!))?.name}`).join(' ');
      console.log(`  [probe] bot at ${bot.entity.position} (onGround ${bot.entity.onGround}), blocks ${around}`);
      return;
    }
    if (!/no items in sight|picked up nothing/.test(text)) return;
    const recent = rawItems.filter((item) => Date.now() - item.at < 15_000);
    const known = recent.filter((item) => bot.entities[item.id]).length;
    const p = bot.entity.position;
    console.log(
      `  [probe] raw item spawns in last 15s: ${recent.length} (still in bot.entities: ${known}); ` +
        `items in bot.entities: ${Object.values(bot.entities).filter((e) => e.name === 'item').length}; ` +
        `entities total: ${Object.keys(bot.entities).length}; parse errors: ${parseErrors}; ` +
        `bot at ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}; nearest raw: ${recent
          .map((item) => Math.hypot(item.x - p.x, item.z - p.z).toFixed(0))
          .slice(-5)
          .join(',')}`,
    );
  }) as never);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
