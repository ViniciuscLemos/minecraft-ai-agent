// Recording helpers shared by the demo and the survival run: opens the 3D viewer in Edge
// or Chrome with Playwright, takes over its camera, adds a panel with the bot's log, and
// turns screenshots into a timelapse (a .webm through the ffmpeg Playwright ships with, and
// a small GIF for the README).
import { existsSync, readdirSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { Bot } from 'mineflayer';
import { startViewer } from '../src/viewer.ts';
import { sleep } from '../test/scenario/harness.ts';
import { writeGif } from './gif.ts';

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface PanelText {
  title: string;
  subtitle: string;
}

/**
 * Runs in the page before the viewer. With `center` the camera circles that point; without
 * it the camera follows window.__target (updated from node) and circles the bot slowly, so
 * a run that walks all over the map stays in the frame.
 */
export function pageSetup({ center, title, subtitle }: { center?: Point } & PanelText) {
  const w = window as unknown as Record<string, any>;
  let three: any;
  let focus: Point | undefined = center && { ...center };
  let last = 0;
  Object.defineProperty(w, 'THREE', {
    configurable: true,
    get: () => three,
    set(value) {
      three = value;
      const base = value.Camera.prototype.updateMatrixWorld;
      // the viewer's orbit controls move the camera every frame; this runs right after
      value.PerspectiveCamera.prototype.updateMatrixWorld = function (force: boolean) {
        // __orbit (set from node) turns a follow camera into an orbit at the end: the house
        const fixed: Point | undefined = center ?? w.__orbit;
        const target: Point | undefined = fixed ?? w.__target;
        if (!this.__busy && w.__start && target) {
          this.__busy = true;
          const now = performance.now();
          const t = (now - w.__start) / 1000;
          if (!focus) focus = { ...target };
          // ease towards the bot instead of jumping with every step it takes
          const k = Math.min(1, ((now - last) / 1000) * 1.2);
          last = now;
          // eased even towards a fixed point, so the switch to the end orbit is a glide
          if (!center) for (const axis of ['x', 'y', 'z'] as const) focus[axis] += (target[axis] - focus[axis]) * k;
          const angle = -0.6 + t * (fixed ? 0.09 : 0.05);
          const radius = fixed ? 17 - 3 * Math.sin(t * 0.05) : 13 - 2 * Math.sin(t * 0.04);
          const height = fixed ? 7 + 2 * Math.sin(t * 0.07) : 8 + 2 * Math.sin(t * 0.06);
          this.position.set(focus.x + Math.cos(angle) * radius, focus.y + height, focus.z + Math.sin(angle) * radius);
          this.lookAt(focus.x, focus.y, focus.z);
          this.__busy = false;
        }
        return base.call(this, force);
      };
    },
  });

  addEventListener('DOMContentLoaded', () => {
    const panel = document.createElement('div');
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div style="font:600 22px/1.2 system-ui;margin-bottom:4px">${title}</div>
        <div id="clock" style="font:600 15px ui-monospace,Consolas,monospace;opacity:.85"></div>
      </div>
      <div style="font:14px system-ui;opacity:.8;margin-bottom:10px">${subtitle}</div>
      <div id="log" style="font:13px/1.45 ui-monospace,Consolas,monospace"></div>`;
    Object.assign(panel.style, {
      position: 'fixed', left: '20px', top: '20px', width: '420px', padding: '16px 18px', color: '#fff',
      background: 'rgba(15,18,24,.72)', borderRadius: '12px', zIndex: 10, backdropFilter: 'blur(4px)',
    });
    document.body.appendChild(panel);
    const log = panel.querySelector('#log')!;
    const clock = panel.querySelector('#clock')!;
    // real time since the start: in a timelapse it's the only way to tell how long it took
    setInterval(() => {
      if (!w.__start) return;
      const s = Math.floor((performance.now() - w.__start) / 1000);
      clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
    const events = new EventSource('/events');
    events.onmessage = (e) => {
      const text: string = JSON.parse(e.data);
      // every pathfinder stop logs one of these; in a video they bury the lines that matter
      if (text.startsWith('arrived at')) return;
      const line = document.createElement('div');
      line.textContent = '> ' + text;
      log.appendChild(line);
      while (log.childNodes.length > 9) log.removeChild(log.firstChild!);
    };
  });
}

/** The ffmpeg build Playwright downloads for its own videos (FFMPEG overrides it). */
export function findFfmpeg(): string | undefined {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
  ].filter((root): root is string => !!root && existsSync(root));
  for (const root of roots) {
    for (const dir of readdirSync(root).filter((d) => d.startsWith('ffmpeg')).sort().reverse()) {
      const exe = readdirSync(path.join(root, dir)).find((f) => f.startsWith('ffmpeg'));
      if (exe) return path.join(root, dir, exe);
    }
  }
  return undefined;
}

export interface ViewerPage {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/** Starts the viewer for the bot and opens it with the camera and panel set up. */
export async function openViewer(
  bot: Bot,
  options: { port: number; center?: Point; video?: string } & PanelText,
): Promise<ViewerPage> {
  await startViewer(bot, { port: options.port, viewDistance: 5 });
  const browser = await chromium.launch({ channel: process.env.DEMO_BROWSER ?? 'msedge' });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(options.video ? { recordVideo: { dir: options.video, size: { width: 1280, height: 720 } } } : {}),
  });
  const page = await context.newPage();
  await page.addInitScript(pageSetup, { center: options.center, title: options.title, subtitle: options.subtitle });
  await page.goto(`http://localhost:${options.port}`);
  await page.evaluate(() => ((window as any).__start = performance.now()));
  return { browser, context, page };
}

/**
 * Screenshots the page every `every` ms for as long as it runs: each one goes into a
 * timelapse .webm played at `fps` (1 s apart at 30 fps is 30x speed), and every
 * `gifEvery`-th one is kept for the GIF.
 */
export function startTimelapse(page: Page, bot: Bot, { file, every = 1000, fps = 30, gifEvery = 10 }: {
  file?: string;
  every?: number;
  fps?: number;
  gifEvery?: number;
}) {
  const ffmpegPath = file && findFfmpeg();
  if (file && !ffmpegPath) console.log('No ffmpeg found (npx playwright install ffmpeg), only the GIF will be made');
  let ffmpeg: ChildProcess | undefined;
  if (file && ffmpegPath) {
    ffmpeg = spawn(ffmpegPath, [
      '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0',
      '-y', '-an', '-c:v', 'libvpx-vp9', '-b:v', '3M', '-deadline', 'realtime', '-cpu-used', '8', file,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
  }
  const gifFrames: Buffer[] = [];
  let running = true;
  let shots = 0;
  const loop = (async () => {
    while (running) {
      const started = Date.now();
      const pos = bot.entity?.position;
      if (pos) await page.evaluate((p) => ((window as any).__target = p), { x: pos.x, y: pos.y + 1, z: pos.z });
      if (ffmpeg) ffmpeg.stdin!.write(await page.screenshot({ type: 'jpeg', quality: 85 }));
      if (shots++ % gifEvery === 0) gifFrames.push(await page.screenshot({ type: 'png' }));
      await sleep(Math.max(0, every - (Date.now() - started)));
    }
  })();
  return {
    /** Back to (about) real time, for the shot at the end. Screenshots take ~100 ms, so
     * it's closer to 3x than 1x, still slow enough to watch. */
    realTime() {
      every = 1000 / fps;
    },
    /** Stops capturing, finishes the .webm and writes the GIF (if a path is given). */
    async stop(gif?: string) {
      running = false;
      await loop;
      if (ffmpeg) {
        const done = new Promise((resolve) => ffmpeg!.on('close', resolve));
        ffmpeg.stdin!.end();
        await done;
      }
      // the last frame stays on screen a little longer at the end of the loop
      if (gif && gifFrames.length) writeGif([...gifFrames, ...Array(6).fill(gifFrames.at(-1)!)], gif);
      return { shots, gifFrames: gifFrames.length };
    },
  };
}
