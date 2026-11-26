# Contributing

Thanks for helping. The most useful contribution is a new scenario.

## Add a scenario

1. Copy a bundled scenario from `scenarios/` that is close to what you want,
   and give the file a new number and name, for example
   `scenarios/13-ddos-sale.yaml`.
2. Read [docs/scenario-format.md](docs/scenario-format.md).
3. Write it, then check it:

   ```
   npm run validate-scenarios
   ```

4. Play it yourself in both versions: `npm run sim` and `npm run dev:web`.
5. Open a pull request.

### Scenario checklist

- Organizations and people are fictional and marked as fictional in `org`.
  Don't use real company names or real people.
- The solution scores 100% and doing nothing fails (the validator checks
  both).
- Every objective's `hit` and `miss` text explains something useful.
- At least one tempting mistake has a `lesson`.
- Advice in the scenario matches current, widely accepted practice. Link the
  guidance you relied on in `references`.
- Plain, direct language. The tests reject em and en dashes in scenario
  files, so use commas, colons or full stops instead.

## Change the code

```
npm install
npm test             # unit tests and a full play-through of every scenario
npm run build:web    # browser build
```

- `src/core/` holds the engine, the condition language, the scenario loader
  and the report. It has no Node or browser dependencies.
- `src/cli/` is the terminal version and the validator.
- `web/` is the browser version (Vite, no framework).

Keep the core small and well tested. If you change how scenarios behave,
update `docs/scenario-format.md` too.
