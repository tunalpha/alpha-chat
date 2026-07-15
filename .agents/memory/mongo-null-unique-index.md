---
name: MongoDB null unique index
description: Sparse+unique indexes in MongoDB index explicit null values, causing E11000 on multi-user scenarios with nullable fields
---

**Rule:** Never use `{ unique: true, sparse: true }` on fields that have `default: null` in Mongoose. Sparse only excludes documents where the field is ABSENT (undefined); it still indexes explicit `null` values, so two documents with `field: null` will violate the unique constraint.

**Why:** In `user.model.ts`, `email` and `phone_hash` have `default: null`. When two users register without email, both get `email: null`, which the sparse+unique index treats as a duplicate.

**How to apply:** Use `partialFilterExpression` instead:
```typescript
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } } },
);
```
This indexes only documents where the field is a non-null string, allowing multiple `null` values.

**Applies to:** Any Mongoose field with `default: null` + `{ unique: true, sparse: true }`.
