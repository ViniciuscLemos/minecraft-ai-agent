// Things the planner can't work out from the skill list alone. A farmhouse is 209 blocks
// in a dozen materials, and the model has no way to count them from "build a farmhouse",
// so a request that names a structure gets its bill of materials in the prompt.
import { BLUEPRINTS, materialsNeeded } from '../skills/build.ts';
import { paletteFor } from '../plans/survival.ts';

export function structureIn(request: string) {
  const words: string[] = request.toLowerCase().match(/[a-z]+/g) ?? [];
  const name = Object.keys(BLUEPRINTS).find((structure) => words.includes(structure));
  // "a home" with no name gets the farmhouse: it's the one worth looking at
  return name ?? (words.includes('home') ? 'farmhouse' : undefined);
}

/** "The farmhouse takes: 32 birch_planks, ..." for a request that names a structure. */
export function buildingNotes(request: string, woods: string[]) {
  const structure = structureIn(request);
  if (!structure) return undefined;
  // same palette the build step picks from `woods`, so the counts match what it will ask for
  const palette = woods.length ? paletteFor(woods) : undefined;
  const needed = [...materialsNeeded(BLUEPRINTS[structure]!(palette).blocks)]
    .sort((a, b) => b[1] - a[1])
    .map(([material, count]) => `${count} ${material === 'planks' ? 'planks (any wood)' : material}`);
  const args = woods.length ? `{"structure":"${structure}","woods":${JSON.stringify(woods)}}` : `{"structure":"${structure}"}`;
  return [
    `Building a ${structure} takes: ${needed.join(', ')}.`,
    `Gather and craft all of it first (count what the inventory has), then finish with build ${args}.`,
    'The furnace burns planks or logs as fuel, so get a few extra.',
  ].join('\n');
}
