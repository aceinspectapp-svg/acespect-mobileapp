// The reviewer's photo panel finds every photo list of a section and moves, reorders and adds photos in the answers.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const G = await server.ssrLoadModule("/src/web/photoToolGroups.ts");
const snapshot = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const fieldsOf = (type, key) => snapshot.find((t) => t.inspectionType === "dilapidation" && t.propertyType === type && t.sectionKey === key).fields;

const p = (n, q = "") => `/api/v1/media/00000000-0000-4000-8000-${String(n).padStart(12, "0")}${q}`;

describe("photo groups of a Public Assets survey", () => {
  const fields = fieldsOf("public_assets", "elevations");
  const answers = {
    parts: [
      {
        partName: "Part A", startEndPhotos: [p(1), p(2)], endPhotos: [p(3)],
        itemsPresent: ["item0"], footpaths_widePhotos: [p(4), p(5)],
        footpaths_damages: [{ location: "outside no. 7", damageType: "cracking", photos: [p(6), p(7)] }, { location: "kerb", damageType: "surface_damage", photos: [p(8)] }],
        footpaths_assets: [{ assetType: "item1", photos: [p(9)] }],
      },
    ],
  };
  const groups = G.toolGroups(fields, answers, [p(1), p(2), p(3), p(4), p(5), p(6), p(7), p(8), p(9), p(10)]);

  it("finds a group for every photo field of the part, with the part's name", () => {
    const byPath = (path) => groups.find((g) => g.path && g.path.join(".") === path);
    assert.deepEqual(byPath("parts.0.startEndPhotos").photos, [p(1), p(2)]);
    assert.ok(byPath("parts.0.startEndPhotos").title.startsWith("Part A"), byPath("parts.0.startEndPhotos").title);
    assert.deepEqual(byPath("parts.0.endPhotos").photos, [p(3)]);
    assert.deepEqual(byPath("parts.0.footpaths_widePhotos").photos, [p(4), p(5)]);
  });

  it("names the category a group belongs to, so 'Defect 1' under Footpaths is told from 'Defect 1' under Kerbs", () => {
    const fp = groups.find((g) => g.path?.join(".") === "parts.0.footpaths_widePhotos");
    assert.ok(fp.title.includes("Footpaths and Crossovers"), fp.title);
    const defect = groups.find((g) => g.defect && g.photos[0] === p(6));
    assert.ok(defect.title.includes("Footpaths and Crossovers") && defect.title.includes("Defect 1"), defect.title);
  });

  it("lists each defect's own photos as a defect group, named by where it is", () => {
    const defects = groups.filter((g) => g.defect);
    assert.deepEqual(defects.map((g) => g.photos), [[p(6), p(7)], [p(8)]]);
    assert.deepEqual(defects.map((g) => g.detail), ["outside no. 7", "kerb"]);
    assert.ok(defects[0].title.includes("Defect 1"), defects[0].title);
  });

  it("puts the photos no group holds (the section's own list) last", () => {
    const last = groups[groups.length - 1];
    assert.equal(last.id, G.SECTION_GROUP_ID);
    assert.equal(last.path, null);
    assert.deepEqual(last.photos, [p(10)]);
  });

  it("shows nothing for a category the part does not cover", () => {
    assert.ok(!groups.some((g) => g.path && g.path.join(".").includes("naturestrip_")));
  });
});

describe("photo groups of an Apartment's rooms (fixed instances)", () => {
  const fields = fieldsOf("apartment", "internal_areas");
  const answers = { rooms: { living_room: { present: "yes", photos: [p(1), p(2)] }, kitchen: { present: "yes", roomName: "Kitchen and pantry", photos: [p(3)] } } };
  const groups = G.toolGroups(fields, answers, []);

  it("finds a room's photos by its key, named by the room", () => {
    const living = groups.find((g) => g.path?.join(".") === "rooms.living_room.photos");
    assert.deepEqual(living.photos, [p(1), p(2)]);
    assert.ok(/Living/i.test(living.title), living.title);
    const kitchen = groups.find((g) => g.path?.join(".") === "rooms.kitchen.photos");
    assert.ok(kitchen.title.includes("Kitchen and pantry"), kitchen.title);
  });
});

