import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "../lib/queryClient";
import type { SerializedUser } from "@shared/api-types";

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<SerializedUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });

  return {
    user,
    isLoading,
    error,
    isAuthenticated: !!user,
  };
}