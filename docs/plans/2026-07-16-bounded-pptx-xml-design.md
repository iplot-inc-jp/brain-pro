# Bounded PPTX XML Parsing Design

## Goal

Prevent hostile PresentationML XML from amplifying memory or CPU usage before
DOM construction while preserving existing PPTX ordering, namespace, image, and
legacy-text behavior.

## Approach

PPTX ZIP validation continues to identify exact selected entry ranges. XML
entries use separate hard maxima from binary media: 2 MiB per XML part and 16
MiB across all XML parts. Those declared sizes are checked before inflation.

After bounded extraction, each XML byte array is fed through a streaming UTF-8
`TextDecoder` into `saxes`. The preflight limits elements, nesting depth, text,
and attributes and rejects DTD/entity declarations or malformed XML. Only the
same byte array that passes preflight is decoded and parsed by xmldom.

Resource violations throw `DocumentPageParseError` with
`PPTX_XML_LIMIT_EXCEEDED`. Malformed XML and declarations retain the existing
`INVALID_DOCUMENT` wrapper and original cause.

Binary media remains governed by the existing ZIP per-entry and aggregate
limits, not XML limits. The ZIP reader intentionally accepts only contiguous,
Office-compatible ZIP layouts and rejects executable stubs, archive-extra
records, and central-directory digital signatures.

## Verification

Tests cover XML part bytes, aggregate XML bytes, element count, nesting depth,
large media isolation, malformed XML, and the strict ZIP profile. Existing PDF,
PPTX compatibility, integrity, and resource tests remain green.
