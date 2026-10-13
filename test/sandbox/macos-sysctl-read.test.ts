import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { SandboxRuntimeConfigSchema } from '../../src/sandbox/sandbox-config.js'
import { SandboxManager } from '../../src/sandbox/sandbox-manager.js'
import { wrapCommandWithSandboxMacOS } from '../../src/sandbox/macos-sandbox-utils.js'
import { isMacOS } from '../helpers/platform.js'

const sentinel = 'security.mac.sandbox.sentinel'
const invalidNames = [
  '',
  '*',
  'security.mac.*',
  'security mac sandbox sentinel',
  'security.mac.sandbox.sentinel\n',
  'x") (allow default) ;',
]

function wrap(allowSysctlRead?: string[]): string {
  return wrapCommandWithSandboxMacOS({
    command: 'echo SYSCTL_OK',
    needsNetworkRestriction: true,
    readConfig: undefined,
    writeConfig: undefined,
    allowSysctlRead,
  })
}

describe('sysctl read configuration', () => {
  const schema = SandboxRuntimeConfigSchema.innerType().shape.allowSysctlRead

  it('accepts omitted, empty, and exact-name lists', () => {
    for (const names of [undefined, [], [sentinel, 'kern.proc.pid.123']]) {
      expect(schema.safeParse(names).success).toBe(true)
    }
  })

  it('rejects wildcards and profile syntax', () => {
    for (const name of invalidNames) {
      expect(schema.safeParse([name]).success).toBe(false)
    }
    expect(schema.safeParse([42]).success).toBe(false)
  })
})

describe('macOS sysctl read profile', () => {
  it('keeps the default profile when omitted or empty', () => {
    expect(wrap()).not.toContain(sentinel)
    expect(wrap([])).toBe(wrap())
  })

  it('adds exact read filters without changing the default permissions', () => {
    const wrapped = wrap([sentinel, sentinel])
    expect(wrapped).toContain(`(sysctl-name "${sentinel}")`)
    expect(wrapped.split(`(sysctl-name "${sentinel}")`).length).toBe(2)
    expect(wrapped).not.toContain(`(sysctl-name-prefix "${sentinel}")`)
    expect(wrapped).toContain('(sysctl-name "hw.activecpu")')
  })

  it('rejects invalid names from direct JavaScript callers', () => {
    for (const name of invalidNames) {
      expect(() => wrap([name])).toThrow()
    }
  })
})

describe.if(isMacOS)('macOS sysctl reads', () => {
  it('passes a command-specific allowlist through the manager', async () => {
    const wrapped = await SandboxManager.wrapWithSandbox(
      'echo SYSCTL_OK',
      undefined,
      {
        network: { allowedDomains: [], deniedDomains: [] },
        allowSysctlRead: [sentinel],
      },
    )
    expect(wrapped).toContain(`(sysctl-name "${sentinel}")`)
    const ordinary = await SandboxManager.wrapWithSandbox(
      'echo SYSCTL_OK',
      undefined,
      {
        network: { allowedDomains: [], deniedDomains: [] },
      },
    )
    expect(ordinary).not.toContain(sentinel)
  })

  it('generates a profile accepted by sandbox-exec', () => {
    const result = spawnSync(wrap([sentinel]), {
      shell: true,
      encoding: 'utf8',
      timeout: 10000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('SYSCTL_OK')
  })
})
