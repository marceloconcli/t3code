import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Columns2Icon,
  Rows2Icon,
  XIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlusIcon,
  PanelLeftCloseIcon,
} from "lucide-react";
import { useThreadShell, useThreadShells } from "../../state/entities";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  type ThreadRouteTarget,
} from "../../threadRoutes";
import { ThreadRouteView } from "../ThreadRouteView";
import { SidebarInset } from "../ui/sidebar";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogPanel } from "../ui/dialog";
import { Input } from "../ui/input";
import { SessionPaneContext } from "./PaneContext";
import {
  groups,
  layoutRects,
  selectedTab,
  type Placement,
  type Rect,
  type SessionTab,
  type Split,
} from "./layout";
import { currentWorkspaceTarget, tabOwnsInput, useSessionWorkspace } from "./store";
import { finishSessionDrag, startSessionDrag, workspaceDropAt } from "./drag";

const MemoThreadView = memo(ThreadRouteView);
const position = (r: Rect): CSSProperties => ({
  position: "absolute",
  left: r.x,
  top: r.y,
  width: r.width,
  height: r.height,
});

function useTargetNavigation() {
  const navigate = useNavigate();
  return useCallback(
    (target: ThreadRouteTarget | null) => {
      if (!target) return;
      if (target.kind === "draft")
        void navigate({
          to: "/draft/$draftId",
          params: buildDraftThreadRouteParams(target.draftId),
          replace: true,
        });
      else
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(target.threadRef),
          replace: true,
        });
    },
    [navigate],
  );
}

const TabLabel = memo(function TabLabel({ target }: { target: ThreadRouteTarget }) {
  const shell = useThreadShell(target.kind === "server" ? target.threadRef : null);
  return (
    <span className="truncate">
      {target.kind === "draft" ? "New session" : (shell?.title ?? "Loading session…")}
    </span>
  );
});

const SessionPane = memo(function SessionPane({
  tab,
  visible,
  focused,
  rect,
  groupId,
}: {
  groupId: string | undefined;
  tab: SessionTab;
  visible: boolean;
  focused: boolean;
  rect: Rect;
}) {
  const navigate = useTargetNavigation();
  const context = useMemo(
    () => ({
      tabId: tab.id,
      visible,
      focused,
      ownsInput: () => tabOwnsInput(tab.id),
      promote: (target: ThreadRouteTarget) => {
        const wasFocused = tabOwnsInput(tab.id);
        useSessionWorkspace.getState().promote(tab.id, target);
        if (wasFocused) navigate(target);
      },
    }),
    [tab.id, visible, focused, navigate],
  );
  return (
    <div
      style={{ ...position(rect), display: visible ? undefined : "none" }}
      className="flex min-h-0 min-w-0 overflow-hidden"
      inert={!visible}
      data-session-group={groupId}
      onPointerDownCapture={() => {
        if (!tabOwnsInput(tab.id)) {
          useSessionWorkspace.getState().focus(tab.id);
          navigate(tab.target);
        }
      }}
      onFocusCapture={() => {
        if (!tabOwnsInput(tab.id)) {
          useSessionWorkspace.getState().focus(tab.id);
          navigate(tab.target);
        }
      }}
    >
      <SessionPaneContext value={context}>
        <MemoThreadView target={tab.target} />
      </SessionPaneContext>
    </div>
  );
});

