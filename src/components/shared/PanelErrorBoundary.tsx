import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Props {
  children: ReactNode;
  panelName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class PanelErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const panel = this.props.panelName || "Panel";
    console.error(`[${panel}] Error:`, error.message, errorInfo.componentStack);
    toast({
      title: `${panel} encountered an error`,
      description: error.message?.substring(0, 120) || "Something went wrong",
      variant: "destructive",
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-6 rounded-lg border border-destructive/20 bg-destructive/5 min-h-[120px] gap-3">
          <AlertTriangle className="h-6 w-6 text-destructive/70" />
          <p className="text-sm font-medium text-foreground">
            {this.props.panelName || "This section"} failed to load
          </p>
          <p className="text-xs text-muted-foreground text-center max-w-[280px]">
            {this.state.error?.message?.substring(0, 100) || "An unexpected error occurred."}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default PanelErrorBoundary;
