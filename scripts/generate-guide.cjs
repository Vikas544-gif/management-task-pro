/* One-off generator: Management Task Pro — Complete User Guide (PDF).
   English headings/feature names + Hinglish explanation. Pure pdfkit (no browser). */
const path = require("path");
const fs = require("fs");
const PDFDocument = require(
  require.resolve("pdfkit", { paths: [__dirname, path.join(__dirname, "..")] })
);

const OUT_DIR = path.join(__dirname, "..", "docs");
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT = path.join(OUT_DIR, "Management-Task-Pro-User-Guide.pdf");

const INDIGO = "#4f46e5";
const INDIGO_D = "#3730a3";
const INK = "#111827";
const GRAY = "#374151";
const LGRAY = "#6b7280";
const BG = "#eef2ff";
const RULE = "#c7d2fe";

const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
const stream = fs.createWriteStream(OUT);
doc.pipe(stream);

const M = doc.page.margins.left;
const CW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottom = () => doc.page.height - doc.page.margins.bottom;

function ensure(h) {
  if (doc.y + h > bottom()) doc.addPage();
}
function h1(t) {
  ensure(60);
  doc.moveDown(0.7);
  doc.fillColor(INDIGO).font("Helvetica-Bold").fontSize(15).text(t, M, doc.y);
  const y = doc.y + 3;
  doc.save().moveTo(M, y).lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(1).strokeColor(RULE).stroke().restore();
  doc.moveDown(0.55);
  doc.fillColor(INK);
}
function h2(t) {
  ensure(34);
  doc.moveDown(0.35);
  doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(11.5).text(t);
  doc.moveDown(0.12);
  doc.fillColor(INK);
}
function p(t) {
  ensure(20);
  doc.font("Helvetica").fontSize(10).fillColor(GRAY).text(t, { lineGap: 2.5 });
  doc.moveDown(0.2);
}
function bullet(t) {
  ensure(16);
  doc.font("Helvetica").fontSize(10).fillColor(GRAY)
    .text("•  " + t, M + 8, doc.y, { width: CW - 8, lineGap: 2 });
}
function step(n, t) {
  ensure(18);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(INDIGO_D)
    .text(n + ".  ", M + 6, doc.y, { continued: true });
  doc.font("Helvetica").fillColor(GRAY).text(t, { lineGap: 2 });
  doc.moveDown(0.05);
}
function callout(title, lines) {
  const pad = 10, tw = CW - pad * 2;
  doc.font("Helvetica-Bold").fontSize(9.5);
  let h = pad * 2 + doc.heightOfString(title, { width: tw }) + 5;
  doc.font("Helvetica").fontSize(9.5);
  for (const l of lines) h += doc.heightOfString("•  " + l, { width: tw - 6 }) + 3;
  ensure(h + 10);
  const x = M, y = doc.y;
  doc.save().roundedRect(x, y, CW, h, 6).fill(BG).restore();
  doc.fillColor(INDIGO_D).font("Helvetica-Bold").fontSize(9.5).text(title, x + pad, y + pad, { width: tw });
  let cy = doc.y + 5;
  doc.fillColor("#312e81").font("Helvetica").fontSize(9.5);
  for (const l of lines) {
    doc.text("•  " + l, x + pad + 4, cy, { width: tw - 4, lineGap: 1.5 });
    cy = doc.y + 3;
  }
  doc.y = y + h + 9;
  doc.fillColor(INK);
}
function table(rows) {
  const c1 = CW * 0.34, c2 = CW - c1, pad = 7;
  rows.forEach((r, i) => {
    const head = i === 0;
    doc.font(head ? "Helvetica-Bold" : "Helvetica").fontSize(9.5);
    const h = Math.max(
      doc.heightOfString(r[0], { width: c1 - pad * 2 }),
      doc.heightOfString(r[1], { width: c2 - pad * 2 })
    ) + pad * 2;
    ensure(h);
    const x = M, y = doc.y;
    if (head) doc.save().rect(x, y, CW, h).fill(INDIGO).restore();
    else if (i % 2 === 0) doc.save().rect(x, y, CW, h).fill("#f5f6ff").restore();
    doc.save().rect(x, y, CW, h).lineWidth(0.5).strokeColor("#dbe0ff").stroke().restore();
    doc.save().moveTo(x + c1, y).lineTo(x + c1, y + h).lineWidth(0.5).strokeColor("#dbe0ff").stroke().restore();
    doc.fillColor(head ? "#ffffff" : INK).font(head ? "Helvetica-Bold" : "Helvetica-Bold").fontSize(9.5)
      .text(r[0], x + pad, y + pad, { width: c1 - pad * 2 });
    doc.fillColor(head ? "#ffffff" : GRAY).font(head ? "Helvetica-Bold" : "Helvetica").fontSize(9.5)
      .text(r[1], x + c1 + pad, y + pad, { width: c2 - pad * 2 });
    doc.y = y + h;
  });
  doc.moveDown(0.4);
  doc.fillColor(INK);
}

