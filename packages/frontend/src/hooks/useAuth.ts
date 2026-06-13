import { useAuth0 } from "@auth0/auth0-react";

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

const authDisabled = import.meta.env.VITE_AUTH_DISABLED === "true";

const STUB_USER: AuthUser = {
  sub: "local-dev",
  email: "dev@aurex.local",
  name: "Dev User",
};

/**
 * When VITE_AUTH_DISABLED=true, returns a stub authenticated user
 * and a no-op token getter so the rest of the app works untouched.
 * useAuth0() is still called (required by React rules of hooks) but
 * its result is ignored when auth is disabled.
 */
export function useAuth() {
  // Must call the hook unconditionally (React rules of hooks)
  const auth0 = useAuth0();

  if (authDisabled) {
    return {
      user: STUB_USER,
      isAuthenticated: true,
      isLoading: false,
      loginWithRedirect: async () => {},
      logout: () => {},
      getToken: async (): Promise<string> => "dev-no-token",
    };
  }

  const { user, isAuthenticated, isLoading, loginWithRedirect, logout, getAccessTokenSilently } =
    auth0;

  const authUser: AuthUser | undefined = user
    ? {
        sub: user.sub ?? "",
        email: user.email,
        name: user.name,
        picture: user.picture,
      }
    : undefined;

  async function getToken(): Promise<string> {
    return getAccessTokenSilently();
  }

  return {
    user: authUser,
    isAuthenticated,
    isLoading,
    loginWithRedirect,
    logout: () =>
      logout({
        logoutParams: { returnTo: window.location.origin },
      }),
    getToken,
  };
}
