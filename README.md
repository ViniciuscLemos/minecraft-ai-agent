# minecraft-ai-agent

[![CI](https://github.com/ViniciuscLemos/minecraft-ai-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/ViniciuscLemos/minecraft-ai-agent/actions/workflows/ci.yml)

An AI agent that plays Minecraft with you on your own server. The goal: you type something like
*"get some wood, make tools and build a small house next to me"* and it plans the steps and does them.

It's being built in stages. Right now the bot joins the server, follows you and obeys chat commands.
The AI part (Claude planning and replanning) comes on top of that.

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
- [ ] **Stage 2:** skills and reflexes
- [ ] **Stage 3/4:** Claude plans and replans from plain text requests
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

Settings like the bot name and who can give it orders go in `.env` (see `.env.example`).

## Tests

```bash
npm test                  # unit tests, instant
npm run test:scenario     # starts a real server in a fresh world and checks the bot in the game
```

The scenario tests join a test player, give the bot orders in the chat and check where it ends up.
They run in CI too, on every push.

## Things I ran into

- **Java 17 vs 21.** Minecraft 1.21 needs Java 21, and my `JAVA_HOME` pointed to 17 for other projects.
  The start script now checks the version of every Java it finds instead of trusting the first one.
- **An accent in the user folder.** On Windows, Java opens a Unix socket in the temp folder when it starts
  the network code. With a path like `C:\Users\Usuário` that fails with `Invalid argument: connect` and the
  server crashes. The fix is to point that socket to a folder without accents.

## License

MIT
