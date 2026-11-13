/**
 * Build-time feature flag for the console v2 surface (S10b-v2-1). Off is the
 * default: /agent keeps rendering the pre-v2 console byte-identically. Only
 * an explicitly VITE_AGENT_CONSOLE_V2=1 build activates the v2 shell.
 */
export function agentConsoleV2Enabled(): boolean {
  return import.meta.env.VITE_AGENT_CONSOLE_V2 === '1';
}
