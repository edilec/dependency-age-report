import { EvidenceError, snapshotEvidence, validateLock, validateSnapshot } from './validate.mjs';

export const TOOL_ID = 'dependency-age-report';
export class ConfigError extends Error { constructor() { super('Invalid analysis configuration.'); this.name = 'ConfigError'; } }
export const MAX_INPUT_BYTES = 4194304;
export const DEFAULT_LIMITS = Object.freeze({
  maxLocks: 4, maxMembers: 1000, maxMetadataPackages: 4000, maxReleases: 64,
  maxDepth: 32, maxNodes: 200000, timeoutMs: 2000,
});
export const RULE_SEVERITY = Object.freeze({
  'input-invalid': 'warning', 'input-unreadable': 'warning', 'path-outside-root': 'warning',
  'duplicate-lock-input': 'warning', 'lock-invalid': 'warning', 'snapshot-invalid': 'warning',
  'snapshot-package-missing': 'warning', 'snapshot-release-missing': 'warning',
  'cadence-unavailable': 'warning', 'no-subject': 'warning', 'limit-exceeded': 'warning',
  'age-review-candidate': 'error',
});
const MESSAGE = Object.freeze({
  'input-invalid': 'Saved input evidence is unsupported or incomplete.',
  'input-unreadable': 'A named local input could not be read or decoded.',
  'path-outside-root': 'A named local input resolves outside the declared root.',
  'duplicate-lock-input': 'Two named locks identify the same local file; no duplicate occurrence was counted.',
  'lock-invalid': 'A saved lockfile has an unsupported package-lock v3 member or index.',
  'snapshot-invalid': 'The saved metadata snapshot index is unsupported or incomplete.',
  'snapshot-package-missing': 'The complete metadata index has no package for this lock member.',
  'snapshot-release-missing': 'The metadata package has no exact release timestamp for this saved version.',
  'cadence-unavailable': 'The exporter did not substantiate the full 365-day release window.',
  'no-subject': 'No installed package member was available to check.',
  'limit-exceeded': 'A declared analysis bound was exceeded.',
  'age-review-candidate': 'Recorded-release age at snapshot exceeds the configured review threshold; this is not a vulnerability claim.',
});
export const codeUnitCompare = (a, b) => a === b ? 0 : a < b ? -1 : 1;
const DAY = 86400000;
const WINDOW = 365 * DAY;

function finding(ruleId, file, pointer = '') {
  if (!Object.hasOwn(RULE_SEVERITY, ruleId) || !Object.hasOwn(MESSAGE, ruleId)) throw new Error('Unknown rule.');
  return { ruleId, severity: RULE_SEVERITY[ruleId], message: MESSAGE[ruleId],
    location: { file, pointer } };
}
function finish({ findings, packages, checked, asOf, incomplete = false }) {
  findings.sort((a, b) => codeUnitCompare(a.location.file, b.location.file) ||
    codeUnitCompare(a.location.pointer, b.location.pointer) || codeUnitCompare(a.ruleId, b.ruleId));
  const errors = findings.filter(row => row.severity === 'error').length;
  const warnings = findings.filter(row => row.severity === 'warning').length;
  return { schemaVersion: '1', tool: TOOL_ID,
    status: incomplete || warnings || checked === 0 ? 'incomplete' : errors ? 'fail' : 'pass',
    summary: { checked, errors, warnings, occurrences: packages.length },
    asOf, packages, findings };
}
export function incompleteInput(ruleId, file = 'input', pointer = '') {
  if (!['input-invalid', 'input-unreadable', 'path-outside-root', 'duplicate-lock-input', 'limit-exceeded'].includes(ruleId) ||
      !/^(?:snapshot|lock-[0-3]|input)$/u.test(file) ||
      typeof pointer !== 'string' || !/^\/(?:[A-Za-z0-9@/-]+)?$/u.test(pointer) && pointer !== '') throw new ConfigError();
  return finish({ findings: [finding(ruleId, file, pointer)], packages: [], checked: 0, asOf: null, incomplete: true });
}

function checkedOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new ConfigError();
  const known = ['now', 'limits', 'reviewAfterDays'];
  let now = Date.now, limits = {}, reviewAfterDays = null;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(options))) throw new ConfigError();
    for (const key of Reflect.ownKeys(options)) {
      const descriptor = Object.getOwnPropertyDescriptor(options, key);
      if (typeof key !== 'string' || !known.includes(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new ConfigError();
      if (key === 'now') now = descriptor.value;
      else if (key === 'limits') limits = descriptor.value;
      else reviewAfterDays = descriptor.value;
    }
    if (typeof now !== 'function' || !limits || typeof limits !== 'object' || Array.isArray(limits) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(limits))) throw new ConfigError();
    if (reviewAfterDays !== null && (!Number.isSafeInteger(reviewAfterDays) || reviewAfterDays < 0 || reviewAfterDays > 36500)) throw new ConfigError();
    const bounds = { ...DEFAULT_LIMITS };
    for (const key of Reflect.ownKeys(limits)) {
      const descriptor = Object.getOwnPropertyDescriptor(limits, key);
      const value = descriptor?.value;
      if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') ||
          !Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) throw new ConfigError();
      bounds[key] = value;
    }
    return { now, bounds, reviewAfterDays };
  } catch { throw new ConfigError(); }
}

