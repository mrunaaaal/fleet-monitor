// The terminal tool (spec issue #14, ADR-0001, fleet-monitor-docs.md §7.5):
// root_cause_services is a list, not a single field, so a simultaneous
// double failure is expressible as two independent causes rather than
// forced into one answer. category is per-cause for the same reason.
const CATEGORIES = ['latency', 'error', 'unavailable', 'resource', 'unknown'];
const CONFIDENCES = ['high', 'medium', 'low'];

export function createSubmitFindingsTool() {
  return {
    name: 'submit_findings',
    description:
      'Report the investigation\'s conclusion: one or more independent root causes, a summary, ' +
      'the evidence that supports it, the affected services (your blast-radius claim), and ' +
      'suggested remediation. Call this when confident, or with an empty root_cause_services and ' +
      'low-confidence summary when the evidence is inconclusive — never guess.',
    input_schema: {
      type: 'object',
      properties: {
        root_cause_services: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              service: { type: 'string' },
              category: { type: 'string', enum: CATEGORIES },
              confidence: { type: 'string', enum: CONFIDENCES },
            },
            required: ['service', 'category', 'confidence'],
          },
        },
        summary: { type: 'string' },
        evidence: {
          type: 'array',
          items: {
            type: 'object',
            properties: { source: { type: 'string' }, observation: { type: 'string' } },
            required: ['source', 'observation'],
          },
        },
        affected_services: { type: 'array', items: { type: 'string' } },
        suggested_remediation: { type: 'string' },
      },
      required: ['root_cause_services', 'summary', 'evidence', 'affected_services', 'suggested_remediation'],
    },
    async handler(input = {}) {
      validate(input);
      return input;
    },
  };
}

function validate(input) {
  for (const field of ['root_cause_services', 'summary', 'evidence', 'affected_services', 'suggested_remediation']) {
    if (input[field] === undefined) throw new Error(`submit_findings requires ${field}`);
  }
  if (!Array.isArray(input.root_cause_services)) throw new Error('submit_findings root_cause_services must be an array');
  if (!Array.isArray(input.evidence)) throw new Error('submit_findings evidence must be an array');
  if (!Array.isArray(input.affected_services)) throw new Error('submit_findings affected_services must be an array');

  for (const cause of input.root_cause_services) {
    if (!CATEGORIES.includes(cause.category)) {
      throw new Error(`submit_findings root cause category must be one of ${CATEGORIES.join(', ')}`);
    }
    if (!CONFIDENCES.includes(cause.confidence)) {
      throw new Error(`submit_findings root cause confidence must be one of ${CONFIDENCES.join(', ')}`);
    }
  }
}
