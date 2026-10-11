// What the planner gets to know about the world: the inventory, where the bot is, the
// trees around and how far the useful blocks are. Kept short, since it goes in every prompt.
import type { Bot } from 'mineflayer';
import { woodsNearby } from '../skills/wood.ts';
import type { WorldState } from './index.ts';

const WORTH_MENTIONING = ['stone', 'sand', 'water', 'coal_ore', 'iron_ore', 'clay', 'gravel'];

export function worldState(bot: Bot, radius = 32): WorldState {
  const inventory: Record<string, number> = {};
  for (const item of bot.inventory.items()) inventory[item.name] = (inventory[item.name] ?? 0) + item.count;
  const nearby: string[] = [];
  for (const name of WORTH_MENTIONING) {
    const block = bot.findBlock({ matching: (b) => b.name === name, maxDistance: radius });
    if (block) nearby.push(`${name} ${Math.round(block.position.distanceTo(bot.entity.position))} blocks away`);
  }
  const { x, y, z } = bot.entity.position;
  return { inventory, position: { x, y, z }, nearby, woods: woodsNearby(bot) };
}
