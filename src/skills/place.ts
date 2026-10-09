// Putting a block down, next to the bot or at an exact spot.
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { checkAborted, countItem, goNear, SkillError, sleep, type SkillContext } from './context.ts';

const UP = new Vec3(0, 1, 0);

// the six neighbours, the block below first: it's the one that is almost always there
const FACES = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), UP];

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

/** Places `itemName` exactly at `pos`, against any solid neighbour. */
export async function placeAt(ctx: SkillContext, itemName: string, pos: Vec3): Promise<Block> {
  const { bot } = ctx;
  checkAborted(ctx);
  const item = bot.inventory.items().find((it) => it.name === itemName);
  if (!item) throw new SkillError(`I don't have any ${itemName}.`);

  const existing = bot.blockAt(pos);
  if (existing?.name === itemName) return existing;
  if (!isFree(ctx, pos)) throw new SkillError(`Something is already at ${pos.x} ${pos.y} ${pos.z}.`);

  const face = FACES.find((dir) => bot.blockAt(pos.plus(dir))?.boundingBox === 'block');
  if (!face) throw new SkillError(`Nothing to put the ${itemName} against at ${pos.x} ${pos.y} ${pos.z}.`);
  const reference = bot.blockAt(pos.plus(face))!;

  if (bot.entity.position.distanceTo(pos.offset(0.5, 0.5, 0.5)) > 4.5) await goNear(ctx, pos, 3);
  for (let attempt = 1; ; attempt++) {
    // looked up again on every try: the stack in hand may have run out in the meantime
    const stack = bot.inventory.items().find((it) => it.name === itemName);
    if (!stack) throw new SkillError(`I ran out of ${itemName}.`);
    await bot.equip(stack, 'hand');
    try {
      await bot.placeBlock(reference, face.scaled(-1));
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
  if (placed.name !== itemName) throw new SkillError(`The ${itemName} didn't stay at ${pos.x} ${pos.y} ${pos.z}.`);
  return placed;
}

async function becomes(ctx: SkillContext, pos: Vec3, name: string) {
  for (let waited = 0; waited < 1500; waited += 100) {
    if (ctx.bot.blockAt(pos)?.name === name) return true;
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
