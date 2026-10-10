// Digging a staircase down from the surface, the way a player gets to stone when none is
// lying around: one step forward and one down at a time, never the block under its feet.
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { checkAborted, pickUpDrops, SkillError, walk, type SkillContext } from './context.ts';
import { equipBestTool } from './tools.ts';

const { goals } = pathfinderPkg;

type World = Pick<Bot, 'blockAt'>;

export const DIRECTIONS = [new Vec3(1, 0, 0), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(0, 0, -1)];

const LIQUIDS = new Set(['water', 'lava', 'bubble_column']);
// these fall into the hole when the block under them goes; it digs them again as they land
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|.*_concrete_powder)$/;
// bedrock and friends: a staircase can't go through them
const UNBREAKABLE = new Set(['bedrock', 'barrier', 'end_portal_frame', 'reinforced_deepslate']);

const MAX_DROP = 2;

export type StairStep =
  | { ok: true; dig: Vec3[]; stand: Vec3 }
  | { ok: false; reason: string };

/**
 * What one step down in direction `dir` takes from `feet`: the three blocks in front to
 * clear (head height, where the head goes, where the feet go) and the spot to stand on.
 * Going down a slope it can land a couple of blocks lower.
 * Refuses a step that opens onto a liquid or has no floor, so it never floods the
 * stairs, drops into a cave or swims in lava.
 */
export function planStep(world: World, feet: Vec3, dir: Vec3): StairStep {
  const front = feet.plus(dir);
  // on a hillside the ground ahead is already lower: it lands on the first floor within a
  // safe drop (three blocks don't hurt) instead of calling it a cliff
  let stand = front.offset(0, -1, 0);
  for (let drop = 0; drop < MAX_DROP && world.blockAt(stand.offset(0, -1, 0))?.boundingBox === 'empty' && !LIQUIDS.has(world.blockAt(stand.offset(0, -1, 0))!.name); drop++) {
    stand = stand.offset(0, -1, 0);
  }
  const column = [front.offset(0, 1, 0), front];
  for (let y = front.y - 1; y >= stand.y; y--) column.push(new Vec3(front.x, y, front.z));

  for (const pos of column) {
    const block = world.blockAt(pos);
    if (!block) return { ok: false, reason: 'that part of the world is not loaded' };
    if (LIQUIDS.has(block.name)) return { ok: false, reason: `there is ${block.name} in the way` };
    if (UNBREAKABLE.has(block.name)) return { ok: false, reason: `${block.name} is in the way` };
    // every face of the new hole that isn't another block of the hole or the way back
    for (const side of [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)]) {
      const next = world.blockAt(pos.plus(side));
      if (next && LIQUIDS.has(next.name)) return { ok: false, reason: `${next.name} would flood the stairs` };
    }
  }

  const floor = world.blockAt(stand.offset(0, -1, 0));
  if (!floor || floor.boundingBox !== 'block') return { ok: false, reason: 'there is no floor under the next step' };
  if (FALLING.test(floor.name)) return { ok: false, reason: `the floor is ${floor.name}, it could give way` };

  const dig = column.filter((pos) => world.blockAt(pos)!.boundingBox !== 'empty');
  return { ok: true, dig, stand };
}

/** The first direction from `feet` where a step down is possible, trying `preferred` first. */
export function chooseDirection(world: World, feet: Vec3, preferred?: Vec3) {
  const order = preferred ? [preferred, ...DIRECTIONS.filter((d) => !d.equals(preferred))] : DIRECTIONS;
  const reasons: string[] = [];
  for (const dir of order) {
    const step = planStep(world, feet, dir);
    if (step.ok) return { dir, step };
    reasons.push(step.reason);
  }
  return { dir: null, reasons };
}

/**
 * Takes one step down the staircase (digging what's in the way) and returns the direction
 * it went, so the next call keeps going the same way. Throws when every way down is unsafe.
 */
export async function stepDown(ctx: SkillContext, preferred?: Vec3) {
  const { bot } = ctx;
  checkAborted(ctx);
  const feet = bot.entity.position.floored();
  const choice = chooseDirection(bot, feet, preferred);
  if (!choice.dir) throw new SkillError(`I can't dig down from here: ${[...new Set(choice.reasons)].join('; ')}.`);

  const { step } = choice;
  // top to bottom, and again if sand or gravel slid into the gap
  for (let pass = 0; pass < 8; pass++) {
    const left = step.dig.filter((pos) => bot.blockAt(pos)?.boundingBox !== 'empty');
    if (!left.length) break;
    for (const pos of left) {
      const block = bot.blockAt(pos)!;
      if (block.boundingBox === 'empty') continue;
      await equipBestTool(bot, block);
      await bot.dig(block, true);
    }
  }
  if (step.dig.some((pos) => bot.blockAt(pos)?.boundingBox !== 'empty')) {
    throw new SkillError("sand or gravel keeps falling into the stairs, I can't clear the way.");
  }

  await walk(ctx, new goals.GoalBlock(step.stand.x, step.stand.y, step.stand.z), 'the next step');
  // most of what it dug fell onto the step it's standing on, the rest is a block away
  await pickUpDrops(ctx, step.stand, 3);
  return choice.dir;
}
