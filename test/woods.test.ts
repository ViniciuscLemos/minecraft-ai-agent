import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { isBranch, pickWoods } from '../src/skills/wood.ts';

describe('pickWoods', () => {
  it('keeps the woods with enough logs, most common first', () => {
    expect(pickWoods(new Map([['birch', 20], ['oak', 40]]), 12)).toEqual(['oak', 'birch']);
  });

  it('drops a wood with only a tree or two', () => {
    expect(pickWoods(new Map([['oak', 40], ['birch', 6]]), 12)).toEqual(['oak']);
  });

  it('still names the most common wood when every kind is scarce', () => {
    expect(pickWoods(new Map([['oak', 5], ['birch', 9]]), 12)).toEqual(['birch']);
  });

  it('is empty with no trees at all', () => {
    expect(pickWoods(new Map(), 12)).toEqual([]);
  });
});

describe('isBranch', () => {
  const at = (blocks: Record<string, string>) => ({
    blockAt: (pos: Vec3) => {
      const name = blocks[pos.toString()] ?? 'air';
      return { name, boundingBox: name === 'air' ? 'empty' : 'block' } as never;
    },
  });
  const log = new Vec3(0, 68, 0);

  it('treats a log on leaves or air as a branch', () => {
    expect(isBranch(at({ [new Vec3(0, 67, 0).toString()]: 'oak_leaves' }), log)).toBe(true);
    expect(isBranch(at({}), log)).toBe(true);
  });

  it('keeps logs on the ground, on another log, or above one it just cut', () => {
    expect(isBranch(at({ [new Vec3(0, 67, 0).toString()]: 'grass_block' }), log)).toBe(false);
    expect(isBranch(at({ [new Vec3(0, 67, 0).toString()]: 'oak_log' }), log)).toBe(false);
    expect(isBranch(at({}), log, new Set([new Vec3(0, 67, 0).toString()]))).toBe(false);
  });
});
