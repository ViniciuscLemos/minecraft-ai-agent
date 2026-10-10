import { describe, expect, it } from 'vitest';
import { runPlan } from '../src/plans/run.ts';
import { SkillError, type SkillContext } from '../src/skills/context.ts';
import type { Skill } from '../src/skills/index.ts';

function context(controller = new AbortController()) {
  const lines: string[] = [];
  const ctx = { bot: {} as never, signal: controller.signal, log: (text: string) => lines.push(text) } satisfies SkillContext;
  return { ctx, lines, controller };
}

// fake skills: they only record that they ran
function skills(ran: string[], fail: Record<string, Error> = {}) {
  return (name: string): Skill | undefined => ({
    name,
    description: '',
    input: { type: 'object', properties: {} },
    run: async (_ctx, args) => {
      if (fail[name]) throw fail[name];
      ran.push(`${name} ${args.amount}`);
      return `did ${name}`;
    },
  });
}

const steps = [
  { skill: 'collect_wood', args: { type: 'oak_log', amount: 4 }, why: 'logs' },
  { skill: 'mine', args: { block: 'stone', amount: 3 }, why: 'cobblestone' },
  { skill: 'craft', args: { item: 'furnace', amount: 1 }, why: 'glass' },
];

describe('runPlan', () => {
  it('runs every step in order', async () => {
    const ran: string[] = [];
    const { ctx, lines } = context();
    const result = await runPlan(ctx, steps, skills(ran));
    expect(result).toEqual({ ok: true, results: ['did collect_wood', 'did mine', 'did craft'] });
    expect(ran).toEqual(['collect_wood 4', 'mine 3', 'craft 1']);
    expect(lines[0]).toBe('step 1/3: collect_wood oak_log 4 (logs)');
  });

  it('stops at the first failing step and says why', async () => {
    const ran: string[] = [];
    const { ctx } = context();
    const result = await runPlan(ctx, steps, skills(ran, { mine: new SkillError('I need a wooden_pickaxe') }));
    expect(ran).toEqual(['collect_wood 4']);
    expect(result).toMatchObject({ ok: false, failed: { index: 1, error: 'I need a wooden_pickaxe' } });
  });

  it('treats an unknown skill as a failed step', async () => {
    const { ctx } = context();
    const result = await runPlan(ctx, [{ skill: 'fly', args: {}, why: '' }], () => undefined);
    expect(result).toMatchObject({ ok: false, failed: { error: "I don't have a skill called fly." } });
  });

  it('lets real bugs through instead of hiding them as a failed step', async () => {
    const { ctx } = context();
    await expect(runPlan(ctx, steps, skills([], { collect_wood: new TypeError('oops') }))).rejects.toThrow('oops');
  });

  it('stops when it is aborted', async () => {
    const { ctx, controller } = context();
    controller.abort();
    await expect(runPlan(ctx, steps, skills([]))).rejects.toThrow('Stopped.');
  });
});
