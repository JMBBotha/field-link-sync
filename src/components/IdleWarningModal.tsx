import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface IdleWarningModalProps {
  open: boolean;
  secondsLeft: number;
  onStayActive: () => void;
}

const IdleWarningModal = ({ open, secondsLeft, onStayActive }: IdleWarningModalProps) => {
  return (
    <Dialog open={open} onOpenChange={() => onStayActive()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Session Timeout
          </DialogTitle>
          <DialogDescription>
            You've been inactive. You'll be logged out in{" "}
            <span className="font-bold text-foreground">{secondsLeft}s</span>.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onStayActive} className="w-full">
            I'm still here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default IdleWarningModal;
