import { z } from 'zod';
import type { Db } from '../../db/connection';
import { localDay, newId } from '../../lib/util';
import type { SettingsService } from '../../settings/settings-service';
import { defineTool, ok, type Tool } from '../types';

interface MealRow {
  id: string;
  ts: string;
  day: string;
  description: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export function createMealsRepo(db: Db) {
  return {
    add(
      m: Omit<MealRow, 'id' | 'ts' | 'day'> & { conversationId?: string },
      at = new Date(),
    ): MealRow {
      const row: MealRow = {
        id: newId('meal_'),
        ts: at.toISOString(),
        day: localDay(at),
        description: m.description,
        calories: m.calories,
        protein_g: m.protein_g,
        carbs_g: m.carbs_g,
        fat_g: m.fat_g,
      };
      db.prepare(
        `INSERT INTO meals (id, ts, day, description, calories, protein_g, carbs_g, fat_g, conversation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id,
        row.ts,
        row.day,
        row.description,
        row.calories,
        row.protein_g,
        row.carbs_g,
        row.fat_g,
        m.conversationId ?? null,
      );
      return row;
    },
    byDay(day: string): MealRow[] {
      return db
        .prepare('SELECT * FROM meals WHERE day = ? ORDER BY ts')
        .all(day) as unknown as MealRow[];
    },
    remove(id: string): boolean {
      return Number(db.prepare('DELETE FROM meals WHERE id = ?').run(id).changes) > 0;
    },
  };
}

export type MealsRepo = ReturnType<typeof createMealsRepo>;

const num = z.number().min(0).max(10_000).nullable().default(null);

/** "today" | "yesterday" | YYYY-MM-DD → local day. */
export function resolveDay(day: string, now = new Date()): string {
  if (day === 'today') return localDay(now);
  if (day === 'yesterday') return localDay(new Date(now.getTime() - 86_400_000));
  return day;
}

function totals(rows: MealRow[]) {
  const sum = (k: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g'): number =>
    Math.round(rows.reduce((a, r) => a + (r[k] ?? 0), 0));
  return {
    calories: sum('calories'),
    protein: sum('protein_g'),
    carbs: sum('carbs_g'),
    fat: sum('fat_g'),
  };
}

/** Meal / nutrition logging (ideas from isair/jarvis). Claude estimates the numbers from the description. */
export function createMealTools(deps: { repo: MealsRepo; settings: SettingsService }): Tool[] {
  return [
    defineTool({
      name: 'log_meal',
      description:
        'Log something sir ate or drank, with your best estimate of calories and macros (grams). Use when he says what he ate ("I just had a masala dosa"). Say the estimate is approximate.',
      input: z.object({
        description: z.string().min(2).max(300),
        calories: num,
        protein_g: num,
        carbs_g: num,
        fat_g: num,
      }),
      tier: 'SAFE',
      summarize: ({ description }) => `Log meal: ${description.slice(0, 50)}`,
      async run(input, ctx) {
        deps.repo.add({ ...input, conversationId: ctx.conversationId });
        const t = totals(deps.repo.byDay(localDay()));
        const target = deps.settings.get('nutrition.dailyCalories');
        return ok(
          `Logged "${input.description}" (~${input.calories ?? '?'} kcal). Today so far: ${t.calories} kcal${target ? ` of ${target}` : ''}, protein ${t.protein} g, carbs ${t.carbs} g, fat ${t.fat} g.`,
        );
      },
    }),
    defineTool({
      name: 'list_meals',
      description:
        "What sir logged on a day, with totals against his daily calorie target. day: 'today', 'yesterday' or YYYY-MM-DD.",
      input: z.object({
        day: z
          .string()
          .regex(/^(today|yesterday|\d{4}-\d{2}-\d{2})$/)
          .default('today'),
      }),
      tier: 'SAFE',
      summarize: ({ day }) => `List meals for ${day}`,
      async run({ day }) {
        const d = resolveDay(day);
        const rows = deps.repo.byDay(d);
        if (!rows.length) return ok(`No meals logged for ${d}.`);
        const t = totals(rows);
        const target = deps.settings.get('nutrition.dailyCalories');
        return ok(
          [
            ...rows.map(
              (r) =>
                `- [${r.id}] ${r.ts.slice(11, 16)} ${r.description}: ${r.calories ?? '?'} kcal, P ${r.protein_g ?? '?'} / C ${r.carbs_g ?? '?'} / F ${r.fat_g ?? '?'} g`,
            ),
            `Total ${d}: ${t.calories} kcal${target ? ` (target ${target}, ${target - t.calories >= 0 ? `${target - t.calories} left` : `${t.calories - target} over`})` : ''}; protein ${t.protein} g, carbs ${t.carbs} g, fat ${t.fat} g.`,
          ].join('\n'),
        );
      },
    }),
    defineTool({
      name: 'delete_meal',
      description: 'Remove a wrongly logged meal by its id (from list_meals).',
      input: z.object({ id: z.string().regex(/^meal_[\w-]+$/) }),
      tier: 'SAFE',
      summarize: ({ id }) => `Delete meal ${id}`,
      async run({ id }) {
        return ok(deps.repo.remove(id) ? 'Deleted that meal.' : 'No meal with that id.');
      },
    }),
  ];
}
