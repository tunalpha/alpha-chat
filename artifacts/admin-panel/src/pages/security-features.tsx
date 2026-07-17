import { useSecurityFeatures } from "@/hooks/use-admin";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export default function SecurityFeatures() {
  const { data, isLoading } = useSecurityFeatures();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Security Posture</h1>
        <p className="text-muted-foreground mt-1">Platform-wide security feature adoption metrics.</p>
      </div>

      {isLoading || !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-muted rounded-xl animate-pulse"></div>)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.features.map(feature => (
            <Card key={feature.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{feature.label}</CardTitle>
                <CardDescription className="text-xs font-mono uppercase">
                  {feature.count.toLocaleString()} / {data.total_users.toLocaleString()} users
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2">
                  <Progress value={feature.pct} className="h-2" />
                  <div className="text-right text-xs font-mono font-medium text-muted-foreground">
                    {feature.pct.toFixed(1)}% ADOPTION
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
