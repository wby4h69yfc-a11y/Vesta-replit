---
name: wa_conversations rating context
description: How to store non-approval context (e.g. rating_request) in wa_conversations.proposed_payload
---

## Rule
When inserting a `wa_conversations` row with `thread_context='rating_request'`, cast `proposed_payload` as `any` because the column's `.$type<>()` is typed for the approval shape `{ title, type, category, datetime, artifact_id? }`.

```typescript
proposed_payload: { contact_id: contact.id, contact_name: contact.name } as any,
```

**Why:** Drizzle's `.$type<T>()` on jsonb columns narrows the TypeScript type at compile time but has no runtime effect — any valid JSON is accepted by Postgres. The approval payload type is the "default" shape; rating and other future contexts reuse the same column with a different structure, gated by `thread_context`.

**How to apply:** Any new `thread_context` value (e.g. `rating_upgrade_prompt`) that stores a different payload shape should use the same `as any` pattern and document its expected shape in a comment alongside the insert.
