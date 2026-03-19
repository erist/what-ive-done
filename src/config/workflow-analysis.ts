import type { AnalyzeOptions } from "../pipeline/analyze.js";
import { ConfigManager } from "./manager.js";

export function resolveConfiguredAnalyzeOptions(
  dataDir?: string,
): Pick<AnalyzeOptions, "confirmationWindowDays" | "minSessionDurationSeconds"> {
  const resolvedDataDir = ConfigManager.resolveDataDir(dataDir);
  const config = ConfigManager.load(resolvedDataDir);

  return {
    confirmationWindowDays: config.analysis.confirmationWindowDays,
    minSessionDurationSeconds: config.analysis.minSessionDurationSeconds,
  };
}
