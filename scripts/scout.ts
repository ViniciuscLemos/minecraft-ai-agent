// Looks for a good spot for the survival demo in a normal (not flat) world: trees,
// sand and stone you can see from the surface, all close to where the bot spawns.
//
//   node scripts/scout.ts 12345 -4172144997902289642     tries each seed and prints a report
//
// Each seed gets a fresh world, so this takes a minute or so per seed.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import mineflayer from 'mineflayer';
import { startServer, sleep, VERSION } from '../test/scenario/harness.ts';
import { SERVER_FOLDER } from './server.ts';
import { SERVER_PROPERTIES } from './setup-server.ts';

const PORT = 25621;
const ROOT = path.resolve(import.meta.dirname, '..');
const RADIUS = 40;

export function normalWorldFolder(name: string, seed: string, port: number) {
  if (!existsSync(path.join(SERVER_FOLDER, 'eula.txt'))) throw new Error('Run npm run server:setup first.');
  const folder = path.join(ROOT, name);
  mkdirSync(folder, { recursive: true });
  for (const file of ['server.jar', 'eula.txt']) copyFileSync(path.join(SERVER_FOLDER, file), path.join(folder, file));
  const properties: Record<string, string> = {
    ...SERVER_PROPERTIES,
    'server-port': String(port),
    'level-type': 'minecraft\\:normal',
    'level-seed': seed,
    'generator-settings': '{}',
    'spawn-protection': '0',
  };
  writeFileSync(path.join(folder, 'server.properties'), Object.entries(properties).map(([k, v]) => `${k}=${v}`).join('\n'));
  return folder;
}

const GROUPS: Record<string, string[]> = {
  oak: ['oak_log'],
  birch: ['birch_log'],
  spruce: ['spruce_log'],
  sand: ['sand'],
  water: ['water'],
  stone: ['stone', 'andesite', 'diorite', 'granite'],
};

async function scout(seed: string) {
  const server = await startServer(PORT, normalWorldFolder('.scout-server', seed, PORT));
  try {
    const bot = mineflayer.createBot({ host: 'localhost', port: PORT, username: 'Scout', version: VERSION, auth: 'offline' });
    await new Promise<void>((resolve) => bot.once('spawn', () => resolve()));
    await sleep(8000); // chunks around spawn
    const origin = bot.entity.position.floored();
    const report: string[] = [`seed ${seed}: spawn ${origin.x} ${origin.y} ${origin.z}`];
    for (const [group, names] of Object.entries(GROUPS)) {
      const ids = names.map((n) => bot.registry.blocksByName[n].id);
      const found = bot.findBlocks({ matching: ids, maxDistance: RADIUS, count: 2000 });
      // "surface" = open sky above it, something the bot can walk up to without digging
      const surface = found.filter((p) => {
        const above = bot.blockAt(p.offset(0, 1, 0));
        return above && (above.name === 'air' || above.name.endsWith('leaves') || above.name === group);
      });
      const nearest = surface.length ? Math.round(Math.min(...surface.map((p) => p.distanceTo(origin)))) : '-';
      report.push(`  ${group.padEnd(7)} ${String(found.length).padStart(5)} total, ${String(surface.length).padStart(4)} on the surface, nearest ${nearest}`);
    }
    console.log(report.join('\n'));
    bot.quit();
  } finally {
    await server.stop();
  }
}

// only when run directly: the survival demo imports normalWorldFolder from here
if (import.meta.main) {
  for (const seed of process.argv.slice(2)) await scout(seed);
  process.exit(0);
}
