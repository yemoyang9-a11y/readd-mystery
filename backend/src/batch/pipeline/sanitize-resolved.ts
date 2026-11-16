import { ResolvedBookData } from './check-integrity';

// FR-ADM-005 🚦
export type HeldTargetType =
  'character' | 'alias' | 'character_note' | 'relationship' | 'term' | 'event';

export interface HeldItem {
  target_type: HeldTargetType;
  label: string;
  reasons: string[];
}

function validPage(page: unknown, totalPages: number): boolean {
  return typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= totalPages;
}

function pageReason(page: unknown): string {
  return `page_out_of_range: ${JSON.stringify(page ?? null)}`;
}

// FR-ADM-005 🚦
export function sanitizeResolved(
  data: ResolvedBookData,
  totalPages: number
): { data: ResolvedBookData; held: HeldItem[] } {
  const held: HeldItem[] = [];
  const hold = (target_type: HeldTargetType, label: string, reason: string): void => {
    held.push({ target_type, label, reasons: [reason] });
  };

  const characters: ResolvedBookData['characters'] = [];
  const keptIds = new Set<string>();
  const nameOwners = new Map<string, ResolvedBookData['characters'][number]>();
  for (const c of data.characters) {
    if (!validPage(c.first_appearance_page, totalPages)) {
      hold('character', c.name, pageReason(c.first_appearance_page));
      continue;
    }
    if (keptIds.has(c.id)) {
      hold('character', c.name, `duplicate_id: ${c.id}`);
      continue;
    }
    const sameName = nameOwners.get(c.name);
    if (sameName && !(c.identity_status === 'distinct' && c.evidence && sameName.evidence)) {
      hold('character', c.name, 'duplicate_name');
      continue;
    }
    const aliases = c.aliases.filter((a) => {
      const ok = validPage(a.first_appearance_page, totalPages);
      if (!ok) hold('alias', `${c.name} / ${a.alias}`, pageReason(a.first_appearance_page));
      return ok;
    });
    const notes = c.notes.filter((n) => {
      const ok = validPage(n.source_page, totalPages);
      if (!ok) hold('character_note', `${c.name} / ${n.note}`, pageReason(n.source_page));
      return ok;
    });
    keptIds.add(c.id);
    nameOwners.set(c.name, c);
    characters.push({ ...c, aliases, notes });
  }

  const relationships = data.relationships.filter((r) => {
    if (!validPage(r.established_page, totalPages)) {
      hold('relationship', r.label, pageReason(r.established_page));
      return false;
    }
    if (!keptIds.has(r.character_a_id) || !keptIds.has(r.character_b_id)) {
      hold('relationship', r.label, 'endpoint_character_held');
      return false;
    }
    return true;
  });

  const seenTerms = new Set<string>();
  const terms = data.terms.filter((t) => {
    if (!validPage(t.first_appearance_page, totalPages)) {
      hold('term', t.term, pageReason(t.first_appearance_page));
      return false;
    }
    if (seenTerms.has(t.term)) {
      hold('term', t.term, 'duplicate_term');
      return false;
    }
    seenTerms.add(t.term);
    return true;
  });

  const events = data.events.filter((e) => {
    if (validPage(e.occurrence_page, totalPages)) return true;
    hold('event', e.event, pageReason(e.occurrence_page));
    return false;
  });

  return { data: { ...data, characters, relationships, terms, events }, held };
}
