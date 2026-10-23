import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SandboxRuntimeConfigSchema } from '../../src/sandbox/sandbox-config.js'
import { wrapCommandWithSandboxMacOS } from '../../src/sandbox/macos-sandbox-utils.js'
import { isMacOS } from '../helpers/platform.js'

function wrap(command: string, allowUnsandboxedExec?: string[]): string {
  return wrapCommandWithSandboxMacOS({
    command,
    needsNetworkRestriction: true,
    readConfig: undefined,
    writeConfig: { allowOnly: [], denyWithinAllow: [] },
    allowUnsandboxedExec,
  })
}

describe('unsandboxed exec configuration', () => {
  const schema =
    SandboxRuntimeConfigSchema.innerType().shape.allowUnsandboxedExec

  it('accepts absolute paths only', () => {
    expect(schema.safeParse(['/opt/launcher/bin']).success).toBe(true)
    expect(schema.safeParse(['bin']).success).toBe(false)
    expect(schema.safeParse(['']).success).toBe(false)
  })

  it('adds one rule per directory after the general exec rule', () => {
    const wrapped = wrap('true', ['/opt/a', '/opt/"b'])
    const rule = '(allow process-exec (with no-sandbox) (subpath "/opt/a"))'
    expect(wrapped).toContain(rule)
    expect(wrapped).toContain('(subpath "/opt/\\"b")')
    expect(wrapped.indexOf('(allow process-exec)')).toBeLessThan(
      wrapped.indexOf(rule),
    )
    expect(wrap('true', [])).toBe(wrap('true'))
  })
})

describe.if(isMacOS)('macOS unsandboxed exec', () => {
  // Copies of platform binaries such as /bin/sh are killed, so the test copies its own runtime.
  let root = ''
  let bin = ''
  let inside = ''
  let outside = ''
  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'srt-exec-')))
    bin = join(root, 'bin')
    inside = join(root, 'runtime')
    outside = join(bin, 'runtime')
    mkdirSync(bin)
    copyFileSync(process.execPath, inside, constants.COPYFILE_FICLONE)
    copyFileSync(process.execPath, outside, constants.COPYFILE_FICLONE)
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const run = (command: string) =>
    spawnSync(wrap(command, [bin]), {
      shell: true,
      encoding: 'utf8',
      timeout: 4000,
    })
  const touch = (runtime: string, file: string) =>
    run(
      `${runtime} -e "require('fs').writeFileSync('${join(root, file)}', '')"`,
    )

  it('starts executables in the directory outside the sandbox', () => {
    const result = touch(outside, 'outside')
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(existsSync(join(root, 'outside'))).toBe(true)
  })

  it('keeps other executables in the sandbox', () => {
    expect(touch(inside, 'inside').status).not.toBe(0)
    expect(existsSync(join(root, 'inside'))).toBe(false)
  })

  it('lets the sandboxed parent signal the unsandboxed child', () => {
    const result = run(
      `${outside} -e "setTimeout(() => {}, 30000)" & sleep 0.5; kill $! && wait $!`,
    )
    expect(result.stderr).toBe('')
    expect(result.status).toBe(143)
  })
})
