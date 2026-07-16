# Bounded PPTX XML Parsing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bound PPTX XML inflation and parser complexity before xmldom creates a DOM.

**Architecture:** ZIP central metadata enforces XML-specific byte budgets before extraction. A `saxes` streaming preflight consumes the extracted bytes through streaming UTF-8 decoding, applies structural budgets, and gates the existing xmldom parser.

**Tech Stack:** TypeScript, Jest, fflate, saxes, @xmldom/xmldom, pnpm

---

### Task 1: XML byte budgets

**Files:**
- Modify: `backend/src/infrastructure/knowledge/lib/document-pages.spec.ts`
- Modify: `backend/src/infrastructure/knowledge/lib/document-pages.ts`

1. Add failing tests that set small `maxPptxXmlPartBytes` and
   `maxPptxXmlTotalBytes` overrides and expect `PPTX_XML_LIMIT_EXCEEDED`.
2. Run the focused Jest tests and confirm both are RED.
3. Add frozen production maxima and check central uncompressed sizes for XML
   entries before calling `Inflate`.
4. Run the focused tests and confirm GREEN.

### Task 2: Streaming structural preflight

**Files:**
- Modify: `backend/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `backend/src/infrastructure/knowledge/lib/document-pages.spec.ts`
- Modify: `backend/src/infrastructure/knowledge/lib/document-pages.ts`

1. Add failing element-count and nesting-depth tests with small overrides.
2. Add direct `saxes` dependency.
3. Feed the exact extracted XML bytes through streaming `TextDecoder` chunks
   into `SaxesParser`, counting element starts, depth, UTF-8 text bytes,
   attribute count, and attribute bytes.
4. Throw `PPTX_XML_LIMIT_EXCEEDED` for structural budgets. Let SAX parse errors
   and DTD/entity rejection reach the existing `INVALID_DOCUMENT` cause wrapper.
5. Run focused tests and confirm GREEN.

### Task 3: Media isolation and strict ZIP profile

**Files:**
- Modify: `backend/src/infrastructure/knowledge/lib/document-pages.spec.ts`
- Modify: `backend/src/infrastructure/knowledge/lib/document-pages.ts`

1. Add a test proving media larger than the XML part cap remains accepted.
2. Add a documented rejection test for an otherwise valid archive with a
   prepended executable stub and adjusted ZIP offsets.
3. Add a code comment next to contiguous local-entry validation stating the
   Office-compatible ZIP profile.
4. Run both tests and the existing task suites.

### Task 4: Final verification and commit

**Files:**
- Verify all modified files above.

1. Format the modified TypeScript files.
2. Run:
   `pnpm --filter @dataflow/backend test -- --runInBand src/infrastructure/knowledge/lib/document-pages.spec.ts src/infrastructure/knowledge/lib/pptx-to-text.spec.ts`
3. Run: `pnpm --filter @dataflow/backend build`
4. Run: `git diff --check`
5. Self-review byte accounting, UTF-8 chunk boundaries, exception causes, and
   media/XML limit separation.
6. Commit implementation as `fix(knowledge): bound PPTX XML parsing`.
