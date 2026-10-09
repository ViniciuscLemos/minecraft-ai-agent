// Crafting, including the boring parts: finding or placing a crafting table, and making
// the ingredients that are missing first (planks from logs, sticks from planks...).
import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import type { Recipe } from 'prismarine-recipe';
import { checkAborted, countItem, goNear, isLog, isPlanks, SkillError, type SkillContext } from './context.ts';
import { craftOnce } from './grid.ts';
import { placeNear } from './place.ts';

const TABLE_RADIUS = 24;
// pickaxe -> sticks -> planks is 3 levels; more than that means something is off
const MAX_DEPTH = 4;

export async function craft(ctx: SkillContext, name: string, amount = 1, depth = 0): Promise<string> {
  const { bot } = ctx;
  const item = resolveItem(bot, name);
  const has = () => countItem(bot, (n) => n === item.name);
  const before = has();

  for (let round = 0; has() - before < amount; round++) {
    checkAborted(ctx);
    if (round > 6) throw new SkillError(`I keep failing to craft ${item.name}.`);
    const missing = amount - (has() - before);

    // the 2x2 grid in the inventory first, then a crafting table
    let table: Block | null = null;
    let recipe = bot.recipesFor(item.id, null, 1, null)[0];
    if (!recipe && needsTable(bot, item.id)) {
      table = await getTable(ctx, depth);
      recipe = bot.recipesFor(item.id, null, 1, table)[0];
    }

    if (!recipe) {
      const variant = closestRecipe(bot, item.id, table);
      if (!variant) throw new SkillError(`There's no recipe for ${item.name}.`);
      const lacking = missingIngredients(bot, variant, Math.ceil(missing / variant.result.count));
      // logs (and anything else that can't be crafted) have to be gathered: that's the planner's job
      const raw = lacking.filter((need) => !canMake(bot, need.name));
      if (raw.length || depth >= MAX_DEPTH) {
        const what = raw.length ? `I need ${raw.map((n) => `${n.count} more ${n.label}`).join(', ')}` : 'it takes too many steps';
        throw new SkillError(`I can't craft ${item.name}: ${what}.`);
      }
      for (const need of lacking) await craft(ctx, need.name, need.count, depth + 1);
      continue;
    }

    const times = Math.ceil(missing / recipe.result.count);
    // as many times as there are ingredients for; the loop comes back for the rest
    for (let i = 0; i < times; i++) {
      if (!bot.recipesFor(item.id, null, 1, table).length) break;
      ctx.log(`crafting ${recipe.result.count} ${item.name}${table ? ' at the table' : ''}`);
      await craftOnce(bot, recipe, table);
    }
  }

  return `Crafted ${amount} ${item.name} (now I have ${has()}).`;
}

interface Need {
  name: string; // the item to craft for it (planks become the kind that matches its logs)
  label: string; // how to say it: "planks" and "logs" instead of one specific wood
  count: number;
}

/** Recipes come in one variant per wood type; this picks the one it's closest to affording. */
function closestRecipe(bot: Bot, itemId: number, table: Block | null): Recipe | undefined {
  const score = (recipe: Recipe) =>
    recipe.delta
      .filter((step) => step.count < 0)
      .reduce((sum, step) => sum + Math.min(1, countItem(bot, sameKind(bot, step.id)) / -step.count), 0);
  return bot.recipesAll(itemId, null, table ?? true).sort((a, b) => score(b) - score(a))[0];
}

function missingIngredients(bot: Bot, recipe: Recipe, times: number): Need[] {
  return recipe.delta
    .filter((step) => step.count < 0)
    .map((step) => {
      const name = bot.registry.items[step.id]!.name;
      const lack = -step.count * times - countItem(bot, sameKind(bot, step.id));
      if (isPlanks(name)) return { name: plankFor(bot), label: 'planks', count: lack };
      return { name, label: isLog(name) ? 'logs' : name, count: lack };
    })
    .filter((need) => need.count > 0);
}

// any planks count as planks, any logs as logs
function sameKind(bot: Bot, itemId: number) {
  const name = bot.registry.items[itemId]!.name;
  if (isPlanks(name)) return isPlanks;
  if (isLog(name)) return isLog;
  return (n: string) => n === name;
}

function canMake(bot: Bot, name: string) {
  if (isPlanks(name)) return countItem(bot, isLog) > 0;
  const item = bot.registry.itemsByName[name];
  return !!item && bot.recipesAll(item.id, null, true).length > 0;
}

/** Accepts names like "planks" or "pickaxe" by reading them as the wooden kind. */
export function resolveItem(bot: Bot, name: string) {
  const clean = name.toLowerCase().trim().replace(/^minecraft:/, '').replace(/\s+/g, '_');
  const aliases: Record<string, string> = {
    planks: plankFor(bot),
    wood: plankFor(bot),
    table: 'crafting_table',
    workbench: 'crafting_table',
    pickaxe: 'wooden_pickaxe',
    axe: 'wooden_axe',
    sword: 'wooden_sword',
    shovel: 'wooden_shovel',
    stick: 'stick',
    sticks: 'stick',
  };
  const item = bot.registry.itemsByName[aliases[clean] ?? clean];
  if (!item) throw new SkillError(`I don't know any item called "${name}".`);
  return item;
}

/** The planks matching the logs it carries, oak when it has none. */
export function plankFor(bot: Bot) {
  const log = bot.inventory.items().find((item) => isLog(item.name));
  const planks = log ? log.name.replace(/_log$/, '_planks') : 'oak_planks';
  return bot.registry.itemsByName[planks] ? planks : 'oak_planks';
}

function needsTable(bot: Bot, itemId: number) {
  return bot.recipesAll(itemId, null, null).length === 0 && bot.recipesAll(itemId, null, true).length > 0;
}

/** A crafting table to stand next to: one nearby, or one it places (crafting it if needed). */
async function getTable(ctx: SkillContext, depth: number): Promise<Block> {
  const { bot } = ctx;
  const tableId = bot.registry.blocksByName.crafting_table!.id;
  let table = bot.findBlock({ matching: tableId, maxDistance: TABLE_RADIUS });

  if (!table) {
    if (countItem(bot, (n) => n === 'crafting_table') === 0) await craft(ctx, 'crafting_table', 1, depth + 1);
    table = await placeNear(ctx, 'crafting_table');
  }
  await goNear(ctx, table.position, 3);
  return table;
}
