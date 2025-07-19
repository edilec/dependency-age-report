# Dependency Age Report design

## Purpose

Read one to four named local npm package-lock v3 exports and one timestamped package-metadata snapshot. For each installed package occurrence, report the age of its exact installed release at the snapshot capture time, a bounded release-cadence observation, and optional review candidates. This is saved-document evidence. It is not a vulnerability scan, maintainer judgment, update recommendation, live registry lookup, or lockfile editor.

## Input dialects

The supported lock dialect is a strict JSON document with `lockfileVersion: 3` and an object-valued `packages` index. Standard npm v3 top-level and per-entry metadata not needed for age may be present and is ignored; this is documented non-evaluation, not a claim about those fields. `packages['']` is the project root and is not counted as an installed dependency. Every other package key must be a bounded `node_modules/<name>` or nested `node_modules/.../node_modules/<name>` path. Package names use a bounded lowercase ASCII npm-name subset, including `@scope/name`. Entries need an exact bounded installed `version` string. A link, local `file:` version, unsupported key shape, alias whose declared `name` conflicts with the key, duplicate decoded JSON key, or missing version is incomplete evidence; no install is silently dropped. The tool never executes scripts or reads a package manager's live state.

The metadata snapshot is an exact version-1 object:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-01-01T00:00:00.000Z",
  "packages": [
    {
      "name": "alpha",
      "historyCompleteFrom": "2025-01-01T00:00:00.000Z",
      "releases": [
        { "version": "1.0.0", "publishedAt": "2024-01-01T00:00:00.000Z" }
      ]
    }
  ]
}
```

`historyCompleteFrom` may be `null`, which means cadence coverage is unknown. Dates are canonical millisecond UTC. Package and version identities are exact ASCII tokens, compared without semver ordering. Every release timestamp must be no later than `capturedAt`; duplicate package names, duplicate release versions, malformed entries, and unsupported fields make the metadata index incomplete. A metadata package missing for an installed lock member, or a package present without that exact version's release timestamp, is unknown, not age zero. A malformed metadata index cannot positively establish absence from its partial contents. Multiple locks retain separate occurrences, even when name/version repeat.

## Calculations and outcome

`ageDays = floor((capturedAt - installedVersion.publishedAt) / 86400000)`. `capturedAt` is the only age reference, never the current wall clock; the report labels it as the snapshot's date. Exactly one day old is 1, one millisecond less is 0. A review threshold `--review-after-days N` (0–36500) emits `age-review-candidate` only when `ageDays > N`; at N it is silent. The rule is a candidate to inspect, **not** a vulnerability or upgrade claim. With no threshold, age alone does not fail.

Cadence is the number of observed releases with `publishedAt` in `(capturedAt - 365 * 86400000, capturedAt]`, explicitly called `observedReleases365d`. It is known only when that package's `historyCompleteFrom` is at or before the lower endpoint. A later or null completeness date makes the cadence field `null` and overall status incomplete, while an exact installed-version age may remain visible. `latestObservedPublishedAt` is a timestamp from the supplied records, never a claim that the registry has no later release. A release at the lower endpoint is excluded; one millisecond later is included. The snapshot's completeness claim is exporter-supplied and not independently verified.

Each report row is located by fixed lock ordinal and **code-unit-sorted package-member ordinal**. The source pointer `/packages/@N` is a documented ordinal projection, not a literal JSON Pointer key; this avoids rendering untrusted package paths/names. Metadata rows are similarly located by their array index. No package name, version, filename, URL, message, raw query, or hash is rendered. Only validated canonical timestamps, nonnegative age/count numbers, fixed class words, and source ordinals appear. Sort findings by `(file,pointer,ruleId)` using UTF-16 code units, with fixed ordinal tie handling.

Complete evidence and no active review candidate: `pass`/0, nonzero checked. Complete evidence with at least one active candidate: `fail`/1. Missing, unreadable, unsupported, truncated, future-dated, or cadence-incomplete evidence: `incomplete`/2, retaining known ages and candidates without calling the whole run clean. Invalid CLI/configuration: exit 2 with empty stdout and a fixed stderr diagnostic. An unreadable named lock or snapshot: exit 2 with an incomplete JSON report. No package subjects (including a root-only lock) is incomplete, never vacuous pass.

## CLI and bounds

`dependency-age-report --root DIR --lock FILE [--lock FILE ...] --snapshot FILE [--review-after-days N] [--json]`; `--help` prints usage. JSON report only on stdout; fixed human summary on stderr unless `--json`. No output file and no writes. All named inputs resolve through realpath within the real declared root; symlinked escapes are refused. Missing inputs remain named subjects with an incomplete report. Absolute host paths and untrusted basenames never enter output.

Defaults: one to four lockfiles, 4 MiB per input, 1000 package members per lock, 4000 metadata packages, 64 releases per metadata package, JSON depth 32 and 200000 nodes, and a 2000 ms finite nondecreasing injected analysis deadline. Each count and byte/time bound gets exact N and N+1 tests; a cutoff at `reviewAfterDays` N and N+1 is pinned too. Unknown options or analysis limits are configuration errors. The clock is used only to bound analysis, not to compute age.

## Test and mutation obligations

Start with a real package-lock v3 and a complete saved metadata snapshot whose installed release age and cadence are exactly known. Pin no-threshold pass, threshold N/N+1, day N/N+1, cadence lower-endpoint N/N+1, nested/scoped package good cases, two-lock separate occurrences, missing package and version, null/late history coverage, future release, bad lock dialect, root-only/no-subject, dynamic symlink escape, duplicate decoded keys, invalid UTF-8, record/byte/depth/node/deadline limits, deterministic ordering and output privacy canaries. A missing metadata side and an unsupported lock side must never become a positive absence or zero age. Use an active no-network preload plus safe data-URL and null-socket controls; product source has no network, subprocess, registry, Git, or write path. Every README guarantee needs a named regression deliberately made red by removal or a targeted mutation that reaches the actual branch. Run `npm run check` and freeze a clean local commit for independent Phase 2; do not receipt or change the central ledger.
