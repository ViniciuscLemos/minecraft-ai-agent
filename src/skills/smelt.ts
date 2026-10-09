// Smelting in a furnace: sand into glass, cobblestone into stone, raw iron into ingots...
// It finds a furnace nearby or places one (crafting it from cobblestone if needed), and
// burns wood when there's no coal.
import type { Block } from 'prismarine-block';
import { checkAborted, countItem, goNear, isLog, isPlanks, sleep, SkillError, type SkillContext } from './context.ts';
import { craft } from './craft.ts';
import { placeNear } from './place.ts';

const FURNACE_RADIUS = 24;
// a furnace takes 10 seconds per item
const SECONDS_PER_ITEM = 10;

// what comes out, for the inputs a builder needs
export const SMELTS_INTO: Record<string, string> = {
  sand: 'glass',
  red_sand: 'glass',
  cobblestone: 'stone',
  stone: 'smooth_stone',
  raw_iron: 'iron_ingot',
  raw_gold: 'gold_ingot',
  raw_copper: 'copper_ingot',
  clay_ball: 'brick',
  oak_log: 'charcoal',
  birch_log: 'charcoal',
  spruce_log: 'charcoal',
};

// how many items one piece of each fuel smelts
const FUELS: [match: (name: string) => boolean, items: number][] = [
  [(n) => n === 'coal' || n === 'charcoal', 8],
  [isLog, 1.5],
  [isPlanks, 1.5],
  [(n) => n === 'stick', 0.5],
];

/** The fuel to use and how many pieces of it, or null when there isn't enough of anything. */
export function chooseFuel(inventory: { name: string; count: number }[], items: number) {
  for (const [match, perPiece] of FUELS) {
    const have = inventory.filter((it) => match(it.name)).reduce((sum, it) => sum + it.count, 0);
    const need = Math.ceil(items / perPiece);
    const stack = inventory.find((it) => match(it.name));
    if (stack && have >= need) return { name: stack.name, count: need };
  }
  return null;
}

export async function smelt(ctx: SkillContext, input: string, amount: number) {
  const { bot } = ctx;
  const name = input.toLowerCase().replace(/^minecraft:/, '').replace(/\s+/g, '_');
  const output = SMELTS_INTO[name];
  if (!output) throw new SkillError(`I don't know what ${name} turns into in a furnace.`);
  const have = countItem(bot, (n) => n === name);
  if (have < amount) throw new SkillError(`I need ${amount - have} more ${name} to smelt.`);

  // fuel is picked before anything else, so the logs it burns aren't the ones it needs
  const fuel = chooseFuel(bot.inventory.items().filter((it) => it.name !== name), amount);
  if (!fuel) throw new SkillError(`I have nothing to burn: I need coal, logs or planks.`);

  const furnaceBlock = await getFurnace(ctx);
  await goNear(ctx, furnaceBlock.position, 2);
  const furnace = await bot.openFurnace(furnaceBlock);
  try {
    await furnace.putFuel(bot.registry.itemsByName[fuel.name]!.id, null, fuel.count);
    await furnace.putInput(bot.registry.itemsByName[name]!.id, null, amount);
    ctx.log(`smelting ${amount} ${name} with ${fuel.count} ${fuel.name}`);

    const deadline = Date.now() + (amount * SECONDS_PER_ITEM + 15) * 1000;
    let taken = 0;
    while (taken < amount) {
      checkAborted(ctx);
      if (Date.now() > deadline) throw new SkillError(`The furnace is taking too long with the ${name}.`);
      await sleep(1000);
      const ready = furnace.outputItem();
      if (ready && ready.count > 0) {
        taken += ready.count;
        await furnace.takeOutput();
      }
    }
  } finally {
    furnace.close();
  }
  return `Smelted ${amount} ${name} into ${output} (now I have ${countItem(bot, (n) => n === output)}).`;
}

async function getFurnace(ctx: SkillContext): Promise<Block> {
  const { bot } = ctx;
  const nearby = bot.findBlock({ matching: bot.registry.blocksByName.furnace!.id, maxDistance: FURNACE_RADIUS });
  if (nearby) return nearby;
  if (countItem(bot, (n) => n === 'furnace') === 0) await craft(ctx, 'furnace', 1);
  return placeNear(ctx, 'furnace');
}
