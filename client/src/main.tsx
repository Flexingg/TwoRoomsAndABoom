import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { Host } from "./Host";
import { HowToPlay } from "./HowToPlay";
import { Player } from "./Player";
import { RolesExplorer } from "./RolesExplorer";
import "./style.css";

registerSW({ immediate: true });

// Path-based pages. The pre-game guides are reachable with no session and no room code; the server
// SPA-falls-back to index.html for any extensionless path.
const path = window.location.pathname.replace(/\/+$/, "");
const page =
  path === "/play" ? <Player /> : path === "/how-to-play" ? <HowToPlay /> : path === "/roles" ? <RolesExplorer /> : <Host />;
createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
