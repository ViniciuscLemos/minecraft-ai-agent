// Getting a patch of ground ready for a house. A normal world almost never has a 9x5 spot
// that is flat and empty (the first survival run got everything else done and then stopped
// right here), so it does what a player does: shave off the bumps and fill the dips.
import pathfinderPkg from 'mineflayer-pathfinder';
import type { Vec3 } from 'vec3';
import { checkAborted, countItem, pickUpDrops, SkillError, walk, type SkillContext } from './context.ts';
import { placeAt } from './place.ts';
import { equipBestTool } from './tools.ts';

const { goals } = pathfinderPkg;

type BlockAt = (pos: Vec3) => { name: string; boundingBox: string } | null | undefined;

export interface SitePlan {
  corner: Vec3;
  /** Blocks to break, top first so sand and gravel don't fall into the gap. */
  cut: Vec3[];
  /** Holes in the floor to fill with dirt. */
  fill: Vec3[];
}

// ground it is fine to dig away, plus low leaves (a bush, or the bottom of a tree's crown:
// in a forest almost every spot had some). A log, a chest or anything else man-made means
// the spot is taken.
const NATURAL = /^(dirt|grass_block|coarse_dirt|podzol|rooted_dirt|stone|andesite|diorite|granite|sand|gravel|clay|.*_leaves)$/;
// from the ground its arm reaches about five blocks up; higher than that it would need to
// climb. Leaves go a bit higher: standing right under them it still gets to the sixth.
const CUT_HEIGHT = 5;
const LEAF_HEIGHT = 7;
// shaving more than this takes longer than walking a bit further for a better spot
const MAX_WORK = 80;
// the farmhouse's chimney top is 8 blocks up
const HEIGHT = 8;
// how far out from the walls the ground has to be flat: the roof's overhang plus a place to stand
const STAND = 2;

/**
 * What it takes to build a width x depth house at `corner`, or undefined when the spot
 * can't be fixed by hand: a tree, water, a hole two blocks deep, or a hill too high to cut.
 */
export function planSite(blockAt: BlockAt, corner: Vec3, width: number, depth: number): SitePlan | undefined {
  const cut: Vec3[] = [];
  const fill: Vec3[] = [];
  // three zones: the house itself needs a floor and empty air; the ring right around it the
  // air for the roof's overhang; and the ring after that is where it stands to reach the
  // roof from outside (see outsideSpot in build.ts), so it needs ground at the same height
  for (let x = -STAND; x < width + STAND; x++) {
    for (let z = -STAND; z < depth + STAND; z++) {
      const ring = Math.max(-x, -z, x - width + 1, z - depth + 1, 0);
      if (ring !== 1) {
        const floor = corner.offset(x, -1, z);
        const below = blockAt(floor);
        if (!below || /water|lava/.test(below.name)) return undefined;
        if (below.boundingBox !== 'block') {
          // one block of dirt is fine, a deeper hole is a pit or a cave
          if (blockAt(floor.offset(0, -1, 0))?.boundingBox !== 'block') return undefined;
          fill.push(floor);
        }
      }
      for (let y = 0; y < (ring === STAND ? 2 : HEIGHT); y++) {
        const pos = corner.offset(x, y, z);
        const block = blockAt(pos);
        if (!block) return undefined;
        if (/water|lava/.test(block.name)) return undefined;
        if (block.boundingBox === 'empty') continue;
        if (y >= (block.name.endsWith('_leaves') ? LEAF_HEIGHT : CUT_HEIGHT) || !NATURAL.test(block.name)) return undefined;
        cut.push(pos);
      }
      // most spots are hopeless, no point counting the rest of them
      if (cut.length + fill.length > MAX_WORK) return undefined;
    }
  }
  cut.sort((a, b) => b.y - a.y);
  return { corner, cut, fill };
}

/** How much work a plan is; a dug block is quick, a filled one means walking and placing. */
export const siteWork = (plan: SitePlan) => plan.cut.length + plan.fill.length * 2;

/** Digs and fills until the plan's ground is flat and empty. */
export async function levelSite(ctx: SkillContext, plan: SitePlan) {
  const { bot } = ctx;
  if (!plan.cut.length && !plan.fill.length) return;
  ctx.log(`levelling the ground: ${plan.cut.length} blocks to dig, ${plan.fill.length} to fill`);
  for (const pos of plan.cut) {
    checkAborted(ctx);
    const block = bot.blockAt(pos);
    if (!block || block.boundingBox === 'empty') continue; // fell or got dug with another one
    await walk(ctx, new goals.GoalLookAtBlock(pos, bot.world), 'the bump in the ground');
    await equipBestTool(bot, block);
    await bot.dig(block, true);
  }
  // the dirt it dug is the dirt it fills with
  if (plan.cut.length) await pickUpDrops(ctx, plan.corner, 12);
  for (const pos of plan.fill) {
    checkAborted(ctx);
    if (bot.blockAt(pos)?.boundingBox === 'block') continue;
    if (!countItem(bot, (n) => n === 'dirt')) throw new SkillError(`I ran out of dirt to flatten the ground.`);
    await placeAt(ctx, 'dirt', pos);
  }
}

// what the ground is made of when looking for its top; leaves and logs sit on top of it
const isGround = (b?: { name: string; boundingBox: string } | null) =>
  !!b && b.boundingBox === 'block' && !/_leaves$|_log$/.test(b.name);

/**
 * The corners worth checking around `feet`, closest house middle first. Each one sits on
 * the ground of its own column (the bot can be up a hill or on a tree stump, so its own
 * height says little), and one block higher, which turns a slope into digging instead of
 * filling.
 */
export function nearbyCorners(blockAt: BlockAt, feet: Vec3, width: number, depth: number, range = 24) {
  const corners: Vec3[] = [];
  for (let dx = -range; dx <= range; dx++) {
    for (let dz = -range; dz <= range; dz++) {
      // the house isn't put on top of the bot, so it doesn't start walled in
      if (dx >= -width - 2 && dx <= 2 && dz >= -depth - 2 && dz <= 2) continue;
      for (let dy = 8; dy >= -8; dy--) {
        const pos = feet.offset(dx, dy, dz);
        if (isGround(blockAt(pos)) && !isGround(blockAt(pos.offset(0, 1, 0)))) {
          corners.push(pos.offset(0, 1, 0), pos.offset(0, 2, 0));
          break;
        }
      }
    }
  }
  const middle = (corner: Vec3) => corner.offset(width / 2, 0, depth / 2);
  return corners.sort((a, b) => middle(a).distanceTo(feet) - middle(b).distanceTo(feet));
}
