import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  getStats, getGrowth, getSecurityFeatures, getSystemHealth, getStorage, 
  getSecurityEvents, getUsers, updateUserStatus, updateUserRole, deleteUser, 
  revokeUserSessions, adminSetTempPassword, getDevices, revokeDevice, downloadAuditExport,
  getR2Dashboard, getR2Health, getR2Search, runR2Cleanup, runR2Consistency,
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

// ── R2 Monitor hooks ──────────────────────────────────────────────────────────

export const useR2Dashboard = () => useQuery({
  queryKey: ["r2Dashboard"],
  queryFn:  getR2Dashboard,
  staleTime: 30_000,
});

export const useR2Health = () => useQuery({
  queryKey: ["r2Health"],
  queryFn:  getR2Health,
  staleTime: 5_000,
});

export const useR2Search = (params: {
  media_id?: string; username?: string; conversation_id?: string;
  type?: string; since?: string; until?: string; page?: number; limit?: number;
}) => useQuery({
  queryKey: ["r2Search", params],
  queryFn:  () => getR2Search(params),
  enabled:  Object.keys(params).some(k => k !== "page" && params[k as keyof typeof params] !== undefined),
});

export const useR2Cleanup = () => useMutation({ mutationFn: runR2Cleanup });

export const useR2Consistency = () => useMutation({ mutationFn: runR2Consistency });

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

export const useSetTempPassword = () =>
  useMutation({
    mutationFn: adminSetTempPassword,
  });
