// Building from a blueprint: a list of block positions, placed in an order that always
// has something to place against (bottom up, and the roof from the edges to the middle).
import { Vec3 } from 'vec3';
import { checkAborted, countItem, isPlanks, SkillError, walk, type SkillContext } from './context.ts';
import { plankFor } from './craft.ts';
import { placeAt } from './place.ts';
import pathfinderPkg from 'mineflayer-pathfinder';

const { goals } = pathfinderPkg;

export interface Blueprint {
  name: string;
  width: number; // x
  depth: number; // z
  // offsets from the corner with the smallest x and z, at ground level (y = 0 is the first layer)
  blocks: Vec3[];
}

/** A small house: walls 3 high with a door gap in the front, and a flat roof. */
export function house(width = 5, depth = 5, wallHeight = 3, name = 'house'): Blueprint {
  const blocks: Vec3[] = [];
  const doorX = Math.floor(width / 2);
  for (let y = 0; y < wallHeight; y++) {
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        const edge = x === 0 || z === 0 || x === width - 1 || z === depth - 1;
        const door = z === 0 && x === doorX && y < 2;
        if (edge && !door) blocks.push(new Vec3(x, y, z));
      }
    }
  }
  const center = new Vec3((width - 1) / 2, wallHeight, (depth - 1) / 2);
  const roof: Vec3[] = [];
  for (let x = 0; x < width; x++) for (let z = 0; z < depth; z++) roof.push(new Vec3(x, wallHeight, z));
  roof.sort((a, b) => ringOf(b, center) - ringOf(a, center));
  return { name, width, depth, blocks: [...blocks, ...roof] };
}

// how far from the middle, counted in rings, so the outer ring of the roof goes first
function ringOf(pos: Vec3, center: Vec3) {
  return Math.max(Math.abs(pos.x - center.x), Math.abs(pos.z - center.z));
}

export const BLUEPRINTS: Record<string, () => Blueprint> = {
  house: () => house(),
  hut: () => house(4, 4, 2, 'hut'),
};

export async function build(ctx: SkillContext, name: string, origin?: Vec3) {
  const { bot } = ctx;
  const make = BLUEPRINTS[name.toLowerCase()];
  if (!make) throw new SkillError(`I don't know how to build a "${name}". I can build: ${Object.keys(BLUEPRINTS).join(', ')}.`);
  const blueprint = make();

  const material = plankFor(bot);
  const have = countItem(bot, isPlanks);
  const need = blueprint.blocks.length;
  const corner = origin?.floored() ?? findSpot(ctx, blueprint);
  const todo = blueprint.blocks.map((offset) => corner.plus(offset)).filter((pos) => bot.blockAt(pos)?.name !== material);
  if (have < todo.length) {
    throw new SkillError(`A ${blueprint.name} takes ${need} planks and I have ${have}. I need ${todo.length - have} more.`);
  }

  ctx.log(`building a ${blueprint.name} at ${corner} with ${material}`);
  for (const pos of todo) {
    checkAborted(ctx);
    await stepOutOf(ctx, pos, corner, blueprint);
    // any kind of planks works, so it uses whichever it has left
    const plank = bot.inventory.items().find((item) => isPlanks(item.name));
    if (!plank) throw new SkillError('I ran out of planks halfway through.');
    await placeAt(ctx, plank.name, pos);
  }
  return `Built a ${blueprint.name} at ${corner.x} ${corner.y} ${corner.z}.`;
}

/** The closest flat, empty ground around the bot, searching outwards ring by ring. */
function findSpot(ctx: SkillContext, blueprint: Blueprint): Vec3 {
  const feet = ctx.bot.entity.position.floored();
  // corners that keep the bot just outside the house, so it doesn't start walled in
  const offsets: Vec3[] = [];
  for (let dx = -12; dx <= 12; dx++) {
    for (let dz = -12; dz <= 12; dz++) {
      for (const dy of [0, 1, -1]) offsets.push(new Vec3(dx, dy, dz));
    }
  }
  const middle = (corner: Vec3) => corner.offset(blueprint.width / 2, 0, blueprint.depth / 2);
  const candidates = offsets
    .map((offset) => feet.plus(offset))
    .filter((corner) => !contains(corner, blueprint, feet))
    .sort((a, b) => middle(a).distanceTo(feet) - middle(b).distanceTo(feet));
  const spot = candidates.find((corner) => isBuildable(ctx, corner, blueprint));
  if (!spot) throw new SkillError(`There's no flat, clear ${blueprint.width}x${blueprint.depth} area near me.`);
  return spot;
}

function contains(corner: Vec3, blueprint: Blueprint, pos: Vec3) {
  return pos.x >= corner.x && pos.x < corner.x + blueprint.width && pos.z >= corner.z && pos.z < corner.z + blueprint.depth;
}

function isBuildable(ctx: SkillContext, corner: Vec3, blueprint: Blueprint) {
  for (let x = 0; x < blueprint.width; x++) {
    for (let z = 0; z < blueprint.depth; z++) {
      const ground = ctx.bot.blockAt(corner.offset(x, -1, z));
      if (ground?.boundingBox !== 'block') return false;
      for (let y = 0; y < 4; y++) {
        if (ctx.bot.blockAt(corner.offset(x, y, z))?.boundingBox !== 'empty') return false;
      }
    }
  }
  return true;
}

/**
 * Before placing a block it stands just outside the house, on the side of that block,
 * so it never walls itself in or stands where the block has to go.
 */
async function stepOutOf(ctx: SkillContext, pos: Vec3, corner: Vec3, blueprint: Blueprint) {
  const { bot } = ctx;
  const feet = bot.entity.position.floored();
  const center = pos.offset(0.5, 0.5, 0.5);
  const close = bot.entity.position.distanceTo(center) <= 4.5;
  // right next to the spot its hitbox can be in the way of the block
  const touching = Math.hypot(bot.entity.position.x - center.x, bot.entity.position.z - center.z) < 1.5;
  if (!contains(corner, blueprint, feet) && close && !touching) return;

  const target = outsideSpot(pos, corner, blueprint);
  await walk(ctx, new goals.GoalBlock(target.x, target.y, target.z), 'the side of the house');
}

/**
 * The ground spot outside the wall that is closest to `pos`. Two blocks out, not one:
 * standing right against the wall, its hitbox can touch the spot and the server
 * refuses the block.
 */
export function outsideSpot(pos: Vec3, corner: Vec3, blueprint: Blueprint) {
  const { width, depth } = blueprint;
  const GAP = 2;
  const clampX = Math.min(Math.max(pos.x, corner.x), corner.x + width - 1);
  const clampZ = Math.min(Math.max(pos.z, corner.z), corner.z + depth - 1);
  const sides = [
    { gap: pos.x - corner.x, spot: new Vec3(corner.x - GAP, corner.y, clampZ) },
    { gap: corner.x + width - 1 - pos.x, spot: new Vec3(corner.x + width - 1 + GAP, corner.y, clampZ) },
    { gap: pos.z - corner.z, spot: new Vec3(clampX, corner.y, corner.z - GAP) },
    { gap: corner.z + depth - 1 - pos.z, spot: new Vec3(clampX, corner.y, corner.z + depth - 1 + GAP) },
  ];
  return sides.sort((a, b) => a.gap - b.gap)[0]!.spot;
}
