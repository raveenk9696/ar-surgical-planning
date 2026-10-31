import { byId } from './dom';

export function setupAbout(): void {
  const dialog = byId<HTMLDialogElement>('about');
  byId('about-open').addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
