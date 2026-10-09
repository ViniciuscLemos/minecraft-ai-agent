import { describe, expect, it } from 'vitest';
import { canCommand, parseCommand } from '../src/commands.ts';
import { loadConfig } from '../src/config.ts';

describe('parseCommand', () => {
  it('ignores normal chat', () => {
    expect(parseCommand('hello there')).toBeNull();
    expect(parseCommand('')).toBeNull();
  });

  it('reads simple commands and their aliases, any case', () => {
    expect(parseCommand('!follow')).toEqual({ ok: true, command: { name: 'follow' } });
    expect(parseCommand('  !STOP ')).toEqual({ ok: true, command: { name: 'stop' } });
    expect(parseCommand('!here')).toEqual({ ok: true, command: { name: 'come' } });
    expect(parseCommand('!inv')).toEqual({ ok: true, command: { name: 'inventory' } });
  });

  it('goto with 2 or 3 numbers', () => {
    expect(parseCommand('!goto 10 -20')).toEqual({ ok: true, command: { name: 'goto', x: 10, y: null, z: -20 } });
    expect(parseCommand('!goto 1.5 64 3')).toEqual({ ok: true, command: { name: 'goto', x: 1.5, y: 64, z: 3 } });
  });

  it('explains what went wrong', () => {
    expect(parseCommand('!goto 10')).toEqual({ ok: false, error: 'Use !goto <x> <z> or !goto <x> <y> <z>' });
    expect(parseCommand('!goto a b')).toMatchObject({ ok: false });
    expect(parseCommand('!dance')).toEqual({ ok: false, error: 'I don\'t know "!dance". Try !help' });
  });
});

describe('skill commands', () => {
  it('turn the words after the command into skill arguments', () => {
    expect(parseCommand('!wood 6')).toEqual({ ok: true, command: { name: 'skill', skill: 'collect_wood', args: { amount: 6 } } });
    expect(parseCommand('!craft wooden_pickaxe')).toEqual({
      ok: true,
      command: { name: 'skill', skill: 'craft', args: { item: 'wooden_pickaxe', amount: 1 } },
    });
    expect(parseCommand('!mine stone 3')).toMatchObject({ command: { skill: 'mine', args: { block: 'stone', amount: 3 } } });
    expect(parseCommand('!BUILD house')).toMatchObject({ command: { skill: 'build', args: { structure: 'house' } } });
  });

  it('have sensible defaults', () => {
    expect(parseCommand('!chop')).toMatchObject({ command: { skill: 'collect_wood', args: { amount: 4 } } });
  });

  it('say how to use them when the arguments are wrong', () => {
    expect(parseCommand('!craft')).toEqual({ ok: false, error: 'Use !craft <item> [how many]' });
    expect(parseCommand('!wood lots')).toEqual({ ok: false, error: 'Use !wood <how many logs>' });
    expect(parseCommand('!mine stone 999')).toEqual({ ok: false, error: 'Use !mine <block> [how many]' });
  });
});

describe('canCommand', () => {
  it('anyone when there is no owner list', () => {
    expect(canCommand('Someone', [])).toBe(true);
  });

  it('only the owners otherwise, ignoring case', () => {
    expect(canCommand('vinicius', ['Vinicius'])).toBe(true);
    expect(canCommand('Other', ['Vinicius'])).toBe(false);
  });
});

describe('loadConfig', () => {
  it('has defaults for the local server', () => {
    expect(loadConfig({})).toEqual({ host: 'localhost', port: 25565, version: '1.21.1', username: 'Steve_AI', owners: [] });
  });

  it('reads the owner list and rejects bad values', () => {
    expect(loadConfig({ BOT_OWNERS: ' Ana, Vinicius ,' }).owners).toEqual(['Ana', 'Vinicius']);
    expect(() => loadConfig({ MC_PORT: 'abc' })).toThrow('MC_PORT');
    expect(() => loadConfig({ BOT_NAME: 'a name with spaces' })).toThrow('BOT_NAME');
  });
});
