import { StrictMode, Component, type ReactNode } from "react";
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

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[aurex] Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "var(--bg-deep)",
          color: "var(--text-muted)",
          fontFamily: '"JetBrains Mono", monospace',
          textAlign: "center",
          padding: "24px",
        }}>
          <div style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "4px", color: "var(--error, #ef4444)", marginBottom: "12px" }}>
            FATAL ERROR
          </div>
          <div style={{ fontSize: "13px", maxWidth: "480px", marginBottom: "20px", lineHeight: 1.6 }}>
            Something went wrong while rendering the dashboard.
          </div>
          {this.state.error && (
            <pre style={{ fontSize: "10px", color: "var(--text-muted)", maxWidth: "600px", overflow: "auto", marginBottom: "20px" }}>
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "var(--accent)",
              color: "var(--bg-deep)",
              border: "none",
              borderRadius: "4px",
              padding: "8px 20px",
              cursor: "pointer",
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "12px",
              letterSpacing: "1px",
            }}
          >
            Reload Dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Always wrap with Auth0Provider — useAuth0() must be called inside the provider.
// When authDisabled, we pass placeholder values; the useAuth hook short-circuits anyway.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
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
    </ErrorBoundary>
  </StrictMode>,
);
