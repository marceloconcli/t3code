import { describe, expect, it } from "vite-plus/test";
import type { ThreadRouteTarget } from "../../threadRoutes";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  closeTab,
  createWorkspace,
  dropPlacement,
  focusTab,
  groups,
  layoutRects,
  placeTarget,
  resizeSplit,
  restoreWorkspace,
  sameTarget,
  selectedTab,
} from "./layout";

const target = (id: string, environment = "local"): ThreadRouteTarget => ({
  kind: "server",
  threadRef: { environmentId: EnvironmentId.make(environment), threadId: ThreadId.make(id) },
});

describe("split-session workspace", () => {
  it("opens five independent sessions in nested groups without changing their identities", () => {
    let board = createWorkspace(target("one"));
    for (let i = 2; i <= 5; i++)
      board = placeTarget(
        board,
        target(String(i)),
        board.focused,
        i % 2 ? "bottom" : "right",
        String(i),
      );
    expect(groups(board.root)).toHaveLength(5);
    expect(board.tabs).toHaveLength(5);
    expect(board.tabs[0]?.id).toBe("initial-tab");
    expect(placeTarget(board, target("six"), board.focused, "right", "six")).toBe(board);
    expect(restoreWorkspace(JSON.parse(JSON.stringify(board)))).toEqual(board);
  });
  it("moves a chat between groups and collapses its empty source", () => {
    let b = createWorkspace(target("one"));
    b = placeTarget(b, target("two"), "initial", "right", "two");
    b = placeTarget(b, target("one"), "group-two", "center", "move");
    expect(groups(b.root)).toHaveLength(1);
    expect(groups(b.root)[0]?.tabs).toEqual(["two", "initial-tab"]);
    expect(b.tabs).toHaveLength(2);
    expect(selectedTab(b)?.target).toEqual(target("one"));
  });
  it("splits a tab out of a group while preserving another tab's selection", () => {
    let b = createWorkspace(target("one"));
    b = placeTarget(b, target("two"), "initial", "center", "two");
    b = placeTarget(b, target("two"), "initial", "bottom", "move");
    expect(groups(b.root).map((g) => g.tabs)).toEqual([["initial-tab"], ["two"]]);
    expect(groups(b.root)[0]?.selected).toBe("initial-tab");
  });
  it("does not duplicate a session when dropped onto itself", () => {
    const b = createWorkspace(target("one"));
    for (const placement of ["center", "left", "bottom"] as const) {
      const next = placeTarget(b, target("one"), "initial", placement, "duplicate");
      expect(next.tabs).toHaveLength(1);
      expect(groups(next.root)).toHaveLength(1);
    }
  });
  it("focuses the surviving session after closing the active group", () => {
    const b = placeTarget(createWorkspace(target("one")), target("two"), "initial", "right", "two");
    const next = closeTab(b, "two");
    expect(selectedTab(next)?.target).toEqual(target("one"));
    expect(groups(next.root)).toHaveLength(1);
    expect(closeTab(next, "initial-tab").tabs).toEqual([]);
  });
  it("preserves all sessions when changing focus or maximizing", () => {
    const b = placeTarget(createWorkspace(target("one")), target("two"), "initial", "right", "two");
    const next = focusTab({ ...b, maximized: b.focused }, "initial-tab");
    expect(next.tabs).toEqual(b.tabs);
    expect(next.maximized).toBe("initial");
  });
  it("distinguishes thread identities across environments including delimiters", () => {
    expect(sameTarget(target("c", "a:b"), target("b:c", "a"))).toBe(false);
    let b = createWorkspace(target("same", "first"));
    b = placeTarget(b, target("same", "second"), "initial", "right", "two");
    expect(b.tabs).toHaveLength(2);
  });
  it("rejects corrupt, duplicated, deep or dangling persisted layouts", () => {
    const b = createWorkspace(target("one"));
    expect(restoreWorkspace(null)).toBeNull();
    expect(restoreWorkspace({ ...b, tabs: [b.tabs[0], b.tabs[0]] })).toBeNull();
    expect(
      restoreWorkspace({
        ...b,
        root: { kind: "group", id: "initial", tabs: ["missing"], selected: "missing" },
      }),
    ).toBeNull();
    expect(restoreWorkspace({ ...b, focused: "missing" })).toBeNull();
    const split = placeTarget(b, target("two"), "initial", "right", "two");
    expect(restoreWorkspace({ ...split, root: { ...split.root, ratio: NaN } })).toBeNull();
  });
  it("limits tabs without replacing unsent work", () => {
    let b = createWorkspace(target("one"));
    for (let i = 2; i <= 12; i++)
      b = placeTarget(b, target(String(i)), "initial", "center", String(i));
    expect(b.tabs).toHaveLength(12);
    expect(placeTarget(b, target("overflow"), "initial", "center", "overflow")).toBe(b);
  });
  it("allows moving an entire group at the group limit", () => {
    let b = createWorkspace(target("one"));
    for (let i = 2; i <= 5; i++)
      b = placeTarget(b, target(String(i)), b.focused, "right", String(i));
    const next = placeTarget(b, target("one"), b.focused, "bottom", "move");
    expect(groups(next.root)).toHaveLength(5);
    expect(next.tabs).toEqual(b.tabs);
  });
  it("lays out nested splits without overlap and clamps resize", () => {
    let b = placeTarget(createWorkspace(target("one")), target("two"), "initial", "right", "two");
    b = resizeSplit(b, "split-two", 10);
    const boxes = layoutRects(b.root, { x: 0, y: 0, width: 1006, height: 600 });
    expect(boxes.groups[0]?.rect.width).toBe(850);
    expect(boxes.groups[1]?.rect.x).toBe(856);
    expect(boxes.groups[1]?.rect.width).toBe(150);
    expect(resizeSplit(b, "split-two", NaN)).toBe(b);
  });
  it("uses edge drops for splits and center drops for tabs", () => {
    expect(dropPlacement(10, 200, 600, 400)).toBe("left");
    expect(dropPlacement(590, 200, 600, 400)).toBe("right");
    expect(dropPlacement(300, 10, 600, 400)).toBe("top");
    expect(dropPlacement(300, 390, 600, 400)).toBe("bottom");
    expect(dropPlacement(300, 200, 600, 400)).toBe("center");
  });
});
