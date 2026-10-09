// Helpers for the scenario tests: a real server in a throwaway world, and test players
// that talk to the bot like a person would.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mineflayer, { type Bot } from 'mineflayer';
import { spawnServer } from '../../scripts/server.ts';

export const VERSION = '1.21.1';

export interface TestServer {
  port: number;
  /** Runs a command in the server console, like "tp Tester 0 -60 0". */
  command(line: string): void;
  stop(): Promise<void>;
}

export async function startServer(port: number): Promise<TestServer> {
  // a new folder each time, so every run starts from the same untouched world
  const universe = mkdtempSync(path.join(os.tmpdir(), 'mc-scenario-'));
  const server = spawnServer({ port, universe, memory: '1G', stdio: ['pipe', 'pipe', 'pipe'] });

  let output = '';
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server didn't start in 120s:\n${output.slice(-2000)}`)), 120_000);
    server.stdout!.on('data', (chunk: Buffer) => {
      output += chunk;
      if (output.includes('Done (')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr!.on('data', (chunk: Buffer) => (output += chunk));
    server.on('exit', (code) => reject(new Error(`server closed with code ${code}:\n${output.slice(-2000)}`)));
  });

  return {
    port,
    command: (line) => server.stdin!.write(`${line}\n`),
    stop: async () => {
      const closed = new Promise((resolve) => server.once('exit', resolve));
      server.stdin!.write('stop\n');
      await Promise.race([closed, sleep(20_000)]);
      server.kill();
      rmSync(universe, { recursive: true, force: true });
    },
  };
}

/** A plain mineflayer player, without the agent's brain, that resolves once it's in the world. */
export async function joinPlayer(username: string, port: number): Promise<Bot> {
  const bot = mineflayer.createBot({ host: 'localhost', port, username, version: VERSION, auth: 'offline' });
  await new Promise<void>((resolve, reject) => {
    bot.once('spawn', () => resolve());
    bot.once('kicked', (reason) => reject(new Error(`${username} was kicked: ${JSON.stringify(reason)}`)));
    bot.once('error', reject);
  });
  return bot;
}

/** Polls until check() is true; the message says what was expected when it times out. */
export async function waitFor(check: () => boolean, message: string, timeout = 15_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`timed out after ${timeout / 1000}s: ${message}`);
    await sleep(100);
  }
}

/** Resolves with the next chat line from `from` that matches, as seen by `listener`. */
export function nextChat(listener: Bot, from: string, match: RegExp, timeout = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      listener.off('chat', onChat);
      reject(new Error(`${from} never said something like ${match}`));
    }, timeout);
    function onChat(player: string, message: string) {
      if (player !== from || !match.test(message)) return;
      clearTimeout(timer);
      listener.off('chat', onChat);
      resolve(message);
    }
    listener.on('chat', onChat);
  });
}

export function distance(a: Bot, b: Bot) {
  return a.entity.position.distanceTo(b.entity.position);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
