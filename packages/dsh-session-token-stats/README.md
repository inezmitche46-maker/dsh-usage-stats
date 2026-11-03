# dsh-session-token-stats

A composer token pill for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness): the current session's token total with a breakdown of uncached input, cache read, cache write and output tokens.

## What it adds

A **Token usage** pill in the composer dock (`conversation.composer.dock`), next to the built-in turn/status indicators:

- collapsed: whole-session token total (`1.2k` / `13.9M`);
- expanded: uncached input, cache read, cache write, output, total, and the cache-hit share;
- closes on `Esc`, outside click, scroll, or window resize; positions itself inside the viewport.

By default the plugin hides DSH's built-in usage pill so the same total is not shown twice, and moves the cache-hit share into its own panel. Set `HIDE_BUILTIN_USAGE_PILL = false` at the top of `client.js` to keep both pills.

## How it works

The pill is a pure **client-side** consumer of the `tokenUsage` session projection that `@deepseek-ai/dsh-token-meter` already registers in every base-backed profile. Its Host half is intentionally empty: mounting the bundle row is what puts the client half into the browser module graph.

- no Host service, event listener or session event is added;
- no files are read or written, no network requests are made;
- the numbers come from provider-reported usage for the whole session, including compacted history.

## Install

Requires DSH `>=0.2.1-rc.1 <0.3.0` and Node `>=22.19`.

```bash
dsh plugin --profile desktop add "github:inezmitche46-maker/dsh-usage-stats#path:/packages/dsh-session-token-stats"
```

Use `--profile web` on a Web profile. Restart DSH Desktop (or reload the page) after installing.

## Compatibility

- Tested against DSH `0.2.1-rc.2` (DSH Desktop Beta `2.0.18-beta.1`), Web surface.
- Client half registers one entry in `conversation.composer.dock` and binds the `session-token-stats` locale namespace (`zh` / `en`).

## Uninstall

```bash
dsh plugin --profile desktop remove dsh-session-token-stats
```

## License

MIT
