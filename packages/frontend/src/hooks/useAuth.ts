import { useAuth0 } from "@auth0/auth0-react";

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export function useAuth() {
  const {
    user,
    isAuthenticated,
    isLoading,
    loginWithRedirect,
    logout,
    getAccessTokenSilently,
  } = useAuth0();

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
