import {
  getMacOSLaunchAgentStatus,
  installMacOSLaunchAgent,
  uninstallMacOSLaunchAgent,
} from "./macos.js";
import {
  getWindowsStartupStatus,
  installWindowsStartupScript,
  uninstallWindowsStartupScript,
} from "./windows.js";

export interface AgentAutostartStatus {
  supported: boolean;
  installed: boolean;
  loaded: boolean;
  label: string;
  configPath: string;
  cliEntrypointPath: string;
  stdoutPath: string;
  stderrPath: string;
  platform: NodeJS.Platform;
  kind: "launch-agent" | "startup-script" | "unsupported";
  plistPath?: string | undefined;
  startupScriptPath?: string | undefined;
}

export function getAgentAutostartStatus(options: {
  dataDir?: string | undefined;
  plistPath?: string | undefined;
  startupScriptPath?: string | undefined;
} = {}): AgentAutostartStatus {
  if (process.platform === "darwin") {
    const status = getMacOSLaunchAgentStatus(options);

    return {
      supported: status.supported,
      installed: status.installed,
      loaded: status.loaded,
      label: status.label,
      configPath: status.plistPath,
      cliEntrypointPath: status.cliEntrypointPath,
      stdoutPath: status.stdoutPath,
      stderrPath: status.stderrPath,
      platform: process.platform,
      kind: "launch-agent",
      plistPath: status.plistPath,
    };
  }

  if (process.platform === "win32") {
    const status = getWindowsStartupStatus({
      dataDir: options.dataDir,
      startupScriptPath: options.startupScriptPath,
    });

    return {
      supported: status.supported,
      installed: status.installed,
      loaded: status.loaded,
      label: status.label,
      configPath: status.startupScriptPath,
      cliEntrypointPath: status.cliEntrypointPath,
      stdoutPath: status.stdoutPath,
      stderrPath: status.stderrPath,
      platform: process.platform,
      kind: "startup-script",
      startupScriptPath: status.startupScriptPath,
    };
  }

  return {
    supported: false,
    installed: false,
    loaded: false,
    label: "com.whativedone.agent",
    configPath: "",
    cliEntrypointPath: "",
    stdoutPath: "",
    stderrPath: "",
    platform: process.platform,
    kind: "unsupported",
  };
}

export function installAgentAutostart(options: {
  dataDir?: string | undefined;
  plistPath?: string | undefined;
  startupScriptPath?: string | undefined;
  load?: boolean | undefined;
} = {}): AgentAutostartStatus {
  if (process.platform === "darwin") {
    const status = installMacOSLaunchAgent(options);

    return {
      supported: status.supported,
      installed: status.installed,
      loaded: status.loaded,
      label: status.label,
      configPath: status.plistPath,
      cliEntrypointPath: status.cliEntrypointPath,
      stdoutPath: status.stdoutPath,
      stderrPath: status.stderrPath,
      platform: process.platform,
      kind: "launch-agent",
      plistPath: status.plistPath,
    };
  }

  if (process.platform === "win32") {
    const status = installWindowsStartupScript({
      dataDir: options.dataDir,
      startupScriptPath: options.startupScriptPath,
    });

    return {
      supported: status.supported,
      installed: status.installed,
      loaded: status.loaded,
      label: status.label,
      configPath: status.startupScriptPath,
      cliEntrypointPath: status.cliEntrypointPath,
      stdoutPath: status.stdoutPath,
      stderrPath: status.stderrPath,
      platform: process.platform,
      kind: "startup-script",
      startupScriptPath: status.startupScriptPath,
    };
  }

  return getAgentAutostartStatus(options);
}

export function uninstallAgentAutostart(options: {
  dataDir?: string | undefined;
  plistPath?: string | undefined;
  startupScriptPath?: string | undefined;
  unload?: boolean | undefined;
} = {}): AgentAutostartStatus {
  if (process.platform === "darwin") {
    const status = uninstallMacOSLaunchAgent(options);

    return {
      supported: status.supported,
      installed: status.installed,
      loaded: status.loaded,
      label: status.label,
      configPath: status.plistPath,
      cliEntrypointPath: status.cliEntrypointPath,
      stdoutPath: status.stdoutPath,
      stderrPath: status.stderrPath,
      platform: process.platform,
      kind: "launch-agent",
      plistPath: status.plistPath,
    };
  }

  if (process.platform === "win32") {
    const status = uninstallWindowsStartupScript({
      dataDir: options.dataDir,
      startupScriptPath: options.startupScriptPath,
    });

    return {
      supported: status.supported,
      installed: status.installed,
      loaded: status.loaded,
      label: status.label,
      configPath: status.startupScriptPath,
      cliEntrypointPath: status.cliEntrypointPath,
      stdoutPath: status.stdoutPath,
      stderrPath: status.stderrPath,
      platform: process.platform,
      kind: "startup-script",
      startupScriptPath: status.startupScriptPath,
    };
  }

  return getAgentAutostartStatus(options);
}
