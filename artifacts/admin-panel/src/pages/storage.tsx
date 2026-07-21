import { useStorage } from "@/hooks/use-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Database, HardDrive, Hash, Search, Cloud, Files, HardDrive as CloudDrive } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";

function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(3)} GB`;
}

export default function Storage() {
  const { data, isLoading } = useStorage();
  const [search, setSearch] = useState("");

  if (isLoading || !data) {
    return <div className="h-64 bg-muted animate-pulse rounded-xl"></div>;
  }

  const collections = data.collections
    .filter((c: { name: string }) => c.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a: { size_mb: number }, b: { size_mb: number }) => b.size_mb - a.size_mb);

  const r2 = data.r2 as {
    file_count: number;
    total_bytes: number;
    total_mb: number;
    total_gb: number;
    top_uploaders: Array<{ username: string; bytes: number; count: number }>;
    top_conversations: Array<{ conversation_id: string; bytes: number; count: number }>;
  } | undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Storage</h1>

      {/* ── MongoDB overview ── */}
      <div>
        <h2 className="text-sm font-mono uppercase text-muted-foreground mb-3">MongoDB</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-mono uppercase text-muted-foreground">Total Data Size</CardTitle>
              <Database className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono tracking-tight">{data.database.size_mb.toFixed(2)} MB</div>
              <p className="text-xs text-muted-foreground mt-1">Raw documents</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-mono uppercase text-muted-foreground">Total Index Size</CardTitle>
              <HardDrive className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono tracking-tight">{data.database.index_mb.toFixed(2)} MB</div>
              <p className="text-xs text-muted-foreground mt-1">B-tree indexes</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-mono uppercase text-muted-foreground">Total Documents</CardTitle>
              <Hash className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono tracking-tight">{data.database.objects_count.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">Across {data.database.collections_count} collections</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle>Collections Breakdown</CardTitle>
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input
              placeholder="Search collections..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 font-mono text-xs"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-mono text-xs font-semibold uppercase">Collection</TableHead>
                <TableHead className="font-mono text-xs font-semibold uppercase text-right">Documents</TableHead>
                <TableHead className="font-mono text-xs font-semibold uppercase text-right">Data Size (MB)</TableHead>
                <TableHead className="font-mono text-xs font-semibold uppercase text-right">Index Size (MB)</TableHead>
                <TableHead className="font-mono text-xs font-semibold uppercase text-right">Total Storage (MB)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {collections.map((c: { name: string; count: number; size_mb: number; index_mb: number; storage_mb: number }) => (
                <TableRow key={c.name}>
                  <TableCell className="font-mono text-sm font-medium">{c.name}</TableCell>
                  <TableCell className="font-mono text-sm text-right text-muted-foreground">{c.count.toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-sm text-right">{c.size_mb.toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-sm text-right">{c.index_mb.toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-sm text-right font-semibold">{c.storage_mb.toFixed(2)}</TableCell>
                </TableRow>
              ))}
              {collections.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground font-mono text-sm">
                    No collections matched search criteria.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Cloudflare R2 section ── */}
      {r2 && (
        <div>
          <h2 className="text-sm font-mono uppercase text-muted-foreground mb-3">Cloudflare R2 Object Storage</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-mono uppercase text-muted-foreground">Files Stored</CardTitle>
                <Files className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono tracking-tight">{r2.file_count.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">E2E encrypted blobs</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-mono uppercase text-muted-foreground">Total Ciphertext</CardTitle>
                <Cloud className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono tracking-tight">{r2.total_mb.toFixed(2)} MB</div>
                <p className="text-xs text-muted-foreground mt-1">{r2.total_gb.toFixed(4)} GB</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-mono uppercase text-muted-foreground">Avg File Size</CardTitle>
                <CloudDrive className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono tracking-tight">
                  {r2.file_count > 0 ? fmtBytes(Math.round(r2.total_bytes / r2.file_count)) : "—"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Ciphertext average</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Top uploaders */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Top Uploaders</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="font-mono text-xs font-semibold uppercase">User</TableHead>
                      <TableHead className="font-mono text-xs font-semibold uppercase text-right">Files</TableHead>
                      <TableHead className="font-mono text-xs font-semibold uppercase text-right">Size</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r2.top_uploaders.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center py-4 text-muted-foreground font-mono text-xs">No files yet</TableCell>
                      </TableRow>
                    )}
                    {r2.top_uploaders.map((u) => (
                      <TableRow key={u.username}>
                        <TableCell className="font-mono text-sm font-medium">@{u.username}</TableCell>
                        <TableCell className="font-mono text-sm text-right text-muted-foreground">{u.count}</TableCell>
                        <TableCell className="font-mono text-sm text-right">{fmtBytes(u.bytes)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Top conversations */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Top Conversations</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="font-mono text-xs font-semibold uppercase">Conversation ID</TableHead>
                      <TableHead className="font-mono text-xs font-semibold uppercase text-right">Files</TableHead>
                      <TableHead className="font-mono text-xs font-semibold uppercase text-right">Size</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r2.top_conversations.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center py-4 text-muted-foreground font-mono text-xs">No files yet</TableCell>
                      </TableRow>
                    )}
                    {r2.top_conversations.map((c) => (
                      <TableRow key={c.conversation_id}>
                        <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[160px]">{c.conversation_id}</TableCell>
                        <TableCell className="font-mono text-sm text-right text-muted-foreground">{c.count}</TableCell>
                        <TableCell className="font-mono text-sm text-right">{fmtBytes(c.bytes)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
