// Materials set aside for what the bot is about to build. Crafting and smelting use what's
// left over first: the survival runs kept turning the birch planks meant for the walls into
// a crafting table or furnace fuel, and had to go back for more wood.
import type { Bot } from 'mineflayer';

const reservations = new WeakMap<Bot, Map<string, number>>();

/** Sets (or with null, clears) what is reserved, by exact item name. */
export function reserve(bot: Bot, items: Map<string, number> | null) {
  if (items?.size) reservations.set(bot, items);
  else reservations.delete(bot);
}

export function reservedOf(bot: Bot) {
  return reservations.get(bot) ?? new Map<string, number>();
}

/** How many of an item the bot can use without touching what's reserved. */
export function spare(inventory: { name: string; count: number }[], reserved: Map<string, number>, name: string) {
  const have = inventory.filter((item) => item.name === name).reduce((sum, item) => sum + item.count, 0);
  return Math.max(0, have - (reserved.get(name) ?? 0));
}

/** One entry per item name with only the spare count, for picking what to use up. */
export function spareInventory(inventory: { name: string; count: number }[], reserved: Map<string, number>) {
  const names = [...new Set(inventory.map((item) => item.name))];
  return names.map((name) => ({ name, count: spare(inventory, reserved, name) })).filter((item) => item.count > 0);
}
