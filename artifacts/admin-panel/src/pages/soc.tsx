import { useState } from "react";
import { useSecurityEvents } from "@/hooks/use-admin";
import { format, parseISO } from "date-fns";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Search, ChevronLeft, ChevronRight, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function SOC() {
  const [page, setPage] = useState(1);
  const [userIdFilter, setUserIdFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");

  const { data, isLoading } = useSecurityEvents({ 
    page, 
    limit: 50, 
    user_id: userIdFilter || undefined, 
    event: eventFilter || undefined 
  });

  const getEventBadgeVariant = (event: string) => {
    if (event.includes("failed") || event.includes("suspended") || event.includes("revoked")) return "destructive";
    if (event.includes("login") || event.includes("active")) return "default";
    return "secondary";
  };

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Security Operations Center</h1>
          <p className="text-muted-foreground mt-1 text-sm">Real-time audit log of security events.</p>
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
          <div className="relative w-64">
            <Activity className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input 
              placeholder="Filter by event type..." 
              value={eventFilter} 
              onChange={e => { setEventFilter(e.target.value); setPage(1); }}
              className="pl-9 font-mono text-xs"
            />
          </div>
        </div>
        
        <CardContent className="p-0 flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead className="font-mono text-xs uppercase w-[180px]">Timestamp</TableHead>
                <TableHead className="font-mono text-xs uppercase w-[200px]">Event</TableHead>
                <TableHead className="font-mono text-xs uppercase">User ID</TableHead>
                <TableHead className="font-mono text-xs uppercase">IP / Country</TableHead>
                <TableHead className="font-mono text-xs uppercase text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground font-mono text-sm">
                    Querying audit logs...
                  </TableCell>
                </TableRow>
              ) : data?.events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground font-mono text-sm">
                    No security events found.
                  </TableCell>
                </TableRow>
              ) : (
                data?.events.map(event => (
                  <TableRow key={event.id} className="group cursor-default">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {format(parseISO(event.created_at), "yyyy-MM-dd HH:mm:ss")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getEventBadgeVariant(event.event)} className="font-mono text-[10px] uppercase tracking-wider rounded-sm">
                        {event.event}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {event.user_id ? (
                        <span className="text-primary truncate block max-w-[150px]" title={event.user_id}>{event.user_id}</span>
                      ) : (
                        <span className="text-muted-foreground/50">SYSTEM</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {event.ip_hash ? `${event.ip_hash.slice(0,8)}...` : '-'}
                      {event.country_code && ` (${event.country_code})`}
                    </TableCell>
                    <TableCell className="text-right">
                      {event.metadata && Object.keys(event.metadata).length > 0 && (
                        <span className="font-mono text-[10px] bg-muted px-2 py-1 rounded text-muted-foreground truncate max-w-[200px] inline-block" title={JSON.stringify(event.metadata)}>
                          {JSON.stringify(event.metadata).slice(0, 30)}...
                        </span>
                      )}
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
              PAGE {data.page} OF {data.pages} ({data.total} EVENTS)
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