export function reportDependencyAge(input, options = {}) {
  const { now, bounds, reviewAfterDays } = checkedOptions(options);
  let started;
  try { started = now(); } catch { throw new ConfigError(); }
  if (!Number.isFinite(started)) throw new ConfigError();
  const findings = [], packages = [];
  let checked = 0;
  let value;
  try { value = snapshotEvidence(input, bounds); }
  catch (error) {
    if (!(error instanceof EvidenceError)) throw error;
    return finish({ findings: [finding(error.code === 'limit-exceeded' ? 'limit-exceeded' : 'input-invalid', 'input', error.pointer)], packages, checked, asOf: null, incomplete: true });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 2 || !Object.hasOwn(value, 'locks') || !Object.hasOwn(value, 'snapshot') ||
      !Array.isArray(value.locks) || value.locks.length === 0) {
    findings.push(finding('input-invalid', 'input'));
    return finish({ findings, packages, checked, asOf: null, incomplete: true });
  }
  if (value.locks.length > bounds.maxLocks) {
    findings.push(finding('limit-exceeded', 'input', '/limits/maxLocks'));
    return finish({ findings, packages, checked, asOf: null, incomplete: true });
  }
  let snapshot;
  try { snapshot = validateSnapshot(value.snapshot, bounds); }
  catch (error) {
    if (!(error instanceof EvidenceError)) throw error;
    findings.push(finding(error.code === 'limit-exceeded' ? 'limit-exceeded' : 'snapshot-invalid', 'snapshot', error.pointer));
  }
  let subjects = 0, completeLockIndexes = true;
  for (let lockOrdinal = 0; lockOrdinal < value.locks.length; lockOrdinal++) {
    const file = `lock-${lockOrdinal}`;
    let members;
    try { members = validateLock(value.locks[lockOrdinal], bounds); }
    catch (error) {
      if (!(error instanceof EvidenceError)) throw error;
      completeLockIndexes = false;
      findings.push(finding(error.code === 'limit-exceeded' ? 'limit-exceeded' : 'lock-invalid', file, error.pointer));
      continue;
    }
    for (const member of members) {
      subjects++;
      const pointer = `/packages/@${member.ordinal}`;
      const row = { location: { file, pointer }, lockOrdinal, memberOrdinal: member.ordinal,
        recordedReleaseAgeDays: null, observedReleases365d: null, latestObservedPublishedAt: null };
      packages.push(row);
      if (!snapshot) continue;
      const metadata = snapshot.packages.get(member.name);
      if (!metadata) { findings.push(finding('snapshot-package-missing', file, pointer)); continue; }
      const captured = Date.parse(snapshot.capturedAt);
      const published = metadata.releases.get(member.version);
      if (published === undefined) findings.push(finding('snapshot-release-missing', file, pointer));
      else {
        row.recordedReleaseAgeDays = Math.floor((captured - Date.parse(published)) / DAY);
        checked++;
        if (reviewAfterDays !== null && row.recordedReleaseAgeDays > reviewAfterDays)
          findings.push(finding('age-review-candidate', file, pointer));
      }
      let latest = null, count = 0;
      const lower = captured - WINDOW;
      for (const date of metadata.releases.values()) {
        const time = Date.parse(date);
        if (latest === null || time > Date.parse(latest)) latest = date;
        if (time > lower && time <= captured) count++;
      }
      row.latestObservedPublishedAt = latest;
      if (metadata.historyCompleteFrom === null || Date.parse(metadata.historyCompleteFrom) > lower)
        findings.push(finding('cadence-unavailable', file, pointer));
      else { row.observedReleases365d = count; checked++; }
    }
  }
  if (subjects === 0 && completeLockIndexes) findings.push(finding('no-subject', 'input', '/locks'));
  let ended;
  try { ended = now(); } catch { throw new ConfigError(); }
  if (!Number.isFinite(ended) || ended < started) throw new ConfigError();
  if (ended - started > bounds.timeoutMs) findings.push(finding('limit-exceeded', 'input', '/limits/timeoutMs'));
  return finish({ findings, packages, checked, asOf: snapshot?.capturedAt ?? null });
}
