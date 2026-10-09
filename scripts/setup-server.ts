// Downloads the official Minecraft server from Mojang and prepares a test world for the bot:
// flat, peaceful, offline mode (the bot doesn't need a Minecraft account) and only reachable
// from this computer.
//
//   npm run server:setup                    downloads and configures
//   npm run server:setup -- --accept-eula   the same, and accepts Mojang's EULA
//
// The EULA (https://aka.ms/MinecraftEULA) has to be accepted by you, so the script never
// accepts it on its own.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const VERSION = process.env.MC_VERSION ?? '1.21.1';
const FOLDER = path.resolve(import.meta.dirname, '..', '.server');
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

// world made for testing: flat, no monsters (they get turned on one by one later),
// no spawn protection so the bot can build next to the spawn
export const SERVER_PROPERTIES: Record<string, string> = {
  'online-mode': 'false',
  'server-ip': '127.0.0.1',
  'server-port': '25565',
  'level-type': 'minecraft\\:flat',
  'level-name': 'world',
  difficulty: 'peaceful',
  gamemode: 'survival',
  'spawn-protection': '0',
  'view-distance': '6',
  'simulation-distance': '6',
  'max-players': '5',
  motd: 'minecraft-ai-agent test world',
  'enable-command-block': 'true',
  'generate-structures': 'false',
  'spawn-monsters': 'false',
};

async function getJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function downloadServer(jarPath: string) {
  const manifest = await getJson(MANIFEST);
  const version = manifest.versions.find((v: { id: string }) => v.id === VERSION);
  if (!version) throw new Error(`Minecraft ${VERSION} is not in Mojang's version list`);
  const { url, sha1 } = (await getJson(version.url)).downloads.server;

  if (existsSync(jarPath) && sha1Of(readFileSync(jarPath)) === sha1) {
    console.log(`server.jar ${VERSION} is already here`);
    return;
  }

  console.log(`Downloading the Minecraft ${VERSION} server from Mojang...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const jar = Buffer.from(await res.arrayBuffer());
  // the hash comes from Mojang's own manifest, so a broken or swapped file is caught here
  if (sha1Of(jar) !== sha1) throw new Error('the downloaded server.jar does not match the hash from Mojang');
  writeFileSync(jarPath, jar);
  console.log(`Saved ${(jar.length / 1e6).toFixed(1)} MB, hash checked`);
}

const sha1Of = (data: Buffer) => createHash('sha1').update(data).digest('hex');

async function main() {
  mkdirSync(FOLDER, { recursive: true });
  await downloadServer(path.join(FOLDER, 'server.jar'));

  const properties = Object.entries(SERVER_PROPERTIES).map(([k, v]) => `${k}=${v}`).join('\n');
  writeFileSync(path.join(FOLDER, 'server.properties'), `${properties}\n`);
  console.log('server.properties written (flat, peaceful, offline mode, local only)');

  if (process.argv.includes('--accept-eula')) {
    writeFileSync(path.join(FOLDER, 'eula.txt'), 'eula=true\n');
    console.log('EULA accepted');
  } else if (!readFileIfExists(path.join(FOLDER, 'eula.txt')).includes('eula=true')) {
    console.log('\nThe server only starts after you accept the Minecraft EULA: https://aka.ms/MinecraftEULA');
    console.log('If you agree, run: npm run server:setup -- --accept-eula');
    return;
  }
  console.log('\nReady. Start it with: npm run server');
}

function readFileIfExists(file: string) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
