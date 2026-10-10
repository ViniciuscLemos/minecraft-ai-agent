// Every skill in one list: the chat commands use it now, and the AI planner will get the
// same list as its tools, so both go through the exact same tested code.
import { Vec3 } from 'vec3';
import { build, BLUEPRINTS } from './build.ts';
import type { SkillContext } from './context.ts';
import { craft } from './craft.ts';
import { mine } from './mine.ts';
import { placeNear } from './place.ts';
import { smelt } from './smelt.ts';
import { collectWood } from './wood.ts';

export { SkillError, type SkillContext } from './context.ts';

type Args = Record<string, unknown>;

export interface Skill {
  name: string;
  description: string;
  // JSON Schema of the arguments (the format Claude's tool use expects)
  input: { type: 'object'; properties: Record<string, object>; required?: string[] };
  run(ctx: SkillContext, args: Args): Promise<string>;
}

const amount = (args: Args, fallback = 1) => {
  const value = Number(args.amount ?? fallback);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 64) : fallback;
};

export const SKILLS: Skill[] = [
  {
    name: 'collect_wood',
    description: 'Chop the nearest trees until it has this many more logs. Give a type (oak_log, birch_log, spruce_log...) to cut only that wood.',
    input: {
      type: 'object',
      properties: { amount: { type: 'integer', minimum: 1, maximum: 64 }, type: { type: 'string' } },
      required: ['amount'],
    },
    run: (ctx, args) => collectWood(ctx, amount(args), typeof args.type === 'string' ? args.type : undefined),
  },
  {
    name: 'craft',
    description:
      'Craft an item (e.g. oak_planks, stick, crafting_table, wooden_pickaxe). Finds or places a crafting table when needed and turns logs into planks if that is all that is missing.',
    input: {
      type: 'object',
      properties: { item: { type: 'string' }, amount: { type: 'integer', minimum: 1, maximum: 64 } },
      required: ['item'],
    },
    run: (ctx, args) => craft(ctx, String(args.item), amount(args)),
  },
  {
    name: 'mine',
    description: 'Mine blocks of a type it can see nearby (e.g. stone, coal_ore, dirt). Says which tool is missing if it cannot.',
    input: {
      type: 'object',
      properties: { block: { type: 'string' }, amount: { type: 'integer', minimum: 1, maximum: 64 } },
      required: ['block'],
    },
    run: (ctx, args) => mine(ctx, String(args.block), amount(args)),
  },
  {
    name: 'smelt',
    description:
      'Smelt items in a furnace (sand into glass, cobblestone into stone, raw iron into ingots). Finds or places a furnace and burns coal, logs or planks.',
    input: {
      type: 'object',
      properties: { item: { type: 'string' }, amount: { type: 'integer', minimum: 1, maximum: 64 } },
      required: ['item', 'amount'],
    },
    run: (ctx, args) => smelt(ctx, String(args.item), amount(args)),
  },
  {
    name: 'place',
    description: 'Put one block from the inventory on the ground next to it.',
    input: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] },
    run: async (ctx, args) => {
      const block = await placeNear(ctx, String(args.item));
      return `Placed ${block.name} at ${block.position.x} ${block.position.y} ${block.position.z}.`;
    },
  },
  {
    name: 'build',
    description: `Build a structure next to it, or at x y z when given. Known: ${Object.keys(BLUEPRINTS).join(', ')}. It says which materials are missing if it can't.`,
    input: {
      type: 'object',
      properties: {
        structure: { type: 'string', enum: Object.keys(BLUEPRINTS) },
        x: { type: 'integer' },
        y: { type: 'integer' },
        z: { type: 'integer' },
      },
      required: ['structure'],
    },
    run: (ctx, args) => {
      const at = [args.x, args.y, args.z].every((n) => typeof n === 'number')
        ? new Vec3(Number(args.x), Number(args.y), Number(args.z))
        : undefined;
      return build(ctx, String(args.structure), at);
    },
  },
];

export function findSkill(name: string) {
  return SKILLS.find((skill) => skill.name === name);
}
