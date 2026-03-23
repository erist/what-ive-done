import type { DomainPackContext, DomainPackDefinition } from "../types.js";

const MAILBOX_SECTIONS = new Set([
  "all",
  "drafts",
  "important",
  "inbox",
  "sent",
  "spam",
  "starred",
  "trash",
]);

export const googleMailPack: DomainPackDefinition = {
  id: "google-mail",
  version: 1,
  domainTokens: ["mail.google.com"],
  match(context) {
    const routeTemplate = context.routeTaxonomy?.routeTemplate ?? context.routeTemplate;
    const primarySection = context.routeTaxonomy?.primarySection;
    const dynamicSegmentCount = context.routeTaxonomy?.dynamicSegmentCount ?? 0;

    if (!routeTemplate || !primarySection) {
      return undefined;
    }

    if (primarySection === "compose" || routeTemplate === "/compose") {
      return {
        routeFamily: "google-mail.compose",
        pageType: "mail_compose",
        resourceHint: "email",
        matchSource: "route_taxonomy",
      };
    }

    if (primarySection === "search" && /^\/search(?:\/\{id\})?$/.test(routeTemplate)) {
      return {
        routeFamily: "google-mail.search.results",
        pageType: "mail_search",
        resourceHint: "email",
        matchSource: "route_taxonomy",
      };
    }

    if (
      (MAILBOX_SECTIONS.has(primarySection) || primarySection === "label") &&
      dynamicSegmentCount >= 1
    ) {
      return {
        routeFamily: "google-mail.thread.detail",
        pageType: "email_thread",
        resourceHint: "email",
        matchSource: "route_taxonomy",
      };
    }

    if (MAILBOX_SECTIONS.has(primarySection) || primarySection === "label") {
      return {
        routeFamily: "google-mail.mailbox.list",
        pageType: "mailbox_list",
        resourceHint: "email",
        matchSource: "route_taxonomy",
      };
    }

    return undefined;
  },
};
