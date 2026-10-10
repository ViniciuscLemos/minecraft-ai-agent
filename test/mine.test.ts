import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { dropStays, isExposed, touchesBot } from '../src/skills/mine.ts';

// a tiny world: solid stone everywhere except the listed blocks (air unless named)
function world(open: [number, number, number][], name = 'air') {
  const empty = new Set(open.map((p) => p.join(',')));
  return {
    blockAt: (pos: Vec3) =>
      (empty.has(`${pos.x},${pos.y},${pos.z}`) ? { boundingBox: 'empty', name } : { boundingBox: 'block', name: 'stone' }) as never,
  };
}

describe('isExposed', () => {
  it('is false for stone buried on every side', () => {
    expect(isExposed(world([]), new Vec3(0, 0, 0))).toBe(false);
  });

  it('is true when any face touches air', () => {
    expect(isExposed(world([[0, 1, 0]]), new Vec3(0, 0, 0))).toBe(true);
    expect(isExposed(world([[-1, 0, 0]]), new Vec3(0, 0, 0))).toBe(true);
  });

  it('does not count water: stone on a lake floor is no use, the drop sinks', () => {
    expect(isExposed(world([[0, 1, 0]], 'water'), new Vec3(0, 0, 0))).toBe(false);
  });

  it('ignores air that only touches a corner', () => {
    expect(isExposed(world([[1, 1, 0]]), new Vec3(0, 0, 0))).toBe(false);
  });
});

describe('dropStays', () => {
  it('is true with solid ground under the block', () => {
    expect(dropStays(world([[0, 1, 0]]), new Vec3(0, 0, 0))).toBe(true);
  });

  it('is false over a cave, where the drop would fall away', () => {
    expect(dropStays(world([[0, -1, 0]]), new Vec3(0, 0, 0))).toBe(false);
  });
});

describe('touchesBot', () => {
  const feet = new Vec3(0.5, 10, 0.5);

  it('takes the walls beside its feet and head', () => {
    expect(touchesBot(feet, new Vec3(1, 10, 0))).toBe(true);
    expect(touchesBot(feet, new Vec3(0, 11, -1))).toBe(true);
  });

  it('leaves blocks two away, on a diagonal, or under its feet', () => {
    expect(touchesBot(feet, new Vec3(2, 10, 0))).toBe(false);
    expect(touchesBot(feet, new Vec3(1, 10, 1))).toBe(false);
    expect(touchesBot(feet, new Vec3(1, 9, 0))).toBe(false);
  });
});
