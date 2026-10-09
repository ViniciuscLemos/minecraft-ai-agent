// Starts the local server from .server/ (made by `npm run server:setup`).
// Minecraft 1.21 needs Java 21: it uses JAVA_HOME if set, otherwise looks for a Java 21
// installed by Eclipse Temurin, otherwise tries the `java` on the PATH.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const FOLDER = path.resolve(import.meta.dirname, '..', '.server');

function findJava() {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  if (process.env.JAVA_HOME) return path.join(process.env.JAVA_HOME, 'bin', exe);

  const adoptium = 'C:/Program Files/Eclipse Adoptium';
  if (process.platform === 'win32' && existsSync(adoptium)) {
    const jdk = readdirSync(adoptium).filter((d) => /^jdk-2[1-9]/.test(d)).sort().at(-1);
    if (jdk) return path.join(adoptium, jdk, 'bin', exe);
  }
  return 'java';
}

if (!existsSync(path.join(FOLDER, 'server.jar'))) {
  console.error('No server yet. Run: npm run server:setup');
  process.exit(1);
}

const memory = process.env.MC_SERVER_MEMORY ?? '2G';
const server = spawn(findJava(), [`-Xmx${memory}`, `-Xms${memory}`, '-jar', 'server.jar', 'nogui'], {
  cwd: FOLDER,
  stdio: 'inherit',
});
server.on('exit', (code) => process.exit(code ?? 0));
// Ctrl+C reaches the server too, and it saves the world before closing
