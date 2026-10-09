import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { BLUEPRINTS, house, outsideSpot } from '../src/skills/build.ts';

describe('house blueprint', () => {
  it('has walls with a door gap and a full roof', () => {
    const hut = house(4, 4, 2, 'hut');
    // 12 wall columns x 2 high, minus the 2 blocks of the door, plus a 4x4 roof
    expect(hut.blocks).toHaveLength(12 * 2 - 2 + 16);
    expect(hut.blocks.some((b) => b.equals(new Vec3(2, 0, 0)))).toBe(false);
  });

  it('places every layer before the one above, and the roof from the edges in', () => {
    const { blocks } = house();
    const heights = blocks.map((b) => b.y);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    const roof = blocks.filter((b) => b.y === 3);
    expect(roof.at(-1)).toEqual(new Vec3(2, 3, 2)); // the middle goes last
  });

  it('knows a house and a hut', () => {
    expect(Object.keys(BLUEPRINTS)).toEqual(['house', 'hut']);
  });
});

describe('outsideSpot', () => {
  const corner = new Vec3(-8, -60, 4);
  const blueprint = house(4, 4, 2);

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
