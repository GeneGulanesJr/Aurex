# Dream Cycle

The Dream Cycle is LaPis' memory-quality cleanup pass. It targets stale or low-value memory, not old memory.

It runs per project every 10 sessions after the session ends. A 6-month-old valid decision should stay; a 1-day-old superseded setup note can be removed or consolidated.

## What It Cleans

| Phase               | What it cleans                                                   | Why it is stale                      |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------ |
| Superseded          | Memories with `duplicate` or `supersedes` relations.             | A newer memory replaces it.          |
| Stale auto-progress | `progress` and `accomplished` entries with zero recall.          | Never useful, just noise.            |
| Stale auto-detected | Auto-detected decisions with zero recall and low trust.          | Pattern-matched junk never acted on. |
| Stale corrections   | Titles starting with `CORRECTION:`.                              | Should have used `update` instead.   |
| Replaced configs    | Superseded setup/config memories.                                | Setup information was replaced.      |

## What It Does Not Do

- It does not delete memory because of age alone.
- It does not replace explicit user decisions with inferred memories.
- It does not run during the active session; cleanup happens after session end.

## Related Maintenance

`compact` is separate housekeeping. It prunes dead links, decays trust, runs SQLite vacuum, and optimizes FTS5.

`dream` is semantic cleanup. It reviews whether memories are superseded, never recalled, low-trust, or better represented by an existing updated memory.
