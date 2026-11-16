// Run with the local backend, storage and photo server up (see mobile-web-ui-inspection notes); needs DATABASE_URL pointing at the scratch database.
// Exercises the reviewer photo-tool endpoints against the local backend (scratch DB only).
const API = "http://127.0.0.1:4000/api/v1";
const ID = "601abb29-8047-4982-aa23-4e9dc3ba2dac"; // VIC-261117 Public Assets
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "  ok  " : " FAIL ", m); };
const login = await (await fetch(API + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@test.com", password: "Admin123456!x" }) })).json();
const H = { authorization: `Bearer ${login.accessToken}`, "content-type": "application/json" };
const call = async (method, path, body) => { const r = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const get = async () => (await call("GET", `/web/inspections/${ID}`)).body.inspection;
const media = (u) => /\/media\/([0-9a-f-]{36})/.exec(u)[1];
const dims = async (u) => { const r = await fetch(API.replace("/api/v1", "") + u.replace(/^https?:\/\/[^/]+/, "") .replace(/\?.*/, ""), { headers: H }); return r.status; };

let ins = await get();
let sec = ins.sections.find((s) => s.key === "description");
await call("PATCH", `/web/sections/${sec.id}`, { reviewStatus: "pending" });
sec = (await get()).sections.find((s) => s.key === "description");
const url0 = sec.answers.siteAssetsOverview[0];
console.log("section", sec.id, "first overview photo", url0);

// edit: rotate + crop
let r = await call("POST", `/web/sections/${sec.id}/photos/edit`, { url: url0, edit: { rotate: 90, crop: { x: 0.1, y: 0.1, w: 0.6, h: 0.6 } } });
ok(r.status === 200 && r.body.url, "edit returns 200 and a new url (" + r.status + ")");
const url1 = r.body.url;
ok(media(url1) !== media(url0), "the edited copy is a new photo");
sec = (await get()).sections.find((s) => s.key === "description");
ok(sec.answers.siteAssetsOverview[0].includes(media(url1)) && !JSON.stringify(sec.answers).includes(media(url0)), "answers now point at the copy everywhere");
ok(sec.answers.siteAssetsOverview.length === 8, "the other 7 photos are untouched");

// editing again starts from the original (no compounding): rotate 180 only
r = await call("POST", `/web/sections/${sec.id}/photos/edit`, { url: sec.answers.siteAssetsOverview[0], edit: { rotate: 180 } });
ok(r.status === 200, "a second edit works");
const url2 = r.body.url;
const { PrismaClient } = await import("file:///C:/Users/ANUKA/Desktop/Inspection%20app/acespect-backend/node_modules/@prisma/client/index.js");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const row2 = await prisma.photo.findUnique({ where: { id: media(url2) } });
ok(row2.editedFromId === media(url0), "the second copy points at the ORIGINAL, not at the first copy");

// revert
r = await call("POST", `/web/sections/${sec.id}/photos/revert`, { url: url2 });
ok(r.status === 200, "revert returns 200");
sec = (await get()).sections.find((s) => s.key === "description");
ok(sec.answers.siteAssetsOverview[0].includes(media(url0)), "revert puts the original back");
r = await call("POST", `/web/sections/${sec.id}/photos/revert`, { url: url0 });
ok(r.status === 409, "reverting a photo that was never edited is refused (" + r.status + ")");

// delete: an inspector's photo is refused
r = await call("POST", `/web/sections/${sec.id}/photos/delete`, { url: url0 });
ok(r.status === 409 && r.body.error.code === "NOT_REVIEWER_PHOTO", "the inspector's photo cannot be deleted outright");

// a reviewer-added photo can be deleted
const form = new FormData();
form.append("photo", new File([await (await fetch("http://127.0.0.1:8099/TC_00950.JPG")).blob()], "x.jpg", { type: "image/jpeg" }));
form.append("inspectionId", ID); form.append("sectionKey", "description");
const up = await (await fetch(API + "/inspections/photos", { method: "POST", headers: { authorization: H.authorization }, body: form })).json();
ok(!!up.url, "the reviewer uploads a photo");
sec = (await get()).sections.find((s) => s.key === "description");
r = await call("PATCH", `/web/sections/${sec.id}`, { photos: [...sec.photos, up.url] });
r = await call("POST", `/web/sections/${sec.id}/photos/delete`, { url: up.url });
ok(r.status === 200, "a reviewer-added photo can be deleted (" + r.status + ")");
sec = (await get()).sections.find((s) => s.key === "description");
ok(!JSON.stringify(sec).includes(media(up.url)), "it is gone from the section");

// print size
r = await call("PATCH", `/web/sections/${sec.id}`, { photoMeta: { [media(url0)]: { size: "large" } } });
ok(r.status === 200 && r.body.section.photoMeta[media(url0)].size === "large", "print size is saved");
r = await call("PATCH", `/web/sections/${sec.id}`, { photoMeta: { [media(url0)]: { size: "huge" } } });
ok(r.status === 400, "a size that does not exist is refused");

// approved => locked
await call("PATCH", `/web/sections/${sec.id}`, { reviewStatus: "approved" });
r = await call("POST", `/web/sections/${sec.id}/photos/edit`, { url: url0, edit: { rotate: 90 } });
ok(r.status === 409 && r.body.error.code === "SECTION_APPROVED", "edit is refused once approved");
r = await call("PATCH", `/web/sections/${sec.id}`, { excludedPhotoUrls: [url0] });
ok(r.status === 409, "leaving a photo out is refused once approved");
r = await call("PATCH", `/web/sections/${sec.id}`, { photoMeta: {} });
ok(r.status === 409, "print size is refused once approved");
r = await call("PATCH", `/web/sections/${sec.id}`, { reviewStatus: "pending", excludedPhotoUrls: [url0] });
ok(r.status === 200, "reopening the section (in the same request) unlocks it");
await call("PATCH", `/web/sections/${sec.id}`, { excludedPhotoUrls: [], photoMeta: {} });
await call("PATCH", `/web/sections/${sec.id}`, { reviewStatus: "approved" });
// optimise: 1024 x 768, under 200 KB
await call("PATCH", `/web/sections/${sec.id}`, { reviewStatus: "pending" });
r = await call("POST", `/web/inspections/${ID}/photos/optimize`, { sectionId: sec.id });
ok(r.status === 200 && r.body.checked > 0, "optimise runs on a section (" + r.status + ", checked " + r.body?.checked + ")");
console.log("   ", JSON.stringify(r.body));
sec = (await get()).sections.find((s) => s.key === "description");
const mediaLinks = [...new Set(JSON.stringify([sec.answers, sec.photos]).match(/\/api\/v1\/media\/[0-9a-f-]{36}[^"]*/g))];
let tooBig = 0, tooWide = 0;
const sharp = (await import("sharp")).default;
for (const m of mediaLinks) {
  const f = await fetch("http://127.0.0.1:4000" + m, { headers: H });
  const b = Buffer.from(await f.arrayBuffer());
  const meta = await sharp(b).metadata();
  if (b.length > 200 * 1024) tooBig++;
  if (meta.width > 1024 || meta.height > 768) tooWide++;
}
ok(mediaLinks.length > 0 && tooBig === 0 && tooWide === 0, `every photo of the section is within 1024 x 768 and 200 KB (${mediaLinks.length} photos, ${tooBig} too big, ${tooWide} too large)`);
r = await call("POST", `/web/inspections/${ID}/photos/optimize`, { sectionId: sec.id });
ok(r.status === 200 && r.body.optimized === 0, "running it again changes nothing");
await call("PATCH", `/web/sections/${sec.id}`, { reviewStatus: "approved" });
r = await call("POST", `/web/inspections/${ID}/photos/optimize`, { sectionId: sec.id });
ok(r.status === 200 && r.body.optimized === 0 && r.body.lockedSections.length === 1, "an approved section is skipped");
console.log(`\n${pass} passed, ${fail} failed`);
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
