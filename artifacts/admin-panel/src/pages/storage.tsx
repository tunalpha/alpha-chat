import { useStorage } from "@/hooks/use-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Database, HardDrive, Hash, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";

export default function Storage() {
  const { data, isLoading } = useStorage();
  const [search, setSearch] = useState("");

  if (isLoading || !data) {
    return <div className="h-64 bg-muted animate-pulse rounded-xl"></div>;
  }

  const collections = data.collections
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.size_mb - a.size_mb);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Database Storage</h1>

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
              {collections.map(c => (
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
    </div>
  );
}
