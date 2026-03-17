import type { ActionPackDefinition } from "../types.js";

export const desktopProductivityActionPack: ActionPackDefinition = {
  id: "desktop-productivity",
  version: 1,
  priority: 30,
  rules: [
    {
      id: "send-email-response",
      layer: "generic",
      applications: ["outlook"],
      targetIncludes: ["send", "confirmation", "email", "email_response"],
      actionName: "send_email_response",
      confidence: 0.91,
    },
    {
      id: "open-sheet",
      layer: "generic",
      applications: ["excel"],
      targetIncludes: ["sheet", "open"],
      actionName: "open_sheet",
      confidence: 0.89,
    },
    {
      id: "save-sheet",
      layer: "generic",
      applications: ["excel"],
      targetIncludes: ["save", "sheet"],
      actionName: "save_sheet",
      confidence: 0.9,
    },
    {
      id: "send-slack-report",
      layer: "generic",
      applications: ["slack"],
      targetIncludes: ["send", "notify", "reply", "report"],
      actionName: "send_slack_report",
      confidence: 0.92,
    },
  ],
};
