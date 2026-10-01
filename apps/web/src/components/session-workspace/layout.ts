import type { ThreadRouteTarget } from "../../threadRoutes";

export const MAX_GROUPS = 5;
export const MAX_TABS = 12;
export type Placement = "center" | "left" | "right" | "top" | "bottom";
export type SessionTab = { id: string; target: ThreadRouteTarget };
export type Group = { kind: "group"; id: string; tabs: string[]; selected: string | null };
export type Split = {
  kind: "split";
  id: string;
  axis: "horizontal" | "vertical";
  ratio: number;
  first: Layout;
  second: Layout;
};
export type Layout = Group | Split;
export type Workspace = {
  root: Layout;
  tabs: SessionTab[];
  focused: string;
  maximized: string | null;
};
export type Rect = { x: number; y: number; width: number; height: number };

export function sameTarget(a: ThreadRouteTarget, b: ThreadRouteTarget): boolean {
  return a.kind === "draft"
    ? b.kind === "draft" && a.draftId === b.draftId
    : b.kind === "server" &&
        a.threadRef.environmentId === b.threadRef.environmentId &&
        a.threadRef.threadId === b.threadRef.threadId;
}

export function groups(root: Layout): Group[] {
  return root.kind === "group" ? [root] : [...groups(root.first), ...groups(root.second)];
}

export function mapLayout(root: Layout, id: string, update: (node: Layout) => Layout): Layout {
  if (root.id === id) return update(root);
  return root.kind === "group"
    ? root
    : {
        ...root,
        first: mapLayout(root.first, id, update),
        second: mapLayout(root.second, id, update),
      };
}

function prune(root: Layout): Layout | null {
  if (root.kind === "group") return root.tabs.length ? root : null;
  const first = prune(root.first);
  const second = prune(root.second);
  return first && second ? { ...root, first, second } : (first ?? second);
}

export function createWorkspace(target: ThreadRouteTarget): Workspace {
  return {
    root: { kind: "group", id: "initial", tabs: ["initial-tab"], selected: "initial-tab" },
    tabs: [{ id: "initial-tab", target }],
    focused: "initial",
    maximized: null,
  };
}

export function focusTab(state: Workspace, tabId: string): Workspace {
  const group = groups(state.root).find((g) => g.tabs.includes(tabId));
  if (!group) return state;
  return {
    ...state,
    focused: group.id,
    maximized: state.maximized ? group.id : null,
    root: mapLayout(state.root, group.id, () => ({ ...group, selected: tabId })),
  };
}

export function selectedTab(state: Workspace): SessionTab | undefined {
  const group = groups(state.root).find((g) => g.id === state.focused);
  return state.tabs.find((tab) => tab.id === group?.selected);
}

export function closeTab(state: Workspace, tabId: string): Workspace {
  const owner = groups(state.root).find((g) => g.tabs.includes(tabId));
  if (!owner) return state;
  const tabs = owner.tabs.filter((id) => id !== tabId);
  const selected = owner.selected === tabId ? (tabs.at(-1) ?? null) : owner.selected;
  const updated = mapLayout(state.root, owner.id, () => ({ ...owner, tabs, selected }));
  const root = prune(updated) ?? { kind: "group", id: owner.id, tabs: [], selected: null };
  const remaining = groups(root);
  const focused = remaining.some((g) => g.id === state.focused) ? state.focused : remaining[0]!.id;
  return {
    ...state,
    root,
    tabs: state.tabs.filter((tab) => tab.id !== tabId),
    focused,
    maximized: state.maximized ? focused : null,
  };
}

/** Move an existing tab, or open a new target, without duplicating its chat instance. */
export function placeTarget(
  state: Workspace,
  target: ThreadRouteTarget,
  groupId: string,
  placement: Placement,
  id: string,
): Workspace {
  const destination = groups(state.root).find((g) => g.id === groupId);
  if (!destination) return state;
  const existing = state.tabs.find((tab) => sameTarget(tab.target, target));
  if (!existing && state.tabs.length >= MAX_TABS) return state;
  if (existing && destination.tabs.includes(existing.id)) {
    if (placement === "center" || destination.tabs.length === 1)
      return focusTab(state, existing.id);
  }
  const source = existing
    ? groups(state.root).find((g) => g.tabs.includes(existing.id))
    : undefined;
  const createsGroup = placement !== "center" && destination.tabs.length > 0;
  const removesGroup = source && source.id !== groupId && source.tabs.length === 1;
  if (createsGroup && groups(state.root).length - (removesGroup ? 1 : 0) >= MAX_GROUPS)
    return state;
  const tab = existing ?? { id, target };
  // Insert first so pruning a moved tab's now-empty group cannot remove the destination.
  const newGroup: Group = { kind: "group", id: `group-${id}`, tabs: [tab.id], selected: tab.id };
  let root = mapLayout(state.root, groupId, () => {
    if (!createsGroup) {
      return {
        ...destination,
        tabs: [...destination.tabs.filter((t) => t !== tab.id), tab.id],
        selected: tab.id,
      };
    }
    const before = placement === "left" || placement === "top";
    return {
      kind: "split",
      id: `split-${id}`,
      axis: placement === "left" || placement === "right" ? "horizontal" : "vertical",
      ratio: 0.5,
      first: before ? newGroup : destination,
      second: before ? destination : newGroup,
    };
  });
  const focused = createsGroup ? newGroup.id : groupId;
  if (source && source.id !== focused) {
    root = mapLayout(root, source.id, (node) => {
      if (node.kind !== "group") return node;
      const tabs = node.tabs.filter((t) => t !== tab.id);
      return {
        ...node,
        tabs,
        selected: node.selected === tab.id ? (tabs.at(-1) ?? null) : node.selected,
      };
    });
  }
  return {
    ...state,
    root: prune(root) ?? root,
    tabs: existing ? state.tabs : [...state.tabs, tab],
    focused,
    maximized: null,
  };
}

