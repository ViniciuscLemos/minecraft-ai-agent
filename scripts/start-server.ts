// Starts the local server from .server/ (made by `npm run server:setup`).
// Ctrl+C reaches the server too, and it saves the world before closing.
import { spawnServer } from './server.ts';

try {
  const server = spawnServer();
  server.on('exit', (code) => process.exit(code ?? 0));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