describe("changing photo lists in the answers", () => {
  const base = { a: { photos: [p(1), p(2), p(3)] }, b: [{ photos: [p(4)] }, { photos: [] }] };

  it("reorders within one list", () => {
    const out = G.withPhotoMoved(base, ["a", "photos"], ["a", "photos"], p(3), 0);
    assert.deepEqual(out.a.photos, [p(3), p(1), p(2)]);
    assert.deepEqual(G.withPhotoMoved(base, ["a", "photos"], ["a", "photos"], p(1)).a.photos, [p(2), p(3), p(1)]);
  });

  it("moves a photo to another list at a position, leaving the rest in order", () => {
    const out = G.withPhotoMoved(base, ["a", "photos"], ["b", 0, "photos"], p(2), 0);
    assert.deepEqual(out.a.photos, [p(1), p(3)]);
    assert.deepEqual(out.b[0].photos, [p(2), p(4)]);
    assert.deepEqual(out.b[1].photos, []);
  });

  it("moves into an empty list, and never puts a photo in a list twice", () => {
    const out = G.withPhotoMoved(base, ["a", "photos"], ["b", 1, "photos"], p(1));
    assert.deepEqual(out.b[1].photos, [p(1)]);
    const again = G.withPhotoMoved(out, ["a", "photos"], ["b", 1, "photos"], p(1));
    assert.deepEqual(again.b[1].photos, [p(1)], "the photo is no longer in the source, so nothing changes");
  });

  it("matches a photo by its address, not the signed-link query", () => {
    const out = G.withPhotoMoved(base, ["a", "photos"], ["b", 0, "photos"], p(3, "?e=1&s=abc"), 1);
    assert.deepEqual(out.b[0].photos, [p(4), p(3)]);
  });

  it("adds a photo at a position or at the end, once", () => {
    assert.deepEqual(G.withPhotoAdded(base, ["a", "photos"], p(9), 1).a.photos, [p(1), p(9), p(2), p(3)]);
    assert.deepEqual(G.withPhotoAdded(base, ["b", 1, "photos"], p(9)).b[1].photos, [p(9)]);
    assert.deepEqual(G.withPhotoAdded(base, ["a", "photos"], p(2)).a.photos, [p(1), p(3), p(2)]);
  });

  it("replaces a photo with a new one in the same place", () => {
    const groups = [{ id: "a.photos", path: ["a", "photos"], photos: base.a.photos, title: "", defect: false }];
    assert.deepEqual(G.withPhotoReplaced(base, groups, p(2), p(7)).a.photos, [p(1), p(7), p(3)]);
  });

  it("never changes the answers it was given", () => {
    const copy = JSON.stringify(base);
    G.withPhotoMoved(base, ["a", "photos"], ["b", 0, "photos"], p(2), 0);
    G.withPhotoAdded(base, ["a", "photos"], p(9));
    assert.equal(JSON.stringify(base), copy);
  });

  it("moved(): clamps and ignores a position that is not in the list", () => {
    assert.deepEqual(G.moved([1, 2, 3], 0, 99), [2, 3, 1]);
    assert.deepEqual(G.moved([1, 2, 3], 2, -5), [3, 1, 2]);
    assert.deepEqual(G.moved([1, 2, 3], 7, 0), [1, 2, 3]);
  });
});

describe("the flat photo list follows the arrangement", () => {
  const g = (photos) => ({ id: String(photos), title: "", defect: false, path: ["x"], photos });
  it("lists every group's photos in turn, then the ones no group holds", () => {
    assert.deepEqual(G.flatOrder([g([p(3), p(1)]), g([p(2)])], [p(1), p(2), p(3), p(9)]), [p(3), p(1), p(2), p(9)]);
  });
  it("keeps the section's own link form for each photo, and lists each once", () => {
    assert.deepEqual(G.flatOrder([g([p(2)]), g([p(2), p(1)])], [p(1, "?e=1&s=a"), p(2, "?e=1&s=b")]), [p(2, "?e=1&s=b"), p(1, "?e=1&s=a")]);
  });
});