export function resizeSplit(state: Workspace, id: string, ratio: number): Workspace {
  if (!Number.isFinite(ratio)) return state;
  return {
    ...state,
    root: mapLayout(state.root, id, (node) =>
      node.kind === "split" ? { ...node, ratio: Math.max(0.15, Math.min(0.85, ratio)) } : node,
    ),
  };
}

export function layoutRects(
  root: Layout,
  rect: Rect,
): {
  groups: { group: Group; rect: Rect }[];
  dividers: { split: Split; rect: Rect; bounds: Rect }[];
} {
  if (root.kind === "group") return { groups: [{ group: root, rect }], dividers: [] };
  const horizontal = root.axis === "horizontal";
  const size = horizontal ? rect.width : rect.height;
  const firstSize = (size - 6) * root.ratio;
  const secondSize = size - 6 - firstSize;
  const first = layoutRects(root.first, {
    ...rect,
    ...(horizontal ? { width: firstSize } : { height: firstSize }),
  });
  const second = layoutRects(root.second, {
    ...rect,
    ...(horizontal
      ? { x: rect.x + firstSize + 6, width: secondSize }
      : { y: rect.y + firstSize + 6, height: secondSize }),
  });
  const divider = {
    ...rect,
    ...(horizontal ? { x: rect.x + firstSize, width: 6 } : { y: rect.y + firstSize, height: 6 }),
  };
  return {
    groups: [...first.groups, ...second.groups],
    dividers: [{ split: root, rect: divider, bounds: rect }, ...first.dividers, ...second.dividers],
  };
}

export function dropPlacement(x: number, y: number, width: number, height: number): Placement {
  const edges = [
    { side: "left", distance: x / width },
    { side: "right", distance: 1 - x / width },
    { side: "top", distance: y / height },
    { side: "bottom", distance: 1 - y / height },
  ] as const;
  const edge = [...edges].sort((a, b) => a.distance - b.distance)[0]!;
  return edge.distance < 0.25 ? edge.side : "center";
}

/** Bound depth and validate every reference before accepting browser-local layout data. */
export function restoreWorkspace(value: unknown): Workspace | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<Workspace>;
  if (!Array.isArray(data.tabs) || data.tabs.length > MAX_TABS) return null;
  const ids = new Set<string>();
  const targets: ThreadRouteTarget[] = [];
  for (const tab of data.tabs) {
    if (!tab || typeof tab.id !== "string" || !tab.id || ids.has(tab.id)) return null;
    const t = tab.target;
    if (!t || (t.kind !== "draft" && t.kind !== "server")) return null;
    if (
      t.kind === "draft"
        ? typeof t.draftId !== "string" || !t.draftId
        : !t.threadRef ||
          typeof t.threadRef.environmentId !== "string" ||
          !t.threadRef.environmentId ||
          typeof t.threadRef.threadId !== "string" ||
          !t.threadRef.threadId
    )
      return null;
    if (targets.some((target) => sameTarget(target, t))) return null;
    ids.add(tab.id);
    targets.push(t);
  }
  const nodes = new Set<string>();
  const used = new Set<string>();
  let count = 0;
  function valid(node: Layout | undefined, depth: number): boolean {
    if (
      !node ||
      depth > MAX_GROUPS ||
      typeof node.id !== "string" ||
      !node.id ||
      nodes.has(node.id)
    )
      return false;
    nodes.add(node.id);
    if (node.kind === "split")
      return (
        Number.isFinite(node.ratio) &&
        node.ratio >= 0.15 &&
        node.ratio <= 0.85 &&
        (node.axis === "horizontal" || node.axis === "vertical") &&
        valid(node.first, depth + 1) &&
        valid(node.second, depth + 1)
      );
    if (node.kind !== "group" || ++count > MAX_GROUPS || !Array.isArray(node.tabs)) return false;
    for (const id of node.tabs) {
      if (!ids.has(id) || used.has(id)) return false;
      used.add(id);
    }
    return node.tabs.length ? node.tabs.includes(node.selected!) : node.selected === null;
  }
  if (
    !valid(data.root, 0) ||
    used.size !== ids.size ||
    !groups(data.root!).some((g) => g.id === data.focused)
  )
    return null;
  if (data.maximized !== null && !groups(data.root!).some((g) => g.id === data.maximized))
    return null;
  return { root: data.root!, tabs: data.tabs, focused: data.focused!, maximized: data.maximized! };
}
