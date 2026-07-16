import { Router } from "express";
import { db } from "@workspace/db";
import { agentMetricsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { UpsertAgentMetricBody } from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  const { date, agentId } = req.query;
  const rows = await db.select().from(agentMetricsTable).orderBy(desc(agentMetricsTable.date));
  let filtered = rows;
  if (date) filtered = filtered.filter((r) => r.date === (date as string));
  if (agentId) filtered = filtered.filter((r) => r.agentId === Number(agentId));
  res.json(
    filtered.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
  );
});

router.post("/", async (req, res) => {
  const parsed = UpsertAgentMetricBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid agent metric data", details: parsed.error.issues });
    return;
  }
  const { agentId, date, dc, prospectCount, salesFd, salesMtd, target, last3mAvg, last6mAvg, remark, updatedBy } = parsed.data;
  const values = {
    agentId,
    date,
    dc: dc ?? null,
    prospectCount: prospectCount ?? null,
    salesFd: salesFd ?? null,
    salesMtd: salesMtd ?? null,
    target: target ?? null,
    last3mAvg: last3mAvg ?? null,
    last6mAvg: last6mAvg ?? null,
    remark: remark ?? null,
    updatedBy: updatedBy ?? null,
  };
  const [row] = await db
    .insert(agentMetricsTable)
    .values(values)
    .onConflictDoUpdate({
      target: [agentMetricsTable.agentId, agentMetricsTable.date],
      set: {
        dc: values.dc,
        prospectCount: values.prospectCount,
        salesFd: values.salesFd,
        salesMtd: values.salesMtd,
        target: values.target,
        last3mAvg: values.last3mAvg,
        last6mAvg: values.last6mAvg,
        remark: values.remark,
        updatedBy: values.updatedBy,
        updatedAt: new Date(),
      },
    })
    .returning();
  res.json({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
});

export default router;