function ResizeHandle({ split, rect, bounds }: { split: Split; rect: Rect; bounds: Rect }) {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    pointerId: number;
    start: number;
    ratio: number;
    current: number;
  } | null>(null);
  const horizontal = split.axis === "horizontal";
  return (
    <div
      ref={ref}
      role="separator"
      tabIndex={0}
      aria-label="Resize session groups"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-valuemin={15}
      aria-valuemax={85}
      aria-valuenow={Math.round(split.ratio * 100)}
      style={position(rect)}
      className={`z-20 touch-none bg-border hover:bg-primary focus-visible:bg-primary ${horizontal ? "cursor-col-resize" : "cursor-row-resize"}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = {
          pointerId: event.pointerId,
          start: horizontal ? event.clientX : event.clientY,
          ratio: split.ratio,
          current: split.ratio,
        };
      }}
      onPointerMove={(event) => {
        const g = gesture.current;
        if (!g || event.pointerId !== g.pointerId) return;
        g.current = Math.max(
          0.15,
          Math.min(
            0.85,
            g.ratio +
              ((horizontal ? event.clientX : event.clientY) - g.start) /
                ((horizontal ? bounds.width : bounds.height) - 6),
          ),
        );
        // Move only the divider while dragging; commit the expensive chat reflow on release.
        const delta = (g.current - g.ratio) * ((horizontal ? bounds.width : bounds.height) - 6);
        event.currentTarget.style.transform = horizontal
          ? `translateX(${delta}px)`
          : `translateY(${delta}px)`;
      }}
      onPointerUp={(event) => {
        const g = gesture.current;
        if (!g || g.pointerId !== event.pointerId) return;
        gesture.current = null;
        event.currentTarget.style.transform = "";
        useSessionWorkspace.getState().resize(split.id, g.current);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        gesture.current = null;
        if (ref.current) ref.current.style.transform = "";
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          gesture.current = null;
          event.currentTarget.style.transform = "";
          return;
        }
        const negative = horizontal ? "ArrowLeft" : "ArrowUp";
        const positive = horizontal ? "ArrowRight" : "ArrowDown";
        if (event.key !== negative && event.key !== positive && event.key !== "Home") return;
        event.preventDefault();
        useSessionWorkspace
          .getState()
          .resize(
            split.id,
            event.key === "Home" ? 0.5 : split.ratio + (event.key === negative ? -0.05 : 0.05),
          );
      }}
      onDoubleClick={() => useSessionWorkspace.getState().resize(split.id, 0.5)}
    />
  );
}

function AddSession({
  groupId,
  placement,
  onClose,
}: {
  groupId: string;
  placement: Placement;
  onClose: () => void;
}) {
  const threads = useThreadShells();
  const [query, setQuery] = useState("");
  const [returnFocus] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const navigate = useTargetNavigation();
  const results = threads
    .filter((thread) => thread.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 50);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup finalFocus={() => (returnFocus?.isConnected ? returnFocus : false)}>
        <DialogHeader>
          <DialogTitle>Choose a session</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <Input
            autoFocus
            aria-label="Search sessions"
            placeholder="Search sessions…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="overflow-auto">
            {results.map((thread) => (
              <button
                key={JSON.stringify([thread.environmentId, thread.id])}
                className="flex w-full flex-col rounded px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent"
                onClick={() => {
                  useSessionWorkspace.getState().place(
                    {
                      kind: "server",
                      threadRef: { environmentId: thread.environmentId, threadId: thread.id },
                    },
                    groupId,
                    placement,
                  );
                  navigate(currentWorkspaceTarget());
                  onClose();
                }}
              >
                <span>{thread.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {thread.environmentId}
                </span>
              </button>
            ))}
            {results.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                No matching sessions. Create a new thread from the sidebar first.
              </p>
            ) : null}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function WorkspaceBoard({ target }: { target: ThreadRouteTarget }) {
  const board = useSessionWorkspace((s) => s.board);
  const notice = useSessionWorkspace((s) => s.notice);
  const dragTarget = useSessionWorkspace((s) => s.dragTarget);
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const [picker, setPicker] = useState<{ groupId: string; placement: Placement } | null>(null);
  const [drop, setDrop] = useState<ReturnType<typeof workspaceDropAt>>(null);
  const navigate = useTargetNavigation();
  const targetKey = JSON.stringify(target);
  // Route changes are the sole external authority. There is no opposing focus-to-route effect.
  useLayoutEffect(() => {
    useSessionWorkspace.getState().adopt(JSON.parse(targetKey) as ThreadRouteTarget);
  }, [targetKey]);
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!dragTarget) {
      return;
    }
    const move = (event: PointerEvent | DragEvent) =>
      setDrop(workspaceDropAt(event.clientX, event.clientY));
    const cancel = () => {
      useSessionWorkspace.setState({ dragTarget: null });
      setDrop(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("dragover", move, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("dragend", cancel);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("dragover", move, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("dragend", cancel);
      window.removeEventListener("keydown", escape);
    };
  }, [dragTarget]);
  if (!board) return null;
  const narrow = size.width < 760;
  const activeGroup = groups(board.root).find((g) => g.id === (board.maximized ?? board.focused));
  const displayRoot = (narrow || board.maximized) && activeGroup ? activeGroup : board.root;
  const layout = layoutRects(displayRoot, { x: 0, y: 0, width: size.width, height: size.height });
  const activate = (tab: SessionTab) => {
    useSessionWorkspace.getState().focus(tab.id);
    navigate(tab.target);
  };
  const close = (id: string) => {
    useSessionWorkspace.getState().close(id);
    navigate(currentWorkspaceTarget());
  };
  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden md:h-dvh">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-background px-3 pl-14 [-webkit-app-region:drag]">
        <span className="text-sm font-medium">Sessions</span>
        <span className="text-xs text-muted-foreground">
          {board.tabs.length} open · {groups(board.root).length}/5 groups
        </span>
        <div className="ml-auto flex items-center gap-1 [-webkit-app-region:no-drag]">
          {narrow ? (
            <select
              aria-label="Select session group"
              value={board.focused}
              onChange={(e) => {
                const g = groups(board.root).find((g) => g.id === e.target.value);
                const t = board.tabs.find((t) => t.id === g?.selected);
                if (t) activate(t);
              }}
              className="max-w-32 bg-background text-xs"
            >
              {groups(board.root).map((g, i) => (
                <option key={g.id} value={g.id}>
                  Group {i + 1}
                </option>
              ))}
            </select>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => useSessionWorkspace.getState().disable()}
          >
            <PanelLeftCloseIcon />
            Single view
          </Button>
        </div>
      </div>
      {notice ? (
        <p role="status" className="shrink-0 bg-muted px-3 py-1 text-xs">
          {notice}
        </p>
      ) : null}
      <div
        ref={rootRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-muted/30"
        onDragOver={(event) => {
          if (dragTarget && !event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={(event) => {
          if (!dragTarget || event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.stopPropagation();
          navigate(finishSessionDrag(event.clientX, event.clientY));
        }}
      >
        {layout.groups.map(({ group, rect }, index) => (
          <div
            key={group.id}
            data-session-group={group.id}
            style={position(rect)}
            className={`overflow-hidden border ${group.id === board.focused ? "border-primary/60" : "border-border"}`}
          >
            <div className="flex h-9 items-center border-b bg-muted/50">
              <div
                role="tablist"
                aria-label={`Session group ${index + 1}`}
                className="flex min-w-0 flex-1 overflow-x-auto"
              >
                {group.tabs.map((id) => {
                  const tab = board.tabs.find((t) => t.id === id)!;
                  return (
                    <div
                      key={id}
                      className={`flex min-w-20 max-w-48 shrink-0 items-center border-r ${group.selected === id ? "bg-background" : "text-muted-foreground"}`}
                    >
                      <button
                        role="tab"
                        aria-selected={group.selected === id}
                        tabIndex={group.selected === id ? 0 : -1}
                        className="flex min-w-0 flex-1 cursor-grab items-center gap-1 px-2 py-2 text-xs focus-visible:outline-2 focus-visible:outline-primary"
                        draggable
                        onClick={() => activate(tab)}
                        onDragStart={(event) => {
                          startSessionDrag(tab.target);
                          event.dataTransfer.setData("text/x-t3-session", id);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        onKeyDown={(event) => {
                          if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
                            event.preventDefault();
                            const next =
                              group.tabs[
                                event.key === "Home"
                                  ? 0
                                  : event.key === "End"
                                    ? group.tabs.length - 1
                                    : (group.tabs.indexOf(id) +
                                        (event.key === "ArrowRight" ? 1 : group.tabs.length - 1)) %
                                      group.tabs.length
                              ];
                            const t = board.tabs.find((t) => t.id === next);
                            if (t) {
                              activate(t);
                              const buttons = event.currentTarget
                                .closest('[role="tablist"]')
                                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                              buttons?.[group.tabs.indexOf(next!)]?.focus();
                            }
                          }
                        }}
                      >
                        <TabLabel target={tab.target} />
                      </button>
                      <button
                        aria-label="Close session tab (agent keeps running)"
                        className="shrink-0 px-1 hover:text-foreground"
                        onClick={() => close(id)}
                      >
                        <XIcon className="size-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add session tab"
                  onClick={() => setPicker({ groupId: group.id, placement: "center" })}
                >
                  <PlusIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Split group right"
                  onClick={() => setPicker({ groupId: group.id, placement: "right" })}
                >
                  <Columns2Icon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Split group below"
                  onClick={() => setPicker({ groupId: group.id, placement: "bottom" })}
                >
                  <Rows2Icon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={board.maximized ? "Restore groups" : "Maximize group"}
                  onClick={() => {
                    useSessionWorkspace.getState().save({
                      ...board,
                      focused: group.id,
                      maximized: board.maximized ? null : group.id,
                    });
                    navigate(currentWorkspaceTarget());
                  }}
                >
                  {board.maximized ? <Minimize2Icon /> : <Maximize2Icon />}
                </Button>
              </div>
            </div>
            {group.tabs.length === 0 ? (
              <button
                className="m-4 rounded border border-dashed p-6 text-sm text-muted-foreground"
                onClick={() => setPicker({ groupId: group.id, placement: "center" })}
              >
                Drop a session here or choose one
              </button>
            ) : null}
          </div>
        ))}
        {/* Flat, stable children keep composers mounted when the split tree changes. */}
        {board.tabs.map((tab) => {
          const found = layout.groups.find(({ group }) => group.tabs.includes(tab.id));
          const visible = found?.group.selected === tab.id;
          const rect = found
            ? { ...found.rect, y: found.rect.y + 37, height: Math.max(0, found.rect.height - 37) }
            : { x: 0, y: 0, width: size.width, height: size.height };
          return (
            <SessionPane
              key={tab.id}
              tab={tab}
              groupId={found?.group.id}
              rect={rect}
              visible={visible}
              focused={visible && selectedTab(board)?.id === tab.id}
            />
          );
        })}
        {layout.dividers.map((divider) => (
          <ResizeHandle key={divider.split.id} {...divider} />
        ))}
        {dragTarget && drop
          ? layout.groups
              .filter(({ group }) => group.id === drop.groupId)
              .map(({ group, rect }) => {
                const r = { ...rect };
                if (drop.placement === "left" || drop.placement === "right") {
                  r.width /= 2;
                  if (drop.placement === "right") r.x += r.width;
                }
                if (drop.placement === "top" || drop.placement === "bottom") {
                  r.height /= 2;
                  if (drop.placement === "bottom") r.y += r.height;
                }
                return (
                  <div
                    key={group.id}
                    style={position(r)}
                    className="pointer-events-none absolute z-30 flex items-center justify-center border-2 border-primary bg-primary/15"
                  >
                    <span className="rounded bg-background px-2 py-1 text-xs">
                      {drop.placement === "center" ? "Move into group" : `Split ${drop.placement}`}
                    </span>
                  </div>
                );
              })
          : null}
        {picker ? <AddSession {...picker} onClose={() => setPicker(null)} /> : null}
      </div>
    </SidebarInset>
  );
}

export function SessionWorkspace({ target }: { target: ThreadRouteTarget }) {
  const enabled = useSessionWorkspace((s) => s.enabled);
  return enabled ? <WorkspaceBoard target={target} /> : <ThreadRouteView target={target} />;
}
