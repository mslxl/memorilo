# Domain Docs

This repository uses a multi-context domain documentation layout.

## Before exploring

- Read the root `GLOSSARY-MAP.md` when it exists.
- Follow it to each relevant context's `GLOSSARY.md`.
- Read relevant system-wide ADRs under `docs/adr/`.
- Read relevant context-specific ADRs beside each context.

If these files do not yet exist, proceed silently. The domain-modeling workflow creates them when domain terminology or architectural decisions are established.

## Expected structure

```text
/
|-- GLOSSARY-MAP.md
|-- docs/adr/
|-- apps/
|   `-- desktop/
|       |-- GLOSSARY.md
|       `-- docs/adr/
`-- packages/
    |-- editor/
    |   |-- GLOSSARY.md
    |   `-- docs/adr/
    `-- e2e/
        |-- GLOSSARY.md
        `-- docs/adr/
```

The context map decides which directories represent independent domain contexts. A workspace package does not automatically need its own context document.

## Vocabulary

Use terminology defined in the relevant `GLOSSARY.md`. Avoid introducing synonyms that conflict with the project glossary.

## ADR conflicts

If proposed work contradicts an existing ADR, identify the conflict explicitly instead of silently overriding the decision.
