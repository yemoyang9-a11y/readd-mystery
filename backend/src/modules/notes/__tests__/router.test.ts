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
});
