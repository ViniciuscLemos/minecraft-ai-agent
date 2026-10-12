// The planner turns a plain text request ("build a small house next to me") into a list of
// skill steps, and gets the failed step back to plan again from where things are. The
// backends (Claude through the CLI, or the scripted survival plan) all fit this interface,
// and the loop below doesn't care which one it talks to.
import type { Step } from '../plans/survival.ts';
import { runPlan, type PlanResult } from '../plans/run.ts';
import { SKILLS, type Skill, type SkillContext } from '../skills/index.ts';
import { buildingNotes } from './notes.ts';

export type { Step };

/** What the bot has and sees, sent along with every request. */
export interface WorldState {
  inventory: Record<string, number>;
  position: { x: number; y: number; z: number };
  // trees, ores, water... worth mentioning, with how far they are
  nearby: string[];
  // the kinds of trees around (oak, birch...): the farmhouse takes its colours from them
  woods: string[];
}

export interface Failure {
  step: Step;
  error: string;
  // what the steps before it said, so the planner knows what already got done
  done: string[];
}

export interface Planner {
  plan(request: string, state: WorldState): Promise<Step[]>;
  replan(request: string, state: WorldState, failure: Failure): Promise<Step[]>;
}

export class PlanError extends Error {}

export const SYSTEM_PROMPT = [
  'You plan for a Minecraft bot. You never control it directly: you answer with a list of steps,',
  'each one a skill from the list with its arguments, and the bot runs them in order.',
  'Use only the skills listed, with exact Minecraft ids (oak_log, cobblestone, glass_pane).',
  'A block is not always what it drops: stone drops cobblestone, coal_ore drops coal, grass_block drops dirt.',
  'Craft the tools a step needs before it (a wooden_pickaxe before mining stone).',
  'Count what the inventory already has. Keep plans short: no steps that are not needed.',
  'If a step failed, read why and plan the rest from the current state. Do not repeat what already worked.',
].join('\n');

/** The steps format Claude has to answer in (its --json-schema). */
export const STEPS_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          skill: { type: 'string', enum: SKILLS.map((skill) => skill.name) },
          args: { type: 'object' },
          why: { type: 'string' },
        },
        required: ['skill', 'args', 'why'],
      },
    },
  },
  required: ['steps'],
};

export function describeSkills(skills: Skill[] = SKILLS) {
  return skills.map((skill) => `- ${skill.name}: ${skill.description} Args: ${JSON.stringify(skill.input.properties)}`).join('\n');
}

export function describeState(state: WorldState) {
  const items = Object.entries(state.inventory).map(([name, count]) => `${count} ${name}`);
  const { x, y, z } = state.position;
  return [
    `Inventory: ${items.length ? items.join(', ') : 'empty'}.`,
    `Position: ${Math.round(x)} ${Math.round(y)} ${Math.round(z)}.`,
    `Trees around: ${state.woods.length ? state.woods.join(', ') : 'none'}.`,
    `Nearby: ${state.nearby.length ? state.nearby.join('; ') : 'nothing worth mentioning'}.`,
  ].join('\n');
}

export function requestPrompt(request: string, state: WorldState, failure?: Failure) {
  const parts = [`Request: ${request}`, describeState(state), `Skills:\n${describeSkills()}`];
  const notes = buildingNotes(request, state.woods);
  if (notes) parts.push(notes);
  if (failure) {
    parts.push(
      `The last plan stopped at "${failure.step.skill} ${JSON.stringify(failure.step.args)}": ${failure.error}`,
      failure.done.length ? `Steps that worked before it: ${failure.done.join(' | ')}` : 'Nothing before it worked.',
      'Plan the rest from here.',
    );
  }
  return parts.join('\n\n');
}

/**
 * Checks a plan that came from outside (a model's answer) before the bot runs anything:
 * known skills, arguments as an object, required arguments there.
 */
export function validateSteps(value: unknown, skills: Skill[] = SKILLS): Step[] {
  const steps = (value as { steps?: unknown })?.steps;
  if (!Array.isArray(steps)) throw new PlanError('The plan has no list of steps.');
  if (steps.length === 0) throw new PlanError('The plan is empty.');
  return steps.map((raw, index) => {
    const step = raw as Partial<Step>;
    const skill = skills.find((s) => s.name === step.skill);
    if (!skill) throw new PlanError(`Step ${index + 1} uses a skill I don't have: ${String(step.skill)}.`);
    if (!step.args || typeof step.args !== 'object' || Array.isArray(step.args)) {
      throw new PlanError(`Step ${index + 1} (${skill.name}) has no arguments object.`);
    }
    const missing = (skill.input.required ?? []).filter((name) => !(name in step.args!));
    if (missing.length) throw new PlanError(`Step ${index + 1} (${skill.name}) is missing ${missing.join(', ')}.`);
    return { skill: skill.name, args: step.args, why: typeof step.why === 'string' ? step.why : '' };
  });
}

/**
 * Plans, runs, and when a step fails asks for a new plan with the error, up to `replans`
 * times. Same loop for the chat request and the survival script.
 */
export async function carryOut(
  ctx: SkillContext,
  planner: Planner,
  request: string,
  state: () => WorldState,
  { replans = 3, run = runPlan }: { replans?: number; run?: typeof runPlan } = {},
): Promise<PlanResult> {
  let steps = await planner.plan(request, state());
  ctx.log(`plan: ${steps.map((s) => s.skill).join(' > ')}`);
  let result = await run(ctx, steps);
  for (let round = 1; !result.ok && round <= replans; round++) {
    const failure = { step: result.failed.step, error: result.failed.error, done: result.results };
    ctx.log(`step ${result.failed.index + 1} failed (${failure.error}), planning again`);
    steps = await planner.replan(request, state(), failure);
    ctx.log(`new plan: ${steps.map((s) => s.skill).join(' > ')}`);
    result = await run(ctx, steps);
  }
  return result;
}
