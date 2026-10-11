// Chops trees until it has `amount` more logs (of one wood when `type` is given, e.g.
// birch_log for pale walls).
import pathfinderPkg from 'mineflayer-pathfinder';
import type { Block } from 'prismarine-block';
import type { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { checkAborted, countItem, isLog, pickUpDrops, SkillError, sleep, walk, type SkillContext } from './context.ts';
import { equipBestTool } from './tools.ts';

const { goals } = pathfinderPkg;

const SEARCH_RADIUS = 48;
// an odd log lost in the leaves is normal; this many trunks in a row with nothing is not
const EMPTY_TRUNKS = 6;

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
  // trunks in a row that gave nothing: on a long survival run it once chopped birch for 10
  // minutes and picked up none of it, so it stops and says what it sees instead
  let emptyTrunks = 0;
  // every log it has cut, so the one above still counts as trunk (see isBranch)
  const cut = new Set<string>();
  const collect = async () => {
    if (!chopped.length) return;
    const before = got();
    const items = Object.values(bot.entities).filter((e) => e.name === 'item' && e.position.distanceTo(chopped[0]!) < 8).length;
    await pickUpDrops(ctx, chopped[0]!, 6);
    emptyTrunks = got() > before ? 0 : emptyTrunks + 1;
    if (emptyTrunks >= EMPTY_TRUNKS) {
      throw new SkillError(
        `I chopped ${EMPTY_TRUNKS} trees in a row and picked up nothing (items seen around: ${items}, free slots: ${bot.inventory.emptySlotCount()}, open window: ${bot.currentWindow?.type ?? 'none'}).`,
      );
    }
    chopped = [];
  };

  while (got() < amount) {
    checkAborted(ctx);
    const block = nearestLog(ctx, logs, skipped, cut);
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
    cut.add(block.position.toString());
    const trunkDone = !wanted(bot.blockAt(block.position.offset(0, 1, 0))?.name ?? '');
    if (trunkDone || got() + chopped.length >= amount) {
      await collect();
      ctx.log(`chopped ${block.position}, ${got()}/${amount} ${what}`);
    }
  }

  const total = countItem(bot, wanted);
  return `Got ${total - start} ${what} (now I have ${total}).`;
}

/**
 * A log sitting on leaves or air: a branch up in the crown, or what's left of a trunk cut
 * by someone else. Its drop lands on the leaves where the bot can't get it (on the survival run
 * three of those in a row gave nothing at all).
 */
export function isBranch(bot: Pick<Bot, 'blockAt'>, pos: Vec3, cut: Set<string> = new Set()) {
  // the rest of a trunk it is chopping from the bottom up isn't a branch
  if (cut.has(pos.offset(0, -1, 0).toString())) return false;
  const below = bot.blockAt(pos.offset(0, -1, 0));
  return !below || below.boundingBox === 'empty' || below.name.endsWith('_leaves');
}

function nearestLog(ctx: SkillContext, logs: number[], skipped: Set<string>, cut: Set<string>): Block | null {
  const { bot } = ctx;
  const positions = bot.findBlocks({ matching: logs, maxDistance: SEARCH_RADIUS, count: 64 });
  // lowest first among the close ones: the trunk before the logs up in the leaves
  const feet = bot.entity.position.y;
  const score = (pos: (typeof positions)[number]) => pos.distanceTo(bot.entity.position) + Math.max(0, pos.y - feet) * 2;
  const best = positions
    .filter((pos) => !skipped.has(pos.toString()) && !isBranch(bot, pos, cut))
    .sort((a, b) => score(a) - score(b))[0];
  return best ? bot.blockAt(best) : null;
}

/**
 * The kinds of wood growing around (oak, birch...), most common first. A kind with fewer
 * than `minLogs` logs in sight is left out: one small birch gave 6 logs, and the farmhouse
 * walls wanted 8, so the run stopped halfway.
 */
export function woodsNearby(bot: SkillContext['bot'], radius = SEARCH_RADIUS, minLogs = 12) {
  const counts = new Map<string, number>();
  for (const pos of bot.findBlocks({ matching: (b) => isLog(b.name), maxDistance: radius, count: 512 })) {
    const wood = bot.blockAt(pos)!.name.replace(/_log$/, '');
    counts.set(wood, (counts.get(wood) ?? 0) + 1);
  }
  return pickWoods(counts, minLogs);
}

/** The woods with enough logs, most first; the most common one even if none has enough. */
export function pickWoods(counts: Map<string, number>, minLogs: number) {
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const enough = sorted.filter(([, count]) => count >= minLogs);
  return (enough.length ? enough : sorted.slice(0, 1)).map(([wood]) => wood);
}
