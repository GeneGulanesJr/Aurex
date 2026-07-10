import { useState } from "react";
import { useAuth } from "../hooks/useAuth";

export function LoginScreen() {
  const { loginWithRedirect, isLoading } = useAuth();
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "var(--bg-deep)",
        color: "var(--text-primary)",
        fontFamily: '"JetBrains Mono", monospace',
      }}
    >
      <div
        style={{
          fontSize: "48px",
          fontWeight: 700,
          letterSpacing: "12px",
          color: "var(--accent)",
          marginBottom: "8px",
          textShadow: "0 0 20px var(--accent-glow)",
        }}
      >
        AUREX
      </div>
      <div
        style={{
          fontSize: "13px",
          letterSpacing: "4px",
          color: "var(--text-muted)",
          marginBottom: "48px",
        }}
      >
        REPOSITORY SCANNER
      </div>
      <button
        onClick={async () => {
          setSignInError(null);
          setSigningIn(true);
          try {
            await loginWithRedirect();
          } catch (err) {
            setSignInError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
          } finally {
            setSigningIn(false);
          }
        }}
        disabled={isLoading || signingIn}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "14px 32px",
          background: "var(--accent)",
          color: "var(--bg-deep)",
          border: "none",
          borderRadius: "4px",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "12px",
          fontWeight: 600,
          letterSpacing: "2px",
          textTransform: "uppercase",
          cursor: isLoading || signingIn ? "not-allowed" : "pointer",
          opacity: isLoading || signingIn ? 0.7 : 1,
          boxShadow: "0 0 24px var(--accent-glow)",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.14 24.14 0 0 0 0 21.56l7.98-6.19z" />
          <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        {isLoading || signingIn ? "LOADING..." : "SIGN IN WITH GOOGLE"}
      </button>
      {signInError && (
        <div
          role="alert"
          style={{
            marginTop: "20px",
            maxWidth: "420px",
            padding: "10px 14px",
            background: "var(--bg-inset)",
            border: "1px solid var(--error, #ef4444)",
            borderRadius: "4px",
            color: "var(--error, #ef4444)",
            fontSize: "12px",
            fontFamily: '"JetBrains Mono", monospace',
            textAlign: "center",
          }}
        >
          {signInError}
        </div>
      )}
    </div>
  );
}
