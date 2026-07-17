import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminLogin, adminLogout, getAdminMe, getToken, setToken, clearToken } from "@/lib/api";
import { useLocation } from "wouter";

export const useAuth = () => {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const token = getToken();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: getAdminMe,
    enabled: !!token,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: any) => {
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
