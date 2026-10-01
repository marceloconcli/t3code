import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DraftId } from "../../composerDraftStore";
import type { ThreadRouteTarget } from "../../threadRoutes";
import { currentWorkspaceTarget, tabOwnsInput, useSessionWorkspace } from "./store";

const target = (id: string): ThreadRouteTarget => ({
  kind: "server",
  threadRef: { environmentId: EnvironmentId.make("test"), threadId: ThreadId.make(id) },
});

beforeEach(() => {
  vi.stubGlobal("localStorage", { setItem: vi.fn(), getItem: () => null });
  useSessionWorkspace.setState({
    available: true,
    enabled: false,
    board: null,
    notice: null,
    dragTarget: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("workspace session ownership", () => {
  it("requires explicit opt-in and disables an active layout without discarding it", () => {
    const store = useSessionWorkspace.getState();
    store.setAvailable(false);
    store.enable(target("one"));
    expect(useSessionWorkspace.getState().enabled).toBe(false);
    expect(useSessionWorkspace.getState().board).toBeNull();
    store.setAvailable(true);
    store.enable(target("one"));
    const board = useSessionWorkspace.getState().board;
    store.setAvailable(false);
    expect(useSessionWorkspace.getState().enabled).toBe(false);
    expect(useSessionWorkspace.getState().board).toBe(board);
    expect(tabOwnsInput("initial-tab")).toBe(false);
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "t3code:session-workspace:available",
      "false",
    );
  });

  it("transfers input ownership synchronously and relinquishes it in single view", () => {
    const store = useSessionWorkspace.getState();
    store.enable(target("one"));
    store.place(target("two"), "initial", "right");
    const tabs = useSessionWorkspace.getState().board!.tabs;
    expect(tabOwnsInput(tabs[0]!.id)).toBe(false);
    expect(tabOwnsInput(tabs[1]!.id)).toBe(true);
    store.focus(tabs[0]!.id);
    expect(tabOwnsInput(tabs[0]!.id)).toBe(true);
    expect(tabOwnsInput(tabs[1]!.id)).toBe(false);
    store.disable();
    expect(tabOwnsInput(tabs[0]!.id)).toBe(false);
  });

  it("promotes a draft without replacing its tab identity after route adoption", () => {
    const store = useSessionWorkspace.getState();
    store.enable({ kind: "draft", draftId: DraftId.make("draft") });
    store.adopt(target("created"));
    store.promote("initial-tab", target("created"));
    expect(useSessionWorkspace.getState().board!.tabs).toEqual([
      { id: "initial-tab", target: target("created") },
    ]);
    expect(currentWorkspaceTarget()).toEqual(target("created"));
  });

  it("preserves open sessions when browser storage fails", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("quota");
      },
    });
    useSessionWorkspace.getState().enable(target("one"));
    expect(currentWorkspaceTarget()).toEqual(target("one"));
    expect(useSessionWorkspace.getState().notice).toContain("could not be saved");
  });

  it("keeps the promoted draft focused when its routed duplicate was in another group", () => {
    const store = useSessionWorkspace.getState();
    store.enable({ kind: "draft", draftId: DraftId.make("draft") });
    store.place(target("other"), "initial", "right");
    store.adopt(target("created"));
    store.promote("initial-tab", target("created"));
    expect(currentWorkspaceTarget()).toEqual(target("created"));
    expect(tabOwnsInput("initial-tab")).toBe(true);
    expect(useSessionWorkspace.getState().board!.tabs).toHaveLength(2);
  });

  it("ignores a late promotion from a closed draft without removing the routed thread", () => {
    const store = useSessionWorkspace.getState();
    store.enable({ kind: "draft", draftId: DraftId.make("draft") });
    store.adopt(target("created"));
    store.close("initial-tab");
    const board = useSessionWorkspace.getState().board;
    store.promote("initial-tab", target("created"));
    expect(useSessionWorkspace.getState().board).toBe(board);
    expect(currentWorkspaceTarget()).toEqual(target("created"));
  });

  it("returns to single view when the last tab closes", () => {
    const store = useSessionWorkspace.getState();
    store.enable(target("one"));
    store.close("initial-tab");
    expect(useSessionWorkspace.getState().enabled).toBe(false);
    expect(useSessionWorkspace.getState().board!.tabs).toEqual([]);
    store.enable(target("one"));
    expect(currentWorkspaceTarget()).toEqual(target("one"));
  });

  it("routes a new session outside a full board without replacing any tab", () => {
    const store = useSessionWorkspace.getState();
    store.enable(target("one"));
    for (let i = 2; i <= 12; i++) store.adopt(target(String(i)));
    const before = useSessionWorkspace.getState().board;
    store.adopt(target("overflow"));
    expect(useSessionWorkspace.getState().enabled).toBe(false);
    expect(useSessionWorkspace.getState().board).toBe(before);
    expect(useSessionWorkspace.getState().notice).toContain("full");
  });
});
