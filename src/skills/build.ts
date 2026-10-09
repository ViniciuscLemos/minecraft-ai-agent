// Building from a blueprint: a list of blocks (with a direction for stairs and doors),
// placed in an order where each one always has something to be placed against.
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { checkAborted, countItem, isLog, isPlanks, SkillError, walk, type SkillContext } from './context.ts';
import { canReach, placeAt, type Facing } from './place.ts';

const { goals } = pathfinderPkg;

// "planks" and "log" accept any wood; anything else is an exact item name
export type Material = 'planks' | 'log' | 'oak_stairs' | 'oak_door' | 'glass_pane';

export interface BlueprintBlock {
  // offset from the corner with the smallest x and z, at ground level (y = 0 is the first layer)
  at: Vec3;
  material: Material;
  facing?: Facing;
}

export interface Blueprint {
  name: string;
  width: number; // x
  depth: number; // z
  blocks: BlueprintBlock[];
}

/** A plain box: walls with a door gap in the front and a flat roof. */
export function house(width = 5, depth = 5, wallHeight = 3, name = 'house'): Blueprint {
  const blocks: BlueprintBlock[] = [];
  const doorX = Math.floor(width / 2);
  for (let y = 0; y < wallHeight; y++) {
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        const edge = x === 0 || z === 0 || x === width - 1 || z === depth - 1;
        const door = z === 0 && x === doorX && y < 2;
        if (edge && !door) blocks.push({ at: new Vec3(x, y, z), material: 'planks' });
      }
    }
  }
  const center = new Vec3((width - 1) / 2, wallHeight, (depth - 1) / 2);
  const roof: Vec3[] = [];
  for (let x = 0; x < width; x++) for (let z = 0; z < depth; z++) roof.push(new Vec3(x, wallHeight, z));
  roof.sort((a, b) => ringOf(b, center) - ringOf(a, center));
  return { name, width, depth, blocks: [...blocks, ...roof.map((at) => ({ at, material: 'planks' as const }))] };
}

// how far from the middle, counted in rings, so the outer ring of the roof goes first
function ringOf(pos: Vec3, center: Vec3) {
  return Math.max(Math.abs(pos.x - center.x), Math.abs(pos.z - center.z));
}

/**
 * A cottage: log pillars and a log beam around the top, plank walls with glass windows,
 * a door, and a pitched roof of stairs that overhangs the walls on every side.
 */
export function cottage(width = 7, depth = 5): Blueprint {
  const blocks: BlueprintBlock[] = [];
  const add = (x: number, y: number, z: number, material: Material, facing?: Facing) =>
    blocks.push({ at: new Vec3(x, y, z), material, facing });
  const doorX = Math.floor(width / 2);
  const ridgeZ = Math.floor(depth / 2);
  const windows = new Set([`1,0`, `${width - 2},0`, `2,${depth - 1}`, `${width - 3},${depth - 1}`, `0,${ridgeZ}`, `${width - 1},${ridgeZ}`]);

  // walls, 3 high: logs in the corners, planks between them
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        const edgeX = x === 0 || x === width - 1;
        const edgeZ = z === 0 || z === depth - 1;
        if (!edgeX && !edgeZ) continue;
        if (z === 0 && x === doorX && y < 2) continue; // the door goes in last
        if (y === 1 && windows.has(`${x},${z}`)) continue; // the panes go in after the walls
        add(x, y, z, edgeX && edgeZ ? 'log' : 'planks');
      }
    }
  }
  for (const key of windows) {
    const [x, z] = key.split(',').map(Number);
    add(x!, 1, z!, 'glass_pane');
  }

  // a log beam all around the top of the walls
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) {
      if (x === 0 || z === 0 || x === width - 1 || z === depth - 1) add(x, 3, z, 'log');
    }
  }

  // the two triangles of the gable ends
  for (let level = 1; level <= ridgeZ; level++) {
    for (let z = level; z < depth - level; z++) {
      add(0, 3 + level, z, 'planks');
      add(width - 1, 3 + level, z, 'planks');
    }
  }

  // the roof: rows of stairs going up from both sides, one block past the walls, and
  // planks along the ridge
  for (let level = 0; level <= ridgeZ; level++) {
    for (let x = -1; x <= width; x++) {
      add(x, 3 + level, level - 1, 'oak_stairs', 'south');
      add(x, 3 + level, depth - level, 'oak_stairs', 'north');
    }
  }
  for (let x = -1; x <= width; x++) add(x, 4 + ridgeZ, ridgeZ, 'planks');

  add(doorX, 0, 0, 'oak_door', 'south');
  return { name: 'cottage', width, depth, blocks };
}

