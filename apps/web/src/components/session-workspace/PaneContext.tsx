import { createContext, useContext } from "react";
import type { ThreadRouteTarget } from "../../threadRoutes";

export const SessionPaneContext = createContext<{
  tabId: string;
  focused: boolean;
  visible: boolean;
  ownsInput: () => boolean;
  promote: (target: ThreadRouteTarget) => void;
} | null>(null);

export function useSessionPane() {
  return useContext(SessionPaneContext);
}
