# Dependency Age Report implementation plan

**Goal:** Report saved lockfile release age at a saved metadata snapshot timestamp, with honest cadence uncertainty and no vulnerability claim.

**Constraints:** One existing Git repository, Node ESM and built-ins only, no network or product writes, local commits only, no central ledger/receipts. Implement in this repo; no subagents because the slices share one evidence schema.

## 1. Clean saved-document slice

- Add strict duplicate-key JSON reader and own-data validators for npm package-lock v3 subset and metadata snapshot. Snapshot package/release indexes must be complete before any absence claim.
- Write the good test first: one installed `alpha@1.0.0` lock member, snapshot capturedAt fixed, release timestamp exactly one day earlier, complete 365-day history, no threshold; nonvacuous pass, `ageDays:1`, `observedReleases365d` known, `asOf` equals snapshot, no package/name/version echo.
- Run red missing implementation, implement minimal core, rerun green; commit the parser/core slice.

## 2. Unknown, review and bounds

- Test threshold exact N and N+1, day boundary 86399999/86400000ms, cadence lower endpoint and +1ms, null/late history, missing package/version, future release, root-only and unsupported link/alias/dialect, metadata duplicate/invalid index on either side. Known age may remain while cadence unknown; overall status incomplete.
- Add one-to-four distinct lock support, package-member sorted ordinals, fixed rule severity table and deterministic UTF-16 ordering. Pin 4/5 locks, 1000/1001 lock entries, 4000/4001 metadata packages, 64/65 releases, parser depth/nodes, bytes, deadline and empty-case N/N+1 where meaningful.
- Keep review candidate wording fixed and never call age a vulnerability; commit this analysis slice after targeted green tests.

## 3. CLI and offline boundary

- Add `--root`, repeated `--lock`, `--snapshot`, optional `--review-after-days`, `--json`, `--help`; JSON stdout and fixed human stderr; no `--report` or writes. Invalid configuration: exit2 empty stdout. Named unreadable/unsupported input: incomplete JSON exit2. Confine all reads to real root.
- Resolve/stat every named lock and reject same canonical path or `dev`+`ino` alias before counting. Real CLI tests must reach same path, in-root symlink alias, hard-link alias, distinct identical-byte files, symlink escape and root `/` good control.
- Add clean/failing/incomplete examples, README rule table/limits/non-goals, active network-denial preload and safe negative controls, npm lint/test/check, version 0.1.0; commit coherent CLI/docs slice.

## 4. Counterfactual and freeze

- Remove or flip each advertised semantic guard in a disposable mutation: release age source timestamp, threshold boundary/severity, cadence completeness and lower boundary, missing metadata, duplicate lock alias, read confinement, duplicate JSON key, privacy projection, incomplete status, code-unit order and offline guard. Each reached mutation must fail a named test; timeouts are not kills.
- Fresh full `npm run check`; direct example exits 0/1/2; raw NUL/LS/PS and attribution scan; `git diff --check`; clean tree and exact HEAD. Send measured Phase-1 signal to controller for independent Phase 2, without receipt or central edits.
