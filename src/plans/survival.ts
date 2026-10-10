// The scripted survival plan: from "build this" plus what's in the inventory, works out
// every step from bare hands (chop, craft tools, mine, smelt, craft the parts, build).
// It stays until the AI planner is in, and after that it's the fallback and the baseline.
import { BLUEPRINTS, DEFAULT_PALETTE, materialsNeeded, type Palette } from '../skills/build.ts';

export interface Step {
  skill: string;
  args: Record<string, unknown>;
  why: string;
}

type Recipe = { kind: 'craft'; makes: number; from: Record<string, number> } | { kind: 'smelt'; makes: 1; from: Record<string, number> };

const WOODS = ['oak', 'birch', 'spruce', 'jungle', 'acacia', 'dark_oak', 'cherry', 'mangrove'];

/** How to get an item that isn't picked straight from the world. */
export function recipeFor(item: string, fuelWood = 'oak'): Recipe | undefined {
  const wood = WOODS.find((w) => item.startsWith(`${w}_`));
  if (wood) {
    const planks = `${wood}_planks`;
    if (item === planks) return { kind: 'craft', makes: 4, from: { [`${wood}_log`]: 1 } };
    if (item === `${wood}_stairs`) return { kind: 'craft', makes: 4, from: { [planks]: 6 } };
    if (item === `${wood}_door`) return { kind: 'craft', makes: 3, from: { [planks]: 6 } };
    if (item === `${wood}_slab`) return { kind: 'craft', makes: 6, from: { [planks]: 3 } };
    if (item === `${wood}_fence`) return { kind: 'craft', makes: 3, from: { [planks]: 4, stick: 2 } };
  }
  // anything made of "any planks" uses the wood we're already chopping for fuel
  const planks = `${fuelWood}_planks`;
  switch (item) {
    case 'stick': return { kind: 'craft', makes: 4, from: { [planks]: 2 } };
    case 'crafting_table': return { kind: 'craft', makes: 1, from: { [planks]: 4 } };
    case 'chest': return { kind: 'craft', makes: 1, from: { [planks]: 8 } };
    case 'wooden_pickaxe': return { kind: 'craft', makes: 1, from: { [planks]: 3, stick: 2 } };
    case 'stone_pickaxe': return { kind: 'craft', makes: 1, from: { cobblestone: 3, stick: 2 } };
    case 'furnace': return { kind: 'craft', makes: 1, from: { cobblestone: 8 } };
    case 'torch': return { kind: 'craft', makes: 4, from: { charcoal: 1, stick: 1 } };
    case 'glass_pane': return { kind: 'craft', makes: 16, from: { glass: 6 } };
    case 'glass': return { kind: 'smelt', makes: 1, from: { sand: 1 } };
    case 'charcoal': return { kind: 'smelt', makes: 1, from: { [`${fuelWood}_log`]: 1 } };
  }
  return undefined;
}

/** Items that come straight from the world, and the skill that gets them. */
function gather(item: string, amount: number): Step {
  if (item.endsWith('_log')) return { skill: 'collect_wood', args: { type: item, amount }, why: `${item} for planks, tools and the frame` };
  // stone drops cobblestone, so the block to mine isn't the item we want
  if (item === 'cobblestone') return { skill: 'mine', args: { block: 'stone', amount }, why: 'stone drops cobblestone' };
  return { skill: 'mine', args: { block: item, amount }, why: `${item} straight from the ground` };
}

// 2x2 recipes, done in the inventory without a table
const HAND_CRAFTED = /_planks$|^stick$|^crafting_table$/;

// one plank smelts 1.5 items; planks are easier to count than half logs
const fuelFor = (items: number) => Math.ceil(items / 1.5);

/**
 * The steps to end up with `wanted`, starting from `inventory`. Every step comes after the
 * steps that make its ingredients, and the same item is gathered/crafted in one go.
 */
