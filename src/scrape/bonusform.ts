import * as cheerio from 'cheerio';
import type { BonusQuestion, BonusSlot } from '../domain/types.js';
import { ParseError } from '../errors.js';

export function parseBonusForm(html: string): { fields: Record<string, string>; questions: BonusQuestion[] } {
  const $ = cheerio.load(html);

  // Collect all hidden form fields (spieltagIndex, bonus, tippsaisonId,
  // per-question tippAbgegeben flags) to replay on POST.
  const fields: Record<string, string> = {};
  $('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr('name');
    if (name) fields[name] = $(el).attr('value') || '';
  });

  const table = $('#tippabgabeFragen');
  if (!table.length) throw new ParseError('bonus question table not found', '#tippabgabeFragen');

  const questions: BonusQuestion[] = [];
  let lastDeadline: string | null = null;

  table.find('tr').each((_, tr) => {
    const row = $(tr);
    if (row.find('th').length) return;
    const cells = row.find('td');
    if (cells.length < 3) return;

    // Deadline carries forward like the bet form's kickoff column.
    const time = cells.eq(0).text().trim();
    if (/\d{2}\.\d{2}\.\d{2,4}/.test(time)) lastDeadline = time;

    const text = cells.eq(1).text().trim();
    if (!text) return;

    const selects = row.find('select');
    if (!selects.length) {
      // Deadline passed: the inputs are gone and the cell shows the stored answer.
      const stored = cells.eq(2).text().trim();
      questions.push({
        questionId: idFrom(row.find('input[name*="tippAbgegeben"]').attr('name')),
        text,
        deadline: lastDeadline,
        locked: true,
        slots: [{ slotId: -1, inputName: '', options: [], currentId: null, currentLabel: stored || null }],
      });
      return;
    }

    let questionId = -1;
    const slots: BonusSlot[] = [];
    selects.each((_, sel) => {
      const name = $(sel).attr('name') || '';
      const m = name.match(/fragetippForms\[(\d+)\]\.antwortIds\[(\d+)\]/);
      if (!m) return;
      questionId = Number(m[1]);
      const options: BonusSlot['options'] = [];
      let currentId: number | null = null;
      let currentLabel: string | null = null;
      $(sel).find('option').each((_, opt) => {
        const id = Number($(opt).attr('value'));
        if (!Number.isFinite(id) || id < 0) return; // -1 = "-- Nicht getippt --"
        const label = $(opt).text().trim();
        options.push({ id, label });
        if ($(opt).attr('selected') != null) { currentId = id; currentLabel = label; }
      });
      slots.push({ slotId: Number(m[2]), inputName: name, options, currentId, currentLabel });
    });
    if (!slots.length) return;
    questions.push({ questionId, text, deadline: lastDeadline, locked: false, slots });
  });

  return { fields, questions };
}

function idFrom(name: string | undefined): number {
  const m = (name || '').match(/\[(\d+)\]/);
  return m ? Number(m[1]) : -1;
}
