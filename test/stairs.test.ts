import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { chooseDirection, planStep } from '../src/skills/stairs.ts';

// ground at y <= 0 (dirt), air above, with some blocks swapped out
function world(changes: Record<string, string> = {}) {
  return {
    blockAt: (pos: Vec3) => {
      const name = changes[`${pos.x},${pos.y},${pos.z}`] ?? (pos.y <= 0 ? 'dirt' : 'air');
      return { name, boundingBox: name === 'air' || name === 'water' || name === 'lava' ? 'empty' : 'block' } as never;
    },
  };
}

const feet = new Vec3(0, 1, 0); // standing on the ground
const east = new Vec3(1, 0, 0);

describe('planStep', () => {
  it('digs the block in front and the one under it, and steps down into the gap', () => {
    const step = planStep(world(), feet, east);
    expect(step).toEqual({ ok: true, dig: [new Vec3(1, 0, 0)], stand: new Vec3(1, 0, 0) });
  });

  it('clears head room too once it is underground', () => {
    const step = planStep(world(), new Vec3(0, -3, 0), east);
    expect(step.ok && step.dig).toEqual([new Vec3(1, -2, 0), new Vec3(1, -3, 0), new Vec3(1, -4, 0)]);
  });

  it('never digs the block it is standing on', () => {
    const step = planStep(world(), feet, east);
    expect(step.ok && step.dig.some((p) => p.equals(feet.offset(0, -1, 0)))).toBe(false);
  });

  it('refuses to dig into water or lava', () => {
    expect(planStep(world({ '1,0,0': 'lava' }), feet, east)).toMatchObject({ ok: false, reason: expect.stringContaining('lava') });
  });

  it('refuses when a liquid sits next to the new hole', () => {
    expect(planStep(world({ '2,0,0': 'water' }), feet, east)).toMatchObject({ ok: false, reason: expect.stringContaining('flood') });
  });

  it('refuses to step over a cave', () => {
    const cave = { '1,-1,0': 'air', '1,-2,0': 'air', '1,-3,0': 'air', '1,-4,0': 'air' };
    expect(planStep(world(cave), feet, east)).toMatchObject({ ok: false, reason: expect.stringContaining('no floor') });
  });

  it('goes down a slope onto lower ground', () => {
    const slope = { '1,0,0': 'air', '1,-1,0': 'air' };
    expect(planStep(world(slope), feet, east)).toEqual({ ok: true, dig: [], stand: new Vec3(1, -1, 0) });
  });

  it('does not trust a gravel floor', () => {
    expect(planStep(world({ '1,-1,0': 'gravel' }), feet, east).ok).toBe(false);
  });

  it('stops at bedrock', () => {
    expect(planStep(world({ '1,0,0': 'bedrock' }), feet, east).ok).toBe(false);
  });
});

describe('chooseDirection', () => {
  it('keeps going the way it was going', () => {
    const south = new Vec3(0, 0, 1);
    expect(chooseDirection(world(), feet, south).dir).toEqual(south);
  });

  it('turns when the way ahead is blocked', () => {
    const choice = chooseDirection(world({ '1,0,0': 'lava' }), feet, east);
    expect(choice.dir).not.toEqual(east);
    expect(choice.dir).not.toBeNull();
  });

  it('gives up with the reasons when every way is unsafe', () => {
    const lava = { '1,0,0': 'lava', '-1,0,0': 'lava', '0,0,1': 'lava', '0,0,-1': 'lava' };
    const choice = chooseDirection(world(lava), feet);
    expect(choice.dir).toBeNull();
    expect(choice.reasons).toHaveLength(4);
  });
});
