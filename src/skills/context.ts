// What every skill gets, plus the small helpers they share.
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import type { Vec3 } from 'vec3';

const { goals } = pathfinderPkg;

/**
 * An expected failure with a reason a person (or the planner) can act on, like
 * "I need a wooden_pickaxe to mine stone". Anything else thrown is a real bug.
 */
export class SkillError extends Error {}

export interface SkillContext {
  bot: Bot;
  // aborted by !stop, so a long skill doesn't keep going after the player gave up on it
  signal: AbortSignal;
  log(text: string): void;
}

export function checkAborted(ctx: SkillContext) {
  if (ctx.signal.aborted) throw new SkillError('Stopped.');
}

export function countItem(bot: Bot, match: (name: string) => boolean) {
  return bot.inventory.items().filter((item) => match(item.name)).reduce((sum, item) => sum + item.count, 0);
}

export const isLog = (name: string) => name.endsWith('_log') && !name.startsWith('stripped_');
export const isPlanks = (name: string) => name.endsWith('_planks');

// longer than any honest walk inside the 40-block area skills search
const WALK_TIMEOUT = 60_000;

/**
 * Walks until the goal is reached, turning "no path" and !stop into SkillErrors. It gives
 * up after `timeoutMs`: the pathfinder can keep finding an empty "partial" path forever (an
 * item in a one-block hole kept it busy for ten minutes, a tree once for forty).
 */
export async function walk(ctx: SkillContext, goal: InstanceType<typeof goals.Goal>, where: string, timeoutMs = WALK_TIMEOUT) {
  checkAborted(ctx);
  const onAbort = () => ctx.bot.pathfinder.stop();
  ctx.signal.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctx.bot.pathfinder.stop();
  }, timeoutMs);
  try {
    for (let attempt = 1; ; attempt++) {
      // right after a teleport or a respawn the chunks around it are still arriving, and
      // with no ground loaded the pathfinder thinks it can't take a single step
      await ctx.bot.waitForChunksToLoad();
      try {
        await ctx.bot.pathfinder.goto(goal);
        // goto sometimes resolves right away without moving (seen right after a dig, going
        // for the logs under a trunk): checked, and one more go if it isn't really there
        if (goal.isEnd(ctx.bot.entity.position.floored() as never) || attempt >= 3) return;
      } catch (error) {
        checkAborted(ctx);
        if (timedOut) throw new SkillError(`It's taking too long to get to ${where}.`);
        const message = (error as Error).message ?? '';
        // "path was stopped" without our own abort: something else (an older task being
        // cancelled) stopped the pathfinder, so it's worth another try
        if (!/no path|timeout|took to long|path was stopped/i.test(message)) throw error;
        if (attempt === 2) throw new SkillError(`I can't find a way to ${where}.`);
        await sleep(1000);
      }
    }
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener('abort', onAbort);
  }
}

export function goNear(ctx: SkillContext, pos: Vec3, range: number) {
  const { x, y, z } = pos.floored();
  return walk(ctx, new goals.GoalNear(x, y, z, range), `${x} ${y} ${z}`);
}

// what piles up while digging and chopping and is never used: the stairs down to the stone
// alone bring back a stack of dirt, and on the survival run a full inventory meant 10
// minutes of chopping birch with nothing picked up
const JUNK = /^(.*_sapling|granite|diorite|andesite|tuff|gravel|flint|wheat_seeds|rotten_flesh)$/;
// some dirt is kept: it fills the dips when levelling the ground for a house
const DIRT_KEPT = 32;

/** Tosses junk when the inventory is nearly full, so the next drops have somewhere to go. */
export async function makeRoom(ctx: SkillContext, free = 3) {
  const { bot } = ctx;
  if (bot.inventory.emptySlotCount() >= free) return;
  let dirt = 0;
  for (const item of bot.inventory.items()) {
    const keep = item.name === 'dirt' ? Math.max(0, Math.min(item.count, DIRT_KEPT - dirt)) : JUNK.test(item.name) ? 0 : item.count;
    if (item.name === 'dirt') dirt += keep;
    if (keep < item.count) await bot.toss(item.type, null, item.count - keep);
  }
  if (bot.inventory.emptySlotCount() === 0) ctx.log('my inventory is full');
}

/** Walks to the items lying around `pos`, so whatever was just broken ends up in the inventory. */
export async function pickUpDrops(ctx: SkillContext, pos: Vec3, radius = 5) {
  await makeRoom(ctx);
  // dropped items can't be picked up for half a second; meanwhile the pathfinder drops
  // whatever it planned before the block broke (right after a dig it can get stuck
  // planning around a world that just changed)
  ctx.bot.pathfinder.setGoal(null);
  await sleep(600);
  // drops that land together merge into one entity that keeps the first one's id, so an
  // item already walked to can still be there with more in it: it gets a few tries
  const tries = new Map<number, number>();
  const findDrop = () =>
    Object.values(ctx.bot.entities).find(
      (entity) => entity.name === 'item' && (tries.get(entity.id) ?? 0) < 3 && entity.position.distanceTo(pos) <= radius && !unwanted(entity),
    );
  // otherwise it walks right back to the junk makeRoom just threw out
  const unwanted = (entity: { getDroppedItem(): { name: string } | null }) => {
    const name = entity.getDroppedItem()?.name ?? '';
    return JUNK.test(name) || (name === 'dirt' && countItem(ctx.bot, (n) => n === 'dirt') >= DIRT_KEPT);
  };
  // on a busy server the item can show up a couple of seconds after the block breaks
  for (let waited = 0; !findDrop() && waited < 2500; waited += 100) await sleep(100);
  if (!findDrop()) {
    // on CI the bot sometimes sees no item entities at all (their spawn packet doesn't
    // always parse), but the server still hands over what it walks through: so, like a
    // player who saw the block break, it steps onto that spot anyway
    const { x, y, z } = pos.floored();
    ctx.log(`no items in sight, walking over to ${x} ${y} ${z} anyway`);
    await walk(ctx, new goals.GoalNear(x, y, z, 1), 'where it broke', 10_000).catch((error) => {
      if (ctx.signal.aborted) throw error;
    });
    await sleep(500);
    return;
  }
  for (;;) {
    const drop = findDrop();
    if (!drop) return;
    const attempt = (tries.get(drop.id) ?? 0) + 1;
    tries.set(drop.id, attempt);
    // next to it is enough the first time (players grab items about a block away), and the
    // exact spot is often under the rest of the trunk; if the item is still there after
    // that, it goes onto the item's own block
    const { x, y, z } = drop.position.floored();
    try {
      await walk(ctx, new goals.GoalNear(x, y, z, attempt === 1 ? 1 : 0), 'the item', 15_000);
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      // an item that fell somewhere unreachable isn't worth failing the whole skill
      ctx.log(`left an item at ${x} ${y} ${z}: ${(error as Error).message}`);
      continue;
    }
    await waitUntilGone(drop.id, ctx);
  }
}

async function waitUntilGone(entityId: number, ctx: SkillContext) {
  for (let waited = 0; waited < 1500 && ctx.bot.entities[entityId]; waited += 100) await sleep(100);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
