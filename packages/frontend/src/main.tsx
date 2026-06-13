import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";
import { App } from "./App";
import "./styles.css";

const authDisabled =
  import.meta.env.VITE_AUTH_DISABLED === "true";

const domain = (import.meta.env.VITE_AUTH0_DOMAIN ?? "") as string;
const clientId = (import.meta.env.VITE_AUTH0_CLIENT_ID ?? "") as string;
const audience = (import.meta.env.VITE_AUTH0_AUDIENCE ?? "") as string;

if (!authDisabled && (!domain || !clientId || !audience)) {
  throw new Error(
    "Missing Auth0 env vars: set VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID, VITE_AUTH0_AUDIENCE (or set VITE_AUTH_DISABLED=true)",
  );
}

// Always wrap with Auth0Provider — useAuth0() must be called inside the provider.
// When authDisabled, we pass placeholder values; the useAuth hook short-circuits anyway.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Auth0Provider
      domain={domain || "disabled.placeholder.auth0.com"}
      clientId={clientId || "disabled-placeholder"}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: audience || "https://disabled.placeholder.local",
      }}
    >
      <App />
    </Auth0Provider>
  </StrictMode>,
);
