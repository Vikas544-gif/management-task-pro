// The compliance date helpers now live in the shared `@workspace/compliance-dates`
// lib so the server-side compliance task generator and this client UI parse the
// same human due-date rules from one source of truth. Re-exported here to keep
// the existing `@/lib/complianceDates` import path stable.
export * from "@workspace/compliance-dates";
