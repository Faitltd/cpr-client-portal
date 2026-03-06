/**
 * Dev harness — paste the JWT printed by `npm run test:manual` (cliq-service)
 * into AUTH_TOKEN below, then run `npm run dev` in this folder.
 *
 * What to verify at http://localhost:5173:
 *   - History from channel `cpr-client-test` loads on mount.
 *   - Typing a message and pressing Send or Enter posts it to the backend.
 *   - The message appears immediately (optimistic) and shows up in Zoho Cliq.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { ProjectChat } from "./components/ProjectChat";

// Replace with the JWT from `npm run test:manual` output, or generate one with:
//   node -e "console.log(require('jsonwebtoken').sign({clientId:'test-client',projectSlug:'test',name:'Ray'}, process.env.JWT_SECRET, {expiresIn:'8h'}))"
const AUTH_TOKEN = "<paste-jwt-here>";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProjectChat
      projectSlug="test"
      authToken={AUTH_TOKEN}
      apiBaseUrl="http://localhost:3001"
    />
  </StrictMode>
);
