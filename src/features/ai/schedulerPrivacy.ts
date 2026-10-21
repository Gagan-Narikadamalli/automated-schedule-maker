/** Request-local aliases. The lookup table is never included in a model request. */
export type SchedulerPrivateEntity = {
  kind: "Staff" | "Client" | "Team" | "Location" | "Template";
  id: string;
  label: string;
  fullName?: string;
  aliases?: string[];
};

const OMITTED_FIELDS = /^(?:notes?|reason|styleNotes|learningProfile|sourceName|fileName|filename|attachmentContext|attachmentNames|insurancePlan|email|phone|address|dateOfBirth|dob|password|apiKey|credentials|managerCorrection|assistantResponse|request)$/i;
const NAME_FIELDS = /^(?:name|fullName|displayCode|staffName|clientName|clientCode|teamName|locationName|templateName|displayText)$/i;
const DATABASE_ID = /\b[\da-f]{24}\b/gi;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function createSchedulerPrivacy(entities: SchedulerPrivateEntity[]) {
  type Entry = { alias: string; id: string; label: string; fullName?: string };
  const byOriginal = new Map<string, Entry>();
  const byAlias = new Map<string, Entry>();
  const counts = new Map<string, number>();
  let replacements: RegExp | undefined;

  function register(kind: string, id: string, label: string, fullName?: string, aliases: string[] = []) {
    const existing = byOriginal.get(id.toLowerCase());
    if (existing) return existing;
    const number = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, number);
    const entry = { alias: `${kind}${number}`, id, label, fullName };
    byAlias.set(entry.alias.toLowerCase(), entry);
    for (const value of [id, kind === "Record" ? undefined : label, fullName, ...aliases]) {
      if (value?.trim()) byOriginal.set(value.toLowerCase(), entry);
    }
    replacements = undefined;
    return entry;
  }
  for (const entity of entities) register(entity.kind, entity.id, entity.label, entity.fullName, entity.aliases);

  function encodeText(text: string): string {
    if (!replacements && byOriginal.size) {
      replacements = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${[...byOriginal.keys()].sort((a,b) => b.length-a.length).map(escapeRegex).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
    }
    return (replacements ? text.replace(replacements, value => byOriginal.get(value.toLowerCase())?.alias ?? value) : text)
      .replace(DATABASE_ID, id => register("Record", id, "Record").alias)
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[contact omitted]")
      .replace(/(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\b\d{3})[ .-]\d{3}[ .-]\d{4}\b/g, "[contact omitted]");
  }

  function encode(value: unknown, key = ""): any {
    if (OMITTED_FIELDS.test(key)) return "[omitted for privacy]";
    if (typeof value === "string") {
      if (NAME_FIELDS.test(key) && value.trim() && !byOriginal.has(value.toLowerCase()) && !byAlias.has(value.toLowerCase())) {
        return register("Label", `label:${value}`, value).alias;
      }
      return encodeText(value);
    }
    if (Array.isArray(value)) return value.map(item => encode(item, key));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([field, item]) => [encodeText(field), encode(item, field)]));
    }
    return value;
  }

  function decodeText(text: string, key = ""): string {
    return text.replace(/\b(?:Staff|Client|Team|Location|Template|Record|Label)\s*\d+\b/gi, alias => {
      const entry = byAlias.get(alias.replace(/\s/g, "").toLowerCase());
      if (!entry) return alias;
      if (/^(?:_?id)$|Ids?$/i.test(key)) return entry.id;
      if (/fullName/i.test(key)) return entry.fullName ?? entry.label;
      return entry.label;
    });
  }

  function decode(value: unknown, key = ""): any {
    if (typeof value === "string") return decodeText(value, key);
    if (Array.isArray(value)) return value.map(item => decode(item, key));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([field,item]) => [decodeText(field, "id"), decode(item, field)]));
    return value;
  }

  return { encodeText, encode, decodeText, decode };
}

export type SchedulerPrivacy = ReturnType<typeof createSchedulerPrivacy>;

/**
 * Preserve only the validated conversational data the model may receive.
 * Attachment filenames and prior image analysis are deliberately never sent.
 * Do NOT pass history through the generic privacy.encode object scrubber:
 * omitted array fields become a string sentinel and previously crashed the
 * conversation renderer when it expected .join().
 */
export function encodeSafeSchedulerHistory<T extends {
  role: "user" | "assistant"; text: string; effectiveDate?: string
}>(history: T[], encodeText: (value: string) => string) {
  return history.map(({role,text,effectiveDate}) => ({
    role, text: encodeText(text), effectiveDate
  }));
}
