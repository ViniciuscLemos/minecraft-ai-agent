import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { nearbyCorners, planSite } from '../src/skills/site.ts';

// a tiny world: grass at y=63 everywhere, air above, plus whatever a test puts in
function world(extra: Record<string, string> = {}) {
  return (pos: Vec3) => {
    const name = extra[pos.toString()] ?? (pos.y <= 63 ? 'grass_block' : 'air');
    return { name, boundingBox: /air|short_grass|poppy/.test(name) ? 'empty' : 'block' };
  };
}
const corner = new Vec3(0, 64, 0);

describe('planSite', () => {
  it('needs no work on flat, empty ground', () => {
    expect(planSite(world(), corner, 9, 5)).toEqual({ corner, cut: [], fill: [] });
  });

  it('ignores tall grass and flowers', () => {
    const plan = planSite(world({ [new Vec3(2, 64, 2).toString()]: 'short_grass', [new Vec3(-1, 64, 3).toString()]: 'poppy' }), corner, 9, 5);
    expect(plan?.cut).toEqual([]);
  });

  it('digs bumps, the top layer first, including the roof overhang ring', () => {
    const plan = planSite(
      world({ [new Vec3(3, 64, 1).toString()]: 'dirt', [new Vec3(3, 65, 1).toString()]: 'sand', [new Vec3(-1, 64, -1).toString()]: 'stone' }),
      corner, 9, 5,
    )!;
    expect(plan.cut.map(String)).toEqual([new Vec3(3, 65, 1), new Vec3(-1, 64, -1), new Vec3(3, 64, 1)].map(String));
  });

  it('fills dips in the floor and where it stands, not under the overhang', () => {
    const dips = [new Vec3(4, 63, 2), new Vec3(-1, 63, 0), new Vec3(-2, 63, 0)];
    const plan = planSite(world(Object.fromEntries(dips.map((d) => [d.toString(), 'air']))), corner, 9, 5)!;
    expect(plan.fill.map(String)).toEqual([new Vec3(-2, 63, 0), new Vec3(4, 63, 2)].map(String));
  });

  it('gives up on a deep hole, water, a tree or a hill too tall to reach', () => {
    const hole = world({ [new Vec3(4, 63, 2).toString()]: 'air', [new Vec3(4, 62, 2).toString()]: 'air' });
    expect(planSite(hole, corner, 9, 5)).toBeUndefined();
    expect(planSite(world({ [new Vec3(1, 63, 1).toString()]: 'water' }), corner, 9, 5)).toBeUndefined();
    expect(planSite(world({ [new Vec3(5, 64, 2).toString()]: 'oak_log' }), corner, 9, 5)).toBeUndefined();
    expect(planSite(world({ [new Vec3(5, 71, 2).toString()]: 'oak_leaves' }), corner, 9, 5)).toBeUndefined();
    expect(planSite(world({ [new Vec3(5, 69, 2).toString()]: 'stone' }), corner, 9, 5)).toBeUndefined();
  });

  it('cuts low leaves, like a bush', () => {
    expect(planSite(world({ [new Vec3(5, 64, 2).toString()]: 'oak_leaves' }), corner, 9, 5)?.cut).toHaveLength(1);
  });

  it('gives up when there is too much to dig', () => {
    const hill: Record<string, string> = {};
    for (let x = 0; x < 9; x++) for (let z = 0; z < 5; z++) for (const y of [64, 65]) hill[new Vec3(x, y, z).toString()] = 'dirt';
    expect(planSite(world(hill), corner, 9, 5)).toBeUndefined();
  });
});

describe('nearbyCorners', () => {
  it('never puts the house on top of the bot and starts closest', () => {
    const feet = new Vec3(0, 64, 0);
    const corners = nearbyCorners(world(), feet, 9, 5, 6);
    expect(corners.every((c) => c.y === 64 || c.y === 65)).toBe(true);
    expect(corners.some((c) => feet.x >= c.x - 2 && feet.x < c.x + 11 && feet.z >= c.z - 2 && feet.z < c.z + 7)).toBe(false);
    const dist = (c: Vec3) => c.offset(4.5, 0, 2.5).distanceTo(feet);
    expect(dist(corners[0]!)).toBeLessThanOrEqual(dist(corners.at(-1)!));
  });
});
