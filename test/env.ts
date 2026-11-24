/** The env vars tests touch; saved and restored under their real names, never shorthands. */
export const ENV_VARS = ["T3CODE_HOME", "T3TUI_T3_BIN", "T3TUI_SERVER", "T3TUI_TOKEN"] as const;
export type EnvVar = (typeof ENV_VARS)[number];

export function saveEnv(): Record<EnvVar, string | undefined> {
  return Object.fromEntries(ENV_VARS.map((key) => [key, process.env[key]])) as Record<EnvVar, string | undefined>;
}

export function restoreEnv(saved: Record<EnvVar, string | undefined>): void {
  for (const key of ENV_VARS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
