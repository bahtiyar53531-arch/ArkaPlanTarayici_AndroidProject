/**
 * Forum ve destek entegrasyon testleri (Aşama 13) — GERÇEK PostgreSQL (Türkçe tam metin arama) + Redis + dosya deposu.
 * 07 kabul ölçütleri: kilitli konuya yanıt reddedilir; ek dosya türü/boyut sınırı; talep numarası benzersiz.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, createTestContext, newClient, registerAndLogin, resetDatabase, WEB_ORIGIN, type Client, type TestContext } from './helpers.js';

let ctx: TestContext;
let now = new Date('2026-11-28T12:00:00Z');

beforeAll(async () => {
  ctx = await createTestContext({}, undefined, { clock: () => now });
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.rt);
  now = new Date('2026-11-28T12:00:00Z');
  ctx.mailer.clear();
});

let ipSeq = 1;
async function user(username: string, o: { pilot?: boolean; verify?: boolean; role?: string } = {}) {
  const { client } = await registerAndLogin(ctx, username, { client: newClient({ ip: `88.250.${ipSeq++ % 250}.7` }), ...(o.verify === false ? { verify: false } : {}) });
  if (o.pilot) {
    const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: 'KZL' });
    if (r.statusCode !== 201) throw new Error(r.body);
  }
  if (o.role) await ctx.rt.db.query(`INSERT INTO user_roles (user_id, role_key) SELECT id, $2 FROM users WHERE username = $1`, [username, o.role]);
  const id = (await ctx.rt.db.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [username])).rows[0]!.id;
  return { client, id, name: username };
}
type U = Awaited<ReturnType<typeof user>>;
const post = (u: U | Client, url: string, body?: unknown) => call(ctx.app, 'client' in u ? u.client : u, 'POST', url, body ?? {});
const get = (u: U | Client, url: string) => call(ctx.app, 'client' in u ? u.client : u, 'GET', url);
const notes = async (username: string) =>
  (await ctx.rt.db.query<{ kind: string; title: string; link: string }>(
    `SELECT n.kind, n.title, n.link FROM notifications n JOIN players p ON p.id = n.player_id JOIN users u ON u.id = p.user_id WHERE u.username = $1 ORDER BY n.id`,
    [username],
  )).rows;
async function thread(u: U, category = 'genel', title = 'Yeni başlayanlar için rehber', body = 'Merhaba pilotlar, ilk mesaj.') {
  const r = await post(u, '/forum/threads', { category, title, body });
  if (r.statusCode !== 201) throw new Error(r.body);
  return r.json().id as number;
}

// ================================================================== forum
describe('forum: okuma ve yazma', () => {
  it('bölümler herkese açık; oturumsuz yazılamaz; e-postası doğrulanmamış hesap yazamaz; oyuncu duyuru açamaz; başlık filtreden geçer', async () => {
    const anon = newClient();
    const cats = (await get(anon, '/forum/categories')).json().categories;
    expect(cats.map((c: { slug: string }) => c.slug)).toEqual(['duyurular', 'genel', 'rehberler', 'klanlar', 'oneriler', 'hatalar']);
    expect(cats.every((c: { canPost: boolean }) => !c.canPost)).toBe(true);
    expect((await post(anon, '/forum/threads', { category: 'genel', title: 'Oturumsuz deneme', body: 'x' })).statusCode).toBe(401);
    const unv = await user('DogrulanmamisPilot', { verify: false });
    expect((await post(unv, '/forum/threads', { category: 'genel', title: 'Doğrulanmamış deneme', body: 'x' })).json().error.code).toBe('EMAIL_NOT_VERIFIED');
    const a = await user('ForumYazari');
    let r = await post(a, '/forum/threads', { category: 'duyurular', title: 'Sahte duyuru başlığı', body: 'x' });
    expect(r.json().error).toMatchObject({ code: 'FORBIDDEN', message: '"Duyurular" bölümünde yalnızca ekip konu açabilir.' });
    r = await post(a, '/forum/threads', { category: 'genel', title: 'Kısa', body: 'x' });
    expect(r.json().error.code).toBe('VALIDATION_ERROR');
    const id = await thread(a, 'genel', '  Bu   SİKTİR  başlık ', 'İlk mesaj\r\n\r\n\r\n\r\n\r\nçok boşluk');
    const t = (await get(anon, `/forum/t/${id}`)).json().thread;
    expect(t).toMatchObject({ title: 'Bu ****** başlık', author: 'ForumYazari', replies: 0, isLocked: false, canReply: false, replyBlockedReason: 'Yanıt yazmak için giriş yap.' });
    expect(t.posts[0]).toMatchObject({ isFirst: true, body: 'İlk mesaj\n\n\nçok boşluk', author: { username: 'ForumYazari', staffRole: null } });
    expect((await get(a, '/forum/categories')).json().categories.find((c: { slug: string }) => c.slug === 'genel')).toMatchObject({ threads: 1, posts: 1, canPost: true });
  });

  it('yanıt, alıntı ve takip: takip edenler ve alıntılanan pilot bildirim alır; sayfalama; görüntülenme saatte bir sayılır', async () => {
    const a = await user('KonuSahibi', { pilot: true });
    const b = await user('Yanitlayan', { pilot: true });
    const c = await user('UcuncuPilot', { pilot: true });
    const id = await thread(a);
    const r1 = await post(b, `/forum/t/${id}/replies`, { body: 'Teşekkürler, çok faydalı.' });
    expect(r1.statusCode).toBe(201);
    expect((await notes('KonuSahibi')).map((n) => n.kind)).toEqual(['forum_reply']);
    const firstId = (await get(a, `/forum/t/${id}`)).json().thread.posts[0].id;
    await post(c, `/forum/t/${id}/replies`, { body: 'Bence de.', quotedPostId: r1.json().postId });
    expect((await notes('Yanitlayan')).map((n) => n.kind)).toEqual(['forum_quote']); // B takipçi ama tek bildirim (alıntı)
    expect((await notes('KonuSahibi')).length).toBe(2);
    // Başka konudaki mesaj alıntılanamaz
    const other = await thread(b, 'genel', 'Başka bir konu başlığı');
    expect((await post(c, `/forum/t/${other}/replies`, { body: 'x', quotedPostId: firstId })).json().error.code).toBe('POST_NOT_FOUND');
    // Takipten çıkan bildirim almaz
    await post(a, `/forum/t/${id}/follow`, { on: false });
    await post(b, `/forum/t/${id}/replies`, { body: 'Bir ek daha' });
    expect((await notes('KonuSahibi')).length).toBe(2);
    // Sayfalama (20 mesaj/sayfa)
    for (let i = 0; i < 18; i++) await post(c, `/forum/t/${id}/replies`, { body: `Mesaj ${i}` });
    const p2 = (await get(a, `/forum/t/${id}?page=2`)).json().thread;
    expect(p2).toMatchObject({ page: 2, pages: 2, replies: 21 });
    expect(p2.posts.map((x: { body: string }) => x.body)).toEqual(['Mesaj 16', 'Mesaj 17']);
    const q = (await get(a, `/forum/t/${id}`)).json().thread.posts[2];
    expect(q.quoted).toMatchObject({ author: 'Yanitlayan', excerpt: 'Teşekkürler, çok faydalı.' });
    // Görüntülenme: aynı kullanıcı tekrar açınca artmaz
    const v1 = (await get(b, `/forum/t/${id}`)).json().thread.views;
    const v2 = (await get(b, `/forum/t/${id}`)).json().thread.views;
    expect(v2).toBe(v1);
  });

  it('düzenleme yalnızca yazar tarafından ve süre içinde; silinen mesaj gizlenir; beğeni: kendi mesajı beğenilemez, eşzamanlı beğeni tek sayılır', async () => {
    const a = await user('DuzenleyenPilot');
    const b = await user('BegenenPilot');
    const id = await thread(a);
    const pid = (await get(a, `/forum/t/${id}`)).json().thread.posts[0].id;
    expect((await call(ctx.app, b.client, 'PATCH', `/forum/posts/${pid}`, { body: 'başkası' })).json().error.code).toBe('FORBIDDEN');
    expect((await call(ctx.app, a.client, 'PATCH', `/forum/posts/${pid}`, { body: 'Düzeltilmiş ilk mesaj' })).statusCode).toBe(200);
    let p = (await get(b, `/forum/t/${id}`)).json().thread.posts[0];
    expect(p).toMatchObject({ body: 'Düzeltilmiş ilk mesaj', editedAt: expect.any(String), canEdit: false });
    now = new Date(now.getTime() + 25 * 3600_000);
    expect((await call(ctx.app, a.client, 'PATCH', `/forum/posts/${pid}`, { body: 'geç' })).json().error.code).toBe('EDIT_WINDOW_PASSED');
    expect((await post(a, `/forum/posts/${pid}/like`, { on: true })).json().error.code).toBe('NOT_ALLOWED');
    const likes = await Promise.all(Array.from({ length: 20 }, () => post(b, `/forum/posts/${pid}/like`, { on: true })));
    expect(likes.every((r) => r.statusCode === 200)).toBe(true);
    p = (await get(b, `/forum/t/${id}`)).json().thread.posts[0];
    expect(p).toMatchObject({ likes: 1, likedByMe: true });
    await post(b, `/forum/posts/${pid}/like`, { on: false });
    expect((await get(b, `/forum/t/${id}`)).json().thread.posts[0].likes).toBe(0);
    const r = await post(b, `/forum/t/${id}/replies`, { body: 'Silinecek mesaj' });
    await post(b, `/forum/posts/${r.json().postId}/delete`);
    p = (await get(a, `/forum/t/${id}`)).json().thread.posts[1];
    expect(p).toMatchObject({ body: null, deleted: { by: 'author', reason: null } });
    expect((await ctx.rt.db.query('SELECT body FROM forum_posts WHERE id = $1', [r.json().postId])).rows[0].body).toBe('Silinecek mesaj'); // kanıt korunur
  });
});

describe('forum: kilit ve moderasyon', () => {
  it('KİLİTLİ KONUYA YANIT REDDEDİLİR (oyuncu); moderatör yazabilir; kilit + eşzamanlı yanıtlar tutarlı; işlemler denetim kaydında', async () => {
    const a = await user('KilitliKonuSahibi', { pilot: true });
    const b = await user('KilitDenemesi');
    const mod = await user('ForumBekcisi', { role: 'moderator' });
    const id = await thread(a);
    // Oyuncu moderasyon yapamaz
    expect((await post(a, `/forum/t/${id}/moderate`, { action: 'lock' })).json().error.code).toBe('FORBIDDEN');
    // Kilitleme ile eşzamanlı 10 yanıt: kilitten sonra işlenen her yanıt reddedilir, sayaç tutarlı kalır
    const results = await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => post(b, `/forum/t/${id}/replies`, { body: `eşzamanlı ${i}` })),
      post(mod, `/forum/t/${id}/moderate`, { action: 'lock', reason: 'Konu çözüldü' }),
    ]);
    const ok = results.slice(0, 10).filter((r) => r.statusCode === 201).length;
    const locked = results.slice(0, 10).filter((r) => r.json().error?.code === 'THREAD_LOCKED').length;
    expect(ok + locked).toBe(10);
    const row = (await ctx.rt.db.query('SELECT reply_count, is_locked FROM forum_threads WHERE id = $1', [id])).rows[0];
    expect(row).toEqual({ reply_count: ok, is_locked: true });
    expect(Number((await ctx.rt.db.query('SELECT count(*) AS n FROM forum_posts WHERE thread_id = $1', [id])).rows[0].n)).toBe(ok + 1);
    // Kilitten sonra: oyuncu reddedilir (Türkçe mesaj), konu görünümünde sebep yazar; moderatör yazabilir
    const r = await post(b, `/forum/t/${id}/replies`, { body: 'kilitten sonra' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toEqual({ code: 'THREAD_LOCKED', message: 'Bu konu kilitli; yeni yanıt yazılamaz.' });
    expect((await get(b, `/forum/t/${id}`)).json().thread).toMatchObject({ isLocked: true, canReply: false, replyBlockedReason: 'Bu konu kilitli; yeni yanıt yazılamaz.' });
    expect((await post(mod, `/forum/t/${id}/replies`, { body: 'Moderatör notu: konu kilitlendi.' })).statusCode).toBe(201);
    // Konu sahibi bildirim aldı (kilit sebebiyle)
    expect((await notes('KilitliKonuSahibi')).find((n) => n.kind === 'forum_moderation')).toMatchObject({ title: 'Konun kilitlendi' });
    // Kilitli konuda yazar mesajını düzenleyemez
    const first = (await get(a, `/forum/t/${id}`)).json().thread.posts[0];
    expect((await call(ctx.app, a.client, 'PATCH', `/forum/posts/${first.id}`, { body: 'düzenleme' })).json().error.code).toBe('THREAD_LOCKED');
    // Sabitle, taşı, sil: silinen konu oyuncuya 404, moderatöre görünür; geri getir
    await post(mod, `/forum/t/${id}/moderate`, { action: 'pin' });
    await post(mod, `/forum/t/${id}/moderate`, { action: 'move', category: 'rehberler' });
    expect((await get(b, `/forum/t/${id}`)).json().thread).toMatchObject({ isPinned: true, category: { slug: 'rehberler' } });
    await post(mod, `/forum/t/${id}/moderate`, { action: 'delete', reason: 'Yinelenen konu' });
    expect((await get(b, `/forum/t/${id}`)).statusCode).toBe(404);
    expect((await get(mod, `/forum/t/${id}`)).statusCode).toBe(200);
    expect((await get(b, '/forum/c/rehberler')).json().threads).toEqual([]);
    await post(mod, `/forum/t/${id}/moderate`, { action: 'restore' });
    expect((await get(b, `/forum/t/${id}`)).statusCode).toBe(200);
    const audit = await ctx.rt.db.query(`SELECT action, actor_label FROM admin_audit_log WHERE target_type = 'forum_thread' ORDER BY id`);
    expect(audit.rows.map((x) => x.action)).toEqual(['forum.thread.lock', 'forum.thread.pin', 'forum.thread.move', 'forum.thread.delete', 'forum.thread.restore']);
    expect(audit.rows.every((x) => x.actor_label === 'ForumBekcisi')).toBe(true);
  });

  it('bölüm moderatörü yalnızca kendi bölümünü yönetir; atamayı yalnızca yetkili yapar; moderatör mesaj silince yazar bildirim alır', async () => {
    const admin = await user('ToplulukBey', { role: 'community_admin' });
    const cm = await user('BolumBekcisi');
    const a = await user('SiradanYazar', { pilot: true });
    expect((await post(cm, '/forum/moderators', { category: 'rehberler', username: 'BolumBekcisi', assign: true })).statusCode).toBe(403);
    const r = await post(admin, '/forum/moderators', { category: 'rehberler', username: 'BolumBekcisi', assign: true });
    expect(r.json()).toEqual({ moderators: ['BolumBekcisi'] });
    const inGuides = await thread(a, 'rehberler', 'Madencilik rehberi taslağı');
    const inGeneral = await thread(a, 'genel', 'Genel bölümde bir konu');
    expect((await post(cm, `/forum/t/${inGuides}/moderate`, { action: 'pin' })).statusCode).toBe(200);
    expect((await post(cm, `/forum/t/${inGeneral}/moderate`, { action: 'pin' })).json().error.code).toBe('FORBIDDEN');
    const pid = (await get(cm, `/forum/t/${inGuides}`)).json().thread.posts[0].id;
    expect((await post(cm, `/forum/posts/${pid}/delete`, { reason: 'Kural 5: reklam' })).statusCode).toBe(200);
    expect((await get(a, `/forum/t/${inGuides}`)).json().thread.posts[0]).toMatchObject({ body: null, deleted: { by: 'moderator', reason: 'Kural 5: reklam' } });
    expect((await notes('SiradanYazar')).at(-1)).toMatchObject({ kind: 'forum_moderation', title: 'Forum mesajın moderatör tarafından silindi' });
  });

  it('Türkçe arama: kök bulma ("gemi" → "gemileri"), eşleşen kelime işaretli; silinen içerik aranmaz; şikâyet kuyruğa düşer', async () => {
    const a = await user('AramaYazari');
    const b = await user('Sikayetci');
    const id = await thread(a, 'rehberler', 'Kızılelma filosu için PvP taktikleri', 'Savaş gemileri kalkanlarını önce doldurmalı.');
    await thread(a, 'genel', 'Alakasız bir konu başlığı', 'Bugün hava çok güzel.');
    let s = (await get(b, `/forum/search?q=${encodeURIComponent('gemi')}`)).json();
    expect(s.results).toEqual([expect.objectContaining({ threadId: id, category: 'Rehberler ve Taktikler', snippet: expect.stringContaining('[[gemileri]]') })]);
    s = (await get(b, `/forum/search?q=${encodeURIComponent('Kızılelma taktik')}`)).json();
    expect(s.results[0]).toMatchObject({ threadId: id, postId: null });
    expect((await get(b, '/forum/search?q=a')).json().error.code).toBe('VALIDATION_ERROR');
    // Şikâyet
    const pid = (await get(b, `/forum/t/${id}`)).json().thread.posts[0].id;
    let r = await post(b, `/forum/posts/${pid}/report`, { reason: 'spam', details: 'Reklam içeriyor' });
    expect(r.statusCode).toBe(201);
    const rep = (await ctx.rt.db.query(`SELECT target_type, target_id, status, snapshot FROM reports`)).rows[0];
    expect(rep).toMatchObject({ target_type: 'forum_post', target_id: String(pid), status: 'open', snapshot: { author: 'AramaYazari', body: 'Savaş gemileri kalkanlarını önce doldurmalı.' } });
    expect((await post(b, `/forum/posts/${pid}/report`, { reason: 'spam' })).json().error.code).toBe('REPORT_EXISTS');
    expect((await post(a, `/forum/posts/${pid}/report`, { reason: 'spam' })).json().error.code).toBe('VALIDATION_ERROR');
    r = await post(b, `/forum/t/${id}/report`, { reason: 'other' });
    expect(r.statusCode).toBe(201);
    // Silinen konu aramada çıkmaz
    const mod = await user('AramaBekcisi', { role: 'moderator' });
    await post(mod, `/forum/t/${id}/moderate`, { action: 'delete' });
    expect((await get(b, '/forum/search?q=gemi')).json().results).toEqual([]);
  });
});

// ================================================================== destek
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 0)]);

async function upload(u: U, no: string, mid: number, name: string, bytes: Buffer, staff = false) {
  const headers: Record<string, string> = {
    origin: WEB_ORIGIN,
    'content-type': 'application/octet-stream',
    'x-file-name': encodeURIComponent(name),
    'user-agent': u.client.userAgent,
  };
  if (u.client.cookie) headers.cookie = u.client.cookie;
  if (u.client.csrf) headers['x-csrf-token'] = u.client.csrf;
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/support${staff ? '/staff' : ''}/tickets/${no}/messages/${mid}/attachments`,
    headers,
    payload: bytes,
    remoteAddress: u.client.ip,
  });
}
async function ticket(u: U, subject = 'Giriş yapamıyorum', category = 'account') {
  const r = await post(u, '/support/tickets', { category, subject, body: 'Dün akşamdan beri giriş yapamıyorum, yardım eder misiniz?' });
  if (r.statusCode !== 201) throw new Error(r.body);
  return r.json() as { ticket: { ticketNo: string; messages: Array<{ id: number }> }; messageId: number };
}

describe('destek talepleri', () => {
  it('TALEP NUMARASI BENZERSİZ: 10 kullanıcı × 5 eşzamanlı talep = 50 farklı TO-YYYY-NNNNNN; açık talep sınırı; platform bilgisi kaydedilir', async () => {
    const users: U[] = [];
    for (let i = 0; i < 10; i++) users.push(await user(`YardimPilot${i}`));
    const res = await Promise.all(users.flatMap((u) => Array.from({ length: 5 }, (_, k) => post(u, '/support/tickets', { category: 'bug', subject: `Hata bildirimi ${k}`, body: 'Oyunda bir hata buldum, ayrıntılar aşağıda.' }))));
    expect(res.every((r) => r.statusCode === 201)).toBe(true);
    const nos = res.map((r) => r.json().ticket.ticketNo as string);
    expect(new Set(nos).size).toBe(50);
    expect(nos.every((n) => /^TO-2026-\d{6}$/.test(n))).toBe(true);
    const sixth = await post(users[0]!, '/support/tickets', { category: 'bug', subject: 'Altıncı talep', body: 'Sınırı aşan talep denemesi.' });
    expect(sixth.json().error.code).toBe('TICKET_LIMIT');
    const app = await call(ctx.app, users[1]!.client, 'GET', '/support/tickets');
    expect(app.json().tickets.length).toBe(5);
    // Başkasının talebi "bulunamadı"
    expect((await get(users[1]!, `/support/tickets/${nos[0]}`)).json().error.code).toBe('TICKET_NOT_FOUND');
    // İstemci platformu
    const u = await user('UygulamaPilotu');
    const r = await call(ctx.app, u.client, 'POST', '/support/tickets', { category: 'gameplay', subject: 'Uygulamada sorun', body: 'Android uygulamasında harita açılmıyor.' }, { 'x-client-platform': 'android', 'x-client-version': '1.4.2' });
    expect(r.json().ticket).toMatchObject({ platform: 'android', appVersion: '1.4.2', status: 'waiting_staff' });
  });

  it('EK DOSYA: tür içerikten tespit edilir (sahte PNG reddedilir), boyut ve sayı sınırı, süre sınırı; dosya adı temizlenir; yalnızca yetkili indirir', async () => {
    const a = await user('EkliPilot');
    const b = await user('MerakliPilot');
    const t = await ticket(a);
    const no = t.ticket.ticketNo;
    // Geçerli PNG (adı zararlı yol içerse de temizlenir)
    let r = await upload(a, no, t.messageId, '../../etc/ekran görüntüsü<script>.png', PNG);
    expect(r.statusCode).toBe(201);
    const att = r.json().attachment;
    expect(att).toMatchObject({ fileName: 'ekran görüntüsü_script_.png', mimeType: 'image/png', sizeBytes: PNG.length });
    // Uzantısı .png olan çalıştırılabilir dosya → türü içerikten tespit edildiği için reddedilir
    r = await upload(a, no, t.messageId, 'resim.png', EXE);
    expect(r.statusCode).toBe(415);
    expect(r.json().error).toEqual({ code: 'ATTACHMENT_TYPE', message: 'Bu dosya türü desteklenmiyor. İzin verilenler: PNG, JPEG, WEBP, PDF veya düz metin (TXT).' });
    // 5 MB üstü
    r = await upload(a, no, t.messageId, 'buyuk.png', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]));
    expect(r.statusCode).toBe(413);
    expect(r.json().error.code).toBe('ATTACHMENT_TOO_LARGE');
    // Düz metin (HTML içeriği olsa da yalnızca text/plain ve indirme olarak sunulur)
    r = await upload(a, no, t.messageId, 'log.html', Buffer.from('<html><script>alert(1)</script></html>\nhata kaydı\n'));
    expect(r.json().attachment).toMatchObject({ mimeType: 'text/plain', fileName: 'log.txt' });
    await upload(a, no, t.messageId, 'ikinci.png', PNG);
    r = await upload(a, no, t.messageId, 'dorduncu.png', PNG);
    expect(r.json().error).toMatchObject({ code: 'ATTACHMENT_LIMIT', message: 'Bir mesaja en fazla 3 dosya eklenebilir.' });
    // Başkası bu mesaja ekleyemez; süre geçince yazar da ekleyemez
    expect((await upload(b, no, t.messageId, 'x.png', PNG)).statusCode).toBe(404);
    const t2 = await ticket(a, 'İkinci sorun');
    now = new Date(now.getTime() + 31 * 60_000);
    expect((await upload(a, t2.ticket.ticketNo, t2.messageId, 'gec.png', PNG)).json().error.code).toBe('ATTACHMENT_LIMIT');
    // İndirme: sahip alır (aynı bayt, indirme başlıkları), başkası 404
    const d = await call(ctx.app, a.client, 'GET', `/support/attachments/${att.id}`);
    expect(d.statusCode).toBe(200);
    expect(d.rawPayload.equals(PNG)).toBe(true);
    expect(d.headers['content-type']).toBe('image/png');
    expect(d.headers['content-disposition']).toContain('attachment;');
    expect(d.headers['x-content-type-options']).toBe('nosniff');
    expect((await call(ctx.app, b.client, 'GET', `/support/attachments/${att.id}`)).statusCode).toBe(404);
    // Veritabanında içerik yok; özet (sha256) ve depolama anahtarı var; diskte dosya bayt bayt aynı
    const row = (await ctx.rt.db.query(`SELECT storage_key, size_bytes, encode(sha256, 'hex') AS sha FROM support_attachments WHERE id = $1`, [att.id])).rows[0];
    expect(row.storage_key).toMatch(/^[a-f0-9]{2}\/[a-f0-9]{64}$/);
    expect((await ctx.files.get(row.storage_key))!.equals(PNG)).toBe(true);
    // Hiç dosya bulunmayan istek (yanlış içerik türü) reddedilir
    const bad = await call(ctx.app, a.client, 'POST', `/support/tickets/${no}/messages/${t.messageId}/attachments`, { data: 'json' });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('durum akışı ve personel: iç not oyuncuya görünmez; personel yanıtı bildirim + e-posta; çözülen talep oyuncu yazınca açılır; kapatılana yazılamaz; yetkiler', async () => {
    const a = await user('TalepSahibi', { pilot: true });
    const staff = await user('YardimMasasi', { role: 'support_staff' });
    const modOnly = await user('SadeceGozcu', { role: 'moderator' });
    const t = await ticket(a, 'Kayıp eşya', 'gameplay');
    const no = t.ticket.ticketNo;
    // Yetkiler: oyuncu personel uçlarına giremez; moderatör okuyabilir ama yanıtlayamaz
    expect((await get(a, '/support/staff/tickets')).statusCode).toBe(403);
    expect((await get(modOnly, `/support/staff/tickets/${no}`)).statusCode).toBe(200);
    expect((await post(modOnly, `/support/staff/tickets/${no}/replies`, { body: 'x' })).statusCode).toBe(403);
    // Kuyruk
    const q = (await get(staff, '/support/staff/tickets')).json().tickets;
    expect(q[0]).toMatchObject({ ticketNo: no, user: 'TalepSahibi', status: 'waiting_staff', assignedTo: null });
    // İç not: oyuncuya görünmez, durum değişmez
    await post(staff, `/support/staff/tickets/${no}/replies`, { body: 'Kayıtları kontrol ediyorum (iç not).', internal: true });
    let v = (await get(a, `/support/tickets/${no}`)).json().ticket;
    expect(v.messages.length).toBe(1);
    expect(v.status).toBe('waiting_staff');
    // Yanıt: oyuncu "Türk Orbit Destek" olarak görür, bildirim ve e-posta alır, talep personele atanır
    const r = await post(staff, `/support/staff/tickets/${no}/replies`, { body: 'Merhaba, eşyan hesabına geri yüklendi.' });
    expect(r.json().ticket).toMatchObject({ status: 'waiting_player', assignedTo: 'YardimMasasi' });
    v = (await get(a, `/support/tickets/${no}`)).json().ticket;
    expect(v.messages.map((m: { author: string; isStaff: boolean }) => [m.author, m.isStaff])).toEqual([
      ['TalepSahibi', false],
      ['Türk Orbit Destek', true],
    ]);
    expect((await notes('TalepSahibi')).at(-1)).toMatchObject({ kind: 'support_reply', link: `/destek/${no}` });
    const mail = ctx.mailer.lastTo('talepsahibi@ornek.com')!;
    expect(mail.subject).toBe(`Türk Orbit: Destek talebine yanıt geldi (${no})`);
    expect(mail.text).not.toContain('eşyan hesabına'); // yanıt metni e-postaya konmaz
    // Personel görünümünde iç not var
    expect((await get(staff, `/support/staff/tickets/${no}`)).json().ticket.messages.length).toBe(3);
    // Çözüldü → oyuncu yazınca yeniden açılır
    await post(staff, `/support/staff/tickets/${no}/update`, { status: 'resolved', priority: 'high' });
    expect((await post(a, `/support/tickets/${no}/replies`, { body: 'Bir eşya hâlâ eksik.' })).json().ticket.status).toBe('waiting_staff');
    // Çözüldükten 7 gün sonra kendiliğinden kapanır; kapatılana yazılamaz
    await post(staff, `/support/staff/tickets/${no}/update`, { status: 'resolved' });
    now = new Date(now.getTime() + 8 * 86400_000);
    expect((await get(a, '/support/tickets')).json().tickets[0].status).toBe('closed');
    const closed = await post(a, `/support/tickets/${no}/replies`, { body: 'tekrar' });
    expect(closed.json().error).toEqual({ code: 'TICKET_CLOSED', message: 'Bu talep kapatıldı. Yeni bir sorun için yeni talep oluşturabilirsin.' });
    // Denetim kaydı
    const audit = await ctx.rt.db.query(`SELECT action, actor_label FROM admin_audit_log WHERE target_type = 'support_ticket'`);
    expect(audit.rows.length).toBe(2);
    // Oyuncu kendi talebini kapatabilir
    const t2 = await ticket(a, 'Başka bir soru');
    expect((await post(a, `/support/tickets/${t2.ticket.ticketNo}/close`)).json().ticket.status).toBe('closed');
    expect(randomUUID()).toBeTruthy();
  });
});
