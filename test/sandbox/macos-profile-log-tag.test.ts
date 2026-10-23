import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { wrapCommandWithSandboxMacOS } from '../../src/sandbox/macos-sandbox-utils.js'
import { isMacOS } from '../helpers/platform.js'

function wrap(profileLogTagParam?: string): string {
  return wrapCommandWithSandboxMacOS({
    command: 'true',
    commandId: 'profile-id',
    needsNetworkRestriction: true,
    readConfig: undefined,
    writeConfig: { allowOnly: [], denyWithinAllow: [] },
    profileLogTagParam,
  })
}

const key = Buffer.from('profile-id').toString('base64')

describe('macOS profile with a log tag parameter', () => {
  it('keeps the log tag of a wrap and takes the key from the parameter', () => {
    const suffix = wrap().match(new RegExp(`CMD64_${key}_END_(\\w+)`))?.[1]
    expect(suffix).toBeDefined()
    const profile = wrap('LOG_KEY')
    expect(profile.startsWith('(version 1)')).toBe(true)
    expect(profile).toContain(
      `(deny default (with message (string-append "CMD64_" (param "LOG_KEY") "_END_${suffix}")))`,
    )
    expect(profile).not.toContain(`"CMD64_${key}`)
    expect(profile).not.toContain('sandbox-exec')
  })
})

describe.if(isMacOS)('macOS profile with a log tag parameter', () => {
  it('is accepted by sandbox-exec', () => {
    const result = spawnSync(
      '/usr/bin/sandbox-exec',
      ['-D', `LOG_KEY=${key}`, '-p', wrap('LOG_KEY'), '/usr/bin/true'],
      { encoding: 'utf8', timeout: 10000 },
    )
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})
