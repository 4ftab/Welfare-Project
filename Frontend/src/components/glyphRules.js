// Picks an emblem for a project from the words in its title/description (English or Urdu).
const RULES = [
  ["water", /water|well|tube|pump|pani|پانی|نل|کنواں/i],
  ["book", /school|educat|book|library|class|study|تعلیم|اسکول|کتاب/i],
  ["health", /health|medic|clinic|hospital|dispens|doctor|صحت|علاج|دوا/i],
  ["road", /road|street|bridge|drain|sewer|pave|سڑک|گلی|پل|نالی/i],
  ["home", /house|home|shelter|housing|mosque|roof|مکان|گھر|مسجد/i],
  ["light", /solar|light|electric|power|بجلی|روشنی/i],
  ["food", /food|ration|meal|kitchen|iftar|zakat|کھانا|راشن/i],
];

export function glyphFor(text = "") {
  return RULES.find(([, re]) => re.test(text))?.[0] || "leaf";
}
