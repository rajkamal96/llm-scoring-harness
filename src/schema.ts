import { z } from 'zod';
import type { Rubric } from './config';

/** What one model run must return. */
export const RunOutputSchema = z.object({
  categories: z
    .array(
      z.object({
        id: z.string().max(40),
        score: z.number().int().min(0).max(4),
        /** A verbatim quote from the page that justifies the score. Checked in code. */
        evidence: z.string().max(400),
        rationale: z.string().max(300),
      }),
    )
    .max(30),
  fixes: z
    .array(z.object({ category: z.string().max(40), severity: z.enum(['minor', 'major']), fix: z.string().max(300) }))
    .max(30),
});

export type RunOutput = z.infer<typeof RunOutputSchema>;

/** Gemini responseSchema for the same shape, with the category ids as an enum. */
export function runJsonSchema(rubric: Rubric) {
  const ids = rubric.categories.map((c) => c.id);
  return {
    type: 'OBJECT',
    properties: {
      categories: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING', enum: ids },
            score: { type: 'INTEGER' },
            evidence: { type: 'STRING' },
            rationale: { type: 'STRING' },
          },
          required: ['id', 'score', 'evidence', 'rationale'],
        },
      },
      fixes: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            category: { type: 'STRING', enum: ids },
            severity: { type: 'STRING', enum: ['minor', 'major'] },
            fix: { type: 'STRING' },
          },
          required: ['category', 'severity', 'fix'],
        },
      },
    },
    required: ['categories', 'fixes'],
  } as const;
}
