// The bot itself: joins the server, obeys chat commands and runs skills, with the
// reflexes always on underneath. The movement uses mineflayer-pathfinder with safe settings: no long falls, no digging
// through the floor and no walking into lava or water when there's another way.
import mineflayer, { type Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { canCommand, HELP, parseCommand, type Command } from './commands.ts';
import type { Config } from './config.ts';
import { addReflexes } from './reflexes.ts';
import { findSkill, SkillError } from './skills/index.ts';

const { pathfinder, Movements, goals } = pathfinderPkg;

// how close it stays when following someone
const FOLLOW_DISTANCE = 2;

export function createAgentBot(config: Config): Bot {
  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    version: config.version,
    username: config.username,
    // offline-mode server: no Microsoft account involved
    auth: 'offline',
  });

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    const movements = new Movements(bot);
    movements.maxDropDown = 3; // falls of more than 3 blocks hurt
    movements.allowParkour = false; // jumping over gaps is where bots fall in holes
    movements.canDig = false; // it breaks blocks on purpose (skills), never to make a path
    bot.pathfinder.setMovements(movements);
    log(bot, `joined at ${position(bot)}`);
    bot.chat('Hi! Type !help to see what I can do.');
  });

  bot.on('chat', (player, message) => {
    if (player === bot.username) return;
    const parsed = parseCommand(message);
    if (!parsed) return;
    if (!canCommand(player, config.owners)) return bot.whisper(player, 'Sorry, I only take orders from my owner.');
    if (!parsed.ok) return bot.chat(parsed.error);
    run(bot, parsed.command, player);
  });

  addReflexes(bot, (text) => log(bot, text), () => cancelTask(bot));

  bot.on('goal_reached', () => log(bot, `arrived at ${position(bot)}`));
  bot.on('path_update', (result) => {
    if (result.status === 'noPath') bot.chat("I can't find a way there.");
  });
  bot.on('kicked', (reason) => log(bot, `kicked: ${JSON.stringify(reason)}`));
  bot.on('error', (error) => log(bot, `error: ${error.message}`));

  return bot;
}

// the skill running right now, so a new order or !stop can cancel it
const tasks = new WeakMap<Bot, AbortController>();

export function cancelTask(bot: Bot) {
  tasks.get(bot)?.abort();
  tasks.delete(bot);
}

/** Runs a skill and reports back in the chat. Resolves with the message it said. */
export async function runSkill(bot: Bot, name: string, args: Record<string, unknown>): Promise<string> {
  const skill = findSkill(name);
  if (!skill) return say(bot, `I don't have a skill called ${name}.`);

  cancelTask(bot);
  const controller = new AbortController();
  tasks.set(bot, controller);
  log(bot, `skill ${name} ${JSON.stringify(args)}`);
  try {
    const result = await skill.run({ bot, signal: controller.signal, log: (text) => log(bot, text) }, args);
    return controller.signal.aborted ? 'Stopped.' : say(bot, result);
  } catch (error) {
    if (controller.signal.aborted) return 'Stopped.';
    if (error instanceof SkillError) return say(bot, error.message);
    log(bot, `skill ${name} crashed: ${(error as Error).stack}`);
    return say(bot, `Something went wrong: ${(error as Error).message}`);
  } finally {
    if (tasks.get(bot) === controller) tasks.delete(bot);
  }
}

function say(bot: Bot, message: string) {
  bot.chat(message);
  return message;
}

export function run(bot: Bot, command: Command, player: string) {
  const target = bot.players[player]?.entity;
  // any new order replaces the one it was working on
  if (command.name !== 'where' && command.name !== 'inventory' && command.name !== 'help') cancelTask(bot);

  switch (command.name) {
    case 'help':
      HELP.forEach((line) => bot.chat(line));
      return;

    case 'follow':
      if (!target) return bot.chat("I can't see you. Come closer.");
      // dynamic goal: it keeps following while the player moves
      bot.pathfinder.setGoal(new goals.GoalFollow(target, FOLLOW_DISTANCE), true);
      return bot.chat(`Following you, ${player}.`);

    case 'come':
      if (!target) return bot.chat("I can't see you. Come closer.");
      const { x, y, z } = target.position.floored();
      bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 1));
      return bot.chat('On my way.');

    case 'goto':
      bot.pathfinder.setGoal(
        command.y === null
          ? new goals.GoalXZ(command.x, command.z)
          : new goals.GoalBlock(Math.floor(command.x), Math.floor(command.y), Math.floor(command.z)),
      );
      return bot.chat(`Going to ${command.x} ${command.y ?? '~'} ${command.z}.`);

    case 'stop':
      bot.pathfinder.stop();
      return bot.chat('Stopped.');

    case 'where':
      return bot.chat(`I'm at ${position(bot)}.`);

    case 'inventory': {
      const items = bot.inventory.items().map((item) => `${item.count} ${item.name}`);
      return bot.chat(items.length ? `I have: ${items.join(', ')}` : 'My inventory is empty.');
    }

    case 'skill':
      bot.chat('On it.');
      void runSkill(bot, command.skill, command.args);
      return;
  }
}

export function position(bot: Bot) {
  const { x, y, z } = bot.entity.position.floored();
  return `${x} ${y} ${z}`;
}

function log(bot: Bot, text: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${bot.username}: ${text}`);
}
