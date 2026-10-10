import { describe, expect, it } from 'vitest';
import { paletteFor, planFor, survivalPlan } from '../src/plans/survival.ts';

const skills = (steps: { skill: string; args: Record<string, unknown> }[]) =>
  steps.map((s) => `${s.skill} ${s.args.item ?? s.args.block ?? s.args.type ?? s.args.structure} ${s.args.amount ?? ''}`.trim());

describe('planFor', () => {
  it('goes from logs to planks to stairs, with leftovers counted', () => {
    const steps = skills(planFor(new Map([['oak_stairs', 8]])));
    // 8 stairs = 2 batches = 12 planks = 3 logs; the table takes 4 more planks (1 log)
    expect(steps).toEqual(['collect_wood oak_log 4', 'craft oak_planks 16', 'craft crafting_table 1', 'craft oak_stairs 8']);
  });

  it('mines stone for cobblestone, with a pickaxe made first', () => {
    const steps = skills(planFor(new Map([['cobblestone', 10]])));
    expect(steps.indexOf('craft wooden_pickaxe 1')).toBeGreaterThan(-1);
    expect(steps.indexOf('craft wooden_pickaxe 1')).toBeLessThan(steps.indexOf('mine stone 10'));
  });

  it('smelts sand into glass for panes, in a furnace it makes', () => {
    const steps = skills(planFor(new Map([['glass_pane', 10]])));
    expect(steps).toContain('mine sand 6');
    expect(steps).toContain('smelt sand 6');
    expect(steps.indexOf('craft furnace 1')).toBeLessThan(steps.indexOf('smelt sand 6'));
    expect(steps.at(-1)).toBe('craft glass_pane 16');
  });

  it('uses what is already in the inventory', () => {
    const steps = skills(planFor(new Map([['oak_planks', 8]]), new Map([['oak_planks', 8]])));
    expect(steps).toEqual([]);
  });

  it('splits big amounts into stacks of 64', () => {
    const steps = planFor(new Map([['oak_log', 100]]));
    expect(steps.map((s) => s.args.amount)).toEqual([64, 36]);
  });
});

describe('survivalPlan', () => {
  it('plans the farmhouse from nothing and builds at the end', () => {
    const steps = survivalPlan('farmhouse');
    expect(steps.at(-1)!.skill).toBe('build');
    const names = skills(steps);
    for (const s of ['craft torch 4', 'smelt oak_log 1', 'craft spruce_door 3', 'smelt sand 6']) expect(names).toContain(s);
    // nothing is crafted before the things it is made of
    const first = (prefix: string) => names.findIndex((n) => n.startsWith(prefix));
    expect(first('collect_wood spruce_log')).toBeLessThan(first('craft spruce_stairs'));
  });

  it('gathers only the woods that grow nearby and builds with them', () => {
    const steps = survivalPlan('farmhouse', new Map(), undefined, ['oak', 'birch']);
    const names = skills(steps);
    expect(names.some((n) => n.startsWith('collect_wood spruce_log'))).toBe(false);
    expect(names.some((n) => n.startsWith('collect_wood birch_log'))).toBe(true);
    expect(steps.at(-1)!.args).toMatchObject({ structure: 'farmhouse', woods: ['oak', 'birch'] });
  });

  it('rejects structures it does not know', () => {
    expect(() => survivalPlan('castle')).toThrow(/castle/);
  });
});

describe('paletteFor', () => {
  it('keeps the usual farmhouse when oak, birch and spruce are around', () => {
    expect(paletteFor(['oak', 'birch', 'spruce'])).toMatchObject({ walls: 'birch_planks', roof: 'spruce_stairs', frame: 'oak_log' });
  });

  it('uses an oak roof over birch walls when there is no spruce', () => {
    expect(paletteFor(['oak', 'birch'])).toMatchObject({ walls: 'birch_planks', roof: 'oak_stairs', door: 'oak_door' });
  });

  it('still works with a single kind of tree', () => {
    expect(paletteFor(['spruce'])).toMatchObject({ walls: 'spruce_planks', roof: 'spruce_stairs', frame: 'spruce_log' });
  });
});
