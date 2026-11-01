/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { AgFormatShapeParams } from "ag-studio";
import {
  ENTOLE_MENU,
  entoleFormatShape,
  initialReport,
  ordersGridWidget,
  priceChartWidget,
} from "../src/features/dashboard/studio";

describe("Entole's custom Studio widgets", () => {
  // Studio lists only menu widgets in the Widgets tab and the agents' catalogue, and its agents
  // need a format shape and an AI description before they can add or configure a widget.
  test.each([ordersGridWidget, priceChartWidget])("$id is in the menu and agent-ready", (def) => {
    expect(ENTOLE_MENU.widgetIds).toContain(def.id);
    expect(typeof def.formatShape).toBe("function");
    expect(def.ai.description).not.toBe("");
    expect(def.ai.usage).not.toBe("");
    expect(def.icon).toStartWith("<svg");
  });

  // ag-studio's shape builder only exists inside a running Studio, so a stub builder records the
  // declared tree. Studio drops undeclared format fields, so these must all be declared.
  test("the format shape declares every field the default form writes", () => {
    type Node = { fields?: Record<string, Node>; optional: () => Node };
    const leaf = (): Node => ({
      optional() {
        return this;
      },
    });
    const builder = new Proxy(
      { object: (fields: Record<string, Node>): Node => ({ ...leaf(), fields }) },
      { get: (t, k) => (k === "object" ? t.object : leaf) },
    );
    const api = {
      defineAiCommand: (f: (s: unknown) => { input: Node }) => ({ shape: f(builder).input }),
    };
    const root = entoleFormatShape({ api } as unknown as AgFormatShapeParams) as unknown as Node;
    const at = (...path: string[]) => path.reduce<Node | undefined>((n, k) => n?.fields?.[k], root);

    expect(at("title", "typography", "fontWeight")).toBeDefined();
    expect(at("subtitle", "wrapping")).toBeDefined();
    expect(at("caption", "text")).toBeDefined();
    expect(at("crossFilter")).toBeDefined();
    expect(at("style")).toBeUndefined();
  });

  test("the opening report still places both widgets", () => {
    const types = Object.values(initialReport.pages[0]?.widgets ?? {}).map((w) => w?.type);
    expect(types).toContain("orders-grid");
    expect(types).toContain("price-chart");
  });
});
