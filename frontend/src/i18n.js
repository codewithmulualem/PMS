// The application currently ships with Amharic as its single supported UI
// language. Keeping labels in one place prevents stale English navigation
// rows in an existing database from leaking back into the interface.
export const NAV_LABELS = {
  home: "መነሻ",
  weekly_tasks: "ሳምንታዊ ተግባራት",
  executive: "የአስፈፃሚ እይታ",
  myself: "የእኔ አፈጻጸም",
  team: "የእኔ ቡድን",
  evaluations: "የእኔ ግምገማዎች",
  approvals: "ለማጽደቅ የቀረቡ ግምገማዎች",
  forms: "የግምገማ ቅጾች",
  employees: "ሰራተኞች",
  organization: "የድርጅት መዋቅር",
  programs: "ፕሮግራሞች",
  strategic_goals: "ስትራቴጂካዊ ግቦች",
  peer_reviews: "የሥራ ባልደረባ ግምገማ",
  anomalies: "የAI ማስጠንቀቂያዎች",
  audit: "የኦዲት መዝገብ",
  directorate_plans: "የዳይሬክቶሬት ዕቅዶች",
  department_plans: "የመምሪያ ዕቅዶች",
  team_plans: "የቡድን ዕቅዶች",
};

export const PAGE_META = {
  home: { title: "መነሻ", sub: "የእርስዎ ዳሽቦርድ በአንድ እይታ" },
  weekly_tasks: { title: "ሳምንታዊ ተግባራት", sub: "ሳምንትዎን ያቅዱ እና የዛሬን ተግባር ይምረጡ" },
  executive: { title: "የአስፈፃሚ እይታ", sub: "የመላ ድርጅቱ የአፈጻጸም መረጃ" },
  myself: { title: "የእኔ አፈጻጸም", sub: "የግል አፈጻጸም መዝገብ" },
  team: { title: "የእኔ ቡድን", sub: "በቀጥታ የሚመሩ ሰራተኞች" },
  evaluations: { title: "የእኔ ግምገማዎች", sub: "እርስዎ ማጠናቀቅ ያለብዎት የግምገማ ቅጾች" },
  approvals: { title: "ለማጽደቅ የቀረቡ ግምገማዎች", sub: "የእርስዎን ግምገማ የሚጠብቁ ቅጾች" },
  forms: { title: "የግምገማ ቅጾች", sub: "የቅጽ አብነቶች እና ምደባዎች" },
  employees: { title: "ሰራተኞች", sub: "የድርጅቱ ሰዎች እና አፈጻጸማቸው" },
  organization: { title: "የድርጅት መዋቅር", sub: "መዋቅር፣ ዑደቶች፣ የነጥብ ክብደቶች እና ብቃቶች" },
  programs: { title: "ፕሮግራሞች", sub: "የአካባቢ ፕሮግራሞች እና የተግባር አፈጻጸም" },
  strategic_goals: { title: "ስትራቴጂካዊ ግቦች", sub: "ዓመታዊ → የሩብ ዓመት → የቡድን → የግል ግብ ማውረድ" },
  peer_reviews: { title: "የሥራ ባልደረባ ግምገማ", sub: "ትብብርን እና የቡድን ሥራን ይገምግሙ" },
  anomalies: { title: "የAI ማስጠንቀቂያዎች", sub: "በሰው ልጅ እንዲገመገሙ የተለዩ ምልክቶች" },
  audit: { title: "የኦዲት መዝገብ", sub: "ሁሉም ነጥብ፣ KPI፣ ግምገማ እና የAI እርምጃ ይመዘገባል" },
  directorate_plans: { title: "የዳይሬክቶሬት ዕቅዶች", sub: "በዳይሬክቶሬትዎ ያለ የዕቅድ አፈጻጸም" },
  department_plans: { title: "የመምሪያ ዕቅዶች", sub: "በመምሪያዎ ያለ የዕቅድ አፈጻጸም" },
  team_plans: { title: "የቡድን ዕቅዶች", sub: "የቡድንዎ የዕቅድ አፈጻጸም" },
};

export const ROLE_LABELS = {
  admin: "አስተዳዳሪ",
  executive: "አስፈፃሚ",
  director: "ዳይሬክተር",
  dept_head: "የመምሪያ ኃላፊ",
  team_leader: "የቡድን መሪ",
  manager: "ሥራ አስኪያጅ",
  employee: "ሰራተኛ",
};

export const ROLE_NAV = {
  admin: ["executive", "employees", "organization", "programs", "forms", "approvals", "evaluations", "anomalies", "audit", "myself"],
  executive: ["executive", "strategic_goals", "employees", "programs", "approvals", "evaluations", "myself"],
  director: ["team", "directorate_plans", "strategic_goals", "programs", "approvals", "evaluations", "myself"],
  dept_head: ["team", "department_plans", "programs", "approvals", "evaluations", "myself"],
  team_leader: ["team", "team_plans", "weekly_tasks", "programs", "peer_reviews", "approvals", "evaluations", "myself"],
  manager: ["team", "programs", "approvals", "evaluations", "myself"],
  employee: ["home", "weekly_tasks", "programs", "peer_reviews", "evaluations", "myself"],
};

export const STATUS_LABELS = {
  planning: "በዕቅድ ላይ",
  in_progress: "በሂደት ላይ",
  on_hold: "ቆሟል",
  completed: "ተጠናቋል",
  cancelled: "ተሰርዟል",
  not_started: "አልተጀመረም",
  draft: "ረቂቅ",
  active: "ንቁ",
  todo: "ያልተጀመረ",
  done: "ተጠናቋል",
  planned: "ታቅዷል",
  closed: "ተዘግቷል",
  archived: "ተመዝግቧል",
  submitted: "ቀርቧል",
  approved: "ጸድቋል",
  rejected: "ተመልሷል",
  scored: "ነጥብ ተሰጥቷል",
  auto_scored: "በራስ-ሰር ነጥብ ተሰጥቷል",
  probation: "የሙከራ ጊዜ",
  on_leave: "በፈቃድ ላይ",
  resigned: "ሥራ ለቋል",
  terminated: "ተቋርጧል",
};

export const PERSPECTIVE_LABELS = {
  self: "የራስ",
  manager: "የአስተዳዳሪ",
  peer: "የሥራ ባልደረባ",
  subordinate: "የበታች ሰራተኛ",
};

export const SCOPE_LABELS = {
  annual: "ዓመታዊ",
  quarterly: "የሩብ ዓመት",
  department: "መምሪያ",
  team: "ቡድን",
  individual: "ግል",
};

export function navLabel(key, fallback = key) {
  return NAV_LABELS[key] || fallback;
}

export function statusLabel(value) {
  return STATUS_LABELS[value] || value || "—";
}

export function perspectiveLabel(value) {
  return PERSPECTIVE_LABELS[value] || value || "—";
}

export function scopeLabel(value) {
  return SCOPE_LABELS[value] || value || "—";
}
