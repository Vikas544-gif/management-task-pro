import { Router } from "express";
import { db } from "@workspace/db";
import { categoriesTable } from "@workspace/db";
import { CreateCategoryBody } from "@workspace/api-zod";
import { eq, sql } from "drizzle-orm";
import { HEAD_OFFICE, isBoss, isAllCentersViewer } from "../lib/scope";

const router = Router();

// Categories are center-scoped: each center (Head Office included) sees and
// manages only its own list. Boss/MIS/Director see every center's categories
// so they can assign and manage across centers.
const viewerCenter = (u: { center: string | null }) => u.center ?? HEAD_OFFICE;
const seesAllCategories = (u: { department: string; role: string }) =>
  isBoss(u) || isAllCentersViewer(u);

router.get("/", async (req, res) => {
  const me = req.user!;
  const cats = seesAllCategories(me)
    ? await db.select().from(categoriesTable)
    : await db.select().from(categoriesTable).where(eq(categoriesTable.center, viewerCenter(me)));
  res.json(cats);
});

router.post("/", async (req, res) => {
  const me = req.user!;
  const parsed = CreateCategoryBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  // The category always belongs to the creator's own center — the client
  // cannot pick a center. Duplicate check is case-insensitive per center.
  const center = viewerCenter(me);
  const name = parsed.data.name.trim();
  if (!name) return res.status(400).json({ error: "Invalid input" });
  const [existing] = await db
    .select()
    .from(categoriesTable)
    .where(sql`${categoriesTable.center} = ${center} AND lower(${categoriesTable.name}) = lower(${name})`);
  if (existing) return res.status(409).json({ error: "That category already exists" });
  const [cat] = await db
    .insert(categoriesTable)
    .values({ ...parsed.data, name, center })
    .returning();
  return res.status(201).json(cat);
});

// Remove a category from the center's list. Tasks store their category as a
// plain string (no foreign key), so existing tasks keep their label — this only
// removes the option from the pickers. Users may only remove their own
// center's categories; Boss/MIS/Director may remove any.
router.delete("/:id", async (req, res) => {
  const me = req.user!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  const [cat] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, id));
  if (!cat) return res.status(404).json({ error: "Category not found" });
  if (!seesAllCategories(me) && cat.center !== viewerCenter(me)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const [deleted] = await db.delete(categoriesTable).where(eq(categoriesTable.id, id)).returning();
  return res.json(deleted);
});

export default router;
