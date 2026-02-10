import { Badge } from "@/components/ui/badge";
import { CalendarDays, Clock } from "lucide-react";
import { format, isToday, isTomorrow, isAfter, startOfDay } from "date-fns";

interface BookingBadgeProps {
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  status?: string;
  className?: string;
}

const BookingBadge = ({ scheduledDate, scheduledTime, status, className }: BookingBadgeProps) => {
  if (!scheduledDate) return null;

  const date = new Date(scheduledDate);
  const today = isToday(date);
  const tomorrow = isTomorrow(date);
  const upcoming = isAfter(date, startOfDay(new Date()));
  const isInProgress = status === "in_progress";

  if (isInProgress) {
    return (
      <Badge className={`bg-green-600 text-white border-0 text-[10px] font-bold px-2 py-0.5 animate-pulse ${className || ""}`}>
        <Clock className="h-3 w-3 mr-1" />
        IN PROGRESS
      </Badge>
    );
  }

  if (today) {
    return (
      <Badge className={`bg-emerald-500 text-white border-0 text-[10px] font-bold px-2 py-0.5 ${className || ""}`}>
        <CalendarDays className="h-3 w-3 mr-1" />
        BOOKED TODAY{scheduledTime ? ` ${scheduledTime.slice(0, 5)}` : ""}
      </Badge>
    );
  }

  if (tomorrow) {
    return (
      <Badge className={`bg-blue-500 text-white border-0 text-[10px] font-bold px-2 py-0.5 ${className || ""}`}>
        <CalendarDays className="h-3 w-3 mr-1" />
        BOOKED TOMORROW{scheduledTime ? ` ${scheduledTime.slice(0, 5)}` : ""}
      </Badge>
    );
  }

  if (upcoming) {
    return (
      <Badge className={`bg-sky-500 text-white border-0 text-[10px] font-bold px-2 py-0.5 ${className || ""}`}>
        <CalendarDays className="h-3 w-3 mr-1" />
        BOOKED {format(date, "d MMM")}
      </Badge>
    );
  }

  return null;
};

export default BookingBadge;
