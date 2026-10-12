// Debug tool for "the bot stops seeing dropped items": a plain player stands in a world
// while the server keeps summoning items next to it, and every minute this prints how
// many item spawns came in as raw packets against how many showed up in bot.entities,
// plus any packet the client failed to parse.
//
//   node scripts/item-probe.ts [minutes] [--normal]
import { joinPlayer, startServer, sleep } from '../test/scenario/harness.ts';
import { normalWorldFolder } from './scout.ts';
const SEED = '8675309'; // same world as the survival run

const PORT = 25640;
const minutes = Number(process.argv.find((arg) => /^\d+$/.test(arg)) ?? 10);
const normal = process.argv.includes('--normal');

const server = await startServer(PORT, normal ? normalWorldFolder('.probe-server', SEED, PORT) : undefined);
const bot = await joinPlayer('Probe', PORT);
server.command('op Probe');
await sleep(3000);

const client = bot._client as unknown as {
  on(event: string, listener: (...args: any[]) => void): void;
  _hasBundlePacket?: boolean;
  _mcBundle?: unknown[];
};
const itemType = bot.registry.entitiesByName['item']!.id;
let rawSpawns = 0;
let errors = 0;
let delimiters = 0;
client.on('packet', (data: { type?: number }, meta: { name: string }) => {
  if (meta.name === 'spawn_entity' && data.type === itemType) rawSpawns++;
  if (meta.name === 'bundle_delimiter') delimiters++;
});
client.on('error', (error: Error) => {
  errors++;
  console.log(`client error: ${error.message.slice(0, 200)}`);
});
let seen = 0;
let missed = 0;
const started = Date.now();
let summoned = 0;
const { x, y, z } = bot.entity.position.floored();

for (let lastReport = 0; Date.now() - started < minutes * 60_000; ) {
  const before = new Set(Object.keys(bot.entities));
  summoned++;
  server.command(`summon item ${x + 2} ${y + 1} ${z} {Item:{id:"minecraft:oak_log",count:1},PickupDelay:32767s,Age:5000s}`);
  let found = false;
  for (let waited = 0; waited < 2000 && !found; waited += 100) {
    await sleep(100);
    found = Object.entries(bot.entities).some(([id, entity]) => !before.has(id) && entity.name === 'item');
  }
  if (found) seen++;
  else missed++;
  if (summoned % 20 === 0) server.command('kill @e[type=item]');
  const elapsed = Math.floor((Date.now() - started) / 60_000);
  if (elapsed > lastReport || !found) {
    lastReport = elapsed;
    const items = Object.values(bot.entities).filter((entity) => entity.name === 'item').length;
    console.log(
      `[${elapsed} min] summoned ${summoned}, seen ${seen}, missed ${missed}, raw item spawns ${rawSpawns}, ` +
        `items in bot.entities ${items}, parse errors ${errors}, delimiters ${delimiters}, ` +
        `bundle ${client._hasBundlePacket ? 'on' : 'off'} (${client._mcBundle?.length ?? 0} queued)`,
    );
  }
}
bot.quit();
await server.stop();
process.exit(0);
