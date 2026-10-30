import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

document.documentElement.classList.add("live", "bx");   // 보드 CSS 의 「html.live」 · 틀 CSS 의 「html.bx」
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
