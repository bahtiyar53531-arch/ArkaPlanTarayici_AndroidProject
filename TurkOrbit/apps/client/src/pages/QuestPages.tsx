/** Görevler sayfası (/gorevler) — oyun dışında da görevler takip edilir, kabul edilir ve ödülleri alınır. */
import { AccountLayout } from '../components/Layout';
import { QuestBoard } from '../components/quests/QuestBoard';

export function QuestsPage() {
  return (
    <AccountLayout>
      <div className="page-head">
        <h1 className="page-title">Görevler</h1>
      </div>
      <p className="muted">
        Görev ilerlemesi oyunda yaptıklarınla sunucuda hesaplanır: NPC avı, kargo, keşif, hangar ve mağaza işlemleri. Tamamlanan görevin ödülünü buradan veya oyunda{' '}
        <b>Q</b> ile açılan görev panelinden alabilirsin.
      </p>
      <section className="panel">
        <QuestBoard />
      </section>
    </AccountLayout>
  );
}
