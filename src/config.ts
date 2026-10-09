// Settings from the environment (.env), with defaults that work with `npm run server`.
export interface Config {
  host: string;
  port: number;
  version: string;
  username: string;
  // players allowed to give orders; empty = anyone
  owners: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.MC_PORT ?? 25565);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`MC_PORT is not a valid port: ${env.MC_PORT}`);

  const username = env.BOT_NAME || 'Steve_AI';
  // the rule Minecraft uses for player names
  if (!/^\w{3,16}$/.test(username)) {
    throw new Error(`BOT_NAME must have 3 to 16 letters, numbers or _: ${username}`);
  }

  return {
    host: env.MC_HOST || 'localhost',
    port,
    version: env.MC_VERSION || '1.21.1',
    username,
    owners: (env.BOT_OWNERS ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  };
}
