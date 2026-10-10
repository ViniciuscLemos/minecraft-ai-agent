// Mining a block type it can see from the surface (stone, coal, dirt...).
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import type { Vec3 } from 'vec3';
import { checkAborted, countItem, pickUpDrops, SkillError, walk, type SkillContext } from './context.ts';
import { canReach } from './place.ts';
import { stepDown } from './stairs.ts';
import { equipBestTool, harvestToolNames } from './tools.ts';

const { goals } = pathfinderPkg;

const SEARCH_RADIUS = 40;
// how deep it digs a staircase looking for buried stone before giving up
const MAX_STAIR_STEPS = 24;
// exposed blocks further than this aren't worth the walk, it digs down instead
const WALK_FOR_STONE = 16;

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
  // once it has given up on walking to far stone, it only takes what it can reach from
  // its own stairs
  let stairsOnly = false;
  const usable = (p: Vec3) =>
    !skipped.has(p.toString()) &&
    bot.blockAt(p)?.type === type.id &&
    isExposed(bot, p) &&
    dropStays(bot, p) &&
    // on the stairs only the walls right next to it: anything further leaves the drop in a
    // hole or a pocket one block high, where it doesn't fit
    (!stairsOnly || touchesBot(bot.entity.position, p));
  const nextTarget = () => {
    targets = targets.filter(usable);
    if (!targets.length) {
      targets = exposedBlocks(bot, type.id, usable, stairsOnly ? 2 : SEARCH_RADIUS);
    }
    const nearest = targets.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))[0];
    // far-off exposed stone is usually a cliff or the bottom of a pit; stairs dug right here
    // get to stone in a few steps and the bot stays near its stuff
    if (nearest && !stairsOnly && nearest.distanceTo(bot.entity.position) > WALK_FOR_STONE) {
      stairsOnly = true;
      return nextTarget();
    }
    return nearest;
  };

  // a staircase can dig into the stone too, so the tool check can't wait for a target
  const neededTools = harvestToolNames(bot, { harvestTools: type.harvestTools } as never);
  if (neededTools && !bot.inventory.items().some((item) => neededTools.includes(item.name))) {
    throw new SkillError(`I need a ${neededTools[0]} (or better) to mine ${type.name}.`);
  }

  let stairSteps = 0;
  let failedWalks = 0;
  let stairDir: Vec3 | undefined;
  while (mined() < amount) {
    checkAborted(ctx);
    if (broken > amount * 3) throw new SkillError(`I broke ${broken} ${type.name} but only got ${mined()} ${dropName}.`);
    const pos = nextTarget();
    if (!pos) {
      // nothing exposed nearby: stone is almost always a few blocks under the grass, so dig
      // down to it like a player would. The walls of the stairs become exposed stone.
      if (stairSteps < MAX_STAIR_STEPS) {
        if (stairSteps === 0) ctx.log(`no ${type.name} in sight, digging stairs down to find some`);
        const before = carried();
        stairDir = await stepDown(ctx, stairDir);
        stairSteps++;
        broken += Math.max(0, carried() - before);
        continue;
      }
      if (mined() === 0) throw new SkillError(`I can't find any ${type.name} within ${SEARCH_RADIUS} blocks or ${MAX_STAIR_STEPS} steps down.`);
      throw new SkillError(`I only found ${mined()} of the ${amount} ${type.name} nearby.`);
    }
    const block = bot.blockAt(pos)!;

    // checked before walking there: no point going to the stone without a pickaxe
    const tools = harvestToolNames(bot, block);
    if (tools && !bot.inventory.items().some((item) => tools.includes(item.name))) {
      throw new SkillError(`I need a ${tools[0]} (or better) to mine ${type.name}.`);
    }

    // stone at the bottom of a pit or up a cliff tends to come in big patches it can't get
    // to; trying them one by one took the whole morning, digging down is quicker
    const giveUpOn = (pos: Vec3) => {
      skipped.add(pos.toString());
      if (++failedWalks >= 3 && !stairsOnly) {
        stairsOnly = true;
        targets = [];
        ctx.log(`can't get to the ${type.name} I see, digging my own way down instead`);
      }
    };
    try {
      await walk(ctx, new goals.GoalLookAtBlock(pos, bot.world), `the ${type.name}`);
    } catch (error) {
      if (!(error instanceof SkillError) || ctx.signal.aborted) throw error;
      giveUpOn(pos);
      continue;
    }
    // the pathfinder can call a goal reached from far away (a cave right under its feet
    // counts as "looking at" it); a dig from there only breaks the block on our side and
    // the server puts it back
    // and a block deeper than the step below its feet drops into a hole it can't climb into
    if (!canReach(bot.entity.position, pos) || pos.y < Math.floor(bot.entity.position.y) - 1) {
      giveUpOn(pos);
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

/** True when one of the six faces touches air (or grass, flowers...) and none touches a liquid, so it can be mined on foot. */
export function isExposed(bot: Pick<Bot, 'blockAt'>, pos: Vec3) {
  return SIDES.some(([x, y, z]) => {
    const side = bot.blockAt(pos.offset(x, y, z));
    return !!side && side.boundingBox === 'empty' && !LIQUIDS.has(side.name);
  }) && !touchesLiquid(bot, pos);
}

// breaking a block next to water or lava lets it pour in where the bot is standing
function touchesLiquid(bot: Pick<Bot, 'blockAt'>, pos: Vec3) {
  return SIDES.some(([x, y, z]) => LIQUIDS.has(bot.blockAt(pos.offset(x, y, z))?.name ?? ''));
}

/**
 * Whether the drop stays where the block was. With a cave or a pit under it the item falls
 * out of reach: on the first normal-world run every stone it broke went down a hole.
 */
export function dropStays(bot: Pick<Bot, 'blockAt'>, pos: Vec3) {
  return bot.blockAt(pos.offset(0, -1, 0))?.boundingBox === 'block';
}

/** Whether the block is beside the two blocks a player at `feet` takes up (feet and head). */
export function touchesBot(feet: Vec3, pos: Vec3) {
  const { x, y, z } = feet.floored();
  return (pos.y === y || pos.y === y + 1) && Math.abs(pos.x - x) + Math.abs(pos.z - z) === 1;
}
