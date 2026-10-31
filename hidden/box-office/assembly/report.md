---
run_id: box-office-20261031-181939
slug: box-office
rounds: 1
verdict: published
task_order:
  - T-001
  - T-002
  - T-003
  - T-004
  - T-005
  - T-006
  - T-007
merges:
  - round: 1
    task_id: T-001
    impl_sha: 2d8c53f6657cf240f38f2161640798d3cdfdb4ea
    result: skipped_ancestor
  - round: 1
    task_id: T-002
    impl_sha: 820aacc91e80d1e6e6432f9b3ced95209ec9756d
    result: skipped_ancestor
  - round: 1
    task_id: T-003
    impl_sha: d55cf44fbc3e69ae3dd73d00643385cfcc9ca699
    result: skipped_ancestor
  - round: 1
    task_id: T-004
    impl_sha: 2848c499030ee95bc6ab4b03449aaabedbbf6e18
    result: skipped_ancestor
  - round: 1
    task_id: T-005
    impl_sha: df6d40b9f0bed5c848259619a66dab11039422f9
    result: skipped_ancestor
  - round: 1
    task_id: T-006
    impl_sha: c2648b48d682828024a82c5d264aa4dea113a587
    result: skipped_ancestor
  - round: 1
    task_id: T-007
    impl_sha: 4307a411cbe63b832c809df9bec9be7b6471585b
    result: skipped_ancestor
verification:
  - round: 1
    step: install
    argv:
      - npm
      - ci
      - --prefer-offline
      - --no-audit
      - --no-fund
    exit_code: 0
    duration_ms: 1196
    result: green
    evidence_path: /Users/cyberash/Projects/multi-agent-hackaton/.factory/runs/box-office-20261031-170345/handoffs/assembly/round-1/install.log
  - round: 1
    step: typecheck
    argv:
      - npx
      - tsc
      - --noEmit
    exit_code: 0
    duration_ms: 1027
    result: green
    evidence_path: /Users/cyberash/Projects/multi-agent-hackaton/.factory/runs/box-office-20261031-170345/handoffs/assembly/round-1/typecheck.log
  - round: 1
    step: build
    argv:
      - npm
      - run
      - build
    exit_code: 0
    duration_ms: 600
    result: green
    evidence_path: /Users/cyberash/Projects/multi-agent-hackaton/.factory/runs/box-office-20261031-170345/handoffs/assembly/round-1/build.log
  - round: 1
    step: test
    argv:
      - npx
      - vitest
      - run
      - --reporter=json
      - --outputFile=/Users/cyberash/Projects/multi-agent-hackaton/.factory/runs/box-office-20261031-170345/handoffs/assembly/round-1/vitest.json
    exit_code: 0
    duration_ms: 4515
    result: green
    evidence_path: /Users/cyberash/Projects/multi-agent-hackaton/.factory/runs/box-office-20261031-170345/handoffs/assembly/round-1/vitest.json
  - round: 1
    step: sdd_ready
    argv:
      - npx
      - sdd
      - ready
      - --format=json
    exit_code: 0
    duration_ms: 444
    result: green
    evidence_path: /Users/cyberash/Projects/multi-agent-hackaton/.factory/runs/box-office-20261031-170345/handoffs/assembly/round-1/sdd_ready.json
sdd_ready:
  ok: true
  violations: []
triage: []
reworks: []
fixes: []
published: null
---

# Assembly report box-office box-office-20261031-181939

## Round 1

- merge T-001 2d8c53f6657c: skipped_ancestor
- merge T-002 820aacc91e80: skipped_ancestor
- merge T-003 d55cf44fbc3e: skipped_ancestor
- merge T-004 2848c499030e: skipped_ancestor
- merge T-005 df6d40b9f0be: skipped_ancestor
- merge T-006 c2648b48d682: skipped_ancestor
- merge T-007 4307a411cbe6: skipped_ancestor
- install: green (exit 0, 1196 ms) `npm ci --prefer-offline --no-audit --no-fund`
- typecheck: green (exit 0, 1027 ms) `npx tsc --noEmit`
- build: green (exit 0, 600 ms) `npm run build`
- test: green (exit 0, 4515 ms) `npx vitest run --reporter=json --outputFile=/Users/cyberash/Projects/multi-agent-hackaton/.factory/runs/box-office-20261031-170345/handoffs/assembly/round-1/vitest.json`
- sdd_ready: green (exit 0, 444 ms) `npx sdd ready --format=json`

## Published

publication pending
