export class EvidenceError extends Error {
  constructor(pointer = '', code = 'input-invalid') { super('Saved evidence is unsupported.'); this.name = 'EvidenceError'; this.pointer = pointer; this.code = code; }
}

const cmp = (a, b) => a === b ? 0 : a < b ? -1 : 1;
const NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u;
const KEY = /^node_modules\/(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(?:\/node_modules\/(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*)*$/u;

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, names) { return object(value) && Object.keys(value).length === names.length && Object.keys(value).every(name => names.includes(name)); }

export function snapshotEvidence(value, { maxDepth = 32, maxNodes = 200000 } = {}) {
  let nodes = 0;
  const seen = new Set();
  const copy = (input, depth, pointer) => {
    if (++nodes > maxNodes) throw new EvidenceError('/limits/maxNodes', 'limit-exceeded');
    if (depth > maxDepth) throw new EvidenceError('/limits/maxDepth', 'limit-exceeded');
    if (input === null || ['string', 'boolean'].includes(typeof input) ||
        (typeof input === 'number' && Number.isFinite(input))) return input;
    if (typeof input !== 'object' || seen.has(input)) throw new EvidenceError(pointer);
    if (![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(input))) throw new EvidenceError(pointer);
    seen.add(input);
    if (Array.isArray(input)) {
      const keys = Reflect.ownKeys(input).filter(name => name !== 'length');
      if (keys.length !== input.length || keys.some((name, index) => name !== String(index))) throw new EvidenceError(pointer);
      const output = keys.map((name, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(input, name);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new EvidenceError(`${pointer}/${index}`);
        return copy(descriptor.value, depth + 1, `${pointer}/${index}`);
      });
      seen.delete(input);
      return output;
    }
    const output = Object.create(null);
    for (const name of Reflect.ownKeys(input)) {
      if (typeof name !== 'string') throw new EvidenceError(pointer);
      const descriptor = Object.getOwnPropertyDescriptor(input, name);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new EvidenceError(pointer);
      output[name] = copy(descriptor.value, depth + 1, pointer);
    }
    seen.delete(input);
    return output;
  };
  try { return copy(value, 0, ''); }
  catch (error) { if (error instanceof EvidenceError) throw error; throw new EvidenceError(''); }
}

export function validateLock(input, limits) {
  const value = snapshotEvidence(input, limits);
  const invalid = pointer => { throw new EvidenceError(pointer); };
  if (!object(value) || value.lockfileVersion !== 3 || !object(value.packages)) invalid('/packages');
  const keys = Object.keys(value.packages).sort(cmp);
  if (keys.filter(key => key !== '').length > limits.maxMembers)
    throw new EvidenceError('/limits/maxMembers', 'limit-exceeded');
  const members = [];
  for (let ordinal = 0; ordinal < keys.length; ordinal++) {
    const key = keys[ordinal];
    if (key === '') continue;
    const entry = value.packages[key];
    const pointer = `/packages/@${ordinal}`;
    if (!KEY.test(key) || !object(entry) || entry.link === true ||
        typeof entry.version !== 'string' || !VERSION.test(entry.version)) invalid(pointer);
    const name = key.slice(key.lastIndexOf('/node_modules/') + 14).replace(/^node_modules\//u, '');
    if (!NAME.test(name) || (Object.hasOwn(entry, 'name') && entry.name !== name)) invalid(pointer);
    members.push({ name, version: entry.version, ordinal });
  }
  return members;
}

export function validateSnapshot(input, limits) {
  const value = snapshotEvidence(input, limits);
  const invalid = pointer => { throw new EvidenceError(pointer); };
  if (!exactKeys(value, ['schemaVersion', 'capturedAt', 'packages']) || value.schemaVersion !== 1 ||
      !validDate(value.capturedAt) || !Array.isArray(value.packages)) invalid('');
  if (value.packages.length > limits.maxMetadataPackages)
    throw new EvidenceError('/limits/maxMetadataPackages', 'limit-exceeded');
  const captured = Date.parse(value.capturedAt);
  const packages = new Map();
  for (let index = 0; index < value.packages.length; index++) {
    const row = value.packages[index];
    const pointer = `/packages/${index}`;
    if (!exactKeys(row, ['name', 'historyCompleteFrom', 'releases']) ||
        typeof row.name !== 'string' || !NAME.test(row.name) || row.name.length > 128 ||
        !(row.historyCompleteFrom === null || validDate(row.historyCompleteFrom)) ||
        (row.historyCompleteFrom !== null && Date.parse(row.historyCompleteFrom) > captured) ||
        !Array.isArray(row.releases) || packages.has(row.name)) invalid(pointer);
    if (row.releases.length > limits.maxReleases)
      throw new EvidenceError('/limits/maxReleases', 'limit-exceeded');
    const releases = new Map();
    for (let releaseIndex = 0; releaseIndex < row.releases.length; releaseIndex++) {
      const release = row.releases[releaseIndex];
      if (!exactKeys(release, ['version', 'publishedAt']) || typeof release.version !== 'string' ||
          !VERSION.test(release.version) || !validDate(release.publishedAt) ||
          Date.parse(release.publishedAt) > captured || releases.has(release.version))
        invalid(`${pointer}/releases/${releaseIndex}`);
      releases.set(release.version, release.publishedAt);
    }
    packages.set(row.name, { index, historyCompleteFrom: row.historyCompleteFrom, releases });
  }
  return { capturedAt: value.capturedAt, packages };
}
