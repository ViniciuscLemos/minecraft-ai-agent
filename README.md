# minecraft-ai-agent

[![CI](https://github.com/ViniciuscLemos/minecraft-ai-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/ViniciuscLemos/minecraft-ai-agent/actions/workflows/ci.yml)

![The bot building a farmhouse on its own](docs/demo.gif)

*The bot building a farmhouse by itself: 209 blocks in about 90 seconds, sped up. Recorded with `npm run demo`.*

An AI agent that plays Minecraft with you on your own server. The goal: you type something like
*"get some wood, make tools and build a small house next to me"* and it plans the steps and does them.

It's being built in stages. Right now the bot follows you, obeys chat commands and has tested skills:
it chops trees, crafts (tables, tools, glass panes...), mines, smelts in a furnace it makes itself and
builds houses from blueprints (the farmhouse above: foundation, log frame, windows, a stair roof,
a chimney, torches and furniture). The AI part (Claude planning and replanning) comes on top of that.

## Why I built it

I've played Minecraft since it came out on the Xbox 360, and most of my childhood was spent watching
other people play it on YouTube. Now I study Computer Engineering, and this project is where those two
things meet: the game I grew up with and the stuff I actually want to work with.

It's also a hard problem, which is the fun part. A language model can write a nice plan, but Minecraft is
full of boring ways to fail: falling into a hole, running out of tools, getting attacked at night,
getting stuck on a fence. So the design keeps the AI away from the fiddly parts.

## How it's put together

| Layer | What it does | Who decides |
| --- | --- | --- |
| Reflexes | safe pathfinding, eating, armor, fight or flee, nighttime, getting unstuck | plain code, always on |
| Skills | collect wood, mine, craft, build... each one checks what it needs first and fails with a clear reason | plain code, tested |
| Planner | turns your request into a list of skills and replans when one fails | Claude (tool use) |

The AI never moves the bot block by block. It only picks skills, and the skills are tested on a real
server, so a bad plan fails safely instead of walking the bot into lava.

## Roadmap

- [x] **Stage 1:** local server setup, bot that follows you and obeys chat commands, scenario tests on a real server
- [x] **Stage 2:** skills (wood, crafting, mining, smelting, building) and reflexes (eating, getting unstuck, deaths), each tested on a real server
- [ ] **Stage 3/4:** Claude plans and replans from plain text requests (`!do` works; next: a longer test on a real server)
- [ ] **Stage 5:** web panel with a 3D view of what the bot sees and its reasoning log
- [ ] **Stage 6:** demo video

## Running it

You need Node 24 and Java 21.

```bash
npm install
npm run server:setup      # downloads the official 1.21.1 server from Mojang and makes a flat test world
npm run server            # starts it (localhost only, offline mode)
npm run bot               # in another terminal
```

`server:setup` doesn't accept the [Minecraft EULA](https://aka.ms/MinecraftEULA) for you. Read it, and if
you agree, run `npm run server:setup -- --accept-eula`.

Then open Minecraft 1.21.1, join `localhost` and type in the chat:

| Command | What it does |
| --- | --- |
| `!follow` | follows you around |
| `!come` | walks to where you are |
| `!goto <x> <z>` or `!goto <x> <y> <z>` | walks to a place |
| `!stop` | stops what it's doing |
| `!where` | says where it is |
| `!inventory` | lists what it carries |
| `!wood <n>` | chops trees for n logs |
| `!craft <item> [n]` | crafts something, making the table, planks and sticks it needs on the way |
| `!mine <block> [n]` | mines blocks it can see, and says which tool is missing if it can't |
| `!build <farmhouse\|cottage\|house\|hut>` | builds next to it, and lists the missing materials if it can't |
| `!do <anything>` | asks in plain words, like `!do make a furnace`: Claude plans the steps, the bot runs them |

Settings like the bot name and who can give it orders go in `.env` (see `.env.example`).

### How `!do` works

The bot sends Claude the request, its inventory, the trees and blocks around it and the list of skills
(the same ones the commands above use), and gets back a list of steps as JSON, checked against the skills
before anything runs. If a step fails, the error goes back to Claude with what already worked and it
plans the rest. `!do make a furnace` with empty pockets came back in about 7 seconds as: chop 4 oak logs,
craft a wooden pickaxe, mine 8 stone, craft the furnace.

It calls the [Claude Code](https://claude.com/claude-code) CLI in headless mode (`claude -p`, Sonnet, no
tools), so it runs on the Claude plan you're logged into and doesn't need an API key: install it and log
in once. One plan is one call. With `PLANNER=scripted` it skips Claude and only knows how to build
things from scratch (the survival plan below).

## Tests

```bash
npm test                  # unit tests, instant
npm run test:scenario     # starts a real server in a fresh world and checks the bot in the game
```

The scenario tests join a test player, give the bot orders in the chat and check what happens in the
world: where it ends up, what's in its inventory, which blocks it placed. They run in CI too, on every push.

## Survival run

```bash
npm run survival                   # empty pockets to finished farmhouse, in a normal world
npm run survival -- --record       # same, filmed: a 30x timelapse (.webm), a GIF and a picture of the house
npm run survival -- --build-only   # hands over the materials and only builds
npm run survival -- --planner claude   # Claude writes the plan (and a new one when a step fails)
```

This is the long test: a normal world (seed 8675309, oak and birch trees, stone and a beach near spawn),
a bot with nothing, and the farmhouse as the goal. It works out what the house takes, picks the wood
palette from the trees around, and goes: chop, planks and stairs, a crafting table and a wooden pickaxe,
dig a staircase down to stone when none is exposed, a stone pickaxe, a furnace, sand from the beach,
glass and panes, charcoal and torches, then it levels a spot and builds. A full run takes 17 to 30 minutes,
most of it chopping.

If a step fails, it looks at what it has and plans again from there (the furnace burns some of the planks
the walls need, so it sometimes comes back for a few more logs). By default the plan is scripted
(`src/plans/survival.ts`).

![Timelapse of a scripted survival run, from the first log to the farmhouse](docs/survival.gif)

With `--planner claude` the same run is planned by Claude instead: it gets the request ("build a
farmhouse"), the inventory, the trees and blocks around, the skill list and the house's bill of
materials, and answers with the steps. When a step fails it gets the error and plans the rest. The
first full run like that took 30 minutes and two new plans: stairs it couldn't craft for lack of
planks, then 12 birch planks short at the build.

![Claude-planned survival run, the finished farmhouse](docs/survival-claude.png)

## Demo video

```bash
npm run demo              # the bot builds the farmhouse while a camera circles around it
```

It runs a server in a throwaway world, opens a 3D view of it ([prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer))
in Edge with Playwright and records it, plus a timelapse GIF made from screenshots.

## Things I ran into

- **Java 17 vs 21.** Minecraft 1.21 needs Java 21, and my `JAVA_HOME` pointed to 17 for other projects.
  The start script now checks the version of every Java it finds instead of trusting the first one.
- **A crafting table that came out as a button.** mineflayer's `bot.craft()` takes the result before the server
  has seen every ingredient in the grid, and on 1.21 asking for a crafting table once gave back an oak button
  (what a single plank makes). The bot now places the ingredients itself and waits for the server to show the
  right result before taking it.
- **Logs that never reached the inventory.** The four logs of a trunk drop together right under the rest of the
  tree, where the bot doesn't fit, so it picks items up from a block away instead of walking onto them.
- **Stairs that were never drawn.** The 3D viewer skips every block whose name contains "air", to leave out
  `air` and `cave_air`... and `oak_stairs` has "air" in it. The roof was invisible until the viewer server
  started serving a copy of its worker with that check fixed.
- **A dandelion in the way.** Flowers have no hitbox, but the server won't place a block over them, so the bot
  breaks plants before placing.
- **Stone in a hole.** In the survival world the nearest bare stone was at the bottom of a pit 33 blocks away:
  the drops fell in and the pathfinder gave up. Now, when no exposed stone is close, the bot digs a staircase
  down like a player would (never the block under its feet, stops at water, lava or a cave). 31 stone in 3 minutes
  instead of 10 lost.
- **Logs stuck in the leaves.** Branch logs sit on leaves, so their drop lands up in the canopy where the bot
  can't get it. It skips branches now, and stops with a clear error if several logs in a row give nothing.
- **No flat ground in a normal world.** The house needs a 9 x 5 flat spot. The bot picks the cheapest nearby
  spot and levels it like a player: digs the bumps, fills one-block holes with dirt, and won't touch trees or water.
- **An accent in the user folder.** On Windows, Java opens a Unix socket in the temp folder when it starts
  the network code. With a path like `C:\Users\Usuário` that fails with `Invalid argument: connect` and the
  server crashes. The fix is to point that socket to a folder without accents.

## License

MIT
