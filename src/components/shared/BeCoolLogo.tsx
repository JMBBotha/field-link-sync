import { Snowflake } from "lucide-react";

const BeCoolLogo = () => (
  <div className="flex items-center gap-2">
    <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
      <Snowflake className="h-6 w-6 text-primary-foreground" />
    </div>
    <div>
      <span className="text-lg font-black tracking-tight text-foreground">0800</span>
      <span className="text-lg font-black tracking-tight text-primary">BeCool</span>
    </div>
  </div>
);

export default BeCoolLogo;