/* ---------- COVER ---------- */
doc.rect(0, 0, doc.page.width, 210).fill(INDIGO);
doc.roundedRect(M, 55, 64, 64, 14).fill("#ffffff");
doc.fillColor(INDIGO).font("Helvetica-Bold").fontSize(20).text("MTP", M, 78, { width: 64, align: "center" });
doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(27).text("Management Task Pro", M + 80, 62, { width: CW - 80 });
doc.font("Helvetica").fontSize(14).fillColor("#e0e7ff").text("Complete User Guide", M + 80, 98);
doc.fontSize(10).fillColor("#c7d2fe")
  .text("Task add karna  •  Reminder set karna  •  Kisko kya dikhega  •  Sab kaise kaam karta hai", M + 80, 122, { width: CW - 80 });
doc.fontSize(9).fillColor("#c7d2fe").text("June 2026  |  Internal staff guide", M + 80, 150);

doc.y = 240;
doc.fillColor(INK);
p("Yeh guide poore app ko simple Hinglish me samjhati hai. Har section batata hai cheez kahan hai, kaun use kar sakta hai, aur kaise kaam karti hai. App ke saare buttons/labels English me hain — un naamo ko jaisa hai waisa hi rakha gaya hai taaki screen pe dhoondhna aasaan rahe.");
callout("Sabse zaroori 3 baatein", [
  "Sales Agents ka koi login nahi hota — woh sirf Team page ke Agent Tracking me hote hain, aur unke numbers unka Team Leader bharta hai.",
  "Har banda apne se neeche waale (apni team) ka data dekh sakta hai; upar/doosri team ka nahi. Boss aur MIS sab dekh sakte hain.",
  "Notification / laptop popup ek hi baar aata hai — login ya refresh pe dobara nahi.",
]);

/* ---------- ROLES ---------- */
doc.addPage();
h1("1. Roles — Kaun Kaun Hai");
p("App me har user ka ek role hota hai. Role hi decide karta hai ki use kya dikhega aur woh kya kar sakta hai.");
table([
  ["Role", "Kya hai / kya kar sakta hai"],
  ["Boss", "Sabse upar (Arvind). Saare centers, saare tasks, sab kuch dekh aur kar sakta hai."],
  ["MIS / Director", "Boss ki tarah lagbhag sab dekh sakta hai (saare outer centers) — Head Office ke andar ki kuch cheezein chhod kar. Reporting/monitoring ke liye."],
  ["Center Head", "Apne center ka head. Apne center ki team, attendance, tasks dekh/manage kar sakta hai."],
  ["Team Leader (TL)", "Apni team ka leader. Tasks assign karta hai aur apne Sales Agents ke daily numbers Agent Tracking me bharta hai."],
  ["Staff (Executive etc.)", "Normal member. Apne aur apni (agar ho to) team ke tasks dekhta hai. Tracking/monitor jaise pages nahi dikhte."],
  ["Sales Agent", "Sirf Agent Tracking table me ek row. Na login, na koi task — bas TL inke numbers bharta hai."],
]);
callout("Login kiska hota hai?", [
  "Sirf jin users ka username + password set hai unka login hota hai (Boss, MIS, Center Heads, Team Leaders, aur kuch staff).",
  "Sales Agents ka login NAHI hota — woh app me kabhi sign-in nahi karte.",
]);

