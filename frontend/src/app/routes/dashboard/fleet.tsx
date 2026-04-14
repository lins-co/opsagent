export default function DashboardFleet() {
  return (
    <div className="h-full bg-background p-8 overflow-y-auto no-scrollbar">
      <div className="max-w-[1400px] mx-auto">
        <div className="glass-panel p-10 rounded-3xl border border-border/40 relative overflow-hidden">
           <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 z-0"></div>
           <div className="relative z-10">
            <h1 className="text-3xl font-semibold text-foreground mb-4">Fleet Stability Overview</h1>
            <p className="text-[14px] text-muted-foreground max-w-2xl leading-relaxed">
              This dashboard will display granular fleet health metrics, spatial anomaly tracking, and aggregated risk by geolocated zones. Full telemetry sync is deploying in Week 3.
            </p>
           </div>
        </div>
      </div>
    </div>
  )
}