export const BLUEPRINTS: Record<string, () => Blueprint> = {
  cottage: () => cottage(),
  house: () => house(),
  hut: () => house(4, 4, 2, 'hut'),
};

const matches = (material: Material) => (name: string) =>
  material === 'planks' ? isPlanks(name) : material === 'log' ? isLog(name) : name === material;

/** How many of each material these blocks take. */
export function materialsNeeded(blocks: BlueprintBlock[]) {
  const needed = new Map<Material, number>();
  for (const block of blocks) needed.set(block.material, (needed.get(block.material) ?? 0) + 1);
  return needed;
}

export async function build(ctx: SkillContext, name: string, origin?: Vec3) {
  const { bot } = ctx;
  const make = BLUEPRINTS[name.toLowerCase()];
  if (!make) throw new SkillError(`I don't know how to build a "${name}". I can build: ${Object.keys(BLUEPRINTS).join(', ')}.`);
  const blueprint = make();

  const corner = origin?.floored() ?? findSpot(ctx, blueprint);
  const todo = blueprint.blocks
    .map((block) => ({ ...block, pos: corner.plus(block.at) }))
    .filter((block) => !matches(block.material)(bot.blockAt(block.pos)?.name ?? ''));

  const missing = [...materialsNeeded(todo)]
    .map(([material, count]) => ({ material, lack: count - countItem(bot, matches(material)) }))
    .filter(({ lack }) => lack > 0);
  if (missing.length) {
    const list = missing.map(({ material, lack }) => `${lack} more ${material}`).join(', ');
    throw new SkillError(`To build a ${blueprint.name} I need ${list}.`);
  }

  ctx.log(`building a ${blueprint.name} at ${corner} (${todo.length} blocks)`);
  while (todo.length) {
    checkAborted(ctx);
    const index = nextBlock(ctx, todo);
    if (index === -1) throw new SkillError(`I can't figure out how to place the rest of the ${blueprint.name}.`);
    const [block] = todo.splice(index, 1);
    await standFor(ctx, block!.pos, corner, blueprint);
    const item = bot.inventory.items().find((it) => matches(block!.material)(it.name));
    if (!item) throw new SkillError(`I ran out of ${block!.material} halfway through.`);
    await placeAt(ctx, item.name, block!.pos, block!.facing);
  }
  return `Built a ${blueprint.name} at ${corner.x} ${corner.y} ${corner.z}.`;
}

/**
 * Which block to place next: one on the lowest layer left that already has a neighbour
 * to go against, the closest to the bot first so it doesn't keep walking around the
 * house. Doors wait until everything else is done (the gap is the way in and out).
 */
