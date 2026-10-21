/**
 * AI Generate must reason from CURRENT conditions, not replay a workbook.
 * These are scheduling priorities, not fixed staff-placement instructions.
 * Clinical/safety constraints cannot be traded away for soft preferences.
 */
export const INDEPENDENT_AI_PLANNING_PRIORITIES = {
  purpose:"Build today's best feasible plan independently using the live website roster; historical templates are informative examples ONLY.",
  nonNegotiable:[
    "Use only currently eligible staff within actual shifts and partial/full call-out windows.",
    "One staff member cannot cover two clients simultaneously; one client cannot have two caregivers in the same 30-minute cell.",
    "Honor hard staff/client restrictions, service settings, and non-overridable safety/clinical rules.",
    "Schedule every required supervised client nap, fixed speech event, and required single staff break when feasible; don't misreport missing events as completed.",
    "Preserve the manager's explicit confirmation requirements before replacing protected saved rows."
  ],
  optimizationOrder:[
    "Maximize safely covered client half-hour requirements.",
    "Place valid client naps and individual staff breaks, linking a Break/Nap when it creates a better coherent schedule.",
    "Maintain contiguous client/staff blocks and smooth pre-nap/post-nap handoffs; avoid unneeded 30-minute alternation.",
    "Prefer frontline BT/RBT where eligible, use intern/manager/BCBA relief only when sensible.",
    "Prefer client/staff preferences and familiar pairs or teams when they do not reduce safe coverage.",
    "Use templates only as one weak piece of evidence about sensible hours and pairings, never as fixed placements or targets."
  ],
  mayFlex:[
    "Same-team grouping, historical pair matches and template times",
    "Typical clients-per-therapist goals and approximate 4-hour block targets",
    "Soft continuity, staff/client rotation, template-similarity and workload balancing preferences"
  ],
  neverDo:[
    "Fill client slots with an unavailable, called-out or hard-restricted therapist",
    "Treat a client nap as a staff break unless that exact supervised slot is linked",
    "Claim uncovered or missing events are completed",
    "Copy a template just to increase similarity when current conditions need a better plan"
  ]
} as const;
