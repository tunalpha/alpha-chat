import { useState } from "react";
import { useDownloadAuditExport } from "@/hooks/use-admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileDown, ShieldAlert, FileJson } from "lucide-react";

export default function Audit() {
  const [days, setDays] = useState("7");
  const download = useDownloadAuditExport();

  const handleExport = () => {
    download.mutate(parseInt(days));
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto mt-12">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Export</h1>
        <p className="text-muted-foreground mt-1 text-sm">Download raw JSON audit logs for external SIEM integration or compliance archival.</p>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="w-5 h-5 text-primary" />
            JSON Export Configuration
          </CardTitle>
          <CardDescription>
            Audit logs contain sensitive PII and operational telemetry. Handle exported files according to your organization's data retention policies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-mono uppercase text-muted-foreground">Retention Range</label>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="font-mono">
                <SelectValue placeholder="Select timeframe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 Days</SelectItem>
                <SelectItem value="30">Last 30 Days</SelectItem>
                <SelectItem value="90">Last 90 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-md flex gap-3 text-amber-600 dark:text-amber-500">
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-sm">
              <strong className="font-bold block mb-1">Confidentiality Notice</strong>
              Exported logs contain plaintext metadata, IP addresses, and user identifiers. Downloading this archive creates a local copy that is outside the platform's encryption boundary.
            </div>
          </div>

          <Button 
            className="w-full font-mono uppercase tracking-wider" 
            size="lg"
            onClick={handleExport}
            disabled={download.isPending}
          >
            {download.isPending ? (
              "Generating Archive..."
            ) : (
              <>
                <FileDown className="w-4 h-4 mr-2" />
                Download {days}-Day Archive
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
