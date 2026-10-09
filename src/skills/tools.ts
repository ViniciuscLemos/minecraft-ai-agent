// Picking the right tool for a block, and saying which one is missing when there is none.
import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';

// cheapest first, so "you need X" names the easiest tool to make
const TIERS = ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite'];

/** Item names that can harvest the block (get its drop), or null when the hand is enough. */
export function harvestToolNames(bot: Bot, block: Block): string[] | null {
  if (!block.harvestTools) return null;
  const names = Object.keys(block.harvestTools).map((id) => bot.registry.items[Number(id)]!.name);
  return names.sort((a, b) => tierOf(a) - tierOf(b));
}

function tierOf(name: string) {
  const tier = TIERS.indexOf(name.split('_')[0]!);
  return tier === -1 ? TIERS.length : tier;
}

/** Holds the inventory item that breaks this block fastest (or keeps the hand empty-ish). */
export async function equipBestTool(bot: Bot, block: Block) {
  let best = null;
  let bestTime = block.digTime(null, false, false, false, [], []);
  for (const item of bot.inventory.items()) {
    const time = block.digTime(item.type, false, false, false, [], []);
    if (time < bestTime) {
      best = item;
      bestTime = time;
    }
  }
  if (best && bot.heldItem?.type !== best.type) await bot.equip(best, 'hand');
}
