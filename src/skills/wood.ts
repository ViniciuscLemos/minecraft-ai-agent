// Chops trees until it has `amount` more logs.
import pathfinderPkg from 'mineflayer-pathfinder';
import type { Block } from 'prismarine-block';
import { checkAborted, countItem, isLog, pickUpDrops, SkillError, walk, type SkillContext } from './context.ts';
import { equipBestTool } from './tools.ts';

const { goals } = pathfinderPkg;

const SEARCH_RADIUS = 48;

export async function collectWood(ctx: SkillContext, amount: number) {
  const { bot } = ctx;
  const logs = bot.registry.blocksArray.filter((block) => isLog(block.name)).map((block) => block.id);
  const start = countItem(bot, isLog);
  // logs it couldn't reach (too high, behind water...), skipped on the next searches
  const skipped = new Set<string>();

  while (countItem(bot, isLog) - start < amount) {
    checkAborted(ctx);
    const block = nearestLog(ctx, logs, skipped);
    if (!block) {
      const got = countItem(bot, isLog) - start;
      if (got === 0) throw new SkillError(`There are no trees I can reach within ${SEARCH_RADIUS} blocks.`);
      throw new SkillError(`I only found ${got} of the ${amount} logs I needed nearby.`);
    }

    try {
      // a spot where the log is within arm's reach, so it can chop the trunk from the ground
      await walk(ctx, new goals.GoalLookAtBlock(block.position, bot.world), 'that tree');
    } catch (error) {
      if (!(error instanceof SkillError) || ctx.signal.aborted) throw error;
      ctx.log(`skipping the log at ${block.position}: ${error.message}`);
      skipped.add(block.position.toString());
      continue;
    }

    await equipBestTool(bot, block);
    await bot.dig(block, true);
    await pickUpDrops(ctx, block.position);
    ctx.log(`chopped the log at ${block.position}, ${countItem(bot, isLog) - start}/${amount}`);
  }

  const total = countItem(bot, isLog);
  return `Got ${total - start} logs (now I have ${total}).`;
}

function nearestLog(ctx: SkillContext, logs: number[], skipped: Set<string>): Block | null {
  const { bot } = ctx;
  const positions = bot.findBlocks({ matching: logs, maxDistance: SEARCH_RADIUS, count: 64 });
  // lowest first among the close ones: the trunk before the logs up in the leaves
  const feet = bot.entity.position.y;
  const score = (pos: (typeof positions)[number]) => pos.distanceTo(bot.entity.position) + Math.max(0, pos.y - feet) * 2;
  const best = positions.filter((pos) => !skipped.has(pos.toString())).sort((a, b) => score(a) - score(b))[0];
  return best ? bot.blockAt(best) : null;
}
