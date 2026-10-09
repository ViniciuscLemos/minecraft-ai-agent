// Shared by `npm run server` and the scenario tests: finds a Java that can run the server
// and starts it from .server/.
import { spawn, spawnSync, type ChildProcess, type StdioOptions } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SERVER_FOLDER = path.resolve(import.meta.dirname, '..', '.server');

// Minecraft 1.21 is compiled for Java 21
const MIN_JAVA = 21;

const exe = process.platform === 'win32' ? 'java.exe' : 'java';

/** Major version of a java executable, or null when it doesn't run. */
export function javaVersion(java: string): number | null {
  const result = spawnSync(java, ['-version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  // `java -version` prints to stderr, like: openjdk version "21.0.4" 2024-07-16
  const match = /version "(\d+)(?:\.(\d+))?/.exec(result.stderr);
  if (!match) return null;
  const major = Number(match[1]);
  return major === 1 ? Number(match[2]) : major; // old style "1.8.0" means 8
}

/**
 * Where to look, in order: MC_JAVA, JAVA_HOME, a Temurin install on Windows, then `java`
 * from the PATH. JAVA_HOME is often an older Java used for other projects, so every
 * candidate is checked instead of trusting the first one.
 */
export function javaCandidates(env = process.env): string[] {
  const list: string[] = [];
  if (env.MC_JAVA) list.push(env.MC_JAVA);
  if (env.JAVA_HOME) list.push(path.join(env.JAVA_HOME, 'bin', exe));

  const adoptium = 'C:/Program Files/Eclipse Adoptium';
  if (process.platform === 'win32' && existsSync(adoptium)) {
    const jdks = readdirSync(adoptium).filter((d) => /^jdk-\d+/.test(d));
    jdks.sort((a, b) => Number(/\d+/.exec(b)![0]) - Number(/\d+/.exec(a)![0]));
    list.push(...jdks.map((d) => path.join(adoptium, d, 'bin', exe)));
  }
  // JAVA_HOME is usually one of the Temurin folders too, no need to run it twice
  return [...new Set(list.map((java) => path.normalize(java))), 'java'];
}

export function findJava(env = process.env): string {
  const found: string[] = [];
  for (const java of javaCandidates(env)) {
    const version = javaVersion(java);
    if (version !== null && version >= MIN_JAVA) return java;
    if (version !== null) found.push(`${java} (Java ${version})`);
  }
  const seen = found.length ? ` Found only: ${found.join(', ')}.` : '';
  throw new Error(`Minecraft 1.21 needs Java ${MIN_JAVA} or newer.${seen} Install it or point MC_JAVA to it.`);
}

/**
 * On Windows, Java's network selector opens a Unix socket in the temp folder. When the
 * user name has an accent (like C:\Users\Usuário) that fails with "Invalid argument:
 * connect" and the server crashes on start, so the socket goes to a plain ASCII folder.
 */
export function unixSocketDir(tmp = os.tmpdir(), platform = process.platform): string | null {
  if (platform !== 'win32') return null;
  // TEMP is often the short 8.3 name (USURIO~1), but Java expands it to the real one
  const real = existsSync(tmp) ? realpathSync.native(tmp) : tmp;
  if (/^[\x20-\x7e]*$/.test(real)) return null;
  const dir = path.join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'minecraft-ai-agent-tmp');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface ServerOptions {
  port?: number;
  // folder for the world; a fresh one gives every test run a clean map
  universe?: string;
  memory?: string;
  stdio?: StdioOptions;
}

export function spawnServer(options: ServerOptions = {}): ChildProcess {
  if (!existsSync(path.join(SERVER_FOLDER, 'server.jar'))) {
    throw new Error('No server yet. Run: npm run server:setup');
  }
  const memory = options.memory ?? process.env.MC_SERVER_MEMORY ?? '2G';
  const args = [`-Xmx${memory}`, `-Xms${memory}`];
  const socketDir = unixSocketDir();
  if (socketDir) args.push(`-Djdk.net.unixdomain.tmpdir=${socketDir}`);
  args.push('-jar', 'server.jar', 'nogui');
  if (options.port) args.push('--port', String(options.port));
  if (options.universe) args.push('--universe', options.universe);
  return spawn(findJava(), args, { cwd: SERVER_FOLDER, stdio: options.stdio ?? 'inherit' });
}
