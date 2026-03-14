import type { RawEventInput } from "../domain/types.js";

interface MockWorkflowTemplate {
  key: string;
  startHour: number;
  repetitions: number;
  repeatEveryDays: number;
  steps: Array<{
    offsetSeconds: number;
    sourceEventType: string;
    application: string;
    domain?: string;
    url?: string;
    action: string;
    target?: string;
    metadata?: Record<string, unknown>;
  }>;
}

const WORKFLOWS: MockWorkflowTemplate[] = [
  {
    key: "order-status-lookup",
    startHour: 9,
    repetitions: 3,
    repeatEveryDays: 2,
    steps: [
      {
        offsetSeconds: 0,
        sourceEventType: "chrome.navigation",
        application: "chrome",
        domain: "admin.internal",
        url: "https://admin.internal/orders",
        action: "navigation",
        target: "order_search",
      },
      {
        offsetSeconds: 40,
        sourceEventType: "browser.click",
        application: "chrome",
        domain: "admin.internal",
        action: "click",
        target: "search_order",
      },
      {
        offsetSeconds: 90,
        sourceEventType: "browser.click",
        application: "chrome",
        domain: "admin.internal",
        action: "click",
        target: "view_shipping_status",
      },
      {
        offsetSeconds: 135,
        sourceEventType: "app.switch",
        application: "slack",
        action: "switch",
        target: "send_status_reply",
      },
    ],
  },
  {
    key: "refund-request-review",
    startHour: 10,
    repetitions: 3,
    repeatEveryDays: 2,
    steps: [
      {
        offsetSeconds: 0,
        sourceEventType: "chrome.navigation",
        application: "chrome",
        domain: "support.internal",
        url: "https://support.internal/tickets",
        action: "navigation",
        target: "ticket_queue",
      },
      {
        offsetSeconds: 35,
        sourceEventType: "browser.click",
        application: "chrome",
        domain: "support.internal",
        action: "click",
        target: "open_refund_ticket",
      },
      {
        offsetSeconds: 95,
        sourceEventType: "chrome.navigation",
        application: "chrome",
        domain: "admin.internal",
        url: "https://admin.internal/refunds",
        action: "navigation",
        target: "refund_admin",
      },
      {
        offsetSeconds: 155,
        sourceEventType: "form.submit",
        application: "chrome",
        domain: "admin.internal",
        action: "submit",
        target: "approve_refund",
      },
    ],
  },
  {
    key: "inventory-update",
    startHour: 11,
    repetitions: 3,
    repeatEveryDays: 2,
    steps: [
      {
        offsetSeconds: 0,
        sourceEventType: "file.open",
        application: "excel",
        action: "open",
        target: "inventory_sheet",
      },
      {
        offsetSeconds: 45,
        sourceEventType: "browser.click",
        application: "chrome",
        domain: "warehouse.internal",
        url: "https://warehouse.internal/items",
        action: "click",
        target: "find_item",
      },
      {
        offsetSeconds: 105,
        sourceEventType: "form.submit",
        application: "excel",
        action: "submit",
        target: "update_quantity",
      },
      {
        offsetSeconds: 165,
        sourceEventType: "file.save",
        application: "excel",
        action: "save",
        target: "inventory_sheet",
      },
    ],
  },
  {
    key: "customer-verification",
    startHour: 13,
    repetitions: 3,
    repeatEveryDays: 2,
    steps: [
      {
        offsetSeconds: 0,
        sourceEventType: "chrome.navigation",
        application: "chrome",
        domain: "crm.internal",
        url: "https://crm.internal/customers",
        action: "navigation",
        target: "customer_profile",
      },
      {
        offsetSeconds: 35,
        sourceEventType: "form.submit",
        application: "chrome",
        domain: "crm.internal",
        action: "submit",
        target: "verify_identity",
      },
      {
        offsetSeconds: 95,
        sourceEventType: "app.switch",
        application: "outlook",
        action: "switch",
        target: "email_template",
      },
      {
        offsetSeconds: 150,
        sourceEventType: "browser.click",
        application: "outlook",
        action: "click",
        target: "send_confirmation_email",
      },
    ],
  },
  {
    key: "shipment-reschedule",
    startHour: 15,
    repetitions: 3,
    repeatEveryDays: 2,
    steps: [
      {
        offsetSeconds: 0,
        sourceEventType: "chrome.navigation",
        application: "chrome",
        domain: "logistics.internal",
        url: "https://logistics.internal/shipments",
        action: "navigation",
        target: "shipment_search",
      },
      {
        offsetSeconds: 30,
        sourceEventType: "browser.click",
        application: "chrome",
        domain: "logistics.internal",
        action: "click",
        target: "find_shipment",
      },
      {
        offsetSeconds: 90,
        sourceEventType: "form.submit",
        application: "chrome",
        domain: "logistics.internal",
        action: "submit",
        target: "reschedule_delivery",
      },
      {
        offsetSeconds: 145,
        sourceEventType: "app.switch",
        application: "slack",
        action: "switch",
        target: "notify_customer_team",
      },
    ],
  },
];

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export function generateMockRawEvents(referenceDate = new Date()): RawEventInput[] {
  const startOfReferenceDay = new Date(referenceDate);
  startOfReferenceDay.setHours(0, 0, 0, 0);

  return WORKFLOWS.flatMap((workflow) =>
    Array.from({ length: workflow.repetitions }, (_, repetitionIndex) => {
      const sessionBase = new Date(startOfReferenceDay);
      sessionBase.setDate(startOfReferenceDay.getDate() - repetitionIndex * workflow.repeatEveryDays);
      sessionBase.setHours(workflow.startHour, 0, 0, 0);

      return workflow.steps.map((step, stepIndex) => ({
        source: "mock" as const,
        sourceEventType: step.sourceEventType,
        timestamp: addSeconds(sessionBase, step.offsetSeconds).toISOString(),
        application: step.application,
        domain: step.domain,
        url: step.url,
        action: step.action,
        target: step.target,
        metadata: {
          workflowKey: workflow.key,
          repetitionIndex: repetitionIndex + 1,
          stepIndex: stepIndex + 1,
          ...step.metadata,
        },
      }));
    }).flat(),
  ).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}
