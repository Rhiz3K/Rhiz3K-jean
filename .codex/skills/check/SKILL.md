---
name: check
description: Check work for adherence with architecture and run checks.
---

# $check — Check Work

## Purpose

Check work for adherence with the project architecture and run quality checks.

## Usage

Invoke with `$check`.

## Execution

1. Check all work in this session for adherence with `docs/developer/architecture-guide.md`.
2. Remove any unnecessary comments or `console.log`s introduced in the session and clean up leftovers from approaches that didn’t work.
3. Run `npm run check:all` and fix any errors.
