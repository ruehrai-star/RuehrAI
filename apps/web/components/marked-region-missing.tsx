"use client";

import Link from "next/link";
import {
  ANALYSIS_FAILURE_COPY,
  CHOOSE_TARGET_REGION_HREF,
} from "@/lib/analysis/failure";

export function MarkedRegionMissingNotice() {
  return (
    <div className="treffer-empty">
      <p className="message message-error" role="alert">
        {ANALYSIS_FAILURE_COPY.markedTargetRegionMissing}
      </p>
      <div className="auth-actions">
        <Link href={CHOOSE_TARGET_REGION_HREF} className="button">
          {ANALYSIS_FAILURE_COPY.chooseTargetRegion}
        </Link>
      </div>
    </div>
  );
}
