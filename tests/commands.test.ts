import { describe, expect, it } from 'vitest'
import { parseCommand, tokenize } from '../electron/security/commands'

describe('command validation', () => {
  it('tokenizes quoted arguments', () => {
    expect(tokenize('python "my file.py" --flag \'a b\'')).toEqual(['python', 'my file.py', '--flag', 'a b'])
  })
  it('accepts allowlisted programs', () => {
    expect(parseCommand('pip install flask').argv).toEqual(['pip', 'install', 'flask'])
    expect(parseCommand('npm.cmd run build').executable).toBe('npm')
  })
  it('rejects programs not on the allowlist', () => {
    expect(() => parseCommand('curl http://example.com')).toThrow(/allowlist/)
    expect(() => parseCommand('powershell -c whoami')).toThrow(/allowlist/)
  })
  it('rejects shell operators', () => {
    for (const c of ['python a.py && rm -rf /', 'node x.js | tee out', 'git log > f', 'python $(whoami)', 'npm test; ls']) {
      expect(() => parseCommand(c)).toThrow(/Shell operators/)
    }
  })
  it('flags destructive commands', () => {
    expect(parseCommand('git reset --hard HEAD').destructive).toBe(true)
    expect(parseCommand('git clean -fd').destructive).toBe(true)
    expect(parseCommand('pip uninstall flask').destructive).toBe(true)
    expect(parseCommand('python app.py').destructive).toBe(false)
  })
})
