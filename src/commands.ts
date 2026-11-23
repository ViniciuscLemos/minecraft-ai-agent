// Chat commands. A command starts with "!", like "!follow" or "!craft stick 4".
// Parsing lives apart from the bot so it can be tested without a server.

export type Command =
  | { name: 'help'; topic?: string }
  | { name: 'follow' }
  | { name: 'come' }
  | { name: 'stop' }
  | { name: 'where' }
  | { name: 'inventory' }
  | { name: 'goto'; x: number; y: number | null; z: number }
  // runs one of the skills in src/skills, with the arguments it takes
  | { name: 'skill'; skill: string; args: Record<string, unknown> }
  // a request in plain words, for the planner
  | { name: 'do'; request: string };

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
  '!build <farmhouse|cottage|house|hut> - build next to it',
  '!do <anything> - ask in plain words, like !do make a furnace',
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
  craft: (args) => {
    const [item, n] = itemAndCount(args);
    return skillWith('craft', { item, amount: Number(n) }, !!item && isCount(n), 'Use !craft <item> [how many]');
  },
  mine: (args) => {
    const [block, n] = itemAndCount(args);
    return skillWith('mine', { block, amount: Number(n) }, !!block && isCount(n), 'Use !mine <block> [how many]');
  },
  place: (args) => {
    const [item] = itemAndCount(args);
    return skillWith('place', { item }, !!item, 'Use !place <item>');
  },
  build: ([structure]) => skillWith('build', { structure }, !!structure, 'Use !build <farmhouse|cottage|house|hut>'),
};

// "!craft wooden pickaxe 2" is how people type it in chat; the game's name is wooden_pickaxe.
// The last word is the amount when it's a number
function itemAndCount(args: string[]): [string, string] {
  const last = args.at(-1) ?? '';
  const words = /^\d+$/.test(last) ? args.slice(0, -1) : args;
  return [words.join('_').toLowerCase(), words.length < args.length ? last : '1'];
}

const isCount = (text: string) => /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 64;

function skillWith(skill: string, args: Record<string, unknown>, valid: boolean, usage: string): ParseResult {
  return valid ? { ok: true, command: { name: 'skill', skill, args } } : { ok: false, error: usage };
}

/**
 * The help lines to say in chat. Twelve lines flood the chat, so "!help craft" (or
 * "!help !craft") gives just that one; a word it doesn't know gives the whole list.
 */
export function helpLines(topic?: string): string[] {
  const word = topic?.replace(/^!/, '').toLowerCase();
  const name = word && (ALIASES[word] ?? (word in SKILL_COMMANDS || word === 'do' ? word : undefined));
  const lines = name ? HELP.filter((line) => line.startsWith(`!${name} `)) : [];
  return lines.length ? lines : HELP;
}

/** Returns null when the message isn't a command (normal chat), so the bot ignores it. */
export function parseCommand(message: string): ParseResult {
  const text = message.trim();
  if (!text.startsWith('!')) return null;

  const [word = '', ...args] = text.slice(1).trim().split(/\s+/);
  if (word.toLowerCase() === 'do') {
    const request = args.join(' ');
    return request ? { ok: true, command: { name: 'do', request } } : { ok: false, error: 'Use !do <what you want, in plain words>' };
  }
  const skill = SKILL_COMMANDS[word.toLowerCase()];
  if (skill) return skill(args);

  const name = ALIASES[word.toLowerCase()];
  if (!name) {
    const guess = closestCommand(word.toLowerCase());
    return { ok: false, error: guess ? `I don't know "!${word}". Did you mean !${guess}?` : `I don't know "!${word}". Try !help` };
  }

  if (name === 'help') return { ok: true, command: args[0] ? { name, topic: args[0] } : { name } };
  if (name !== 'goto') return { ok: true, command: { name } } as ParseResult;

  const numbers = args.map(Number);
  if ((numbers.length !== 2 && numbers.length !== 3) || numbers.some((n) => !Number.isFinite(n))) {
    return { ok: false, error: 'Use !goto <x> <z> or !goto <x> <y> <z>' };
  }
  const [x, y, z] = numbers.length === 2 ? [numbers[0], null, numbers[1]] : numbers;
  return { ok: true, command: { name: 'goto', x: x!, y, z: z! } };
}

// edit distance, to catch a typo like !folow or !crfat
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length]!;
}

function closestCommand(word: string): string | null {
  // short words get one letter of slack, or "!go" would turn into a guess for everything
  const slack = word.length >= 5 ? 2 : 1;
  let best: string | null = null;
  let bestDistance = slack + 1;
  for (const command of [...Object.keys(ALIASES), ...Object.keys(SKILL_COMMANDS), 'do']) {
    const d = distance(word, command);
    if (d < bestDistance) [best, bestDistance] = [command, d];
  }
  return best;
}

/** Whether this player can give orders. */
export function canCommand(player: string, owners: string[]) {
  return owners.length === 0 || owners.some((owner) => owner.toLowerCase() === player.toLowerCase());
}
