import { describe, expect, it } from 'vitest';
import { cliArgs, ClaudeCliPlanner, findClaude, parseAnswer } from '../src/planner/claude-cli.ts';
import { carryOut, PlanError, requestPrompt, validateSteps, type Planner, type Step, type WorldState } from '../src/planner/index.ts';
import { ScriptedPlanner, structureIn } from '../src/planner/scripted.ts';
import type { PlanResult } from '../src/plans/run.ts';
import type { SkillContext } from '../src/skills/context.ts';

const state: WorldState = {
  inventory: { oak_log: 3 },
  position: { x: 10.4, y: 64, z: -3.6 },
  nearby: ['stone 6 blocks away'],
  woods: ['oak', 'birch'],
};

// an answer as `claude -p --output-format json` gives it (trimmed), recorded on 09/10
const recorded = JSON.stringify({
  type: 'result',
  is_error: false,
  result: '',
  structured_output: {
    steps: [
      { skill: 'craft', args: { item: 'wooden_pickaxe', amount: 1 }, why: 'stone needs a pickaxe' },
      { skill: 'mine', args: { block: 'stone', amount: 8 }, why: 'cobblestone for a furnace' },
      { skill: 'craft', args: { item: 'furnace', amount: 1 }, why: 'to smelt sand' },
    ],
  },
});

