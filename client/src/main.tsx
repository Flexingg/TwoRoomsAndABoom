import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { Home } from "./Home";
import { Host } from "./Host";
import { HowToPlay } from "./HowToPlay";
import { WerewolfHowToPlay, WerewolfRoles } from "./onuw/Guide";
import { WerewolfHost } from "./onuw/Host";
import { WerewolfPlayer } from "./onuw/Player";
import { Player } from "./Player";
import { RolesExplorer } from "./RolesExplorer";
import "./style.css";

registerSW({ immediate: true });

// Path-based pages; the server SPA-falls-back to index.html for any extensionless path. Two Rooms keeps its
// original join and guide paths (/play, /how-to-play, /roles) so QR codes and bookmarks keep working.
const PAGES: Record<string, () => ReactNode> = {
  "": () => <Home />,
  "/two-rooms": () => <Host />,
  "/play": () => <Player />,
  "/two-rooms/play": () => <Player />,
  "/how-to-play": () => <HowToPlay />,
  "/two-rooms/how-to-play": () => <HowToPlay />,
  "/roles": () => <RolesExplorer />,
  "/two-rooms/roles": () => <RolesExplorer />,
  "/werewolf": () => <WerewolfHost />,
  "/werewolf/play": () => <WerewolfPlayer />,
  "/werewolf/how-to-play": () => <WerewolfHowToPlay />,
  "/werewolf/roles": () => <WerewolfRoles />,
};
const path = window.location.pathname.replace(/\/+$/, "");
const page = (PAGES[path] ?? PAGES[""])();
createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