h2("Accounts Team, IT Team, HR (Departments)");
p("Accounts, IT aur HR jaise departments app me 'staff / worker' ki tarah hote hain (jab tak woh banda khud TL ya Center Head na ho). Inka access ek normal member jaisa hota hai — na inko admin pages dikhte hain, na hi koi extra power milti hai. Department sirf color/grouping aur reports ke liye use hota hai, isse koi extra menu unlock nahi hota.");
table([
  ["Cheez", "Accounts / IT / HR staff ko"],
  ["Dashboard", "Dikhta hai (apna data)"],
  ["My Tasks", "Dikhta hai (apne tasks)"],
  ["Daily / Weekly / Monthly Tasks", "Dikhta hai"],
  ["Assign Task", "Dikhta hai (doosro ko task de sakte hain)"],
  ["Team (Cards view)", "Dikhta hai"],
  ["Reports", "Dikhta hai (sirf apna data)"],
  ["Email Settings", "Dikhta hai"],
  ["All Tasks", "NAHI (jab tak apni team / reports na ho)"],
  ["Agent Tracking", "NAHI"],
  ["Attendance", "NAHI"],
  ["EOD Report", "NAHI"],
  ["Assignment Monitor", "NAHI"],
  ["Credentials & Hierarchy", "NAHI"],
]);
callout("Dhyan rakhein", [
  "Accounts/IT/HR — teeno ko same cheezein dikhti hain kyunki teeno 'staff' level hain.",
  "Agar Accounts/IT ka koi banda saath me Team Leader ya Center Head bhi hai, to usko us role ke hisaab se extra pages (jaise EOD, Attendance, Agent Tracking) bhi dikhne lagenge.",
  "Sirf department badalne se koi nayi power nahi milti — power role aur hierarchy (kaun kiske neeche hai) se aati hai.",
]);

/* ---------- LOGIN + NAV ---------- */
h1("2. Login & Sidebar (Menu)");
h2("Login");
step(1, "App kholo — login screen aayega.");
step(2, "Apna Username aur Password daalo, phir 'Sign In' dabao.");
step(3, "Andar aate hi left side me menu (sidebar) dikhega.");
p("");
h2("Sidebar me kya-kya hai");
p("Menu me sirf wahi cheezein dikhti hain jinki tumhe permission hai. Niche poori list hai aur kis role ko dikhti hai:");
table([
  ["Menu item", "Kisko dikhta hai"],
  ["Dashboard", "Sabko — apne data ka overview."],
  ["My Tasks", "Sabko — sirf apne tasks."],
  ["All Tasks", "Boss, MIS, aur jinki apni team hai (jinke neeche log report karte hain)."],
  ["Daily / Weekly / Monthly Tasks", "Sabko — type ke hisaab se tasks."],
  ["Assign Task", "Sabko — naya task dene ke liye."],
  ["Team", "Sabko (Cards view). Agent Tracking sirf Boss/MIS/Center Head/TL ko."],
  ["Attendance", "Boss, MIS, Center Head."],
  ["EOD Report", "Boss, MIS, Center Head, Team Leader."],
  ["Credentials & Hierarchy", "Boss, MIS, Center Head."],
  ["Assignment Monitor", "Boss, MIS, Center Head."],
  ["Reports", "Sabko — apne dayre (hierarchy) ke hisaab se."],
  ["Email Settings", "Sabko."],
]);

/* ---------- ADD TASK ---------- */
h1("3. Task Kaise Add Kare (Assign Task)");
p("Naya task dene ke liye sidebar me 'Assign Task' pe jao.");
step(1, "'Assign Task' kholo.");
step(2, "Task ka Title aur (chaaho to) Description likho.");
step(3, "'Assign to' me us person ko chuno jise task dena hai. (List me sirf woh log aate hain jinka login hota hai — Sales Agents yahan nahi aate.)");
step(4, "Priority chuno (jaise Low / Medium / High) aur Due Date set karo. Chaaho to Due Time bhi.");
step(5, "Task Type chuno: One-time, Daily, Weekly ya Monthly (recurring ke liye).");
step(6, "Agar email bhejna hai to 'Send email' option ON rakho — assignee ko mail chala jaayega.");
step(7, "Save/Assign dabao. Bas — task ban gaya.");
callout("Jaise hi task assign hota hai", [
  "Jise task mila usko turant ek in-app notification (bell) milti hai, aur uske screen pe ek popup aata hai jisme woh status + remark set kar sakta hai.",
  "Agar email option ON tha to usko email bhi jaata hai.",
  "Apne aap ko diya task (khud ka) koi notification nahi banata.",
]);
h2("Recurring (baar-baar aane waale) tasks");
p("Daily / Weekly / Monthly task ek baar banao — app khud har naye din/hafte/mahine uski nayi copy bana deta hai. Tumhe dobara banane ki zaroorat nahi.");

