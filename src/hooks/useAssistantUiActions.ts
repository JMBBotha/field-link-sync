import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

/** A structured tool result block, as returned by the assistant tools. */
export interface UiActionBlock {
  tool_name: string;
  rows: Record<string, unknown>[];
}

const UI_TOOLS = new Set(["navigate_app", "open_record", "go_back"]);

export function isUiActionBlock(block: UiActionBlock): boolean {
  return UI_TOOLS.has(block.tool_name);
}

/**
 * Applies UI actions the assistant produced (navigate to a page / record, go
 * back). The route always comes from the server tool, never from free text, so
 * the assistant can only move the operator to a real, permitted destination.
 */
export function useAssistantUiActions() {
  const navigate = useNavigate();

  return useCallback((blocks: UiActionBlock[]) => {
    for (const block of blocks) {
      if (!isUiActionBlock(block)) continue;
      for (const row of block.rows ?? []) {
        const action = String((row as { ui_action?: string }).ui_action ?? "");
        if (action === "back") {
          navigate(-1);
          continue;
        }
        const route = (row as { route?: string }).route;
        if (action === "navigate" && typeof route === "string" && route.startsWith("/")) {
          navigate(route);
        }
      }
    }
  }, [navigate]);
}
