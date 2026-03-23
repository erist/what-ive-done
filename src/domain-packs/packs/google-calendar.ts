import type { DomainPackContext, DomainPackDefinition } from "../types.js";

const CALENDAR_VIEW_ROUTE = /^\/calendar(?:\/u\/\{id\})?\/r(?:\/(?:agenda|day|month|schedule|week|year)(?:\/\{id\}){0,3})?$/i;
const CALENDAR_EVENT_EDIT_ROUTE = /^\/calendar(?:\/u\/\{id\})?\/r\/eventedit(?:\/\{id\})?$/i;

export const googleCalendarPack: DomainPackDefinition = {
  id: "google-calendar",
  version: 1,
  domainTokens: ["calendar.google.com"],
  match(context) {
    const routeTemplate = context.routeTaxonomy?.routeTemplate ?? context.routeTemplate;

    if (!routeTemplate) {
      return undefined;
    }

    if (CALENDAR_EVENT_EDIT_ROUTE.test(routeTemplate)) {
      return {
        routeFamily: "google-calendar.event.edit",
        pageType: "calendar_event_edit",
        resourceHint: "event",
        matchSource: context.routeTaxonomy?.routeTemplate ? "route_taxonomy" : "route_template",
      };
    }

    if (CALENDAR_VIEW_ROUTE.test(routeTemplate)) {
      return {
        routeFamily: "google-calendar.schedule.view",
        pageType: "calendar_schedule",
        resourceHint: "event",
        matchSource: context.routeTaxonomy?.routeTemplate ? "route_taxonomy" : "route_template",
      };
    }

    return undefined;
  },
};
