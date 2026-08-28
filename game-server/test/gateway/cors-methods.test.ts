import request from 'supertest';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';

/**
 * The CORS preflight has to allow every verb the app actually mounts.
 *
 * THIS FILE EXISTS BECAUSE IT DID NOT. The admin user-edit route was added as a
 * PATCH while `Access-Control-Allow-Methods` still read `GET, POST, OPTIONS`.
 * Every route test passed — supertest calls the Express app directly and never
 * performs a preflight — and the browser refused to send the request at all.
 * The user saw "cannot reach the server", which is true, unhelpful, and points
 * at the network rather than at a header.
 *
 * The general lesson, and why this is a test rather than a comment: a check
 * that only ever runs inside the process cannot see a rule the BROWSER
 * enforces. The verbs are enumerated from the router below rather than
 * hardcoded, so mounting a DELETE without allowing it fails here instead of in
 * someone's browser.
 */

const ORIGIN = 'http://admin.localhost:5173';

const app = () =>
  createGatewayApp(
    loadConfig({
      JWT_SECRET: 'test-secret-cors',
      NODE_ENV: 'test',
      CORS_ORIGINS: ORIGIN,
      FINANCIAL_CORE_URL: 'http://127.0.0.1:9',
    } as NodeJS.ProcessEnv),
  );

/** Every HTTP verb any route in the app is mounted with. */
function mountedMethods(instance: ReturnType<typeof createGatewayApp>): Set<string> {
  const found = new Set<string>();
  const walk = (stack: unknown[]): void => {
    for (const layer of stack as {
      route?: { methods?: Record<string, boolean> };
      handle?: { stack?: unknown[] };
    }[]) {
      if (layer.route?.methods) {
        for (const [m, on] of Object.entries(layer.route.methods)) {
          if (on) found.add(m.toUpperCase());
        }
      }
      if (layer.handle?.stack) walk(layer.handle.stack);
    }
  };
  const router = (instance as unknown as { router?: { stack?: unknown[] } }).router;
  const legacy = (instance as unknown as { _router?: { stack?: unknown[] } })._router;
  walk(router?.stack ?? legacy?.stack ?? []);
  return found;
}

describe('CORS preflight', () => {
  it('allows every verb the app mounts', () => {
    const instance = app();
    const mounted = mountedMethods(instance);

    // A sanity floor, so that a walk which silently returns nothing cannot make
    // the real assertion below pass vacuously. Named verbs rather than a count:
    // the app happens to mount exactly three today, and a `> 3` floor would be
    // asserting a number nobody chose.
    expect([...mounted].sort()).toEqual(['GET', 'PATCH', 'POST']);

    return request(instance)
      .options('/admin/players/x')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'PATCH')
      .then((res) => {
        expect(res.status).toBe(204);
        const allowed = new Set(
          (res.headers['access-control-allow-methods'] ?? '')
            .split(',')
            .map((m: string) => m.trim().toUpperCase())
            .filter(Boolean),
        );
        const missing = [...mounted].filter((m) => m !== 'HEAD' && !allowed.has(m));
        expect(missing).toEqual([]);
      });
  });

  it('answers a PATCH preflight from an allowed origin', async () => {
    const res = await request(app())
      .options('/admin/players/x')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
  });

  it('still refuses an origin that is not on the list', async () => {
    // The other half. A preflight that says yes to everyone would make the test
    // above pass while handing any page on the internet a way to call the API
    // with a stolen bearer token.
    const res = await request(app())
      .options('/admin/players/x')
      .set('Origin', 'https://not-us.example.com')
      .set('Access-Control-Request-Method', 'PATCH');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
