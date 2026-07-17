import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminLogin, adminLogout, getAdminMe, getToken, clearToken } from "@/lib/api";
import { useLocation } from "wouter";
import { useEffect } from "react";

export const useAuth = () => {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const token = getToken();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: getAdminMe,
    enabled: !!token,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 min — evita refetch inutili
  });

  // Se la query fallisce (token scaduto, timeout, rete) → pulisci e vai al login
  useEffect(() => {
    if (meQuery.isError) {
      clearToken();
      setLocation("/login");
    }
  }, [meQuery.isError, setLocation]);

  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      return adminLogin(username, password);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["me"], data.admin);
      setLocation("/");
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      adminLogout();
    },
    onSuccess: () => {
      queryClient.clear();
      setLocation("/login");
    },
  });

  return {
    user: meQuery.data,
    isLoading: meQuery.isLoading,
    login: loginMutation.mutate,
    isLoggingIn: loginMutation.isPending,
    loginError: loginMutation.error,
    logout: logoutMutation.mutate,
  };
};
