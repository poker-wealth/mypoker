/**
 * OpenAPI 3.0 description of the Financial Core API, served at GET /api/v1/openapi.json.
 * The human-readable companion is docs/api-v1.md.
 */
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'FairPlay Financial Core API',
    version: '1.0.0',
    description:
      'All money in the platform moves through this API. Amounts are decimal strings (6 dp), never numbers.',
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: {
      playerJwt: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      internalSecret: { type: 'apiKey', in: 'header', name: 'x-internal-secret' },
    },
    schemas: {
      Money: { type: 'string', example: '12.500000', description: 'Decimal string, 6 dp.' },
      Error: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      Balance: {
        type: 'object',
        properties: {
          playerId: { type: 'string' },
          available: { $ref: '#/components/schemas/Money' },
          locked: { $ref: '#/components/schemas/Money' },
          clearing: { $ref: '#/components/schemas/Money' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: { summary: 'Health check', security: [], responses: { '200': { description: 'OK' } } },
    },
    '/me/balance': {
      get: {
        summary: 'Authenticated player balance',
        security: [{ playerJwt: [] }],
        responses: {
          '200': {
            description: 'Balances',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Balance' } } },
          },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/me/withdrawals': {
      post: {
        summary: 'Request a withdrawal',
        security: [{ playerJwt: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amount', 'address'],
                properties: {
                  amount: { $ref: '#/components/schemas/Money' },
                  address: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Created (REQUESTED)' },
          '409': { description: 'Insufficient available balance' },
        },
      },
    },
    '/internal/deposits': {
      post: {
        summary: 'Credit a confirmed on-chain deposit (official contract + 20 confirmations)',
        security: [{ internalSecret: [] }],
        responses: { '200': { description: 'Outcome' }, '401': { description: 'Unauthorized' } },
      },
    },
    '/internal/settlements': {
      post: {
        summary: 'Settle a finished hand (jackpot inject → rake), idempotent on roundId',
        security: [{ internalSecret: [] }],
        responses: { '200': { description: 'Settlement receipt' } },
      },
    },
    '/internal/buy-ins': {
      post: {
        summary: 'Lock a buy-in (available → locked)',
        security: [{ internalSecret: [] }],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/internal/releases': {
      post: {
        summary: 'Release a stack (locked → available)',
        security: [{ internalSecret: [] }],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/internal/withdrawals/{id}/approve': {
      post: {
        summary: 'Approve a withdrawal (available → clearing hold)',
        security: [{ internalSecret: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'New state' } },
      },
    },
    '/internal/withdrawals/{id}/broadcast': {
      post: {
        summary: 'Mark a withdrawal broadcast (records txHash)',
        security: [{ internalSecret: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'New state' } },
      },
    },
    '/internal/withdrawals/{id}/confirm': {
      post: {
        summary: 'Confirm a withdrawal (funds leave platform)',
        security: [{ internalSecret: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'New state' } },
      },
    },
  },
} as const;
