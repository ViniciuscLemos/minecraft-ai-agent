// Our own crafting clicks. mineflayer's bot.craft() grabs the output right after putting the
// ingredients in, assuming the server already sees all of them. On 1.21 that isn't always
// true: asking for a crafting table once gave back an oak button (what one plank makes).
// Here it waits until the server itself shows the expected result before taking it.
import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import type { Window } from 'prismarine-windows';
import type { Recipe } from 'prismarine-recipe';
import { sleep } from './context.ts';

const RESULT_SLOT = 0;

export async function craftOnce(bot: Bot, recipe: Recipe, table: Block | null) {
  const window = table ? await openTable(bot, table) : bot.inventory;
  const width = table ? 3 : 2;
  try {
    for (const { slot, id } of gridCells(recipe, width)) {
      await placeOne(bot, window, id, slot);
    }
    await waitForResult(window, recipe.result.id);
    // shift-click: the result goes straight into the inventory
    await bot.clickWindow(RESULT_SLOT, 0, 1);
    await sleep(100);
  } finally {
    await clearGrid(bot, window, width);
    if (table) bot.closeWindow(window);
  }
}

/** Grid slot (1-based, row by row) and item id for every ingredient of the recipe. */
export function gridCells(recipe: Recipe, width: number) {
  const cells: { slot: number; id: number }[] = [];
  if (recipe.inShape) {
    recipe.inShape.forEach((row, y) =>
      row.forEach((ingredient, x) => {
        if (ingredient.id !== -1) cells.push({ slot: 1 + x + width * y, id: ingredient.id });
      }),
    );
  } else {
    (recipe.ingredients ?? []).forEach((ingredient, i) => cells.push({ slot: 1 + i, id: ingredient.id }));
  }
  return cells;
}

// a right click the server ignores (table out of reach or behind a wall) never opens a
// window; without a limit the survival run sat at "crafting a furnace" for 17 minutes
const OPEN_TIMEOUT = 5000;

async function openTable(bot: Bot, table: Block): Promise<Window> {
  let onOpen: (window: Window) => void = () => {};
  const opened = new Promise<Window>((resolve) => {
    onOpen = resolve;
    bot.once('windowOpen', onOpen);
  });
  await bot.activateBlock(table);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TableError('the crafting table did not open')), OPEN_TIMEOUT);
  });
  try {
    return await Promise.race([opened, timeout]);
  } finally {
    clearTimeout(timer);
    bot.removeListener('windowOpen', onOpen);
  }
}

export class TableError extends Error {}

/** Picks up the stack with `id`, drops one item into `slot`, and puts the rest back. */
async function placeOne(bot: Bot, window: Window, id: number, slot: number) {
  const source = window.findInventoryItem(id, null, false);
  if (!source) throw new Error(`missing ingredient ${bot.registry.items[id]?.name}`);
  await bot.clickWindow(source.slot, 0, 0);
  await bot.clickWindow(slot, 1, 0);
  if (window.selectedItem) await bot.clickWindow(source.slot, 0, 0);
}

async function waitForResult(window: Window, id: number) {
  for (let waited = 0; window.slots[RESULT_SLOT]?.type !== id; waited += 50) {
    if (waited > 3000) {
      const got = window.slots[RESULT_SLOT]?.name ?? 'nothing';
      throw new Error(`the crafting grid shows ${got} instead of what it should make`);
    }
    await sleep(50);
  }
}

/** Anything left in the grid (a failed craft) goes back to the inventory. */
async function clearGrid(bot: Bot, window: Window, width: number) {
  for (let slot = 1; slot <= width * width; slot++) {
    if (window.slots[slot]) await bot.clickWindow(slot, 0, 1);
  }
}
