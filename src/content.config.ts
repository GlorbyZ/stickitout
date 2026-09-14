import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const lessons = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/lessons' }),
  schema: z.object({
    title: z.string(),
    week: z.number(),
    excerpt: z.string(),
    isFree: z.boolean().default(false),
    track: z.string().optional(),
    cover: z.string().optional(),
    /** Leave empty until Mike supplies a real embed. Do not invent URLs. */
    videoUrl: z.string().optional(),
    published: z.boolean().default(true),
  }),
});

const tracks = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/tracks' }),
  schema: z.object({
    title: z.string(),
    excerpt: z.string(),
    cover: z.string().optional(),
    lessonCount: z.number().optional(),
    featured: z.boolean().default(false),
    published: z.boolean().default(true),
  }),
});

const challenges = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/challenges' }),
  schema: z.object({
    title: z.string(),
    excerpt: z.string(),
    status: z.enum(['upcoming', 'open', 'closed']).default('upcoming'),
    published: z.boolean().default(true),
  }),
});

export const collections = { lessons, tracks, challenges };
