// Stage 3 against a real server: a request goes through a planner, the steps run as
// skills, and a step that fails goes back to the planner with the error. The planner here
// is a fake with fixed answers: the real one (claude -p) never runs in tests or CI.
import type { Bot } from 'mineflayer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { createAgentBot, runRequest } from '../../src/bot.ts';
import type { Failure, Planner, WorldState } from '../../src/planner/index.ts';
import type { Step } from '../../src/plans/survival.ts';
import { countItem } from '../../src/skills/context.ts';
import { joinPlayer, nextChat, sleep, startServer, VERSION, waitFor, type TestServer } from './harness.ts';

const PORT = 25603;
const BOT = 'Steve_AI';

let server: TestServer;
let owner: Bot;
let agent: Bot;

beforeAll(async () => {
  server = await startServer(PORT);
  owner = await joinPlayer('Tester', PORT);
  const greeting = nextChat(owner, BOT, /!help/);
  // the chat test below needs the planner that works without Claude
  agent = createAgentBot({ host: 'localhost', port: PORT, version: VERSION, username: BOT, owners: ['Tester'], planner: 'scripted' });
  await greeting;
  server.command(`tp ${BOT} 0 -60 0`);
  server.command('tp Tester -3 -60 -3');
  await waitFor(() => agent.entity.position.distanceTo(new Vec3(0.5, -60, 0.5)) < 2, 'the bot to be teleported');
});

afterAll(async () => {
  agent?.quit();
  owner?.quit();
  await server?.stop();
});

/** Answers with the given plans in order and remembers what it was asked. */
class FakePlanner implements Planner {
  states: WorldState[] = [];
  failures: Failure[] = [];
  private plans: Step[][];
  constructor(plans: Step[][]) {
    this.plans = plans;
  }

  async plan(_request: string, state: WorldState) {
    this.states.push(state);
    return this.next();
  }

  async replan(_request: string, state: WorldState, failure: Failure) {
    this.states.push(state);
    this.failures.push(failure);
    return this.next();
  }

  private next() {
    const plan = this.plans.shift();
    if (!plan) throw new Error('the fake planner ran out of answers');
    return plan;
  }
}

describe('requests', () => {
  it('replans with the error when a step fails, like Claude asking for cobblestone blocks', async () => {
    server.command(`give ${BOT} minecraft:wooden_pickaxe`);
    server.command('fill 3 -60 -5 5 -60 -5 minecraft:stone');
    await waitFor(() => countItem(agent, (name) => name === 'wooden_pickaxe') === 1, 'the pickaxe to arrive');
    await sleep(500);

    // the mistake the real planner made once: there is no cobblestone block around, it's stone
    const planner = new FakePlanner([
      [{ skill: 'mine', args: { block: 'cobblestone', amount: 3 }, why: 'need cobblestone' }],
      [{ skill: 'mine', args: { block: 'stone', amount: 3 }, why: 'stone drops cobblestone' }],
    ]);
    const result = await runRequest(agent, 'get me some cobblestone', planner);

    expect(result).toMatch(/^Mined 3 stone/);
    expect(countItem(agent, (name) => name === 'cobblestone')).toBeGreaterThanOrEqual(3);
    expect(planner.failures).toHaveLength(1);
    expect(planner.failures[0]!.step.args.block).toBe('cobblestone');
    // the second call sees the inventory as it is now
    expect(planner.states[1]!.inventory.wooden_pickaxe).toBe(1);
  }, 120_000);

  it('gives up with the reason when the same step keeps failing the same way', async () => {
    const wrong: Step[] = [{ skill: 'mine', args: { block: 'diamond_ore', amount: 1 }, why: 'shiny' }];
    const planner = new FakePlanner([wrong, wrong, wrong, wrong]);
    const result = await runRequest(agent, 'find a diamond', planner);
    expect(result).toMatch(/^I couldn't finish: /);
    // one replan; the second identical failure isn't worth another call
    expect(planner.failures).toHaveLength(1);
  }, 120_000);

  it('answers a !do it cannot plan without Claude', async () => {
    const reply = nextChat(owner, BOT, /only build/);
    owner.chat(`!do go fishing`);
    expect(await reply).toMatch(/Without Claude I can only build things/);
  });
});