export function planFor(wanted: Map<string, number>, inventory: Map<string, number> = new Map(), fuelWood = 'oak') {
  const stock = new Map(inventory);
  const order: string[] = []; // items in the order their steps run
  const totals = new Map<string, number>(); // how many of each item the steps make

  // count 0 means a tool or station: one, unless we have it or a step already makes it
  const need = (item: string, count: number) => {
    if (count === 0) {
      if ((inventory.get(item) ?? 0) > 0 || totals.has(item)) return;
      count = 1;
    }
    const have = stock.get(item) ?? 0;
    const used = Math.min(have, count);
    stock.set(item, have - used);
    const missing = count - used;
    if (missing <= 0) return;
    const recipe = recipeFor(item, fuelWood);
    let made = missing;
    if (recipe) {
      const batches = Math.ceil(missing / recipe.makes);
      made = batches * recipe.makes;
      if (recipe.kind === 'craft' && !HAND_CRAFTED.test(item)) need('crafting_table', 0);
      if (recipe.kind === 'smelt') {
        need('furnace', 0);
        need(`${fuelWood}_planks`, fuelFor(batches));
      }
      for (const [ingredient, per] of Object.entries(recipe.from)) need(ingredient, per * batches);
    } else if (item === 'cobblestone') {
      need('wooden_pickaxe', 0);
    }
    // leftovers from a batch (4 planks from a log when we wanted 2) count for later steps
    stock.set(item, (stock.get(item) ?? 0) + made - missing);
    totals.set(item, (totals.get(item) ?? 0) + made);
    if (!order.includes(item)) order.push(item);
  };

  return resolve(wanted, need, order, totals, fuelWood);
}

// split out so the recursion above stays readable
function resolve(
  wanted: Map<string, number>,
  need: (item: string, count: number) => void,
  order: string[],
  totals: Map<string, number>,
  fuelWood: string,
): Step[] {
  for (const [item, count] of wanted) need(item, count);
  const steps: Step[] = [];
  for (const item of order) {
    const made = totals.get(item)!;
    const recipe = recipeFor(item, fuelWood);
    // skills take at most 64 at a time, like a stack
    for (let left = made; left > 0; left -= 64) {
      const amount = Math.min(left, 64);
      if (!recipe) steps.push(gather(item, amount));
      else if (recipe.kind === 'smelt') {
        const [input] = Object.keys(recipe.from);
        steps.push({ skill: 'smelt', args: { item: input, amount }, why: `${item} from ${input}` });
      } else steps.push({ skill: 'craft', args: { item, amount }, why: `${item} for the build` });
    }
  }
  return steps;
}

/** The whole survival run for one of the blueprints: gather, craft, smelt, then build. */
export function survivalPlan(
  structure: string,
  inventory: Map<string, number> = new Map(),
  at?: { x: number; y: number; z: number },
  woods?: string[],
) {
  const blueprint = BLUEPRINTS[structure];
  if (!blueprint) throw new Error(`I don't know how to build "${structure}".`);
  // the same woods go to the build step, so it asks for exactly what was gathered
  const palette = woods?.length ? paletteFor(woods) : undefined;
  const steps = planFor(materialsNeeded(blueprint(palette).blocks), inventory);
  steps.push({ skill: 'build', args: { structure, ...at, ...(woods?.length ? { woods } : {}) }, why: 'everything is in the inventory' });
  return steps;
}

/**
 * A farmhouse palette from the trees that grow nearby: a pale wood for the walls and a
 * dark one for the roof when there's a choice, so the house doesn't look like one block.
 */
export function paletteFor(woods: string[]): Palette {
  const pale = ['birch', 'oak', 'acacia', 'jungle', 'cherry', 'spruce', 'dark_oak', 'mangrove'].find((w) => woods.includes(w));
  const dark = ['spruce', 'dark_oak', 'mangrove', 'oak'].find((w) => woods.includes(w) && w !== pale) ?? pale;
  const frame = woods.includes('oak') ? 'oak' : (dark ?? pale);
  if (!pale || !dark || !frame) return DEFAULT_PALETTE;
  return {
    foundation: 'cobblestone',
    frame: `${frame}_log`,
    walls: `${pale}_planks`,
    floor: `${frame}_planks`,
    roof: `${dark}_stairs`,
    ridge: `${dark}_planks`,
    door: `${dark}_door`,
  };
}
