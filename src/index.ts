import { createAgentBot } from './bot.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
console.log(`Connecting ${config.username} to ${config.host}:${config.port} (Minecraft ${config.version})...`);
const bot = createAgentBot(config);

bot.on('end', (reason) => {
  console.log(`Disconnected: ${reason}`);
  process.exit(0);
});

// Ctrl+C leaves the server cleanly instead of timing out
process.on('SIGINT', () => bot.quit('bye'));
