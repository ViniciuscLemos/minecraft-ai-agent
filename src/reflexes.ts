// Things the bot does on its own, without being told: eat when hungry, get unstuck,
// and tell the owner when it dies. They run all the time, under any skill or plan.
import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';

const EAT_BELOW = 14; // out of 20; under 18 it stops healing, so it eats a bit before that

export function addReflexes(bot: Bot, log: (text: string) => void, onDeath: () => void) {
  autoEat(bot, log);
  antiStuck(bot, log);

  bot.on('death', () => {
    const { x, y, z } = bot.entity.position.floored();
    log(`died at ${x} ${y} ${z}`);
    onDeath();
    bot.chat(`I died at ${x} ${y} ${z}. Sorry! Whatever I was doing is cancelled.`);
  });
}

function autoEat(bot: Bot, log: (text: string) => void) {
  let eating = false;
  bot.on('health', async () => {
    if (eating || bot.food >= EAT_BELOW) return;
    const food = bestFood(bot);
    if (!food) return;
    eating = true;
    const held = bot.heldItem;
    try {
      await bot.equip(food, 'hand');
      await bot.consume();
      log(`ate ${food.name} (food ${bot.food}/20)`);
      if (held && held.type !== food.type) await bot.equip(held, 'hand');
    } catch (error) {
      log(`couldn't eat: ${(error as Error).message}`);
    } finally {
      eating = false;
    }
  });
}

/** The food that fills the most, never the ones that poison or have side effects. */
export function bestFood(bot: Bot) {
  const avoid = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chorus_fruit', 'suspicious_stew']);
  const foods = bot.registry.foodsByName as Record<string, { foodPoints: number }>;
  return bot.inventory
    .items()
    .filter((item) => foods[item.name] && !avoid.has(item.name))
    .sort((a, b) => foods[b.name]!.foodPoints - foods[a.name]!.foodPoints)[0];
}

/**
 * The pathfinder sometimes keeps pushing against a fence corner or a slab forever.
 * When it's supposed to be moving but hasn't left the spot, it jumps, and if that
 * doesn't help it backs off a little so the pathfinder sees the way from a new position.
 * (Setting the goal again would cancel whatever skill is waiting on it.)
 */
function antiStuck(bot: Bot, log: (text: string) => void) {
  let last: Vec3 | null = null;
  let stuckFor = 0;

  const timer = setInterval(() => {
    if (!bot.entity || !bot.pathfinder?.isMoving()) {
      stuckFor = 0;
      last = null;
      return;
    }
    const here = bot.entity.position.clone();
    stuckFor = last && here.distanceTo(last) < 0.15 ? stuckFor + 1 : 0;
    last = here;

    if (stuckFor === 3) {
      log('looks stuck, jumping');
      press(bot, 'jump', 400);
    } else if (stuckFor === 6) {
      log('still stuck, backing off');
      press(bot, 'back', 600);
      press(bot, 'jump', 400);
      stuckFor = 0;
    }
  }, 1000);

  bot.once('end', () => clearInterval(timer));
}

function press(bot: Bot, control: 'jump' | 'back', ms: number) {
  bot.setControlState(control, true);
  setTimeout(() => bot.setControlState(control, false), ms);
}
