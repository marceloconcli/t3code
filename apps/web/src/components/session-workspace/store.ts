import { randomUUID } from "../../lib/utils";
import { create } from "zustand";
import type { ThreadRouteTarget } from "../../threadRoutes";
import {
  closeTab,
  createWorkspace,
  focusTab,
  placeTarget,
  resizeSplit,
  restoreWorkspace,
  sameTarget,
  selectedTab,
  type Placement,
  type Workspace,
} from "./layout";

const AVAILABILITY_KEY = "t3code:session-workspace:available";
function loadAvailability(): boolean {
  try {
    return localStorage.getItem(AVAILABILITY_KEY) === "true";
  } catch {
    return false;
  }
}

const STORAGE_KEY = "t3code:session-workspace:v1";
function load(): Workspace | null {
  try {
    return restoreWorkspace(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return null;
  }
}

export const useSessionWorkspace = create<{
  available: boolean;
  setAvailable: (available: boolean) => void;
  enabled: boolean;
  board: Workspace | null;
  notice: string | null;
  dragTarget: ThreadRouteTarget | null;
  enable: (target: ThreadRouteTarget) => void;
  disable: () => void;
  save: (board: Workspace) => void;
  adopt: (target: ThreadRouteTarget) => void;
  place: (target: ThreadRouteTarget, groupId: string, placement: Placement) => void;
  focus: (tabId: string) => void;
  close: (tabId: string) => void;
  resize: (id: string, ratio: number) => void;
  promote: (tabId: string, target: ThreadRouteTarget) => void;
}>((set, get) => ({
  available: loadAvailability(),
  setAvailable: (available) => {
    set({ available, ...(available ? {} : { enabled: false, dragTarget: null }), notice: null });
    try {
      localStorage.setItem(AVAILABILITY_KEY, String(available));
    } catch {
      set({ notice: "Layout preference could not be saved. This change applies until reload." });
    }
  },
  enabled: false,
  board: load(),
  notice: null,
  dragTarget: null,
  enable: (target) => {
    if (!get().available) return;
    set({ enabled: true });
    get().adopt(target);
  },
  disable: () => set({ enabled: false, dragTarget: null }),
  save: (board) => {
    set({ board, notice: null });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
    } catch {
      set({ notice: "Layout could not be saved. Sessions are still available." });
    }
  },
  adopt: (target) => {
    const board = get().board;
    if (!board) return get().save(createWorkspace(target));
    const existing = board.tabs.find((t) => sameTarget(t.target, target));
    if (existing) return get().save(focusTab(board, existing.id));
    const next = placeTarget(board, target, board.focused, "center", randomUUID());
    if (next === board) {
      set({
        enabled: false,
        notice: "Workspace is full. Close a tab before adding another session.",
      });
      return;
    }
    get().save(next);
  },
  place: (target, groupId, placement) => {
    const board = get().board;
    if (!board) return;
    const next = placeTarget(board, target, groupId, placement, randomUUID());
    if (next === board) {
      set({
        notice:
          "This workspace supports five groups and twelve open sessions. Move a tab to an existing group or close one first.",
      });
      return;
    }
    get().save(next);
  },
  focus: (id) => {
    const b = get().board;
    if (b && selectedTab(b)?.id !== id) get().save(focusTab(b, id));
  },
  close: (id) => {
    const b = get().board;
    if (!b) return;
    const next = closeTab(b, id);
    get().save(next);
    if (next.tabs.length === 0) get().disable();
  },
  resize: (id, ratio) => {
    const b = get().board;
    if (b) get().save(resizeSplit(b, id, ratio));
  },
  promote: (id, target) => {
    const b = get().board;
    if (!b || !b.tabs.some((tab) => tab.id === id)) return;
    // Promotion may have arrived through route adoption before the draft's effect.
    const duplicate = b.tabs.find((t) => t.id !== id && sameTarget(t.target, target));
    const next = duplicate ? closeTab(b, duplicate.id) : b;
    const promoted = {
      ...next,
      tabs: next.tabs.map((tab) => (tab.id === id ? { ...tab, target } : tab)),
    };
    get().save(
      duplicate && selectedTab(b)?.id === duplicate.id ? focusTab(promoted, id) : promoted,
    );
  },
}));

export function tabOwnsInput(tabId: string): boolean {
  const { enabled, board } = useSessionWorkspace.getState();
  return enabled && board !== null && selectedTab(board)?.id === tabId;
}

export function currentWorkspaceTarget(): ThreadRouteTarget | null {
  const board = useSessionWorkspace.getState().board;
  return board ? (selectedTab(board)?.target ?? null) : null;
}