/* ---------- TASKS LIST + LOCK ---------- */
h1("4. Tasks Dekhna & Update Karna");
bullet("My Tasks — sirf tumhare apne tasks. Yahan se status (Pending / In-progress / Done) badlo aur remark likho.");
bullet("All Tasks / Daily / Weekly / Monthly — tasks ko type ke hisaab se dekho. Past aur future dono dates dikhti hain.");
bullet("'My Tasks' toggle se sirf apne tasks filter kar sakte ho.");
doc.moveDown(0.2);
callout("Daily task lock (zaroori rule)", [
  "Jab ek daily task ka din nikal jaata hai, woh row read-only (locked) ho jaati hai — taaki purane din ke records change na ho sakein.",
  "Sirf Boss, MIS, aur us center ka Center Head hi locked purane daily tasks ko badal sakte hain.",
]);

/* ---------- NOTIFICATIONS ---------- */
h1("5. Notifications (Bell)");
p("Upar bell icon par tumhari notifications aati hain. Number badge batata hai kitni unread hain.");
bullet("Naya task mile to: bell notification + screen popup (status + remark set karne ke liye).");
bullet("Tumhara diya task koi 'Done' kare to: tumhe (task dene waale ko) notification milti hai.");
bullet("Choti notifications corner me toast ki tarah aati hain aur thodi der me apne aap hat jaati hain.");
bullet("Bell kholo — 'Mark all read' se sabko padha hua mark karo, ya 'Clear all' se hata do. Ek-ek ko bhi padha/hata sakte ho.");
callout("Fix kiya gaya (June 2026)", [
  "Pehle login/refresh karne pe purani (already dekhi/clear ki hui) notification dobara pop ho jaati thi — yeh ab theek hai.",
  "Ab popup sirf sach me NAYI notification aane par hi aata hai, login pe purana replay nahi hota.",
]);

/* ---------- REMINDERS ---------- */
h1("6. Laptop Popup & Reminder Kaise Set Kare");
p("Laptop popup ek desktop notification hai jo tumhari screen par aati hai — chahe app tab open na bhi ho. Pehle ise ON karna padta hai.");
h2("Step 1 — Laptop popup ON karo");
step(1, "Sidebar/settings me 'laptop popup' toggle ON karo.");
step(2, "Browser permission maange to 'Allow' karo (ek hi baar).");
p("Yeh setting har user ke liye alag hai — tumhara ON karna sirf tumhare liye kaam karega.");
h2("Step 2 — Reminder set karo (do tarah ke)");
bullet("Due-time reminder: agar task ka due time set hai aur woh AAJ due hai, to time aate hi popup aa jaata hai — 'Task is due now!'");
bullet("Personal reminder: tum khud apne kisi bhi task par apni marzi ka date + time set kar sakte ho. Repeat bhi (jaise '3 baar, har 10 minute'). Time aane par popup — 'Your reminder!'");
callout("Reminder ke rules", [
  "Har reminder sirf EK baar bajta hai — login/refresh pe dobara nahi.",
  "Repeat count baad me badlo to jo occurrence pehle baj chuki hai woh dobara nahi bajegi.",
  "Done ho chuke task par koi reminder nahi aata; purane (beete din ke) reminders skip ho jaate hain.",
  "Popup tabhi aayega jab toggle ON ho + browser permission di ho.",
]);

/* ---------- TEAM + TRACKING ---------- */
h1("7. Team Page & Agent Tracking");
p("Team page par do view hote hain:");
bullet("Cards view — har member ka card (sabko dikhta hai).");
bullet("Agent Tracking — Excel jaisi grid jisme Sales Agents ke daily numbers hote hain.");
doc.moveDown(0.2);
callout("Agent Tracking kaun dekh sakta hai", [
  "Sirf Boss, MIS, Center Head, aur Team Leader.",
  "Normal staff (jaise Accounts Executive) ko Agent Tracking ka toggle dikhta hi nahi — unhe sirf Cards milte hain, aur agent ke naam kahin nahi dikhte.",
]);
h2("Agent Tracking me kya hota hai");
bullet("Har Sales Agent ki ek row — uske daily metrics (numbers) jo uska TL bharta hai.");
bullet("Tenure (kitne saal kaam kiya) DOJ se apne aap nikalta hai — 'X Year Y Months Z Days'.");
bullet("TL Name ek dropdown hai (kaun report karta hai — reportsTo).");
bullet("Status: Active / Inactive. Filter me default 'Active' dikhta hai.");
bullet("'+ Add Agent' se naya agent add hota hai (reportsTo dena zaroori), aur har row me 'X' (remove) se hata sakte ho.");

