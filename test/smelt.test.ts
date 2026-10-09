import { describe, expect, it } from 'vitest';
import { chooseFuel, SMELTS_INTO } from '../src/skills/smelt.ts';

describe('chooseFuel', () => {
  it('prefers coal: one piece smelts 8 items', () => {
    expect(chooseFuel([{ name: 'oak_planks', count: 10 }, { name: 'coal', count: 2 }], 6)).toEqual({ name: 'coal', count: 1 });
  });

  it('burns wood when there is no coal', () => {
    expect(chooseFuel([{ name: 'birch_planks', count: 10 }], 6)).toEqual({ name: 'birch_planks', count: 4 });
  });

  it('gives up when there is not enough of anything', () => {
    expect(chooseFuel([{ name: 'stick', count: 2 }], 6)).toBeNull();
  });
});

it('knows that sand turns into glass', () => {
  expect(SMELTS_INTO.sand).toBe('glass');
});
