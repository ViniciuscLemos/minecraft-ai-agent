import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { BLUEPRINTS, cottage, farmhouse, house, materialsNeeded, outsideSpot, type Blueprint } from '../src/skills/build.ts';

describe('house blueprint', () => {
  it('has walls with a door gap and a full roof', () => {
    const hut = house(4, 4, 2, 'hut');
    // 12 wall columns x 2 high, minus the 2 blocks of the door, plus a 4x4 roof
    expect(hut.blocks).toHaveLength(12 * 2 - 2 + 16);
    expect(hut.blocks.some((b) => b.at.equals(new Vec3(2, 0, 0)))).toBe(false);
  });

  it('places every layer before the one above, and the roof from the edges in', () => {
    const { blocks } = house();
    const heights = blocks.map((b) => b.at.y);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(blocks.at(-1)!.at).toEqual(new Vec3(2, 3, 2)); // the middle of the roof goes last
  });

  it('knows a farmhouse, a cottage, a house and a hut', () => {
    expect(Object.keys(BLUEPRINTS)).toEqual(['farmhouse', 'cottage', 'house', 'hut']);
  });
});

describe('cottage blueprint', () => {
  const { blocks } = cottage();
  const at = (x: number, y: number, z: number) => blocks.filter((b) => b.at.equals(new Vec3(x, y, z)));

  it('never puts two blocks in the same spot', () => {
    const keys = blocks.map((b) => b.at.toString());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has log corners, glass windows and the door last', () => {
    expect(at(0, 0, 0)[0]!.material).toBe('log');
    expect(at(1, 1, 0)[0]!.material).toBe('glass_pane');
    expect(blocks.at(-1)).toMatchObject({ material: 'oak_door', facing: 'south' });
  });

  it('has a pitched roof: stairs facing the ridge from both sides', () => {
    expect(at(3, 3, -1)[0]).toMatchObject({ material: 'oak_stairs', facing: 'south' });
    expect(at(3, 5, 3)[0]).toMatchObject({ material: 'oak_stairs', facing: 'north' });
    expect(at(3, 6, 2)[0]!.material).toBe('planks');
    // the roof overhangs the walls by one block on the sides too
    expect(at(-1, 4, 0)[0]!.material).toBe('oak_stairs');
  });

  it('adds up the materials it takes', () => {
    expect(Object.fromEntries(materialsNeeded(blocks))).toEqual({
      log: 32,
      planks: 57,
      glass_pane: 6,
      oak_stairs: 54,
      oak_door: 1,
    });
  });
});

describe('outsideSpot', () => {
  const corner = new Vec3(-8, -60, 4);
  const blueprint = { width: 4, depth: 4 };

  it('stands two blocks out from the wall closest to the block', () => {
    expect(outsideSpot(new Vec3(-8, -60, 5), corner, blueprint)).toEqual(new Vec3(-10, -60, 5));
    expect(outsideSpot(new Vec3(-5, -60, 6), corner, blueprint)).toEqual(new Vec3(-3, -60, 6));
    expect(outsideSpot(new Vec3(-6, -60, 7), corner, blueprint)).toEqual(new Vec3(-6, -60, 9));
  });

  it('never picks a spot inside the walls, even for roof blocks', () => {
    const spot = outsideSpot(new Vec3(-7, -58, 5), corner, blueprint);
    const inside = spot.x >= -8 && spot.x < -4 && spot.z >= 4 && spot.z < 8;
    expect(inside).toBe(false);
  });
});

/** Places the blocks the way build() does, on flat ground, and returns what never had support. */
function stuckBlocks({ blocks }: Blueprint) {
  const solid = new Set<string>();
  const key = (v: Vec3) => `${v.x},${v.y},${v.z}`;
  const sides = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)];
  const supported = (v: Vec3) => v.y === 0 || sides.some((d) => solid.has(key(v.plus(d))));
  const todo = [...blocks];
  for (let progress = true; progress && todo.length; ) {
    progress = false;
    for (let i = 0; i < todo.length; i++) {
      if (supported(todo[i]!.at)) {
        solid.add(key(todo[i]!.at));
        todo.splice(i, 1);
        progress = true;
        break;
      }
    }
  }
  return todo.map((b) => key(b.at));
}

describe('farmhouse blueprint', () => {
  const house = farmhouse();
  const at = (x: number, y: number, z: number) => house.blocks.find((b) => b.at.equals(new Vec3(x, y, z)));

  it('never puts two blocks in the same spot', () => {
    const keys = house.blocks.map((b) => b.at.toString());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('can be built block by block: every block has something to go against', () => {
    expect(stuckBlocks(house)).toEqual([]);
    expect(stuckBlocks(cottage())).toEqual([]);
  });

  it('has a foundation, a chimney through the roof, torches and furniture', () => {
    expect(at(0, 0, 0)!.material).toBe('cobblestone');
    expect(at(8, 7, 2)!.material).toBe('cobblestone'); // the top of the chimney, above the ridge
    expect(at(3, 2, -1)!.material).toBe('torch');
    expect(house.blocks.map((b) => b.material)).toEqual(expect.arrayContaining(['crafting_table', 'furnace', 'chest']));
    expect(house.blocks.at(-1)).toMatchObject({ material: 'spruce_door', facing: 'south' });
  });

  it('adds up the materials it takes', () => {
    expect(Object.fromEntries(materialsNeeded(house.blocks))).toEqual({
      cobblestone: 31,
      oak_planks: 21,
      spruce_stairs: 67,
      birch_planks: 32,
      oak_log: 31,
      glass_pane: 10,
      spruce_planks: 10,
      torch: 3,
      crafting_table: 1,
      furnace: 1,
      chest: 1,
      spruce_door: 1,
    });
  });
});
