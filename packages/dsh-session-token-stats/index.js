/**
 * Host half of the session token statistics bundle.
 *
 * The Host half is intentionally empty: the pill is a pure Client consumer of
 * the `tokenUsage` session projection, which `@deepseek-ai/dsh-token-meter`
 * already registers in every base-backed profile. Mounting this row is what
 * puts the Client half on the browser module graph, so no Host service, event
 * listener or session event is added here.
 */

/** Mount the row without contributing any Host-side behavior. */
export function apply() {}
