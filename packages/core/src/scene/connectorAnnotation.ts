import type { ConnectorAnnotation } from "./types.js";

/**
 * Formats a structured connector annotation as IBM's kit describes it
 * (packages/core/docs/ibm-spec-conformance.md#connector-nomenclature): NAME, then a space-separated
 * SECURITY descriptor, then a `:PORT` suffix — e.g. `HTTPS TLS1.3:443`. The kit's own deck shows
 * this wrapped in a literal `[...]` bracket, but that bracket is template placeholder notation
 * (the same convention `[PORT]` itself uses, not literal punctuation to render) — this follows
 * docs/05's own worked example, which already drops it.
 */
export function formatConnectorAnnotation(
  annotation: ConnectorAnnotation,
): string {
  const withSecurity = annotation.security
    ? `${annotation.name} ${annotation.security}`
    : annotation.name;
  return annotation.port ? `${withSecurity}:${annotation.port}` : withSecurity;
}
