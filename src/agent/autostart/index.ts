import {
  getMacOSLaunchAgentStatus,
  installMacOSLaunchAgent,
  uninstallMacOSLaunchAgent,
  type MacOSLaunchAgentStatus,
} from "./macos.js";

export interface AgentAutostartStatus extends MacOSLaunchAgentStatus {
  platform: NodeJS.Platform;
}

export function getAgentAutostartStatus(options: {
  dataDir?: string | undefined;
  plistPath?: string | undefined;
} = {}): AgentAutostartStatus {
  if (process.platform === "darwin") {
    return {
      ...getMacOSLaunchAgentStatus(options),
      platform: process.platform,
    };
  }

  return {
    supported: false,
    installed: false,
    loaded: false,
    label: "com.whativedone.agent",
    plistPath: options.plistPath ?? "",
    cliEntrypointPath: "",
    stdoutPath: "",
    stderrPath: "",
    platform: process.platform,
  };
}

export function installAgentAutostart(options: {
  dataDir?: string | undefined;
  plistPath?: string | undefined;
  load?: boolean | undefined;
} = {}): AgentAutostartStatus {
  if (process.platform !== "darwin") {
    return getAgentAutostartStatus(options);
  }

  return {
    ...installMacOSLaunchAgent(options),
    platform: process.platform,
  };
}

export function uninstallAgentAutostart(options: {
  dataDir?: string | undefined;
  plistPath?: string | undefined;
  unload?: boolean | undefined;
} = {}): AgentAutostartStatus {
  if (process.platform !== "darwin") {
    return getAgentAutostartStatus(options);
  }

  return {
    ...uninstallMacOSLaunchAgent(options),
    platform: process.platform,
  };
}
