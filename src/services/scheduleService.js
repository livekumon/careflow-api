const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function defaultScheduleSets() {
  return [
    {
      days: ["mon", "tue", "wed", "thu", "fri"],
      slots: [{ start: "09:00", end: "17:00" }],
    },
  ];
}

/** @deprecated alias for older call sites */
function defaultSchedule() {
  return defaultScheduleSets();
}

function cleanSlot(slot) {
  return {
    start: String(slot?.start || "09:00").slice(0, 5),
    end: String(slot?.end || "17:00").slice(0, 5),
  };
}

function normalizeScheduleSets(input) {
  if (!Array.isArray(input) || input.length === 0) return defaultScheduleSets();

  // Legacy per-day rows: { day, enabled, start, end }
  if (input[0] && input[0].day != null && input[0].days == null) {
    const groups = new Map();
    for (const row of input) {
      const day = String(row.day || "").toLowerCase();
      if (!DAYS.includes(day) || !row.enabled) continue;
      const key = `${row.start || "09:00"}|${row.end || "17:00"}`;
      if (!groups.has(key)) {
        groups.set(key, {
          days: [],
          slots: [cleanSlot(row)],
        });
      }
      groups.get(key).days.push(day);
    }
    const sets = [...groups.values()].map((set) => ({
      days: DAYS.filter((d) => set.days.includes(d)),
      slots: set.slots,
    }));
    return sets.length ? sets : defaultScheduleSets();
  }

  const sets = [];
  for (const raw of input.slice(0, 6)) {
    const days = DAYS.filter((d) =>
      (Array.isArray(raw?.days) ? raw.days : []).map((x) => String(x).toLowerCase()).includes(d)
    );
    let slots = Array.isArray(raw?.slots) ? raw.slots.map(cleanSlot) : [];
    if (!slots.length && (raw?.start || raw?.end)) {
      slots = [cleanSlot(raw)];
    }
    if (!slots.length) slots = [{ start: "09:00", end: "17:00" }];
    if (!days.length) continue;
    sets.push({ days, slots: slots.slice(0, 6) });
  }
  return sets.length ? sets : defaultScheduleSets();
}

/** @deprecated alias */
function normalizeSchedule(input) {
  return normalizeScheduleSets(input);
}

module.exports = {
  DAYS,
  defaultSchedule,
  defaultScheduleSets,
  normalizeSchedule,
  normalizeScheduleSets,
};
