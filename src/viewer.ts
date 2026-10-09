// A web page with a 3D view of the world around the bot (prismarine-viewer) and a feed of
// what it's doing. prismarine-viewer's own server helper also loads its renderer, which
// needs the native `canvas` package, so this sets up the same thing with only the parts
// a server needs.
import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import type { Bot } from 'mineflayer';

const require = createRequire(import.meta.url);

export interface ViewerOptions {
  port?: number;
  viewDistance?: number;
}

export function startViewer(bot: Bot, { port = 3007, viewDistance = 6 }: ViewerOptions = {}): Promise<Server> {
  const express = require('express');
  const { Server: SocketServer } = require('socket.io');
  const { setupRoutes } = require('prismarine-viewer/lib/common');
  const { WorldView } = require('prismarine-viewer/viewer/lib/worldView');

  const app = express();
  setupRoutes(app, '');

  // the bot's log as server-sent events, for the panel and the video overlay
  const feeds = new Set<{ write(chunk: string): void }>();
  (bot as unknown as NodeJS.EventEmitter).on('agent_log', (line: string) => {
    for (const feed of feeds) feed.write(`data: ${JSON.stringify(line)}\n\n`);
  });
  app.get('/events', (req: { on(event: 'close', fn: () => void): void }, res: {
    writeHead(status: number, headers: Record<string, string>): void;
    write(chunk: string): void;
  }) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    feeds.add(res);
    req.on('close', () => feeds.delete(res));
  });

  const http = require('node:http').createServer(app) as Server;
  const io = new SocketServer(http, { path: '/socket.io' });

  io.on('connection', (socket: { emit(event: string, data: unknown): void; on(event: string, fn: () => void): void }) => {
    socket.emit('version', bot.version);
    const worldView = new WorldView(bot.world, viewDistance, bot.entity.position, socket);
    worldView.init(bot.entity.position);

    const onMove = () => {
      socket.emit('position', { pos: bot.entity.position, yaw: bot.entity.yaw, addMesh: true });
      worldView.updatePosition(bot.entity.position);
    };
    bot.on('move', onMove);
    worldView.listenToBot(bot);
    socket.on('disconnect', () => {
      bot.removeListener('move', onMove);
      worldView.removeListenersFromBot(bot);
    });
  });

  return new Promise((resolve) => http.listen(port, () => resolve(http)));
}
