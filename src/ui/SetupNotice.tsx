import { BAR } from "./edges.ts";
import { colors } from "./theme.ts";

/**
 * When no T3 Code setup is detected, the conversation says what t3tui is instead of a bare
 * "couldn't connect": t3tui is a companion app, so T3 Code — and its agent ACPs — come first.
 */
export function SetupNotice() {
  return (
    <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
      <box flexDirection="column" border={["left"]} customBorderChars={BAR} borderColor={colors.accent} paddingLeft={2} paddingRight={1}>
        <text fg={colors.text}>
          <strong>t3tui is a companion app to T3 Code</strong>
        </text>
        <text fg={colors.muted} wrapMode="word">No T3 Code setup was detected on this machine, so there is no server to connect to yet.</text>
        <text fg={colors.muted} wrapMode="word">Set up T3 Code first — install the desktop app or the <strong>t3</strong> CLI and open it once so its server is set up and running — then start t3tui again.</text>
        <text fg={colors.muted} wrapMode="word">Attach agent ACPs (providers) in the official T3 Code application; t3tui connects to that server and works from there.</text>
      </box>
    </box>
  );
}
