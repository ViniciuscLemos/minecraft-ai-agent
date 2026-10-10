// The survival run: the bot starts with nothing in a normal world and works its way up to
// a finished farmhouse (chop, craft tools, mine stone, dig sand, smelt glass, build).
//
//   npm run survival              runs it and prints every step
//
// The plan comes from src/plans/survival.ts for now (scripted, not AI yet). The world is
// seed 8675309: oak and birch, stone and sand within ~30 blocks of spawn (see scout.ts).
import { createAgentBot } from '../src/bot.ts';
import { runPlan } from '../src/plans/run.ts';
import { survivalPlan } from '../src/plans/survival.ts';
import { woodsNearby } from '../src/skills/wood.ts';
import { startServer, sleep, VERSION } from '../test/scenario/harness.ts';
import { normalWorldFolder } from './scout.ts';

const PORT = 25622;
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
    const steps = survivalPlan('farmhouse', inventory, undefined, woods);
    console.log(`woods around: ${woods.join(', ')}; ${steps.length} steps`);

    const started = Date.now();
    const log = (text: string) => {
      console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${text}`);
      bot.emit('agent_log' as never, text as never); // the viewer panel
    };
    const ctx = { bot, signal: new AbortController().signal, log };
    const result = await runPlan(ctx, steps);
    const minutes = ((Date.now() - started) / 60000).toFixed(1);
    if (result.ok) console.log(`Done in ${minutes} min.`);
    else console.log(`Stopped at step ${result.failed.index + 1} (${result.failed.step.skill}) after ${minutes} min: ${result.failed.error}`);
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
