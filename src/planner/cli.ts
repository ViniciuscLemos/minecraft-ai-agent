// Planner backend that runs an AI assistant's command-line program in headless mode
// (AI_CLI in .env), so it uses the account you're already logged into instead of a paid
// API key. Every call counts against that account's usage, so it can take a lighter model
// (AI_MODEL) and sends one request per plan, never a call per block.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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

export function cliArgs(prompt: string, model?: string) {
  return [
    '-p', prompt,
    ...(model ? ['--model', model] : []),
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
    throw new PlanError(`The planner's answer wasn't JSON: ${stdout.slice(0, 200)}`);
  }
  if (answer.is_error) throw new PlanError(`The planner said: ${answer.result ?? 'an error'}`);
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
    child.on('error', (error) => reject(new PlanError(`Couldn't run ${bin}: ${error.message}. Check AI_CLI in .env.`)));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new PlanError(`the planner exited with ${code}: ${(err || out).trim().slice(0, 300)}`));
    });
  });

export class CliPlanner implements Planner {
  // an empty folder, so it doesn't pick up project files or settings from wherever the bot runs
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
    const bin = this.options.bin ?? process.env.AI_CLI;
    if (!bin) throw new PlanError('No planner set up: put the path of the AI command-line program in AI_CLI (.env).');
    const run = this.options.run ?? exec;
    this.cwd ??= mkdtempSync(path.join(os.tmpdir(), 'mc-planner-'));
    const stdout = await run(bin, cliArgs(prompt, this.options.model ?? (process.env.AI_MODEL || undefined)), this.cwd);
    return parseAnswer(stdout);
  }
}
