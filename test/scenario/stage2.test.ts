// Stage 2 against a real server: the skills from wood to a house, and the reflexes.
import type { Bot } from 'mineflayer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAgentBot, runSkill } from '../../src/bot.ts';
import { house } from '../../src/skills/build.ts';
import { countItem, isLog } from '../../src/skills/context.ts';
import { Vec3 } from 'vec3';
import { joinPlayer, nextChat, sleep, startServer, VERSION, waitFor, type TestServer } from './harness.ts';

const PORT = 25602;
const BOT = 'Steve_AI';

let server: TestServer;
let owner: Bot;
let agent: Bot;

beforeAll(async () => {
  server = await startServer(PORT);
  owner = await joinPlayer('Tester', PORT);
  const greeting = nextChat(owner, BOT, /!help/);
  agent = createAgentBot({ host: 'localhost', port: PORT, version: VERSION, username: BOT, owners: ['Tester'] });
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

describe('skills', () => {
  it('chops a tree for logs', async () => {
    server.command('place feature minecraft:oak 7 -60 2');
    await waitFor(() => agent.findBlock({ matching: (b) => isLog(b.name), maxDistance: 16 }) !== null, 'the tree to show up');

    const result = await runSkill(agent, 'collect_wood', { amount: 3 });
    expect(result).toMatch(/^Got \d+ logs/);
    expect(countItem(agent, isLog)).toBeGreaterThanOrEqual(3);
  });

  it('says which tool is missing instead of punching stone', async () => {
    server.command('setblock 3 -60 -4 minecraft:stone');
    await sleep(500);
    const result = await runSkill(agent, 'mine', { block: 'stone', amount: 1 });
    expect(result).toBe('I need a wooden_pickaxe (or better) to mine stone.');
  });

  it('crafts a pickaxe from logs, making the planks, sticks and table on the way', async () => {
    const result = await runSkill(agent, 'craft', { item: 'wooden_pickaxe' });
    expect(result).toMatch(/^Crafted 1 wooden_pickaxe/);
    expect(agent.findBlock({ matching: agent.registry.blocksByName.crafting_table!.id, maxDistance: 8 })).not.toBeNull();
  });

  it('mines the stone once it has the pickaxe', async () => {
    const result = await runSkill(agent, 'mine', { block: 'stone', amount: 1 });
    expect(result).toMatch(/^Mined 1 stone/);
    expect(countItem(agent, (name) => name === 'cobblestone')).toBe(1);
  });

  it('explains what is missing to build a house', async () => {
    const result = await runSkill(agent, 'build', { structure: 'hut' });
    expect(result).toMatch(/^A hut takes \d+ planks and I have \d+\. I need \d+ more\.$/);
  });

  it('builds a small house from planks', async () => {
    server.command(`give ${BOT} minecraft:oak_planks 64`);
    await waitFor(() => countItem(agent, (name) => name === 'oak_planks') >= 64, 'the planks to arrive');

    const result = await runSkill(agent, 'build', { structure: 'hut', x: -8, y: -60, z: 4 });
    expect(result).toBe('Built a hut at -8 -60 4.');
    const corner = new Vec3(-8, -60, 4);
    const misplaced = house(4, 4, 2).blocks.filter((offset) => agent.blockAt(corner.plus(offset))?.name !== 'oak_planks');
    expect(misplaced).toEqual([]);
  }, 120_000);

  it('drops what it is doing on !stop', async () => {
    server.command('place feature minecraft:oak 30 -60 30');
    await sleep(500);
    const working = runSkill(agent, 'collect_wood', { amount: 20 });
    await sleep(1500);
    owner.chat('!stop');
    expect(await working).toBe('Stopped.');
    await sleep(1000);
    expect(agent.pathfinder.isMoving()).toBe(false);
  });
});

describe('reflexes', () => {
  it('eats when it gets hungry', async () => {
    server.command(`give ${BOT} minecraft:bread 5`);
    // peaceful refills hunger by itself, so this one needs a real difficulty
    server.command('difficulty easy');
    server.command(`effect give ${BOT} minecraft:hunger 20 255`);
    await waitFor(() => agent.food < 14, 'the bot to get hungry', 30_000);
    await waitFor(() => countItem(agent, (name) => name === 'bread') < 5, 'the bot to eat some bread', 20_000);
    server.command(`effect clear ${BOT}`);
    server.command('difficulty peaceful');
  }, 60_000);
});
