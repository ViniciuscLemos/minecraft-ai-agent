// Planner backend that asks Claude through the Claude Code CLI in headless mode
// (`claude -p`), so it runs on the Claude plan you're already logged into instead of a
// paid API key. Every call counts against that plan's usage, so it uses Sonnet and sends
// one request per plan, never a call per block.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PlanError,
  requestPrompt,
  STEPS_SCHEMA,
  SYSTEM_PROMPT,
  validateSteps,
  type Failure,
  type Planner,
  type WorldState,
} from './index.ts';

const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';

/**
 * Where the CLI lives: CLAUDE_BIN, then the copy the desktop app keeps for itself (on
 * Windows the Store app puts it under Packages, one folder per version: the newest wins),
 * then `claude` from the PATH.
 */
export function findClaude(env = process.env): string {
  if (env.CLAUDE_BIN) return env.CLAUDE_BIN;
  const roots = [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude-code'),
    env.APPDATA && path.join(env.APPDATA, 'Claude', 'claude-code'),
  ].filter((root): root is string => !!root && existsSync(root));
  const found: { file: string; time: number }[] = [];
  for (const root of roots) {
    for (const version of readdirSync(root)) {
      const dir = path.join(root, version);
      // either <version>/claude.exe or <version>/<hash>/claude.exe
      const places = [dir, ...safeList(dir).map((d) => path.join(dir, d))];
      for (const place of places) {
        const file = path.join(place, exe);
        if (existsSync(file)) found.push({ file, time: statSync(file).mtimeMs });
      }
    }
  }
  found.sort((a, b) => b.time - a.time);
  return found[0]?.file ?? 'claude';
}

function safeList(dir: string) {
  try {
    return readdirSync(dir).filter((d) => statSync(path.join(dir, d)).isDirectory());
  } catch {
    return [];
  }
}

export function cliArgs(prompt: string, model = 'sonnet') {
  return [
    '-p', prompt,
    '--model', model,
    '--tools', '', // it only plans: no file or shell access
    '--no-session-persistence',
    '--system-prompt', SYSTEM_PROMPT,
    '--json-schema', JSON.stringify(STEPS_SCHEMA),
    '--output-format', 'json',
  ];
}

/** Reads the CLI's --output-format json answer; the plan is in structured_output. */
export function parseAnswer(stdout: string) {
  let answer: { is_error?: boolean; result?: string; structured_output?: unknown };
  try {
    answer = JSON.parse(stdout);
  } catch {
    throw new PlanError(`Claude's answer wasn't JSON: ${stdout.slice(0, 200)}`);
  }
  if (answer.is_error) throw new PlanError(`Claude said: ${answer.result ?? 'an error'}`);
  return validateSteps(answer.structured_output);
}

export type Exec = (bin: string, args: string[], cwd: string) => Promise<string>;

const exec: Exec = (bin, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    // a plan takes a few seconds; a minute means something is stuck (a login prompt...)
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on('error', (error) => reject(new PlanError(`Couldn't run ${bin}: ${error.message}. Set CLAUDE_BIN in .env.`)));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new PlanError(`claude exited with ${code}: ${(err || out).trim().slice(0, 300)}`));
    });
  });

export class ClaudeCliPlanner implements Planner {
  // an empty folder, so it doesn't pick up a CLAUDE.md or settings from wherever the bot runs
  private cwd?: string;

  private readonly options: { bin?: string; model?: string; run?: Exec };

  constructor(options: { bin?: string; model?: string; run?: Exec } = {}) {
    this.options = options;
  }

  plan(request: string, state: WorldState) {
    return this.ask(requestPrompt(request, state));
  }

  replan(request: string, state: WorldState, failure: Failure) {
    return this.ask(requestPrompt(request, state, failure));
  }

  private async ask(prompt: string) {
    const run = this.options.run ?? exec;
    this.cwd ??= mkdtempSync(path.join(os.tmpdir(), 'mc-planner-'));
    const stdout = await run(this.options.bin ?? findClaude(), cliArgs(prompt, this.options.model), this.cwd);
    return parseAnswer(stdout);
  }
}
