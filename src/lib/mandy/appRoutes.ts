import appSource from "../../App.tsx?raw";
import { indexAppRoutes, type IndexedRoute } from "./routeIndex";

/** Live route table. Rebuilt from the router source so a new page is not a guessed URL. */
export const APP_ROUTES: IndexedRoute[] = indexAppRoutes(appSource);
