/**
 * Extra search keywords for specific icons, layered on top of the ones `build.ts` auto-derives by
 * tokenizing each icon's own display name. That auto-derivation is the only source of `keywords`
 * otherwise, so a common architecture term with no overlap with an icon's literal upstream name —
 * e.g. "region" for an icon named just "location" — is otherwise unsearchable even though the icon
 * is exactly what that term means and is already used that way elsewhere in this codebase (see
 * `packages/core/src/templates/templates.ts`'s `detailed` template, which uses `ibm-cloud/location`
 * as its region Box's corner icon).
 *
 * Keyed by the icon's slug (the part of its id after the `ibm-cloud/` prefix), not its full id —
 * matches how `packages/catalog-build/src/build.ts` derives ids, and stays valid across a version
 * bump as long as the slug itself doesn't change.
 *
 * Only add a term here once you've confirmed by hand that the icon is a genuine, defensible match
 * for it (docs/04-icon-catalog.md) — not every plausible architecture term has a real icon behind
 * it (e.g. no icon in this catalog specifically depicts a "zone" or "container" as such), and
 * forcing an unrelated icon to match one just to avoid a zero-result search is worse than the gap.
 */
export const KEYWORD_OVERRIDES: Record<string, string[]> = {
  location: ["region"],
  "database-redis": ["cache"],
  "data-center": ["on-prem", "on-premises", "on premises"],
  // "lb" is generic shorthand for the whole load-balancer family, not one specific icon.
  "global-load-balancer": ["lb"],
  "load-balancer-application": ["lb"],
  "load-balancer-classic": ["lb"],
  "load-balancer-listener": ["lb"],
  "load-balancer-listner": ["lb"], // sic — real upstream slug typo, not ours to fix here
  "load-balancer-pool": ["lb"],
  "load-balancer-vpc": ["lb"],
  "local-load-balancer": ["lb"],
  "network-load-balancer": ["lb"],
  // "k8s" means Kubernetes specifically, not OpenShift — a different, if related, product.
  kubernetes: ["k8s"],
  "kubernetes-cluster": ["k8s"],
  // "VM"/"VSI" (Virtual Server Instance, IBM's own term — used as this project's own reference
  // diagram's connector label) both mean this icon specifically, not the instance-bx/cx/mx/group
  // family, which represents a more specific compute-profile or grouping concept.
  "virtual-server": ["vm", "vsi"],
  "virtual-server-classic": ["vm", "vsi"],
};

/** Merges an icon's auto-derived (tokenized-from-name) keywords with any manual overrides for its
 * slug above, deduped. Lives here rather than in build.ts (a self-executing script, not a library
 * module) so it can be unit-tested without also running the whole catalog-build pipeline. */
export function withKeywordOverrides(
  slug: string,
  keywords: string[],
): string[] {
  return [...new Set([...keywords, ...(KEYWORD_OVERRIDES[slug] ?? [])])];
}
