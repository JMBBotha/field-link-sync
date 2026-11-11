import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const mainButton = { background: "#C2410C", color: "#fff" };

export function NoLoginBadge() {
  return (
    <span
      data-testid="no-login-badge"
      className="shrink-0 whitespace-nowrap rounded border border-[#3D9BE8] bg-sky-50 px-1.5 py-0.5 text-xs font-semibold text-[#0F2A44]"
    >
      No login
    </span>
  );
}

export function AddTechnicianNoInviteDialog({
  open,
  onOpenChange,
  name,
  phone,
  onName,
  onPhone,
  pending,
  duplicates,
  confirmDuplicate,
  onConfirmDuplicate,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  phone: string;
  onName: (value: string) => void;
  onPhone: (value: string) => void;
  pending: boolean;
  duplicates: { id: string; full_name: string }[];
  confirmDuplicate: boolean;
  onConfirmDuplicate: (value: boolean) => void;
  onSubmit: () => void;
}) {
  const blocked = duplicates.length > 0 && !confirmDuplicate;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="add-technician-dialog">
        <div className="h-1.5 w-16 rounded-full" style={{ background: "#3D9BE8" }} />
        <DialogHeader>
          <DialogTitle>Add technician (no invite)</DialogTitle>
          <DialogDescription>
            Adds them by name so you can book and log work. No email is sent, and they cannot sign in yet.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="no-login-name">Name</Label>
            <Input
              id="no-login-name"
              data-testid="no-login-name"
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder="First and last name"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="no-login-phone">Phone <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input
              id="no-login-phone"
              data-testid="no-login-phone"
              value={phone}
              onChange={(e) => onPhone(e.target.value)}
              placeholder="082 000 0000"
              inputMode="tel"
              autoComplete="off"
            />
          </div>
          {duplicates.length > 0 && (
            <div className="space-y-3 rounded-lg border border-border p-3" data-testid="duplicate-name-guard">
              <p className="text-sm">
                Already on this team: {duplicates.map((row) => row.full_name).join(", ")}.
              </p>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Add another person with this name</span>
                <Switch
                  checked={confirmDuplicate}
                  onCheckedChange={onConfirmDuplicate}
                  aria-label="Add another person with this name"
                />
              </label>
            </div>
          )}
          <Button
            type="button"
            className="w-full border-0 text-white hover:opacity-90"
            style={mainButton}
            onClick={onSubmit}
            disabled={!name.trim() || pending || blocked}
            data-testid="add-technician-submit"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Add technician
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SendLoginInviteDialog({
  open,
  onOpenChange,
  personName,
  email,
  onEmail,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personName: string;
  email: string;
  onEmail: (value: string) => void;
  pending: boolean;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="send-login-invite-dialog">
        <div className="h-1.5 w-16 rounded-full" style={{ background: "#3D9BE8" }} />
        <DialogHeader>
          <DialogTitle>Send login invite</DialogTitle>
          <DialogDescription>
            Links this email to {personName || "this technician"}. Visits and earnings stay on this same person. A second account is not created. They stay off job offers until they open the link and sign in.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="login-invite-email">Email</Label>
            <Input
              id="login-invite-email"
              type="email"
              data-testid="login-invite-email"
              value={email}
              onChange={(e) => onEmail(e.target.value)}
              placeholder="name@company.com"
              autoComplete="off"
            />
          </div>
          <Button
            type="button"
            className="w-full border-0 text-white hover:opacity-90"
            style={mainButton}
            disabled={!email.trim() || pending}
            onClick={onSubmit}
            data-testid="send-login-invite-submit"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Send login invite
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
