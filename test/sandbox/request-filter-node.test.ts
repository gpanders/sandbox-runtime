import { test, expect } from 'bun:test'
import { execFileSync } from 'node:child_process'

// Exercise Node's stream adapter, even when the test runner is Bun.
// Run `pnpm build` first so the child tests the current implementation.
test('Node request filtering survives body cancellation and preserves forwarding', () => {
  const moduleUrl = new URL(
    '../../dist/sandbox/request-filter.js',
    import.meta.url,
  )
  const result = execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { PassThrough } from 'node:stream';
    import { EventEmitter } from 'node:events';
    import { setImmediate } from 'node:timers/promises';
    import { decideAndRespond } from ${JSON.stringify(moduleUrl.href)};

    const body = Buffer.alloc(65536, 'x');
    const url = 'https://example.test/upload';
    function request() {
      return Object.assign(new PassThrough(), {
        method: 'POST', headers: { 'content-length': String(body.length) },
      });
    }
    function response() {
      return Object.assign(new EventEmitter(), {
        writeHead(status) { this.status = status; },
        end(body) { this.body = body; this.writableFinished = true; this.emit('finish'); },
      });
    }
    function upload(req) {
      req.write(body.subarray(0, 32768));
      req.end(body.subarray(32768));
    }

    for (const [filter, target, reason] of [
      [async () => ({ action: 'deny' }), url, 'denied by sandbox policy'],
      [async () => { throw new Error('policy failure'); }, url, 'sandbox policy check failed'],
      [async () => ({ action: 'allow' }), 'invalid URL', 'malformed request'],
      [async req => { req.body.cancel().catch(() => {}); return { action: 'deny' }; }, url, 'denied by sandbox policy'],
    ]) {
      for (let i = 0; i < 100; i++) {
        const req = request();
        const res = response();
        const decision = decideAndRespond(filter, req, res, target, new AbortController().signal);
        upload(req);
        assert.equal(await decision, null);
        assert.equal(res.status, 403);
        assert.ok(res.body.includes(reason));
        assert.equal(req.destroyed, true);
        await setImmediate();
      }
    }

    for (const readBody of [false, true]) {
      const req = request();
      const decision = decideAndRespond(async request => {
        if (readBody) assert.equal(await request.text(), body.toString());
        return { action: 'allow' };
      }, req, response(), url, new AbortController().signal);
      upload(req);
      const upstream = await decision;
      const chunks = [];
      for await (const chunk of upstream) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), body);
    }

    const req = request();
    const decision = decideAndRespond(async () => ({ action: 'allow' }), req, response(), url, new AbortController().signal);
    req.write(body.subarray(0, 32768));
    const upstream = await decision;
    const aborted = new Error('client aborted');
    req.destroy(aborted);
    await assert.rejects(async () => {
      for await (const chunk of upstream) { /* Consume until the abort. */ }
    }, error => error === aborted);
    await setImmediate();
    console.log('request stream checks passed');
  `,
    ],
    { encoding: 'utf8', timeout: 10_000 },
  )
  expect(result.trim()).toBe('request stream checks passed')
})
