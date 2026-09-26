export const cleanDocuments = () => ({
  locks: [{
    name: 'synthetic-app', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'synthetic-app', version: '1.0.0' },
      'node_modules/alpha': { version: '1.0.0' },
    },
  }],
  snapshot: {
    schemaVersion: 1, capturedAt: '2026-01-01T00:00:00.000Z',
    packages: [{
      name: 'alpha', historyCompleteFrom: '2024-01-01T00:00:00.000Z',
      releases: [{ version: '1.0.0', publishedAt: '2025-12-31T00:00:00.000Z' }],
    }],
  },
});
