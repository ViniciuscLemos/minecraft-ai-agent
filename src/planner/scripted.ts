// Planner backend without any AI: it only knows how to get a structure built from
// scratch (src/plans/survival.ts), and replans by running the same calculation on what
// the bot has now. It's what the survival run uses, and the fallback with no Claude around.
import { survivalPlan } from '../plans/survival.ts';
import { BLUEPRINTS } from '../skills/build.ts';
import { PlanError, type Planner, type WorldState } from './index.ts';
import { structureIn } from './notes.ts';

export { structureIn };

export class ScriptedPlanner implements Planner {
  async plan(request: string, state: WorldState) {
    const structure = structureIn(request);
    if (!structure) {
      throw new PlanError(`Without Claude I can only build things (${Object.keys(BLUEPRINTS).join(', ')}).`);
    }
    return survivalPlan(structure, new Map(Object.entries(state.inventory)), undefined, state.woods);
  }

  replan(request: string, state: WorldState) {
    return this.plan(request, state);
  }
}
