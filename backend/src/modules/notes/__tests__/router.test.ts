import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import express from 'express';
import { createNotesRouter } from '../router';
import type { Note, NoteInput, NotesRepository } from '../repository';

const READER_A = '11111111-1111-4111-8111-111111111111';
const READER_B = '22222222-2222-4222-8222-222222222222';
const PUBLISHED = 'bk-published';
const DRAFT = 'bk-draft';

class FakeNotes implements NotesRepository {
  rows: (Note & { reader_id: string; book_id: string })[] = [];

  async list(readerId: string, bookId: string) {
    return this.rows.filter((r) => r.reader_id === readerId && r.book_id === bookId);
  }

  async find(readerId: string, bookId: string, noteId: string) {
    return (
      this.rows.find((r) => r.note_id === noteId && r.reader_id === readerId && r.book_id === bookId) ?? null
    );
  }

  async create(readerId: string, bookId: string, input: NoteInput) {
    const now = new Date().toISOString();
    const row = { note_id: randomUUID(), reader_id: readerId, book_id: bookId, ...input, created_at: now, updated_at: now };
    this.rows.push(row);
    return row;
  }

  async update(readerId: string, bookId: string, noteId: string, input: Partial<NoteInput>) {
    const row = this.rows.find(
      (r) => r.note_id === noteId && r.reader_id === readerId && r.book_id === bookId
    );
    if (!row) return null;
    Object.assign(row, input);
    return row;
  }

  async remove(readerId: string, bookId: string, noteId: string) {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (r) => !(r.note_id === noteId && r.reader_id === readerId && r.book_id === bookId)
    );
    return this.rows.length < before;
  }
}

