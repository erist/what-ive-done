import type { ActionPackDefinition } from "../types.js";

export const googleSheetsActionPack: ActionPackDefinition = {
  id: "google-sheets",
  version: 1,
  priority: 90,
  rules: [
    {
      id: "open-sheet",
      layer: "domain_pack",
      domainPackIds: ["google-sheets"],
      routeFamilies: ["google-sheets.sheet.edit"],
      eventTypes: ["page_navigation", "application_switch"],
      actionName: "open_sheet",
      confidence: 0.95,
    },
    {
      id: "edit-sheet",
      layer: "domain_pack",
      domainPackIds: ["google-sheets"],
      routeFamilies: ["google-sheets.sheet.edit"],
      targetIncludes: ["edit_cell", "formula_bar", "cell_editor", "update_status_column", "save_sheet"],
      actionName: "edit_sheet",
      confidence: 0.94,
    },
    {
      id: "share-sheet",
      layer: "domain_pack",
      domainPackIds: ["google-sheets"],
      routeFamilies: ["google-sheets.sheet.edit"],
      targetIncludes: ["share_sheet", "share"],
      actionName: "share_sheet",
      confidence: 0.93,
    },
  ],
};
