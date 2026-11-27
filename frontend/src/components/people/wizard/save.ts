import { todayIso } from "@/lib/format";
import { errorData, statusOf } from "@/lib/api-errors";
import { apiClient, errorMessage } from "@/services/api-client";
import type { Duplicate, PeopleGroup, Person, PersonAddress, PersonPreferences } from "@/types/people";
import { type Address, blankAddress, EMPTY, isBlank, normaliseMobile, occasionLabel, type Occasion, type WizardData } from "./types";

export type SaveResult = { id: string; name: string; /** Parts that could not be saved. The person exists. */ warnings: { section: string; message: string }[] };
/** The API says "this person may already exist" with the possible matches. */
export class DuplicateFound extends Error {
  constructor(public matches: Duplicate[]) { super("duplicate"); }
}

const clean = (v: string) => v.trim() || null;
const amount = (v: string) => (v.trim() === "" ? null : Number(v));

/** A birthday that has happened is the date of birth; a plain anniversary lives on the person; the rest are OS events. */
const isBirth = (o: Occasion) => o.type === "Birthday" && o.date <= todayIso();
const isAnniversary = (o: Occasion) => o.type === "Anniversary";

export async function findDuplicates(data: WizardData) {
  const { name, mobile, email } = data.details;
  const res = await apiClient.get<Duplicate[]>("/people/duplicates", {
    params: { companyId: data.companyId, name: name.trim() || undefined, mobileNumber: mobile.trim() ? normaliseMobile(mobile) : undefined, email: email.trim() || undefined },
  });
  return res.data;
}

function personBody(data: WizardData) {
  const d = data.details;
  return {
    name: d.name.trim(), mobileNumber: normaliseMobile(d.mobile), email: clean(d.email), recipientType: d.recipientType,
    companyName: d.recipientType === "EXTERNAL" ? clean(d.company) : null, relationship: d.relationship || null, isPrimary: d.isPrimary,
    designation: clean(d.designation), department: clean(d.department), city: clean(d.city) ?? clean(data.permanent.city),
    giftingOccasion: clean(d.giftingOccasion), budget: amount(d.budget), birthdayBudget: amount(d.birthdayBudget),
    anniversaryBudget: amount(d.anniversaryBudget), remark: clean(d.remark),
    dateOfBirth: data.occasions.find(isBirth)?.date ?? null, anniversaryDate: data.occasions.find(isAnniversary)?.date ?? null,
  };
}

const addressBody = (a: Address, isDefault: boolean) => ({
  label: a.label, addressLine1: a.line1.trim(), addressLine2: clean(a.line2), city: a.city.trim(), state: clean(a.state), postalCode: a.postalCode.trim(), country: "IN", isDefault,
});
const preferencesBody = (p: WizardData["preferences"]) => ({
  interests: p.interests, preferredBrands: p.brands, giftPreferences: clean(p.giftPreferences), dietaryPreferences: clean(p.dietary), giftsToAvoid: clean(p.avoid), specialInstructions: clean(p.instructions),
});

async function sendPhoto(id: string, photo: File) {
  const form = new FormData();
  form.append("file", photo);
  await apiClient.put(`/people/${id}/photo`, form, { timeout: 60_000 });
}

/** An event lives in Gifting OS, which copies a new person a moment after the CRM saves them: try a few times. */
async function addEvent(companyId: string, recipientId: string, o: Occasion) {
  const body = { recipientId, name: occasionLabel(o), day: o.date, description: clean(o.notes), repeatAnnually: o.repeatAnnually };
  for (let attempt = 0; ; attempt++) {
    try { return await apiClient.post(`/os/${companyId}/events`, body); } catch (e) {
      if (statusOf(e) !== 404 || attempt >= 3) throw e;
      await new Promise((done) => setTimeout(done, 1500));
    }
  }
}

function attempts() {
  const warnings: SaveResult["warnings"] = [];
  const attempt = async (section: string, work: () => Promise<unknown>) => { try { await work(); } catch (e) { warnings.push({ section, message: errorMessage(e) }); } };
  return { warnings, attempt };
}

/** Creates the person first, then each optional part on its own, so one failing part never loses the others. */
export async function saveNew(data: WizardData, photo: File | null): Promise<SaveResult> {
  const list = [data.permanent, data.sameAddress ? null : data.current].filter((a): a is Address => !!a && !isBlank(a));
  const main = list.find((a) => a.label === "CURRENT") ?? list[0]; // gifts go to the current address when there is one
  let created: Person;
  try {
    created = (await apiClient.post<Person>("/people", { ...personBody(data), companyId: data.companyId, allowDuplicate: data.allowDuplicate, address: main ? addressBody(main, true) : null })).data;
  } catch (e) {
    const found = errorData<{ duplicates?: Duplicate[] }>(e)?.duplicates;
    if (statusOf(e) === 409 && found?.length) throw new DuplicateFound(found);
    throw e;
  }
  const { warnings, attempt } = attempts();
  const base = `/people/${created.id}`;
  if (photo) await attempt("Photo", () => sendPhoto(created.id, photo));
  for (const a of list.filter((x) => x !== main)) await attempt("Delivery address", () => apiClient.post(`${base}/addresses`, addressBody(a, false)));
  for (const id of data.groupIds) await attempt("Group", () => apiClient.put(`/people-groups/${id}`, { addRecipientIds: [created.id] }));
  if (data.newGroupName.trim()) await attempt(`Group: ${data.newGroupName.trim()}`, () => apiClient.post("/people-groups", { companyId: data.companyId, name: data.newGroupName.trim(), recipientIds: [created.id] }));
  const birth = data.occasions.find(isBirth), anniversary = data.occasions.find(isAnniversary);
  for (const o of data.occasions.filter((x) => x !== birth && x !== anniversary)) await attempt(`Occasion: ${occasionLabel(o)}`, () => addEvent(data.companyId, created.id, o));
  return { id: created.id, name: created.name, warnings };
}

