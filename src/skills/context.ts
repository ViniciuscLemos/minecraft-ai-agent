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

/** Walks until the goal is reached, turning "no path" and !stop into SkillErrors. */
export async function walk(ctx: SkillContext, goal: InstanceType<typeof goals.Goal>, where: string) {
  checkAborted(ctx);
  const onAbort = () => ctx.bot.pathfinder.stop();
  ctx.signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (let attempt = 1; ; attempt++) {
      // right after a teleport or a respawn the chunks around it are still arriving, and
      // with no ground loaded the pathfinder thinks it can't take a single step
      await ctx.bot.waitForChunksToLoad();
      try {
        await ctx.bot.pathfinder.goto(goal);
        return;
      } catch (error) {
        checkAborted(ctx);
        const message = (error as Error).message ?? '';
        if (!/no path|timeout|took to long/i.test(message)) throw error;
        if (attempt === 2) throw new SkillError(`I can't find a way to ${where}.`);
        await sleep(1000);
      }
    }
  } finally {
    ctx.signal.removeEventListener('abort', onAbort);
  }
}

export function goNear(ctx: SkillContext, pos: Vec3, range: number) {
  const { x, y, z } = pos.floored();
  return walk(ctx, new goals.GoalNear(x, y, z, range), `${x} ${y} ${z}`);
}

/** Walks to the items lying around `pos`, so whatever was just broken ends up in the inventory. */
export async function pickUpDrops(ctx: SkillContext, pos: Vec3, radius = 5) {
  // dropped items can't be picked up for half a second
  await sleep(600);
  const tried = new Set<number>();
  for (;;) {
    const drop = Object.values(ctx.bot.entities).find(
      (entity) => entity.name === 'item' && !tried.has(entity.id) && entity.position.distanceTo(pos) <= radius,
    );
    if (!drop) return;
    tried.add(drop.id);
    // next to it is enough (players grab items about a block away), and the exact spot is
    // often under the rest of the trunk, where the bot doesn't fit
    const { x, y, z } = drop.position.floored();
    try {
      await walk(ctx, new goals.GoalNear(x, y, z, 1), 'the item');
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