describe('reading notes router', () => {
  let server: Server;
  let baseUrl: string;
  let notes: FakeNotes;

  beforeEach(async () => {
    notes = new FakeNotes();
    const app = express();
    app.use(
      createNotesRouter({
        notes,
        content: {
          findReadiness: async (bookId: string) =>
            bookId === PUBLISHED ? true : bookId === DRAFT ? false : null,
        },
      })
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  type Reply = Omit<Response, 'json'> & { json(): Promise<any> };

  function call(method: string, path: string, reader: string | null, body?: unknown): Promise<Reply> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(reader ? { 'x-device-id': reader } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const valid = { page_no: 12, kind: 'clue', body: '장갑이 한 짝 없다' };

  test('R12: 미공개·미완비·없는 도서의 노트 API는 404', async () => {
    for (const bookId of [DRAFT, 'bk-missing']) {
      expect((await call('GET', `/books/${bookId}/notes`, READER_A)).status).toBe(404);
      expect((await call('POST', `/books/${bookId}/notes`, READER_A, valid)).status).toBe(404);
    }
    expect(notes.rows).toHaveLength(0);
    expect((await call('GET', `/books/${PUBLISHED}/notes`, READER_A)).status).toBe(200);
  });

  test('독자 식별 헤더가 없으면 400', async () => {
    expect((await call('GET', `/books/${PUBLISHED}/notes`, null)).status).toBe(400);
  });

  test('CRUD 왕복', async () => {
    const created = await call('POST', `/books/${PUBLISHED}/notes`, READER_A, valid);
    expect(created.status).toBe(201);
    const note = await created.json();
    expect(note).toMatchObject(valid);

    const list = await (await call('GET', `/books/${PUBLISHED}/notes`, READER_A)).json();
    expect(list.notes).toHaveLength(1);

    const patched = await call('PATCH', `/books/${PUBLISHED}/notes/${note.note_id}`, READER_A, {
      kind: 'hypothesis',
      body: '범인은 장갑 주인',
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ kind: 'hypothesis', body: '범인은 장갑 주인', page_no: 12 });

    expect((await call('DELETE', `/books/${PUBLISHED}/notes/${note.note_id}`, READER_A)).status).toBe(204);
    const after = await (await call('GET', `/books/${PUBLISHED}/notes`, READER_A)).json();
    expect(after.notes).toHaveLength(0);
  });

  test('다른 reader의 노트는 조회·수정·삭제 불가', async () => {
    const note = await (await call('POST', `/books/${PUBLISHED}/notes`, READER_A, valid)).json();

    const listB = await (await call('GET', `/books/${PUBLISHED}/notes`, READER_B)).json();
    expect(listB.notes).toHaveLength(0);
    expect(
      (await call('PATCH', `/books/${PUBLISHED}/notes/${note.note_id}`, READER_B, { body: 'x' })).status
    ).toBe(404);
    expect((await call('DELETE', `/books/${PUBLISHED}/notes/${note.note_id}`, READER_B)).status).toBe(404);
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0].body).toBe(valid.body);
  });

  test('body 1000자는 허용, 1001자와 빈 값은 400', async () => {
    const path = `/books/${PUBLISHED}/notes`;
    expect((await call('POST', path, READER_A, { ...valid, body: 'a'.repeat(1000) })).status).toBe(201);
    expect((await call('POST', path, READER_A, { ...valid, body: 'a'.repeat(1001) })).status).toBe(400);
    expect((await call('POST', path, READER_A, { ...valid, body: '   ' })).status).toBe(400);
  });

  test('page_no·kind 검증', async () => {
    const path = `/books/${PUBLISHED}/notes`;
    expect((await call('POST', path, READER_A, { ...valid, page_no: 0 })).status).toBe(400);
    expect((await call('POST', path, READER_A, { ...valid, page_no: 1.5 })).status).toBe(400);
    expect((await call('POST', path, READER_A, { ...valid, kind: 'verdict' })).status).toBe(400);
  });

  // 2026-11-17 추리 노트 종류 — 종류와 풀림 표시는 독자만 정한다
  describe('노트 종류와 풀림 표시', () => {
    const path = `/books/${PUBLISHED}/notes`;
    const base = { page_no: 12, body: '장갑이 한 짝 없다' };

    async function create(extra: Record<string, unknown> = {}) {
      const res = await call('POST', path, READER_A, { ...base, ...extra });
      expect(res.status).toBe(201);
      return res.json();
    }

    test('kind를 보내지 않거나 null이면 일반 메모(kind null, resolved false)로 저장된다', async () => {
      expect(await create()).toMatchObject({ kind: null, resolved: false });
      expect(await create({ kind: null })).toMatchObject({ kind: null, resolved: false });
      const list = await (await call('GET', path, READER_A)).json();
      expect(list.notes.map((n: Note) => n.kind)).toEqual([null, null]);
    });

    test('clue·question·hypothesis는 보낸 그대로 저장되고 목록에 나온다', async () => {
      for (const kind of ['clue', 'question', 'hypothesis']) {
        expect(await create({ kind })).toMatchObject({ kind, resolved: false });
      }
      const list = await (await call('GET', path, READER_A)).json();
      expect(list.notes.map((n: Note) => n.kind)).toEqual(['clue', 'question', 'hypothesis']);
    });

    test('알 수 없는 kind는 400이고 저장·수정되지 않는다', async () => {
      for (const kind of ['verdict', 'answer', '', 3, true, ['clue']]) {
        expect((await call('POST', path, READER_A, { ...base, kind })).status).toBe(400);
      }
      expect(notes.rows).toHaveLength(0);

      const note = await create({ kind: 'clue' });
      expect((await call('PATCH', `${path}/${note.note_id}`, READER_A, { kind: 'verdict' })).status).toBe(400);
      expect(notes.rows[0].kind).toBe('clue');
    });

    test('종류는 독자가 바꿀 수 있고 null로 보내면 일반 메모가 된다', async () => {
      const note = await create({ kind: 'clue' });
      const toQuestion = await call('PATCH', `${path}/${note.note_id}`, READER_A, { kind: 'question' });
      expect(await toQuestion.json()).toMatchObject({ kind: 'question', body: base.body, page_no: 12 });
      const toNone = await call('PATCH', `${path}/${note.note_id}`, READER_A, { kind: null });
      expect(toNone.status).toBe(200);
      expect(await toNone.json()).toMatchObject({ kind: null, resolved: false });
    });

    test('풀림 표시는 궁금한 점·가설에서만 켜고 끌 수 있다', async () => {
      for (const kind of ['question', 'hypothesis']) {
        const note = await create({ kind });
        const on = await call('PATCH', `${path}/${note.note_id}`, READER_A, { resolved: true });
        expect(on.status).toBe(200);
        expect(await on.json()).toMatchObject({ kind, resolved: true });
        const off = await call('PATCH', `${path}/${note.note_id}`, READER_A, { resolved: false });
        expect(await off.json()).toMatchObject({ kind, resolved: false });
      }
    });

    test('단서·일반 메모에 풀림 표시를 켜려 하면 400이고 값이 바뀌지 않는다', async () => {
      for (const kind of ['clue', null]) {
        const note = await create({ kind });
        expect((await call('PATCH', `${path}/${note.note_id}`, READER_A, { resolved: true })).status).toBe(400);
        expect((await call('POST', path, READER_A, { ...base, kind, resolved: true })).status).toBe(400);
      }
      expect(notes.rows.filter((r) => r.resolved)).toHaveLength(0);
      // 같은 요청에서 종류를 단서로 바꾸면서 풀림을 켜는 것도 거절한다
      const hypothesis = await create({ kind: 'hypothesis' });
      expect(
        (await call('PATCH', `${path}/${hypothesis.note_id}`, READER_A, { kind: 'clue', resolved: true })).status
      ).toBe(400);
      expect(notes.rows.find((r) => r.note_id === hypothesis.note_id)).toMatchObject({
        kind: 'hypothesis',
        resolved: false,
      });
    });

    test('resolved가 불리언이 아니면 400', async () => {
      const note = await create({ kind: 'hypothesis' });
      for (const resolved of ['true', 1, null]) {
        expect((await call('PATCH', `${path}/${note.note_id}`, READER_A, { resolved })).status).toBe(400);
      }
      expect(notes.rows[0].resolved).toBe(false);
    });

    test('풀림 표시는 내용·쪽수를 고쳐도 그대로 남는다 — 시스템이 스스로 바꾸지 않는다', async () => {
      const note = await create({ kind: 'hypothesis' });
      await call('PATCH', `${path}/${note.note_id}`, READER_A, { resolved: true });
      const edited = await call('PATCH', `${path}/${note.note_id}`, READER_A, { body: '고친 가설', page_no: 3 });
      expect(await edited.json()).toMatchObject({ body: '고친 가설', page_no: 3, kind: 'hypothesis', resolved: true });
      const toQuestion = await call('PATCH', `${path}/${note.note_id}`, READER_A, { kind: 'question' });
      expect(await toQuestion.json()).toMatchObject({ kind: 'question', resolved: true });
    });

    test('풀림 표시가 켜진 노트를 단서·일반 메모로 바꾸면 풀림 표시는 꺼진다', async () => {
      for (const kind of ['clue', null]) {
        const note = await create({ kind: 'question' });
        await call('PATCH', `${path}/${note.note_id}`, READER_A, { resolved: true });
        const changed = await call('PATCH', `${path}/${note.note_id}`, READER_A, { kind });
        expect(await changed.json()).toMatchObject({ kind, resolved: false });
      }
    });

    test('다른 reader는 종류·풀림 표시를 바꿀 수 없다', async () => {
      const note = await create({ kind: 'hypothesis' });
      expect(
        (await call('PATCH', `${path}/${note.note_id}`, READER_B, { resolved: true })).status
      ).toBe(404);
      expect((await call('PATCH', `${path}/${note.note_id}`, READER_B, { kind: 'clue' })).status).toBe(404);
      expect(notes.rows[0]).toMatchObject({ kind: 'hypothesis', resolved: false });
    });
  });
});
