import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Reusable skeleton patterns. Match the real layout closely so the
 * transition from skeleton to content feels instant.
 */

// ---------- LIST ROW (Jobs / Quotes / Invoices / Leads) ----------
export const ListRowSkeleton = ({ className }: { className?: string }) => (
  <Card className={cn("overflow-hidden", className)}>
    <CardContent className="py-3 px-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="text-right space-y-2 shrink-0">
          <Skeleton className="h-4 w-20 ml-auto" />
          <Skeleton className="h-3 w-16 ml-auto" />
        </div>
      </div>
    </CardContent>
  </Card>
);

export const ListSkeleton = ({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) => (
  <div className={cn("space-y-2", className)}>
    {Array.from({ length: rows }).map((_, i) => (
      <ListRowSkeleton key={i} />
    ))}
  </div>
);

// ---------- JOB / DISPATCH CARD ----------
export const JobCardSkeleton = () => (
  <Card>
    <CardContent className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-36" />
        </div>
      </div>
      <Skeleton className="h-11 w-full rounded-md" />
    </CardContent>
  </Card>
);

export const JobCardListSkeleton = ({ rows = 3 }: { rows?: number }) => (
  <div className="grid gap-3">
    {Array.from({ length: rows }).map((_, i) => (
      <JobCardSkeleton key={i} />
    ))}
  </div>
);

// ---------- DASHBOARD KPI ----------
export const KpiSkeleton = () => (
  <Card>
    <CardContent className="p-4 space-y-2">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-4 rounded" />
      </div>
      <Skeleton className="h-7 w-24" />
      <Skeleton className="h-3 w-16" />
    </CardContent>
  </Card>
);

export const KpiGridSkeleton = ({ count = 4 }: { count?: number }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
    {Array.from({ length: count }).map((_, i) => (
      <KpiSkeleton key={i} />
    ))}
  </div>
);

export const WidgetSkeleton = ({ className }: { className?: string }) => (
  <Card className={className}>
    <CardContent className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
        <Skeleton className="h-3 w-3/6" />
      </div>
    </CardContent>
  </Card>
);

// ---------- DETAIL PAGES (Customer / Job / Invoice) ----------
export const DetailHeaderSkeleton = () => (
  <div className="flex items-start justify-between gap-4 flex-wrap">
    <div className="flex items-center gap-3">
      <Skeleton className="h-12 w-12 rounded-full" />
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
    <div className="flex gap-2">
      <Skeleton className="h-9 w-24 rounded-md" />
      <Skeleton className="h-9 w-24 rounded-md" />
    </div>
  </div>
);

export const DetailPageSkeleton = () => (
  <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
    <Skeleton className="h-4 w-24" />
    <DetailHeaderSkeleton />
    <div className="grid gap-4 md:grid-cols-3">
      <KpiSkeleton />
      <KpiSkeleton />
      <KpiSkeleton />
    </div>
    <div className="flex gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-24 rounded-md" />
      ))}
    </div>
    <WidgetSkeleton />
    <ListSkeleton rows={4} />
  </div>
);

// Job Detail — matches sticky action bar + timeline layout
export const JobDetailSkeleton = () => (
  <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto pb-24">
    <Skeleton className="h-4 w-24" />
    <Card>
      <CardContent className="p-4 md:p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-64" />
        <div className="grid grid-cols-2 gap-3 pt-2">
          <Skeleton className="h-16 rounded-md" />
          <Skeleton className="h-16 rounded-md" />
        </div>
      </CardContent>
    </Card>
    <Card>
      <CardContent className="p-4 md:p-5 space-y-3">
        <Skeleton className="h-4 w-24" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-2 items-start">
            <Skeleton className="h-2 w-2 rounded-full mt-2" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  </div>
);

// ---------- TAB CONTENT ----------
export const TabContentSkeleton = ({ rows = 4 }: { rows?: number }) => (
  <div className="p-4 space-y-3">
    <ListSkeleton rows={rows} />
  </div>
);

// ---------- TABLE ----------
export const TableSkeleton = ({
  rows = 6,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) => (
  <div className="w-full space-y-2">
    <div className="grid gap-3 px-2 py-2 border-b" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-3/4" />
      ))}
    </div>
    {Array.from({ length: rows }).map((_, r) => (
      <div
        key={r}
        className="grid gap-3 px-2 py-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: cols }).map((_, c) => (
          <Skeleton key={c} className="h-4 w-full" />
        ))}
      </div>
    ))}
  </div>
);
