// Chat commands. A command starts with "!", like "!follow" or "!craft stick 4".
// Parsing lives apart from the bot so it can be tested without a server.

export type Command =
  | { name: 'help' }
  | { name: 'follow' }
  | { name: 'come' }
  | { name: 'stop' }
  | { name: 'where' }
  | { name: 'inventory' }
  | { name: 'goto'; x: number; y: number | null; z: number }
  // runs one of the skills in src/skills, with the arguments it takes
  | { name: 'skill'; skill: string; args: Record<string, unknown> };

export type ParseResult = { ok: true; command: Command } | { ok: false; error: string } | null;

export const HELP = [
  '!follow - follow you around',
  '!come - walk to where you are',
  '!goto <x> <z> or !goto <x> <y> <z> - walk to a place',
  '!stop - stop what it is doing',
  '!where - say where it is',
  '!inventory - list what it carries',
  '!wood <n> - chop trees for n logs',
  '!craft <item> [n] - craft something, like !craft wooden_pickaxe',
  '!mine <block> [n] - mine blocks it can see, like !mine stone 3',
  '!place <item> - put a block down next to it',
  '!build <house|hut> - build next to it, from planks',
];

const ALIASES: Record<string, Command['name']> = {
  help: 'help',
  follow: 'follow',
  come: 'come',
  here: 'come',
  stop: 'stop',
  where: 'where',
  pos: 'where',
  inventory: 'inventory',
  inv: 'inventory',
  goto: 'goto',
};

// commands that start a skill: the words after the command become its arguments
const SKILL_COMMANDS: Record<string, (args: string[]) => ParseResult> = {
  wood: ([n = '4']) => skillWith('collect_wood', { amount: Number(n) }, isCount(n), 'Use !wood <how many logs>'),
  chop: (args) => SKILL_COMMANDS.wood!(args),
  craft: ([item, n = '1']) => skillWith('craft', { item, amount: Number(n) }, !!item && isCount(n), 'Use !craft <item> [how many]'),
  mine: ([block, n = '1']) => skillWith('mine', { block, amount: Number(n) }, !!block && isCount(n), 'Use !mine <block> [how many]'),
  place: ([item]) => skillWith('place', { item }, !!item, 'Use !place <item>'),
  build: ([structure]) => skillWith('build', { structure }, !!structure, 'Use !build <house|hut>'),
};

const isCount = (text: string) => /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 64;

function skillWith(skill: string, args: Record<string, unknown>, valid: boolean, usage: string): ParseResult {
  return valid ? { ok: true, command: { name: 'skill', skill, args } } : { ok: false, error: usage };
}

/** Returns null when the message isn't a command (normal chat), so the bot ignores it. */
export function parseCommand(message: string): ParseResult {
  const text = message.trim();
  if (!text.startsWith('!')) return null;

  const [word = '', ...args] = text.slice(1).trim().split(/\s+/);
  const skill = SKILL_COMMANDS[word.toLowerCase()];
  if (skill) return skill(args);

  const name = ALIASES[word.toLowerCase()];
  if (!name) return { ok: false, error: `I don't know "!${word}". Try !help` };

  if (name !== 'goto') return { ok: true, command: { name } } as ParseResult;

  const numbers = args.map(Number);
  if ((numbers.length !== 2 && numbers.length !== 3) || numbers.some((n) => !Number.isFinite(n))) {
    return { ok: false, error: 'Use !goto <x> <z> or !goto <x> <y> <z>' };
  }
  const [x, y, z] = numbers.length === 2 ? [numbers[0], null, numbers[1]] : numbers;
  return { ok: true, command: { name: 'goto', x: x!, y, z: z! } };
}

/** Whether this player can give orders. */
export function canCommand(player: string, owners: string[]) {
  return owners.length === 0 || owners.some((owner) => owner.toLowerCase() === player.toLowerCase());
}
