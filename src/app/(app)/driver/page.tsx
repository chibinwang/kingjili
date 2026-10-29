"use client";

import { Card, PageHeader } from "@/components/ui";
import { DriverView } from "@/components/dispatch/DriverView";
import { routeView } from "@/lib/selectors";
import { useDb } from "@/lib/store";
import { DEMO_TODAY, formatDate } from "@/lib/time";

/** Phone-first entry for drivers: only their stops, delivery completion and collections. */
export default function DriverPage() {
  const db = useDb();
  const plan = routeView(db)?.plan;
  return (
    <div className="animate-rise">
      <PageHeader eyebrow={`DRIVER · ${formatDate(DEMO_TODAY, { weekday: true })}`} title="司機作業" sub={`路線 v${plan?.version ?? 1}・送達後登錄收款；現金回倉繳回，由會計確認存入。`} />
      <Card className="-mx-2 sm:mx-0">
        <DriverView />
      </Card>
    </div>
  );
}
