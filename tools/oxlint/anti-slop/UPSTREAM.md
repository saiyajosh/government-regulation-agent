# Vendored anti-slop Oxlint plugin

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (2026-09-10).

Copied from the upstream path `skills/install-anti-slop/assets/anti-slop/` via the
`install-anti-slop` skill bundle (`skills-lock.json` hash
`4031728fbe75bdcad6ee3208fd52b5d66e167b056fefee1fa9758e9a6cb9c0c8`). All 38 files
were verified byte-for-byte against that commit's Git tree by blob hash on 2026-09-21.

## Installed paths

- `tools/oxlint/anti-slop/index.ts` — generic plugin, registered in `.oxlintrc.json` as `anti-slop`.
- `tools/oxlint/anti-slop/effect/index.ts` — Effect plugin, copied but **not registered** (this repository has no direct `effect` dependency).
- `tools/oxlint/anti-slop/vendor/eslint-stylistic/` — vendored `padding-line-between-statements`; see its own `UPSTREAM.md` and `LICENSE`.

## Dependencies

`oxlint` and `@oxlint/plugins` are pinned exactly at `1.85.0`. Upgrade both together.

## Intentional deviations

None. The vendored source is unmodified from upstream.