function nextBlock(ctx: SkillContext, todo: (BlueprintBlock & { pos: Vec3 })[]) {
  const here = ctx.bot.entity.position;
  const others = todo.some((block) => block.material !== 'oak_door');
  let best = -1;
  let bestScore = Infinity;
  todo.forEach((block, i) => {
    if (others && block.material === 'oak_door') return;
    if (!hasSupport(ctx, block.pos)) return;
    // a layer costs more than any walk, so it still builds bottom up
    const score = block.pos.y * 1000 + block.pos.distanceTo(here);
    if (score < bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

const NEIGHBOURS = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)];

function hasSupport(ctx: SkillContext, pos: Vec3) {
  return NEIGHBOURS.some((dir) => ctx.bot.blockAt(pos.plus(dir))?.boundingBox === 'block');
}

/** The closest flat, empty ground around the bot, searching outwards ring by ring. */
function findSpot(ctx: SkillContext, blueprint: Blueprint): Vec3 {
  const feet = ctx.bot.entity.position.floored();
  const offsets: Vec3[] = [];
  for (let dx = -14; dx <= 14; dx++) {
    for (let dz = -14; dz <= 14; dz++) {
      for (const dy of [0, 1, -1]) offsets.push(new Vec3(dx, dy, dz));
    }
  }
  const middle = (corner: Vec3) => corner.offset(blueprint.width / 2, 0, blueprint.depth / 2);
  const candidates = offsets
    .map((offset) => feet.plus(offset))
    // not on top of the bot, so it doesn't start walled in
    .filter((corner) => !contains(corner, blueprint, feet, 2))
    .sort((a, b) => middle(a).distanceTo(feet) - middle(b).distanceTo(feet));
  const spot = candidates.find((corner) => isBuildable(ctx, corner, blueprint));
  if (!spot) throw new SkillError(`There's no flat, clear ${blueprint.width}x${blueprint.depth} area near me.`);
  return spot;
}

/** Whether pos is inside the footprint (grown by `margin` blocks on every side). */
function contains(corner: Vec3, blueprint: Blueprint, pos: Vec3, margin = 0) {
  return (
    pos.x >= corner.x - margin && pos.x < corner.x + blueprint.width + margin &&
    pos.z >= corner.z - margin && pos.z < corner.z + blueprint.depth + margin
  );
}

function isBuildable(ctx: SkillContext, corner: Vec3, blueprint: Blueprint) {
  // the roof hangs one block over the walls, so that ring has to be clear too
  for (let x = -1; x <= blueprint.width; x++) {
    for (let z = -1; z <= blueprint.depth; z++) {
      const inside = x >= 0 && z >= 0 && x < blueprint.width && z < blueprint.depth;
      if (inside && ctx.bot.blockAt(corner.offset(x, -1, z))?.boundingBox !== 'block') return false;
      for (let y = 0; y < 7; y++) {
        if (ctx.bot.blockAt(corner.offset(x, y, z))?.boundingBox !== 'empty') return false;
      }
    }
  }
  return true;
}

/**
 * Moves to a spot where it can reach `pos` without standing in its way: outside the
 * walls when that's in reach, otherwise inside, under the roof (the top of the roof is
 * too high to reach from the ground outside).
 */
async function standFor(ctx: SkillContext, pos: Vec3, corner: Vec3, blueprint: Blueprint) {
  const { bot } = ctx;
  const here = bot.entity.position;
  const insideNow = contains(corner, blueprint, here.floored());
  if (canReach(here, pos) && !inTheWay(here, pos) && (!insideNow || pos.y - corner.y >= 3)) return;

  const spots = [outsideSpot(pos, corner, blueprint), ...insideSpots(pos, corner, blueprint)];
  const spot = spots.find((s) => canReach(s.offset(0.5, 0, 0.5), pos) && !inTheWay(s.offset(0.5, 0, 0.5), pos));
  if (!spot) throw new SkillError(`I can't find a place to stand to reach ${pos.x} ${pos.y} ${pos.z}.`);
  if (here.floored().equals(spot)) return;
  await walk(ctx, new goals.GoalBlock(spot.x, spot.y, spot.z), 'a spot next to the house');
}

// standing right next to the spot, its hitbox can be where the block has to go
function inTheWay(feet: Vec3, pos: Vec3) {
  if (pos.y >= Math.floor(feet.y) + 2 || pos.y < Math.floor(feet.y) - 1) return false;
  return Math.hypot(feet.x - (pos.x + 0.5), feet.z - (pos.z + 0.5)) < 1.5;
}

/** Floor cells inside the walls, closest to the block first. */
function insideSpots(pos: Vec3, corner: Vec3, blueprint: Blueprint) {
  const spots: Vec3[] = [];
  for (let x = 1; x < blueprint.width - 1; x++) {
    for (let z = 1; z < blueprint.depth - 1; z++) spots.push(corner.offset(x, 0, z));
  }
  const flat = (s: Vec3) => Math.hypot(s.x - pos.x, s.z - pos.z);
  return spots.sort((a, b) => flat(a) - flat(b));
}

/**
 * The ground spot outside the wall that is closest to `pos`. Two blocks out, not one:
 * standing right against the wall, its hitbox can touch the spot and the server
 * refuses the block.
 */
export function outsideSpot(pos: Vec3, corner: Vec3, blueprint: { width: number; depth: number }) {
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