/* ---------- ATTENDANCE + EOD ---------- */
h1("8. Attendance & EOD Report");
p("Yeh Boss / MIS / Center Head ke liye hai (EOD me Team Leader bhi).");
bullet("Attendance roster me sirf Team Leaders hote hain. (Sales Agents ki ginti Team page ke Agent Tracking me hoti hai, yahan nahi.)");
bullet("Har din present / half-day mark karte ho; shrinkage apne aap calculate hota hai.");
bullet("EOD Report = din ke end ka summary (attendance us se nikalta hai).");

/* ---------- MONITOR + CREDS ---------- */
h1("9. Assignment Monitor & Credentials");
h2("Assignment Monitor");
p("Boss / MIS / Center Head ke liye. Yeh dikhata hai kis-kisne kisko task diya — kaun pichhe chal raha hai, kiska kaam pending hai, etc. Apne dayre (center/team) ke hisaab se scope hota hai.");
h2("Credentials & Hierarchy");
p("Boss / MIS / Center Head ke liye. Yahan org-chart (kaun kiske neeche) aur logins (username) dikhte hain — naye log add karne aur details theek karne ke liye.");

/* ---------- DASHBOARD + REPORTS ---------- */
h1("10. Dashboard, Reports & Center Filter");
bullet("Dashboard — tumhare data ka overview (graphs, counts). Ek date filter hota hai jisse period chun sakte ho.");
bullet("Reports — performance/summary, tumhare hierarchy (apni team) ke hisaab se.");
bullet("Center filter — sirf Boss ko dikhta hai (Dashboard/Team/Tasks/Monitor par). Isse ek center chun ke uska data dekh sakte ho. Agar sirf ek center ho to yeh chhup jaata hai.");
doc.moveDown(0.3);

/* ---------- WHO SEES WHAT SUMMARY ---------- */
h1("11. Quick Summary — Kisko Kya Dikhta Hai");
table([
  ["Feature", "Boss / MIS / Center Head / TL / Staff"],
  ["Dashboard, My Tasks, Assign, Reports", "Sabko"],
  ["All Tasks", "Boss, MIS, aur jinki apni team hai"],
  ["Agent Tracking (Team)", "Boss, MIS, Center Head, TL"],
  ["Attendance", "Boss, MIS, Center Head"],
  ["EOD Report", "Boss, MIS, Center Head, TL"],
  ["Assignment Monitor", "Boss, MIS, Center Head"],
  ["Credentials & Hierarchy", "Boss, MIS, Center Head"],
  ["Center filter", "Sirf Boss"],
  ["Edit locked (past) daily task", "Boss, MIS, us center ka Center Head"],
]);
callout("Yaad rakhne ki baat", [
  "Har koi apne se neeche (apni team) ka data dekhta hai — doosri team/upar ka nahi. Boss aur MIS sab dekhte hain.",
  "Sales Agents app me login nahi karte — woh sirf Agent Tracking me numbers ke roop me hote hain.",
]);

/* ---------- FOOTER PAGE NUMBERS ---------- */
const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(range.start + i);
  if (i === 0) continue; // skip cover
  doc.page.margins.bottom = 0; // prevent footer text from spawning new pages
  const fy = doc.page.height - 35;
  doc.font("Helvetica").fontSize(8).fillColor(LGRAY)
    .text("Management Task Pro — User Guide", M, fy, { width: CW / 2, align: "left", lineBreak: false });
  doc.text("Page " + (i + 1) + " / " + range.count, M + CW / 2, fy, { width: CW / 2, align: "right", lineBreak: false });
}

doc.end();
stream.on("finish", () => console.log("WROTE:" + OUT));
