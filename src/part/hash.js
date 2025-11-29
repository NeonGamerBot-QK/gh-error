import crypto from "crypto";

// Fields that should NOT affect the hash
const VOLATILE_FIELDS = new Set([
  "timestamp",
  "uptime",
  "memoryUsage",
  "cwd",
  "process",
]);

function removeVolatile(value) {
  if (Array.isArray(value)) {
    return value.map(removeVolatile);
  }
  if (value && typeof value === "object") {
    const cleaned = {};
    for (const key of Object.keys(value)) {
      if (VOLATILE_FIELDS.has(key)) continue;
      cleaned[key] = removeVolatile(value[key]);
    }
    return cleaned;
  }
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(stableJson).join(",") + "]";
  } else if (value && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + stableJson(value[key]))
        .join(",") +
      "}"
    );
  } else {
    return JSON.stringify(value);
  }
}

export function stableHashIgnoringVolatile(obj) {
  const cleaned = removeVolatile(obj);
  const json = stableJson(cleaned);
  return crypto.createHash("sha256").update(json).digest("hex");
}
