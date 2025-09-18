import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "../lib/queryClient";
import type { SerializedUser } from "@shared/api-types";

export function useUserRole() {
  const { data: user, isLoading, error } = useQuery<SerializedUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes cache for performance
    gcTime: 10 * 60 * 1000, // 10 minutes garbage collection
  });

  const role = user?.role || 'guest';
  const isAdmin = role === 'platform_admin';
  const isSupport = role === 'support';
  const isCustomerAdmin = role === 'customer_admin';
  const isCustomerUser = role === 'customer_user';
  const isAuthenticated = !!user;

  return {
    user,
    role,
    isAdmin,
    isSupport,
    isCustomerAdmin,
    isCustomerUser,
    isAuthenticated,
    isLoading,
    error,
    // Helper function to check if user has admin privileges
    hasAdminAccess: isAdmin || isSupport,
    // Helper function to check if user is customer type
    isCustomer: isCustomerAdmin || isCustomerUser,
  };
}