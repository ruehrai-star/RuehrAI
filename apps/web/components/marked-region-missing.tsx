"use client";

import Link from "next/link";
import {
  ANALYSIS_FAILURE_COPY,
  CHOOSE_TARGET_REGION_HREF,
  isMarkedTargetRegionMissingCopy,
  markedTargetRegionMissingMessage,
} from "@/lib/analysis/failure";

export function MarkedRegionMissingNotice({ message }: { message?: string | null }) {
  const text = isMarkedTargetRegionMissingCopy(message)
    ? message
    : markedTargetRegionMissingMessage();
  return (
    <div className="treffer-empty">
      <p className="message message-error" role="alert">
        {text}
      </p>
      <div className="auth-actions">
        <Link href={CHOOSE_TARGET_REGION_HREF} className="button">
          {ANALYSIS_FAILURE_COPY.chooseTargetRegion}
        </Link>
      </div>
    </div>
  );
}
