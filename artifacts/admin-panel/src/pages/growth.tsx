import { useState } from "react";
import { useAdminGrowth } from "@/hooks/use-admin";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Growth() {
  const [range, setRange] = useState<"7d"|"30d"|"90d">("30d");
  const { data, isLoading } = useAdminGrowth(range);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Growth & Activity</h1>
        <Tabs value={range} onValueChange={(v) => setRange(v as any)}>
          <TabsList>
            <TabsTrigger value="7d" className="font-mono text-xs uppercase">7 Days</TabsTrigger>
            <TabsTrigger value="30d" className="font-mono text-xs uppercase">30 Days</TabsTrigger>
            <TabsTrigger value="90d" className="font-mono text-xs uppercase">90 Days</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading || !data ? (
        <div className="h-[400px] bg-muted/50 rounded-xl animate-pulse flex items-center justify-center">
          <p className="font-mono text-sm text-muted-foreground uppercase">Aggregating telemetry...</p>
        </div>
      ) : (
        <div className="space-y-6">
          <ChartCard 
            title="User Registration" 
            data={data.series} 
            dataKey="users" 
            color="hsl(var(--primary))" 
          />
          <ChartCard 
            title="Message Volume" 
            data={data.series} 
            dataKey="messages" 
            color="hsl(var(--chart-4))" 
          />
          <ChartCard 
            title="Media Uploads" 
            data={data.series} 
            dataKey="media" 
            color="hsl(var(--chart-3))" 
          />
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, data, dataKey, color }: { title: string, data: any[], dataKey: string, color: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`gradient-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={color} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(val) => format(parseISO(val), "MMM d")}
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickMargin={10}
                axisLine={false}
                tickLine={false}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(1)}k` : val}
                axisLine={false}
                tickLine={false}
                tickMargin={10}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: "hsl(var(--card))", 
                  borderColor: "hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontFamily: "var(--app-font-mono)",
                  textTransform: "uppercase"
                }}
                labelFormatter={(val) => format(parseISO(val), "MMM d, yyyy")}
              />
              <Area 
                type="monotone" 
                dataKey={dataKey} 
                stroke={color} 
                strokeWidth={2}
                fillOpacity={1} 
                fill={`url(#gradient-${dataKey})`} 
                animationDuration={500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
