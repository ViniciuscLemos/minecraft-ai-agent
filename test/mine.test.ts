import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { isExposed } from '../src/skills/mine.ts';

// a tiny world: solid stone everywhere except the listed air blocks
function world(air: [number, number, number][]) {
  const open = new Set(air.map((p) => p.join(',')));
  return {
    blockAt: (pos: Vec3) => ({ boundingBox: open.has(`${pos.x},${pos.y},${pos.z}`) ? 'empty' : 'block' }) as never,
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

  it('ignores air that only touches a corner', () => {
    expect(isExposed(world([[1, 1, 0]]), new Vec3(0, 0, 0))).toBe(false);
  });
});
