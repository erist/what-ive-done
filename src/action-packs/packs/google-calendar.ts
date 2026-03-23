import type { ActionPackDefinition } from "../types.js";

export const googleCalendarActionPack: ActionPackDefinition = {
  id: "google-calendar",
  version: 1,
  priority: 87,
  rules: [
    {
      id: "open-calendar",
      layer: "domain_pack",
      domainPackIds: ["google-calendar"],
      routeFamilies: ["google-calendar.schedule.view"],
      eventTypes: ["page_navigation", "application_switch"],
      actionName: "open_calendar",
      confidence: 0.93,
    },
    {
      id: "open-calendar-event",
      layer: "domain_pack",
      domainPackIds: ["google-calendar"],
      routeFamilies: ["google-calendar.event.edit"],
      eventTypes: ["page_navigation", "application_switch"],
      actionName: "open_calendar_event",
      confidence: 0.94,
    },
    {
      id: "schedule-calendar-event",
      layer: "domain_pack",
      domainPackIds: ["google-calendar"],
      routeFamilies: ["google-calendar.event.edit"],
      targetIncludes: ["create_event", "quick_add", "save_event", "schedule_event"],
      requireExplicitTarget: true,
      actionName: "schedule_calendar_event",
      confidence: 0.96,
    },
    {
      id: "update-calendar-event",
      layer: "domain_pack",
      domainPackIds: ["google-calendar"],
      routeFamilies: ["google-calendar.event.edit"],
      targetIncludes: ["add_guest", "change_time", "edit_event", "update_event"],
      requireExplicitTarget: true,
      actionName: "update_calendar_event",
      confidence: 0.94,
    },
  ],
};
