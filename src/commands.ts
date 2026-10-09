// Chat commands of stage 1. A command starts with "!", like "!follow".
// Parsing lives apart from the bot so it can be tested without a server.

export type Command =
  | { name: 'help' }
  | { name: 'follow' }
  | { name: 'come' }
  | { name: 'stop' }
  | { name: 'where' }
  | { name: 'inventory' }
  | { name: 'goto'; x: number; y: number | null; z: number };

export type ParseResult = { ok: true; command: Command } | { ok: false; error: string } | null;

export const HELP = [
  '!follow - follow you around',
  '!come - walk to where you are',
  '!goto <x> <z> or !goto <x> <y> <z> - walk to a place',
  '!stop - stop what it is doing',
  '!where - say where it is',
  '!inventory - list what it carries',
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

/** Returns null when the message isn't a command (normal chat), so the bot ignores it. */
export function parseCommand(message: string): ParseResult {
  const text = message.trim();
  if (!text.startsWith('!')) return null;

  const [word = '', ...args] = text.slice(1).trim().split(/\s+/);
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
