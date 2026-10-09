import { describe, expect, it } from 'vitest';
import { javaCandidates, unixSocketDir } from '../scripts/server.ts';
import { SERVER_PROPERTIES } from '../scripts/setup-server.ts';

describe('javaCandidates', () => {
  it('tries MC_JAVA first, then JAVA_HOME, and java from the PATH last', () => {
    const list = javaCandidates({ MC_JAVA: '/opt/java21/bin/java', JAVA_HOME: '/opt/java17' });
    expect(list[0]).toContain('java21');
    expect(list[1]).toContain('java17');
    expect(list.at(-1)).toBe('java');
  });
});

describe('unixSocketDir', () => {
  it('only matters on Windows', () => {
    expect(unixSocketDir('/tmp', 'linux')).toBeNull();
  });

  it('keeps the normal temp folder when its path is plain ASCII', () => {
    expect(unixSocketDir('C:\\Users\\Ana\\AppData\\Local\\Temp\\does-not-exist', 'win32')).toBeNull();
  });
});

describe('server.properties', () => {
  it('flat world with real layers, so the bot has ground to stand on', () => {
    const settings = JSON.parse(SERVER_PROPERTIES['generator-settings']!);
    expect(settings.layers.map((layer: { block: string }) => layer.block)).toEqual([
      'minecraft:bedrock',
      'minecraft:dirt',
      'minecraft:grass_block',
    ]);
  });

  it('stays offline and local only', () => {
    expect(SERVER_PROPERTIES['online-mode']).toBe('false');
    expect(SERVER_PROPERTIES['server-ip']).toBe('127.0.0.1');
  });
});
