import { dropPlacement, type Placement } from "./layout";
import { currentWorkspaceTarget, useSessionWorkspace } from "./store";
import type { ThreadRouteTarget } from "../../threadRoutes";

export function workspaceDropAt(
  x: number,
  y: number,
): { groupId: string; placement: Placement } | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-session-group]");
  if (!element?.dataset.sessionGroup) return null;
  const box = element.getBoundingClientRect();
  return {
    groupId: element.dataset.sessionGroup,
    placement: dropPlacement(x - box.left, y - box.top, box.width, box.height),
  };
}

export function startSessionDrag(target: ThreadRouteTarget) {
  if (useSessionWorkspace.getState().enabled) useSessionWorkspace.setState({ dragTarget: target });
}

export function finishSessionDrag(x: number, y: number): ThreadRouteTarget | null {
  const { dragTarget, place } = useSessionWorkspace.getState();
  const drop = workspaceDropAt(x, y);
  useSessionWorkspace.setState({ dragTarget: null });
  if (!dragTarget || !drop) return null;
  place(dragTarget, drop.groupId, drop.placement);
  return currentWorkspaceTarget();
}
