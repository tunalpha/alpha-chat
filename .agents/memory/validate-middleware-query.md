---
name: validate middleware read-only query/params
description: req.query and req.params are getter-only properties in Express 5 / Node.js http; direct assignment throws TypeError
---

**Rule:** In the `validate` middleware, never do `(req as any)[target] = data` for `target === "query"` or `target === "params"`. These properties are getter-only on `http.IncomingMessage` in newer Node.js/Express versions.

**Why:** `TypeError: Cannot set property query of #<IncomingMessage> which has only a getter` is thrown at runtime, returning a 500 INTERNAL_ERROR.

**How to apply:** Use `Object.defineProperty`:
```typescript
Object.defineProperty(req, target, {
  value: result.data,
  writable: true,
  configurable: true,
  enumerable: true,
});
```
`req.body` can still be assigned directly (it's a regular writable property set by body-parser).

**File:** `src/middleware/validate.middleware.ts`
