# Operit port changes

The port keeps the locked command and data semantics while applying these host changes:

- Browser and SillyTavern globals are replaced by the typed `MvuPortContext` adapter.
- Dynamic evaluation is removed; structured input and mathematics use bounded parsers.
- Prototype keys, internal `$operit` paths, excessive path depth and oversized input are rejected.
- World-book, chat, model and toast calls are not imported into the core.
- Operit actor scope, file transactions, change records and prompt projection are implemented as application extensions.
- UI mutations are routed through the same MVU command transaction used by message, rule and AI sources.

The corresponding source is in `src/mvu/core` and `src/mvu/port`; behavior is covered by
the `mvu-command-parser`, `mvu-executor` and application integration tests.
