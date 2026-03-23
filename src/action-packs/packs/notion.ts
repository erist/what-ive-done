import type { ActionPackDefinition } from "../types.js";

export const notionActionPack: ActionPackDefinition = {
  id: "notion",
  version: 1,
  priority: 86,
  rules: [
    {
      id: "open-notion-workspace",
      layer: "domain_pack",
      domainPackIds: ["notion"],
      routeFamilies: ["notion.workspace.home"],
      eventTypes: ["page_navigation", "application_switch"],
      actionName: "open_notion_workspace",
      confidence: 0.92,
    },
    {
      id: "open-notion-page",
      layer: "domain_pack",
      domainPackIds: ["notion"],
      routeFamilies: ["notion.page.view"],
      eventTypes: ["page_navigation", "application_switch"],
      actionName: "open_notion_page",
      confidence: 0.94,
    },
    {
      id: "search-notion-workspace",
      layer: "domain_pack",
      domainPackIds: ["notion"],
      targetIncludes: ["open_search", "quick_find", "search"],
      requireExplicitTarget: true,
      actionName: "search_notion_workspace",
      confidence: 0.95,
    },
    {
      id: "edit-notion-page",
      layer: "domain_pack",
      domainPackIds: ["notion"],
      routeFamilies: ["notion.page.view"],
      targetIncludes: ["comment_page", "edit_block", "new_block", "save_page", "toggle_todo", "update_page"],
      requireExplicitTarget: true,
      actionName: "edit_notion_page",
      confidence: 0.95,
    },
  ],
};
