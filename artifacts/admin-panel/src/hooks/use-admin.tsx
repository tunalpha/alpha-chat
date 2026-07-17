import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  getStats, getGrowth, getSecurityFeatures, getSystemHealth, getStorage, 
  getSecurityEvents, getUsers, updateUserStatus, updateUserRole, deleteUser, 
  revokeUserSessions, getDevices, revokeDevice, downloadAuditExport 
} from "@/lib/api";

export const useAdminStats = () => useQuery({
  queryKey: ["adminStats"],
  queryFn: getStats,
  refetchInterval: 15000,
});

export const useAdminGrowth = (range: "7d" | "30d" | "90d") => useQuery({
  queryKey: ["adminGrowth", range],
  queryFn: () => getGrowth(range),
});

export const useSecurityFeatures = () => useQuery({
  queryKey: ["securityFeatures"],
  queryFn: getSecurityFeatures,
});

export const useSystemHealth = () => useQuery({
  queryKey: ["systemHealth"],
  queryFn: getSystemHealth,
  refetchInterval: 15000,
});

export const useStorage = () => useQuery({
  queryKey: ["storage"],
  queryFn: getStorage,
});

export const useSecurityEvents = (params: { page?: number; limit?: number; event?: string; user_id?: string; since?: string }) => useQuery({
  queryKey: ["securityEvents", params],
  queryFn: () => getSecurityEvents(params),
});

export const useUsers = (params: { page?: number; limit?: number; search?: string; status?: string }) => useQuery({
  queryKey: ["users", params],
  queryFn: () => getUsers(params),
});

export const useDevices = (params: { page?: number; limit?: number; user_id?: string; trusted?: boolean; active?: boolean }) => useQuery({
  queryKey: ["devices", params],
  queryFn: () => getDevices(params),
});

export const useUpdateUserStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: "active" | "suspended"; reason?: string }) => updateUserStatus(id, status, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
};

export const useUpdateUserRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: "super_admin" | "security_admin" | "support" | "read_only" | null }) => updateUserRole(id, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
};

export const useDeleteUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
};

export const useRevokeUserSessions = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeUserSessions,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
  });
};

export const useRevokeDevice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeDevice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["devices"] }),
  });
};

export const useDownloadAuditExport = () => useMutation({
  mutationFn: downloadAuditExport,
});