describe("photo groups of an Apartment's rooms", () => {
  const fields = fieldsOf("apartment", "internal_areas");
  // the database keeps object keys in its own order (shortest first), not the form's
  const answers = { rooms: { dining: { present: "yes", photos: [p(3)] }, kitchen: { present: "yes", photos: [p(4)] }, living_room: { present: "yes", photos: [p(2)] }, entry_hallway: { present: "yes", photos: [p(1)] } } };
  const groups = G.toolGroups(fields, answers, [p(1), p(2), p(3), p(4)]);

  it("lists the rooms in the form's order, the order the report prints them", () => {
    const rooms = groups.filter((g) => g.path).map((g) => g.title.split(" › ")[0]);
    assert.deepEqual(rooms, ["Entry / Hallway", "Living Room", "Dining", "Kitchen"]);
  });

  it("keeps each room's photos at the room's own key", () => {
    assert.deepEqual(groups.find((g) => g.title.startsWith("Kitchen")).path, ["rooms", "kitchen", "photos"]);
  });

  it("puts the section's flat list in that order too", () => {
    assert.deepEqual(G.flatOrder(groups, [p(4), p(3), p(2), p(1)]), [p(1), p(2), p(3), p(4)]);
  });
});

describe("one-click rotate", () => {
  it("turns an unedited photo a quarter turn either way", () => {
    assert.deepEqual(G.rotateEdit(null, 1), { rotate: 90 });
    assert.deepEqual(G.rotateEdit(null, -1), { rotate: 270 });
    assert.deepEqual(G.rotateEdit({ rotate: 270 }, 1), { rotate: 0 });
  });

  it("turns a crop box with the photo, so the same part stays cropped", () => {
    const crop = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    const right = G.rotateEdit({ rotate: 0, crop }, 1);
    assert.equal(right.rotate, 90);
    assert.deepEqual(right.crop, { x: 0.4, y: 0.1, w: 0.4, h: 0.3 });
    // and back again
    assert.deepEqual(G.rotateEdit(right, -1), { rotate: 0, crop });
    // four turns come back to the start
    let e = { rotate: 0, crop };
    for (let i = 0; i < 4; i++) e = G.rotateEdit(e, 1);
    assert.deepEqual(e, { rotate: 0, crop });
  });
});

describe("moving several photos at once", () => {
  const fields = fieldsOf("apartment", "internal_areas");
  const answers = { rooms: { kitchen: { present: "yes", photos: [p(1), p(2)] }, dining: { present: "yes", photos: [p(3)] } } };
  const groups = G.toolGroups(fields, answers, [p(1), p(2), p(3), p(4)]);
  const kitchen = groups.find((g) => g.title.startsWith("Kitchen"));
  const dining = groups.find((g) => g.title.startsWith("Dining"));
  const own = groups.find((g) => g.path === null);

  it("moves them into another room, in order, at the end", () => {
    const next = G.withPhotosMovedTo(answers, [{ url: p(1), from: kitchen }, { url: p(2), from: kitchen }], dining);
    assert.deepEqual(next.rooms.kitchen.photos, []);
    assert.deepEqual(next.rooms.dining.photos, [p(3), p(1), p(2)]);
  });

  it("takes photos out of a room into the section's own list, and brings own-list photos into a room", () => {
    const out = G.withPhotosMovedTo(answers, [{ url: p(2), from: kitchen }], own);
    assert.deepEqual(out.rooms.kitchen.photos, [p(1)]);
    const back = G.withPhotosMovedTo(answers, [{ url: p(4), from: own }], kitchen);
    assert.deepEqual(back.rooms.kitchen.photos, [p(1), p(2), p(4)]);
  });

  it("leaves a photo alone when it is already in the destination", () => {
    assert.deepEqual(G.withPhotosMovedTo(answers, [{ url: p(3), from: dining }], dining), answers);
  });
});
