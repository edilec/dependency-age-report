# Dependency Age Report

Read saved npm package-lock v3 files alongside a timestamped package-metadata export. The report identifies how old the **recorded release** was at the metadata snapshot time, summarizes the exporter's supported 365-day release history, and optionally marks age-based review candidates. It does not say when a package was installed, whether it is vulnerable, or whether it should be upgraded. No registry, database, browser, host, or live package manager is contacted.

## Quick start

Node 22 or newer; no runtime or development dependencies.

```sh
node bin/dependency-age-report.mjs --root examples/clean --lock package-lock.json --snapshot metadata.json
node bin/dependency-age-report.mjs --root examples/failing --lock package-lock.json --snapshot metadata.json --review-after-days 30
node bin/dependency-age-report.mjs --root examples/incomplete --lock package-lock.json --snapshot metadata.json
npm run check
```

These examples exit 0, 1 and 2 respectively. `--help` prints usage. JSON goes to stdout; a fixed human summary goes to stderr unless `--json` is specified. The tool has no report-file option and never writes an input or output file.

## Saved input profile

`--root` must name an existing local directory. One to four `--lock FILE` options and one `--snapshot FILE` are required. Each file must resolve within the real root; symlink escapes are refused. The same lock named twice, or through an in-root symlink or hard link, makes the run incomplete and counts no duplicate occurrence. Distinct files may contain identical bytes and remain distinct occurrences. All documents are UTF-8 JSON, parsed with duplicate decoded object-key and numeric-rounding checks.

Each lock is npm package-lock **version 3** with an object-valued `packages` index. The root `packages[""]` is not an installed member. Other keys follow `node_modules/<name>` or nested `.../node_modules/<name>`, including `@scope/name`. Names use 1–128 lowercase ASCII letters, digits, dot, underscore, tilde or hyphen, starting with a letter or digit in each segment. Each installed member needs a bounded exact `version` token. A `resolved` field, if present, must be a parsed HTTP(S) locator with a host and is never fetched or printed. A `link` marker may be absent or the boolean `false`; `true` or a malformed marker is unsupported. Link/local versions or locators, absent versions, unsupported keys, and alias-name conflicts are incomplete; no member is silently skipped. Other ordinary npm metadata is ignored, not evaluated.

The snapshot is an exact version-1 JSON object with `schemaVersion`, canonical millisecond UTC `capturedAt`, and a `packages` array. Each package row has exact `name`, `historyCompleteFrom` (canonical UTC or `null`), and `releases`; each release has exact `version` and canonical `publishedAt`. The snapshot may not contain duplicate package or release identities, unknown fields, or a release dated after capture. `historyCompleteFrom` is an exporter claim about completeness, not independent verification. See [the clean metadata example](examples/clean/metadata.json).

## Calculation and evidence

`recordedReleaseAgeDays` is `floor((capturedAt − exact installed-version publishedAt) / 86400000)`. This is release age at the **snapshot timestamp**, not duration installed. A lockfile has no capture time in this profile. The tool never substitutes the current clock for a missing release date. Missing metadata package, missing exact release, invalid index, or unsupported lock member gives an incomplete report, never age zero.

`observedReleases365d` counts saved release timestamps in `(capturedAt − 365 days, capturedAt]`. It is known only when `historyCompleteFrom` is at or before the lower endpoint; otherwise the count is `null` and status is incomplete. `latestObservedPublishedAt` is the latest timestamp in the supplied export, not a claim about current registry state. The optional `--review-after-days N` (0–36500) raises a review candidate only when a known age is **greater than** N. It is not a vulnerability assertion; a complete no-threshold report can pass with old releases.

Report rows use `lock-0`, `lock-1`, and so on, plus `/packages/@N`, where `N` is the package key's UTF-16 code-unit-sorted ordinal. This is an ordinal projection, **not** a literal JSON Pointer key. Metadata array positions remain numeric. Opaque package names, versions, filenames, URLs and paths are never printed; fixed source ordinals let a local operator inspect the named files. Findings sort by code-unit `(file,pointer,ruleId)`.

## Rules

| Rule ID | Severity | Meaning |
| --- | --- | --- |
| `input-invalid` | warning | A named JSON document is unsupported or cannot be decoded. |
| `input-unreadable` | warning | A named local file cannot be read. |
| `path-outside-root` | warning | A named file resolves beyond the declared root. |
| `duplicate-lock-input` | warning | Two lock names identify one file; none is double-counted. |
| `lock-invalid` | warning | A saved v3 member or index is unsupported. |
| `snapshot-invalid` | warning | The metadata index is unsupported or incomplete. |
| `snapshot-package-missing` | warning | Complete snapshot has no named member package. |
| `snapshot-release-missing` | warning | Metadata has no exact timestamp for the recorded version. |
| `cadence-unavailable` | warning | Full 365-day history was not substantiated. |
| `no-subject` | warning | No installed member was available to check. |
| `limit-exceeded` | warning | A byte, count, structure or time bound was crossed. |
| `age-review-candidate` | error | Recorded-release age at snapshot exceeded the optional threshold; not a vulnerability claim. |

Warnings make overall status `incomplete`, even beside a proven review candidate. `no-subject` is emitted only after every supplied lock index validates and the combined installed-member set is genuinely empty; an invalid or over-limit lock leaves membership unknown. Complete evidence with an active candidate is `fail`; complete evidence without one is `pass`. A pass has nonzero checks.

## Exit codes and bounds

| Exit | Meaning | stdout |
| ---: | --- | --- |
| 0 | Complete report, no candidate (`pass`) | JSON report |
| 1 | Complete report, candidate (`fail`) | JSON report |
| 2 | Named evidence incomplete/unsupported (`incomplete`) | JSON report |
| 2 | Invalid CLI or library configuration | Empty |

Limits: 1–4 lockfiles, 4,194,304 bytes per file, 4,096 units per named input path, 128 units per name or version token, 1,000 installed members per lock (root excluded), 4,000 snapshot packages, 64 releases per package, JSON depth 32 and 200,000 nodes, and a 2,000 ms analysis deadline. A bound accepts exactly N and refuses N+1. Library callers may lower analysis limits but not raise them; the CLI byte bound is separate. The injected clock must be finite and nondecreasing; it bounds work only. Input capture time alone determines ages. The JSON parser refuses duplicate decoded keys and numeric tokens that JavaScript would round into a misleading value.

## Limits and non-goals

The input dialect is deliberately narrow and only reports saved evidence. It does not run `npm`, inspect a live installation, resolve packages, infer semver compatibility, score maintainer health, classify vulnerabilities, edit lockfiles, or produce an upgrade plan. The metadata exporter must supply complete history for cadence; a `null` or later completeness date is unknown. Every test runs under an active network-denial preload, with a negative control proving denial works without contacting a host.
