// Mining a block type it can see from the surface (stone, coal, dirt...).
import pathfinderPkg from 'mineflayer-pathfinder';
import { checkAborted, countItem, pickUpDrops, SkillError, walk, type SkillContext } from './context.ts';
import { equipBestTool, harvestToolNames } from './tools.ts';

const { goals } = pathfinderPkg;

const SEARCH_RADIUS = 32;

export async function mine(ctx: SkillContext, blockName: string, amount: number) {
  const { bot } = ctx;
  const type = bot.registry.blocksByName[blockName.toLowerCase().replace(/^minecraft:/, '').replace(/\s+/g, '_')];
  if (!type) throw new SkillError(`I don't know any block called "${blockName}".`);

  let mined = 0;
  const skipped = new Set<string>();
  while (mined < amount) {
    checkAborted(ctx);
    const pos = bot
      .findBlocks({ matching: type.id, maxDistance: SEARCH_RADIUS, count: 32 })
      .filter((p) => !skipped.has(p.toString()))
      .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))[0];
    if (!pos) {
      if (mined === 0) throw new SkillError(`I can't see any ${type.name} within ${SEARCH_RADIUS} blocks.`);
      throw new SkillError(`I only found ${mined} of the ${amount} ${type.name} nearby.`);
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
    await equipBestTool(bot, block);
    await bot.dig(block, true);
    await pickUpDrops(ctx, pos);
    mined++;
  }

  const drop = bot.registry.blocksByName[type.name]!.drops?.[0];
  const dropName = typeof drop === 'number' ? bot.registry.items[drop]?.name : undefined;
  const have = dropName ? ` (now I have ${countItem(bot, (n) => n === dropName)} ${dropName})` : '';
  return `Mined ${mined} ${type.name}${have}.`;
}
