// Putting a block down, next to the bot or at an exact spot.
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { checkAborted, countItem, goNear, SkillError, sleep, type SkillContext } from './context.ts';

const UP = new Vec3(0, 1, 0);

export type Facing = 'north' | 'south' | 'east' | 'west';

// mineflayer's yaw for looking each way (0 is north, counter-clockwise)
const YAW: Record<Facing, number> = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 };

// how far a survival player can reach, with a little margin under what the server allows
const REACH = 4.8;

/** Whether a player with feet at `feet` can reach the block at `pos` (eye to the block's box). */
export function canReach(feet: Vec3, pos: Vec3) {
  const eye = feet.offset(0, 1.62, 0);
  const clamp = (v: number, min: number) => Math.min(Math.max(v, min), min + 1);
  const closest = new Vec3(clamp(eye.x, pos.x), clamp(eye.y, pos.y), clamp(eye.z, pos.z));
  return eye.distanceTo(closest) <= REACH;
}

// the six neighbours, the block below first: it's the one that is almost always there
const FACES = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), UP];

/** The block names an item becomes once placed (a torch on a wall is a wall_torch). */
export function blockNames(itemName: string): string[] {
  if (itemName.endsWith('torch')) return [itemName, itemName.replace(/torch$/, 'wall_torch')];
  return [itemName];
}

/** Places one `itemName` on the ground next to the bot and returns the new block. */
export async function placeNear(ctx: SkillContext, itemName: string): Promise<Block> {
  const { bot } = ctx;
  const feet = bot.entity.position.floored();
  const spots: Vec3[] = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) + Math.abs(dz) < 2) continue; // not where it stands, so it doesn't box itself in
      for (const dy of [0, -1, 1]) spots.push(feet.offset(dx, dy, dz));
    }
  }
  spots.sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet));

  for (const spot of spots) {
    const below = bot.blockAt(spot.offset(0, -1, 0));
    if (isFree(ctx, spot) && below && below.boundingBox === 'block') {
      return placeAt(ctx, itemName, spot);
    }
  }
  throw new SkillError(`There's no free spot around me to put the ${itemName}.`);
}

/**
 * Places `itemName` exactly at `pos`, against any solid neighbour. Stairs and doors take
 * the direction the player is looking, so with `facing` it looks that way first.
 */
export async function placeAt(ctx: SkillContext, itemName: string, pos: Vec3, facing?: Facing): Promise<Block> {
  const { bot } = ctx;
  checkAborted(ctx);
  const item = bot.inventory.items().find((it) => it.name === itemName);
  if (!item) throw new SkillError(`I don't have any ${itemName}.`);

  const existing = bot.blockAt(pos);
  if (existing && blockNames(itemName).includes(existing.name)) return existing;
  if (!isFree(ctx, pos)) throw new SkillError(`Something is already at ${pos.x} ${pos.y} ${pos.z}.`);

  const face = FACES.find((dir) => bot.blockAt(pos.plus(dir))?.boundingBox === 'block');
  if (!face) throw new SkillError(`Nothing to put the ${itemName} against at ${pos.x} ${pos.y} ${pos.z}.`);
  const reference = bot.blockAt(pos.plus(face))!;

  if (!canReach(bot.entity.position, pos)) await goNear(ctx, pos, 3);
  // flowers, grass and the like have no hitbox but the server won't place over most of
  // them (a dandelion isn't replaceable), so they get broken first
  const plant = bot.blockAt(pos);
  if (plant && plant.boundingBox === 'empty' && !/(^|_)air$/.test(plant.name) && !/water|lava/.test(plant.name)) {
    await bot.dig(plant, true);
  }
  for (let attempt = 1; ; attempt++) {
    // looked up again on every try: the stack in hand may have run out in the meantime
    const stack = bot.inventory.items().find((it) => it.name === itemName);
    if (!stack) throw new SkillError(`I ran out of ${itemName}.`);
    await bot.equip(stack, 'hand');
    try {
      if (facing) {
        // look the right way, then place without turning to the block (that would change it)
        const target = pos.offset(0.5, 0.5, 0.5);
        const eye = bot.entity.position.offset(0, 1.62, 0);
        const pitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
        await bot.look(YAW[facing], pitch, true);
        await sleep(100); // the new rotation has to reach the server before the click
        // clicking low on a side face keeps stairs right side up
        await (bot as unknown as PlaceWithOptions)._placeBlockWithOptions(reference, face.scaled(-1), {
          forceLook: 'ignore',
          half: 'bottom',
          swingArm: 'right',
        });
      } else {
        await bot.placeBlock(reference, face.scaled(-1));
      }
    } catch (error) {
      // with a busy server the block update can come after mineflayer stops waiting,
      // so it only counts as a failure if the block still isn't there a moment later
      if (!(await becomes(ctx, pos, itemName))) {
        if (attempt === 2) throw new SkillError(`I couldn't place the ${itemName}: ${(error as Error).message}`);
        ctx.log(`placing at ${pos} was refused, trying again`);
        await sleep(500);
        continue;
      }
    }
    break;
  }
  const placed = bot.blockAt(pos)!;
  if (!blockNames(itemName).includes(placed.name)) {
    throw new SkillError(`The ${itemName} didn't stay at ${pos.x} ${pos.y} ${pos.z}.`);
  }
  return placed;
}

async function becomes(ctx: SkillContext, pos: Vec3, name: string) {
  for (let waited = 0; waited < 1500; waited += 100) {
    if (blockNames(name).includes(ctx.bot.blockAt(pos)?.name ?? '')) return true;
    await sleep(100);
  }
  return false;
}

/** Air (or grass and the like) with no player or mob standing in it. */
function isFree(ctx: SkillContext, pos: Vec3) {
  const block = ctx.bot.blockAt(pos);
  if (!block || block.boundingBox !== 'empty') return false;
  return !Object.values(ctx.bot.entities).some((entity) => {
    if (entity.name === 'item' || entity.name === 'experience_orb') return false;
    // the hitbox, not just the block the feet are in: a player standing near the edge of
    // a block already overlaps the next one, and the server refuses a block there
    const half = (entity.width ?? 0.6) / 2;
    const { x, y, z } = entity.position;
    return (
      x + half > pos.x && x - half < pos.x + 1 &&
      z + half > pos.z && z - half < pos.z + 1 &&
      y + (entity.height ?? 1.8) > pos.y && y < pos.y + 1
    );
  });
}

export function haveBlocks(ctx: SkillContext, itemName: string) {
  return countItem(ctx.bot, (n) => n === itemName);
}

// mineflayer has this but doesn't export its type
interface PlaceWithOptions {
  _placeBlockWithOptions(reference: Block, face: Vec3, options: { forceLook: 'ignore'; half: 'bottom'; swingArm: 'right' }): Promise<void>;
}
