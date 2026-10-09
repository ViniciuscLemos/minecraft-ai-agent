// Stage 1 against a real server: a test player gives chat orders and checks where the bot ends up.
import type { Bot } from 'mineflayer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAgentBot } from '../../src/bot.ts';
import { distance, joinPlayer, nextChat, sleep, startServer, VERSION, waitFor, type TestServer } from './harness.ts';

const PORT = 25601;

let server: TestServer;
let owner: Bot;
let agent: Bot;

beforeAll(async () => {
  server = await startServer(PORT);
  owner = await joinPlayer('Tester', PORT);
  const greeting = nextChat(owner, 'Steve_AI', /!help/);
  agent = createAgentBot({ host: 'localhost', port: PORT, version: VERSION, username: 'Steve_AI', owners: ['Tester'] });
  await greeting;
});

afterAll(async () => {
  agent?.quit();
  owner?.quit();
  await server?.stop();
});

describe('stage 1 on a real server', () => {
  it('says where it is', async () => {
    const reply = nextChat(owner, 'Steve_AI', /^I'm at/);
    owner.chat('!where');
    const { x, y, z } = agent.entity.position.floored();
    expect(await reply).toBe(`I'm at ${x} ${y} ${z}.`);
  });

  it('walks to the coordinates it was given', async () => {
    owner.chat('!goto 12 -9');
    await waitFor(() => {
      const { x, z } = agent.entity.position;
      return Math.hypot(x - 12.5, z + 8.5) < 1.5;
    }, 'the bot to reach 12 -9');
  });

  it('follows the player around and keeps a small distance', async () => {
    await nextChatAfter(() => owner.chat('!follow'), /^Following you/);
    server.command('tp Tester 20 -60 20');
    await waitFor(() => distance(agent, owner) < 3.5, 'the bot to catch up with the player', 20_000);
  });

  it('stops when told to', async () => {
    await nextChatAfter(() => owner.chat('!stop'), /^Stopped/);
    const before = agent.entity.position.clone();
    server.command('tp Tester 0 -60 -15');
    await sleep(3000);
    expect(agent.entity.position.distanceTo(before)).toBeLessThan(1);
  });

  it('explains a command it does not know', async () => {
    const reply = await nextChatAfter(() => owner.chat('!dance'), /dance/);
    expect(reply).toBe('I don\'t know "!dance". Try !help');
  });

  it('ignores orders from players who are not the owner', async () => {
    const stranger = await joinPlayer('Stranger', PORT);
    try {
      const refusal = new Promise<string>((resolve) => stranger.once('whisper', (_from, message) => resolve(message)));
      const before = agent.entity.position.clone();
      stranger.chat('!come');
      expect(await refusal).toMatch(/only take orders from my owner/);
      await sleep(1500);
      expect(agent.entity.position.distanceTo(before)).toBeLessThan(1);
    } finally {
      stranger.quit();
    }
  });
});

function nextChatAfter(send: () => void, match: RegExp) {
  const reply = nextChat(owner, 'Steve_AI', match);
  send();
  return reply;
}
