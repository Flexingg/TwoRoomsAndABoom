import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { Host } from "./Host";
import { Player } from "./Player";
import "./style.css";

registerSW({ immediate: true });

const path = window.location.pathname.replace(/\/+$/, "");
createRoot(document.getElementById("root")!).render(<StrictMode>{path === "/play" ? <Player /> : <Host />}</StrictMode>);
