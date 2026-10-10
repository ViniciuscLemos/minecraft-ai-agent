// Chops trees until it has `amount` more logs (of one wood when `type` is given, e.g.
// birch_log for pale walls).
import pathfinderPkg from 'mineflayer-pathfinder';
import type { Block } from 'prismarine-block';
import type { Vec3 } from 'vec3';
import { checkAborted, countItem, isLog, pickUpDrops, SkillError, sleep, walk, type SkillContext } from './context.ts';
import { equipBestTool } from './tools.ts';

const { goals } = pathfinderPkg;

const SEARCH_RADIUS = 48;

export async function collectWood(ctx: SkillContext, amount: number, type?: string) {
  const { bot } = ctx;
  if (type && !isLog(type)) throw new SkillError(`"${type}" is not a log. Try oak_log, birch_log, spruce_log...`);
  const wanted = (name: string) => (type ? name === type : isLog(name));
  const logs = bot.registry.blocksArray.filter((block) => wanted(block.name)).map((block) => block.id);
  const start = countItem(bot, wanted);
  const got = () => countItem(bot, wanted) - start;
  const what = type ?? 'logs';
  // logs it couldn't reach (too high, behind water...), skipped on the next searches
  const skipped = new Set<string>();
  // chopped but not picked up yet: like a player, it cuts the whole trunk first and
  // then picks everything up, because each log falls under the rest of the tree
  let chopped: Vec3[] = [];
  const collect = async () => {
    if (!chopped.length) return;
    await pickUpDrops(ctx, chopped[0]!, 6);
    chopped = [];
  };

  while (got() < amount) {
    checkAborted(ctx);
    const block = nearestLog(ctx, logs, skipped);
    if (!block) {
      if (chopped.length) {
        await collect();
        continue;
      }
      if (got() === 0) throw new SkillError(`There are no ${type ? type.replace('_log', ' trees') : 'trees'} I can reach within ${SEARCH_RADIUS} blocks.`);
      throw new SkillError(`I only found ${got()} of the ${amount} ${what} I needed nearby.`);
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
    // leaves and the logs above update right after a cut; a moment later the
    // pathfinder sees the tree as it is now
    bot.pathfinder.setGoal(null);
    await sleep(300);
    chopped.push(block.position);
    const trunkDone = !wanted(bot.blockAt(block.position.offset(0, 1, 0))?.name ?? '');
    if (trunkDone || got() + chopped.length >= amount) {
      await collect();
      ctx.log(`chopped ${block.position}, ${got()}/${amount} ${what}`);
    }
  }

  const total = countItem(bot, wanted);
  return `Got ${total - start} ${what} (now I have ${total}).`;
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

/** The kinds of wood growing around (oak, birch...), most common first. */
export function woodsNearby(bot: SkillContext['bot'], radius = SEARCH_RADIUS) {
  const counts = new Map<string, number>();
  for (const pos of bot.findBlocks({ matching: (b) => isLog(b.name), maxDistance: radius, count: 512 })) {
    const wood = bot.blockAt(pos)!.name.replace(/_log$/, '');
    counts.set(wood, (counts.get(wood) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([wood]) => wood);
}