describe('validateSteps', () => {
  it('keeps a good plan as it is', () => {
    const steps = validateSteps({ steps: [{ skill: 'collect_wood', args: { amount: 4 }, why: 'logs' }] });
    expect(steps).toEqual([{ skill: 'collect_wood', args: { amount: 4 }, why: 'logs' }]);
  });

  it('turns down skills the bot does not have', () => {
    expect(() => validateSteps({ steps: [{ skill: 'fly', args: {}, why: '' }] })).toThrow(/skill I don't have: fly/);
  });

  it('turns down missing required arguments and empty plans', () => {
    expect(() => validateSteps({ steps: [{ skill: 'craft', args: { amount: 2 }, why: '' }] })).toThrow(/missing item/);
    expect(() => validateSteps({ steps: [] })).toThrow(PlanError);
    expect(() => validateSteps('nope')).toThrow(/no list of steps/);
  });
});

describe('requestPrompt', () => {
  it('has the request, the state and every skill', () => {
    const prompt = requestPrompt('make a furnace', state);
    expect(prompt).toContain('Request: make a furnace');
    expect(prompt).toContain('Inventory: 3 oak_log.');
    expect(prompt).toContain('Position: 10 64 -4.');
    expect(prompt).toContain('Trees around: oak, birch.');
    for (const skill of ['collect_wood', 'craft', 'mine', 'smelt', 'place', 'build']) expect(prompt).toContain(`- ${skill}:`);
  });

  it('tells why the last plan stopped and what already worked', () => {
    const failure = { step: { skill: 'mine', args: { block: 'cobblestone' }, why: '' }, error: 'No cobblestone around.', done: ['Crafted 1 wooden_pickaxe.'] };
    const prompt = requestPrompt('make a furnace', state, failure);
    expect(prompt).toContain('stopped at "mine {"block":"cobblestone"}": No cobblestone around.');
    expect(prompt).toContain('Steps that worked before it: Crafted 1 wooden_pickaxe.');
  });

  it('adds the bill of materials when the request names a structure', () => {
    const prompt = requestPrompt('build a farmhouse', state);
    // oak and birch around: birch walls, oak roof (paletteFor), and the build step gets the same woods
    expect(prompt).toMatch(/Building a farmhouse takes: .*\d+ birch_planks/);
    expect(prompt).toMatch(/\d+ oak_stairs/);
    expect(prompt).toContain('build {"structure":"farmhouse","woods":["oak","birch"]}');
    expect(requestPrompt('make a furnace', state)).not.toContain('takes:');
  });
});

describe('claude-cli backend', () => {
  it('asks for a structured answer with no tools, on sonnet', () => {
    const args = cliArgs('hi');
    expect(args.slice(0, 4)).toEqual(['-p', 'hi', '--model', 'sonnet']);
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(JSON.parse(args[args.indexOf('--json-schema') + 1]!).required).toEqual(['steps']);
  });

  it('reads the plan out of structured_output', () => {
    expect(parseAnswer(recorded).map((s) => s.skill)).toEqual(['craft', 'mine', 'craft']);
  });

  it('turns errors and junk into PlanErrors', () => {
    expect(() => parseAnswer(JSON.stringify({ is_error: true, result: 'usage limit' }))).toThrow(/usage limit/);
    expect(() => parseAnswer('Please log in')).toThrow(/wasn't JSON/);
  });

  it('runs the binary it was given and passes the failure on a replan', async () => {
    const calls: { bin: string; prompt: string }[] = [];
    const planner = new ClaudeCliPlanner({
      bin: 'fake-claude',
      run: async (bin, args) => {
        calls.push({ bin, prompt: args[1]! });
        return recorded;
      },
    });
    await planner.plan('make a furnace', state);
    await planner.replan('make a furnace', state, { step: { skill: 'mine', args: {}, why: '' }, error: 'Too far.', done: [] });
    expect(calls.map((c) => c.bin)).toEqual(['fake-claude', 'fake-claude']);
    expect(calls[1]!.prompt).toContain('Too far.');
  });

  it('takes CLAUDE_BIN over anything it would find', () => {
    expect(findClaude({ CLAUDE_BIN: 'C:/tools/claude.exe' })).toBe('C:/tools/claude.exe');
    expect(findClaude({})).toBe('claude');
  });
});

describe('scripted backend', () => {
  it('finds the structure in the request', () => {
    expect(structureIn('please build a cottage by the lake')).toBe('cottage');
    expect(structureIn('make me a house')).toBe('house');
    expect(structureIn('I need a home')).toBe('farmhouse');
    expect(structureIn('get some wood')).toBeUndefined();
  });

  it('plans the whole way to the build and says what it cannot do', async () => {
    const planner = new ScriptedPlanner();
    const steps = await planner.plan('build a farmhouse', { ...state, inventory: {} });
    expect(steps[0]!.skill).toBe('collect_wood');
    expect(steps.at(-1)).toMatchObject({ skill: 'build', args: { structure: 'farmhouse' } });
    await expect(planner.plan('dance', state)).rejects.toThrow(/only build things/);
  });
});

describe('carryOut', () => {
  const ctx = { bot: {} as never, signal: new AbortController().signal, log: () => {} } satisfies SkillContext;
  const step = (skill: string): Step => ({ skill, args: {}, why: '' });

  it('replans with the error until it works', async () => {
    const asked: string[] = [];
    const planner: Planner = {
      plan: async () => [step('mine')],
      replan: async (_request, _state, failure) => {
        asked.push(failure.error);
        return [step('craft')];
      },
    };
    const run = async (_ctx: SkillContext, steps: Step[]): Promise<PlanResult> =>
      steps[0]!.skill === 'mine'
        ? { ok: false, results: [], failed: { index: 0, step: steps[0]!, error: 'no stone' } }
        : { ok: true, results: ['ok'] };
    const result = await carryOut(ctx, planner, 'x', () => state, { run });
    expect(result.ok).toBe(true);
    expect(asked).toEqual(['no stone']);
  });

  it('gives up after the replans run out', async () => {
    let replans = 0;
    const planner: Planner = { plan: async () => [step('mine')], replan: async () => (replans++, [step('mine')]) };
    const run = async (_ctx: SkillContext, steps: Step[]): Promise<PlanResult> => ({
      ok: false, results: [], failed: { index: 0, step: steps[0]!, error: 'no' },
    });
    const result = await carryOut(ctx, planner, 'x', () => state, { run, replans: 2 });
    expect(result.ok).toBe(false);
    expect(replans).toBe(2);
  });
});
