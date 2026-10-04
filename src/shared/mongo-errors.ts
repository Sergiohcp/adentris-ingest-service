const DUPLICATE_KEY_CODE = 11000;
const WRITE_CONCERN_TIMEOUT_CODE = 64;

const UNAVAILABLE_ERROR_NAMES = new Set([
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoWriteConcernError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
]);

export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === DUPLICATE_KEY_CODE;
}

export function isUnavailableError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { name, code } = err as { name?: unknown; code?: unknown };
  return (typeof name === 'string' && UNAVAILABLE_ERROR_NAMES.has(name)) || code === WRITE_CONCERN_TIMEOUT_CODE;
}
