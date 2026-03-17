import type { DomainPackContext, DomainPackDefinition, DomainPackMatch } from "../types.js";

function matchRoute(
  context: DomainPackContext,
  routeTemplate: RegExp,
  routeFamily: string,
  pageType: string,
  resourceHint: string,
  matchSource: DomainPackMatch["matchSource"] = "route_template",
): DomainPackMatch | undefined {
  const candidate = context.routeTaxonomy?.routeTemplate ?? context.routeTemplate;

  if (!candidate || !routeTemplate.test(candidate)) {
    return undefined;
  }

  return {
    routeFamily,
    pageType,
    resourceHint,
    matchSource,
  };
}

export const makestarAdminPack: DomainPackDefinition = {
  id: "makestar-admin",
  version: 1,
  domainTokens: ["admin.example.com", "makestar-admin", "makestar"],
  match(context) {
    return (
      matchRoute(
        context,
        /^\/orders$/,
        "makestar-admin.orders.list",
        "orders_report",
        "order",
      ) ??
      matchRoute(
        context,
        /^\/orders\/\{(?:id|uuid)\}(?:\/view)?$/,
        "makestar-admin.orders.detail",
        "order_detail",
        "order",
      ) ??
      matchRoute(
        context,
        /^\/products?\/\{(?:id|uuid)\}\/edit$/,
        "makestar-admin.products.edit",
        "product_edit",
        "product",
      ) ??
      matchRoute(
        context,
        /^\/refunds?(?:\/\{(?:id|uuid)\})?(?:\/edit)?$/,
        "makestar-admin.refunds.review",
        "refund_review",
        "refund",
      )
    );
  },
};
