// Runs a plan (a list of skill steps) one step at a time. It stops at the first step that
// fails and says which one and why: that's what the AI planner will get back to replan.
import { BLUEPRINTS, materialsNeeded } from '../skills/build.ts';
import { checkAborted, SkillError, type SkillContext } from '../skills/context.ts';
import { reserve } from '../skills/reserve.ts';
import { paletteFor } from './survival.ts';
import { findSkill, type Skill } from '../skills/index.ts';
import type { Step } from './survival.ts';

export type PlanResult =
  | { ok: true; results: string[] }
  | { ok: false; results: string[]; failed: { index: number; step: Step; error: string } };

export async function runPlan(
  ctx: SkillContext,
  steps: Step[],
  find: (name: string) => Skill | undefined = findSkill,
): Promise<PlanResult> {
  const results: string[] = [];
  // what the build at the end will need stays put while the steps before it craft and smelt
  reserve(ctx.bot, materialsFor(steps));
  try {
    return await runSteps(ctx, steps, find, results);
  } finally {
    reserve(ctx.bot, null);
  }
}

async function runSteps(
  ctx: SkillContext,
  steps: Step[],
  find: (name: string) => Skill | undefined,
  results: string[],
): Promise<PlanResult> {
  for (const [index, step] of steps.entries()) {
    checkAborted(ctx);
    ctx.log(`step ${index + 1}/${steps.length}: ${step.skill} ${describeArgs(step.args)} (${step.why})`);
    const skill = find(step.skill);
    try {
      if (!skill) throw new SkillError(`I don't have a skill called ${step.skill}.`);
      const result = await skill.run(ctx, step.args);
      results.push(result);
      ctx.log(result);
    } catch (error) {
      // a bug (not a SkillError) still stops the plan, but it has to show up as one
      if (!(error instanceof SkillError)) throw error;
      return { ok: false, results, failed: { index, step, error: error.message } };
    }
  }
  return { ok: true, results };
}

/** The materials of the structure the plan builds, by exact item name ("planks" or "log" can't be reserved). */
export function materialsFor(steps: Step[]): Map<string, number> | null {
  const build = steps.find((step) => step.skill === 'build');
  const make = build && BLUEPRINTS[String(build.args.structure ?? '').toLowerCase()];
  if (!make) return null;
  const woods = Array.isArray(build.args.woods) ? build.args.woods.map(String) : [];
  const needed = materialsNeeded(make(woods.length ? paletteFor(woods) : undefined).blocks);
  for (const generic of ['planks', 'log']) needed.delete(generic);
  return needed;
}

export function describeArgs(args: Record<string, unknown>) {
  return Object.entries(args)
    .map(([key, value]) => (key === 'amount' ? String(value) : Array.isArray(value) ? value.join('+') : String(value)))
    .join(' ');
}
