// Mining a block type it can see from the surface (stone, coal, dirt...).
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import type { Vec3 } from 'vec3';
import { checkAborted, countItem, pickUpDrops, SkillError, walk, type SkillContext } from './context.ts';
import { canReach } from './place.ts';
import { equipBestTool, harvestToolNames } from './tools.ts';

const { goals } = pathfinderPkg;

const SEARCH_RADIUS = 40;

export async function mine(ctx: SkillContext, blockName: string, amount: number) {
  const { bot } = ctx;
  const type = bot.registry.blocksByName[blockName.toLowerCase().replace(/^minecraft:/, '').replace(/\s+/g, '_')];
  if (!type) throw new SkillError(`I don't know any block called "${blockName}".`);

  // progress is what ends up in the inventory, not how many blocks broke: a block broken
  // under water or over a ledge loses its drop, and that one doesn't count
  const drop = type.drops?.[0];
  const dropName = typeof drop === 'number' ? bot.registry.items[drop]?.name : undefined;
  const carried = () => (dropName ? countItem(bot, (n) => n === dropName) : 0);
  const start = carried();
  let broken = 0;
  const mined = () => (dropName ? carried() - start : broken);

  const skipped = new Set<string>();
  // in a normal world almost all the stone is underground: the nearest blocks are buried
  // ones it can't walk to (it never digs a path), so only exposed blocks count. The scan
  // result is kept and only redone when it runs out, since it touches thousands of blocks.
  let targets: Vec3[] = [];
  const usable = (p: Vec3) => !skipped.has(p.toString()) && bot.blockAt(p)?.type === type.id && isExposed(bot, p);
  const nextTarget = () => {
    targets = targets.filter(usable);
    if (!targets.length) {
      targets = exposedBlocks(bot, type.id, (p) => !skipped.has(p.toString()));
    }
    return targets.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))[0];
  };

  while (mined() < amount) {
    checkAborted(ctx);
    if (broken > amount * 3) throw new SkillError(`I broke ${broken} ${type.name} but only got ${mined()} ${dropName}.`);
    const pos = nextTarget();
    if (!pos) {
      if (mined() === 0) throw new SkillError(`I can't see any ${type.name} within ${SEARCH_RADIUS} blocks.`);
      throw new SkillError(`I only found ${mined()} of the ${amount} ${type.name} nearby.`);
    }
    const block = bot.blockAt(pos)!;

    // checked before walking there: no point going to the stone without a pickaxe
    const tools = harvestToolNames(bot, block);
    if (tools && !bot.inventory.items().some((item) => tools.includes(item.name))) {
      throw new SkillError(`I need a ${tools[0]} (or better) to mine ${type.name}.`);
    }

    try {
      await walk(ctx, new goals.GoalLookAtBlock(pos, bot.world), `the ${type.name}`);
    } catch (error) {
      if (!(error instanceof SkillError) || ctx.signal.aborted) throw error;
      skipped.add(pos.toString());
      continue;
    }
    // the pathfinder can call a goal reached from far away (a cave right under its feet
    // counts as "looking at" it); a dig from there only breaks the block on our side and
    // the server puts it back
    if (!canReach(bot.entity.position, pos)) {
      skipped.add(pos.toString());
      continue;
    }
    await equipBestTool(bot, block);
    await bot.dig(block, true);
    await pickUpDrops(ctx, pos);
    broken++;
    if (broken % 8 === 0) ctx.log(`mined ${mined()}/${amount} ${type.name}`);
  }

  const have = dropName ? ` (now I have ${carried()} ${dropName})` : '';
  return `Mined ${mined()} ${type.name}${have}.`;
}

// how far up and down from its feet it looks; deeper than this is a cave it can't walk into
const HEIGHT_RANGE = 10;

/**
 * Exposed blocks of a type around the bot, column by column. mineflayer's findBlocks with
 * an extra check per block went through the whole sphere and froze the bot for minutes
 * (long enough for the server to drop it); this only looks at a slab around its feet.
 */
export function exposedBlocks(bot: Pick<Bot, 'blockAt' | 'entity'>, typeId: number, keep: (pos: Vec3) => boolean, radius = SEARCH_RADIUS) {
  const feet = bot.entity.position.floored();
  const found: Vec3[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (dx * dx + dz * dz > radius * radius) continue;
      for (let dy = -HEIGHT_RANGE; dy <= HEIGHT_RANGE; dy++) {
        const pos = feet.offset(dx, dy, dz);
        if (bot.blockAt(pos)?.type === typeId && keep(pos) && isExposed(bot, pos)) found.push(pos);
      }
    }
  }
  return found;
}

const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

// you can't stand in these to mine, and the drop sinks or burns
const LIQUIDS = new Set(['water', 'lava', 'bubble_column']);

/** True when one of the six faces touches air (or grass, flowers...), so it can be reached on foot. */
export function isExposed(bot: Pick<Bot, 'blockAt'>, pos: Vec3) {
  return SIDES.some(([x, y, z]) => {
    const side = bot.blockAt(pos.offset(x, y, z));
    return !!side && side.boundingBox === 'empty' && !LIQUIDS.has(side.name);
  });
}
