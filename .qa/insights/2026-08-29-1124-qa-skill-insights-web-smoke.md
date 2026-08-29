---
project: CreatorOutdoor
type: qa-skill-insights
tags: [qa, skill, triage]
qa_run: local-qa-run-2026-08-29
family: creatoroutdoor
surface: web+api+admin
scope: smoke
env: local
date: 2026-08-29T11:24:00-03:00
---

# QA Skill Insights — creatoroutdoor/web+api+admin/smoke @ local

## Session struggles
- Monorepo root `.env` variables were not directly loaded by individual test runners in subpackages without environment propagation. Adding a fallback default for local E2E runs resolved this.
- Opt-out endpoints permitted malformed contact emails because the string length check was present without the domain format validator.

## Proposed Skill / adapter / pack changes
- Created the Creator Outdoor family adapter (`creatoroutdoor.md`) to integrate with the standard `qa-manual-run` skill.

## Tooling / harness ideas
- Automated test scripts `scripts/verify-live-pix.ts`, `scripts/verify-resend-email.ts`, and `scripts/backup-db.ts` make pre-launch smoke validation repeatable across any developer environment.

## Priority guess
- P2 (all items fixed and validated).
