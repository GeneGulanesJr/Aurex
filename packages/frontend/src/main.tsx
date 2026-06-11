import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";
import { App } from "./App";
import "./styles.css";

const domain = import.meta.env.VITE_AUTH0_DOMAIN as string;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID as string;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE as string;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience,
      }}
    >
      <App />
    </Auth0Provider>
  </StrictMode>,
);
