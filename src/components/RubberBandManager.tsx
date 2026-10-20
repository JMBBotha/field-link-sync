import { useEffect } from "react";
import { installRubberBand } from "@/lib/rubberBand";
/** Mount once: soft end-of-list bounce for opted-in scroll containers (see lib/rubberBand). */
const RubberBandManager = () => { useEffect(() => installRubberBand(), []); return null; };
export default RubberBandManager;
