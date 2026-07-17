import { useState } from "react";
import { useUsers, useUpdateUserStatus, useUpdateUserRole, useDeleteUser, useRevokeUserSessions } from "@/hooks/use-admin";
import { format, parseISO } from "date-fns";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Search, ChevronLeft, ChevronRight, Shield, ShieldAlert, UserX, UserCheck, Trash2, Smartphone, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export default function UsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  
  const { data, isLoading } = useUsers({ 
    page, 
    limit: 20, 
    search: search || undefined, 
    status: statusFilter === "all" ? undefined : statusFilter 
  });

  const updateStatus = useUpdateUserStatus();
  const updateRole = useUpdateUserRole();
  const deleteUser = useDeleteUser();
  const revokeSessions = useRevokeUserSessions();

  const [actionUser, setActionUser] = useState<any>(null);
  const [dialogType, setDialogType] = useState<"delete" | "revoke" | null>(null);

  const handleAction = () => {
    if (!actionUser || !dialogType) return;
    if (dialogType === "delete") {
      deleteUser.mutate(actionUser.id);
    } else if (dialogType === "revoke") {
      revokeSessions.mutate(actionUser.id);
    }
    setDialogType(null);
    setActionUser(null);
  };

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage accounts, roles, and access.</p>
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <div className="p-4 border-b border-border flex flex-wrap gap-4 items-center bg-muted/20">
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input 
              placeholder="Search by username/email..." 
              value={search} 
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 font-mono text-xs"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-40 font-mono text-xs">
              <SelectValue placeholder="Filter Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="deleted">Deleted</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <CardContent className="p-0 flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead className="font-mono text-xs uppercase">User</TableHead>
                <TableHead className="font-mono text-xs uppercase">Role</TableHead>
                <TableHead className="font-mono text-xs uppercase">Status</TableHead>
                <TableHead className="font-mono text-xs uppercase">Security</TableHead>
                <TableHead className="font-mono text-xs uppercase">Created</TableHead>
                <TableHead className="font-mono text-xs uppercase text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground font-mono text-sm">Loading users...</TableCell>
                </TableRow>
              ) : data?.users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground font-mono text-sm">No users found.</TableCell>
                </TableRow>
              ) : (
                data?.users.map(user => (
                  <TableRow key={user.id} className="group">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-bold text-sm">{user.display_name}</span>
                        <span className="font-mono text-xs text-muted-foreground">@{user.username}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.admin_role ? (
                        <Badge variant="secondary" className="font-mono text-[10px] uppercase bg-primary/10 text-primary border-primary/20">
                          {user.admin_role.replace('_', ' ')}
                        </Badge>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground">USER</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.status === "active" ? "default" : "destructive"} className="font-mono text-[10px] uppercase">
                        {user.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Shield className={`w-4 h-4 ${user.totp_enabled ? 'text-emerald-500' : 'opacity-30'}`} aria-label="2FA" />
                        <ShieldAlert className={`w-4 h-4 ${user.has_phoenix ? 'text-amber-500' : 'opacity-30'}`} aria-label="Phoenix" />
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {format(parseISO(user.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 font-mono text-xs uppercase">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {user.status === 'active' ? (
                            <DropdownMenuItem onClick={() => updateStatus.mutate({ id: user.id, status: 'suspended', reason: 'Admin intervention' })}>
                              <UserX className="w-4 h-4 mr-2" /> Suspend
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => updateStatus.mutate({ id: user.id, status: 'active' })}>
                              <UserCheck className="w-4 h-4 mr-2" /> Reactivate
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => { setActionUser(user); setDialogType("revoke"); }}>
                            <Smartphone className="w-4 h-4 mr-2" /> Revoke Sessions
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:bg-destructive focus:text-destructive-foreground" onClick={() => { setActionUser(user); setDialogType("delete"); }}>
                            <Trash2 className="w-4 h-4 mr-2" /> Delete Account
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>

        {data && data.pages > 1 && (
          <div className="p-4 border-t border-border flex items-center justify-between bg-muted/20">
            <span className="font-mono text-xs text-muted-foreground">
              PAGE {data.page} OF {data.pages} ({data.total} USERS)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Prev
              </Button>
              <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <AlertDialog open={!!dialogType} onOpenChange={() => setDialogType(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono uppercase">
              {dialogType === "delete" ? "Delete Account" : "Revoke All Sessions"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialogType === "delete" 
                ? `Are you sure you want to permanently delete @${actionUser?.username}? This action cannot be undone and will destroy all associated encrypted data.` 
                : `Are you sure you want to revoke all active sessions for @${actionUser?.username}? They will be logged out of all devices immediately.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs uppercase">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAction} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono text-xs uppercase">
              Confirm {dialogType}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
