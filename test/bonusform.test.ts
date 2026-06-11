import { describe, it, expect } from 'vitest';
import { parseBonusForm } from '../src/scrape/bonusform.js';
import { ParseError } from '../src/errors.js';
import { fixture } from './helpers.js';

// Minimal synthetic form: 1 single-slot question + 1 locked question.
const SYNTH = `<form action="/runde/tippabgabe">
<input type="hidden" name="spieltagIndex" value="1">
<input type="hidden" name="bonus" value="true">
<input type="hidden" name="tippsaisonId" value="99">
<table id="tippabgabeFragen">
<tr><th name="tipptermin">Tipptermin</th><th name="frage">Frage</th><th name="tipp">Tipp</th></tr>
<tr><td class="nw kicktipp-time">11.06.26 21:00</td><td class="nw">Wer wird Weltmeister?</td>
<td class="nw kicktipp-tippabgabe"><input type="hidden" value="true" name="fragetippForms[10].tippAbgegeben" />
<select name="fragetippForms[10].antwortIds[77]">
<option value="-1" selected="selected">-- Nicht getippt --</option>
<option value="111">&Ouml;sterreich</option><option value="222">Brasilien</option>
</select></td></tr>
<tr><td class="nw kicktipp-time">10.06.26 21:00</td><td class="nw">Wer holt Bronze?</td>
<td class="nw kicktipp-tippabgabe">Argentinien</td></tr>
</table></form>`;

describe('parseBonusForm', () => {
  it('extracts hidden fields and an open single-slot question', () => {
    const f = parseBonusForm(SYNTH);
    expect(f.fields).toMatchObject({ spieltagIndex: '1', bonus: 'true', tippsaisonId: '99', 'fragetippForms[10].tippAbgegeben': 'true' });
    const q = f.questions[0];
    expect(q).toMatchObject({ questionId: 10, text: 'Wer wird Weltmeister?', deadline: '11.06.26 21:00', locked: false });
    expect(q.slots).toHaveLength(1);
    expect(q.slots[0]).toMatchObject({ slotId: 77, inputName: 'fragetippForms[10].antwortIds[77]', currentId: null, currentLabel: null });
    // placeholder (-1) excluded; entities decoded
    expect(q.slots[0].options).toEqual([{ id: 111, label: 'Österreich' }, { id: 222, label: 'Brasilien' }]);
  });

  it('parses a row without selects as locked with the stored answer text', () => {
    const q = parseBonusForm(SYNTH).questions[1];
    expect(q.locked).toBe(true);
    expect(q.text).toBe('Wer holt Bronze?');
    expect(q.slots).toHaveLength(1);
    expect(q.slots[0].currentLabel).toBe('Argentinien');
    expect(q.slots[0].options).toEqual([]);
  });

  it('reads the selected option as the current answer', () => {
    const html = SYNTH.replace('<option value="222">', '<option value="222" selected="selected">')
      .replace('<option value="-1" selected="selected">', '<option value="-1">');
    const q = parseBonusForm(html).questions[0];
    expect(q.slots[0].currentId).toBe(222);
    expect(q.slots[0].currentLabel).toBe('Brasilien');
  });

  it('throws ParseError when the question table is missing', () => {
    expect(() => parseBonusForm('<form></form>')).toThrow(ParseError);
  });

  // ── Real-data fixtures ──────────────────────────────────────────────────
  it('parses the live open form: 15 questions, all unanswered, multi-slot Halbfinale', () => {
    const f = parseBonusForm(fixture('bonusform-open.html'));
    expect(f.questions).toHaveLength(15);
    expect(f.fields.tippsaisonId).toBe('4770812');
    expect(f.fields.bonus).toBe('true');
    const hf = f.questions.find((q) => q.text === 'Wer erreicht das Halbfinale?')!;
    expect(hf.slots).toHaveLength(4);
    // answer IDs are per-QUESTION: identical across a question's slots,
    // but different from the same label's id in another question
    const agyptIds = hf.slots.map((s) => s.options.find((o) => o.label === 'Ägypten')!.id);
    expect(new Set(agyptIds).size).toBe(1);
    const wm = f.questions.find((q) => q.text === 'Wer wird Weltmeister?')!;
    expect(wm.slots[0].options.find((o) => o.label === 'Ägypten')!.id).not.toBe(agyptIds[0]);
    for (const q of f.questions) {
      expect(q.locked).toBe(false);
      expect(q.deadline).toBe('11.06.26 21:00');
      for (const s of q.slots) expect(s.currentId).toBeNull();
    }
  });

  it('parses the live filled form: every question answered', () => {
    const f = parseBonusForm(fixture('bonusform-filled.html'));
    expect(f.questions).toHaveLength(15);
    for (const q of f.questions) for (const s of q.slots) {
      expect(s.currentId).not.toBeNull();
      expect(s.currentLabel).not.toBeNull();
    }
  });
});
