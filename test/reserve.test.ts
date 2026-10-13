import { describe, expect, it } from 'vitest';
import { materialsFor } from '../src/plans/run.ts';
import { spare, spareInventory } from '../src/skills/reserve.ts';
import { chooseFuel } from '../src/skills/smelt.ts';

const inventory = [
  { name: 'birch_planks', count: 40 },
  { name: 'oak_planks', count: 6 },
  { name: 'birch_planks', count: 4 },
];
const reserved = new Map([['birch_planks', 32]]);

describe('reservations', () => {
  it('counts only what is left over after the reserve', () => {
    expect(spare(inventory, reserved, 'birch_planks')).toBe(12);
    expect(spare(inventory, reserved, 'oak_planks')).toBe(6);
    expect(spareInventory(inventory, new Map([['birch_planks', 50]]))).toEqual([{ name: 'oak_planks', count: 6 }]);
  });

  it('burns the planks nobody needs before the ones for the walls', () => {
    const fuel = chooseFuel(spareInventory([{ name: 'birch_planks', count: 32 }, { name: 'oak_planks', count: 5 }], reserved), 6);
    expect(fuel).toEqual({ name: 'oak_planks', count: 4 });
  });

  it('reserves what the build step of a plan takes, in the palette of the woods around', () => {
    const steps = [
      { skill: 'collect_wood', args: { amount: 10 }, why: '' },
      { skill: 'build', args: { structure: 'farmhouse', woods: ['oak', 'birch'] }, why: '' },
    ];
    const needed = materialsFor(steps)!;
    expect(needed.get('birch_planks')).toBeGreaterThan(0);
    expect(needed.get('cobblestone')).toBe(31);
    expect(materialsFor([{ skill: 'craft', args: { item: 'stick' }, why: '' }])).toBeNull();
    // the hut only says "planks": nothing exact to set aside
    expect(materialsFor([{ skill: 'build', args: { structure: 'hut' }, why: '' }])!.size).toBe(0);
  });
});
