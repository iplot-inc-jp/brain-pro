# Sealed External Material Design

## Objective

Prevent replay of a previously issued upload URL from changing the bytes later consumed or downloaded, while preserving retryable uploads and crash recovery.

## Storage boundary

`prepare` signs only a mutable staging pathname. The verifier reads, measures, hashes, and structurally validates staging bytes, then writes that exact verified buffer to a server-only content-addressed sealed pathname. The sealed write disables overwrite. A pre-existing sealed object is reused only after private metadata matches the expected pathname, size, and MIME type.

Only the sealed pathname is persisted in `Attachment.blobUrl` and `IngestionFile.blobUrl`. Download URLs are available only after `BATCHED` and always target sealed content. Staging deletion is best effort after sealing/batching; replay can therefore create only an unreferenced staging object.

## Recovery

Status polling is active recovery. `STORED` starts, retries, or recovers the deterministic verifier job. `BATCHED` starts, retries, or recovers the deterministic ingestion root. Existing successful page jobs remain untouched through the existing root resume behavior.

## Security

The public attachment endpoint rejects external material either by the `LINE・Slack` folder marker or by a `private-blob:` URL/reference marker. Editing one field cannot make the private object public.

## Tests

Tests cover staging replay after seal, one sealed write under retry/concurrency, poll recovery for `STORED` and `BATCHED`, BATCHED-only sealed download, and both public-route denial markers.