/** Fill every step with what the person already has. */
export async function loadForEdit(person: Person): Promise<WizardData> {
  const [addresses, prefs, groups] = await Promise.all([
    apiClient.get<PersonAddress[]>(`/people/${person.id}/addresses`).then((r) => r.data),
    apiClient.get<PersonPreferences>(`/people/${person.id}/preferences`).then((r) => r.data),
    apiClient.get<PeopleGroup[]>("/people-groups", { params: { companyId: person.companyId } }).then((r) => r.data),
  ]);
  const text = (v: unknown) => (v == null ? "" : String(v));
  const slot = (label: "PERMANENT" | "CURRENT"): Address => {
    const a = addresses.find((x) => x.label === label);
    return a ? { id: a.id, label, line1: a.addressLine1, line2: a.addressLine2 ?? "", city: a.city, state: a.state ?? "", postalCode: a.postalCode } : blankAddress(label);
  };
  const occasions: Occasion[] = [
    ...(person.dateOfBirth ? [{ key: "dob", type: "Birthday", name: "", date: person.dateOfBirth, repeatAnnually: true, notes: "" }] : []),
    ...(person.anniversaryDate ? [{ key: "anniversary", type: "Anniversary", name: "", date: person.anniversaryDate, repeatAnnually: true, notes: "" }] : []),
  ];
  return {
    ...EMPTY,
    companyId: person.companyId,
    details: {
      name: person.name, mobile: person.mobileNumber ?? "", email: person.email ?? "", company: person.companyName ?? "", recipientType: person.recipientType,
      relationship: person.relationship ?? "", isPrimary: person.isPrimary, designation: person.designation ?? "", department: person.department ?? "",
      city: person.city ?? "", giftingOccasion: person.giftingOccasion ?? "", budget: text(person.budget), birthdayBudget: text(person.birthdayBudget),
      anniversaryBudget: text(person.anniversaryBudget), remark: person.remark ?? "",
    },
    groupIds: groups.filter((g) => g.recipientIds.includes(person.id)).map((g) => g.id),
    occasions,
    preferences: { interests: prefs.interests ?? [], brands: prefs.preferredBrands ?? [], giftPreferences: prefs.giftPreferences ?? "", dietary: prefs.dietaryPreferences ?? "", avoid: prefs.giftsToAvoid ?? "", instructions: prefs.specialInstructions ?? "" },
    permanent: slot("PERMANENT"), current: slot("CURRENT"),
  };
}

/** Saves the person, then only the parts that changed. */
export async function saveEdit(person: Person, data: WizardData, original: WizardData, photo: File | null, groups: PeopleGroup[]): Promise<SaveResult> {
  const saved = (await apiClient.patch<Person>(`/people/${person.id}`, { ...personBody(data), version: person.version })).data;
  const { warnings, attempt } = attempts();
  const base = `/people/${person.id}`;
  if (photo) await attempt("Photo", () => sendPhoto(person.id, photo));
  for (const slot of ["permanent", "current"] as const) {
    const next = slot === "current" && data.sameAddress ? blankAddress("CURRENT") : data[slot];
    const before = original[slot];
    if (JSON.stringify(next) === JSON.stringify(before) && !(slot === "current" && data.sameAddress && before.id)) continue;
    if (isBlank(next)) { if (before.id) await attempt("Delivery address", () => apiClient.delete(`${base}/addresses/${before.id}`)); }
    else if (before.id) await attempt("Delivery address", () => apiClient.patch(`${base}/addresses/${before.id}`, { ...addressBody(next, false), isDefault: undefined }));
    else await attempt("Delivery address", () => apiClient.post(`${base}/addresses`, addressBody(next, false)));
  }
  if (JSON.stringify(data.preferences) !== JSON.stringify(original.preferences)) await attempt("Preferences", () => apiClient.put(`${base}/preferences`, preferencesBody(data.preferences)));
  for (const id of data.groupIds.filter((g) => !original.groupIds.includes(g))) await attempt("Group", () => apiClient.put(`/people-groups/${id}`, { addRecipientIds: [person.id] }));
  for (const id of original.groupIds.filter((g) => !data.groupIds.includes(g))) {
    const group = groups.find((g) => g.id === id);
    if (group) await attempt(`Group: ${group.name}`, () => apiClient.put(`/people-groups/${id}`, { recipientIds: group.recipientIds.filter((x) => x !== person.id) }));
  }
  if (data.newGroupName.trim()) await attempt(`Group: ${data.newGroupName.trim()}`, () => apiClient.post("/people-groups", { companyId: person.companyId, name: data.newGroupName.trim(), recipientIds: [person.id] }));
  const known = new Set(["dob", "anniversary"]);
  const birth = data.occasions.find(isBirth), anniversary = data.occasions.find(isAnniversary);
  for (const o of data.occasions.filter((x) => x !== birth && x !== anniversary && !known.has(x.key))) await attempt(`Occasion: ${occasionLabel(o)}`, () => addEvent(person.companyId, person.id, o));
  return { id: saved.id, name: saved.name, warnings };
}
