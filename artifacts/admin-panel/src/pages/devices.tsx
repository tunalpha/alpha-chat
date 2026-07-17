import { useState } from "react";
import { useDevices, useRevokeDevice } from "@/hooks/use-admin";
import { format, parseISO } from "date-fns";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Search, ChevronLeft, ChevronRight, Smartphone, Laptop, Globe, Shield, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Devices() {
  const [page, setPage] = useState(1);
  const [userIdFilter, setUserIdFilter] = useState("");
  
  const { data, isLoading } = useDevices({ 
    page, 
    limit: 50, 
    user_id: userIdFilter || undefined,
    active: true
  });

  const revokeDevice = useRevokeDevice();

  const getDeviceIcon = (userAgent: string | null) => {
    if (!userAgent) return <Globe className="w-4 h-4 text-muted-foreground" />;
    const ua = userAgent.toLowerCase();
    if (ua.includes("mobile") || ua.includes("iphone") || ua.includes("android")) return <Smartphone className="w-4 h-4 text-muted-foreground" />;
    if (ua.includes("mac") || ua.includes("windows") || ua.includes("linux")) return <Laptop className="w-4 h-4 text-muted-foreground" />;
    return <Globe className="w-4 h-4 text-muted-foreground" />;
  };

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Active Sessions</h1>
          <p className="text-muted-foreground mt-1 text-sm">Monitor and manage connected devices across the platform.</p>
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <div className="p-4 border-b border-border flex flex-wrap gap-4 items-center bg-muted/20">
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input 
              placeholder="Filter by user ID..." 
              value={userIdFilter} 
              onChange={e => { setUserIdFilter(e.target.value); setPage(1); }}
              className="pl-9 font-mono text-xs"
            />
          </div>
        </div>
        
        <CardContent className="p-0 flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead className="font-mono text-xs uppercase w-[250px]">Device</TableHead>
                <TableHead className="font-mono text-xs uppercase">User</TableHead>
                <TableHead className="font-mono text-xs uppercase">Trust</TableHead>
                <TableHead className="font-mono text-xs uppercase">Last Used</TableHead>
                <TableHead className="font-mono text-xs uppercase text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground font-mono text-sm">Scanning sessions...</TableCell>
                </TableRow>
              ) : data?.devices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground font-mono text-sm">No active sessions found.</TableCell>
                </TableRow>
              ) : (
                data?.devices.map(device => (
                  <TableRow key={device.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {getDeviceIcon(device.user_agent)}
                        <div className="flex flex-col max-w-[200px]">
                          <span className="font-medium text-sm truncate">{device.device_name || "Unknown Device"}</span>
                          <span className="font-mono text-[10px] text-muted-foreground truncate" title={device.user_agent || ""}>
                            {device.user_agent || "No user agent"}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-mono text-xs text-primary">@{device.username || "unknown"}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{device.user_id.slice(0,12)}...</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {device.is_trusted ? (
                        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-mono text-[10px] uppercase gap-1">
                          <Shield className="w-3 h-3" /> Trusted
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="font-mono text-[10px] uppercase text-muted-foreground">Standard</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {device.last_used_at ? format(parseISO(device.last_used_at), "MMM d, HH:mm") : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive font-mono text-xs uppercase"
                        onClick={() => revokeDevice.mutate(device.id)}
                        disabled={revokeDevice.isPending}
                      >
                        <Trash2 className="w-4 h-4 mr-2" /> Revoke
                      </Button>
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
              PAGE {data.page} OF {data.pages} ({data.total} SESSIONS)
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
    </div>
  );
}
